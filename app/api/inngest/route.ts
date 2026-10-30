import { serve } from 'inngest/next';
import { inngest } from '@/lib/inngest/client';
import { functions } from '@/lib/inngest/functions';

export const runtime = 'nodejs';
// An agent step can take a few minutes (see TASK_TIMEOUT_MS in lib/orchestration/engine.ts)
export const maxDuration = 300;

// Serves the Inngest functions; the local dev server syncs from here (npm run inngest:dev)
export const { GET, POST, PUT } = serve({ client: inngest, functions });
