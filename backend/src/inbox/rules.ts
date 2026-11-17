import mongoose from 'mongoose';
import { InboxItem } from '../models/InboxItem';
import { Announcement } from '../models/Announcement';
import { SocialPost } from '../models/SocialPost';
import { SocialChannel } from '../models/SocialChannel';
import { LibraryAsset } from '../models/LibraryAsset';
import { LibraryJob } from '../models/LibraryJob';
import { User } from '../models/User';
import { PLATFORM_NAMES } from '../publishing/registry';
import { loadLibrarySetup } from '../library/setup';
import { upsertSystemItem, sendAnnouncementNow } from './service';
import { links } from '../lib/links';

/**
 * The Inbox's reminder rules. Every minute each rule finds what currently needs the user's attention,
 * creates one Inbox item per thing (never twice, thanks to dedupeKey), and closes items whose cause
 * has gone away — e.g. a failed post that was retried from the task page. Rules read the real data,
 * so the Inbox can never drift out of sync with the rest of the app.
 */

type Id = mongoose.Types.ObjectId;
const MAX = 5000;

/** "today at 09:00" / "tomorrow at 09:00" / "Fri 27 Nov at 09:00", in the app's time zone. */
export function when(d: Date, now = new Date(), timeZone = process.env.APP_TIMEZONE || 'Africa/Kampala'): string {
  const dayOf = (x: Date) => Date.parse(`${x.toLocaleDateString('en-CA', { timeZone })}T00:00:00Z`);
  const diff = Math.round((dayOf(d) - dayOf(now)) / 86400_000);
  const time = d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone });
  const date = d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone });
  return diff === 0 ? `today at ${time}` : diff === 1 ? `tomorrow at ${time}` : `${date} at ${time}`;
}

const preview = (s: string, n = 280) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/** Close open reminders of a category whose cause is gone. */
async function closeStale(category: string, liveKeys: string[]) {
  await InboxItem.updateMany(
    { category, source: 'system', status: 'open', dedupeKey: { $nin: liveKeys } },
    { $set: { status: 'done', resultMessage: 'Dealt with' } }
  );
}

async function upcomingPosts(now: Date) {
  const muted = new Set((await User.find({ inboxMuted: 'post_upcoming' }).distinct('_id')).map(String));
  const posts = await SocialPost.find({ status: 'scheduled', scheduledAt: { $gt: new Date(now.getTime() + 15 * 60_000), $lte: new Date(now.getTime() + 24 * 3600_000) } })
    .select('groupId ownerId platform mode channelId scheduledAt createdAt text taskId')
    .populate('channelId', 'name')
    .populate('taskId', 'name')
    .limit(MAX);
  // One reminder per publish action (all destinations of a task at the same time).
  const groups = new Map<string, typeof posts>();
  for (const p of posts) {
    // Not for posts scheduled just now: the user has just seen them.
    if (p.scheduledAt!.getTime() - p.createdAt.getTime() < 3 * 3600_000) continue;
    if (muted.has(String(p.ownerId))) continue;
    const list = groups.get(p.groupId) || [];
    list.push(p);
    groups.set(p.groupId, list);
  }
  const keys: string[] = [];
  for (const [groupId, list] of groups) {
    const first = list[0];
    const key = `post_upcoming:${groupId}:${first.scheduledAt!.getTime()}`;
    keys.push(key);
    const where = list.map((p) => `${PLATFORM_NAMES[p.platform]}${(p.channelId as any)?.name ? ` · ${(p.channelId as any).name}` : p.mode === 'manual' ? ' (by hand)' : ''}`).join(', ');
    const taskName = (first.taskId as any)?.name;
    const auto = list.some((p) => p.mode === 'auto');
    await upsertSystemItem(first.ownerId as Id, key, {
      box: 'update',
      category: 'post_upcoming',
      title: `${taskName ? `“${taskName}”` : 'A post'} goes out ${when(first.scheduledAt!, now)}`,
      body: `To: ${where}\n\n${preview(first.text || '(no caption)')}`,
      actions: [
        ...(auto ? [{ id: 'publish_now', label: 'Publish now', style: 'primary' as const, confirm: `Publish to ${where} now instead of ${when(first.scheduledAt!, now)}?` }] : []),
        { id: 'keep', label: 'Keep the schedule', style: 'secondary' },
        { id: 'open', label: first.taskId ? 'Open the task' : 'Open Publishing', link: first.taskId ? links.post(first.taskId) : links.publishing('queue') }
      ],
      ref: { type: 'post', id: first._id as Id },
      expiresAt: first.scheduledAt
    });
  }
  await closeStale('post_upcoming', keys);
}

async function duePosts() {
  const posts = await SocialPost.find({ mode: 'manual', status: 'due' }).select('ownerId platform scheduledAt text taskId').populate('taskId', 'name').limit(MAX);
  const keys: string[] = [];
  for (const p of posts) {
    const key = `post_due:${p._id}:${p.scheduledAt?.getTime() || 0}`;
    keys.push(key);
    const name = PLATFORM_NAMES[p.platform];
    await upsertSystemItem(p.ownerId as Id, key, {
      box: 'action',
      category: 'post_due',
      title: `Time to post${(p.taskId as any)?.name ? ` “${(p.taskId as any).name}”` : ''} on ${name}`,
      body: `Copy the caption and download the files from the Publishing page, post them on ${name}, then mark it as posted.\n\n${preview(p.text || '(no caption)')}`,
      actions: [
        { id: 'mark_posted', label: 'Mark as posted', style: 'primary', input: { label: 'Link to the live post', placeholder: 'https://…', optional: true } },
        { id: 'snooze', label: 'Remind me in an hour', style: 'secondary' },
        { id: 'open', label: 'Get the caption and files', link: links.publishing('queue') }
      ],
      ref: { type: 'post', id: p._id as Id }
    });
  }
  await closeStale('post_due', keys);
}

async function failedPosts(now: Date) {
  const posts = await SocialPost.find({ status: 'failed', updatedAt: { $gt: new Date(now.getTime() - 14 * 86400_000) } })
    .select('ownerId platform mode scheduledAt lastError taskId channelId')
    .populate('channelId', 'name')
    .populate('taskId', 'name')
    .limit(MAX);
  const keys: string[] = [];
  for (const p of posts) {
    const key = `post_failed:${p._id}:${p.scheduledAt?.getTime() || 0}`;
    keys.push(key);
    const account = (p.channelId as any)?.name;
    await upsertSystemItem(p.ownerId as Id, key, {
      box: 'action',
      category: 'post_failed',
      title: `${PLATFORM_NAMES[p.platform]} post failed${(p.taskId as any)?.name ? `: “${(p.taskId as any).name}”` : ''}`,
      body: `${account ? `Account: ${account}\n` : ''}${p.lastError || 'The platform did not accept the post.'}`,
      actions: [
        ...(p.mode === 'auto' && !/reconnect/i.test(p.lastError || '') ? [{ id: 'retry', label: 'Try again', style: 'primary' as const }] : []),
        ...(/reconnect/i.test(p.lastError || '') ? [{ id: 'open_accounts', label: 'Reconnect the account', link: links.publishing('accounts') }] : []),
        { id: 'cancel_post', label: "Don't post it", style: 'danger' },
        { id: 'open', label: 'Open', link: links.publishing('queue') }
      ],
      ref: { type: 'post', id: p._id as Id }
    });
  }
  await closeStale('post_failed', keys);
}

async function reconnectChannels() {
  const channels = await SocialChannel.find({ status: 'reconnect' }).select('ownerId platform name updatedAt lastError').limit(MAX);
  const keys: string[] = [];
  for (const c of channels) {
    const key = `channel_reconnect:${c._id}:${c.updatedAt.getTime()}`;
    keys.push(key);
    await upsertSystemItem(c.ownerId as Id, key, {
      box: 'action',
      category: 'channel_reconnect',
      title: `Reconnect ${PLATFORM_NAMES[c.platform]} · ${c.name}`,
      body: `Posts can't go out to this account until it's reconnected.${c.lastError ? `\n\n${c.lastError}` : ''}`,
      actions: [{ id: 'reconnect', label: 'Reconnect', link: links.publishing('accounts') }],
      ref: { type: 'channel', id: c._id as Id }
    });
  }
  await closeStale('channel_reconnect', keys);
}

function isoWeek(d: Date): string {
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  const year = t.getUTCFullYear();
  const week = Math.ceil(((t.getTime() - Date.UTC(year, 0, 1)) / 86400_000 + 1) / 7);
  return `${year}-W${week}`;
}

async function libraryReviews(now: Date) {
  const rows = await LibraryAsset.aggregate([{ $match: { needsReview: true, deletedAt: null } }, { $group: { _id: '$ownerId', n: { $sum: 1 } } }]);
  const keys: string[] = [];
  for (const r of rows) {
    const key = `library_review:${isoWeek(now)}`;
    keys.push(key);
    await upsertSystemItem(
      r._id as Id,
      key,
      {
        box: 'action',
        category: 'library_review',
        title: `${r.n} Library item${r.n === 1 ? '' : 's'} to review`,
        body: `${r.n === 1 ? 'An upload looks' : 'Some uploads look'} like a new version of something already in your Library. Decide whether to keep ${r.n === 1 ? 'it' : 'them'} as versions or separate items.`,
        actions: [{ id: 'review', label: 'Review now', link: links.library({ view: 'review' }) }]
      },
      true
    );
  }
  // Close only for users with nothing left to review (keys are per user + week).
  const owners = rows.map((r) => r._id);
  await InboxItem.updateMany(
    { category: 'library_review', source: 'system', status: 'open', recipientId: { $nin: owners } },
    { $set: { status: 'done', resultMessage: 'Dealt with' } }
  );
}

async function aiLimits(now: Date) {
  const setup = await loadLibrarySetup();
  if (!setup.enabled || !setup.monthlyAiLimit) return;
  const start = new Date(now.getFullYear(), now.getMonth(), 1);
  const rows = await LibraryJob.aggregate([{ $match: { aiUsed: true, finishedAt: { $gte: start } } }, { $group: { _id: '$ownerId', n: { $sum: 1 } } }]);
  const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const end = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  for (const r of rows) {
    if (r.n < setup.monthlyAiLimit * 0.9) continue;
    const full = r.n >= setup.monthlyAiLimit;
    await upsertSystemItem(r._id as Id, `ai_limit:${month}:${full ? 'full' : 'near'}`, {
      box: 'update',
      category: 'ai_limit',
      title: full ? 'Monthly AI reading allowance used up' : 'Almost at this month’s AI reading allowance',
      body: full
        ? `New Library uploads are still stored and searchable by name, folder and text, and the AI reads them next month. Used: ${r.n} of ${setup.monthlyAiLimit}.`
        : `You've used ${r.n} of ${setup.monthlyAiLimit} AI-read items this month.`,
      actions: [{ id: 'open', label: 'Open the Library', link: links.library() }],
      expiresAt: end
    });
  }
}

async function scheduledAnnouncements(now: Date) {
  const due = await Announcement.find({ status: 'scheduled', scheduledAt: { $lte: now } }).limit(20);
  for (const a of due) {
    try {
      await sendAnnouncementNow(a);
    } catch (error) {
      console.error('[inbox] could not send scheduled message:', error);
    }
  }
}

async function housekeeping(now: Date) {
  await InboxItem.updateMany({ status: 'open', expiresAt: { $lte: now } }, { $set: { status: 'expired' } });
  // Closed items are kept 120 days for reference, then removed.
  await InboxItem.deleteMany({ status: { $in: ['done', 'dismissed', 'expired'] }, updatedAt: { $lt: new Date(now.getTime() - 120 * 86400_000) } });
}

export const RULES: [string, (now: Date) => Promise<void>][] = [
  ['scheduled messages', scheduledAnnouncements],
  ['upcoming posts', upcomingPosts],
  ['posts due by hand', duePosts],
  ['failed posts', failedPosts],
  ['accounts to reconnect', reconnectChannels],
  ['Library reviews', libraryReviews],
  ['AI allowance', aiLimits],
  ['housekeeping', housekeeping]
];

let timer: NodeJS.Timeout | null = null;
let running = false;

export async function runInboxRules(now = new Date()) {
  if (running) return;
  running = true;
  try {
    for (const [name, rule] of RULES) {
      try {
        await rule(now);
      } catch (error) {
        console.error(`[inbox] rule "${name}" failed:`, error);
      }
    }
  } finally {
    running = false;
  }
}

export function startInboxWorker() {
  if (timer || process.env.INBOX_WORKER === 'off') return;
  timer = setInterval(() => void runInboxRules(), 60_000);
  setTimeout(() => void runInboxRules(), 10_000);
  console.log('📥 Inbox reminders started');
}
