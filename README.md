# Persona Translate

A relationship-aware translator for languages where pronouns, honorifics, and
register depend on **who is speaking to whom**. Built around one idea: the
relationship *is* the context.

Most translators give you a generic "How do I say X?" Persona Translate gives
you "how do I say X to my wife's traditional mother from central Vietnam?" —
and the kinship terms (`Mẹ`, not `Bà`), self-reference (`con`, not `mẹ vợ`),
and register particles (`ạ`, `ơi`) come out correct every time.

Powered by [GLM-5.1](https://z.ai) via Z.ai's API. React + Vite client, a
minimal Node server (key stays server-side), localStorage persistence. No
accounts, no backend database — it's a personal app.

## The three modes

Every conversation has three verbs, all sharing the same persona context:

| Mode | What it does | Icon |
|---|---|---|
| **Translate** (default) | One-shot translation. Auto-detects input language, translates into the other. Last 5 turns feed context. | ➤ |
| **Suggest a phrase** | Describe a situation ("going shopping"), get 3 relationship-correct phrases you could say. Direction toggle flips between *your* perspective (production practice) and *their* perspective (comprehension practice). | ✨ |
| **Ask a question** | Open-ended language Q&A. Tap the quote icon on any translation to ask about it specifically, or toggle free-form. Answers render as markdown (tables, lists, code). | 💬 |

Notes (Ask-mode Q&A) live in the conversation but are **excluded from
translate context** — so a question about pronouns never corrupts the
kinship reasoning of the next translation. They're included in *ask* context,
so follow-ups chain.

## Why it works: persona context

The core of the app is a shared context block built from the persona's
relationship fields: who the speaker/listener are, how they address each other,
first-person self-reference rules, and a roster of third parties (with their
kinship terms). The translate, suggest, and ask prompts all consume this same
block, so the linguistic correctness carries across every feature.

A persona carries:

- **Languages** — source (e.g. English) and target (e.g. Vietnamese)
- **Relationship** — "my wife's mother" / "their son-in-law" (bidirectional)
- **Address term** — the exact word you use (`Mẹ`), treated as authoritative
- **Context** — dialect, generation, formality expectations
- **People roster** — third parties (the grandson `cháu Senku`, the daughter
  `con Kelly`) with mandatory kinship prefixes when mentioned

## Features

- **Conversation history** — start a new chat to archive the current one;
  browse, pin, rename, delete past conversations in a slide-over drawer. Undo
  on delete restores both the conversation record and its messages.
- **Favorites** — star any translation (or save a suggestion) to a per-persona
  phrasebook. Search, tag, and annotate.
- **Text-to-speech** — play any translation aloud via the Web Speech API.
  Vietnamese tones included.
- **Web Speech input** — voice typing via the browser's built-in STT.
- **Breakdown panel** — every translation reports the speaker, register,
  honorifics, and referents it chose, so you can see the reasoning.

## Getting started

### Prerequisites

- Node.js ≥ 22
- [pnpm](https://pnpm.io)
- A [Z.ai API key](https://z.ai)

### Install & run

```bash
pnpm install
cp .env.example .env   # fill in ZAI_API_KEY
pnpm dev
```

`pnpm dev` runs both the Vite client (port 3133) and the Node API server
(port 3134) concurrently. The client proxies `/api/*` to the server, so
everything shares one origin in dev — no CORS, no client-side key wiring.

Open http://localhost:3133.

### Environment

All keys live in `.env` (gitignored). The API key is server-side only — it has
no `VITE_` prefix and is never bundled into the client.

```
ZAI_API_KEY=...        # required — server-side only
ZAI_BASE_URL=https://api.z.ai/api/coding/paas/v4
ZAI_MODEL=glm-5.1
```

## Architecture

```
src/                    # Client (React + Vite)
  App.tsx               # Screen routing, history drawer mount, conversation state
  components/
    TranslationChat.tsx # The chat surface — all three modes live here
    HistoryDrawer.tsx   # Slide-over conversation history (pin/rename/delete + undo)
    FavoritesView.tsx   # Per-persona saved translations
    PersonaForm.tsx     # Create/edit persona
    PersonaList.tsx     # Sidebar + home screen
    Markdown.tsx        # react-markdown + rehype-sanitize wrapper
  storage.ts            # localStorage stores: personas, messages, favorites,
                        #   seen-phrases (anti-repeat for suggestions), conversations
  ai.ts                 # Client wrappers: translate(), suggest(), ask()
  api.ts                # fetch helpers — client never holds the API key
  tts.ts                # Language → BCP-47 resolution for speech synthesis
  types.ts              # Shared types: Persona, Message, Conversation, Favorite, etc.

server/                 # API server (Node http, no framework)
  index.ts              # Routes: /api/translate, /api/suggest, /api/ask + static
  zai.ts                # Prompts + GLM calls + persona-context builder
  retry.ts              # Exponential backoff for Z.ai rate-limiting

evals/                  # Regression suite (evalite) — see below
```

### Data model

- **Persona** — a person you translate with (relationship, languages, roster)
- **Conversation** — a thread of messages per persona (pinnable, renameable)
- **Message** — a single turn. `kind: "translation" | "note"` discriminates
  translate turns from Ask-mode Q&A. Notes are filtered out of translate
  context but included in ask context.
- **Favorite** — a saved translation (per persona, taggable, searchable)
- **Seen phrases** — anti-repeat list for suggestions (per persona)

All persistence is localStorage. No database, no sync, no accounts.

### The context-split (why Ask mode is safe)

`server/zai.ts` builds two history views off the same message stream:

- `buildTranslationHistory` — **notes excluded**. Used by translate + suggest,
  which re-derive kinship terms from rules. Q&A would only confuse them.
- `buildAskHistory` — **everything included** (last 20), so follow-up questions
  can reference earlier explanations.

Same conversation, two read views. This is the key architectural decision that
lets learning live inside the conversation without polluting translation
quality.

## Evals

Translation quality is guarded by an [evalite](https://www.evalite.ai/)
regression suite — run it before any change to the prompts:

```bash
pnpm eval
```

The suite exercises the primary persona (a central-Vietnamese mother-in-law)
across the failure modes that motivated this app:

- **honorifics** — listener addressed with the correct kinship term, never a
  generic elder term (`Bà` for a mother-in-law is a hard fail)
- **referents** — third parties carry mandatory kinship prefixes (`cháu Senku`,
  never the bare name)
- **direction** — `to-target` vs `from-target` produce correct pronoun direction
- **language-direction** — auto-detect input language, translate into the other
- **structured-output** — the tool-call schema returns all debug fields populated

Scorers combine hard guards (regex/string checks for forbidden terms) with an
LLM judge. Runs hit the live Z.ai API sequentially (it rate-limits
aggressively), so a full run takes a few minutes. Current baseline: **100%**.

Add new personas to `evals/fixtures.ts` and new cases per eval file.

## Scripts

```bash
pnpm dev          # client + server, concurrent (dev)
pnpm dev:client   # client only
pnpm dev:server   # server only
pnpm build        # typecheck + vite build (client) + tsc (server)
pnpm start        # run the compiled server (serves the built client too)
pnpm typecheck    # tsc across app, server, and evals configs
pnpm eval         # run the eval suite
pnpm eval:watch   # evals in watch mode
```

## Production / hosting

The server is a single Node process that serves both the API and the built
static client (see `pnpm start`). It needs `ZAI_API_KEY` in the environment
and nothing else.

```bash
pnpm build
pnpm start         # serves on $PORT (default 3134)
```

The server is pure JSON-in/JSON-out (no multipart, no file uploads — STT is
client-side via the Web Speech API), which keeps hosting simple. Run it behind
any reverse proxy or tunnel.

## Tech

- **React 19** + **Vite 7** (client)
- **Node 22+** `http` server (no Express — minimal)
- **GLM-5.1** via the OpenAI-compatible Z.ai endpoint
- **Zod** for tool-call schema validation
- **react-markdown** + **rehype-sanitize** for Ask-mode answers
- **lucide-react** icons
- **evalite** + **autoevals** for the regression suite

## License

Personal project. Not currently licensed for redistribution.
