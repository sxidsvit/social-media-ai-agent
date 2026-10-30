-- Analytics: the user's published (and failed) posts as Blotato reports them, with each one's latest
-- metrics, synced from Blotato's MCP tools (lib/analytics/store.ts). A row is linked to the app's post
-- and campaign when it came from the Posts page; posts the user published straight from Blotato have
-- neither. Metrics Blotato hasn't reported are NULL, never 0. Written by the server only; users can
-- read their own rows.

CREATE TABLE IF NOT EXISTS public.post_analytics (
  id bigserial PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  -- Blotato's published post id (what blotato_get_post_analytics takes)
  blotato_post_id text NOT NULL,
  campaign_id integer REFERENCES public.campaigns(id) ON DELETE SET NULL,
  post_id bigint REFERENCES public.posts(id) ON DELETE SET NULL,
  account_id text,
  -- instagram, tiktok, youtube, x, linkedin, facebook, threads, pinterest, bluesky…
  platform text NOT NULL,
  state text NOT NULL CHECK (state IN ('published', 'failed')),
  posted_at timestamptz NOT NULL,
  text text,
  post_url text,
  error text,
  views bigint,
  likes bigint,
  comments bigint,
  shares bigint,
  saves bigint,
  reach bigint,
  impressions bigint,
  -- Blotato's latest metrics as it sent them, and earlier snapshots: [{ fetchedAt, metrics }]
  raw_metrics jsonb,
  metrics_history jsonb NOT NULL DEFAULT '[]',
  -- When Blotato last collected the metrics (NULL: not collected yet)
  metrics_fetched_at timestamptz,
  synced_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, blotato_post_id)
);

CREATE INDEX IF NOT EXISTS post_analytics_user_time_idx ON public.post_analytics (user_id, posted_at DESC);
CREATE INDEX IF NOT EXISTS post_analytics_campaign_idx ON public.post_analytics (campaign_id, posted_at DESC);

ALTER TABLE public.post_analytics ENABLE ROW LEVEL SECURITY;

CREATE POLICY post_analytics_owner_select ON public.post_analytics
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

REVOKE ALL ON public.post_analytics FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public.post_analytics FROM authenticated;
GRANT SELECT ON public.post_analytics TO authenticated;

-- Each user's last analytics sync, so the page knows when its numbers are from and why a sync failed
CREATE TABLE IF NOT EXISTS public.analytics_syncs (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  last_synced_at timestamptz,
  last_attempt_at timestamptz NOT NULL DEFAULT now(),
  last_error text,
  posts_synced integer NOT NULL DEFAULT 0
);

ALTER TABLE public.analytics_syncs ENABLE ROW LEVEL SECURITY;

CREATE POLICY analytics_syncs_owner_select ON public.analytics_syncs
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

REVOKE ALL ON public.analytics_syncs FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public.analytics_syncs FROM authenticated;
GRANT SELECT ON public.analytics_syncs TO authenticated;
