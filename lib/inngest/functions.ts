import { NonRetriableError } from 'inngest';
import { inngest } from './client';
import {
  advancePlan,
  completeTaskRun,
  describeError,
  expireWaitingTasksAndAdvance,
  failTaskRun,
  reviewTaskWork,
  runTaskWork,
  startTaskRun,
  TASK_RETRIES,
  toExecuteEvent,
} from '@/lib/orchestration/engine';
import { queueDueTasks, recoverStaleTasks, releaseQueuedTask } from '@/lib/orchestration/store';
import { killCampaignSandboxes, pauseIdleSandboxes } from '@/lib/sandbox/agent-sandbox';
import { WORKER_IDS } from '@/lib/agent-roles';
import { exportFiles, listFilesToExport } from '@/lib/sandbox/export';
import { listAnalyticsUsers, syncAnalytics } from '@/lib/analytics/store';
import { checkSubmissions, claimPostForPublishing, failPost, finishPost, listDuePosts, submitToPlatform } from '@/lib/posts/publish';

// While another agent holds the campaign's sandbox, a task checks again every minute for this many
// minutes, then goes back to pending for the next cron run
const MAX_SANDBOX_WAITS = 20;
// Steps one agent run may take (each works for a few minutes before saving and handing over)
const MAX_AGENT_STEPS = 15;

// Every 15 minutes: queues the tasks due in the next 15 minutes (one atomic update) and sends a
// task/execute event for each. The executor sleeps until each task's exact time. Also re-sends
// tasks whose Inngest run went missing, and sends a post/publish event for each scheduled post due
// in the next 15 minutes (repeat sends of the same dispatch are deduped by event id).
export const queueScheduledTasks = inngest.createFunction(
  { id: 'queue-scheduled-tasks', name: 'Queue scheduled agent tasks and posts' },
  { cron: '*/15 * * * *' },
  async ({ step }) => {
    const due = await step.run('queue-due-tasks', async () => (await queueDueTasks()).map(toExecuteEvent));
    const recovered = await step.run('recover-stale-tasks', async () => (await recoverStaleTasks()).map(toExecuteEvent));

    // Recovered running tasks went back to pending; dispatch them (and anything else now due) too
    const requeued = await step.run('queue-recovered-tasks', async () => (await queueDueTasks()).map(toExecuteEvent));

    const events = [...due, ...recovered, ...requeued];
    if (events.length) await step.sendEvent('send-task-events', events);

    const posts = await step.run('queue-due-posts', () => listDuePosts());
    if (posts.length) await step.sendEvent('send-post-events', posts);
    return { queued: due.length + requeued.length, resent: recovered.length, posts: posts.length };
  }
);

// Runs one dispatch of a task: waits for its time, claims it (and the campaign's sandbox), has the
// agent do the work over as many steps as it needs, gets the Master Agent's review (and one revision
// if asked), saves the result and moves the plan on. A run that has to wait for the user ends here;
// "Done" sends a new dispatch that continues the saved run.
export const executeAgentTask = inngest.createFunction(
  {
    id: 'execute-agent-task',
    name: 'Execute agent task',
    retries: TASK_RETRIES,
    // One run per dispatch, even if its event is sent twice
    idempotency: 'event.data.dispatchId',
    // Sleeping runs don't hold a slot; these cap tasks actually working at once. Different agents
    // work in parallel (each has its own computer), but an agent does one task at a time.
    concurrency: [
      { key: 'event.data.userId', limit: WORKER_IDS.length },
      { key: 'event.data.campaignId + "-" + event.data.agentId', limit: 1 },
    ],
    onFailure: async ({ event, error, step }) => {
      const original = event.data.event.data;
      const planId = await step.run('mark-failed', () => failTaskRun(original, event.data.run_id, describeError(error)));
      if (planId) {
        const events = await step.run('advance-plan', () => advancePlan(planId));
        if (events.length) await step.sendEvent('send-task-events', events);
      }
    },
  },
  { event: 'task/execute' },
  async ({ event, step, runId, attempt }) => {
    const { taskId, planId } = event.data;
    await step.sleepUntil('wait-for-scheduled-time', event.data.scheduledAt);

    let start = await step.run('claim-task', () => startTaskRun(event.data, runId));
    // Another agent is using the sandbox: sleeping doesn't hold a concurrency slot
    for (let wait = 1; start === 'busy' && wait <= MAX_SANDBOX_WAITS; wait++) {
      await step.sleep(`wait-for-sandbox-${wait}`, '1m');
      start = await step.run(`claim-task-${wait}`, () => startTaskRun(event.data, runId));
    }
    if (start === 'busy') {
      await step.run('release-busy-task', () => releaseQueuedTask(taskId, event.data.queueSeq));
      return { taskId, result: 'sandbox-busy' };
    }
    if (start === 'skip') return { taskId, result: 'skipped' };

    // One agent run, step by step: each step saves the run when its time is up and the next continues
    const runAgent = async (name: string) => {
      let work = await step.run(name, () => runTaskWork(taskId, runId, attempt));
      for (let part = 1; work === 'continue'; part++) {
        if (part >= MAX_AGENT_STEPS) throw new NonRetriableError('The task took too long and was stopped.');
        work = await step.run(`${name}-${part}`, () => runTaskWork(taskId, runId, attempt));
      }
      return work;
    };

    if (start === 'run') {
      let work = await runAgent('run-agent');
      let review = work === 'done' ? await step.run('review', () => reviewTaskWork(taskId, runId)) : null;
      if (review === 'revise') {
        work = await runAgent('revise');
        review = work === 'done' ? await step.run('review-revision', () => reviewTaskWork(taskId, runId)) : null;
      }
      if (review === 'approved') await step.run('save-result', () => completeTaskRun(taskId, runId));
    }

    const events = await step.run('advance-plan', () => advancePlan(planId));
    if (events.length) await step.sendEvent('send-task-events', events);
    return { taskId, result: start };
  }
);

// Status checks after submitting a post: every 20 seconds at first, then every minute (videos can
// take a while to process), for about 20 minutes in all
const POST_STATUS_CHECKS = 25;
const POST_RETRIES = 3;

// Tracks one scheduled post: waits for its time, claims it (skipped if it was edited, rescheduled
// or unscheduled since), then polls Blotato (which publishes the post from the user's Blotato
// calendar) until each platform is published or failed. A post that wasn't scheduled in Blotato is
// submitted to it now instead.
export const publishScheduledPost = inngest.createFunction(
  {
    id: 'publish-scheduled-post',
    name: 'Publish a scheduled post',
    retries: POST_RETRIES,
    idempotency: 'event.data.dispatchId',
    concurrency: [{ key: 'event.data.userId', limit: 5 }],
    onFailure: async ({ event, error, step }) => {
      await step.run('mark-failed', () => failPost(event.data.event.data.postId, `Publishing failed: ${error.message}`));
    },
  },
  { event: 'post/publish' },
  async ({ event, step, attempt }) => {
    const { postId } = event.data;
    await step.sleepUntil('wait-for-scheduled-time', event.data.scheduledAt);

    const platforms = await step.run('claim-post', () => claimPostForPublishing(event.data));
    if (!platforms) return { postId, result: 'skipped' };

    for (const platform of platforms) {
      await step.run(`submit-${platform}`, () => submitToPlatform(postId, platform, attempt >= POST_RETRIES));
    }

    for (let check = 1; check <= POST_STATUS_CHECKS; check++) {
      await step.sleep(`wait-for-blotato-${check}`, check <= 6 ? '20s' : '1m');
      const pending = await step.run(`check-status-${check}`, () => checkSubmissions(postId));
      if (pending === 0) break;
    }

    return step.run('finish', () => finishPost(postId));
  }
);

// Every minute: pauses campaign sandboxes nobody has used for 3 minutes (E2B's own timeout is the
// backstop), and expires tasks that waited too long for the user
export const pauseIdleSandboxesCron = inngest.createFunction(
  { id: 'pause-idle-sandboxes', name: 'Pause idle sandboxes and expire waiting tasks' },
  { cron: '* * * * *' },
  async ({ step }) => {
    const paused = await step.run('pause-idle-sandboxes', () => pauseIdleSandboxes());
    const events = await step.run('expire-waiting-tasks', () => expireWaitingTasksAndAdvance());
    if (events.length) await step.sendEvent('send-task-events', events);
    return { paused, dispatched: events.length };
  }
);

// The user ended a campaign: upload its agents' sandbox files to ImageKit (ten per step), then shut
// the sandboxes down
export const endCampaign = inngest.createFunction(
  { id: 'end-campaign', name: "Export and shut down a campaign's sandboxes", idempotency: 'event.data.campaignId' },
  { event: 'campaign/ended' },
  async ({ event, step }) => {
    const { campaignId, userId } = event.data;
    const paths = await step.run('list-files', () => listFilesToExport(campaignId));
    let exported = 0;
    for (let i = 0; i < paths.length; i += 10) {
      exported += await step.run(`export-files-${i / 10}`, () => exportFiles(campaignId, userId, paths.slice(i, i + 10)));
    }
    await step.run('kill-sandboxes', () => killCampaignSandboxes(campaignId));
    return { campaignId, exported, of: paths.length };
  }
);

// Every 6 hours: syncs every Blotato-connected user's post analytics, one sync event per user (the
// Analytics page also syncs on load once its numbers are 30 minutes old)
export const scheduleAnalyticsSync = inngest.createFunction(
  { id: 'schedule-analytics-sync', name: 'Sync post analytics for every user' },
  { cron: '0 */6 * * *' },
  async ({ step }) => {
    const users = await step.run('list-users', () => listAnalyticsUsers());
    if (users.length) await step.sendEvent('send-sync-events', users.map((userId) => ({ name: 'analytics/sync' as const, data: { userId } })));
    return { users: users.length };
  }
);

// Pulls one user's published posts and their metrics from Blotato. One at a time per user; a rate
// limit or network error is retried by Inngest.
export const syncUserAnalytics = inngest.createFunction(
  {
    id: 'sync-user-analytics',
    name: "Sync a user's post analytics",
    retries: 2,
    concurrency: [{ key: 'event.data.userId', limit: 1 }, { limit: 5 }],
    debounce: { key: 'event.data.userId', period: '1m' },
  },
  { event: 'analytics/sync' },
  async ({ event, step }) => {
    return step.run('sync', async () => {
      const result = await syncAnalytics(event.data.userId);
      if (result.error && /rate limit|couldn't reach|timed? ?out/i.test(result.error)) throw new Error(result.error);
      return result;
    });
  }
);

export const functions = [queueScheduledTasks, executeAgentTask, publishScheduledPost, pauseIdleSandboxesCron, endCampaign, scheduleAnalyticsSync, syncUserAnalytics];
