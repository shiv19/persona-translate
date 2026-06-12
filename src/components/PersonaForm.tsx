import { useState, useEffect } from "react"
import type { Persona, PersonaPerson } from "../types"
import { ArrowLeft, Plus, X } from "lucide-react"

const COMMON_RELATIONS = [
  "son",
  "daughter",
  "grandson",
  "granddaughter",
  "grandchild",
  "husband",
  "wife",
  "older brother",
  "younger brother",
  "older sister",
  "younger sister",
  "mother",
  "father",
  "son-in-law",
  "daughter-in-law",
  "niece",
  "nephew",
  "friend",
  "neighbor",
]

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
  const [reverseRelationship, setReverseRelationship] = useState(persona?.reverseRelationship ?? "")
  const [context, setContext] = useState(persona?.context ?? "")
  const [people, setPeople] = useState<PersonaPerson[]>(persona?.people ?? [])

  useEffect(() => {
    if (persona) {
      setName(persona.name)
      setTargetLanguage(persona.targetLanguage)
      setSourceLanguage(persona.sourceLanguage)
      setRelationship(persona.relationship)
      setReverseRelationship(persona.reverseRelationship ?? "")
      setContext(persona.context)
      setPeople(persona.people ?? [])
    }
  }, [persona])

  function updatePerson(index: number, patch: Partial<PersonaPerson>) {
    setPeople((prev) => prev.map((p, i) => (i === index ? { ...p, ...patch } : p)))
  }

  function addPerson() {
    setPeople((prev) => [...prev, { name: "", relationToListener: "", notes: "" }])
  }

  function removePerson(index: number) {
    setPeople((prev) => prev.filter((_, i) => i !== index))
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const cleanedPeople = people.filter((p) => p.name.trim() && p.relationToListener.trim())
    onSave({ name, targetLanguage, sourceLanguage, relationship, reverseRelationship, context, people: cleanedPeople })
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
            This determines which pronouns and honorifics to use when YOU are speaking
          </span>
        </div>

        <div className="form-group">
          <label htmlFor="reverseRelationship">Your relationship to them</label>
          <input
            id="reverseRelationship"
            type="text"
            placeholder="e.g., her husband, their son-in-law"
            value={reverseRelationship}
            onChange={(e) => setReverseRelationship(e.target.value)}
          />
          <span className="form-hint">
            How {name || "this person"} sees you — used when they are speaking so pronouns/honorifics are correct from their side
          </span>
        </div>

        <div className="form-group">
          <label>People they know</label>
          {people.map((person, i) => (
            <div key={i} className="person-row">
              <div className="person-row-fields">
                <div className="form-group">
                  <label>Name</label>
                  <input
                    type="text"
                    placeholder="e.g., Senku"
                    value={person.name}
                    onChange={(e) => updatePerson(i, { name: e.target.value })}
                  />
                </div>
                <div className="form-group">
                  <label>Relation to {name || "them"}</label>
                  <input
                    type="text"
                    list="relation-options"
                    placeholder="e.g., grandson"
                    value={person.relationToListener}
                    onChange={(e) => updatePerson(i, { relationToListener: e.target.value })}
                  />
                </div>
                <div className="form-group">
                  <label>Relation to you</label>
                  <input
                    type="text"
                    list="relation-options"
                    placeholder="e.g., son"
                    value={person.relationToSpeaker ?? ""}
                    onChange={(e) => updatePerson(i, { relationToSpeaker: e.target.value })}
                  />
                </div>
                <div className="form-group">
                  <label>Notes</label>
                  <input
                    type="text"
                    placeholder="e.g., 17 months old"
                    value={person.notes ?? ""}
                    onChange={(e) => updatePerson(i, { notes: e.target.value })}
                  />
                </div>
              </div>
              <button
                type="button"
                className="btn btn-ghost btn-sm btn-danger"
                onClick={() => removePerson(i)}
                title="Remove person"
              >
                <X size={16} />
              </button>
            </div>
          ))}
          <datalist id="relation-options">
            {COMMON_RELATIONS.map((r) => (
              <option key={r} value={r} />
            ))}
          </datalist>
          <button type="button" className="btn btn-ghost btn-sm person-add-btn" onClick={addPerson}>
            <Plus size={16} /> Add person
          </button>
          <span className="form-hint">
            For each person: their relation to {name || "this person"} (used when you're speaking) and their relation to you (used when {name || "this person"} is speaking).
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
