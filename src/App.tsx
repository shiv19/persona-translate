import { useState, useCallback, useEffect, useRef } from "react"
import type { Screen, Persona, Message } from "./types"
import { uid } from "./types"
import { loadPersonas, savePersonas, loadMessages, deletePersona as removePersona } from "./storage"
import { PersonaList } from "./components/PersonaList"
import { PersonaForm } from "./components/PersonaForm"
import { TranslationChat } from "./components/TranslationChat"

export default function App() {
  const [screen, setScreen] = useState<Screen>(() => {
    try {
      const saved = sessionStorage.getItem("pt_screen")
      if (saved) return JSON.parse(saved)
    } catch {}
    return { view: "home" }
  })
  const [personas, setPersonas] = useState<Persona[]>(() => loadPersonas())
  const [, setTick] = useState(0)
  const pushing = useRef(false)

  const navigate = useCallback((next: Screen) => {
    pushing.current = true
    setScreen(next)
    window.history.pushState(next, "")
    sessionStorage.setItem("pt_screen", JSON.stringify(next))
    pushing.current = false
  }, [])

  useEffect(() => {
    window.history.replaceState(screen, "")

    function onPopState(e: PopStateEvent) {
      if (pushing.current) return
      const state = e.state as Screen | null
      if (state && state.view) {
        setScreen(state)
        sessionStorage.setItem("pt_screen", JSON.stringify(state))
      } else {
        setScreen({ view: "home" })
        sessionStorage.setItem("pt_screen", JSON.stringify({ view: "home" }))
      }
    }

    window.addEventListener("popstate", onPopState)
    return () => window.removeEventListener("popstate", onPopState)
  }, [])

  function refresh() {
    setPersonas(loadPersonas())
    setTick((t) => t + 1)
  }

  function handleCreatePersona(data: Omit<Persona, "id" | "createdAt">) {
    const persona: Persona = {
      ...data,
      id: uid(),
      createdAt: Date.now(),
    }
    const updated = [...personas, persona]
    savePersonas(updated)
    setPersonas(updated)
    navigate({ view: "chat", personaId: persona.id })
  }

  function handleUpdatePersona(personaId: string, data: Omit<Persona, "id" | "createdAt">) {
    const updated = personas.map((p) =>
      p.id === personaId ? { ...p, ...data } : p,
    )
    savePersonas(updated)
    setPersonas(updated)
    navigate({ view: "chat", personaId })
  }

  function handleDeletePersona(personaId: string) {
    removePersona(personaId)
    refresh()
  }

  function getPersona(id: string): Persona | undefined {
    return personas.find((p) => p.id === id)
  }

  function goHome() {
    refresh()
    navigate({ view: "home" })
  }

  if (screen.view === "home") {
    return (
      <PersonaList
        personas={personas}
        onSelect={(id) => navigate({ view: "chat", personaId: id })}
        onCreate={() => navigate({ view: "create-persona" })}
        onEdit={(id) => navigate({ view: "edit-persona", personaId: id })}
        onDelete={handleDeletePersona}
      />
    )
  }

  if (screen.view === "create-persona") {
    return (
      <PersonaForm
        onSave={handleCreatePersona}
        onCancel={() => navigate({ view: "home" })}
      />
    )
  }

  if (screen.view === "edit-persona") {
    const persona = getPersona(screen.personaId)
    if (!persona) {
      navigate({ view: "home" })
      return null
    }
    return (
      <PersonaForm
        persona={persona}
        onSave={(data) => handleUpdatePersona(screen.personaId, data)}
        onCancel={() => navigate({ view: "chat", personaId: screen.personaId })}
      />
    )
  }

  if (screen.view === "chat") {
    const persona = getPersona(screen.personaId)
    if (!persona) {
      navigate({ view: "home" })
      return null
    }
    return (
      <TranslationChat
        key={persona.id}
        persona={persona}
        onBack={goHome}
      />
    )
  }

  return null
}
