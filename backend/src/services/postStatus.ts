import mongoose from 'mongoose';
import { Task } from '../models/Task';
import { SocialPost } from '../models/SocialPost';
import { TaskStatus, ACTIVE_POST_STATES, ATTENTION_POST_STATES, statusFromPublishing } from '../lib/postStatus';

export * from '../lib/postStatus';

/**
 * Keeps each post's (task's) status in step with its publishing records, and moves older status
 * names to the new ones once. The rules themselves live in lib/postStatus.ts.
 */

type Id = mongoose.Types.ObjectId;

/** True while a post is waiting to go out, going out, or needs fixing. */
export async function hasPublishingInPlay(taskId: Id | string): Promise<boolean> {
  return Boolean(await SocialPost.exists({ taskId, status: { $in: [...ACTIVE_POST_STATES, ...ATTENTION_POST_STATES] } }));
}

/** Brings the status of these posts (tasks) in line with their publishing records. */
export async function syncTaskStatus(taskIds: Array<Id | string | null | undefined>): Promise<void> {
  const ids = [...new Set(taskIds.filter(Boolean).map(String))].filter((id) => mongoose.isValidObjectId(id));
  if (!ids.length) return;
  const [posts, tasks] = await Promise.all([
    SocialPost.find({ taskId: { $in: ids } }).select('taskId status').lean(),
    Task.find({ _id: { $in: ids } }).select('status').lean()
  ]);
  const byTask = new Map<string, string[]>();
  for (const p of posts) {
    const key = String(p.taskId);
    byTask.set(key, [...(byTask.get(key) || []), p.status]);
  }
  for (const t of tasks) {
    const from = statusFromPublishing(byTask.get(String(t._id)) || []);
    let next: TaskStatus | null = from;
    // Nothing in play any more (all cancelled or deleted): a post that was waiting goes back to Ready.
    if (!from && (t.status === TaskStatus.SCHEDULED || t.status === TaskStatus.NEEDS_ATTENTION)) next = TaskStatus.READY;
    if (next && next !== t.status) {
      await Task.updateOne({ _id: t._id, status: t.status }, { $set: { status: next } });
    }
  }
}

let lastSweep = new Date(Date.now() - 60_000);

/** Publishing changes records in many places (the scheduler, disconnects); this catches them all. */
export async function syncRecentlyChangedPosts(): Promise<void> {
  const since = new Date(lastSweep.getTime() - 5_000);
  const started = new Date();
  const taskIds = await SocialPost.distinct('taskId', { updatedAt: { $gte: since }, taskId: { $ne: null } });
  if (taskIds.length) await syncTaskStatus(taskIds as Id[]);
  lastSweep = started;
}

/**
 * One-time (idempotent) move to the new names: Pending / In Progress → Draft, Completed → Ready,
 * anything unknown → Draft; then every post with publishing records gets the status they call for.
 */
export async function migrateTaskStatuses(): Promise<void> {
  const raw = Task.collection;
  const draft = await raw.updateMany({ status: { $in: ['Pending', 'In Progress'] } }, { $set: { status: TaskStatus.DRAFT } });
  const ready = await raw.updateMany({ status: 'Completed' }, { $set: { status: TaskStatus.READY } });
  const odd = await raw.updateMany({ status: { $nin: Object.values(TaskStatus) } }, { $set: { status: TaskStatus.DRAFT } });
  const withPosts = await SocialPost.distinct('taskId', { taskId: { $ne: null } });
  await syncTaskStatus(withPosts as Id[]);
  const moved = draft.modifiedCount + ready.modifiedCount + odd.modifiedCount;
  if (moved) console.log(`[posts] moved ${moved} post status(es) to the new names`);
}
