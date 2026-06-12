import type { Persona } from "../types"
import { Plus, Pencil, Trash2, MessageSquare, ArrowRightLeft } from "lucide-react"

interface Props {
  personas: Persona[]
  onSelect: (id: string) => void
  onCreate: () => void
  onEdit: (id: string) => void
  onDelete: (id: string) => void
}

export function PersonaList({ personas, onSelect, onCreate, onEdit, onDelete }: Props) {
  return (
    <div className="screen">
      <header className="home-header">
        <div>
          <h1 className="app-title">PersonaTranslate</h1>
          <p className="app-subtitle">Context-aware translations</p>
        </div>
      </header>

      {personas.length === 0 ? (
        <div className="empty-state">
          <div className="empty-icon"><MessageSquare size={48} /></div>
          <h2>No personas yet</h2>
          <p>Create a persona for someone you talk to, and get translations that use the right honorifics and pronouns.</p>
          <button className="btn btn-primary btn-lg" onClick={onCreate}>
            Create your first persona
          </button>
        </div>
      ) : (
        <div className="persona-list">
          <button className="btn btn-primary persona-add-btn" onClick={onCreate}>
            <Plus size={18} /> New Persona
          </button>
          <div className="persona-cards">
            {personas.map((p) => (
              <div key={p.id} className="persona-card" onClick={() => onSelect(p.id)}>
                <div className="persona-card-body">
                  <div className="persona-avatar">
                    {p.name.charAt(0).toUpperCase()}
                  </div>
                  <div className="persona-info">
                    <h3>{p.name}</h3>
                    <p className="persona-meta">
                      {p.sourceLanguage} <ArrowRightLeft size={12} /> {p.targetLanguage}
                    </p>
                    <p className="persona-relationship">{p.relationship}</p>
                  </div>
                </div>
                <div className="persona-card-actions" onClick={(e) => e.stopPropagation()}>
                  <button
                    className="btn btn-ghost btn-sm"
                    onClick={() => onEdit(p.id)}
                    title="Edit"
                  >
                    <Pencil size={16} />
                  </button>
                  <button
                    className="btn btn-ghost btn-sm btn-danger"
                    onClick={() => onDelete(p.id)}
                    title="Delete"
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
  )
}
