# Knowledge Base

Write down what you know, then ask questions about it. Answers come only from your own documents and cite their sources.

- **Web:** Next.js 16 (Tailwind 4, SWR) — sign in, a document library, a streaming chat with source panel.
- **API:** NestJS 12 — documents, indexing (chunking + embeddings), retrieval-augmented chat over server-sent events.
- **Data:** Supabase — Auth, Postgres with row level security and pgvector (HNSW).
- **AI:** any OpenAI-compatible provider (OpenRouter by default), behind a small interface.

Loom walkthroughs: _product demo_ — `<add link>` · _code walkthrough_ — `<add link>` (scripts in [docs/loom-scripts.md](docs/loom-scripts.md)).

## Run it

You need Node 24, npm 11, a free [Supabase](https://supabase.com) project and an [OpenRouter](https://openrouter.ai) key.

```bash
npm run setup                 # installs dependencies, creates .env from .env.example
# fill in .env: AI_API_KEY, SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY,
#               NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY
npx supabase login            # or set SUPABASE_ACCESS_TOKEN
npx supabase link --project-ref <your-project-ref>
npx supabase db push          # creates tables, policies, search functions
npm run dev                   # web on :3000, API on :4000
```

With Docker (images for both apps, the database stays in Supabase):

```bash
docker compose up --build     # reads .env; web waits for the API health check
```

`NEXT_PUBLIC_*` values are compiled into the browser bundle, so changing them needs `--build`.
In Supabase, email confirmation is on by default: confirm the address from the mail, or switch it off under Authentication → Providers for a demo.

### Commands

| Command | What it does |
|---|---|
| `npm run build / lint / typecheck / test` | all workspaces through Turborepo |
| `RUN_LIVE_DB=1 npm test -w @kb/api` | row level security suite against your real database |
| `RUN_LIVE_E2E=1 npm test -w @kb/api` | documents and chat through the HTTP API with real Supabase and AI |
| `RUN_LIVE_AI=1 npm test -w @kb/api` | the AI adapter against the real provider |

The live suites create throwaway users and spend a few cents of AI credit; they are off by default.

## How it works

```
Browser ──(Supabase JS)──> Supabase Auth              session, JWT (ES256)
   │
   └──(Bearer JWT)──> NestJS API ──> Supabase Postgres  (as the user: RLS applies)
                          │
                          └──> AI provider (embeddings + chat), OpenAI-compatible
```

**Documents.** A document is saved first; indexing is tracked separately (`pending → indexed | failed`) and can be retried, so a provider outage never loses text. The text is split into ~1000-character chunks with 150 overlap, structure-aware (headings, paragraphs, sentences), each embedded with the document title in front. Unchanged content is recognized by a hash and not embedded again. A stale index (the document changed while it was being indexed) is rejected by the database.

**Chat.** A question is (for follow-ups) rewritten into a standalone search query, embedded, and matched against the user's chunks by cosine similarity. Passages above a threshold (0.25, measured for the default embedding model) go into a numbered, escaped `<source>` prompt; the model must cite as `[n]`. If nothing is related, the answer is a fixed "not found in your documents" **without calling the model**. Answers stream as `start | delta | done | error` events; closing the connection cancels the provider call and nothing partial is stored.

**Security model.** The API acts *as the user*: every query carries their JWT, and row level security is the real access control, so a bug in the API cannot read another user's rows. Writes that need more than one table go through `SECURITY DEFINER` functions that check `auth.uid()`; direct writes to chunks and messages are revoked. Per-user limits (200 documents, 200 conversations, 500 chunks per document, message sizes) live in the database; request rates and concurrent streams are limited in the API. Provider errors are mapped to fixed messages, so provider text and the API key never reach a user.

### Decisions

- **Monorepo (Turborepo, npm workspaces).** One repository, one `.env`, shared types in `packages/shared` so API and web cannot drift apart.
- **NestJS for the API.** Modules, dependency injection and guards make the AI layer, repositories and limits replaceable and testable with fakes.
- **pgvector in Supabase instead of a separate vector database.** Vectors sit next to the rows they belong to, so row level security covers retrieval too, and one free-tier service replaces three. HNSW with iterative scan keeps filtered searches complete.
- **Retrieval before generation, with a threshold.** Cheaper and more honest than letting the model decide; unrelated questions cost no tokens.
- **Provider-agnostic AI layer.** Two ports (`ChatModel`, `EmbeddingModel`) and one adapter for the OpenAI wire format.

### Swapping the AI provider

Any service that speaks the OpenAI API works by changing `.env`, no code:

```bash
# OpenRouter (default)       AI_BASE_URL=https://openrouter.ai/api/v1
# Groq                       AI_BASE_URL=https://api.groq.com/openai/v1
# Local Ollama               AI_BASE_URL=http://localhost:11434/v1   AI_API_KEY=ollama
AI_CHAT_MODEL=...            AI_EMBEDDING_MODEL=...
# Use another provider for embeddings only:
AI_EMBEDDING_BASE_URL=...    AI_EMBEDDING_API_KEY=...
```

Two things to keep consistent:

1. `AI_EMBEDDING_DIMENSIONS` must equal the `vector(...)` size in the database (1536 by default). A different size needs a new migration and re-indexing; stored chunks remember which model made them.
2. `CHAT_MIN_SIMILARITY` depends on the embedding model — re-measure it when you change it.

A provider with its own protocol (Anthropic, Gemini native) needs a class implementing `ChatModel` and/or `EmbeddingModel` (`apps/api/src/ai/ai.types.ts`) and a change to the factories in `ai.module.ts`.

## Testing

About 470 tests. API: unit tests for the chunker, prompt, rate limiters, token verifier and AI adapter (against a fake provider HTTP server); service tests with in-memory repositories; HTTP tests through the real Nest pipeline; a live suite that checks row level security with real users (cross-user reads, forged ids, direct writes). Web: Testing Library tests for the stream parser, chat state machine and components. Key behaviors were also verified by deliberately breaking the code and confirming a test fails.

## Known limits and what I would do next

- **Indexing is synchronous.** Saving waits ~1 s for embeddings. A job queue would answer at once and index in the background (the `pending` state already exists); the editor would then poll for status.
- **Rate limits are in memory** — correct for one API instance. Several instances need Redis. There is no per-IP limit, and open sign-up allows unlimited accounts (enable captcha in Supabase).
- **Session token lives in the browser**, so an XSS could read it. A strict CSP is set, but inline scripts remain allowed because pages are prerendered; cookie sessions with a server-side check would be the next step.
- **Edits are lost when switching documents** with unsaved changes (the browser warns on closing the tab, not on navigation).
- **Plain text only.** PDF/TXT upload, a token-usage view, hybrid (keyword + vector) search and reranking would improve answers; end-to-end browser tests should join the repository (they were run by hand).
- **Chat quality** depends on the similarity threshold and chunk size; both are configurable and were tuned on a small set, not a benchmark.
