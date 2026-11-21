import mongoose from 'mongoose';
import { User, canUseLibrary } from '../models/User';
import { LibraryJob } from '../models/LibraryJob';
import { loadLibrarySetup } from './setup';

/**
 * Called when a post gets a new picture (upload, AI picture used, Canva, an earlier picture brought
 * back): the picture becomes the next version of that post's Library item, in the Library of the
 * account the post belongs to. Never blocks or breaks the post request; failures are only logged.
 */
export async function queueTaskImage(task: { _id?: unknown; ownerId: unknown }, url: string, userId: unknown, note: string) {
  try {
    if (!url || !task?.ownerId) return;
    const setup = await loadLibrarySetup();
    if (!setup.enabled) return;
    const owner = await User.findById(task.ownerId).select('isActive libraryEnabled');
    if (!owner || !canUseLibrary(owner)) return;
    await LibraryJob.create({
      type: 'task_image',
      ownerId: owner._id,
      payload: { taskId: String(task._id), url, userId: mongoose.isValidObjectId(String(userId)) ? String(userId) : undefined, note }
    });
  } catch (error) {
    console.error('[library] Could not queue a post picture:', error);
  }
}
