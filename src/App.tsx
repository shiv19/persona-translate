import { useState } from "react"
import type { Screen, Persona, Message } from "./types"
import { loadPersonas, savePersonas, loadMessages, deletePersona as removePersona } from "./storage"
import { PersonaList } from "./components/PersonaList"
import { PersonaForm } from "./components/PersonaForm"
import { TranslationChat } from "./components/TranslationChat"

export default function App() {
  const [screen, setScreen] = useState<Screen>({ view: "home" })
  const [personas, setPersonas] = useState<Persona[]>(() => loadPersonas())
  const [, setTick] = useState(0)

  function refresh() {
    setPersonas(loadPersonas())
    setTick((t) => t + 1)
  }

  function handleCreatePersona(data: Omit<Persona, "id" | "createdAt">) {
    const persona: Persona = {
      ...data,
      id: crypto.randomUUID(),
      createdAt: Date.now(),
    }
    const updated = [...personas, persona]
    savePersonas(updated)
    setPersonas(updated)
    setScreen({ view: "chat", personaId: persona.id })
  }

  function handleUpdatePersona(personaId: string, data: Omit<Persona, "id" | "createdAt">) {
    const updated = personas.map((p) =>
      p.id === personaId ? { ...p, ...data } : p,
    )
    savePersonas(updated)
    setPersonas(updated)
    setScreen({ view: "chat", personaId })
  }

  function handleDeletePersona(personaId: string) {
    removePersona(personaId)
    refresh()
  }

  function getPersona(id: string): Persona | undefined {
    return personas.find((p) => p.id === id)
  }

  if (screen.view === "home") {
    return (
      <PersonaList
        personas={personas}
        onSelect={(id) => setScreen({ view: "chat", personaId: id })}
        onCreate={() => setScreen({ view: "create-persona" })}
        onEdit={(id) => setScreen({ view: "edit-persona", personaId: id })}
        onDelete={handleDeletePersona}
      />
    )
  }

  if (screen.view === "create-persona") {
    return (
      <PersonaForm
        onSave={handleCreatePersona}
        onCancel={() => setScreen({ view: "home" })}
      />
    )
  }

  if (screen.view === "edit-persona") {
    const persona = getPersona(screen.personaId)
    if (!persona) {
      setScreen({ view: "home" })
      return null
    }
    return (
      <PersonaForm
        persona={persona}
        onSave={(data) => handleUpdatePersona(screen.personaId, data)}
        onCancel={() => setScreen({ view: "chat", personaId: screen.personaId })}
      />
    )
  }

  if (screen.view === "chat") {
    const persona = getPersona(screen.personaId)
    if (!persona) {
      setScreen({ view: "home" })
      return null
    }
    const history: Message[] = loadMessages(persona.id)
    return (
      <TranslationChat
        key={persona.id}
        persona={persona}
        onBack={() => {
          refresh()
          setScreen({ view: "home" })
        }}
      />
    )
  }

  return null
}
