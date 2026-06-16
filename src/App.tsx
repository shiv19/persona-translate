import { useState, useCallback, useEffect, useRef } from "react"
import type { Screen, Persona } from "./types"
import { uid } from "./types"
import {
  loadPersonas,
  savePersonas,
  deletePersona as removePersona,
  getOrCreateActiveConversation,
  getConversation,
  createConversation,
  ensureConversationTitle,
  loadMessages,
} from "./storage"
import { PersonaList, PersonaEmptyMain } from "./components/PersonaList"
import { PersonaForm } from "./components/PersonaForm"
import { TranslationChat } from "./components/TranslationChat"
import { FavoritesView } from "./components/FavoritesView"
import { HistoryDrawer } from "./components/HistoryDrawer"

export default function App() {
  const [screen, setScreen] = useState<Screen>(() => {
    try {
      const saved = sessionStorage.getItem("pt_screen")
      if (saved) return JSON.parse(saved)
    } catch {}
    return { view: "home" }
  })
  const [personas, setPersonas] = useState<Persona[]>(() => loadPersonas())
  const pushing = useRef(false)
  // Session-only map of which conversation is loaded per persona. Not persisted
  // — on reload, the chat screen derives the active conversation (most recent)
  // via getOrCreateActiveConversation. This map just makes "New Chat" and
  // "select from history" deterministic within a session.
  const [activeConversations, setActiveConversations] = useState<Record<string, string>>({})

  /** Resolve the active conversation id for a persona, creating one lazily. */
  const resolveActiveConversation = useCallback((personaId: string): string => {
    const existing = activeConversations[personaId]
    if (existing) return existing
    const conv = getOrCreateActiveConversation(personaId)
    setActiveConversations((prev) => ({ ...prev, [personaId]: conv.id }))
    return conv.id
  }, [activeConversations])

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
    const updated = personas.map((p) => (p.id === personaId ? { ...p, ...data } : p))
    savePersonas(updated)
    setPersonas(updated)
    navigate({ view: "chat", personaId })
  }

  function handleDeletePersona(personaId: string) {
    removePersona(personaId)
    refresh()
    // If we're viewing the deleted persona, drop back to the empty main pane.
    if (screen.view === "chat" && screen.personaId === personaId) {
      navigate({ view: "home" })
    }
  }

  function getPersona(id: string): Persona | undefined {
    return personas.find((p) => p.id === id)
  }

  function goHome() {
    refresh()
    navigate({ view: "home" })
  }

  /**
   * "New Chat" — archive the current conversation (only if it has messages),
   * then start a fresh empty one. Per the user's spec: if the current
   * conversation is empty, just reuse it rather than creating a junk entry.
   */
  function handleNewChat(personaId: string) {
    const currentId = activeConversations[personaId]
    if (currentId) {
      const conv = getConversation(currentId)
      const msgs = loadMessages(personaId, currentId)
      if (conv && msgs.length > 0) {
        // Ensure the archived conversation has a derived title before we move on.
        ensureConversationTitle(conv)
        // Create a fresh conversation and make it active.
        const fresh = createConversation(personaId)
        setActiveConversations((prev) => ({ ...prev, [personaId]: fresh.id }))
      }
      // If empty (or the record vanished), reuse the current one — no junk entry.
    } else {
      // No active conversation yet — create the first one.
      const fresh = createConversation(personaId)
      setActiveConversations((prev) => ({ ...prev, [personaId]: fresh.id }))
    }
    navigate({ view: "chat", personaId })
  }

  /** Select a conversation from history — load it as active and close the drawer. */
  function handleSelectConversation(personaId: string, conversationId: string) {
    setActiveConversations((prev) => ({ ...prev, [personaId]: conversationId }))
    navigate({ view: "chat", personaId })
  }

  // Active persona id is used to highlight the sidebar item on desktop.
  const activePersonaId =
    screen.view === "chat" ||
    screen.view === "edit-persona" ||
    screen.view === "favorites" ||
    screen.view === "history"
      ? screen.personaId
      : undefined

  // If we land on a chat/edit screen whose persona no longer exists, redirect
  // home. Done as an effect (not during render) to avoid setState-in-render.
  useEffect(() => {
    if (
      (screen.view === "chat" ||
        screen.view === "edit-persona" ||
        screen.view === "favorites" ||
        screen.view === "history") &&
      !getPersona(screen.personaId)
    ) {
      navigate({ view: "home" })
    }
  }, [screen, personas])

  // Render the currently active screen into the main pane.
  function renderMain() {
    if (screen.view === "home") {
      // On desktop the sidebar is always visible, so the main pane shows an empty state.
      // On mobile this PersonaList is the home screen.
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
      return <PersonaForm onSave={handleCreatePersona} onCancel={() => navigate({ view: "home" })} />
    }

    if (screen.view === "edit-persona") {
      const persona = getPersona(screen.personaId)
      if (!persona) return null
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
      if (!persona) return null
      const conversationId = resolveActiveConversation(screen.personaId)
      return (
        <TranslationChat
          // key includes conversationId so the component remounts when the
          // active conversation changes (New Chat / select from history),
          // re-initializing its message state from the new conversation.
          key={`${persona.id}-${conversationId}`}
          persona={persona}
          conversationId={conversationId}
          onBack={goHome}
          onFavorites={() => navigate({ view: "favorites", personaId: screen.personaId })}
          onHistory={() => navigate({ view: "history", personaId: screen.personaId })}
          onNewChat={() => handleNewChat(screen.personaId)}
        />
      )
    }

    if (screen.view === "favorites") {
      const persona = getPersona(screen.personaId)
      if (!persona) return null
      return (
        <FavoritesView
          persona={persona}
          onBack={() => navigate({ view: "chat", personaId: screen.personaId })}
        />
      )
    }

    return null
  }

  // Empty personas: show the empty-state PersonaList, unless we're already on
  // a screen like create-persona (which renders the form via renderMain).
  if (personas.length === 0 && screen.view === "home") {
    return (
      <div className="app-shell">
        <PersonaList
          personas={personas}
          onSelect={() => {}}
          onCreate={() => navigate({ view: "create-persona" })}
          onEdit={() => {}}
          onDelete={() => {}}
          variant="sidebar"
        />
        <main className="app-main">
          <PersonaList
            personas={personas}
            onSelect={() => {}}
            onCreate={() => navigate({ view: "create-persona" })}
            onEdit={() => {}}
            onDelete={() => {}}
          />
        </main>
      </div>
    )
  }

  return (
    <div className="app-shell">
      {/* Sidebar: hidden on mobile (<768px) via CSS, always present on desktop */}
      <PersonaList
        personas={personas}
        onSelect={(id) => navigate({ view: "chat", personaId: id })}
        onCreate={() => navigate({ view: "create-persona" })}
        onEdit={(id) => navigate({ view: "edit-persona", personaId: id })}
        onDelete={handleDeletePersona}
        variant="sidebar"
        activePersonaId={activePersonaId}
      />
      <main className="app-main">
        {screen.view === "home" ? (
          <>
            {/* Mobile: the full home screen. Desktop: hidden (sidebar is the picker). */}
            <div className="home-mobile-only">
              <PersonaList
                personas={personas}
                onSelect={(id) => navigate({ view: "chat", personaId: id })}
                onCreate={() => navigate({ view: "create-persona" })}
                onEdit={(id) => navigate({ view: "edit-persona", personaId: id })}
                onDelete={handleDeletePersona}
              />
            </div>
            {/* Desktop: empty placeholder since the sidebar handles picking. */}
            <PersonaEmptyMain />
          </>
        ) : (
          renderMain()
        )}
      </main>

      {/* History drawer — slides over the main pane. Rendered as an overlay
          sibling so it floats above the chat (and the sidebar) rather than
          replacing the chat screen. Browser-back closes it via the popstate
          handler since it's a Screen variant. */}
      {screen.view === "history" && screen.personaId && (
        <HistoryDrawer
          persona={getPersona(screen.personaId)!}
          activeConversationId={activeConversations[screen.personaId]}
          onSelect={(conversationId) =>
            handleSelectConversation(screen.personaId, conversationId)
          }
          onClose={() => navigate({ view: "chat", personaId: screen.personaId })}
        />
      )}
    </div>
  )
}
