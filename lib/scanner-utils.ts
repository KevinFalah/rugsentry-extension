
// =============================================
// TYPES
// =============================================

export interface RugCheckRisk {
  name: string
  value: string
  level: "warn" | "danger" | "info"
}

export interface RugCheckReport {
  risks: RugCheckRisk[]
  score_normalised: number
  lpLockedPct: number
  devHoldingPct: number
}

export interface DexMarketData {
  liquidityUsd: number
  marketCap: number
  priceChange1h: number
  priceChange6h: number
}

export interface ScanResult {
  score: number
  mintable: boolean
  freezable: boolean
  risks: RugCheckRisk[]
  rugCheckFailed: boolean
  goPlusFailed: boolean
  liquidityUsd: number | null
  priceChange1h: number | null
  thinLiquidityRisk: boolean
  highConcentrationRisk: boolean
  highDevHoldingRisk: boolean
  ticker: string
  risk: "low" | "medium" | "high"
}

// =============================================
// URL EXTRACTION
// =============================================

/**
 * Mengambil Contract Address dari URL DexScreener, Birdeye, atau Pump.fun
 */
export const extractCAFromUrl = (url: string): string => {
  let detectedCa = ""

  if (url.includes("dexscreener.com")) {
    if (!url.includes("/solana/")) return "" // Hanya proses jaringan Solana
    const parts = url.split("/")
    detectedCa = parts[parts.length - 1] || ""
  } else if (url.includes("birdeye.so")) {
    if (!url.includes("chain=solana") && !url.includes("/solana/")) return "" // Hanya proses jaringan Solana
    const parts = url.split("/")
    detectedCa = parts[parts.length - 1] || ""
  } else if (url.includes("pump.fun")) {
    const parts = url.split("/")
    detectedCa = parts[parts.length - 1] || ""
  }

  // Bersihkan dari query params (?) atau fragment (#)
  detectedCa = detectedCa.split("?")[0].split("#")[0]

  // Validasi panjang alamat Solana (sekitar 32-44 karakter)
  const isValid = detectedCa.length >= 32
  return isValid ? detectedCa : ""
}

// =============================================
// API FETCHERS
// =============================================

/**
 * Fetch with timeout wrapper using AbortController.
 * Mencegah ekstensi stuck di "Scanning..." jika server API down/pending lama.
 */
export const fetchWithTimeout = async (url: string, options: RequestInit = {}, timeoutMs = 8000): Promise<Response> => {
  const controller = new AbortController()
  const id = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetch(url, { ...options, signal: controller.signal })
    clearTimeout(id)
    return response
  } catch (err) {
    clearTimeout(id)
    throw err
  }
}

/**
 * Mencoba me-resolve Pair Address menjadi Token Address menggunakan DexScreener API
 */
export const resolvePairAddress = async (address: string): Promise<string> => {
  try {
    const dexRes = await fetchWithTimeout(`https://api.dexscreener.com/latest/dex/pairs/solana/${address}`)
    const dexData = await dexRes.json()
    return dexData.pairs?.[0]?.baseToken?.address || address
  } catch (e) {
    console.error("DexScreener resolution failed:", e)
    return address
  }
}

/**
 * Mengambil laporan keamanan token dari RugCheck API.
 * Endpoint ini GRATIS dan tidak memerlukan API key.
 */
export const fetchRugCheckReport = async (ca: string): Promise<RugCheckReport | null> => {
  try {
    const res = await fetchWithTimeout(`https://api.rugcheck.xyz/v1/tokens/${ca}/report`)
    if (!res.ok) return null
    const data = await res.json()

    // Hitung persentase holding milik Creator
    const creatorAddress = data.creator || ""
    const topHolders = data.topHolders || []
    const devHoldingPct = topHolders
      .filter((h: any) => h.owner === creatorAddress)
      .reduce((sum: number, h: any) => sum + (h.pct || 0), 0)

    return {
      risks: (data.risks || []).map((r: any) => ({
        name: r.name || "",
        value: r.value || "",
        level: r.level === "danger" ? "danger" : r.level === "warn" ? "warn" : "info"
      })),
      score_normalised: data.score_normalised ?? 100,
      lpLockedPct: data.lpLockedPct ?? 0,
      devHoldingPct
    }
  } catch (e) {
    console.error("RugCheck API failed:", e)
    return null
  }
}

/**
 * Mengambil data pasar token dari DexScreener API.
 * Menggunakan endpoint token search (bukan pairs).
 */
export const fetchDexScreenerMarket = async (ca: string): Promise<DexMarketData | null> => {
  try {
    const res = await fetchWithTimeout(`https://api.dexscreener.com/latest/dex/tokens/${ca}`)
    if (!res.ok) return null
    const data = await res.json()
    const pair = data.pairs?.[0]
    if (!pair) return null
    return {
      liquidityUsd: pair.liquidity?.usd ?? 0,
      marketCap: pair.marketCap ?? pair.fdv ?? 0, // fdv adalah fallback jika marketCap kosong
      priceChange1h: pair.priceChange?.h1 ?? 0,
      priceChange6h: pair.priceChange?.h6 ?? 0
    }
  } catch (e) {
    console.error("DexScreener market data failed:", e)
    return null
  }
}

// =============================================
// SCORING ENGINE (Dual-Engine: GoPlus + RugCheck + DexScreener)
// =============================================

/**
 * Mapping dari nama risiko RugCheck ke jumlah poin pengurangan.
 * Ini memastikan setiap jenis peringatan memiliki bobot yang konsisten.
 */
const RUGCHECK_WARN_PENALTIES: Record<string, number> = {
  "Single holder ownership": 15,
  "High holder concentration": 20,
  "Low amount of LP Providers": 10,
  "Copycat token": 10,
  "Low Liquidity": 10,
}
const DEFAULT_WARN_PENALTY = 5

/**
 * Daftar alamat LP/Burn publik yang diketahui untuk dikecualikan dari perhitungan konsentrasi holder.
 * Sumber: Raydium, Pump.fun, Solana native burn/null address.
 */
const KNOWN_LP_AND_BURN_ADDRESSES = new Set([
  "11111111111111111111111111111111",           // Solana null/system address
  "1nc1nerator11111111111111111111111111111111", // Solana burn address
  "So11111111111111111111111111111111111111112", // Wrapped SOL
  "5Q544fKrFoe6tsEbD7S8EmxGTJYAKtTVhAW5Q5pge4j1", // Raydium v4 liquidity pool
  "675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8", // Raydium AMM Program
])

/**
 * Calculates a security score based on data from GoPlus + RugCheck + DexScreener.
 * Web3 Professional Security Assessment Standard.
 * 
 * Scoring Flow:
 * 1. Start with base score = 100
 * 2. GoPlus Fatal Flags (mint/freeze) → score = 10
 * 3. RugCheck danger-level risks → score = 10
 * 4. RugCheck warn-level risks → deductions from score
 * 5. DexScreener market data → additional deductions
 * 6. Final score = max(0, min(100, score))
 */
export const calculateSecurityScore = (
  goPlusData: any,
  rugCheckData: RugCheckReport | null,
  dexData: DexMarketData | null,
  fallbackCa: string
): ScanResult => {
  let score = 100
  let isMintable = false
  let isFreezable = false
  let thinLiquidityRisk = false
  let highConcentrationRisk = false
  let highDevHoldingRisk = false
  let ticker = fallbackCa.slice(0, 4).toUpperCase()
  let hasFatalFlag = false

  // ── TIER 1: GoPlus Contract Fatal Flags ──
  if (goPlusData) {
    if (goPlusData.mintable?.status === '1') {
      isMintable = true
      hasFatalFlag = true
    }
    if (goPlusData.freezable?.status === '1') {
      isFreezable = true
      hasFatalFlag = true
    }
    if (goPlusData.metadata?.symbol) {
      ticker = goPlusData.metadata.symbol
    }
  }

  // ── TIER 1: RugCheck Danger-Level Flags ──
  const risks: RugCheckRisk[] = rugCheckData?.risks || []
  const hasDangerRisk = risks.some(r => r.level === "danger")
  if (hasDangerRisk) {
    hasFatalFlag = true
  }

  if (hasFatalFlag) {
    score = 10
  }

  // ── TIER 2: RugCheck Warning Deductions ──
  if (!hasFatalFlag) {
    for (const risk of risks) {
      if (risk.level === "warn") {
        let penalty = RUGCHECK_WARN_PENALTIES[risk.name] ?? DEFAULT_WARN_PENALTY

        if (risk.name === "Low amount of LP Providers" && fallbackCa.endsWith("pump")) {
          penalty = 0
        }

        score -= penalty
      }
    }

    // ── TIER 2.1: Pump.fun Dev Holding Risk ──
    if (fallbackCa.endsWith("pump") && rugCheckData && rugCheckData.devHoldingPct > 3) {
      score -= 20
      highDevHoldingRisk = true
    }
  }

  // ── TIER 2.5: GoPlus Sybil/Cluster Concentration Check ──
  // Cek top 10 holders, kecualikan alamat LP/Burn yang diketahui
  // Jika total konsentrasi bersih > 40%, kurangi 25 poin
  if (!hasFatalFlag && goPlusData) {
    const holders: any[] = goPlusData.holders || []
    const top10 = holders.slice(0, 10)
    const cleanConcentration = top10.reduce((sum: number, h: any) => {
      const addr: string = (h.account || h.address || "").toLowerCase()
      const isExcluded = KNOWN_LP_AND_BURN_ADDRESSES.has(h.account || h.address || "")
        || addr.startsWith("raydium") // Raydium naming convention
        || h.tag === "LiquidityVault"  // GoPlus tagging
      if (isExcluded) return sum
      const pct = parseFloat(h.percent || '0')
      return sum + (Number.isFinite(pct) ? pct : 0)
    }, 0)

    if (cleanConcentration > 0.40) {
      score -= 25
      highConcentrationRisk = true
    }
  }

  // ── TIER 3: DexScreener Market Risk Deductions ──
  if (!hasFatalFlag && dexData) {
    if (dexData.liquidityUsd < 5000) {
      score -= 15
    }
    if (dexData.priceChange1h < -50) {
      score -= 10
    }

    // Liquidity Trap Penalty: Liquidity / MarketCap ratio < 2%
    if (dexData.marketCap > 0) {
      const ratio = dexData.liquidityUsd / dexData.marketCap
      if (ratio < 0.02) {
        score -= 30
        thinLiquidityRisk = true
      }
    }
  }

  // Clamp score to 0-100
  score = Math.max(0, Math.min(100, score))

  return {
    score,
    mintable: isMintable,
    freezable: isFreezable,
    risks,
    rugCheckFailed: rugCheckData === null,
    goPlusFailed: goPlusData === null,
    liquidityUsd: dexData?.liquidityUsd ?? null,
    priceChange1h: dexData?.priceChange1h ?? null,
    thinLiquidityRisk,
    highConcentrationRisk,
    highDevHoldingRisk,
    ticker,
    risk: score >= 80 ? "low" : score >= 50 ? "medium" : ("high" as const)
  }
}

// =============================================
// NAVIGATION GUARD
// =============================================

/**
 * Menentukan apakah scanner harus di-reset berdasarkan perubahan URL.
 * Kita hanya reset jika CA yang terdeteksi di URL benar-benar berubah.
 */
export const shouldResetScanner = (oldUrl: string, newUrl: string): boolean => {
  if (oldUrl === newUrl) return false

  const oldCa = extractCAFromUrl(oldUrl)
  const newCa = extractCAFromUrl(newUrl)

  return oldCa !== newCa
}

