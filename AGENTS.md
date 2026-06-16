# AGENTS.md

Notes for future agents working on this codebase. Read the code for *what*;
this file is for *why* and *gotchas* that aren't obvious from the code alone.

## The one architectural idea

**The relationship is the context.** Every AI feature (translate, suggest, ask)
routes through `buildPersonaContext()` in `server/zai.ts`. The kinship terms,
pronouns, register, and people-roster all derive from the persona fields.
Don't build a feature that bypasses this — it's the whole reason the app
exists. A generic "translate this" or "explain this" without persona context
isn't this product.

## The context-split (don't break this)

Two history views off the same message stream:
- `buildTranslationHistory` — **notes excluded**. Used by translate + suggest.
- `buildAskHistory` — **everything included** (last 20).

Why: translate/suggest re-derive kinship from rules. Q&A history would
*corrupt* that reasoning (the model might copy a pronoun from a discussion
about pronouns). Notes are filtered out at the server boundary. If you add a
new AI endpoint, decide which history view it gets — most want translation-only.

The `kind: "translation" | "note"` discriminator on `Message` drives this.
Legacy messages (no `kind`) are treated as translations.

## GLM-5.1 gotchas

- **Tool calls over `response_format: json_object`.** The schema isn't
  enforced with json_object — GLM happily omits fields. Translate and suggest
  use function-calling tools; ask returns raw markdown content (no tool).
- **`thinking: { type: "disabled" }`** is sent on every call for speed. Z.ai
  calls it "thinking tokens" — disabling them is a Z.ai-specific extension.
- **Rate-limits aggressively.** `withRetry` (exponential backoff) is
  load-bearing. Evals run sequentially (`maxConcurrency: 1`) for this reason.
- The model occasionally emits the wrong language in the `original` field for
  suggestions (Vietnamese instead of source). The prompt has a FIELD RULE
  guarding this, but it's not 100%. Watch for it.

## The 100% eval baseline is a real gate

`pnpm eval` takes ~30-60s (live API, sequential). Run it after *any* change to
`server/zai.ts` prompts or the history builders. The refactor that extracted
`buildPersonaContext` was verified this way — it was byte-identical to the
original, and that mattered. Evals cover: honorifics (no `Bà` for a
mother-in-law), referents (`cháu Senku` kinship prefix mandatory), direction,
language auto-detect, structured output. Add a case if you fix a new bug.

## The pronoun failure mode (Vietnamese-specific)

The original bug that shaped this app: GLM defaults to generic elder terms
(`Bà`/`Ông`) and third-person role descriptors (`mẹ vợ`/`con rể`) instead of
the precise kinship term (`Mẹ`) and correct first-person self-reference (`con`).
The translate prompt has explicit anti-defaulting rules. The suggest prompt
*also* needs them (learned the hard way — `Anh` bleed). And suggestions are
anchored by passing conversation history so the model sees correct terms in
action. If you see wrong pronouns, check: (1) the prompt's kinship block,
(2) whether history is being passed, (3) the persona's `addressTerm` field.

## Modes are mutually exclusive composer verbs

TranslationChat has three modes: translate (default, implicit — no toggle),
suggest (✨), ask (💬). Only one active at a time. The direction toggle is
live in translate + suggest (flips speaker perspective), locked in ask (notes
aren't speaker-relative). The default mode has no button on purpose — absence
of a mode toggle *is* the signal. Don't add a "Translate" toggle.

## Storage is localStorage, flat arrays, filter-at-read

Every store (`pt_personas`, `pt_messages`, `pt_favorites`, `pt_seen_phrases`,
`pt_conversations`) is one flat array, filtered by `personaId` (and
`conversationId` for messages) at read time. No indexes, no sync, no accounts.
`Message.conversationId` is optional (legacy messages predate conversations).
Migration is lazy — `getOrCreateActiveConversation` handles the "no
conversations yet" case. This is a personal app; don't add a database unless
the user asks.

## Seen-phrases ≠ favorites

Suggestions track an anti-repeat list (`pt_seen_phrases`) per persona so the
model doesn't regenerate saved/discarded phrases. This is *separate* from
favorites — saving a suggestion writes to BOTH (favorite + seen). Clearing a
conversation does NOT clear seen-phrases; deleting a persona does.

## PWA updates

No service worker. `index.html` is served with `Cache-Control: no-cache` so
installed PWAs pick up new builds on next open (the stale-PWA bug was real).
Hashed `/assets/*` are cached immutable. If a user reports "I updated but
nothing changed," it's a cache issue — the no-cache header on HTML is the fix.

## What was deliberately cut

- ASR is client-side only (Web Speech API). The server-side `glm-asr` path was
  removed — no multipart, no raw body handling. Don't add it back unless
  client STT proves insufficient.
- Auto-summarization of ask history. v1 caps at 20 messages; the quote-row
  (tap a translation's quote icon) is the escape hatch for older context.
- Favoriting notes. They live in the conversation; revisit if they feel reusable.
- Cross-persona views. Everything is per-persona, matching favorites/seen scope.

## API key

`ZAI_API_KEY` is server-side only (no `VITE_` prefix). The client never sees
it — all calls go through `/api/*` on the same origin. Don't add a client-side
key path.
