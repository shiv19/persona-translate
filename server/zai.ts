import OpenAI from "openai"
import { z } from "zod"
import { withRetry } from "./retry.js"
import { createClient, THINKING_DISABLED, firstFunctionToolCall } from "./glm.js"

const MODEL = process.env.ZAI_MODEL || "glm-5.1"
export const MAX_HISTORY = 5

// ---------------------------------------------------------------------------
// Shared types — mirrored from src/types.ts. The server cannot import client
// code, so we redeclare the minimal shape it needs.
// ---------------------------------------------------------------------------

export interface PersonaPerson {
  name: string
  relationToListener: string
  relationToSpeaker?: string
  notes?: string
}

export interface Persona {
  id: string
  name: string
  targetLanguage: string
  sourceLanguage: string
  relationship: string
  reverseRelationship: string
  context: string
  /** Optional explicit term the user uses to address this person (e.g. "Mẹ", "Bác 3"). When set, the translator treats it as authoritative. */
  addressTerm?: string
  people?: PersonaPerson[]
  createdAt: number
}

export interface Message {
  id: string
  personaId: string
  original: string
  translation: string
  direction: "to-target" | "from-target"
  createdAt: number
  debug?: TranslationDebug | null
  conversationId?: string
  kind?: "translation" | "note"
  quote?: { original: string; translation: string }
}

export interface TranslationDebug {
  speaker?: string
  register?: string
  honorificsUsed?: string
  referents?: string
}

// ---------------------------------------------------------------------------
// Zod contract for the translation result.
//
// We use Function Calling (tools) rather than response_format: json_object,
// because json_object only guarantees valid JSON — it does NOT enforce the
// schema, so GLM-5.1 happily returns {"translation":"..."} and omits every
// debug field. With tools, the model must populate arguments matching the
// JSON Schema, so the debug fields actually come back populated.
// ---------------------------------------------------------------------------

const TranslationResult = z.object({
  translation: z
    .string()
    .describe("The final natural translation only — no notes, no romanization"),
  speaker: z
    .enum(["user", "other-person"])
    .describe("Who is speaking this message — 'user' if the user is speaking, 'other-person' if the persona is speaking"),
  register: z
    .string()
    .describe("The level of formality/respect chosen for this relationship (e.g. formal, polite, casual, intimate) and a one-sentence reason it fits"),
  honorificsUsed: z
    .string()
    .describe("The specific honorifics, pronouns, and address terms used in the translation. Explain the choices briefly."),
  referents: z
    .string()
    .describe("Third parties mentioned in the message (not the speaker or listener). For each: who they are, their relationship to the LISTENER, and the kinship/address term used. Write 'none' if no third parties are mentioned."),
})

export type TranslationDebugParsed = Omit<z.infer<typeof TranslationResult>, "translation">

export interface TranslateOutput {
  translation: string
  debug: TranslationDebugParsed | null
}

// The tool definition passed to the API. GLM is constrained to return
// arguments matching this schema via tool_calls[0].function.arguments.
const TRANSLATION_TOOL = {
  type: "function" as const,
  function: {
    name: "record_translation",
    description: "Record the completed translation along with the linguistic choices made (speaker, register, honorifics, referents). You MUST call this tool to return your translation — do not output the translation as plain text.",
    parameters: {
      type: "object",
      properties: {
        translation: { type: "string", description: "The final natural translation only — no notes, no romanization" },
        speaker: { type: "string", enum: ["user", "other-person"], description: "'user' if the user is speaking, 'other-person' if the persona is speaking" },
        register: { type: "string", description: "The level of formality/respect chosen (e.g. formal, polite, casual, intimate) and a one-sentence reason it fits" },
        honorificsUsed: { type: "string", description: "The specific honorifics, pronouns, and address terms used in the translation, with brief explanation" },
        referents: { type: "string", description: "Third parties mentioned and the kinship/address terms used for them, or 'none'" },
      },
      required: ["translation", "speaker", "register", "honorificsUsed", "referents"],
    },
  },
}

function buildPeopleRoster(persona: Persona, direction: "to-target" | "from-target"): string {
  const people = persona.people?.filter((p) => p.name.trim() && p.relationToListener.trim()) ?? []
  if (people.length === 0) return ""

  const speakerIsUser = direction === "to-target"
  const listenerName = speakerIsUser ? persona.name : "the user"

  const lines = people.map((p) => {
    const note = p.notes?.trim() ? ` (${p.notes.trim()})` : ""
    const relation = speakerIsUser
      ? p.relationToListener
      : (p.relationToSpeaker || p.relationToListener)
    return `- ${p.name} — ${listenerName}'s ${relation}${note} → when mentioned in the translation, the kinship term for "${relation}" MUST be attached to their name (e.g. Vietnamese daughter → "con [Name]", grandson → "cháu [Name]"). Do NOT use the bare name alone — the kinship term is required.`
  })

  return `

PEOPLE WHO MAY BE MENTIONED (this roster is AUTHORITATIVE — relationships are relative to ${listenerName}, the listener):
${lines.join("\n")}`
}

// Shared persona-context block used by both the translate prompt (below) and
// the suggest prompt. Keeping this in one place means the kinship / address /
// first-person / people-roster rules never diverge between the two tasks.
//
// `speakerIsUser` controls which side of the relationship is speaking, which
// flips the address-term and self-reference derivation. buildSystemPrompt passes
// direction === "to-target"; buildSuggestPrompt always passes true (the user is
// producing phrases to say to the persona).
function buildPersonaContext(persona: Persona, speakerIsUser: boolean): string {
  const speakerName = speakerIsUser ? "the user" : persona.name
  const listenerName = speakerIsUser ? persona.name : "the user"
  const speakerRelationship = speakerIsUser
    ? `${persona.name}'s relationship to the user: ${persona.relationship}`
    : `The user's relationship to ${persona.name}: ${persona.reverseRelationship || persona.relationship}`

  // addressTerm is listener-relative: it describes how the SPEAKER addresses the
  // LISTENER. So in to-target (user→persona) it's how the user addresses the
  // persona; in from-target (persona→user) it's how the persona addresses the
  // user. We must attach it to whoever is actually the listener.
  //
  // The override is a USER preference for how *they* address the persona. We do
  // NOT force the persona to use the same term in reverse — the persona uses the
  // reverseRelationship to derive the correct term for the user.
  const addressOverride = persona.addressTerm?.trim()

  let addressLine: string
  if (speakerIsUser) {
    // User is speaking → listener is the persona. addressTerm applies here.
    addressLine = addressOverride
      ? `HOW TO ADDRESS THE LISTENER (${persona.name}): When the user directly addresses ${persona.name}, use the EXACT term "${addressOverride}". Non-negotiable — never substitute it.`
      : `HOW TO ADDRESS THE LISTENER (${persona.name}): Derive the correct ${persona.targetLanguage} kinship/address term for ${persona.name} from the relationship. NEVER default to a generic elder term (Vietnamese "Bà"/"Ông") when a precise kinship term exists — a mother-in-law is "Mẹ", not "Bà".`
  } else {
    // Persona is speaking → listener is the user. addressTerm does NOT apply
    // (it was the user's choice for addressing the persona, not vice versa).
    // The persona derives the user's term from reverseRelationship.
    addressLine = `HOW TO ADDRESS THE LISTENER (the user): Derive the correct ${persona.targetLanguage} kinship/address term for the USER from "${persona.reverseRelationship || persona.relationship}". This is how ${persona.name} addresses the user — it is generally DIFFERENT from how the user addresses ${persona.name}.`
  }

  // First-person guidance: when a younger-generation speaker addresses an elder,
  // they refer to themselves with the humble/younger term (Vietnamese "con"),
  // NEVER with a third-person descriptor like "mẹ vợ" (wife's mother).
  const firstPersonLine = `FIRST-PERSON SELF-REFERENCE: The speaker refers to THEMSELVES using the correct first-person pronoun for this relationship in ${persona.targetLanguage} — never in the third person, never by their role title. (Vietnamese: a younger speaker addressing an elder uses "con" for themselves, NOT "mẹ vợ"/"con rể" — those are descriptors others use about them, not words they call themselves.)`

  return `The current message is spoken by ${speakerName} and addressed to ${listenerName}.

Context:
- ${speakerRelationship}
- ${addressLine}
- ${firstPersonLine}
- Additional context: ${persona.context}${buildPeopleRoster(persona, speakerIsUser ? "to-target" : "from-target")}`
}

function buildSystemPrompt(persona: Persona, direction: "to-target" | "from-target"): string {
  return `You are an expert translator specializing in ${persona.targetLanguage}.

${buildPersonaContext(persona, direction === "to-target")}

IMPORTANT RULES:
1. DETECT THE INPUT LANGUAGE and translate INTO THE OTHER language — never echo the input language. If the input is ${persona.sourceLanguage}, output ${persona.targetLanguage}. If the input is ${persona.targetLanguage}, output ${persona.sourceLanguage}.
2. PRONOUNS ARE DIRECTION-RELATIVE: The term for addressing the listener is in "HOW TO ADDRESS THE LISTENER" above. The speaker's self-reference is in "FIRST-PERSON SELF-REFERENCE". These are generally DIFFERENT terms. Never confuse speaker-self with listener-address.
3. FAITHFUL MEANING, NATURAL REGISTER:
   a. PRESERVE MEANING & TENSE EXACTLY. "is sleeping" ≠ "has fallen asleep" / "is already asleep" (Vietnamese: "đang ngủ" ≠ "ngủ rồi"). Match the source's tense and factual claims precisely — do not shift them to make the sentence "sound better".
   b. DO NOT ADD OR DROP INFORMATION. Every claim in the source appears in the translation; nothing in the translation was invented. No added pleasantries, greetings, or facts the speaker didn't state.
   c. NATURAL REGISTER IS ENCOURAGED. DO add the sentence-final particles, softeners, and natural discourse markers that a native speaker would use in this relationship and dialect (Vietnamese: "ạ", "nha", "nhé", "ơi" when directly addressing, Central Vietnamese dialect features, etc.). The goal is a translation that sounds like a real person talking — not stiff or textbook-like. This applies to HOW things are said, never to WHAT is said.
4. REFERENTS — THIRD-PARTY KINSHIP TERMS ARE MANDATORY. When the message mentions other people (not the speaker or listener), check the people roster. You MUST attach the kinship term matching their relationship to the LISTENER to their name — e.g. if the listener's daughter Kelly is mentioned, write "con Kelly" (Vietnamese), NEVER the bare name "Kelly" alone. If the listener's grandson Senku is mentioned, write "cháu Senku", NEVER "thằng Senku" or the bare name. The kinship prefix is non-optional: it signals the family bond from the listener's perspective. Use it even when the name alone would be "understandable".
5. Earlier messages may contain mistakes. Re-derive all pronouns and address terms from these rules every time — never copy from history.
6. You MUST return your result by calling the record_translation tool. Fill every field: decide speaker, address term, self-reference, register, and referents FIRST (committing to the correct kinship terms before translating), then produce the translation. The "translation" field contains only the translated text.`
}

/**
 * Translation context: only translation-kind turns (notes excluded). Used by
 * serverTranslate and serverSuggest. Filtering notes here is the critical
 * correctness rule — Q&A must never feed the translator's kinship reasoning,
 * since it re-derives pronouns from rules, not history.
 */
function buildTranslationHistory(persona: Persona, history: Message[]): OpenAI.Chat.ChatCompletionMessageParam[] {
  return history
    .filter((msg) => msg.kind !== "note")
    .flatMap((msg): OpenAI.Chat.ChatCompletionMessageParam[] => {
      const speakerLabel = msg.direction === "to-target"
        ? `[You speaking to ${persona.name}]`
        : `[${persona.name} speaking to you]`

      return [
        { role: "user", content: `${speakerLabel} ${msg.original}` },
        { role: "assistant", content: msg.translation },
      ]
    })
}

/**
 * Ask context: ALL message kinds (translations + notes), with richer labels so
 * the tutor can tell questions/answers apart from translation turns. Notes
 * label the user's question and the tutor's prior answer; translations keep
 * the speaker labels from buildTranslationHistory. Wider window (20 vs 5) so
 * follow-up questions can reference earlier explanations.
 */
function buildAskHistory(persona: Persona, history: Message[]): OpenAI.Chat.ChatCompletionMessageParam[] {
  return history.flatMap((msg): OpenAI.Chat.ChatCompletionMessageParam[] => {
    if (msg.kind === "note") {
      const quoteBlock = msg.quote
        ? `\n(Asked about: "${msg.quote.original}" → "${msg.quote.translation}")`
        : ""
      return [
        { role: "user", content: `[You asked] ${msg.original}${quoteBlock}` },
        { role: "assistant", content: msg.translation },
      ]
    }
    const speakerLabel = msg.direction === "to-target"
      ? `[You speaking to ${persona.name}]`
      : `[${persona.name} speaking to you]`
    return [
      { role: "user", content: `${speakerLabel} ${msg.original}` },
      { role: "assistant", content: msg.translation },
    ]
  })
}

export async function serverTranslate(
  persona: Persona,
  input: string,
  history: Message[],
  direction: "to-target" | "from-target",
): Promise<TranslateOutput> {
  const recentHistory = history.slice(-MAX_HISTORY)

  const speakerLabel = direction === "to-target"
    ? `[You speaking to ${persona.name}]`
    : `[${persona.name} speaking to you]`

  const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
    { role: "system", content: buildSystemPrompt(persona, direction) },
    ...buildTranslationHistory(persona, recentHistory),
    { role: "user", content: `${speakerLabel} ${input}` },
  ]

  const response = await withRetry(() =>
    createClient().chat.completions.create({
      model: MODEL,
      messages,
      temperature: 0.3,
      tools: [TRANSLATION_TOOL],
      // Z.ai only supports "auto", but with exactly one tool defined and the
      // system prompt instructing the model to call it, GLM reliably invokes it.
      tool_choice: "auto",
      ...THINKING_DISABLED,
    }),
  )

  const message = response.choices[0]?.message

  // Primary path: parse the tool call arguments (schema-enforced).
  const toolCall = firstFunctionToolCall(message)
  if (toolCall) {
    const parsed = parseToolArguments(toolCall.function.arguments)
    if (parsed) {
      const { translation, ...debug } = parsed
      return { translation: translation.trim(), debug }
    }
  }

  // Fallback: if the model emitted plain content instead of a tool call (rare,
  // but happens), salvage a translation from the text using the lenient parser.
  const raw = message?.content ?? ""
  const parsed = parseTranslation(raw)
  if (parsed) {
    const { translation, ...debug } = parsed
    return {
      translation: translation.trim(),
      debug: hasDebugFields(debug) ? debug : null,
    }
  }

  return { translation: "", debug: null }
}

/** Type guard: only report debug if at least one field is populated. */
function hasDebugFields(d: Partial<TranslationDebugParsed>): d is TranslationDebugParsed {
  return Boolean(d.speaker || d.register || d.honorificsUsed || d.referents)
}

/**
 * Parse the tool call's function arguments (a JSON string) against the Zod
 * schema. This is the schema-enforced path — all required fields should be
 * present. We still validate defensively in case the model returns malformed JSON.
 */
function parseToolArguments(argsJson: string) {
  try {
    const obj = JSON.parse(argsJson)
    const result = TranslationResult.safeParse(obj)
    return result.success ? result.data : null
  } catch {
    return null
  }
}

/**
 * GLM frequently wraps JSON in ```json ... ``` fences or adds stray prose around it.
 * Extract the first {...} block and parse it; fall back to a direct parse.
 */
function extractJson(text: string): unknown | null {
  const trimmed = text.trim()
  try {
    return JSON.parse(trimmed)
  } catch {}

  // Strip a leading ```json / ``` fence if present
  const fenceMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i)
  if (fenceMatch) {
    try {
      return JSON.parse(fenceMatch[1].trim())
    } catch {}
  }

  // Grab the outermost { ... } span
  const start = trimmed.indexOf("{")
  const end = trimmed.lastIndexOf("}")
  if (start !== -1 && end !== -1 && end > start) {
    try {
      return JSON.parse(trimmed.slice(start, end + 1))
    } catch {}
  }
  return null
}

// GLM doesn't use a stable key name for the translated text — it has been seen
// returning "translation", "answer", "text", etc. Map any of these to "translation".
const TRANSLATION_KEYS = ["translation", "answer", "translated_text", "translatedText", "output", "text", "result", "message"]

function parseTranslation(text: string) {
  const json = extractJson(text)

  // Bare string response — treat it as the translation directly.
  if (typeof json === "string" && json.trim()) {
    return { translation: json.trim() }
  }

  if (!json || typeof json !== "object") return null
  const obj = json as Record<string, unknown>

  // Normalize alias keys → "translation"
  if (typeof obj.translation !== "string") {
    const alias = TRANSLATION_KEYS.find((k) => k !== "translation" && typeof obj[k] === "string")
    if (alias) obj.translation = obj[alias]
  }

  const result = TranslationResult.safeParse(obj)
  return result.success ? result.data : null
}

// ---------------------------------------------------------------------------
// SITUATIONAL PHRASE SUGGESTIONS
//
// Unlike translate (one phrase in → one translation out), suggest generates a
// small batch of phrases the user could plausibly say to this specific person
// in a described situation. It reuses buildPersonaContext so the same kinship /
// address / roster rules apply — a suggestion for "Mom (Mẹ vợ)" correctly uses
// "ạ" and "con", while the same situation for a peer friend is casual.
//
// The result is an ARRAY. GLM's tool-calling supports array-valued properties
// in the arguments JSON (we wrap it in { suggestions: [...] }), which is more
// reliable than asking for a bare top-level array.
// ---------------------------------------------------------------------------

const SuggestionItem = z.object({
  original: z
    .string()
    .describe("A natural phrase in the source language the user could say in this situation. Plain text, no quotes, no romanization, no notes."),
  translation: z
    .string()
    .describe("The target-language translation of 'original' — natural spoken register with the correct kinship terms, pronouns, and particles for this relationship. Plain text only."),
  register: z
    .string()
    .describe("The register/formality chosen and a one-sentence reason it fits this relationship"),
  honorificsUsed: z
    .string()
    .describe("The specific honorifics, pronouns, particles, and address terms used in the translation, with brief explanation"),
  note: z
    .string()
    .describe("One short sentence on why this phrase is useful in the described situation"),
})

const SuggestResult = z.object({
  suggestions: z
    .array(SuggestionItem)
    .min(1)
    .max(5)
    .describe("Distinct phrase suggestions for the situation"),
})

const SUGGEST_TOOL = {
  type: "function" as const,
  function: {
    name: "record_suggestions",
    description: "Record the generated phrase suggestions for the situation. You MUST call this tool to return your suggestions — do not output them as plain text.",
    parameters: {
      type: "object",
      properties: {
        suggestions: {
          type: "array",
          minItems: 1,
          maxItems: 5,
          items: {
            type: "object",
            properties: {
              original: { type: "string", description: "A natural source-language phrase the user could say in this situation. Plain text, no quotes, no notes." },
              translation: { type: "string", description: "The target-language translation — natural spoken register with correct kinship/pronouns/particles. Plain text only." },
              register: { type: "string", description: "Register chosen and one-sentence reason it fits this relationship" },
              honorificsUsed: { type: "string", description: "Specific honorifics, pronouns, particles, and address terms used, with brief explanation" },
              note: { type: "string", description: "One short sentence on why this phrase is useful in the situation" },
            },
            required: ["original", "translation", "register", "honorificsUsed", "note"],
          },
        },
      },
      required: ["suggestions"],
    },
  },
}

export interface SuggestionItemParsed extends z.infer<typeof SuggestionItem> {}

export interface SuggestOutput {
  suggestions: SuggestionItemParsed[]
}

function buildSuggestPrompt(
  persona: Persona,
  situation: string,
  avoid: string[],
  count: number,
  direction: "to-target" | "from-target",
): string {
  const avoidBlock = avoid.length > 0
    ? `\n\nALREADY GENERATED (do NOT repeat or produce near-duplicates of these — different wording AND different intent):\n${avoid.map((p) => `- ${p}`).join("\n")}`
    : ""

  // Who is speaking in this batch? to-target = the USER produces phrases
  // (production practice); from-target = the PERSONA produces them
  // (comprehension practice — what the user might hear). This flips whose
  // kinship/pronoun/register logic the target-language side must exercise.
  const userSpeaking = direction === "to-target"
  const speaker = userSpeaking ? "the user" : persona.name
  const listener = userSpeaking ? persona.name : "the user"

  return `You are an expert language coach specializing in ${persona.targetLanguage}.
You generate realistic, useful phrases for a learner, in a specific situation, involving a specific person.

${buildPersonaContext(persona, userSpeaking)}

SITUATION THE USER IS PREPARING FOR:
"${situation}"

TASK: Generate exactly ${count} distinct phrases that ${speaker} could plausibly say to ${listener} in this situation.

FIELD RULE (never changes): "original" is ALWAYS ${persona.sourceLanguage}. "translation" is ALWAYS ${persona.targetLanguage}. Whoever is speaking, ${persona.sourceLanguage} goes in "original" and ${persona.targetLanguage} goes in "translation".

KINSHIP IS THE WHOLE POINT — never default to generic terms. For ${speaker} speaking to ${listener}: derive the PRECISE kinship/address term for the listener and the correct first-person self-reference from the relationship, every single time. NEVER fall back on generic age-based pronouns (Vietnamese: do NOT use "Anh"/"Chị"/"Bà"/"Ông" as a default when a precise kinship term exists). ${userSpeaking ? `The user addressing ${persona.name} uses the term in "HOW TO ADDRESS THE LISTENER" and refers to themselves with the first-person term in "FIRST-PERSON SELF-REFERENCE".` : `${persona.name} addressing the user derives the term from the relationship, and refers to ${persona.name}self with the correct elder/self term.`} If earlier conversation turns are provided, they show the correct terms in action — USE those terms as the authoritative example, but still re-derive them from the relationship rules each time (never copy blindly, in case a turn contained a mistake).

The phrases must:
1. BE SITUATIONALLY REAL. Things a real person in this relationship would actually say here — not textbook templates, not generic greetings unless the situation calls for one.
2. EXERCISE THE RELATIONSHIP. The ${persona.targetLanguage} side ("translation") must use the correct kinship term, pronoun, self-reference, and register for ${speaker} speaking to ${listener}. Apply the address, first-person, and people-roster rules from the context above exactly as a translator would.
3. VARY IN FUNCTION across the batch — e.g. asking something, stating something, making a request, expressing gratitude or concern. Do not produce ${count} variations of the same sentence.
4. BE SELF-CONTAINED. Each phrase is a complete utterance that could be said on its own. Keep them short and spoken (1–2 sentences), not paragraphs.

Return exactly ${count} phrases (unless the situation genuinely can't support that many). You MUST call the record_suggestions tool with all fields filled. Decide the kinship/pronoun/register for the ${persona.targetLanguage} side FIRST, then write it.${avoidBlock}`
}

/**
 * Generate situational phrase suggestions. Mirrors serverTranslate's structure:
 * tool-call primary path, lenient JSON-array fallback, same retry/temperature
 * handling. `count` is clamped server-side so a bad client request can't ask
 * for hundreds. `direction` controls whose perspective the phrases come from
 * (to-target = user speaking, from-target = persona speaking). `history` is the
 * recent conversation (direction-labeled) — it anchors the kinship terms by
 * showing the correct ones in action, which prevents the model defaulting to
 * generic pronouns (e.g. Vietnamese Anh/Chị) when the relationship is ambiguous.
 */
export async function serverSuggest(
  persona: Persona,
  situation: string,
  avoid: string[] = [],
  count = 3,
  direction: "to-target" | "from-target" = "to-target",
  history: Message[] = [],
): Promise<SuggestOutput> {
  const n = Math.max(1, Math.min(5, Math.floor(count)))
  const recentHistory = history.slice(-MAX_HISTORY)

  const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
    { role: "system", content: buildSuggestPrompt(persona, situation, avoid, n, direction) },
    // Direction-labeled prior turns (notes excluded — suggest, like translate,
    // re-derives kinship from rules, not Q&A history).
    ...buildTranslationHistory(persona, recentHistory),
    { role: "user", content: situation },
  ]

  const response = await withRetry(() =>
    createClient().chat.completions.create({
      model: MODEL,
      messages,
      // Slightly higher than translate's 0.3 — we want variety across batches
      // and across regenerations of the same situation.
      temperature: 0.6,
      tools: [SUGGEST_TOOL],
      tool_choice: "auto",
      ...THINKING_DISABLED,
    }),
  )

  const message = response.choices[0]?.message

  // Primary path: parse the tool call arguments (schema-enforced array).
  const toolCall = firstFunctionToolCall(message)
  if (toolCall) {
    const parsed = parseSuggestArguments(toolCall.function.arguments)
    if (parsed) return { suggestions: parsed }
  }

  // Fallback: salvage from plain content (extend extractJson for arrays).
  const raw = message?.content ?? ""
  const parsed = parseSuggestions(raw)
  if (parsed) return { suggestions: parsed }

  return { suggestions: [] }
}

function parseSuggestArguments(argsJson: string): SuggestionItemParsed[] | null {
  try {
    const obj = JSON.parse(argsJson)
    const result = SuggestResult.safeParse(obj)
    return result.success ? result.data.suggestions : null
  } catch {
    return null
  }
}

/**
 * Lenient fallback when the model emits plain content instead of a tool call.
 * Handles both { suggestions: [...] } objects and bare [...] arrays, and
 * salvages partial items (only items that validate against SuggestionItem are
 * kept) so a single bad item doesn't lose the whole batch.
 */
function parseSuggestions(text: string): SuggestionItemParsed[] | null {
  const json = extractJson(text)

  // Bare array.
  if (Array.isArray(json)) {
    const items = json.flatMap((j) => {
      const r = SuggestionItem.safeParse(j)
      return r.success ? [r.data] : []
    })
    return items.length > 0 ? items : null
  }

  if (json && typeof json === "object") {
    const obj = json as Record<string, unknown>
    const arr = Array.isArray(obj.suggestions)
      ? obj.suggestions
      : Array.isArray(obj.phrases)
        ? obj.phrases
        : null
    if (arr) {
      const items = arr.flatMap((j) => {
        const r = SuggestionItem.safeParse(j)
        return r.success ? [r.data] : []
      })
      return items.length > 0 ? items : null
    }
  }

  return null
}

// ---------------------------------------------------------------------------
// ASK — open-ended language Q&A (markdown explanations)
//
// Unlike translate (structured tool call) and suggest (array tool call), ask
// returns RAW markdown content — explanations aren't structured data. The model
// is instructed to use markdown freely (tables for paradigms, lists, inline
// code for target-language words). Persona context is included so answers are
// relationship-specific (the moat), and the full conversation history (notes
// included) so follow-ups can reference prior explanations.
// ---------------------------------------------------------------------------

const ASK_HISTORY_WINDOW = 20

function buildAskPrompt(persona: Persona): string {
  return `You are a patient, expert language tutor specializing in ${persona.targetLanguage}, helping a learner who communicates with a specific person.

${buildPersonaContext(persona, true)}

YOUR JOB: Answer the learner's question clearly and concretely. You are explaining how the language works, not translating.

GUIDELINES:
1. EXPLAIN IN ${persona.sourceLanguage}. Use ${persona.targetLanguage} ONLY for example words/phrases/sentences — wrap each ${persona.targetLanguage} example in inline code (backticks) so it stands out from the explanation prose.
2. USE MARKDOWN FREELY. Tables are great for pronoun/paradigm comparisons. Bullet/numbered lists for steps or options. **Bold** for key terms. Keep paragraphs short.
3. BE CONCRETE AND RELATIONSHIP-AWARE. This learner talks to ${persona.name} (see the context above). Ground explanations in that relationship where relevant — e.g. "since you're addressing ${persona.name}, you'd use…" Contrast with other situations (a friend, an elder) when it helps clarify.
4. REFERENCE THE CONVERSATION. If earlier turns or a quoted translation are provided, anchor your answer in them specifically rather than giving a generic textbook response.
5. BE ACCURATE. If the answer involves a kinship term, pronoun, or register, derive it from the persona context rules — the same rules the translator uses. Don't contradict what a correct translation would produce.
6. BE CONCISE BUT COMPLETE. Answer the actual question fully, but don't pad. A focused paragraph or a tight table beats a wall of text. Skip preambles like "Great question!" — just answer.`
}

/** Build the user-turn content for an ask request. */
function buildAskUserContent(
  persona: Persona,
  question: string,
  quote?: { original: string; translation: string },
): string {
  return quote
    ? `The learner is asking about this specific translation:\n\n> ${persona.sourceLanguage}: ${quote.original}\n> ${persona.targetLanguage}: ${quote.translation}\n\nTheir question: ${question}`
    : question
}

/**
 * Stream an ask answer incrementally so the client can render the markdown
 * explanation as it arrives — ask answers are often long (tables, lists,
 * multi-paragraph explanations) and waiting for the full response feels laggy.
 *
 * Yields `{ delta }` for each text fragment, then a final `{ done }` carrying
 * the complete answer. The caller (the SSE route) translates these into SSE
 * events. Errors propagate as normal exceptions — the route catches and emits
 * an error event.
 *
 * Note: streaming bypasses withRetry — a mid-stream failure isn't retryable
 * (we'd have to discard partial output the user already saw). Z.ai stream
 * connections are generally stable; if this proves flaky, the fix is a
 * higher-level "retry the whole request" at the client, not partial recovery.
 */
export async function* serverAskStream(
  persona: Persona,
  question: string,
  history: Message[] = [],
  quote?: { original: string; translation: string },
): AsyncGenerator<{ delta?: string; done?: string }> {
  const recentHistory = history.slice(-ASK_HISTORY_WINDOW)

  const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
    { role: "system", content: buildAskPrompt(persona) },
    ...buildAskHistory(persona, recentHistory),
    { role: "user", content: buildAskUserContent(persona, question, quote) },
  ]

  const stream = await createClient().chat.completions.create({
    model: MODEL,
    messages,
    temperature: 0.5,
    stream: true,
    ...THINKING_DISABLED,
  })

  let full = ""
  for await (const chunk of stream) {
    const delta = chunk.choices[0]?.delta?.content ?? ""
    if (delta) {
      full += delta
      yield { delta }
    }
  }
  yield { done: full.trim() }
}

