import type { Persona } from "../types"
import { Plus, Pencil, Trash2, MessageSquare, ArrowRightLeft, MessagesSquare } from "lucide-react"

interface Props {
  personas: Persona[]
  onSelect: (id: string) => void
  onCreate: () => void
  onEdit: (id: string) => void
  onDelete: (id: string) => void
  variant?: "page" | "sidebar"
  activePersonaId?: string
}

export function PersonaList({
  personas,
  onSelect,
  onCreate,
  onEdit,
  onDelete,
  variant = "page",
  activePersonaId,
}: Props) {
  const isSidebar = variant === "sidebar"

  // Wrap delete with a confirmation so it's not instant + irreversible — parity
  // with the message-clear confirm in TranslationChat.
  function confirmDelete(persona: Persona) {
    const ok = window.confirm(`Delete "${persona.name}" and all its messages? This cannot be undone.`)
    if (ok) onDelete(persona.id)
  }

  if (isSidebar) {
    return (
      <div className="app-sidebar">
        <header className="sidebar-header">
          <h1 className="sidebar-title">PersonaTranslate</h1>
          <p className="sidebar-subtitle">Context-aware translations</p>
        </header>
        <div className="sidebar-list">
          <button className="btn btn-primary btn-block sidebar-add-btn" onClick={onCreate}>
            <Plus size={18} /> New Persona
          </button>
          {personas.map((p) => (
            <div
              key={p.id}
              className={`persona-card sidebar-card ${p.id === activePersonaId ? "active" : ""}`}
              onClick={() => onSelect(p.id)}
            >
              <div className="persona-card-body">
                <div className="persona-avatar">{p.name.charAt(0).toUpperCase()}</div>
                <div className="persona-info">
                  <h3>{p.name}</h3>
                  <p className="persona-meta">
                    {p.sourceLanguage} <ArrowRightLeft size={12} /> {p.targetLanguage}
                  </p>
                </div>
              </div>
              <div className="persona-card-actions" onClick={(e) => e.stopPropagation()}>
                <button className="btn btn-ghost btn-sm" onClick={() => onEdit(p.id)} title="Edit" aria-label={`Edit ${p.name}`}>
                  <Pencil size={16} />
                </button>
                <button
                  className="btn btn-ghost btn-sm btn-danger"
                  onClick={() => confirmDelete(p)}
                  title="Delete"
                  aria-label={`Delete ${p.name}`}
                >
                  <Trash2 size={16} />
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    )
  }

  // OneUI-inspired layout: the title is display-only and sits in the upper
  // third (nothing to tap up there), while the persona cards live in the lower
  // two-thirds within thumb reach. "New Persona" is a bottom-right FAB so it's
  // reachable one-handed.
  return (
    <div className="screen">
      <div className="home-top">
        <header className="home-header">
          <div>
            <h1 className="app-title">PersonaTranslate</h1>
            <p className="app-subtitle">Context-aware translations</p>
          </div>
        </header>
      </div>

      <div className="home-bottom">
        {personas.length === 0 ? (
          <div className="empty-state">
            <div className="empty-icon"><MessageSquare size={48} /></div>
            <h2>No personas yet</h2>
            <p>
              Create a persona for someone you talk to, and get translations that use the right
              honorifics and pronouns.
            </p>
            <button className="btn btn-primary btn-lg" onClick={onCreate}>
              Create your first persona
            </button>
          </div>
        ) : (
          <div className="persona-list">
            <div className="persona-cards">
              {personas.map((p) => (
                <div key={p.id} className="persona-card" onClick={() => onSelect(p.id)}>
                  <div className="persona-card-body">
                    <div className="persona-avatar">{p.name.charAt(0).toUpperCase()}</div>
                    <div className="persona-info">
                      <h3>{p.name}</h3>
                      <p className="persona-meta">
                        {p.sourceLanguage} <ArrowRightLeft size={12} /> {p.targetLanguage}
                      </p>
                      <p className="persona-relationship">{p.relationship}</p>
                    </div>
                  </div>
                  <div className="persona-card-actions" onClick={(e) => e.stopPropagation()}>
                    <button className="btn btn-ghost btn-sm" onClick={() => onEdit(p.id)} title="Edit" aria-label={`Edit ${p.name}`}>
                      <Pencil size={16} />
                    </button>
                    <button
                      className="btn btn-ghost btn-sm btn-danger"
                      onClick={() => confirmDelete(p)}
                      title="Delete"
                      aria-label={`Delete ${p.name}`}
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      <button className="fab" onClick={onCreate} title="New Persona" aria-label="New Persona">
        <Plus size={26} />
      </button>
    </div>
  )
}

/** Shown in the main pane on desktop when no persona is selected. */
export function PersonaEmptyMain() {
  return (
    <div className="app-main-empty">
      <MessagesSquare size={56} className="empty-icon" strokeWidth={1.5} />
      <p>Select a persona from the sidebar to start translating, or create a new one.</p>
    </div>
  )
}
