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

  describe("calculateSecurityScore", () => {
    it("should return 100 for fully safe token (no fatal flags, LP burned, good distribution)", () => {
      const mockData = {
        mintable: { status: "0" },
        freezable: { status: "0" },
        holders: [
          { account: "pool", percent: "0.3", is_locked: 0 },
          { account: "user1", percent: "0.05", is_locked: 0 }
        ],
        creators: [],
        metadata: { symbol: "SAFE" }
      }
      const result = calculateSecurityScore(mockData, "addr1234567890123456789012345678901")
      expect(result.score).toBe(100)
      expect(result.risk).toBe("low")
      expect(result.lpBurned).toBe(true)
    })

    it("should score 10 if mintable (fatal flag)", () => {
      const mockData = {
        mintable: { status: "1" },
        freezable: { status: "0" },
        holders: [{ account: "pool", percent: "0.3", is_locked: 0 }],
        creators: []
      }
      const result = calculateSecurityScore(mockData, "addr1234567890123456789012345678901")
      expect(result.score).toBe(10)
      expect(result.risk).toBe("high")
      expect(result.mintable).toBe(true)
    })

    it("should score 10 if freezable (fatal flag)", () => {
      const mockData = {
        mintable: { status: "0" },
        freezable: { status: "1" },
        holders: [{ account: "pool", percent: "0.3", is_locked: 0 }],
        creators: []
      }
      const result = calculateSecurityScore(mockData, "addr1234567890123456789012345678901")
      expect(result.score).toBe(10)
      expect(result.risk).toBe("high")
      expect(result.freezable).toBe(true)
    })

    it("should score 10 if LP not burned (top holder >90% & not locked)", () => {
      const mockData = {
        mintable: { status: "0" },
        freezable: { status: "0" },
        holders: [{ account: "pool", percent: "0.95", is_locked: 0 }],
        creators: []
      }
      const result = calculateSecurityScore(mockData, "addr1234567890123456789012345678901")
      expect(result.score).toBe(10)
      expect(result.lpBurned).toBe(false)
    })

    it("should deduct 20 if top 10 holders > 50% (warning flag)", () => {
      const mockData = {
        mintable: { status: "0" },
        freezable: { status: "0" },
        holders: [
          { account: "a", percent: "0.15", is_locked: 0 },
          { account: "b", percent: "0.12", is_locked: 0 },
          { account: "c", percent: "0.10", is_locked: 0 },
          { account: "d", percent: "0.08", is_locked: 0 },
          { account: "e", percent: "0.06", is_locked: 0 }
        ],
        creators: [],
        metadata: { symbol: "RISKY" }
      }
      const result = calculateSecurityScore(mockData, "addr1234567890123456789012345678901")
      expect(result.score).toBe(80)
      expect(result.holderConcentrationRisk).toBe(true)
    })

    it("should deduct 15 if creator holds > 10%", () => {
      const mockData = {
        mintable: { status: "0" },
        freezable: { status: "0" },
        holders: [
          { account: "creator123", percent: "0.15", is_locked: 0 },
          { account: "user1", percent: "0.05", is_locked: 0 }
        ],
        creators: [{ address: "creator123" }],
        metadata: { symbol: "DEV" }
      }
      const result = calculateSecurityScore(mockData, "addr1234567890123456789012345678901")
      expect(result.score).toBe(85)
      expect(result.creatorBalanceRisk).toBe(true)
    })

    it("should stack warning deductions (holder + creator)", () => {
      const mockData = {
        mintable: { status: "0" },
        freezable: { status: "0" },
        holders: [
          { account: "creator123", percent: "0.30", is_locked: 0 },
          { account: "b", percent: "0.12", is_locked: 0 },
          { account: "c", percent: "0.10", is_locked: 0 }
        ],
        creators: [{ address: "creator123" }]
      }
      const result = calculateSecurityScore(mockData, "addr1234567890123456789012345678901")
      expect(result.score).toBe(65)
      expect(result.holderConcentrationRisk).toBe(true)
      expect(result.creatorBalanceRisk).toBe(true)
      expect(result.risk).toBe("medium")
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
