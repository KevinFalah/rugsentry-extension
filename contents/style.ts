import type { PlasmoCSConfig } from "plasmo"
import styleText from "data-text:~/style.css"

export const config: PlasmoCSConfig = {
  matches: [
    "https://*.dexscreener.com/*",
    "https://*.birdeye.so/*",
    "https://*.pump.fun/*"
  ]
}

export const getStyle = () => {
  const style = document.createElement("style")
  style.textContent = styleText
  return style
}
