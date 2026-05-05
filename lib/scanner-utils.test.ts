import { describe, expect, it } from "vitest"
import { calculateSecurityScore, extractCAFromUrl, shouldResetScanner } from "./scanner-utils"

describe("Scanner Utils", () => {
  describe("extractCAFromUrl", () => {
    it("should extract CA from DexScreener URL", () => {
      const url = "https://dexscreener.com/solana/3G3sHFsdQwHPAnJpN6Sy5oFEKfviGAjCc7NVPHgspump"
      expect(extractCAFromUrl(url)).toBe("3G3sHFsdQwHPAnJpN6Sy5oFEKfviGAjCc7NVPHgspump")
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
    it("should return 100 for safe token", () => {
      const mockData = {
        mintable: { status: "0" },
        freezable: { status: "0" },
        metadata: { symbol: "SAFE" }
      }
      const result = calculateSecurityScore(mockData, "addr123")
      expect(result.score).toBe(100)
      expect(result.risk).toBe("low")
    })

    it("should deduct 40 points if mintable", () => {
      const mockData = {
        mintable: { status: "1" },
        freezable: { status: "0" }
      }
      const result = calculateSecurityScore(mockData, "addr123")
      expect(result.score).toBe(60)
      expect(result.risk).toBe("medium")
    })

    it("should deduct 80 points if both mintable and freezable", () => {
      const mockData = {
        mintable: { status: "1" },
        freezable: { status: "1" }
      }
      const result = calculateSecurityScore(mockData, "addr123")
      expect(result.score).toBe(20)
      expect(result.risk).toBe("high")
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
