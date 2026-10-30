-- Blotato: each user connects their own Blotato account (which holds their Instagram, TikTok and
-- YouTube connections) by pasting an API key in Settings → Integrations. The key is encrypted by the
-- server (AES-256-GCM, INTEGRATIONS_ENCRYPTION_KEY) before it's stored, and the table is server-only:
-- RLS is on with no policies and no grants, so the browser can never read a key, even encrypted.

CREATE TABLE IF NOT EXISTS public.user_integrations (
  id bigserial PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  provider text NOT NULL CHECK (provider IN ('blotato')),
  -- "v1:<iv>:<tag>:<ciphertext>", all base64 (lib/crypto/secrets.ts)
  api_key_encrypted text NOT NULL,
  -- Last 4 characters, to show which key is connected
  key_hint text NOT NULL,
  -- The connected social accounts from the provider's last check: [{ id, platform, name, username }]
  accounts jsonb NOT NULL DEFAULT '[]',
  accounts_refreshed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, provider)
);

ALTER TABLE public.user_integrations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.user_integrations FROM anon, authenticated;

-- Which connected account each platform publishes to: { instagram: "<Blotato account id>" }. A
-- platform without one uses the first connected account for it.
ALTER TABLE public.posts ADD COLUMN IF NOT EXISTS account_ids jsonb NOT NULL DEFAULT '{}';
