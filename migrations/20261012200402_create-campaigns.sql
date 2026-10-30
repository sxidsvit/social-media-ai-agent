-- Campaigns: one or more per user, created during onboarding.
CREATE TABLE IF NOT EXISTS public.campaigns (
  id serial PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name text NOT NULL,
  -- Preset icon id (e.g. "rocket") when icon_url is null
  icon text,
  -- Custom uploaded icon (storage bucket "campaign-icons")
  icon_url text,
  icon_key text,
  -- Office image path under /public/offices
  office_image text NOT NULL,
  created_at timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS campaigns_user_id_idx ON public.campaigns (user_id);

ALTER TABLE public.campaigns ENABLE ROW LEVEL SECURITY;

CREATE POLICY campaigns_owner_select ON public.campaigns
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY campaigns_owner_insert ON public.campaigns
  FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

CREATE POLICY campaigns_owner_update ON public.campaigns
  FOR UPDATE TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE POLICY campaigns_owner_delete ON public.campaigns
  FOR DELETE TO authenticated
  USING (user_id = auth.uid());

REVOKE ALL ON public.campaigns FROM anon;

-- Storage: campaign icons are publicly readable (public bucket);
-- users may only write inside their own folder: <user_id>/...
ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;

CREATE POLICY campaign_icons_select ON storage.objects
  FOR SELECT TO authenticated, anon
  USING (bucket = 'campaign-icons');

CREATE POLICY campaign_icons_insert ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket = 'campaign-icons'
    AND (storage.foldername(key))[1] = (SELECT auth.jwt() ->> 'sub')
  );

CREATE POLICY campaign_icons_update ON storage.objects
  FOR UPDATE TO authenticated
  USING      (bucket = 'campaign-icons' AND (storage.foldername(key))[1] = (SELECT auth.jwt() ->> 'sub'))
  WITH CHECK (bucket = 'campaign-icons' AND (storage.foldername(key))[1] = (SELECT auth.jwt() ->> 'sub'));

CREATE POLICY campaign_icons_delete ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket = 'campaign-icons'
    AND (storage.foldername(key))[1] = (SELECT auth.jwt() ->> 'sub')
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON storage.objects TO authenticated;
GRANT SELECT ON storage.objects TO anon;
GRANT USAGE ON SCHEMA storage TO authenticated, anon;
