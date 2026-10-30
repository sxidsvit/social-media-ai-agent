-- One E2B desktop per agent per campaign (instead of one per campaign shared by its agents), so
-- agents with a computer can work at the same time. Each agent keeps its own logins and files;
-- they hand files to each other as uploaded artifacts. The lease now only stops one agent from
-- running two of its own tasks at once.
-- Rows are written by the server only; users can read their own.

CREATE TABLE IF NOT EXISTS public.agent_sandboxes (
  campaign_id integer NOT NULL REFERENCES public.campaigns(id) ON DELETE CASCADE,
  agent_id text NOT NULL,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  sandbox_id text,
  status text NOT NULL DEFAULT 'none' CHECK (status IN ('none', 'starting', 'running', 'paused', 'killed')),
  -- Last agent or user activity; a running sandbox idle for 3 minutes is paused
  active_at timestamptz,
  -- The agent's task using the sandbox, and until when (renewed while it works)
  task_id bigint REFERENCES public.agent_tasks(id) ON DELETE SET NULL,
  lease_until timestamptz,
  -- 'user' while the user has taken over: the agent stops at its next action
  control text NOT NULL DEFAULT 'agent' CHECK (control IN ('agent', 'user')),
  -- Passwords for the desktop stream: full control, and view only
  stream_key text,
  view_key text,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (campaign_id, agent_id)
);

-- The idle-pause cron's lookup
CREATE INDEX IF NOT EXISTS agent_sandboxes_running_idx ON public.agent_sandboxes (active_at) WHERE status = 'running';

-- The campaign's existing desktop goes to the Research Agent (the one that logs in to platforms),
-- so its logins and files stay in use. The other agents get a new desktop when they first need one.
INSERT INTO public.agent_sandboxes (campaign_id, agent_id, user_id, sandbox_id, status, active_at, control, stream_key, view_key)
SELECT id, 'research', user_id, sandbox_id, sandbox_status, sandbox_active_at, sandbox_control, sandbox_stream_key, sandbox_view_key
FROM public.campaigns
WHERE sandbox_id IS NOT NULL
ON CONFLICT (campaign_id, agent_id) DO NOTHING;

-- The campaign-level columns are no longer used (ended_at stays: it ends every agent's desktop)
ALTER TABLE public.campaigns
  DROP COLUMN IF EXISTS sandbox_task_id,
  DROP COLUMN IF EXISTS sandbox_lease_until,
  DROP COLUMN IF EXISTS sandbox_control,
  DROP COLUMN IF EXISTS sandbox_stream_key,
  DROP COLUMN IF EXISTS sandbox_view_key,
  DROP COLUMN IF EXISTS sandbox_active_at,
  DROP COLUMN IF EXISTS sandbox_status,
  DROP COLUMN IF EXISTS sandbox_id;
DROP INDEX IF EXISTS public.campaigns_sandbox_running_idx;

-- Previews are per agent too; the existing one belongs to the Research Agent's desktop
ALTER TABLE public.sandbox_previews ADD COLUMN IF NOT EXISTS agent_id text NOT NULL DEFAULT 'research';
ALTER TABLE public.sandbox_previews ALTER COLUMN agent_id DROP DEFAULT;
ALTER TABLE public.sandbox_previews DROP CONSTRAINT IF EXISTS sandbox_previews_pkey;
ALTER TABLE public.sandbox_previews ADD PRIMARY KEY (campaign_id, agent_id);

ALTER TABLE public.agent_sandboxes ENABLE ROW LEVEL SECURITY;

CREATE POLICY agent_sandboxes_owner_select ON public.agent_sandboxes
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

REVOKE ALL ON public.agent_sandboxes FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public.agent_sandboxes FROM authenticated;
GRANT SELECT ON public.agent_sandboxes TO authenticated;
