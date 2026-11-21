import mongoose from 'mongoose';
import { InboxItem, IInboxItem, InboxBox, InboxAction } from '../models/InboxItem';
import { Announcement, IAnnouncement } from '../models/Announcement';
import { SupportThread, ISupportThread } from '../models/SupportThread';
import { SocialPost } from '../models/SocialPost';
import { User, UserRole, IUser } from '../models/User';
import { LLMUsage } from '../models/LLMUsage';
import { getProviderKey, calculateEstimatedCost } from '../services/llmService';
import { loadBlueSetup } from '../blue/setup';
import { runVision } from '../library/vision';
import { loadPostForUser, updatePost, markPublished, retryPost, cancelPost, PublishingError } from '../publishing/service';
import { matchIntent, intentPrompt, parseIntentReply, Intent } from './intents';
import { cleanAudience, audienceQuery, describeAudience, AudienceInput } from './audience';

type Id = mongoose.Types.ObjectId;

export class InboxError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export const isAdmin = (u: { role?: string }) => u.role === UserRole.SYSTEM_ADMIN;
const displayName = (u: { firstName?: string; lastName?: string; email?: string }) => `${u.firstName || ''} ${u.lastName || ''}`.trim() || u.email || 'User';

// ---------------------------------------------------------------------------
// Items
// ---------------------------------------------------------------------------

export function shapeItem(i: IInboxItem) {
  return {
    id: String(i._id),
    box: i.box,
    category: i.category,
    source: i.source,
    title: i.title,
    body: i.body,
    fromName: i.fromName || (i.source === 'system' ? 'Blueprint' : 'Blueprint team'),
    actions: i.status === 'open' ? i.actions : [],
    link: i.link || null,
    status: i.status,
    read: Boolean(i.readAt),
    actedAt: i.actedAt || null,
    actionTaken: i.actionTaken || null,
    resultMessage: i.resultMessage || null,
    snoozedUntil: i.snoozedUntil && i.snoozedUntil > new Date() ? i.snoozedUntil : null,
    threadId: i.threadId ? String(i.threadId) : null,
    announcementId: i.announcementId ? String(i.announcementId) : null,
    createdAt: i.createdAt,
    updatedAt: i.updatedAt
  };
}

function visibleOpen(userId: Id) {
  return { recipientId: userId, status: 'open', $or: [{ snoozedUntil: null }, { snoozedUntil: { $exists: false } }, { snoozedUntil: { $lte: new Date() } }] };
}

export async function listItems(userId: Id, q: { box?: string; status?: string; page?: number; limit?: number }) {
  const filter: Record<string, unknown> = q.status === 'all' ? { recipientId: userId, status: { $ne: 'expired' } } : visibleOpen(userId);
  if (q.box && ['action', 'update', 'message'].includes(q.box)) filter.box = q.box;
  const limit = Math.min(100, Math.max(1, q.limit || 50));
  const page = Math.max(1, q.page || 1);
  const sort: Record<string, 1 | -1> = q.box === 'message' ? { updatedAt: -1 } : { createdAt: -1 };
  const [items, total] = await Promise.all([InboxItem.find(filter).sort(sort).skip((page - 1) * limit).limit(limit), InboxItem.countDocuments(filter)]);
  return { items: items.map(shapeItem), total, page, limit };
}

export async function inboxSummary(userId: Id) {
  const rows = await InboxItem.aggregate([
    { $match: { recipientId: userId, status: 'open', $or: [{ snoozedUntil: null }, { snoozedUntil: { $exists: false } }, { snoozedUntil: { $lte: new Date() } }] } },
    { $group: { _id: '$box', total: { $sum: 1 }, unread: { $sum: { $cond: [{ $ifNull: ['$readAt', false] }, 0, 1] } } } }
  ]);
  const by = Object.fromEntries(rows.map((r) => [r._id, r]));
  return {
    action: by.action?.total || 0,
    updates: by.update?.unread || 0,
    messages: by.message?.unread || 0,
    badge: (by.action?.total || 0) + (by.update?.unread || 0) + (by.message?.unread || 0)
  };
}

export async function loadItemForUser(user: IUser, id: unknown): Promise<IInboxItem> {
  if (!mongoose.isValidObjectId(id)) throw new InboxError(400, 'Invalid item');
  const item = await InboxItem.findOne({ _id: id, recipientId: user._id });
  if (!item) throw new InboxError(404, 'This item is no longer in your Inbox');
  return item;
}

export async function markRead(item: IInboxItem) {
  if (!item.readAt) {
    item.readAt = new Date();
    await item.save();
  }
  if (item.threadId) await SupportThread.updateOne({ _id: item.threadId, userId: item.recipientId }, { $set: { userUnread: 0 } });
  return item;
}

export async function markAllRead(userId: Id, box?: string) {
  const filter: Record<string, unknown> = { recipientId: userId, status: 'open', readAt: null };
  if (box && ['update', 'message', 'action'].includes(box)) filter.box = box;
  const r = await InboxItem.updateMany(filter, { $set: { readAt: new Date() } });
  if (!box || box === 'message') await SupportThread.updateMany({ userId }, { $set: { userUnread: 0 } });
  return r.modifiedCount;
}

/** Upsert a system reminder without reopening one the user already closed. */
export async function upsertSystemItem(
  recipientId: Id,
  dedupeKey: string,
  fields: { box: InboxBox; category: string; title: string; body: string; actions: InboxAction[]; link?: string; ref?: { type: string; id: Id }; expiresAt?: Date | null },
  refresh = false
) {
  const { title, body, ...rest } = fields;
  await InboxItem.updateOne(
    { recipientId, dedupeKey },
    {
      $setOnInsert: { recipientId, dedupeKey, source: 'system', status: 'open', ...rest, ...(refresh ? {} : { title, body }) },
      ...(refresh ? { $set: { title, body } } : {})
    },
    { upsert: true }
  );
}

// ---------------------------------------------------------------------------
// Acting on items (buttons, or a typed reply that maps to a button)
// ---------------------------------------------------------------------------

export interface ActionResult {
  item: ReturnType<typeof shapeItem>;
  message: string;
  /** For "Create a post from this": the frontend opens Blue with this request. */
  openBlue?: string;
  openLink?: string;
}

async function postGroupForUser(user: IUser, item: IInboxItem) {
  if (item.ref?.type !== 'post') throw new InboxError(409, 'This reminder is not linked to a post');
  const first = await loadPostForUser(user, item.ref.id);
  const group = await SocialPost.find({ groupId: first.groupId, ownerId: first.ownerId });
  return { first, group };
}

function bluePrompt(a: { title: string; body: string }) {
  return `Help me create a social media post for my business inspired by this message from the Blueprint team.\n\nTitle: ${a.title}\n\n${a.body.slice(0, 2000)}\n\nUse my company info and brand voice, suggest a caption, and offer to add it as a task in one of my campaigns.`;
}

export async function runAction(user: IUser, item: IInboxItem, actionId: string, value?: string): Promise<ActionResult> {
  if (item.status !== 'open' && actionId !== 'create_post') throw new InboxError(409, 'This has already been dealt with');
  const action = item.actions.find((a) => a.id === actionId);
  if (!action && !['dismiss', 'snooze'].includes(actionId)) throw new InboxError(400, 'That action is not available here');
  if (action?.link) throw new InboxError(400, 'Open the link instead');

  let message = 'Done';
  let openBlue: string | undefined;
  let close = true;
  try {
    switch (actionId) {
      case 'dismiss':
      case 'keep':
        message = actionId === 'keep' ? 'Kept as scheduled' : 'Closed';
        break;
      case 'snooze': {
        const hours = Math.min(72, Math.max(1, Number(value) || 1));
        item.snoozedUntil = new Date(Date.now() + hours * 3600_000);
        message = `I'll remind you in ${hours} hour${hours === 1 ? '' : 's'}`;
        close = false;
        break;
      }
      case 'publish_now': {
        const { group } = await postGroupForUser(user, item);
        const due = group.filter((p) => p.mode === 'auto' && p.status === 'scheduled');
        if (!due.length) throw new InboxError(409, 'Nothing left to publish: it was already published, cancelled or changed');
        for (const p of due) await updatePost(user, p, { scheduledAt: new Date().toISOString(), schedule: true });
        message = `Publishing ${due.length === 1 ? 'it' : `${due.length} posts`} now`;
        break;
      }
      case 'mark_posted': {
        const post = await loadPostForUser(user, item.ref?.id);
        await markPublished(user, post, value?.trim() || undefined);
        message = 'Marked as posted';
        break;
      }
      case 'retry': {
        const post = await loadPostForUser(user, item.ref?.id);
        await retryPost(user, post);
        message = 'Trying again now';
        break;
      }
      case 'cancel_post': {
        const post = await loadPostForUser(user, item.ref?.id);
        await cancelPost(user, post);
        message = 'Cancelled';
        break;
      }
      case 'create_post': {
        openBlue = bluePrompt(item);
        message = 'Opening Blue to draft the post';
        close = false;
        break;
      }
      default:
        throw new InboxError(400, 'Unknown action');
    }
  } catch (error: any) {
    if (error instanceof PublishingError) throw new InboxError(error.status, error.message);
    throw error;
  }

  item.readAt = item.readAt || new Date();
  item.actedAt = new Date();
  item.actionTaken = actionId;
  item.resultMessage = message;
  if (close) item.status = actionId === 'dismiss' ? 'dismissed' : 'done';
  await item.save();
  return { item: shapeItem(item), message, openBlue };
}

/** Ask the AI which button a free-text reply means (only when the simple rules don't match). */
async function aiIntent(user: IUser, item: IInboxItem, text: string): Promise<Intent> {
  const setup = await loadBlueSetup();
  if (!setup.enabled || !setup.provider || !setup.model) return null;
  const started = Date.now();
  try {
    const apiKey = await getProviderKey(setup.provider);
    const r = await runVision({ provider: setup.provider, apiKey, model: setup.model, prompt: intentPrompt(item, item.actions, text) });
    await LLMUsage.create({
      userId: user._id,
      promptName: 'Inbox reply',
      llmModel: `${setup.provider}/${setup.model}`,
      promptTokens: r.usage.input,
      completionTokens: r.usage.output,
      totalTokens: r.usage.input + r.usage.output,
      estimatedCost: calculateEstimatedCost(setup.provider as any, setup.model, r.usage.input, r.usage.output),
      success: true,
      requestDuration: Date.now() - started
    }).catch(() => undefined);
    return parseIntentReply(r.text, item.actions);
  } catch {
    return null;
  }
}

export async function replyToItem(user: IUser, item: IInboxItem, text: string): Promise<ActionResult & { threadId?: string }> {
  const body = text.trim();
  if (!body) throw new InboxError(400, 'Write a reply first');
  if (body.length > 5000) throw new InboxError(400, 'Replies can be up to 5,000 characters');

  // Conversations and admin messages: the reply goes to the admin team.
  if (item.box === 'message' || item.source !== 'system') {
    let thread: ISupportThread | null = item.threadId ? await SupportThread.findOne({ _id: item.threadId, userId: user._id }) : null;
    if (!thread) {
      if (item.announcementId) {
        const a = await Announcement.findById(item.announcementId).select('allowReplies');
        if (a && !a.allowReplies) throw new InboxError(409, 'Replies are turned off for this message');
      }
      thread = await createThread(user, `Re: ${item.title}`.slice(0, 200), body, item.announcementId as Id | undefined);
      item.threadId = thread._id as Id;
    } else {
      await postUserMessage(user, thread, body);
    }
    item.readAt = item.readAt || new Date();
    item.actedAt = item.actedAt || new Date();
    if (!item.actionTaken) item.actionTaken = 'replied';
    await item.save();
    return { item: shapeItem(item), message: 'Sent to the Blueprint team', threadId: String(thread._id) };
  }

  if (item.status !== 'open') throw new InboxError(409, 'This has already been dealt with');
  const intent = matchIntent(body, item.actions) || (await aiIntent(user, item, body));
  if (!intent) {
    const options = item.actions.filter((a) => !a.link).map((a) => `“${a.label}”`);
    throw new InboxError(422, `I didn't catch that. Reply ${options.length ? `${options.join(', ')} or ` : ''}“close”, or use the buttons.`);
  }
  if (intent.action === 'close') intent.action = 'dismiss';
  return runAction(user, item, intent.action, intent.value);
}

// ---------------------------------------------------------------------------
// Support conversations
// ---------------------------------------------------------------------------

export function shapeThread(t: ISupportThread, viewer: 'user' | 'admin', userInfo?: ThreadUserInfo) {
  return {
    id: String(t._id),
    subject: t.subject,
    status: t.status,
    user: userInfo || { id: String(t.userId) },
    unread: viewer === 'user' ? t.userUnread : t.adminUnread,
    lastMessageAt: t.lastMessageAt,
    lastFromAdmin: t.lastFromAdmin,
    preview: t.messages.length ? t.messages[t.messages.length - 1].body.slice(0, 160) : '',
    announcementId: t.announcementId ? String(t.announcementId) : null,
    messages: t.messages.map((m) => ({ id: String(m._id), author: m.fromAdmin && viewer === 'user' ? `${m.authorName} · Blueprint team` : m.authorName, fromAdmin: m.fromAdmin, body: m.body, at: m.at })),
    createdAt: t.createdAt
  };
}

/** The user's Messages item for a thread (one per thread, updated as the conversation goes on). */
async function syncThreadItem(thread: ISupportThread, unreadForUser: boolean) {
  const last = thread.messages[thread.messages.length - 1];
  await InboxItem.updateOne(
    { recipientId: thread.userId, dedupeKey: `thread:${thread._id}` },
    {
      $set: {
        box: 'message',
        category: 'support',
        source: 'support',
        title: thread.subject,
        body: last ? `${last.fromAdmin ? `${last.authorName}: ` : 'You: '}${last.body.slice(0, 500)}` : '',
        fromName: 'Blueprint team',
        threadId: thread._id,
        status: 'open',
        ...(unreadForUser ? { readAt: null } : { readAt: new Date() })
      },
      $setOnInsert: { recipientId: thread.userId, dedupeKey: `thread:${thread._id}`, actions: [] }
    },
    { upsert: true }
  );
}

export async function createThread(user: IUser, subject: string, body: string, announcementId?: Id): Promise<ISupportThread> {
  const s = subject.trim().slice(0, 200);
  const b = body.trim();
  if (!s) throw new InboxError(400, 'Add a subject');
  if (!b) throw new InboxError(400, 'Write a message');
  if (b.length > 5000) throw new InboxError(400, 'Messages can be up to 5,000 characters');
  const recent = await SupportThread.countDocuments({ userId: user._id, createdAt: { $gt: new Date(Date.now() - 3600_000) } });
  if (recent >= 10) throw new InboxError(429, 'You have started many conversations in the last hour. Please continue an existing one.');
  const thread = await SupportThread.create({
    userId: user._id,
    subject: s,
    announcementId,
    messages: [{ authorId: user._id, authorName: displayName(user), fromAdmin: false, body: b, at: new Date() }],
    lastMessageAt: new Date(),
    lastFromAdmin: false,
    adminUnread: 1
  });
  await syncThreadItem(thread, false);
  return thread;
}

export async function postUserMessage(user: IUser, thread: ISupportThread, body: string) {
  const b = body.trim();
  if (!b) throw new InboxError(400, 'Write a message');
  if (b.length > 5000) throw new InboxError(400, 'Messages can be up to 5,000 characters');
  if (thread.messages.length >= 500) throw new InboxError(409, 'This conversation is very long. Please start a new one.');
  thread.messages.push({ authorId: user._id as Id, authorName: displayName(user), fromAdmin: false, body: b, at: new Date() });
  thread.lastMessageAt = new Date();
  thread.lastFromAdmin = false;
  thread.adminUnread += 1;
  thread.userUnread = 0;
  thread.status = 'open';
  await thread.save();
  await syncThreadItem(thread, false);
  return thread;
}

export async function postAdminMessage(admin: IUser, thread: ISupportThread, body: string) {
  const b = body.trim();
  if (!b) throw new InboxError(400, 'Write a message');
  if (b.length > 5000) throw new InboxError(400, 'Messages can be up to 5,000 characters');
  thread.messages.push({ authorId: admin._id as Id, authorName: admin.firstName || displayName(admin), fromAdmin: true, body: b, at: new Date() });
  thread.lastMessageAt = new Date();
  thread.lastFromAdmin = true;
  thread.userUnread += 1;
  thread.adminUnread = 0;
  await thread.save();
  await syncThreadItem(thread, true);
  return thread;
}

export async function loadThreadForUser(user: IUser, id: unknown) {
  if (!mongoose.isValidObjectId(id)) throw new InboxError(400, 'Invalid conversation');
  const t = await SupportThread.findOne({ _id: id, userId: user._id });
  if (!t) throw new InboxError(404, 'Conversation not found');
  return t;
}

export interface ThreadUserInfo {
  id: string;
  name: string;
  email?: string;
  company?: string;
}

export async function threadUserInfo(threads: ISupportThread[]): Promise<(t: ISupportThread) => ThreadUserInfo> {
  const users = await User.find({ _id: { $in: threads.map((t) => t.userId) } }).select('firstName lastName email companyInfo.companyName');
  const map = new Map<string, ThreadUserInfo>(users.map((u) => [String(u._id), { id: String(u._id), name: displayName(u), email: u.email, company: u.companyInfo?.companyName }]));
  return (t: ISupportThread) => map.get(String(t.userId)) || { id: String(t.userId), name: 'Former user' };
}

// ---------------------------------------------------------------------------
// Announcements (admin → chosen users)
// ---------------------------------------------------------------------------

export async function countAudience(input: AudienceInput) {
  const a = cleanAudience(input);
  return { count: await User.countDocuments(audienceQuery(a)), description: describeAudience(a) };
}

export function shapeAnnouncement(a: IAnnouncement, stats?: { read: number; acted: number; replies: number }) {
  const audience = cleanAudience({ ...a.audience, userIds: (a.audience?.userIds || []).map(String) });
  return {
    id: String(a._id),
    title: a.title,
    body: a.body,
    category: a.category,
    audience,
    audienceText: describeAudience(audience),
    offerPost: a.offerPost,
    allowReplies: a.allowReplies,
    status: a.status,
    scheduledAt: a.scheduledAt || null,
    sentAt: a.sentAt || null,
    recipientCount: a.recipientCount,
    stats: stats || null,
    error: a.error || null,
    createdAt: a.createdAt
  };
}

export interface AnnouncementStats {
  read: number;
  acted: number;
  replies: number;
}

export async function announcementStats(ids: Id[]): Promise<Map<string, AnnouncementStats>> {
  if (!ids.length) return new Map<string, AnnouncementStats>();
  const [items, threads] = await Promise.all([
    InboxItem.aggregate([
      { $match: { announcementId: { $in: ids } } },
      { $group: { _id: '$announcementId', read: { $sum: { $cond: [{ $ifNull: ['$readAt', false] }, 1, 0] } }, acted: { $sum: { $cond: [{ $ifNull: ['$actedAt', false] }, 1, 0] } } } }
    ]),
    SupportThread.aggregate([{ $match: { announcementId: { $in: ids } } }, { $group: { _id: '$announcementId', n: { $sum: 1 } } }])
  ]);
  const replies = new Map<string, number>(threads.map((t) => [String(t._id), t.n as number]));
  return new Map<string, AnnouncementStats>(items.map((r) => [String(r._id), { read: r.read as number, acted: r.acted as number, replies: replies.get(String(r._id)) || 0 }]));
}

/** Deliver an announcement to every matching user (batched; safe to run twice). */
export async function deliverAnnouncement(a: IAnnouncement) {
  const filter = audienceQuery(cleanAudience({ ...a.audience, userIds: (a.audience?.userIds || []).map(String) }));
  const actions: InboxAction[] = [];
  if (a.offerPost) actions.push({ id: 'create_post', label: 'Create a post from this', style: 'primary' });
  let count = 0;
  let batch: any[] = [];
  const flush = async () => {
    if (!batch.length) return;
    try {
      await InboxItem.insertMany(batch, { ordered: false });
    } catch (e: any) {
      // Duplicates (already delivered on an earlier attempt) are fine.
      if (e?.code !== 11000 && !e?.writeErrors?.every((w: any) => w.code === 11000 || w.err?.code === 11000)) throw e;
    }
    batch = [];
  };
  for await (const u of User.find(filter).select('_id').lean().cursor()) {
    batch.push({
      recipientId: u._id,
      box: 'update',
      category: a.category,
      source: 'admin',
      title: a.title,
      body: a.body,
      fromName: 'Blueprint team',
      actions,
      announcementId: a._id,
      dedupeKey: `announcement:${a._id}`
    });
    count++;
    if (batch.length >= 500) await flush();
  }
  await flush();
  return count;
}

export async function sendAnnouncementNow(a: IAnnouncement) {
  const claimed = await Announcement.findOneAndUpdate({ _id: a._id, status: { $in: ['draft', 'scheduled'] } }, { $set: { status: 'sending', error: null } }, { new: true });
  if (!claimed) throw new InboxError(409, 'This message was already sent or cancelled');
  try {
    const count = await deliverAnnouncement(claimed);
    claimed.status = 'sent';
    claimed.sentAt = new Date();
    claimed.recipientCount = count;
    await claimed.save();
    return claimed;
  } catch (error: any) {
    await Announcement.updateOne({ _id: claimed._id }, { $set: { status: 'scheduled', scheduledAt: new Date(Date.now() + 5 * 60_000), error: String(error?.message || error).slice(0, 300) } });
    throw error;
  }
}

/** Take a sent message back out of everyone's Inbox (e.g. sent by mistake). */
export async function withdrawAnnouncement(a: IAnnouncement) {
  if (a.status !== 'sent') throw new InboxError(409, 'Only sent messages can be withdrawn');
  await InboxItem.updateMany({ announcementId: a._id, source: 'admin' }, { $set: { status: 'expired' } });
  a.status = 'withdrawn';
  await a.save();
  return a;
}

// ---------------------------------------------------------------------------
// Admin overview
// ---------------------------------------------------------------------------

export const CATEGORY_LABELS: Record<string, string> = {
  post_due: 'posts waiting to be posted by hand',
  post_failed: 'failed posts',
  post_upcoming: 'upcoming post reminders',
  channel_reconnect: 'accounts that need reconnecting',
  library_review: 'Library items to review',
  ai_limit: 'users near their monthly AI limit'
};

export async function adminOverview() {
  const [system, openThreads, unreadThreads, scheduled] = await Promise.all([
    InboxItem.aggregate([
      { $match: { source: 'system', status: 'open' } },
      { $group: { _id: '$category', items: { $sum: 1 }, users: { $addToSet: '$recipientId' } } },
      { $project: { items: 1, users: { $size: '$users' } } }
    ]),
    SupportThread.countDocuments({ status: 'open' }),
    SupportThread.countDocuments({ status: 'open', adminUnread: { $gt: 0 } }),
    Announcement.countDocuments({ status: 'scheduled' })
  ]);
  return {
    attention: system.map((s) => ({ category: s._id, label: CATEGORY_LABELS[s._id] || s._id, items: s.items, users: s.users })).sort((a, b) => b.items - a.items),
    support: { open: openThreads, unread: unreadThreads },
    scheduledMessages: scheduled
  };
}
