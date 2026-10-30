-- The Publisher Agent is retired: its office seat now belongs to the Analytics Agent, which reports
-- on post performance on request or on a schedule the user asks for through the Master Agent.

-- Chats with the Publisher Agent have no agent to belong to any more
DELETE FROM public.agent_messages WHERE agent_id = 'publisher';

-- Keep plan history: tasks once given to the Publisher Agent move to the Analytics Agent
UPDATE public.agent_tasks SET agent_id = 'analytics' WHERE agent_id = 'publisher';
UPDATE public.agent_communications SET from_agent = 'analytics' WHERE from_agent = 'publisher';
UPDATE public.agent_communications SET to_agent = 'analytics' WHERE to_agent = 'publisher';

ALTER TABLE public.agent_messages DROP CONSTRAINT IF EXISTS agent_messages_agent_id_check;
ALTER TABLE public.agent_messages ADD CONSTRAINT agent_messages_agent_id_check
  CHECK (agent_id IN ('master', 'research', 'creator', 'scheduler', 'analytics'));

ALTER TABLE public.agent_tasks DROP CONSTRAINT IF EXISTS agent_tasks_agent_id_check;
ALTER TABLE public.agent_tasks ADD CONSTRAINT agent_tasks_agent_id_check
  CHECK (agent_id IN ('research', 'creator', 'scheduler', 'analytics'));
