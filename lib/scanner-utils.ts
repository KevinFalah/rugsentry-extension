
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
 * Menghitung skor keamanan berdasarkan data dari GoPlus API.
 * Standar Web3 Professional Security Assessment.
 */
export const calculateSecurityScore = (tokenData: any, fallbackCa: string) => {
  let score = 100
  let isMintable = false
  let isFreezable = false
  let isLpBurned = true // Default true agar token baru/pump.fun yang belum di-index holders-nya tidak terkena false positive
  let holderConcentrationRisk = false
  let creatorBalanceRisk = false
  let ticker = fallbackCa.slice(0, 4).toUpperCase()

  if (tokenData) {
    // === FATAL RED FLAGS (Instant Rug Indicators) ===
    // Jika salah satu dari flag ini aktif, skor langsung di-cap ke 10.
    let hasFatalFlag = false

    if (tokenData.mintable?.status === '1') {
      isMintable = true
      hasFatalFlag = true
    }
    if (tokenData.freezable?.status === '1') {
      isFreezable = true
      hasFatalFlag = true
    }

    // Cek LP Burn: GoPlus Solana menyimpan top holder di array `holders`.
    // Holder pertama yang memiliki > 90% LP biasanya adalah LP pool.
    // Kita cek apakah LP tersebut terkunci (is_locked === 1).
    const holders = tokenData.holders || []
    const topHolder = holders[0]
    if (topHolder) {
      const topPercent = parseFloat(topHolder.percent || '0')
      // Jika holder terbesar memiliki > 90% dan TIDAK terkunci, ini menandakan LP belum di-burn
      if (topPercent > 0.9 && topHolder.is_locked === 0) {
        isLpBurned = false
      }
    }
    // LP tidak terkunci/dibakar = fatal
    if (!isLpBurned) {
      hasFatalFlag = true
    }

    if (hasFatalFlag) {
      score = 10
    }

    // === WARNING FLAGS (hanya dijalankan jika lolos dari Fatal Red Flags) ===
    if (!hasFatalFlag) {
      // Holder Concentration: Hitung total persentase Top 10 Holders
      const top10Rate = holders.reduce((sum: number, h: any) => {
        return sum + parseFloat(h.percent || '0')
      }, 0)
      if (top10Rate > 0.5) {
        score -= 20
        holderConcentrationRisk = true
      }

      // Creator Balance: Cek apakah kreator masih memegang > 10% supply
      const creators = tokenData.creators || []
      if (creators.length > 0) {
        const creatorAddress = creators[0]?.address || ''
        const creatorHolder = holders.find((h: any) => h.account === creatorAddress)
        if (creatorHolder) {
          const creatorPercent = parseFloat(creatorHolder.percent || '0')
          if (creatorPercent > 0.1) {
            score -= 15
            creatorBalanceRisk = true
          }
        }
      }
    }

    if (tokenData.metadata?.symbol) {
      ticker = tokenData.metadata.symbol
    }
  }

  return {
    score,
    mintable: isMintable,
    freezable: isFreezable,
    lpBurned: isLpBurned,
    holderConcentrationRisk,
    creatorBalanceRisk,
    ticker,
    risk: score >= 80 ? "low" : score >= 50 ? "medium" : ("high" as const)
  }
}

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
