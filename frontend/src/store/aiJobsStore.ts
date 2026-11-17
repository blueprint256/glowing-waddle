import { create } from 'zustand';
import { taskAPI } from '../services/api';
import { errorMessage, notify } from './toastStore';

/**
 * "Create image with AI" runs in the background (15–60 seconds): you can close the post, move on,
 * and get a message with an Open button when the image is ready. Progress is per post, so opening
 * the post again shows it still working.
 */
export interface ImageJob {
  taskId: string;
  startedAt: number;
  state: 'running' | 'done' | 'error';
  url?: string;
  error?: string;
}

interface AIJobsState {
  images: Record<string, ImageJob>;
  createImage: (taskId: string, title: string) => Promise<ImageJob>;
  clear: (taskId: string) => void;
}

/** Asks whichever page is showing to open this post (components/posts/PostPanelHost listens). */
export function requestOpenPost(taskId: string) {
  window.dispatchEvent(new CustomEvent('post:open', { detail: taskId }));
}

/** Tells open views that a post changed (status, image, caption …), so they can reload it. */
export function announcePostChanged(taskId: string) {
  window.dispatchEvent(new CustomEvent('post:changed', { detail: taskId }));
}

export const useAIJobsStore = create<AIJobsState>((set, get) => ({
  images: {},
  createImage: async (taskId, title) => {
    const current = get().images[taskId];
    if (current?.state === 'running') return current;
    const job: ImageJob = { taskId, startedAt: Date.now(), state: 'running' };
    set((s) => ({ images: { ...s.images, [taskId]: job } }));
    try {
      const res = await taskAPI.generatePoster(taskId);
      const done: ImageJob = { ...job, state: 'done', url: res.data?.generatedImageUrl };
      set((s) => ({ images: { ...s.images, [taskId]: done } }));
      announcePostChanged(taskId);
      notify(`AI image ready for “${title}”`, { action: { label: 'Open', run: () => requestOpenPost(taskId) }, duration: 9000 });
      return done;
    } catch (error) {
      const failed: ImageJob = { ...job, state: 'error', error: errorMessage(error, 'The image couldn’t be created. Try again.') };
      set((s) => ({ images: { ...s.images, [taskId]: failed } }));
      notify(failed.error!, { tone: 'error' });
      return failed;
    }
  },
  clear: (taskId) =>
    set((s) => {
      const images = { ...s.images };
      delete images[taskId];
      return { images };
    })
}));
