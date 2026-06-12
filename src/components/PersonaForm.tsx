import { useState, useEffect } from "react"
import type { Persona } from "../types"
import { ArrowLeft } from "lucide-react"

interface Props {
  persona?: Persona
  onSave: (data: Omit<Persona, "id" | "createdAt">) => void
  onCancel: () => void
}

export function PersonaForm({ persona, onSave, onCancel }: Props) {
  const [name, setName] = useState(persona?.name ?? "")
  const [targetLanguage, setTargetLanguage] = useState(persona?.targetLanguage ?? "")
  const [sourceLanguage, setSourceLanguage] = useState(persona?.sourceLanguage ?? "English")
  const [relationship, setRelationship] = useState(persona?.relationship ?? "")
  const [context, setContext] = useState(persona?.context ?? "")

  useEffect(() => {
    if (persona) {
      setName(persona.name)
      setTargetLanguage(persona.targetLanguage)
      setSourceLanguage(persona.sourceLanguage)
      setRelationship(persona.relationship)
      setContext(persona.context)
    }
  }, [persona])

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    onSave({ name, targetLanguage, sourceLanguage, relationship, context })
  }

  return (
    <div className="screen">
      <header className="screen-header">
        <button className="btn btn-ghost" onClick={onCancel}>
          <ArrowLeft size={20} /> Back
        </button>
        <h2>{persona ? "Edit Persona" : "New Persona"}</h2>
      </header>

      <form className="form" onSubmit={handleSubmit}>
        <div className="form-group">
          <label htmlFor="name">Name or nickname</label>
          <input
            id="name"
            type="text"
            placeholder="e.g., Mom (Mẹ vợ)"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
          />
          <span className="form-hint">How you refer to this person</span>
        </div>

        <div className="form-row">
          <div className="form-group">
            <label htmlFor="sourceLang">You speak</label>
            <input
              id="sourceLang"
              type="text"
              placeholder="English"
              value={sourceLanguage}
              onChange={(e) => setSourceLanguage(e.target.value)}
              required
            />
          </div>
          <div className="form-group">
            <label htmlFor="targetLang">They speak</label>
            <input
              id="targetLang"
              type="text"
              placeholder="Vietnamese"
              value={targetLanguage}
              onChange={(e) => setTargetLanguage(e.target.value)}
              required
            />
          </div>
        </div>

        <div className="form-group">
          <label htmlFor="relationship">Relationship to you</label>
          <input
            id="relationship"
            type="text"
            placeholder="e.g., My wife's mother (mẹ vợ)"
            value={relationship}
            onChange={(e) => setRelationship(e.target.value)}
            required
          />
          <span className="form-hint">
            This determines which pronouns and honorifics to use
          </span>
        </div>

        <div className="form-group">
          <label htmlFor="context">Extra context</label>
          <textarea
            id="context"
            placeholder="e.g., She lives in Saigon. She's older generation, very traditional. I should address her formally. She calls me 'con rể' (son-in-law)."
            value={context}
            onChange={(e) => setContext(e.target.value)}
            rows={4}
          />
          <span className="form-hint">
            Any cultural or personal details that help with translation accuracy
          </span>
        </div>

        <button className="btn btn-primary btn-lg btn-block" type="submit">
          {persona ? "Save Changes" : "Create Persona"}
        </button>
      </form>
    </div>
  )
}
