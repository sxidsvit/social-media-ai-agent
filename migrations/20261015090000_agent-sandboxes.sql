-- E2B desktop sandboxes: one per campaign, shared by the campaign's agents (one agent at a time),
-- so logins and files carry over. Agents hand files to each other as artifacts, and a run that
-- needs the user (a login, a takeover) is saved and resumed later.
-- Rows are written by the server only; users can read their own.

-- The campaign's sandbox, who holds it, and whether the user has taken control
ALTER TABLE public.campaigns
  ADD COLUMN IF NOT EXISTS sandbox_id text,
  ADD COLUMN IF NOT EXISTS sandbox_status text NOT NULL DEFAULT 'none',
  -- Last agent or user activity; a running sandbox idle for 3 minutes is paused
  ADD COLUMN IF NOT EXISTS sandbox_active_at timestamptz,
  -- The task holding the sandbox (one agent at a time), and until when (renewed while it works)
  ADD COLUMN IF NOT EXISTS sandbox_task_id bigint REFERENCES public.agent_tasks(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS sandbox_lease_until timestamptz,
  -- 'user' while the user has taken over: the agent stops at its next action
  ADD COLUMN IF NOT EXISTS sandbox_control text NOT NULL DEFAULT 'agent',
  -- Passwords for the desktop stream: full control, and view only
  ADD COLUMN IF NOT EXISTS sandbox_stream_key text,
  ADD COLUMN IF NOT EXISTS sandbox_view_key text,
  -- Set when the user ends the campaign: files are exported and the sandbox is killed
  ADD COLUMN IF NOT EXISTS ended_at timestamptz;

ALTER TABLE public.campaigns DROP CONSTRAINT IF EXISTS campaigns_sandbox_status_check;
ALTER TABLE public.campaigns ADD CONSTRAINT campaigns_sandbox_status_check
  CHECK (sandbox_status IN ('none', 'starting', 'running', 'paused', 'killed'));
ALTER TABLE public.campaigns DROP CONSTRAINT IF EXISTS campaigns_sandbox_control_check;
ALTER TABLE public.campaigns ADD CONSTRAINT campaigns_sandbox_control_check
  CHECK (sandbox_control IN ('agent', 'user'));

-- The idle-pause cron's lookup
CREATE INDEX IF NOT EXISTS campaigns_sandbox_running_idx ON public.campaigns (sandbox_active_at) WHERE sandbox_status = 'running';

-- waiting_for_user: the run is saved (run_state) until the user does something in the sandbox
-- expired: nobody resumed it in time
ALTER TABLE public.agent_tasks
  ADD COLUMN IF NOT EXISTS sandbox_id text,
  -- Serialized OpenAI Agents RunState of a paused run, or null
  ADD COLUMN IF NOT EXISTS run_state text,
  -- Why it's waiting: { kind: 'login' | 'action' | 'takeover', reason, url, platform }
  ADD COLUMN IF NOT EXISTS interruption jsonb,
  -- What the agent is doing right now, e.g. "Opening instagram.com"
  ADD COLUMN IF NOT EXISTS current_step text,
  ADD COLUMN IF NOT EXISTS waiting_since timestamptz,
  ADD COLUMN IF NOT EXISTS expires_at timestamptz;

ALTER TABLE public.agent_tasks DROP CONSTRAINT IF EXISTS agent_tasks_status_check;
ALTER TABLE public.agent_tasks ADD CONSTRAINT agent_tasks_status_check
  CHECK (status IN ('pending', 'queued', 'in_progress', 'in_review', 'awaiting_input', 'waiting_for_user', 'completed', 'failed', 'cancelled', 'expired'));

-- The expiry cron's lookup
CREATE INDEX IF NOT EXISTS agent_tasks_waiting_idx ON public.agent_tasks (expires_at) WHERE status = 'waiting_for_user';

-- The structured result an agent reported (report_result) for one run
ALTER TABLE public.agent_task_runs ADD COLUMN IF NOT EXISTS result jsonb;

-- Files and links the agents produced. Task-less rows are files exported when the campaign ended.
CREATE TABLE IF NOT EXISTS public.agent_artifacts (
  id bigserial PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  campaign_id integer NOT NULL REFERENCES public.campaigns(id) ON DELETE CASCADE,
  plan_id bigint REFERENCES public.agent_plans(id) ON DELETE CASCADE,
  task_id bigint REFERENCES public.agent_tasks(id) ON DELETE CASCADE,
  task_run_id bigint REFERENCES public.agent_task_runs(id) ON DELETE SET NULL,
  agent_id text,
  type text NOT NULL CHECK (type IN ('image', 'video', 'document', 'data', 'link')),
  name text NOT NULL,
  -- Permanent ImageKit URL (or an external link); null for a file that only lives in the sandbox
  url text,
  imagekit_file_id text,
  sandbox_path text,
  mime_type text,
  metadata jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS agent_artifacts_task_idx ON public.agent_artifacts (task_id, id DESC);
CREATE INDEX IF NOT EXISTS agent_artifacts_campaign_idx ON public.agent_artifacts (campaign_id, id DESC);
CREATE INDEX IF NOT EXISTS agent_artifacts_task_run_idx ON public.agent_artifacts (task_run_id);

-- The sandbox's last screenshot, shown while it's paused. Kept out of campaigns so listing
-- campaigns never loads images.
CREATE TABLE IF NOT EXISTS public.sandbox_previews (
  campaign_id integer PRIMARY KEY REFERENCES public.campaigns(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  -- Base64 PNG
  image text NOT NULL,
  taken_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.agent_artifacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sandbox_previews ENABLE ROW LEVEL SECURITY;

CREATE POLICY agent_artifacts_owner_select ON public.agent_artifacts
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY sandbox_previews_owner_select ON public.sandbox_previews
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

REVOKE ALL ON public.agent_artifacts, public.sandbox_previews FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public.agent_artifacts, public.sandbox_previews FROM authenticated;
GRANT SELECT ON public.agent_artifacts, public.sandbox_previews TO authenticated;
