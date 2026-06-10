# Bagel 🥯

**A public wiki of everyone in a field.** Upload a list of names, point an AI
research agent at them, and get a fast, searchable directory where every person
has a wikipedia-style page they can claim and correct.

Codename "Bagel" — built for communities like EA / AI safety / forecasting,
where "who is this person?" is a question people ask constantly. See
[SPEC.md](./SPEC.md) for the original product spec.

## What it does

- **Directory** (`/`) — a table of everyone in the index with in-memory name
  search, tag/org filters, and Profiled/Unprofiled/Claimed views. Built to stay
  fast at 10k+ people: the table query only loads light per-person rows;
  long-form content lives on a separate linked entity. Searching a name that
  isn't in the index (or adding a same-named-but-different person) offers an
  inline "add to the index" row with an optional context hint (e.g. a LinkedIn
  URL) to guide future research.
- **Profiles** (`/p/<slug>`, e.g. `/p/alice-smith`) — a one-sentence bio, a
  short summary, a ~1000-word wikipedia-style article, links to their web
  presences, and structured facts (primary org, other affiliations, plaintext
  field tags). Each page shows where the person was sourced from and whether
  the content is AI-drafted or human-edited.
- **AI profile generation** — anyone can click one of two buttons on a profile:
  - **⚡ Fast profile** — Claude Haiku, up to 3 web searches. A quick draft in
    ~30 seconds.
  - **◉ Deep research** — Claude Opus with extended thinking, up to 10 web
    searches. A few minutes, much more thorough.

  While a run is active, the page streams a live "thinking trace" — search
  queries, result titles, reasoning summaries — synced in real time to every
  viewer via InstantDB.
- **Claiming** — people sign in with a magic code to claim their own page. If
  their sign-in email matches the email on file (from a CSV upload), the claim
  is instant; otherwise they submit a request that an admin approves. Claimed
  and human-edited profiles are never overwritten by the agent.
- **Admin** (`/admin`) — bulk intake via CSV upload (name + optional email
  columns) or pasted names (comma- or newline-separated, with a parse
  preview); each upload records a source description ("Attendees of Manifest
  2025") shown on profiles for provenance. Plus a generation queue (queue all
  unprofiled / retry failed) and claim-request review.
- **Batch generation** — `bun run generate` processes the queue from the
  command line for big batches (100+ people), with `--mode fast|deep`,
  `--limit`, `--slugs`, `--concurrency`, and `--force` flags.

## Stack

- [Next.js](https://nextjs.org) (App Router) + Tailwind CSS v4
- [InstantDB](https://instantdb.com) — client-side database with real-time
  sync, auth, and permissions. Powers the live directory, the streaming
  generation trace, and magic-code sign-in.
- [Claude API](https://platform.claude.com) — profile research via the
  `web_search` server tool, structured extraction via `messages.parse` + Zod.
- Bun for scripts and package management.

## Getting started

1. **Install deps**: `bun install`
2. **Environment** — copy `.env.example` to `.env` and fill in:
   - `NEXT_PUBLIC_INSTANT_APP_ID` / `INSTANT_APP_ADMIN_TOKEN` — from
     `npx instant-cli init-without-files --title bagel` (or the
     [Instant dashboard](https://instantdb.com/dash))
   - `ANTHROPIC_API_KEY` — for profile generation
3. **Push schema + permissions**:
   ```sh
   npx instant-cli push schema --yes
   npx instant-cli push perms --yes
   ```
4. **Seed** the initial people: `bun run seed`
5. **Run**: `bun run dev` → http://localhost:3000
6. **Make yourself admin**: sign in once in the app, then set
   `isAdmin: true` on your `$users` row in the Instant dashboard
   (Explorer → `$users`). The Admin nav link appears on next load.

## Scripts

| Command | What it does |
| --- | --- |
| `bun run dev` | Next.js dev server |
| `bun run seed` | Seed the initial people list |
| `bun run generate` | Generate profiles for everyone with status `queued` (deep mode by default) |
| `bun run generate -- --mode fast --limit 10` | Quick drafts for the first 10 queued |
| `bun run generate -- --slugs alice-smith --force` | Regenerate specific people |
| `bun run typecheck` | `tsc --noEmit` |

## How generation works

`src/lib/profileAgent.ts` is shared by the `/api/generate` route (button
clicks) and `scripts/generate-profiles.ts` (batches). Each run:

1. Creates a `runs` entity and flips the person to `generating` — the UI
   reacts instantly via Instant's sync.
2. **Research pass** — Claude searches the web (disambiguated by the person's
   source lists, any provided context hint, and email if on file) and writes a
   plain-text dossier. Search queries, results, and thinking summaries are
   appended to the run's `trace` as they happen.
3. **Extraction pass** — a second call converts the dossier into a structured
   profile (Zod-validated JSON: bio, summary, article, orgs, tags, links).
4. Writes the profile and marks the run `done` — or `failed`, with the error
   in the trace, retryable from the UI.

If the agent can't confidently identify someone, it says so and writes a
minimal page inviting the person to claim and fill it in, rather than
hallucinating a biography.

## Data model

| Entity | Holds |
| --- | --- |
| `people` | Light row per person: name, unique slug, email, bio, primary org, org/tag arrays, status, context hint. The directory loads only these. |
| `profiles` | Heavy content, one per person: summary, article, links, generation metadata. |
| `runs` | One per generation attempt: mode, status, live trace events. |
| `sources` | One per intake batch: description + date, linked to its people. |
| `claims` | Claim requests pending admin review. |
| `$users` | Instant auth users; `isAdmin` flag gates the admin UI and perms. |

Permissions are deny-by-default: profiles are publicly readable, but writes
require being an admin or the profile's claimer. Creation, claiming, and
generation go through API routes using the Instant admin SDK so validation
stays server-side.

## Future work (designed for, not built)

- **AI chat** over the directory: paste a job listing or speaker call and get
  a table of matches; draft outreach in your own voice; find warm intro paths.
- **Digital twin**: "speak with [Alice Smith]" from her profile page.
