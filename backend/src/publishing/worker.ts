import mongoose from 'mongoose';
import { SocialPost, ISocialPost } from '../models/SocialPost';
import { SocialChannel } from '../models/SocialChannel';
import { User, canUsePublishing } from '../models/User';
import { logAudit } from '../utils/auditLogger';
import { AuditAction } from '../models/AuditLog';
import { FetchLike, PublishError, MediaFile, PlatformId } from './types';
import { ADAPTERS, PLATFORM_PROVIDER, PLATFORM_NAMES, simulatePublish } from './registry';
import { loadPublishingSetup } from './setup';
import { accountAuth } from './service';
import { openMedia } from './media';
import { syncRecentlyChangedPosts } from '../services/postStatus';
import { expireOldDrafts } from '../services/posts';

/**
 * The scheduler. Every few seconds it:
 *  1. marks manual posts whose time has come as "due" (time to post by hand),
 *  2. claims due automatic posts one at a time (atomic, safe with several servers) and publishes them,
 *  3. checks back on posts platforms are still processing (TikTok),
 *  4. fails posts whose server stopped mid-upload — never re-posts blindly, to avoid duplicates.
 */

type Id = mongoose.Types.ObjectId;
const POLL_MS = 10_000;
const CONCURRENCY = 2;
const MAX_ATTEMPTS = 3;
const STALE_MS = 20 * 60_000;
const defaultFetch: FetchLike = (url, init) => fetch(url, init) as any;

let running = 0;
let timer: NodeJS.Timeout | null = null;

function event(type: string, message?: string) {
  return { at: new Date(), type, message };
}

async function fail(post: ISocialPost, message: string) {
  await SocialPost.updateOne(
    { _id: post._id },
    { $set: { status: 'failed', lastError: message.slice(0, 1000), lockedAt: null, progress: null }, $push: { events: event('failed', message.slice(0, 500)) } }
  );
  await logAudit({ action: AuditAction.POST_FAILED, userId: post.createdBy as Id, targetType: 'SocialPost', targetId: post._id as Id, metadata: { platform: post.platform, error: message.slice(0, 300) } }).catch(() => undefined);
}

/** Publish one claimed post. Exported for tests. */
export async function executePost(post: ISocialPost, fetchImpl: FetchLike = defaultFetch): Promise<void> {
  const setup = await loadPublishingSetup();
  if (!setup.enabled) return fail(post, 'Publishing is switched off for this workspace');
  const owner = await User.findById(post.ownerId).select('isActive publishingEnabled');
  if (!owner || !canUsePublishing(owner)) return fail(post, 'Publishing is switched off for this account');
  const channel = post.channelId ? await SocialChannel.findById(post.channelId).select('+accessTokenEnc +refreshTokenEnc') : null;
  if (!channel) return fail(post, 'The account was disconnected');
  if (channel.status !== 'active') return fail(post, `Reconnect ${PLATFORM_NAMES[channel.platform]} · ${channel.name} and retry`);
  const provider = PLATFORM_PROVIDER[post.platform as PlatformId];
  const settings = setup.providers[provider];
  if (!channel.simulated && !settings.ready) return fail(post, `${PLATFORM_NAMES[post.platform]} publishing is switched off by your administrator`);
  if (channel.simulated && !setup.testMode) return fail(post, 'Test channels are switched off');

  const heartbeat = async (message?: string) => {
    await SocialPost.updateOne({ _id: post._id }, { $set: { lockedAt: new Date(), ...(message ? { progress: message } : {}) } });
  };

  try {
    const media: MediaFile[] = [];
    for (let i = 0; i < post.media.length; i++) media.push(await openMedia(post.ownerId as Id, post._id as Id, post.media[i], i));
    const req = {
      text: post.text || '',
      media,
      options: post.options || {},
      account: channel.simulated ? { accessToken: '', accountId: channel.accountId, username: channel.username, meta: {} } : await accountAuth(channel, fetchImpl),
      settings,
      fetchImpl,
      heartbeat
    };
    const result = channel.simulated ? await simulatePublish(post.platform, req) : await ADAPTERS[provider].publish(post.platform, req);
    await SocialChannel.updateOne({ _id: channel._id }, { $set: { lastUsedAt: new Date(), lastError: undefined } });
    if (result.pending) {
      await SocialPost.updateOne(
        { _id: post._id },
        { $set: { status: 'processing', remoteId: result.remoteId, nextAttemptAt: new Date(Date.now() + 20_000), lockedAt: null, progress: `${PLATFORM_NAMES[post.platform]} is processing the post` }, $push: { events: event('uploaded') } }
      );
      return;
    }
    await SocialPost.updateOne(
      { _id: post._id },
      { $set: { status: 'published', publishedAt: new Date(), remoteId: result.remoteId, remoteUrl: result.url, lockedAt: null, progress: null, lastError: null }, $push: { events: event('published', result.url) } }
    );
  } catch (error: any) {
    const e = error instanceof PublishError ? error : new PublishError(error?.message || 'Unexpected error', { retryable: true });
    if (e.opts.reconnect) {
      await SocialChannel.updateOne({ _id: channel._id }, { $set: { status: 'reconnect', lastError: e.message.slice(0, 500) } });
      return fail(post, `${e.message} — reconnect the account, then retry`);
    }
    if (e.opts.retryable && post.attempts < MAX_ATTEMPTS) {
      const delay = post.attempts === 1 ? 60_000 : 5 * 60_000;
      await SocialPost.updateOne(
        { _id: post._id },
        { $set: { status: 'scheduled', nextAttemptAt: new Date(Date.now() + delay), lockedAt: null, progress: null, lastError: e.message.slice(0, 1000) }, $push: { events: event('retrying', e.message.slice(0, 500)) } }
      );
      return;
    }
    return fail(post, e.message);
  }
}

async function checkProcessing(post: ISocialPost, fetchImpl: FetchLike = defaultFetch) {
  const channel = post.channelId ? await SocialChannel.findById(post.channelId).select('+accessTokenEnc +refreshTokenEnc') : null;
  const provider = PLATFORM_PROVIDER[post.platform as PlatformId];
  const adapter = ADAPTERS[provider];
  if (!channel || !adapter.checkStatus || !post.remoteId) return fail(post, 'Could not check the post status');
  try {
    const setup = await loadPublishingSetup();
    const result = await adapter.checkStatus(post.platform, { account: await accountAuth(channel, fetchImpl), remoteId: post.remoteId, settings: setup.providers[provider], fetchImpl });
    if (result.pending) {
      const age = Date.now() - (post.updatedAt?.getTime() || Date.now());
      if (post.attempts > 40 || age > 2 * 3600_000) return fail(post, `${PLATFORM_NAMES[post.platform]} is still processing after a long time; check the app`);
      await SocialPost.updateOne({ _id: post._id }, { $set: { nextAttemptAt: new Date(Date.now() + 30_000), lockedAt: null } });
      return;
    }
    await SocialPost.updateOne(
      { _id: post._id },
      { $set: { status: 'published', publishedAt: new Date(), remoteId: result.remoteId, remoteUrl: result.url, lockedAt: null, progress: null, lastError: null }, $push: { events: event('published', result.url) } }
    );
  } catch (error: any) {
    if (error instanceof PublishError && error.opts.retryable) {
      await SocialPost.updateOne({ _id: post._id }, { $set: { nextAttemptAt: new Date(Date.now() + 60_000), lockedAt: null } });
      return;
    }
    return fail(post, error?.message || 'Publishing failed');
  }
}

async function tick() {
  const now = new Date();
  // Each step is independent, so a problem in one never stops the others.
  try {
    // 1. Manual posts: time to post by hand.
    await SocialPost.updateMany(
      { mode: 'manual', status: 'scheduled', scheduledAt: { $lte: now } },
      { $set: { status: 'due' }, $push: { events: event('due', 'Time to post this by hand') } }
    );
  } catch (error) {
    console.error('[publishing] could not mark posts due:', error);
  }
  try {
    // 4. Interrupted uploads: we can't know whether the platform received the post, so don't repeat it.
    const stale = await SocialPost.find({ status: 'publishing', lockedAt: { $lt: new Date(Date.now() - STALE_MS) } }).limit(20);
    for (const p of stale) await fail(p, 'Publishing was interrupted. Check the account to see whether it went out before retrying.');
  } catch (error) {
    console.error('[publishing] could not check interrupted posts:', error);
  }
  try {

    // 2 + 3. Claim work up to the concurrency limit.
    while (running < CONCURRENCY) {
      const post = await SocialPost.findOneAndUpdate(
        { mode: 'auto', status: 'scheduled', nextAttemptAt: { $lte: new Date() } },
        { $set: { status: 'publishing', lockedAt: new Date(), progress: 'Starting' }, $inc: { attempts: 1 }, $push: { events: event('publishing') } },
        { sort: { nextAttemptAt: 1 }, new: true }
      );
      const processing = post
        ? null
        : await SocialPost.findOneAndUpdate(
            { status: 'processing', nextAttemptAt: { $lte: new Date() }, $or: [{ lockedAt: null }, { lockedAt: { $lt: new Date(Date.now() - 120_000) } }] },
            { $set: { lockedAt: new Date() }, $inc: { attempts: 1 } },
            { sort: { nextAttemptAt: 1 }, new: true }
          );
      const job = post || processing;
      if (!job) break;
      running++;
      (post ? executePost(post) : checkProcessing(processing!))
        .catch((e) => console.error('[publishing] job error:', e))
        .finally(() => {
          running--;
        });
    }
  } catch (error) {
    console.error('[publishing] scheduler error:', error);
  }
  try {
    // Keep each post's status (Scheduled / Published / Needs attention) in step with its records.
    await syncRecentlyChangedPosts();
  } catch (error) {
    console.error('[publishing] could not update post statuses:', error);
  }  // Unpicked AI pictures older than 7 days are deleted (checked once an hour).
  if (Date.now() - lastDraftSweep > 3600_000) {
    lastDraftSweep = Date.now();
    try {
      const removed = await expireOldDrafts();
      if (removed) console.log(`[posts] deleted ${removed} unpicked AI picture(s) older than 7 days`);
    } catch (error) {
      console.error('[posts] could not delete old AI pictures:', error);
    }
  }
}

let lastDraftSweep = 0;

/** Posts saved while the history field was misdefined may hold text entries; clear those once. */
async function repairEventHistory() {
  try {
    const r = await SocialPost.collection.updateMany({ 'events.0': { $type: 'string' } }, { $set: { events: [] } });
    if (r.modifiedCount) console.log(`[publishing] repaired the history of ${r.modifiedCount} post(s)`);
  } catch (error) {
    console.error('[publishing] could not repair post history:', error);
  }
}

export function startPublishingWorker() {
  if (timer || process.env.PUBLISHING_WORKER === 'off') return;
  timer = setInterval(tick, POLL_MS);
  setTimeout(() => void repairEventHistory().then(tick), 3000);
  console.log('📣 Publishing scheduler started');
}
