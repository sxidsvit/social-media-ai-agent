# Chapter 11 — Campaign brief, platform rules and team memory (shared by every agent)

Copy everything below the line into your AI coding agent (Claude Code, Cursor, etc.) from the root of
your project. Your code should match the end of Chapter 10 (E2B sandboxes). Do this chapter before
the per-agent chapters (12–15): they all read the brief, the platform rules and the memory built here.

---

You are working in my Next.js (App Router) + TypeScript project: a social media AI agent app. It
already has:

- InsForge auth/Postgres with Drizzle ORM (`db/schema.ts`, `db/index.ts`, SQL files in `migrations/`)
- The OpenAI Agents SDK (`@openai/agents`): a **Master Agent** (`lib/ai/master.ts`) and worker agents
  `research`, `creator`, `scheduler`, `analytics` (`lib/agent-roles.ts`, `lib/ai/agents.ts`)
- Per-agent task setup in `lib/ai/agent-definitions.ts` (`taskInstructions`, `tools`, `maxTurns`,
  `timeLimit`) and the shared worker tools in `lib/ai/tools/` (`runtime.ts`, `context.ts`,
  `computer-action.ts`, `file-storage.ts`, `generate-image.ts`, `user-and-result.ts`)
- Orchestration in `lib/orchestration/` and Inngest functions in `lib/inngest/functions.ts`
- E2B desktops for Research and Creator (`lib/sandbox/`), ImageKit storage (`lib/storage/imagekit.ts`)
  and task artifacts (`agent_artifacts`)

Read those files first and follow their style: short "why" comments, `server-only` modules, strict
tool schemas (optional fields are `.nullable()`, not `.optional()`), `setStep(context, "...")` at the
start of each tool, errors returned to the model as text it can act on rather than thrown, and SQL
migrations with `IF NOT EXISTS`, RLS on, users `SELECT` only their own rows, only the server writes.

## Goal

Today every agent guesses the brand voice, audience, platforms and time zone, and forgets everything
between tasks. Give the whole team:

1. A **campaign brief** the user fills in once (brand, voice, audience, goals, platforms, time zone,
   competitors, do's and don'ts, brand colours and logo), injected into every agent's instructions.
2. One **platform rules** registry (caption limits, hashtags, media sizes, formats) that the Creator,
   Scheduler and Analytics chapters reuse.
3. A **campaign memory** every agent can read and add to, so decisions, user preferences and lessons
   learned carry over from task to task.

## 1. Database (one migration, mirrored in `db/schema.ts`)

- `campaign_profiles`, primary key `campaign_id` (FK cascade): `user_id`, `brand_name`, `description`,
  `voice` (free text, e.g. "friendly, witty, no slang"), `audience`, `goals`, `platforms text[]`,
  `time_zone` (IANA, default `'UTC'`), `language` (default `'en'`), `competitors text[]` (handles or
  URLs), `dos text[]`, `donts text[]`, `brand_colors jsonb default '[]'` (hex strings), `fonts jsonb
  default '[]'`, `logo_url`, `requires_approval boolean default true` (used in Chapter 14: nothing is
  published without the user's OK unless they turn this off), `updated_at`.
- `campaign_memories`: `id bigserial`, `user_id`, `campaign_id`, `agent_id` (who wrote it, or `'user'`),
  `kind` (`fact|decision|preference|learning`), `content text` (max ~500 chars, check constraint),
  `source_task_id` (nullable FK, set null), `pinned boolean default false`, `created_at`. Index on
  `(campaign_id, pinned desc, id desc)`.

## 2. Platform rules (`lib/social/platforms.ts`, not server-only: the UI uses it too)

A typed `PLATFORMS` record keyed by `PlatformId` (`instagram | tiktok | youtube | x | linkedin |
facebook | threads | pinterest`). For each: `name`, `captionMax`, `hashtagMax` (null when there's no
hard cap) and `hashtagAdvice`, `linksClickable` in captions, `truncatesAt` (characters shown before
"more", where known), `formats` (e.g. `feed | carousel | reel | story | short | video | thread |
article | pin`) each with `aspects` (`1:1 | 4:5 | 9:16 | 16:9 | 2:3`) and pixel `sizes`, `carouselMax`,
`videoMaxSeconds`, and `checkedAt` (the date you verified the numbers).

Starting values to verify: Instagram caption 2,200, carousel up to 20, feed 1080×1350 (4:5),
reels/stories 1080×1920; X 280 characters (non-Premium); LinkedIn post 3,000; Threads 500; TikTok
caption 4,000; Facebook ~63,000; YouTube title 100 and description 5,000; Pinterest title 100 and
description 500, pins 1000×1500. **Platforms change these often (Instagram's hashtag limit
included): check each against the platform's current help pages, fix anything that's changed and set
`checkedAt`.** Add helpers `platformRules(ids)` (compact text for prompts) and `formatSpec(platform,
format)`.

## 3. Brief in every prompt (`lib/campaign-brief.ts`, server-only)

- `getCampaignBrief(scope)` loads the profile (or `null`) and `briefForPrompt(profile)` renders a
  compact plain-text block (≤ ~1,200 characters) plus `platformRules(profile.platforms)`. Missing
  fields are left out, never filled with placeholders.
- Add the block to: worker task instructions (`lib/orchestration/worker.ts`, next to the existing
  `extra`), worker chat instructions (`AgentRunContext` gets `brief?: string`) and the Master Agent's
  instructions. Cache the profile per request (see `lib/request-scope.ts`), not across requests.
- When the brief is empty, the Master Agent asks the user the 3–4 questions that matter most for the
  request (platforms, audience, voice, time zone) at most once per conversation, or carries on with
  stated defaults if the user says to.

## 4. Tools (`lib/ai/tools/campaign.ts`), given to **every** worker in `worker.ts`

- `get_campaign_brief` — no parameters; returns the full profile and the full rules for its
  platforms (the prompt only carries the compact version).
- `campaign_memory` — `action: "recall" | "remember"`.
  - `recall`: `query` (nullable) → pinned memories, then the best matches (`ILIKE` on words of the
    query is enough for now), then the newest; at most 15, each with kind, author and date.
  - `remember`: `kind`, `content`. At most 5 per task run (count in `WorkerContext`); reject near
    duplicates (same kind and normalised content); never store secrets, passwords, personal data
    about third parties or raw page text.
- Instructions (add to the shared worker rules): recall at the start of a task when the task touches
  something the team may have decided before; remember only things a teammate would need on a future
  task (a user preference, a decision, a result-backed learning), not progress notes.
- Give the Master Agent `campaign_memory` too, and have it remember explicit user preferences it hears
  in chat ("never use emojis on LinkedIn").

## 5. UI

- Campaign settings: a **Brand** form for the profile (platform multi-select, time-zone picker,
  colour swatches, logo upload to the existing storage) with a server action that validates with zod.
- A **Memory** list: filter by kind, pin/unpin, delete, and add a memory by hand (`agent_id = 'user'`).
- In the overview, a nudge card "Fill in your campaign brief" while the profile is empty.

## 6. Done when

1. `npx tsc --noEmit` and `npm run lint` pass, and the migration applies cleanly.
2. After filling the brief, a new Creator task uses the right voice and platforms without being told,
   and a Scheduler answer states the campaign's time zone.
3. Telling the Master Agent "we never post on Sundays" creates a pinned-worthy `preference` memory, and
   a later Scheduler task recalls it.
4. With an empty brief, the Master asks its short questions once, then proceeds.

Work in order (DB → platforms → brief injection → tools → UI) and type-check after each part.
