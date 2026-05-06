
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
}

export interface DexMarketData {
  liquidityUsd: number
  priceChange1h: number
  priceChange6h: number
}

export interface ScanResult {
  score: number
  mintable: boolean
  freezable: boolean
  risks: RugCheckRisk[]
  rugCheckFailed: boolean
  liquidityUsd: number | null
  priceChange1h: number | null
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
 * Mencoba me-resolve Pair Address menjadi Token Address menggunakan DexScreener API
 */
export const resolvePairAddress = async (address: string): Promise<string> => {
  try {
    const dexRes = await fetch(`https://api.dexscreener.com/latest/dex/pairs/solana/${address}`)
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
    const res = await fetch(`https://api.rugcheck.xyz/v1/tokens/${ca}/report/summary`)
    if (!res.ok) return null
    const data = await res.json()
    return {
      risks: (data.risks || []).map((r: any) => ({
        name: r.name || "",
        value: r.value || "",
        level: r.level === "danger" ? "danger" : r.level === "warn" ? "warn" : "info"
      })),
      score_normalised: data.score_normalised ?? 100,
      lpLockedPct: data.lpLockedPct ?? 0
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
    const res = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${ca}`)
    if (!res.ok) return null
    const data = await res.json()
    const pair = data.pairs?.[0]
    if (!pair) return null
    return {
      liquidityUsd: pair.liquidity?.usd ?? 0,
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
 * Menghitung skor keamanan berdasarkan data dari GoPlus + RugCheck + DexScreener.
 * Standar Web3 Professional Security Assessment.
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

        // Pengecualian untuk token Pump.fun: wajar jika jumlah LP providers sedikit (biasanya 1 pool Raydium)
        if (risk.name === "Low amount of LP Providers" && fallbackCa.endsWith("pump")) {
          penalty = 0
        }

        score -= penalty
      }
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
  }

  // Clamp score to 0-100
  score = Math.max(0, Math.min(100, score))

  return {
    score,
    mintable: isMintable,
    freezable: isFreezable,
    risks,
    rugCheckFailed: rugCheckData === null,
    liquidityUsd: dexData?.liquidityUsd ?? null,
    priceChange1h: dexData?.priceChange1h ?? null,
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

