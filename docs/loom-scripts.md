# Loom scripts

Two videos, each about 5 minutes. Speak plainly; show, do not read. Before recording: `docker compose up --build`, a fresh account, an empty library, two or three short documents ready to paste (a home-network guide, a recipe, a project note).

## Video 1 — Product demo (for someone who has never seen the code)

**0:00 — What it is (20 s).** "This is a personal knowledge base. You write down what you know, and then you can ask questions about it. Answers use only your own documents and show where they came from."

**0:20 — Sign in (20 s).** Show the login screen, sign in. Mention: each person sees only their own data.

**0:40 — Add knowledge (60 s).** New document → paste the home-network guide, add tags, save (Cmd+S). Point at the status badge: "It is split into passages and indexed so it can be found by meaning, not just by words." Add a second document on a different topic. Show a validation message by saving an empty title.

**1:40 — Ask (90 s).** Chat → "How do I make my home Wi-Fi safer?" Let it stream. Click a citation `[1]`: the source panel shows the exact passage. "Every claim points back to a passage you wrote."

**3:10 — Follow-up and honesty (60 s).** Ask "and what about the guest network?" — works as a follow-up. Then ask something not in the documents (e.g. "Who won the 2018 World Cup?"). Point out: "It says it cannot find this in your documents instead of making something up — and it did not even call the model."

**4:10 — Housekeeping (30 s).** Show the conversation list, reload the page (history is kept), delete a conversation with the confirmation. Show it on a phone-width window.

**4:40 — Close (20 s).** "Next steps would be file upload and background indexing. The code walkthrough is in the second video."

## Video 2 — Code walkthrough (for an engineer)

**0:00 — Shape (40 s).** Open the repo tree: `apps/web`, `apps/api`, `packages/shared`, `supabase/migrations`. "Turborepo monorepo, one `.env`, shared types." Show `docker-compose.yml` and run it.

**0:40 — Data and security first (90 s).** Open `20261009120000_tables.sql` and the row level security migration. "The API calls Supabase with the user's own token, so row level security is the real boundary." Open `harden_writes.sql`: revoked direct writes, `SECURITY DEFINER` functions checking `auth.uid()`, row caps. Mention the live test `rls.live.spec.ts` that tries cross-user reads and forged ids against the real database.

**2:10 — Indexing (60 s).** `chunker.ts` (structure-aware, overlap, never splits a character), `indexing.service.ts` (status, hash to skip unchanged text, stale-index rejection, fixed error messages).

**3:10 — The chat path (90 s).** `chat.service.ts`: rewrite → embed → `match_chunks` → threshold → `prompt.ts` (numbered, escaped sources) → stream. Show the no-answer path that skips the model and the abort signal that cancels the provider call. Show `sse.ts` on the client.

**4:40 — Swapping providers (40 s).** `ai.types.ts` ports, `openai-compatible.ts`, then change `AI_BASE_URL` / model in `.env` live (e.g. to Groq) and ask one question. Mention the embedding-dimension and threshold caveats.

**5:20 — Testing (40 s).** Run `npm test`. Explain the layers (unit, fake provider HTTP server, in-memory repositories, live suites) and that I verified key tests by breaking the code on purpose.

**6:00 — Trade-offs (40 s).** Read the "Known limits" section: synchronous indexing, in-memory limits, token in the browser. "What I would do next, in this order."
