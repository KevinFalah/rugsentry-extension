
/**
 * Mengambil Contract Address dari URL DexScreener, Birdeye, atau Pump.fun
 */
export const extractCAFromUrl = (url: string): string => {
  let detectedCa = ""
  
  if (url.includes("dexscreener.com")) {
    const parts = url.split("/")
    detectedCa = parts[parts.length - 1] || ""
  } else if (url.includes("birdeye.so") || url.includes("pump.fun")) {
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
 * Menghitung skor keamanan berdasarkan data dari GoPlus API
 */
export const calculateSecurityScore = (tokenData: any, fallbackCa: string) => {
  let score = 100
  let isMintable = false
  let isFreezable = false
  let ticker = fallbackCa.slice(0, 4).toUpperCase()

  if (tokenData) {
    if (tokenData.mintable?.status === '1') {
      score -= 40
      isMintable = true
    }
    if (tokenData.freezable?.status === '1') {
      score -= 40
      isFreezable = true
    }
    if (tokenData.metadata?.symbol) {
      ticker = tokenData.metadata.symbol
    }
  }

  return {
    score,
    mintable: isMintable,
    freezable: isFreezable,
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
