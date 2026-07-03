import { useSyncExternalStore, useCallback } from "react"

// Theme is driven by the `data-theme` attribute on <html>. The inline script in
// index.html sets it before first paint (no FOUC); this hook keeps React state
// in sync and persists the choice to localStorage. A custom event notifies all
// mounted toggles so they update together.
const THEME_KEY = "pt_theme"
type Theme = "light" | "dark"

function currentTheme(): Theme {
  return document.documentElement.getAttribute("data-theme") === "dark" ? "dark" : "light"
}

function subscribe(callback: () => void) {
  window.addEventListener("themechange", callback)
  return () => window.removeEventListener("themechange", callback)
}

function getSnapshot(): string {
  return document.documentElement.getAttribute("data-theme") === "dark" ? "dark" : "light"
}

// SSR guard — never runs in this app, but useSyncExternalStore needs a server snapshot.
function getServerSnapshot(): string {
  return "light"
}

/** Read the current theme reactively and get a setter that flips + persists it. */
export function useTheme() {
  const theme = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot) as Theme

  const toggleTheme = useCallback(() => {
    const next: Theme = currentTheme() === "dark" ? "light" : "dark"
    if (next === "dark") {
      document.documentElement.setAttribute("data-theme", "dark")
    } else {
      document.documentElement.removeAttribute("data-theme")
    }
    try {
      localStorage.setItem(THEME_KEY, next)
    } catch {}
    window.dispatchEvent(new Event("themechange"))
  }, [])

  return { theme, toggleTheme }
}
