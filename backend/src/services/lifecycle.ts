import mongoose from 'mongoose';
import { SocialPost } from '../models/SocialPost';
import { LibraryAsset } from '../models/LibraryAsset';
import { CanvaEdit } from '../models/CanvaEdit';

/**
 * Keeps features consistent when something they depend on goes away. Without this, a deleted task's
 * scheduled post would still go out, and Library items would link to a task that no longer exists.
 */

type Id = mongoose.Types.ObjectId;

/** Posts that haven't gone out yet. Published posts stay as a record. */
const NOT_SENT = ['draft', 'scheduled', 'due', 'failed'];

async function cancelPosts(filter: Record<string, unknown>, reason: string, userId: Id): Promise<number> {
  const r = await SocialPost.updateMany(
    { ...filter, status: { $in: NOT_SENT } },
    { $set: { status: 'cancelled', lastError: reason }, $push: { events: { at: new Date(), type: 'cancelled', message: reason, by: userId } } }
  );
  return r.modifiedCount;
}

export async function onTaskDeleted(taskId: Id, userId: Id) {
  const cancelledPosts = await cancelPosts({ taskId }, 'The task was deleted', userId);
  // Library items stay (they're the user's files) but no longer point at the deleted task.
  await LibraryAsset.updateMany({ 'links.taskId': taskId }, { $set: { 'links.taskId': null } });
  await CanvaEdit.updateMany({ taskId, status: { $in: ['editing', 'failed'] } }, { $set: { status: 'failed', error: 'The task was deleted' } });
  return { cancelledPosts };
}

/** A deactivated account's scheduled posts must not go out on its behalf. */
export async function onUserDeactivated(userId: Id, byUserId: Id) {
  const cancelledPosts = await cancelPosts({ ownerId: userId }, 'The account was deactivated', byUserId);
  return { cancelledPosts };
}

/** Archiving (or "deleting", which archives) a campaign stops its posts that haven't gone out. */
export async function onCampaignArchived(campaignId: Id, userId: Id) {
  const cancelledPosts = await cancelPosts({ campaignId }, 'The campaign was archived', userId);
  return { cancelledPosts };
}
