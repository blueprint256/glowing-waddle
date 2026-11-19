import { create } from 'zustand';
import { designAPI, type PosterJob, type StartPosterBody } from '../services/design';
import { errorMessage, notify } from './toastStore';
import { announcePostChanged, requestOpenPost } from './aiJobsStore';

/**
 * Designed posters are made on the server (1–4 minutes): start one, close the post, keep working,
 * and get a message with an Open button when the options are ready. Opening the post again picks
 * the progress back up (resume). One poster job per post at a time.
 */

export interface TrackedPosterJob extends PosterJob {
  title: string;
  /** When this screen started following it (for the elapsed time). */
  startedAt: number;
}

interface PosterJobsState {
  jobs: Record<string, TrackedPosterJob>;
  start: (taskId: string, title: string, body: StartPosterBody) => Promise<TrackedPosterJob | null>;
  /** Follows a job already running for this post (after a reload or on another device). */
  resume: (taskId: string, title: string) => Promise<void>;
  clear: (taskId: string) => void;
}

export const posterRunning = (job?: PosterJob | null) => job?.status === 'queued' || job?.status === 'running';

const POLL_MS = 2000;
const following = new Set<string>();

export const usePosterJobsStore = create<PosterJobsState>((set, get) => {
  const put = (job: TrackedPosterJob) => set((s) => ({ jobs: { ...s.jobs, [job.taskId]: job } }));

  const follow = async (taskId: string) => {
    if (following.has(taskId)) return;
    following.add(taskId);
    let failures = 0;
    try {
      for (;;) {
        await new Promise((r) => setTimeout(r, POLL_MS));
        const tracked = get().jobs[taskId];
        if (!tracked || !posterRunning(tracked)) return;
        let job: PosterJob;
        try {
          job = await designAPI.job(tracked.id);
          failures = 0;
        } catch {
          // A blip in the connection: keep trying for a while before giving up on following it.
          if (++failures >= 15) return;
          continue;
        }
        put({ ...tracked, ...job });
        if (job.status === 'done') {
          announcePostChanged(taskId);
          const n = job.draftIds.length;
          notify(n ? `${n} poster option${n === 1 ? '' : 's'} ready for “${tracked.title}”` : job.message || 'The poster is ready', {
            action: { label: 'Open', run: () => requestOpenPost(taskId) },
            duration: 10000
          });
          return;
        }
        if (job.status === 'failed') {
          notify(job.error || 'The poster couldn’t be made. Try again.', { tone: 'error', duration: 9000 });
          return;
        }
      }
    } finally {
      following.delete(taskId);
    }
  };

  return {
    jobs: {},
    start: async (taskId, title, body) => {
      const current = get().jobs[taskId];
      if (posterRunning(current)) return current;
      try {
        const job = await designAPI.start(taskId, body);
        const tracked: TrackedPosterJob = { ...job, title, startedAt: Date.now() };
        put(tracked);
        follow(taskId);
        return tracked;
      } catch (error) {
        notify(errorMessage(error, 'The poster couldn’t be started. Try again.'), { tone: 'error' });
        return null;
      }
    },
    resume: async (taskId, title) => {
      if (posterRunning(get().jobs[taskId])) return follow(taskId);
      try {
        const job = await designAPI.latestJob(taskId);
        if (job && posterRunning(job)) {
          put({ ...job, title, startedAt: new Date(job.createdAt).getTime() });
          follow(taskId);
        }
      } catch {
        /* Nothing to pick up. */
      }
    },
    clear: (taskId) =>
      set((s) => {
        const jobs = { ...s.jobs };
        delete jobs[taskId];
        return { jobs };
      })
  };
});
