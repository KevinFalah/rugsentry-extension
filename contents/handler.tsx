import { Storage } from "@plasmohq/storage"
import { useStorage } from "@plasmohq/storage/hook"
import type { PlasmoCSConfig } from "plasmo"
import { useEffect, useRef, useState } from "react"
import type { RugCheckRisk } from "~lib/scanner-utils"
import { calculateSecurityScore, extractCAFromUrl, fetchDexScreenerMarket, fetchRugCheckReport, resolvePairAddress, shouldResetScanner, fetchWithTimeout } from "~lib/scanner-utils"
import rugsentryLogo from "data-base64:~assets/icon.png"
import { AlertTriangleIcon, CheckCircleIcon, CloseIcon, CopyIcon, LoaderIcon, RefreshCwIcon } from "./Icons"
export { getStyle } from "./style"

const storage = new Storage({
  area: "local"
})

export const config: PlasmoCSConfig = {
  matches: [
    "https://*.dexscreener.com/*",
    "https://*.birdeye.so/*",
    "https://*.pump.fun/*"
  ]
}


const Handler = () => {
  const [isOpen, setIsOpen] = useState(false)
  const [status, setStatus] = useState<"idle" | "scanning" | "done">("idle")
  const [ca, setCa] = useState("")
  const [currentUrl, setCurrentUrl] = useState(window.location.href)
  const [copied, setCopied] = useState(false)
  const scanIdRef = useRef(0) // Race condition guard
  const [isCached, setIsCached] = useState(false)
  const [showBadge] = useStorage("show_badge", true)
  const [scanData, setScanData] = useState<{
    score: number, mintable: boolean, freezable: boolean,
    risks: RugCheckRisk[], rugCheckFailed: boolean, goPlusFailed: boolean, liquidityUsd: number | null, priceChange1h: number | null,
    thinLiquidityRisk: boolean, highConcentrationRisk: boolean, highDevHoldingRisk: boolean, ticker: string
  }>({ score: 100, mintable: false, freezable: false, risks: [], rugCheckFailed: false, goPlusFailed: false, liquidityUsd: null, priceChange1h: null, thinLiquidityRisk: false, highConcentrationRisk: false, highDevHoldingRisk: false, ticker: "" })

  const CACHE_TTL = 300000 // 5 minutes

  // Function to extract CA from URL
  const extractCA = () => {
    const url = window.location.href
    const detectedCa = extractCAFromUrl(url)
    setCa(detectedCa)
    return detectedCa
  }

  // Auto-reset logic when navigating in SPAs (DexScreener, Birdeye, etc.)
  useEffect(() => {
    const checkUrlChange = () => {
      const newUrl = window.location.href
      if (newUrl !== currentUrl) {
        // Use a proven utility to determine if a reset is required
        if (shouldResetScanner(currentUrl, newUrl)) {
          setStatus("idle")
          setIsOpen(false)
          setScanData({ score: 100, mintable: false, freezable: false, risks: [], rugCheckFailed: false, goPlusFailed: false, liquidityUsd: null, priceChange1h: null, thinLiquidityRisk: false, highConcentrationRisk: false, highDevHoldingRisk: false, ticker: "" })
          setIsCached(false)
        }

        setCa(extractCAFromUrl(newUrl))
        setCurrentUrl(newUrl)
      }
    }

    const interval = setInterval(checkUrlChange, 1000)
    return () => clearInterval(interval)
  }, [currentUrl])

  const handleCopy = () => {
    if (!ca) return
    navigator.clipboard.writeText(ca)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const handleScan = async () => {
    if (status === "scanning") return

    const detectedCa = extractCA()
    setStatus("scanning")
    setIsCached(false)
    const currentScanId = ++scanIdRef.current

    if (detectedCa) {
      try {
        // Step 1: Resolve CA if it is a Pair Address
        let actualCa = detectedCa
        let res = await fetchWithTimeout(`https://api.gopluslabs.io/api/v1/solana/token_security?contract_addresses=${actualCa}`)
        let data = await res.json()

        if (data.code === 7012 || data.code === 7013) {
          actualCa = await resolvePairAddress(detectedCa)
          res = await fetchWithTimeout(`https://api.gopluslabs.io/api/v1/solana/token_security?contract_addresses=${actualCa}`)
          data = await res.json()
        }

        if (scanIdRef.current !== currentScanId) return

        // Step 2: Check cache (5-minute TTL)
        const CACHE_KEY = `scan_cache_${actualCa}`
        try {
          const cached = await storage.get<{ data: any, timestamp: number }>(CACHE_KEY)
          if (cached && (Date.now() - cached.timestamp < CACHE_TTL)) {
            setCa(actualCa)
            setScanData(cached.data)
            setIsCached(true)
            setStatus("done")
            setIsOpen(true)
            return;
          }
        } catch (e) {
          console.error("Cache read error:", e)
        }

        const goPlusData = data.result ? Object.values(data.result)[0] as any : null

        // Step 3: Fetch RugCheck + DexScreener in PARALLEL
        const [rugCheckResult, dexResult] = await Promise.allSettled([
          fetchRugCheckReport(actualCa),
          fetchDexScreenerMarket(actualCa)
        ])

        const rugCheckData = rugCheckResult.status === 'fulfilled' ? rugCheckResult.value : null
        const dexData = dexResult.status === 'fulfilled' ? dexResult.value : null

        // Step 4: Calculate combined security score from 3 sources
        const result = calculateSecurityScore(goPlusData, rugCheckData, dexData, actualCa)

        if (scanIdRef.current !== currentScanId) return

        const scanDataPayload = {
          score: result.score,
          mintable: result.mintable,
          freezable: result.freezable,
          risks: result.risks,
          rugCheckFailed: result.rugCheckFailed,
          goPlusFailed: result.goPlusFailed,
          liquidityUsd: result.liquidityUsd,
          priceChange1h: result.priceChange1h,
          thinLiquidityRisk: result.thinLiquidityRisk,
          highConcentrationRisk: result.highConcentrationRisk,
          highDevHoldingRisk: result.highDevHoldingRisk,
          ticker: result.ticker
        }

        setCa(actualCa)
        setScanData(scanDataPayload)

        // Step 5: Save to cache and history
        try {
          await storage.set(CACHE_KEY, { data: scanDataPayload, timestamp: Date.now() })

          const scanResult = {
            id: Date.now().toString(),
            ticker: result.ticker,
            ca: actualCa,
            url: window.location.href,
            score: result.score,
            timestamp: "Just now",
            risk: result.risk,
            network: window.location.hostname
          }

          const history = await storage.get<any[]>("scan_history") || []
          await storage.set("scan_history", [scanResult, ...history].slice(0, 10))
        } catch (e) {
          console.error("Storage error:", e)
        }
      } catch (e) {
        console.error("Scan error:", e)
        setScanData({ score: 100, mintable: false, freezable: false, risks: [], rugCheckFailed: false, goPlusFailed: false, liquidityUsd: null, priceChange1h: null, thinLiquidityRisk: false, highConcentrationRisk: false, highDevHoldingRisk: false, ticker: "" })
      }
    }

    setStatus("done")
    setIsOpen(true)
  }

  const isValidCA = ca !== ""
  const shortenedCA = isValidCA && ca.length > 10 ? `${ca.slice(0, 6)}...${ca.slice(-4)}` : ca

  if (!showBadge) return null

  return (
    <div className="fixed bottom-6 right-6 z-[2147483647] font-sans">
      {isOpen && status === "done" && (
        <div className="absolute bottom-16 right-0 w-[340px] bg-neutral/85 backdrop-blur-xl border border-slate-700/50 rounded-2xl p-6 shadow-2xl overflow-hidden mb-4 transform origin-bottom-right transition-all duration-300 ease-out animate-in slide-in-from-bottom-4">
          <div className={`absolute left-0 top-0 bottom-0 w-1.5 ${isValidCA ? 'bg-success shadow-[0_0_10px_#22C55E]' : 'bg-warning shadow-[0_0_10px_#F1A02B]'}`}></div>

          <div className="flex justify-between items-start mb-6">
            <div className="flex flex-col gap-0.5">
              <h2 className="text-white font-bold text-xl tracking-tight leading-tight">
                {isValidCA ? (scanData.ticker || "Unknown Token") : "Token Not Found"}
              </h2>
              {isValidCA && (
                <div className="flex items-center gap-2">
                  <button
                    onClick={handleCopy}
                    className="group flex items-center gap-1.5 text-slate-400 hover:text-primary transition-colors bg-slate-800/50 hover:bg-primary/10 px-1.5 py-0.5 rounded border border-transparent hover:border-primary/20"
                    title="Click to copy CA"
                  >
                    <span className="text-[11px] font-mono leading-none">
                      {shortenedCA}
                    </span>
                    {copied ? (
                      <CheckCircleIcon className="w-3 h-3 text-success animate-in zoom-in duration-300" />
                    ) : (
                      <CopyIcon className="w-2.5 h-2.5 opacity-40 group-hover:opacity-100 transition-opacity" />
                    )}
                  </button>
                  {copied && (
                    <span className="text-[10px] text-success font-bold animate-in fade-in slide-in-from-left-1 duration-300">
                      Copied!
                    </span>
                  )}
                </div>
              )}
              {isValidCA && (
                <div className="flex items-center gap-2 mt-2.5">
                  <span className={`px-2 py-1 rounded text-[10px] font-extrabold border flex items-center gap-1.5 tracking-widest uppercase transition-all duration-500 ${scanData.score >= 80 ? 'bg-success/10 text-success border-success/20' :
                    scanData.score >= 50 ? 'bg-warning/10 text-warning border-warning/20' :
                      'bg-red-500/10 text-red-500 border-red-500/20'
                    }`}>
                    {scanData.score >= 80 ? <img src={rugsentryLogo} className="w-3.5 h-3.5 object-contain" alt="Logo" /> : <AlertTriangleIcon className="w-3 h-3" />}
                    {scanData.score >= 80 ? 'HIGH TRUST' : scanData.score >= 50 ? 'MEDIUM RISK' : 'DANGER'}
                  </span>
                  <span className="text-slate-500 text-[10px] font-bold uppercase tracking-widest opacity-60">{isCached ? 'Cached' : 'v1.2 Live'}</span>
                </div>
              )}
            </div>
            <div className="flex gap-3">
              {isValidCA && (
                <button onClick={handleScan} className="text-slate-500 hover:text-primary transition-colors" title="Rescan Current Page">
                  <RefreshCwIcon className="w-5 h-5" />
                </button>
              )}
              <button onClick={() => setIsOpen(false)} className="text-slate-500 hover:text-white transition-colors">
                <CloseIcon className="w-5 h-5" />
              </button>
            </div>
          </div>

          {isValidCA ? (
            <>
              <div className="flex justify-center mb-5 relative">
                <svg width="160" height="90" viewBox="0 0 160 90" className="overflow-visible">
                  <path d="M 10 80 A 70 70 0 0 1 150 80" fill="none" stroke="#1e293b" strokeWidth="12" strokeLinecap="round" />
                  <path
                    d="M 10 80 A 70 70 0 0 1 150 80"
                    fill="none"
                    stroke={scanData.score >= 80 ? "#22C55E" : scanData.score >= 50 ? "#F1A02B" : "#EF4444"}
                    strokeWidth="12"
                    strokeLinecap="round"
                    strokeDasharray="220"
                    strokeDashoffset={220 - (220 * scanData.score / 100)}
                    className="transition-all duration-1000 ease-out"
                    style={{ filter: `drop-shadow(0 0 6px ${scanData.score >= 80 ? 'rgba(34,197,94,0.5)' : scanData.score >= 50 ? 'rgba(241,160,43,0.5)' : 'rgba(239,68,68,0.5)'})` }}
                  />
                </svg>
                <div className="absolute bottom-1 left-0 right-0 text-center flex flex-col items-center">
                  <span className="text-3xl font-bold text-white leading-none">{scanData.score}</span>
                  <span className="text-[9px] text-slate-400 font-bold tracking-widest mt-1">SAFETY SCORE</span>
                </div>
              </div>

              <div className="flex flex-col gap-2 mb-5">
                {/* GoPlus Contract Security */}
                {scanData.goPlusFailed ? (
                  <div className="flex justify-between items-center bg-slate-800/40 rounded-lg px-3 py-2.5 border border-slate-700/40">
                    <span className="text-xs text-slate-400 font-medium italic">GoPlus: Data unavailable</span>
                    <AlertTriangleIcon className="w-4 h-4 text-slate-500 drop-shadow-[0_0_3px_rgba(100,116,139,0.4)]" />
                  </div>
                ) : (
                  <>
                    <div className={`flex justify-between items-center bg-slate-800/40 rounded-lg px-3 py-2.5 border transition-colors ${scanData.mintable ? 'border-red-500/30 bg-red-500/10' : 'border-slate-700/40'}`}>
                      <span className="text-xs text-slate-200 font-medium">{scanData.mintable ? "Mint Authority Enabled" : "Mint Authority Revoked"}</span>
                      {scanData.mintable ? <AlertTriangleIcon className="w-4 h-4 text-red-500 drop-shadow-[0_0_3px_rgba(239,68,68,0.4)]" /> : <CheckCircleIcon className="w-4 h-4 text-success drop-shadow-[0_0_3px_rgba(34,197,94,0.4)]" />}
                    </div>
                    <div className={`flex justify-between items-center bg-slate-800/40 rounded-lg px-3 py-2.5 border transition-colors ${scanData.freezable ? 'border-red-500/30 bg-red-500/10' : 'border-slate-700/40'}`}>
                      <span className="text-xs text-slate-200 font-medium">{scanData.freezable ? "Freeze Authority Enabled" : "Not Freezable"}</span>
                      {scanData.freezable ? <AlertTriangleIcon className="w-4 h-4 text-red-500 drop-shadow-[0_0_3px_rgba(239,68,68,0.4)]" /> : <CheckCircleIcon className="w-4 h-4 text-success drop-shadow-[0_0_3px_rgba(34,197,94,0.4)]" />}
                    </div>
                  </>
                )}

                {/* RugCheck Risks */}
                {scanData.rugCheckFailed ? (
                  <div className="flex justify-between items-center bg-slate-800/40 rounded-lg px-3 py-2.5 border border-slate-700/40">
                    <span className="text-xs text-slate-400 font-medium italic">RugCheck: Data unavailable</span>
                    <AlertTriangleIcon className="w-4 h-4 text-slate-500 drop-shadow-[0_0_3px_rgba(100,116,139,0.4)]" />
                  </div>
                ) : scanData.risks.length > 0 ? (
                  scanData.risks.map((risk, idx) => (
                    <div key={`rc-${idx}`} className={`flex justify-between items-center bg-slate-800/40 rounded-lg px-3 py-2.5 border transition-colors ${risk.level === 'danger' ? 'border-red-500/30 bg-red-500/10' : risk.level === 'warn' ? 'border-yellow-500/30 bg-yellow-500/5' : 'border-slate-700/40'}`}>
                      <span className="text-xs text-slate-200 font-medium">
                        {risk.name}{risk.value ? ` (${risk.value})` : ''}
                      </span>
                      {risk.level === 'danger' ? <AlertTriangleIcon className="w-4 h-4 text-red-500 drop-shadow-[0_0_3px_rgba(239,68,68,0.4)]" /> :
                        risk.level === 'warn' ? <AlertTriangleIcon className="w-4 h-4 text-yellow-500 drop-shadow-[0_0_3px_rgba(234,179,8,0.4)]" /> :
                          <CheckCircleIcon className="w-4 h-4 text-success drop-shadow-[0_0_3px_rgba(34,197,94,0.4)]" />}
                    </div>
                  ))
                ) : (
                  <div className="flex justify-between items-center bg-slate-800/40 rounded-lg px-3 py-2.5 border border-slate-700/40">
                    <span className="text-xs text-slate-200 font-medium">RugCheck: No issues found</span>
                    <CheckCircleIcon className="w-4 h-4 text-success drop-shadow-[0_0_3px_rgba(34,197,94,0.4)]" />
                  </div>
                )}

                {/* DexScreener Liquidity & Holder Penalties */}
                {scanData.highDevHoldingRisk && (
                  <div className="flex justify-between items-center bg-red-500/10 rounded-lg px-3 py-2.5 border border-red-500/30 transition-colors">
                    <span className="text-xs text-slate-200 font-medium">Dev Holding &gt; 3% (Pump.fun)</span>
                    <AlertTriangleIcon className="w-4 h-4 text-red-500 drop-shadow-[0_0_3px_rgba(239,68,68,0.4)]" />
                  </div>
                )}
                {scanData.highConcentrationRisk && (
                  <div className="flex justify-between items-center bg-yellow-500/5 rounded-lg px-3 py-2.5 border border-yellow-500/30 transition-colors">
                    <span className="text-xs text-slate-200 font-medium">High Top 10 Concentration (&gt;40%)</span>
                    <AlertTriangleIcon className="w-4 h-4 text-yellow-500 drop-shadow-[0_0_3px_rgba(234,179,8,0.4)]" />
                  </div>
                )}
                {scanData.thinLiquidityRisk && (
                  <div className="flex justify-between items-center bg-red-500/10 rounded-lg px-3 py-2.5 border border-red-500/30 transition-colors">
                    <span className="text-xs text-slate-200 font-medium">Extremely Thin Liquidity (Ratio &lt; 2%)</span>
                    <AlertTriangleIcon className="w-4 h-4 text-red-500 drop-shadow-[0_0_3px_rgba(239,68,68,0.4)]" />
                  </div>
                )}
                {scanData.priceChange1h !== null && scanData.priceChange1h < -50 && (
                  <div className="flex justify-between items-center bg-yellow-500/5 rounded-lg px-3 py-2.5 border border-yellow-500/30 transition-colors">
                    <span className="text-xs text-slate-200 font-medium">Massive 1H Price Dump ({scanData.priceChange1h}%)</span>
                    <AlertTriangleIcon className="w-4 h-4 text-yellow-500 drop-shadow-[0_0_3px_rgba(234,179,8,0.4)]" />
                  </div>
                )}
                {scanData.liquidityUsd !== null && !scanData.thinLiquidityRisk && (
                  <div className={`flex justify-between items-center bg-slate-800/40 rounded-lg px-3 py-2.5 border transition-colors ${scanData.liquidityUsd < 5000 ? 'border-yellow-500/30 bg-yellow-500/5' : 'border-slate-700/40'}`}>
                    <span className="text-xs text-slate-200 font-medium">
                      Liquidity: ${scanData.liquidityUsd < 1000 ? scanData.liquidityUsd.toFixed(0) : (scanData.liquidityUsd / 1000).toFixed(1) + 'K'}
                    </span>
                    {scanData.liquidityUsd < 5000 ? <AlertTriangleIcon className="w-4 h-4 text-yellow-500 drop-shadow-[0_0_3px_rgba(234,179,8,0.4)]" /> : <CheckCircleIcon className="w-4 h-4 text-success drop-shadow-[0_0_3px_rgba(34,197,94,0.4)]" />}
                  </div>
                )}
              </div>

              <button
                onClick={() => window.open(`https://jup.ag/swap?sell=${ca}&buy=EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v`, '_blank')}
                disabled={status === "scanning" || !isValidCA}
                className={`w-full font-bold py-3 rounded-xl flex justify-center items-center gap-2 transition-all ${status === "scanning" || !isValidCA
                  ? "bg-slate-700 text-slate-500 cursor-not-allowed"
                  : "bg-primary hover:bg-primary/90 text-neutral shadow-[0_0_15px_rgba(56,189,248,0.4)] hover:shadow-[0_0_20px_rgba(56,189,248,0.6)]"
                  }`}
              >
                <RefreshCwIcon className="w-5 h-5" />
                Emergency Cashout (USDC)
              </button>
            </>
          ) : (
            <div className="flex flex-col items-center text-center pb-2">
              <div className="bg-warning/10 p-4 rounded-full mb-4">
                <AlertTriangleIcon className="w-10 h-10 text-warning" />
              </div>
              <p className="text-slate-300 text-sm mb-2">
                We couldn't detect a valid token address on this page.
              </p>
              <p className="text-slate-400 text-xs mb-6 px-2">
                Note: Rugsentry currently only supports the <strong className="text-[#14F195] font-semibold">Solana Network</strong>. Please navigate to a Solana token pair.
              </p>
              <button onClick={handleScan} className="w-full bg-slate-800 hover:bg-slate-700 text-white font-bold py-3.5 rounded-xl flex justify-center items-center gap-2 border border-slate-600 transition-all">
                <RefreshCwIcon className="w-5 h-5" />
                Scan Current Page
              </button>
            </div>
          )}
        </div>
      )}

      {/* Floating Badge */}
      <button
        onClick={status === "done" ? () => setIsOpen(!isOpen) : handleScan}
        disabled={status === "scanning"}
        className={`flex items-center gap-3 bg-neutral/90 backdrop-blur-md border px-5 py-2.5 rounded-full shadow-[0_4px_20px_rgba(0,0,0,0.5)] transition-all group ${status === "scanning" ? "border-primary shadow-[0_0_15px_rgba(56,189,248,0.3)]" :
          status === "done" ? (isValidCA ? "border-success hover:border-success" : "border-warning hover:border-warning") : "border-slate-600 hover:border-slate-400"
          }`}
      >
        <div className={`p-1.5 rounded-full transition-colors ${status === "scanning" ? "bg-primary/20 text-primary shadow-[0_0_10px_rgba(56,189,248,0.4)]" :
          status === "done" ? (isValidCA ? "bg-success/20 text-success shadow-[0_0_10px_rgba(34,197,94,0.4)]" : "bg-warning/20 text-warning shadow-[0_0_10px_rgba(241,160,43,0.4)]") : "bg-slate-700 text-slate-400"
          }`}>
          {status === "scanning" ? <LoaderIcon className="w-4 h-4" /> : (status === "done" && !isValidCA ? <AlertTriangleIcon className="w-4 h-4" /> : <img src={rugsentryLogo} className="w-5 h-5 object-contain" alt="Logo" />)}
        </div>
        <div className="flex flex-col items-start leading-tight">
          <span className="text-[9px] text-slate-400 font-bold uppercase tracking-widest">
            {status === "scanning" ? "Analyzing CA..." : status === "done" ? (isValidCA ? "Security Score" : "Status") : "Rugsentry"}
          </span>
          <span className="text-sm text-white font-bold">
            {status === "scanning" ? "Scanning..." : status === "done" ? (isValidCA ? <>{scanData.score}<span className="text-slate-500 text-xs font-normal">/100</span></> : "No Token") : "Scan Token"}
          </span>
        </div>
      </button>
    </div>
  )
}

export default Handler
