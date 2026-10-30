-- Posts the user schedules: written by hand in the post editor, or scheduled from an AI agent's draft
-- (content_drafts). Each post can go to several platforms. Publishing comes later: for now a post is
-- saved as a draft or scheduled, and platform_results is where each platform's outcome will go.
-- Rows are written by the server only; users can read their own.

CREATE TABLE IF NOT EXISTS public.posts (
  id bigserial PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  campaign_id integer NOT NULL REFERENCES public.campaigns(id) ON DELETE CASCADE,
  -- manual: written in the post editor; ai: started from an agent's draft
  source text NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'ai')),
  draft_id bigint REFERENCES public.content_drafts(id) ON DELETE SET NULL,
  title text NOT NULL,
  caption text NOT NULL DEFAULT '',
  hashtags text[] NOT NULL DEFAULT '{}',
  platforms text[] NOT NULL CHECK (cardinality(platforms) > 0),
  -- [{ url, fileId, name, mimeType, origin (upload|generated|edited), sourceUrl, prompt, edits }]
  media jsonb NOT NULL DEFAULT '[]',
  status text NOT NULL DEFAULT 'scheduled' CHECK (status IN ('draft', 'scheduled', 'publishing', 'published', 'failed', 'cancelled')),
  -- The moment to publish (UTC), and the time zone the user picked it in
  scheduled_at timestamptz,
  time_zone text NOT NULL DEFAULT 'UTC',
  -- Per platform, once publishing exists: { instagram: { status, postId, url, error } }
  platform_results jsonb NOT NULL DEFAULT '{}',
  error text,
  published_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (status = 'draft' OR scheduled_at IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS posts_campaign_idx ON public.posts (campaign_id, id DESC);
-- What's due next, for the publisher and the overview's upcoming posts
CREATE INDEX IF NOT EXISTS posts_due_idx ON public.posts (status, scheduled_at);

ALTER TABLE public.posts ENABLE ROW LEVEL SECURITY;

CREATE POLICY posts_owner_select ON public.posts
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

REVOKE ALL ON public.posts FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public.posts FROM authenticated;
GRANT SELECT ON public.posts TO authenticated;
