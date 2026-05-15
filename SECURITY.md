# Security Policy

## Our Philosophy
Security is at the heart of Rugsentry. As an open-source tool, we believe in radical transparency and community-driven verification.

## 🛡️ The Dual-Engine Logic
Rugsentry doesn't just "guess." It uses a hard-coded mathematical engine that cross-references data from multiple providers:
1.  **Contract Audit Layer**: Powered by GoPlus Security to detect hidden mint functions and freeze authorities.
2.  **Liquidity & Holder Layer**: Powered by RugCheck to verify liquidity locks and developer holdings.
3.  **Market Context Layer**: Powered by DexScreener to detect "Liquidity Traps" (low liquidity vs market cap).

## ✅ Verification & Testing
Our security engine is strictly tested against historical rugpull data and edge cases.
*   **Unit Tests**: The core logic currently passes **28 automated unit tests** covering mathematical overflows, API failure fallbacks, and risk stacking.
*   **Open Source**: Every line of our scoring logic is public. You can audit our engine [here](./lib/scanner-utils.ts).
*   **No Data Collection**: Rugsentry is a "zero-knowledge" extension. We do not track your wallet, your trades, or your personal information.

## 🛠️ Reliability Features
*   **Graceful Degradation**: If one API provider fails or times out (8s limit), Rugsentry bypasses that layer instead of giving a false score.
*   **Race Condition Protection**: Using unique scan IDs to ensure results from old pages never overwrite your current token scan.

## 🤝 Reporting a Vulnerability
If you discover a security vulnerability within Rugsentry, please help us keep the community safe. 
*   **GitHub Issues**: For non-sensitive bugs, please open an [Issue](https://github.com/KevinFalah/rugsentry-extension/issues).
*   **Privacy**: For sensitive vulnerabilities, please contact the developer directly via GitHub profile details.

**Disclaimer**: Rugsentry is a tool to help you stay safe, but it cannot prevent all scams. Always do your own research (DYOR).
