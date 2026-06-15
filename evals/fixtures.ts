import type { Persona } from "../server/zai.js"

/**
 * The primary test persona — a Vietnamese mother-in-law from central Vietnam
 * (Quảng Bình). This is the persona behind most of the real bugs we hit this
 * session (Bà vs Mẹ, third-person mẹ vợ self-reference, cháu Senku).
 *
 * Kept in sync with the user's actual app persona so evals reflect reality.
 */
export const motherInLaw: Persona = {
  id: "eval-mil",
  name: "Mother in Law",
  targetLanguage: "Vietnamese",
  sourceLanguage: "English",
  relationship: "My wife's mother",
  reverseRelationship: "their son-in-law (con rể)",
  context:
    "She comes from Bảo Trach village of Quang Binh province, central Vietnam, so please make sure to use that dialect when translating.",
  addressTerm: "Mẹ",
  people: [
    { name: "Senku", relationToListener: "grandson", relationToSpeaker: "son", notes: "17 months old" },
    { name: "Kelly", relationToListener: "daughter", relationToSpeaker: "wife" },
  ],
  createdAt: 0,
}

/**
 * A second persona in a different language family, so direction/registry logic
 * is exercised beyond Vietnamese. Japanese has its own honorific system
 * (san/chama, keigo) that the translator must handle.
 */
export const japaneseFriend: Persona = {
  id: "eval-jp",
  name: "Haruki",
  targetLanguage: "Japanese",
  sourceLanguage: "English",
  relationship: "a close friend I've known for years",
  reverseRelationship: "a close friend",
  context: "We're the same age and use casual/informal Japanese.",
  createdAt: 0,
}

/**
 * A test case: the persona under test, the input text, the direction, and a
 * short human-readable description shown in the eval UI.
 */
export interface TestCase {
  persona: Persona
  input: string
  direction: "to-target" | "from-target"
  description: string
}

/**
 * Helper to build a data item for an eval. evalite's `data` array expects items
 * shaped `{ input, expected? }`, so we wrap the TestCase in `input`. The
 * `description` is carried along for display via columns in the eval files.
 */
export function case_(
  persona: Persona,
  input: string,
  direction: "to-target" | "from-target",
  description: string,
): { input: TestCase } {
  return { input: { persona, input, direction, description } }
}
