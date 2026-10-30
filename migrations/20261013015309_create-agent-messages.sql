-- Agent chats: every message a user and an agent exchange, per campaign.
CREATE TABLE IF NOT EXISTS public.agent_messages (
  id bigserial PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  campaign_id integer NOT NULL REFERENCES public.campaigns(id) ON DELETE CASCADE,
  -- Agent role id (see lib/agent-roles.ts)
  agent_id text NOT NULL CHECK (agent_id IN ('research', 'creator', 'scheduler', 'publisher', 'analytics')),
  sender text NOT NULL CHECK (sender IN ('user', 'agent')),
  text text NOT NULL,
  -- A cut-off reply: shown in the chat but not sent back to the agent as context
  failed boolean NOT NULL DEFAULT false,
  created_at timestamp NOT NULL DEFAULT now()
);

-- Serves "latest N messages of this chat" and "N messages older than id X"
CREATE INDEX IF NOT EXISTS agent_messages_chat_idx
  ON public.agent_messages (user_id, campaign_id, agent_id, id DESC);
CREATE INDEX IF NOT EXISTS agent_messages_campaign_id_idx ON public.agent_messages (campaign_id);

ALTER TABLE public.agent_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY agent_messages_owner_select ON public.agent_messages
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY agent_messages_owner_insert ON public.agent_messages
  FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

CREATE POLICY agent_messages_owner_delete ON public.agent_messages
  FOR DELETE TO authenticated
  USING (user_id = auth.uid());

REVOKE ALL ON public.agent_messages FROM anon;
REVOKE UPDATE ON public.agent_messages FROM authenticated;
