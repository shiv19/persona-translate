import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import App from "./App"
import "./index.css"

// iOS Safari/PWA: the keyboard overlays the layout viewport instead of resizing
// it, so track the visual viewport and expose it as --app-height.
if (window.visualViewport) {
  const syncHeight = () => {
    document.documentElement.style.setProperty(
      "--app-height",
      `${window.visualViewport!.height}px`,
    )
  }
  window.visualViewport.addEventListener("resize", syncHeight)
  syncHeight()
}

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("/sw.js").catch(() => {})
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
