-- Scheduled tasks: the Master Agent picks when each task runs (and whether it repeats). A cron in
-- Inngest queues tasks shortly before they're due, and an Inngest function runs each one.
--
-- A task can only run once per dispatch: queue_seq goes up by one every time a task moves from
-- pending to queued, the run that claims it records itself in run_owner, and agent_task_runs keeps
-- one row per (task, dispatch).

ALTER TABLE public.agent_tasks
  -- When the task should run (for a repeating task, its next run)
  ADD COLUMN IF NOT EXISTS scheduled_at timestamptz NOT NULL DEFAULT now(),
  -- Repeat rule (see lib/orchestration/types.ts RepeatRule); null for a one-off task
  ADD COLUMN IF NOT EXISTS repeat jsonb,
  -- The run after scheduled_at, for display; null when the task doesn't repeat or its rule ran out
  ADD COLUMN IF NOT EXISTS next_run_at timestamptz,
  ADD COLUMN IF NOT EXISTS run_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS consecutive_failures integer NOT NULL DEFAULT 0,
  -- Bumped on every pending → queued move; identifies one dispatch to Inngest
  ADD COLUMN IF NOT EXISTS queue_seq integer NOT NULL DEFAULT 0,
  -- Inngest run id that claimed the current dispatch; only that run may write the result
  ADD COLUMN IF NOT EXISTS run_owner text;

ALTER TABLE public.agent_tasks DROP CONSTRAINT IF EXISTS agent_tasks_status_check;
ALTER TABLE public.agent_tasks ADD CONSTRAINT agent_tasks_status_check
  CHECK (status IN ('pending', 'queued', 'in_progress', 'in_review', 'awaiting_input', 'completed', 'failed', 'cancelled'));

-- The cron's lookup: pending tasks due soon
CREATE INDEX IF NOT EXISTS agent_tasks_due_idx ON public.agent_tasks (scheduled_at) WHERE status = 'pending';

-- One row per execution, so a repeating task keeps every result
CREATE TABLE IF NOT EXISTS public.agent_task_runs (
  id bigserial PRIMARY KEY,
  task_id bigint NOT NULL REFERENCES public.agent_tasks(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  campaign_id integer NOT NULL REFERENCES public.campaigns(id) ON DELETE CASCADE,
  queue_seq integer NOT NULL,
  scheduled_for timestamptz NOT NULL,
  inngest_run_id text NOT NULL,
  status text NOT NULL DEFAULT 'in_progress' CHECK (status IN ('in_progress', 'completed', 'failed', 'cancelled')),
  output text,
  error text,
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  -- A dispatch is executed at most once
  UNIQUE (task_id, queue_seq)
);

CREATE INDEX IF NOT EXISTS agent_task_runs_task_idx ON public.agent_task_runs (task_id, id DESC);
CREATE INDEX IF NOT EXISTS agent_task_runs_campaign_id_idx ON public.agent_task_runs (campaign_id);

ALTER TABLE public.agent_task_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY agent_task_runs_owner_select ON public.agent_task_runs
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

REVOKE ALL ON public.agent_task_runs FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public.agent_task_runs FROM authenticated;
GRANT SELECT ON public.agent_task_runs TO authenticated;
