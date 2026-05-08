# Changelog

All notable changes to this project will be documented in this file.

## [v1.2.0] - 2026-05-07

### Added
- **Smart Caching**: Implemented client-side caching utilizing `@plasmohq/storage` with a rigid 5-minute Time-To-Live (TTL). This drastically reduces redundant network requests and prevents secondary rate-limiting from public APIs.
- **Graceful Degradation Logic**: Integrated `fetchWithTimeout` wrapper with an 8-second execution limit. The scoring engine now natively handles 500 Internal Server Errors and API timeouts, bypassing unresponsive providers (like GoPlus) to prevent the extension from hanging in a "Scanning..." state.
- **Pump.fun Dev Holding Penalty**: Added specific context-aware logic to penalize tokens originating from Pump.fun if the developer currently holds more than 3% of the total supply.
- **Unit Testing Suite**: Deployed comprehensive testing matrix covering edge cases, math bounds, and fallback conditions. System currently passes 28 distinct unit tests.

### Fixed
- **Race Conditions on Navigation**: Solved an issue where extremely fast URL transitions in SPAs resulted in "UI overwriting." Fixed by implementing a `scanIdRef` pointer using React's `useRef`, which aborts stale promises from resolving into the current state.
- **Null-Safety & Math Bounds**: Hardened the dual-engine scoring formula. Ensured `marketCap` is evaluated before calculating Liquidity Traps (preventing Division by Zero) and securely clamped the final return score to `Math.max(0, Math.min(100, score))`.
- **API Response Fallbacks**: Modified UI state to explicitly state "Data unavailable" instead of falsely flagging safety statuses when API streams fail or timeout.

### Changed
- **Advanced Risk Scoring Algorithm**: Refined the penalty thresholds. Added precise conditions for Sybil/Cluster detection (deducting 25 points if Top 10 clean holders > 40%) and Liquidity-to-Market Cap ratios.
- **Documentation**: Formatted codebase comments and JSDoc strings to professional open-source standards.
