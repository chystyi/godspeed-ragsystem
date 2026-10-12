# Loom scripts

The assignment asks for two walkthroughs, both linked in the README. The first is also emailed
(to harish@goodspeed.studio and clinton@goodspeed.studio) and must be **no longer than 5 minutes**; keep
the second under 5 as well.

Before recording: `docker compose up --build`, a fresh account, an empty library, two or three short
documents ready to paste (a home-network guide, a recipe, a project note). Speak plainly; show, do not read.

## Video 1 — What I built (max 5 min)

**0:00 — What it is (15 s).** "A personal knowledge base: you write or upload documents, then ask questions about them. Answers use your own text and show where each claim came from."

**0:15 — Sign in and add knowledge (70 s).** Sign in (each user sees only their own data). New document → paste the home-network guide, tags, save with Cmd+S; point at the status badge ("the text is split into passages and embedded so it can be found by meaning"). Then **upload a PDF** (the orchid guide): the text is extracted and filled in for review, save. Save an empty title to show validation.

**1:25 — Ask, with sources (70 s).** Chat → "How do I make my home Wi-Fi safer?" The answer streams in. Click citation `[1]`: the exact passage opens. Ask a follow-up ("and the guest network?") — it understands the context.

**2:35 — Beyond the documents (40 s).** Say "Hello", then ask something general, then one in Russian. "When nothing in your documents applies it answers as a normal assistant, in your language, and does not pretend it came from your documents — no sources." Switch the model in the selector and ask again.

**3:15 — Usage (20 s).** Open *Usage*: tokens for answers and embeddings, per day and per model. "Counted as the provider reports them."

**3:35 — Under the hood (70 s).** Repo tree for 10 s (Turborepo: `apps/web`, `apps/api`, `packages/shared`, `supabase/migrations`). Two points, ~25 s each:
1. The API acts as the user, so row level security is the real access control; writes go through functions that check `auth.uid()`; limits live in the database.
2. The AI layer is two small ports and one OpenAI-compatible adapter: show `.env`, change `AI_BASE_URL` / model and it is another provider (OpenRouter, Groq, Ollama).

**4:45 — Close (15 s).** "About 600 tests, including live suites against the real database. The README lists what I would do next."

## Video 2 — How I used AI to move faster (max 5 min)

Be concrete and honest; show real artifacts (the git log, a test, a review report). The point is judgment, not speed.

**0:00 — Setup (30 s).** "I built this with Claude Code in the terminal. I decided the architecture and the product rules; the AI wrote most of the code under tests I asked for." Show the commit history: small steps, one concern each.

**0:30 — Decisions were mine (45 s).** Examples: Supabase + pgvector instead of a separate vector store (row level security covers retrieval too); the API acts with the user's token; a provider layer with two ports instead of one SDK call. "I used the AI to challenge these, then chose."

**1:15 — Tests first, and tests that are tested (60 s).** Show a spec written before the code (red, then green). Show one mutation check: break the code on purpose and watch the test fail. "A passing test proves little until you have seen it fail."

**2:15 — AI reviewing AI (75 s).** I had separate agents hunt for vulnerabilities and bugs, then verified every finding myself before fixing it. Show the report: real catches (a way to bypass limits by calling the database directly, a stale-index race, an API key that could be sent to the wrong provider) and findings I declined or documented (per-IP limits, token revocation). Point out that agent reports are claims to check, not truth.

**3:30 — Where the AI was wrong and how I caught it (60 s).** Pick two: a commit message that said all tests passed while one timed out (found, fixed, admitted); a focus ring that showed as a double black frame because a global CSS rule overrode the utility classes (found by looking at the real screen, not by tests). Also: the first RAG behavior refused everything outside the documents — a product call I changed after using it.

**4:30 — Takeaways (30 s).** What worked: small steps, tests as the contract, reviews by a second pair of eyes (human or agent), checking the running app. What I would still not delegate: architecture, security boundaries, and deciding what "done" means.
