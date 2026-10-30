-- Master Agent orchestration: the Master Agent turns a user request into a plan of tasks, assigns
-- each task to a worker agent, and tracks every status change and message between the agents.
-- Rows are written by the server only; users can read their own.

-- The Master Agent gets its own chat with the user
ALTER TABLE public.agent_messages DROP CONSTRAINT IF EXISTS agent_messages_agent_id_check;
ALTER TABLE public.agent_messages ADD CONSTRAINT agent_messages_agent_id_check
  CHECK (agent_id IN ('master', 'research', 'creator', 'scheduler', 'publisher', 'analytics'));

-- One user request, as planned by the Master Agent
CREATE TABLE IF NOT EXISTS public.agent_plans (
  id bigserial PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  campaign_id integer NOT NULL REFERENCES public.campaigns(id) ON DELETE CASCADE,
  title text NOT NULL,
  -- What the user asked for, in the Master Agent's words
  request text NOT NULL,
  status text NOT NULL DEFAULT 'in_progress'
    CHECK (status IN ('in_progress', 'awaiting_user', 'completed', 'failed', 'cancelled')),
  -- The Master Agent's report once every task is done
  summary text,
  error text,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now(),
  completed_at timestamp
);

CREATE INDEX IF NOT EXISTS agent_plans_campaign_idx ON public.agent_plans (user_id, campaign_id, id DESC);
CREATE INDEX IF NOT EXISTS agent_plans_campaign_id_idx ON public.agent_plans (campaign_id);

-- One assignment from the Master Agent to a worker agent
CREATE TABLE IF NOT EXISTS public.agent_tasks (
  id bigserial PRIMARY KEY,
  plan_id bigint NOT NULL REFERENCES public.agent_plans(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  campaign_id integer NOT NULL REFERENCES public.campaigns(id) ON DELETE CASCADE,
  -- Worker agent role id (see lib/agent-roles.ts); the Master Agent never assigns to itself
  agent_id text NOT NULL CHECK (agent_id IN ('research', 'creator', 'scheduler', 'publisher', 'analytics')),
  -- Order within the plan
  position integer NOT NULL DEFAULT 0,
  title text NOT NULL,
  instructions text NOT NULL,
  -- Tasks (same plan) that must be completed before this one can start
  depends_on bigint[] NOT NULL DEFAULT '{}',
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'in_progress', 'in_review', 'awaiting_input', 'completed', 'failed', 'cancelled')),
  -- The worker's deliverable
  output text,
  -- Open question waiting on the user (status = awaiting_input)
  question text,
  -- The Master Agent's latest review notes
  review text,
  -- Times the Master Agent sent the work back, and runs attempted (failed runs are retried)
  revisions integer NOT NULL DEFAULT 0,
  attempts integer NOT NULL DEFAULT 0,
  error text,
  started_at timestamp,
  completed_at timestamp,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS agent_tasks_plan_idx ON public.agent_tasks (plan_id, position);
CREATE INDEX IF NOT EXISTS agent_tasks_agent_idx ON public.agent_tasks (user_id, campaign_id, agent_id, id DESC);
CREATE INDEX IF NOT EXISTS agent_tasks_campaign_id_idx ON public.agent_tasks (campaign_id);
CREATE INDEX IF NOT EXISTS agent_tasks_status_idx ON public.agent_tasks (status, updated_at);

-- Everything the agents say to each other (and the Master Agent's questions to the user)
CREATE TABLE IF NOT EXISTS public.agent_communications (
  id bigserial PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  campaign_id integer NOT NULL REFERENCES public.campaigns(id) ON DELETE CASCADE,
  plan_id bigint NOT NULL REFERENCES public.agent_plans(id) ON DELETE CASCADE,
  task_id bigint REFERENCES public.agent_tasks(id) ON DELETE CASCADE,
  -- Agent role id, or 'user'
  from_agent text NOT NULL,
  to_agent text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('assignment', 'question', 'answer', 'update', 'result', 'review', 'clarification', 'error')),
  text text NOT NULL,
  created_at timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS agent_communications_plan_idx ON public.agent_communications (plan_id, id);
CREATE INDEX IF NOT EXISTS agent_communications_task_idx ON public.agent_communications (task_id, id);
CREATE INDEX IF NOT EXISTS agent_communications_campaign_id_idx ON public.agent_communications (campaign_id);

-- Read-only for their owner; the server writes through the database connection
ALTER TABLE public.agent_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_communications ENABLE ROW LEVEL SECURITY;

CREATE POLICY agent_plans_owner_select ON public.agent_plans
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY agent_tasks_owner_select ON public.agent_tasks
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY agent_communications_owner_select ON public.agent_communications
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

REVOKE ALL ON public.agent_plans, public.agent_tasks, public.agent_communications FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public.agent_plans, public.agent_tasks, public.agent_communications FROM authenticated;
GRANT SELECT ON public.agent_plans, public.agent_tasks, public.agent_communications TO authenticated;
