# Agent Workflow: Cloud VM + Multi-Agent Pipeline

Status: the E2B sandbox (one per campaign, one agent at a time), the shared agent tools, artifacts and pause/resume are implemented (lib/sandbox, lib/ai/tools, lib/orchestration). Publishing, Blotato and scheduled posts are still design only.

Every campaign gets its own cloud Linux VM: a desktop with file storage, a browser and a terminal. The campaign's agents share that VM, and **several agents can work in it at the same time**. They work as a pipeline: **Research → Creator → Scheduler → Publisher**. Login sessions and files stay on the VM's disk, so they survive the VM being paused and resumed.

Each campaign has a **publish method** setting:

- **AI Agent (Cloud VM).** The Publisher Agent posts through the VM's browser, uploading the video or image itself.
- **Blotato (Fast post).** The post is sent through the Blotato API. No browser or VM is needed for this step.

This builds on what the repo already has:

- The 5 agent roles in `lib/agent-roles.ts`
- `@openai/agents` in `lib/ai/agents.ts`
- Inngest in `lib/inngest/`: a 15-minute cron queues scheduled Master Agent tasks, and `execute-agent-task` runs each one at its time
- Drizzle (`db/schema.ts`) and InsForge (auth, storage, realtime)

---

## 1. Overall flow

```
 Campaign ──1:1── Cloud VM (Linux desktop: one Chrome profile, many tabs + /workspace files)
                         ▲            ▲             ▲              ▲
 [Research] ── research.completed ──▶ [Creator] ── content.completed ──▶ (user approval)
   own browser tab → /workspace/…       reads research, creates video/image post
   + artifact row in DB                 → /workspace/content/… (+ storage for Blotato)
                                                                     │
                                                                     ▼
 [Publisher] ◀── post.scheduled ── [Scheduler]
   step.sleepUntil(scheduled_at)     time / timezone → scheduled_posts row
   publish_method?                   sends a notification
     ├─ vm      → AI agent uploads & posts in the VM browser
     └─ blotato → Blotato API (fast post)
   → status + notification
```

Each agent is an **Inngest function**, and the functions are chained by events:

| Event | Sent by | Starts |
|---|---|---|
| `campaign/research.requested` | Chat / UI | Research |
| `campaign/research.completed` | Research | Creator |
| `campaign/content.completed` | Creator | Approval, then Scheduler |
| `campaign/post.approved` | User (UI) | Scheduler |
| `campaign/post.scheduled` | Scheduler | Publisher |
| `campaign/post.cancelled` / `post.rescheduled` | User (UI) | Cancels the waiting Publisher run |
| `campaign/login.requested` | Any agent | Shows the login prompt in the UI |
| `campaign/login.completed` | User (UI) | Resumes every agent waiting on that platform's login |

Inngest gives you retries, waiting on the user (`waitForEvent`), waiting until a set time (`sleepUntil`) and a record of every run.

Several pipelines can run at the same time in one campaign. For example, Research can be working on TikTok while Creator builds an Instagram post and Publisher posts yesterday's video.

---

## 2. Key design decisions

### 2.1 VM provider

Put the provider behind a small interface in `lib/sandbox/`:

```ts
interface SandboxProvider {
  getOrCreate(campaignId: number): Promise<Sandbox>;
  resume(sandboxId: string): Promise<Sandbox>;
  pause(sandboxId: string): Promise<void>;
}

interface Sandbox {
  files: { read(path: string): Promise<string>; write(path: string, data: string | Buffer): Promise<void>; list(dir: string): Promise<string[]> };
  exec(command: string): Promise<{ stdout: string; stderr: string; exitCode: number }>; // runs scripts inside the VM
  browserCdpUrl(): Promise<string>; // Chrome DevTools endpoint for Playwright
  streamUrl(): Promise<string>;     // VNC / noVNC URL for the desktop viewer
}
```

Two providers fit well:

- **E2B Desktop**
- **Daytona**

Both have a Linux desktop, a persistent filesystem, pause/resume and a VNC stream. Because the code only talks to the interface, you can switch providers later.

### 2.2 Login sessions

Chrome runs inside the VM with a fixed profile folder (`--user-data-dir=/home/user/.chrome-profile`).

- Cookies are stored on the VM's disk, so they survive pause and resume.
- Every agent on the campaign uses the same browser, so every agent shares the same logins.

When an agent finds it isn't logged in:

1. The agent calls the `request_login(platform)` tool. This sends `campaign/login.requested`.
2. The Inngest function waits with `step.waitForEvent("campaign/login.completed", { match: "data.platform", timeout: "1h" })`.
3. The UI shows the VM's live VNC stream. The user types their own password into it. **The agent never sees the user's credentials.**
4. When the user clicks "Done", the UI sends `login.completed` and the agent continues.

If two agents need the same login at once, the UI shows **one** prompt per platform. When `login.completed` arrives, every agent waiting on that platform continues.

Session rules:

- **Do not copy cookies into the app database.** Store only the status: `connected`, `expired` and `last_verified_at`.
- Each provider limits how long a paused VM is kept. Check that limit. If the VM expires, its login sessions are lost too.

### 2.3 Files vs. database

There are two places agents save their work, with different jobs:

- **VM files** are what the user sees on the desktop.
- **The database is what agents use to hand work to each other.**

The database is the source of truth for handoffs because a paused VM is slow to wake, can expire, and can't be queried by Inngest.

Each agent therefore:

1. writes a human-readable file in the VM, and
2. inserts an `artifacts` row with the VM file path, a JSON payload and a summary.

The next agent reads the DB row first. It only opens the VM file if it needs more detail.

### 2.4 VM folder layout

```
/workspace/
  research/2026-10-12/instagram_fitness-trends_<run-id>.md   (+ .json)
  content/2026-10-12/<post-slug>_<run-id>/post.json
  content/2026-10-12/<post-slug>_<run-id>/video.mp4  (or image.png)
  schedule/schedule.json        (copy of the DB rows for the user to read)
  logs/<run-id>.log
  logs/<run-id>/proof.png       (screenshot of the published post, VM mode)
```

File names follow the pattern `<date>/<platform>_<topic-slug>_<run-id>.<ext>`. The run id keeps two agents running at the same time from overwriting each other's files.

### 2.5 Generated media (video and image)

The Creator always saves media into `/workspace/content/...`. The publish method decides what else is needed:

| Publish method | Where the media must be |
|---|---|
| AI Agent (Cloud VM) | The VM file is enough. The Publisher uploads it from the VM through the platform's upload dialog. |
| Blotato (Fast post) | Also upload it to **InsForge storage or ImageKit** to get a **public URL**, then give that URL to Blotato. |

To keep switching methods simple, upload to storage whenever the campaign uses Blotato, or always if you prefer.

### 2.6 Several agents in one VM at the same time

The VM runs one Chrome with one profile, and **each agent run gets its own tab**:

- Chrome can't open the same profile folder twice, so all agents share one Chrome process.
- With Playwright over CDP, every agent opens a **new page in the default context** (`browser.contexts()[0].newPage()`). The default context holds the profile's cookies, so every tab is logged in. A new context (`browser.newContext()`) would **not** share the logins.
- An agent only controls its own tab and closes it when it finishes.

Concurrency rules (Inngest `concurrency` keys):

| Scope | Key | Limit | Why |
|---|---|---|---|
| All agents in one campaign | `event.data.campaignId` | e.g. 4–5 | Keeps the VM's CPU and memory from running out |
| Publishing to one account | `event.data.campaignId + "-" + event.data.platform` | 1 | Two uploads to the same account at once can double-post or get flagged |

**Keeping the VM awake:** the VM must not pause while any agent is working. Each run marks itself active in `sandbox_leases` when it starts and removes that mark when it ends. A cron job pauses the VM only when there are no active leases and it has been idle for N minutes, e.g. 15.

### 2.7 Publishing

There are two publish methods. The campaign setting chooses between them (section 3).

**AI Agent (Cloud VM).** The Publisher Agent posts in the VM's browser, like a person would:

1. Open the platform's upload page in the agent's own tab.
2. Upload the video or image from `/workspace/content/...`.
3. Fill in the caption, hashtags, cover image and other settings, then click post.
4. **Check the post went live.** Open the profile, find the new post, save its URL, and take a screenshot into `/workspace/logs/<run-id>/proof.png`.

Upload from inside the VM, using `sandbox.exec(...)` to run a small Playwright script there. That way the file path is local to Chrome. A file input controlled from outside the VM can't reliably read files on the VM's disk.

**Blotato (Fast post).** Send the caption, the public media URL and the time to the Blotato API. This is faster and doesn't need the VM to be awake. The user connects their accounts in Blotato and saves a Blotato API key in Settings.

Risks of VM mode:

- Posting by driving the browser breaks when a platform changes its page layout.
- Automated posting can get an account flagged.
- Mitigations: confirm every post (step 4 above), retry a limited number of times, and mark the post `failed` with the proof screenshot instead of retrying forever. **Never** report a post as published without confirming it.

### 2.8 How agents control the browser

Connect Playwright over CDP to the Chrome running in the VM. Give the agent these tools:

- `open_url`
- `get_page_text`
- `click`
- `type`
- `scroll`
- `screenshot`
- `upload_file`, which runs inside the VM (section 2.7)

This is cheaper and more reliable than screenshot-based computer use. Keep computer use as a fallback for pages the tools can't handle.

### 2.9 Long agent runs

A single Inngest `step.run` must finish within the serverless function timeout. Two ways to handle runs longer than that:

- Make each agent turn (one model call plus its tool calls) its own step.
- Run the agent loop inside the VM and have it report its results back to the app.

Video uploads are often slow, so the VM-mode publish is the most likely step to need the second approach.

---

## 3. Settings and database additions

### 3.1 Campaign setting: publish method

Add a toggle in the campaign's Settings:

```
Publish posts with
  ( ) AI Agent (Cloud VM)  – the agent posts through the browser in your campaign's computer
  ( ) Blotato (Fast post)  – posts instantly through your Blotato account
```

- Store it as `campaigns.publish_method`: `'vm' | 'blotato'`, default `'vm'`.
- If the user chooses Blotato, ask for their Blotato API key. Store it encrypted and never send it to the browser.
- The Publisher reads the setting **when it wakes up**, not when the post is scheduled. Changing the toggle therefore affects posts that are already scheduled.
- Optional: copy the method onto each `scheduled_posts` row (`publish_method`) so a single post can override the campaign default.

### 3.2 Tables

These go in `db/schema.ts`, with SQL migrations and RLS in `migrations/`.

| Table | Key columns |
|---|---|
| `campaigns` (existing) | add `publish_method` (`vm` / `blotato`) |
| `sandboxes` | `campaign_id` (unique), `provider`, `sandbox_id`, `status` (running / paused / stopped), `last_active_at` |
| `sandbox_leases` | `sandbox_id`, `run_id`, `agent_id`, `started_at`, `heartbeat_at` (one row per agent working in the VM) |
| `platform_connections` | `campaign_id`, `platform`, `kind` (browser_session / blotato), `status`, `handle`, `last_verified_at`, Blotato account id |
| `integration_keys` | `user_id`, `provider` (`blotato`), encrypted API key |
| `workflow_runs` | `campaign_id`, `stage`, `status`, `inngest_run_id`, `input` (jsonb) |
| `artifacts` | `run_id`, `campaign_id`, `agent_id`, `kind` (research / content), `vm_path`, `media_type` (video / image), `media_urls`, `data` (jsonb), `summary` |
| `scheduled_posts` | `artifact_id`, `campaign_id`, `platform`, `caption`, `media_type`, `vm_media_path`, `media_urls`, `scheduled_at` (timestamptz, UTC), `timezone` (IANA, e.g. `Asia/Kolkata`), `publish_method` (optional override), `status`, `external_post_id`, `post_url`, `proof_path`, `error`, `published_at` |
| `notifications` | `user_id`, `campaign_id`, `type`, `payload` (jsonb), `read_at` (pushed to the UI with InsForge realtime) |

A post's status moves through these values:

```
draft → approved → scheduled → publishing → published
                                     └──→ failed
           (any state before publishing) → cancelled
```

Agents can also post progress lines into the existing `agent_messages` table, for example "Uploading video to TikTok…" or "Published: <post url>". The existing agent chat then works as an activity feed.

---

## 4. Stage details

### 4.1 Research Agent

1. Resume the campaign VM, or create it if it doesn't exist. Take a lease.
2. Open its own browser tab.
3. Check that the browser is logged in to the target platform. If not, run the `request_login` flow (section 2.2) and wait.
4. Browse the platform and collect trends, hashtags, competitor posts and audience insights.
5. Write `/workspace/research/<date>/<platform>_<topic>_<run-id>.md` and a matching `.json`.
6. Insert an `artifacts` row (`kind = research`).
7. Close the tab, release the lease, and send `campaign/research.completed` with the artifact id.

### 4.2 Creator Agent

1. Load the research artifact. Use the DB row first and the VM file only if more detail is needed.
2. Write the caption, hook, hashtags and call to action with OpenAI.
3. Create the media: a video, or an image with OpenAI image generation. Use ImageKit for transforms and hosting.
4. Save it to `/workspace/content/<date>/<post-slug>_<run-id>/`. If the campaign uses Blotato, also upload it to storage to get a public URL.
5. Insert an `artifacts` row (`kind = content`) and `scheduled_posts` rows with `status = draft`.
6. Send `campaign/content.completed`.
7. **Recommended:** wait for the user to approve with `step.waitForEvent("campaign/post.approved")`.

### 4.3 Scheduler Agent

1. Choose the best day and time for each platform, using the audience's timezone. If the timezone is unknown, ask the user.
2. Store `scheduled_at` in UTC, plus the IANA `timezone` so the time can be shown in local time.
3. Set `status = scheduled` and write `/workspace/schedule/schedule.json`.
4. Notify the user with a `notifications` row and, optionally, an email.
5. Send `campaign/post.scheduled` with the post id.

### 4.4 Publisher Agent

1. Wait with `step.sleepUntil(scheduled_at)`. Use `cancelOn` with `post.cancelled` / `post.rescheduled`, matched on the post id.
2. When it wakes, check that the post is still `scheduled`, then read the publish method: the post's override if it has one, otherwise `campaigns.publish_method`.
3. Set `status = publishing`.
4. Publish with the chosen method:
   - **VM.** Resume the VM and take a lease. Open a tab and check the login; if logged out, run `request_login`. Upload the media from `vm_media_path` and post it. Confirm it is live, and save `post_url` and `proof_path`.
   - **Blotato.** Make sure the media has a public URL, uploading it to storage if not. Call the Blotato API and save the returned post id or URL.
5. If it succeeds, save `external_post_id`, `post_url` and `published_at`, set `status = published`, and notify the user.
6. If it fails, retry. If the retries also fail, set `status = failed`, save `error` (and `proof_path` in VM mode), and notify the user.
7. VM mode only: close the tab and release the lease.

To reschedule a post, cancel the old run and send a new `post.scheduled` event.

### 4.5 Analytics Agent (later)

This role is already defined but isn't part of the pipeline yet. Later, a cron job can pull metrics for `published` posts and feed what it learns back to the Research Agent.

---

## 5. Where the code would go

```
lib/sandbox/
  provider.ts          SandboxProvider interface
  e2b.ts               (or daytona.ts) provider implementation
  browser.ts           Playwright-over-CDP helpers (one tab per agent run)
  leases.ts            take / release / heartbeat; idle-pause check
  files.ts             read/write helpers
  paths.ts             builds /workspace/... paths from date, platform, slug and run id

lib/publishing/
  index.ts             publishPost(post): picks the method and returns { externalId, url }
  vm.ts                uploads and posts in the VM browser, then confirms the post is live
  blotato.ts           Blotato API client

lib/ai/tools/
  browser.ts           open_url, get_page_text, click, type, scroll, screenshot
  upload-file.ts       runs the upload inside the VM
  workspace-files.ts   read_file, write_file, list_files
  request-login.ts     asks the user to log in, then waits
  media.ts             image / video generation and upload

lib/ai/agents.ts       give each role its tools; update the prompts (e.g. "You cannot browse…",
                       "You cannot publish anything yourself yet…")

lib/workflow/
  events.ts            zod-typed Inngest event schemas
  artifacts.ts         artifact DB helpers
  posts.ts             scheduled_posts DB helpers

lib/inngest/functions/
  research.ts
  creator.ts
  scheduler.ts
  publisher.ts
  sandbox-idle.ts      cron job: pause VMs with no leases (replaces the example functions)

app/api/sandbox/...    start / pause / stream-URL routes
components/sandbox/
  desktop-viewer.tsx   VNC iframe, used for logging in and watching agents work
components/agents/agent-settings.tsx   add the "Publish posts with" toggle and Blotato key field
```

---

## 6. Build order

1. VM interface and desktop viewer, with pause and resume working.
2. Logging in, and checking the session survives in the Chrome profile.
3. One tab per agent, leases, and the idle-pause cron job. Test two agents running at once.
4. Research tools, the `artifacts` table and VM file writing.
5. Creator Agent and media (video and image), plus storage upload.
6. The `scheduled_posts` table, Scheduler Agent and notifications.
7. The publish-method setting and the Blotato publisher (the simpler method, which proves the scheduling end to end).
8. The VM publisher: upload, post and confirm.
9. The approval step and a UI for watching runs.

---

## 7. Open decisions

- **VM provider:** E2B Desktop or Daytona.
- **Approval:** whether posts need user approval before they are scheduled, or the pipeline runs fully on its own.
- **Concurrency limit:** how many agents may run in one VM at once. This depends on the VM size.
- **Publish method level:** campaign-wide only, or overridable on each post.
