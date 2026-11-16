import mongoose from 'mongoose';
import { Campaign } from '../models/Campaign';
import { User, canUseLibrary } from '../models/User';
import { LibraryJob } from '../models/LibraryJob';
import { loadLibrarySetup } from './setup';

/**
 * Called when a task gets a new image (upload or adopted AI poster): the image becomes the next
 * version of that task's Library item, in the campaign owner's Library. Never blocks or breaks the
 * task request; failures are only logged.
 */
export async function queueTaskImage(taskCampaignId: unknown, taskId: unknown, url: string, userId: unknown, note: string) {
  try {
    if (!url) return;
    const setup = await loadLibrarySetup();
    if (!setup.enabled) return;
    const campaign = await Campaign.findById(taskCampaignId).select('createdBy');
    if (!campaign) return;
    const owner = await User.findById(campaign.createdBy).select('isActive libraryEnabled');
    if (!owner || !canUseLibrary(owner)) return;
    await LibraryJob.create({
      type: 'task_image',
      ownerId: campaign.createdBy,
      payload: { taskId: String(taskId), url, userId: mongoose.isValidObjectId(String(userId)) ? String(userId) : undefined, note }
    });
  } catch (error) {
    console.error('[library] Could not queue task image:', error);
  }
}
