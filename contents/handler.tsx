import { Storage } from "@plasmohq/storage"
import { useStorage } from "@plasmohq/storage/hook"
import type { PlasmoCSConfig } from "plasmo"
import { useEffect, useState } from "react"
import { calculateSecurityScore, extractCAFromUrl, resolvePairAddress, shouldResetScanner } from "~lib/scanner-utils"
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

const ShieldIcon = (props: React.SVGProps<SVGSVGElement>) => (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}>
    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path>
  </svg>
)

const CheckCircleIcon = (props: React.SVGProps<SVGSVGElement>) => (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}>
    <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path>
    <polyline points="22 4 12 14.01 9 11.01"></polyline>
  </svg>
)

const AlertTriangleIcon = (props: React.SVGProps<SVGSVGElement>) => (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}>
    <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"></path>
    <line x1="12" y1="9" x2="12" y2="13"></line>
    <line x1="12" y1="17" x2="12.01" y2="17"></line>
  </svg>
)

const RefreshCwIcon = (props: React.SVGProps<SVGSVGElement>) => (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}>
    <polyline points="23 4 23 10 17 10"></polyline>
    <polyline points="1 20 1 14 7 14"></polyline>
    <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path>
  </svg>
)

const CloseIcon = (props: React.SVGProps<SVGSVGElement>) => (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}>
    <line x1="18" y1="6" x2="6" y2="18"></line>
    <line x1="6" y1="6" x2="18" y2="18"></line>
  </svg>
)

const LoaderIcon = (props: React.SVGProps<SVGSVGElement>) => (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="animate-spin" {...props}>
    <line x1="12" y1="2" x2="12" y2="6"></line>
    <line x1="12" y1="18" x2="12" y2="22"></line>
    <line x1="4.93" y1="4.93" x2="7.76" y2="7.76"></line>
    <line x1="16.24" y1="16.24" x2="19.07" y2="19.07"></line>
    <line x1="2" y1="12" x2="6" y2="12"></line>
    <line x1="18" y1="12" x2="22" y2="12"></line>
    <line x1="4.93" y1="19.07" x2="7.76" y2="16.24"></line>
    <line x1="16.24" y1="7.76" x2="19.07" y2="4.93"></line>
  </svg>
)

const Handler = () => {
  const [isOpen, setIsOpen] = useState(false)
  const [status, setStatus] = useState<"idle" | "scanning" | "done">("idle")
  const [ca, setCa] = useState("")
  const [currentUrl, setCurrentUrl] = useState(window.location.href)
  const [showBadge] = useStorage("show_badge", true)
  const [scanData, setScanData] = useState({ score: 100, mintable: false, freezable: false, ticker: "" })

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
        // Gunakan utility yang sudah teruji untuk menentukan apakah harus reset
        if (shouldResetScanner(currentUrl, newUrl)) {
          setStatus("idle")
          setIsOpen(false)
          setScanData({ score: 100, mintable: false, freezable: false, ticker: "" })
        }
        
        setCa(extractCAFromUrl(newUrl))
        setCurrentUrl(newUrl)
      }
    }

    const interval = setInterval(checkUrlChange, 1000)
    return () => clearInterval(interval)
  }, [currentUrl])

  const handleScan = async () => {
    if (status === "scanning") return

    const detectedCa = extractCA()
    setStatus("scanning")

    if (detectedCa) {
      try {
        let actualCa = detectedCa
        let res = await fetch(`https://api.gopluslabs.io/api/v1/solana/token_security?contract_addresses=${actualCa}`)
        let data = await res.json()

        // Jika API GoPlus me-return 7012 (Not spl token) atau 7013 (Address format error),
        // kemungkinan besar itu adalah Pair Address atau URL-nya membuat CA menjadi lowercase.
        if (data.code === 7012 || data.code === 7013) {
          actualCa = await resolvePairAddress(detectedCa)
          res = await fetch(`https://api.gopluslabs.io/api/v1/solana/token_security?contract_addresses=${actualCa}`)
          data = await res.json()
        }

        const tokenData = data.result ? Object.values(data.result)[0] as any : null
        const result = calculateSecurityScore(tokenData, actualCa)

        setCa(actualCa) // Pastikan state ca selalu berisi Token CA (bukan Pair) untuk Jupiter
        setScanData({
          score: result.score,
          mintable: result.mintable,
          freezable: result.freezable,
          ticker: result.ticker
        })

        // Persistence
        try {
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
        // Fallback UI jika terjadi error fatal
        setScanData({ score: 100, mintable: false, freezable: false })
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
                  <span className="text-slate-400 text-[11px] font-mono bg-slate-800/50 px-1.5 py-0.5 rounded">
                    {shortenedCA}
                  </span>
                </div>
              )}
              {isValidCA && (
                <div className="flex items-center gap-2 mt-2.5">
                  <span className={`px-2 py-1 rounded text-[10px] font-extrabold border flex items-center gap-1.5 tracking-widest uppercase transition-all duration-500 ${scanData.score >= 80 ? 'bg-success/10 text-success border-success/20' :
                      scanData.score >= 50 ? 'bg-warning/10 text-warning border-warning/20' :
                        'bg-red-500/10 text-red-500 border-red-500/20'
                    }`}>
                    {scanData.score >= 80 ? <ShieldIcon className="w-3 h-3" /> : <AlertTriangleIcon className="w-3 h-3" />}
                    {scanData.score >= 80 ? 'HIGH TRUST' : scanData.score >= 50 ? 'MEDIUM RISK' : 'DANGER'}
                  </span>
                  <span className="text-slate-500 text-[10px] font-bold uppercase tracking-widest opacity-60">v1.2 Live</span>
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
              <div className="flex justify-center mb-8 relative">
                <svg width="180" height="100" viewBox="0 0 160 90" className="overflow-visible">
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
                    style={{ filter: `drop-shadow(0 0 8px ${scanData.score >= 80 ? 'rgba(34,197,94,0.6)' : scanData.score >= 50 ? 'rgba(241,160,43,0.6)' : 'rgba(239,68,68,0.6)'})` }}
                  />
                </svg>
                <div className="absolute bottom-1 left-0 right-0 text-center flex flex-col items-center">
                  <span className="text-4xl font-bold text-white leading-none">{scanData.score}</span>
                  <span className="text-[10px] text-slate-400 font-bold tracking-widest mt-1">SAFETY SCORE</span>
                </div>
              </div>

              <div className="flex flex-col gap-2.5 mb-6">
                {[
                  {
                    label: scanData.mintable ? "Mint Authority Enabled" : "Mint Authority Disabled",
                    icon: scanData.mintable ? <AlertTriangleIcon className="w-5 h-5 text-red-500 drop-shadow-[0_0_5px_rgba(239,68,68,0.4)]" /> : <CheckCircleIcon className="w-5 h-5 text-success drop-shadow-[0_0_5px_rgba(34,197,94,0.4)]" />,
                    danger: scanData.mintable
                  },
                  {
                    label: scanData.freezable ? "Freezable Enabled" : "Not Freezable",
                    icon: scanData.freezable ? <AlertTriangleIcon className="w-5 h-5 text-red-500 drop-shadow-[0_0_5px_rgba(239,68,68,0.4)]" /> : <CheckCircleIcon className="w-5 h-5 text-success drop-shadow-[0_0_5px_rgba(34,197,94,0.4)]" />,
                    danger: scanData.freezable
                  }
                ].map((item, idx) => (
                  <div key={idx} className={`flex justify-between items-center bg-slate-800/50 rounded-xl p-3.5 border transition-colors ${item.danger ? 'border-red-500/30 bg-red-500/10' : 'border-slate-700/30'}`}>
                    <span className="text-sm text-slate-200 font-medium">{item.label}</span>
                    {item.icon}
                  </div>
                ))}
              </div>

              <button
                onClick={() => window.open(`https://jup.ag/swap?sell=${ca}&buy=EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v`, '_blank')}
                disabled={status === "scanning" || !isValidCA}
                className={`w-full font-bold py-3.5 rounded-xl flex justify-center items-center gap-2 transition-all ${status === "scanning" || !isValidCA
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
              <p className="text-slate-300 text-sm mb-6">
                We couldn't detect a valid Contract Address on this page. Please navigate to a specific token pair.
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
          {status === "scanning" ? <LoaderIcon className="w-4 h-4" /> : (status === "done" && !isValidCA ? <AlertTriangleIcon className="w-4 h-4" /> : <ShieldIcon className="w-4 h-4" />)}
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
