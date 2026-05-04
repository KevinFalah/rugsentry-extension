import { describe, expect, it } from "vitest"
import { calculateSecurityScore, extractCAFromUrl } from "./scanner-utils"

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
})
