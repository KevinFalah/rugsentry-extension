import { describe, expect, it } from "vitest"
import { calculateSecurityScore, extractCAFromUrl, shouldResetScanner } from "./scanner-utils"

describe("Scanner Utils", () => {
  describe("extractCAFromUrl", () => {
    it("should extract CA from DexScreener URL", () => {
      const url = "https://dexscreener.com/solana/3G3sHFsdQwHPAnJpN6Sy5oFEKfviGAjCc7NVPHgspump"
      expect(extractCAFromUrl(url)).toBe("3G3sHFsdQwHPAnJpN6Sy5oFEKfviGAjCc7NVPHgspump")
    })

    it("should return empty string for non-Solana networks (like TON)", () => {
      const url = "https://dexscreener.com/ton/eqd9sq4tfasxs61k2lv6gdhiysf4s0oxpx5ujsihqztxaflg"
      expect(extractCAFromUrl(url)).toBe("")
    })

    it("should extract CA from Birdeye URL", () => {
      const url = "https://birdeye.so/token/So11111111111111111111111111111111111111112?chain=solana"
      expect(extractCAFromUrl(url)).toBe("So11111111111111111111111111111111111111112")
    })

    it("should return empty string for invalid URL", () => {
      const url = "https://google.com"
      expect(extractCAFromUrl(url)).toBe("")
    })
  })

  describe("calculateSecurityScore (Dual-Engine)", () => {
    const CA = "addr1234567890123456789012345678901"
    const safeGoPlus = { mintable: { status: "0" }, freezable: { status: "0" }, metadata: { symbol: "SAFE" } }

    it("should return 100 for fully safe token (GoPlus clean, no RugCheck risks)", () => {
      const result = calculateSecurityScore(safeGoPlus, { risks: [], score_normalised: 100, lpLockedPct: 100 }, null, CA)
      expect(result.score).toBe(100)
      expect(result.risk).toBe("low")
      expect(result.ticker).toBe("SAFE")
    })

    it("should score 10 if GoPlus detects mintable (fatal flag)", () => {
      const goPlus = { mintable: { status: "1" }, freezable: { status: "0" } }
      const result = calculateSecurityScore(goPlus, { risks: [], score_normalised: 80, lpLockedPct: 100 }, null, CA)
      expect(result.score).toBe(10)
      expect(result.mintable).toBe(true)
      expect(result.risk).toBe("high")
    })

    it("should score 10 if GoPlus detects freezable (fatal flag)", () => {
      const goPlus = { mintable: { status: "0" }, freezable: { status: "1" } }
      const result = calculateSecurityScore(goPlus, null, null, CA)
      expect(result.score).toBe(10)
      expect(result.freezable).toBe(true)
    })

    it("should score 10 if RugCheck has danger-level risk", () => {
      const rugCheck = {
        risks: [{ name: "Honeypot detected", value: "", level: "danger" as const }],
        score_normalised: 5,
        lpLockedPct: 0
      }
      const result = calculateSecurityScore(safeGoPlus, rugCheck, null, CA)
      expect(result.score).toBe(10)
      expect(result.risk).toBe("high")
    })

    it("should deduct points for RugCheck warn-level risks", () => {
      const rugCheck = {
        risks: [
          { name: "Single holder ownership", value: "20.29%", level: "warn" as const },
          { name: "High holder concentration", value: "", level: "warn" as const },
          { name: "Low amount of LP Providers", value: "", level: "warn" as const }
        ],
        score_normalised: 36,
        lpLockedPct: 100
      }
      // Penalties: 15 + 20 + 10 = 45. Score: 100 - 45 = 55
      const result = calculateSecurityScore(safeGoPlus, rugCheck, null, CA)
      expect(result.score).toBe(55)
      expect(result.risk).toBe("medium")
      expect(result.risks).toHaveLength(3)
    })

    it("should deduct 15 for low liquidity from DexScreener", () => {
      const dexData = { liquidityUsd: 2000, priceChange1h: 5, priceChange6h: 10 }
      const result = calculateSecurityScore(safeGoPlus, { risks: [], score_normalised: 100, lpLockedPct: 100 }, dexData, CA)
      expect(result.score).toBe(85)
      expect(result.liquidityUsd).toBe(2000)
    })

    it("should deduct 10 for massive price dump from DexScreener", () => {
      const dexData = { liquidityUsd: 50000, marketCap: 1000000, priceChange1h: -60, priceChange6h: -80 }
      const result = calculateSecurityScore(safeGoPlus, { risks: [], score_normalised: 100, lpLockedPct: 100 }, dexData, CA)
      expect(result.score).toBe(90)
      expect(result.priceChange1h).toBe(-60)
    })

    it("should deduct 30 for Liquidity Trap (Liquidity/MarketCap ratio < 2%)", () => {
      // Market Cap 1 Juta, Liquidity cuma 10 ribu (rasio 1%)
      const dexData = { liquidityUsd: 10000, marketCap: 1000000, priceChange1h: 0, priceChange6h: 0 }
      const result = calculateSecurityScore(safeGoPlus, { risks: [], score_normalised: 100, lpLockedPct: 100 }, dexData, CA)
      
      expect(result.score).toBe(70) // 100 - 30
      expect(result.thinLiquidityRisk).toBe(true)
    })

    it("should NOT deduct 30 if Liquidity/MarketCap ratio is healthy (>= 2%)", () => {
      // Market Cap 1 Juta, Liquidity 50 ribu (rasio 5%)
      const dexData = { liquidityUsd: 50000, marketCap: 1000000, priceChange1h: 0, priceChange6h: 0 }
      const result = calculateSecurityScore(safeGoPlus, { risks: [], score_normalised: 100, lpLockedPct: 100 }, dexData, CA)
      
      expect(result.score).toBe(100)
      expect(result.thinLiquidityRisk).toBe(false)
    })

    it("should deduct 25 if top 10 clean holders exceed 40% concentration", () => {
      const goPlusWithHolders = {
        ...safeGoPlus,
        holders: [
          { account: "whale1", percent: "0.20" }, // 20%
          { account: "whale2", percent: "0.15" }, // 15%
          { account: "whale3", percent: "0.10" }, // 10% → total 45%
          { account: "user4",  percent: "0.05" },
        ]
      }
      const result = calculateSecurityScore(goPlusWithHolders, { risks: [], score_normalised: 100, lpLockedPct: 100 }, null, CA)

      expect(result.score).toBe(75) // 100 - 25
      expect(result.highConcentrationRisk).toBe(true)
    })

    it("should NOT deduct if top 10 concentration is below or equal to 40%", () => {
      const goPlusWithHolders = {
        ...safeGoPlus,
        holders: [
          { account: "whale1", percent: "0.15" },
          { account: "whale2", percent: "0.10" },
          { account: "whale3", percent: "0.10" }, // total 35%
        ]
      }
      const result = calculateSecurityScore(goPlusWithHolders, { risks: [], score_normalised: 100, lpLockedPct: 100 }, null, CA)

      expect(result.score).toBe(100)
      expect(result.highConcentrationRisk).toBe(false)
    })

    it("should exclude known LP/Burn addresses from concentration calculation", () => {
      const raydiumLpAddress = "5Q544fKrFoe6tsEbD7S8EmxGTJYAKtTVhAW5Q5pge4j1"
      const burnAddress = "1nc1nerator11111111111111111111111111111111"
      const goPlusWithHolders = {
        ...safeGoPlus,
        holders: [
          { account: raydiumLpAddress, percent: "0.60" }, // 60% LP — harus diabaikan
          { account: burnAddress,      percent: "0.15" }, // 15% burn — harus diabaikan
          { account: "whale1",         percent: "0.20" }, // 20% holder biasa
          { account: "user1",          percent: "0.05" }, // 5% holder biasa
        ]
      }
      // Setelah LP & burn diabaikan, konsentrasi bersih = 20% + 5% = 25% (di bawah 40%)
      const result = calculateSecurityScore(goPlusWithHolders, { risks: [], score_normalised: 100, lpLockedPct: 100 }, null, CA)

      expect(result.score).toBe(100)
      expect(result.highConcentrationRisk).toBe(false)
    })

    it("should deduct 20 for Dev Holding > 3% on Pump.fun token", () => {
      const pumpCa = "ETsMv6dYaDhWxgc3qUMuvTvMm67iP2knhWtH2pN2pump"
      const rugCheck = {
        risks: [],
        score_normalised: 100,
        lpLockedPct: 100,
        devHoldingPct: 5 // 5% holding (lebih dari 3%)
      }
      const result = calculateSecurityScore(safeGoPlus, rugCheck, null, pumpCa)
      expect(result.score).toBe(80) // 100 - 20
      expect(result.highDevHoldingRisk).toBe(true)
    })

    it("should NOT deduct for Dev Holding if <= 3%", () => {
      const pumpCa = "ETsMv6dYaDhWxgc3qUMuvTvMm67iP2knhWtH2pN2pump"
      const rugCheck = {
        risks: [],
        score_normalised: 100,
        lpLockedPct: 100,
        devHoldingPct: 2.5 // 2.5% holding (aman)
      }
      const result = calculateSecurityScore(safeGoPlus, rugCheck, null, pumpCa)
      expect(result.score).toBe(100)
      expect(result.highDevHoldingRisk).toBe(false)
    })

    it("should stack RugCheck warnings + DexScreener penalties", () => {
      const rugCheck = {
        risks: [{ name: "High holder concentration", value: "", level: "warn" as const }],
        score_normalised: 60,
        lpLockedPct: 100
      }
      const dexData = { liquidityUsd: 1000, priceChange1h: -55, priceChange6h: -70 }
      // RugCheck: -20, DexScreener: -15 (low liq) + -10 (dump) = -45. Score: 100 - 45 = 55
      const result = calculateSecurityScore(safeGoPlus, rugCheck, dexData, CA)
      expect(result.score).toBe(55)
      expect(result.risk).toBe("medium")
    })

    it("should NOT apply DexScreener penalties when fatal flag exists", () => {
      const goPlus = { mintable: { status: "1" }, freezable: { status: "0" } }
      const dexData = { liquidityUsd: 500, priceChange1h: -90, priceChange6h: -95 }
      const result = calculateSecurityScore(goPlus, null, dexData, CA)
      // Fatal flag → score = 10, DexScreener should NOT further reduce
      expect(result.score).toBe(10)
    })

    it("should handle all APIs returning null gracefully (default 100) and mark rugCheckFailed as true", () => {
      const result = calculateSecurityScore(null, null, null, CA)
      expect(result.score).toBe(100)
      expect(result.risk).toBe("low")
      expect(result.risks).toEqual([])
      expect(result.rugCheckFailed).toBe(true)
    })

    it("should clamp score to minimum 0", () => {
      const rugCheck = {
        risks: [
          { name: "Single holder ownership", value: "50%", level: "warn" as const },
          { name: "High holder concentration", value: "", level: "warn" as const },
          { name: "Low amount of LP Providers", value: "", level: "warn" as const },
          { name: "Copycat token", value: "", level: "warn" as const },
          { name: "Low Liquidity", value: "", level: "warn" as const }
        ],
        score_normalised: 10,
        lpLockedPct: 0
      }
      const dexData = { liquidityUsd: 100, priceChange1h: -80, priceChange6h: -90 }
      // Penalties: 15+20+10+10+10 = 65 from RugCheck + 15+10 = 25 from Dex = 90. Score: 100-90 = 10
      const result = calculateSecurityScore(safeGoPlus, rugCheck, dexData, CA)
      expect(result.score).toBe(10)
      expect(result.score).toBeGreaterThanOrEqual(0)
    })

    it("should ignore 'Low amount of LP Providers' penalty if token ends with 'pump'", () => {
      const pumpCa = "ETsMv6dYaDhWxgc3qUMuvTvMm67iP2knhWtH2pN2pump"
      const rugCheck = {
        risks: [
          { name: "Low amount of LP Providers", value: "", level: "warn" as const }
        ],
        score_normalised: 90,
        lpLockedPct: 100,
        devHoldingPct: 0
      }
      const result = calculateSecurityScore(safeGoPlus, rugCheck, null, pumpCa)
      // Normal penalty is -10. Because it's a pump token, penalty is 0. Score remains 100.
      expect(result.score).toBe(100)
    })

    it("should set goPlusFailed to true if goPlusData is null", () => {
      const result = calculateSecurityScore(null, null, null, CA)
      expect(result.goPlusFailed).toBe(true)
      expect(result.rugCheckFailed).toBe(true)
      expect(result.score).toBe(100)
    })
  })

  describe("shouldResetScanner", () => {
    const validCA1 = "3G3sHFsdQwHPAnJpN6Sy5oFEKfviGAjCc7NVPHgspump"
    const validCA2 = "4akhvqwzj2b4ewdfxyiypgbfocklkkhmvbea18ypllum"

    it("should NOT reset if URL is exactly the same", () => {
      const url = `https://dexscreener.com/solana/${validCA1}`
      expect(shouldResetScanner(url, url)).toBe(false)
    })

    it("should NOT reset if URL changes but CA remains the same", () => {
      const url1 = `https://dexscreener.com/solana/${validCA1}`
      const url2 = `https://dexscreener.com/solana/${validCA1}#info`
      expect(shouldResetScanner(url1, url2)).toBe(false)
    })

    it("should reset if CA in URL changes", () => {
      const url1 = `https://dexscreener.com/solana/${validCA1}`
      const url2 = `https://dexscreener.com/solana/${validCA2}`
      expect(shouldResetScanner(url1, url2)).toBe(true)
    })

    it("should reset if moving from token page to home page", () => {
      const url1 = `https://dexscreener.com/solana/${validCA1}`
      const url2 = "https://dexscreener.com/"
      expect(shouldResetScanner(url1, url2)).toBe(true)
    })
  })
})
