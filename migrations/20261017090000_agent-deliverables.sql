-- What the agents deliver, stored as data instead of only as text in agent_tasks.output:
-- - research_findings: the Research Agent's findings with their sources (save_research)
-- - content_drafts: the Creator Agent's posts, captions, hashtag sets and ideas, with their images (save_draft)
-- - agent_outputs: the final, reviewed output of every task run of every agent, so past work is easy to find
-- Rows are written by the server only; users can read their own.

CREATE TABLE IF NOT EXISTS public.research_findings (
  id bigserial PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  campaign_id integer NOT NULL REFERENCES public.campaigns(id) ON DELETE CASCADE,
  plan_id bigint REFERENCES public.agent_plans(id) ON DELETE CASCADE,
  task_id bigint REFERENCES public.agent_tasks(id) ON DELETE CASCADE,
  task_run_id bigint REFERENCES public.agent_task_runs(id) ON DELETE SET NULL,
  agent_id text NOT NULL,
  topic text NOT NULL,
  summary text NOT NULL,
  -- knowledge: from the agent's own knowledge; live: looked up in the browser; mixed: both
  method text NOT NULL CHECK (method IN ('knowledge', 'live', 'mixed')),
  platforms text[] NOT NULL DEFAULT '{}',
  hashtags text[] NOT NULL DEFAULT '{}',
  -- [{ insight, details, sources: [1-based indexes into sources] }]
  findings jsonb NOT NULL DEFAULT '[]',
  -- [{ title, url, platform, checkedLive (the agent's claim), visited (opened in its browser), note }]
  sources jsonb NOT NULL DEFAULT '[]',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS research_findings_task_idx ON public.research_findings (task_id, id DESC);
CREATE INDEX IF NOT EXISTS research_findings_campaign_idx ON public.research_findings (campaign_id, id DESC);

CREATE TABLE IF NOT EXISTS public.content_drafts (
  id bigserial PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  campaign_id integer NOT NULL REFERENCES public.campaigns(id) ON DELETE CASCADE,
  plan_id bigint REFERENCES public.agent_plans(id) ON DELETE CASCADE,
  task_id bigint REFERENCES public.agent_tasks(id) ON DELETE CASCADE,
  task_run_id bigint REFERENCES public.agent_task_runs(id) ON DELETE SET NULL,
  agent_id text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('post', 'caption', 'thread', 'script', 'carousel', 'hashtags', 'idea')),
  platform text NOT NULL,
  title text NOT NULL,
  hook text,
  -- The post copy, caption, script or idea
  body text NOT NULL,
  cta text,
  hashtags text[] NOT NULL DEFAULT '{}',
  -- Images and videos for the post: [{ artifactId, url, name, mimeType }]
  media jsonb NOT NULL DEFAULT '[]',
  notes text,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'approved', 'archived')),
  -- Character count, platform limit warnings and the like
  metadata jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS content_drafts_task_idx ON public.content_drafts (task_id, id DESC);
CREATE INDEX IF NOT EXISTS content_drafts_campaign_idx ON public.content_drafts (campaign_id, platform, id DESC);

-- One row per finished task run (a repeating task has one per run), saved once the Master Agent has
-- reviewed it
CREATE TABLE IF NOT EXISTS public.agent_outputs (
  id bigserial PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  campaign_id integer NOT NULL REFERENCES public.campaigns(id) ON DELETE CASCADE,
  plan_id bigint NOT NULL REFERENCES public.agent_plans(id) ON DELETE CASCADE,
  task_id bigint NOT NULL REFERENCES public.agent_tasks(id) ON DELETE CASCADE,
  task_run_id bigint REFERENCES public.agent_task_runs(id) ON DELETE SET NULL,
  -- 1 for the first run of the task, 2 for the next run of a repeating task, and so on
  run_number integer NOT NULL,
  agent_id text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('research', 'content', 'schedule', 'report')),
  title text NOT NULL,
  summary text,
  details text,
  -- The full output as the Master Agent reviewed it
  output text NOT NULL,
  review text,
  -- Counts of the artifacts, drafts and research saved with it
  metadata jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  search tsvector GENERATED ALWAYS AS (
    to_tsvector('english', title || ' ' || coalesce(summary, '') || ' ' || coalesce(details, output))
  ) STORED,
  UNIQUE (task_id, run_number)
);

CREATE INDEX IF NOT EXISTS agent_outputs_campaign_idx ON public.agent_outputs (campaign_id, agent_id, id DESC);
CREATE INDEX IF NOT EXISTS agent_outputs_search_idx ON public.agent_outputs USING gin (search);

ALTER TABLE public.research_findings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.content_drafts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_outputs ENABLE ROW LEVEL SECURITY;

CREATE POLICY research_findings_owner_select ON public.research_findings
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY content_drafts_owner_select ON public.content_drafts
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY agent_outputs_owner_select ON public.agent_outputs
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

REVOKE ALL ON public.research_findings, public.content_drafts, public.agent_outputs FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public.research_findings, public.content_drafts, public.agent_outputs FROM authenticated;
GRANT SELECT ON public.research_findings, public.content_drafts, public.agent_outputs TO authenticated;
