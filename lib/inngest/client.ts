import { EventSchemas, Inngest } from 'inngest';
import type { WorkerRoleId } from '@/lib/agent-roles';

type Events = {
  // Run one dispatch of a scheduled task (see lib/inngest/functions.ts)
  'task/execute': {
    data: {
      taskId: number;
      planId: number;
      userId: string;
      campaignId: number;
      agentId: WorkerRoleId;
      // Which dispatch of the task this is; a stale event for an older dispatch is ignored
      queueSeq: number;
      // "task-<taskId>-<queueSeq>": the event id and the executor's idempotency key
      dispatchId: string;
      // ISO time to start at
      scheduledAt: string;
    };
  };
  // Publish one scheduled post through the user's Blotato account (see lib/posts/publish.ts)
  'post/publish': {
    data: {
      postId: number;
      userId: string;
      // ISO time to publish at; a post rescheduled since gets a new dispatch and this one is ignored
      scheduledAt: string;
      // "post-<postId>-<scheduledAt ms>": the event id and the publisher's idempotency key
      dispatchId: string;
    };
  };
  // Pull one user's post analytics from Blotato (see lib/analytics/store.ts)
  'analytics/sync': {
    data: { userId: string };
  };
  // The user ended a campaign: export its agents' sandbox files, then shut the sandboxes down
  'campaign/ended': {
    data: { campaignId: number; userId: string };
  };
};

// Sends and receives the app's events. Runs against the local dev server (npm run inngest:dev)
// unless NODE_ENV is production or INNGEST_DEV says otherwise.
export const inngest = new Inngest({
  id: 'social-media-ai-agent',
  eventKey: process.env.INNGEST_EVENT_KEY,
  schemas: new EventSchemas().fromRecord<Events>(),
});
