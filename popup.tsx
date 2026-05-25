import { useState } from "react"
import { Shield, Zap, X, History } from "lucide-react"
import rugsentryLogo from "url:~assets/icon.png"
import { Storage } from "@plasmohq/storage"
import { useStorage } from "@plasmohq/storage/hook"
import "./style.css"

interface ScanHistory {
  id: string
  ticker: string
  logo?: string
  url?: string
  timestamp: string
  risk: "low" | "high" | "medium"
}

const localStorage = new Storage({ area: "local" })

function IndexPopup() {
  const [activeTab, setActiveTab] = useState<"scan" | "history">("scan")
  const [showBadge, setShowBadge] = useStorage("show_badge", true)
  const [history, setHistory] = useStorage<ScanHistory[]>(
    {
      key: "scan_history",
      instance: localStorage
    },
    []
  )

  const handleClearHistory = () => {
    setHistory([])
  }

  const handleRescan = (url?: string) => {
    if (url) {
      chrome.tabs.create({ url })
    }
  }

  return (
    <div className="w-[350px] h-[500px] bg-neutral text-slate-200 flex flex-col font-sans">
      {/* Header */}
      <div className="flex items-center justify-between p-4 pb-2">
        <div className="flex items-center gap-2">
          <div className="bg-primary/10 p-1 rounded-lg">
            <img src={rugsentryLogo} className="w-7 h-7 object-contain" alt="Logo" />
          </div>
          <h1 className="text-white font-bold text-base">Rugsentry Home</h1>
        </div>
        <button
          onClick={() => window.close()}
          className="text-slate-400 hover:text-white transition-colors"
        >
          <X className="w-5 h-5" />
        </button>
      </div>

      {/* Tab Content */}
      {activeTab === "scan" && (
        <>
          {/* UI Settings */}
          <div className="mx-4 my-2 p-3.5 bg-slate-800/40 rounded-xl flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Zap className="w-5 h-5 text-success fill-success/20" />
              <div>
                <h2 className="text-sm font-semibold text-slate-200">Floating Badge</h2>
                <p className="text-xs text-slate-500">Show shield on DEX pages</p>
              </div>
            </div>
            <label className="relative inline-flex items-center cursor-pointer">
              <input
                type="checkbox"
                className="sr-only peer"
                checked={showBadge}
                onChange={(e) => setShowBadge(e.target.checked)}
              />
              <div className="w-10 h-5 bg-slate-600 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-success"></div>
            </label>
          </div>

          {/* Recent Scans History */}
          <div className="flex-1 overflow-y-auto px-4 mt-3 pb-4">
            <h3 className="text-[10px] font-bold text-slate-500 mb-3 uppercase tracking-widest">
              RECENT SCANS
            </h3>

            {(history || []).length > 0 ? (
              <div className="space-y-2">
                {(history || []).slice(0, 3).map((item) => (
                  <div
                    key={item.id}
                    className="flex items-center justify-between p-3 bg-slate-800/30 rounded-xl border border-slate-700/30 hover:bg-slate-800/50 transition-colors"
                  >
                    <div className="flex items-center gap-3">
                      {/* Logo Token */}
                      <div className="w-8 h-8 rounded-full bg-slate-900 flex items-center justify-center overflow-hidden border border-slate-700/50">
                        {item.logo ? (
                          <img src={item.logo} className="w-full h-full object-cover" alt={item.ticker} />
                        ) : (
                          <div className="text-xs font-bold text-primary">
                            {item.ticker.charAt(0)}
                          </div>
                        )}
                      </div>
                      <div>
                        <div className="flex items-center gap-1.5">
                          {/* Nama/Ticker */}
                          <span className="text-sm font-bold text-slate-200">
                            {item.ticker}
                          </span>
                          {/* Indikator Risiko */}
                          <span
                            className={`w-1.5 h-1.5 rounded-full ${item.risk === "low" ? "bg-success" : "bg-red-500"
                              }`}
                          ></span>
                        </div>
                        {/* Timestamp */}
                        <div className="text-[10px] font-medium text-slate-500">
                          {item.timestamp}
                        </div>
                      </div>
                    </div>
                    {/* Tombol Re-scan */}
                    <button
                      onClick={() => handleRescan(item.url)}
                      className="px-3 py-1.5 text-xs font-medium text-primary border border-primary/20 rounded-lg hover:bg-primary/10 transition-colors"
                    >
                      Re-scan
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              /* Empty State */
              <div className="flex flex-col items-center justify-center py-8 text-center px-4">
                <div className="w-12 h-12 rounded-full bg-slate-800/50 flex items-center justify-center mb-3">
                  <History className="w-6 h-6 text-slate-500" />
                </div>
                <p className="text-sm text-slate-400">
                  No recent scans. Start exploring tokens on DexScreener to see results here!
                </p>
              </div>
            )}
          </div>
        </>
      )}

      {activeTab === "history" && (
        <div className="flex-1 overflow-y-auto px-4 mt-2 pb-4">
          <div className="flex justify-between items-center mb-3">
            <h3 className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">
              FULL HISTORY
            </h3>
            {(history || []).length > 0 && (
              <button
                onClick={handleClearHistory}
                className="text-[10px] font-bold text-red-500/80 hover:text-red-400 transition-colors uppercase tracking-widest"
              >
                Clear All
              </button>
            )}
          </div>
          {(history || []).length > 0 ? (
            <div className="space-y-2">
              {(history || []).map((item) => (
                <div
                  key={item.id}
                  className="flex items-center justify-between p-3 bg-slate-800/30 rounded-xl border border-slate-700/30 hover:bg-slate-800/50 transition-colors"
                >
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-full bg-slate-900 flex items-center justify-center overflow-hidden border border-slate-700/50">
                      {item.logo ? (
                        <img src={item.logo} className="w-full h-full object-cover" alt={item.ticker} />
                      ) : (
                        <div className="text-xs font-bold text-primary">
                          {item.ticker.charAt(0)}
                        </div>
                      )}
                    </div>
                    <div>
                      <div className="flex items-center gap-1.5">
                        <span className="text-sm font-bold text-slate-200">{item.ticker}</span>
                        <span className={`w-1.5 h-1.5 rounded-full ${item.risk === "low" ? "bg-success" : "bg-red-500"}`}></span>
                      </div>
                      <div className="text-[10px] font-medium text-slate-500">{item.timestamp}</div>
                    </div>
                  </div>
                  <button
                    onClick={() => handleRescan(item.url)}
                    className="px-3 py-1.5 text-xs font-medium text-primary border border-primary/20 rounded-lg hover:bg-primary/10 transition-colors"
                  >
                    Re-scan
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center py-12 text-center px-4">
              <div className="w-12 h-12 rounded-full bg-slate-800/50 flex items-center justify-center mb-3">
                <History className="w-6 h-6 text-slate-500" />
              </div>
              <p className="text-sm text-slate-400">Your history is completely empty.</p>
            </div>
          )}
        </div>
      )}


      {/* Navigation */}
      <div className="mt-auto border-t border-slate-800 bg-neutral py-2 flex justify-around rounded-b-xl">
        <button
          onClick={() => setActiveTab("scan")}
          className={`flex-1 flex flex-col items-center gap-1 p-2 transition-colors ${activeTab === "scan" ? "text-primary" : "text-slate-500 hover:text-slate-300"}`}
        >
          <Shield className={`w-5 h-5 ${activeTab === "scan" ? "fill-current/20" : ""}`} />
          <span className="text-[9px] font-bold tracking-wider">SCAN</span>
        </button>
        <button
          onClick={() => setActiveTab("history")}
          className={`flex-1 flex flex-col items-center gap-1 p-2 transition-colors ${activeTab === "history" ? "text-primary" : "text-slate-500 hover:text-slate-300"}`}
        >
          <History className={`w-5 h-5 ${activeTab === "history" ? "fill-current/20" : ""}`} />
          <span className="text-[9px] font-bold tracking-wider">HISTORY</span>
        </button>
      </div>
    </div>
  )
}

export default IndexPopup
