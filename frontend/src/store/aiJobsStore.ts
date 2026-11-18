import { create } from 'zustand';
import { taskAPI, type ChangeImageBody, type CreateImageBody } from '../services/api';
import { errorMessage, notify } from './toastStore';
import type { PostAIDraft } from '../types';

/**
 * AI pictures run in the background (15–60 seconds): you can close the post, move on, and get a
 * message with an Open button when the picture is ready. One job per post at a time; opening the
 * post again shows it still working.
 *   create: Create image (a new picture)
 *   change: Change image (edits a picture following a sentence)
 */
export interface ImageJob {
  taskId: string;
  kind: 'create' | 'change';
  startedAt: number;
  state: 'running' | 'done' | 'error';
  /** The new AI draft, when done. */
  draft?: PostAIDraft;
  error?: string;
  /** Change: the picture being changed (to show the job on it). */
  from?: string;
}

interface AIJobsState {
  images: Record<string, ImageJob>;
  createImage: (taskId: string, title: string, body: CreateImageBody) => Promise<ImageJob>;
  changeImage: (taskId: string, title: string, body: ChangeImageBody) => Promise<ImageJob>;
  clear: (taskId: string) => void;
}

/** Asks whichever page is showing to open this post (components/posts/PostPanelHost listens). */
export function requestOpenPost(taskId: string) {
  window.dispatchEvent(new CustomEvent('post:open', { detail: taskId }));
}

/** Tells open views that a post changed (status, picture, caption …), so they can reload it. */
export function announcePostChanged(taskId: string) {
  window.dispatchEvent(new CustomEvent('post:changed', { detail: taskId }));
}

/** Whether a picture job is running for this post right now. */
export const isRunning = (job?: ImageJob) => job?.state === 'running';

export const useAIJobsStore = create<AIJobsState>((set, get) => {
  const run = async (taskId: string, title: string, kind: 'create' | 'change', call: () => Promise<any>, from?: string): Promise<ImageJob> => {
    const current = get().images[taskId];
    if (current?.state === 'running') return current;
    const job: ImageJob = { taskId, kind, startedAt: Date.now(), state: 'running', from };
    set((s) => ({ images: { ...s.images, [taskId]: job } }));
    try {
      const res = await call();
      const done: ImageJob = { ...job, state: 'done', draft: res.data?.draft };
      set((s) => ({ images: { ...s.images, [taskId]: done } }));
      announcePostChanged(taskId);
      notify(kind === 'change' ? `Changed picture ready for “${title}”` : `AI picture ready for “${title}”`, {
        action: { label: 'Open', run: () => requestOpenPost(taskId) },
        duration: 9000
      });
      return done;
    } catch (error) {
      const failed: ImageJob = { ...job, state: 'error', error: errorMessage(error, kind === 'change' ? 'The picture couldn’t be changed. Try again.' : 'The picture couldn’t be created. Try again.') };
      set((s) => ({ images: { ...s.images, [taskId]: failed } }));
      notify(failed.error!, { tone: 'error' });
      return failed;
    }
  };
  return {
    images: {},
    createImage: (taskId, title, body) => run(taskId, title, 'create', () => taskAPI.createImage(taskId, body)),
    changeImage: (taskId, title, body) => run(taskId, title, 'change', () => taskAPI.changeImage(taskId, body), body.from),
    clear: (taskId) =>
      set((s) => {
        const images = { ...s.images };
        delete images[taskId];
        return { images };
      })
  };
});
