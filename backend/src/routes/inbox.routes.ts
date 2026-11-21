import express, { Request, Response } from 'express';
import mongoose from 'mongoose';
import { isAuthenticated } from '../middleware/auth';
import { isSystemAdmin } from '../middleware/rbac';
import { User } from '../models/User';
import { Announcement } from '../models/Announcement';
import { SupportThread } from '../models/SupportThread';
import { MessageTemplate } from '../models/MessageTemplate';
import { logAudit } from '../utils/auditLogger';
import { AuditAction } from '../models/AuditLog';
import { cleanAudience } from '../inbox/audience';
import {
  InboxError,
  listItems,
  inboxSummary,
  loadItemForUser,
  markRead,
  markAllRead,
  runAction,
  replyToItem,
  shapeItem,
  createThread,
  postUserMessage,
  postAdminMessage,
  loadThreadForUser,
  shapeThread,
  threadUserInfo,
  countAudience,
  shapeAnnouncement,
  announcementStats,
  sendAnnouncementNow,
  withdrawAnnouncement,
  adminOverview
} from '../inbox/service';

/**
 * Inbox: each user's reminders, admin messages and support conversations — and, for System Admins,
 * Outreach (compose, audiences, scheduling, results, support queue, templates) under /admin.
 */
const router = express.Router();
type Id = mongoose.Types.ObjectId;

const MUTABLE = ['post_upcoming'];

function fail(res: Response, error: unknown, fallback: string) {
  const status = (error as any)?.status;
  if (error instanceof InboxError || (typeof status === 'number' && status >= 400 && status < 500 && (error as any)?.message)) {
    return res.status(status).json({ success: false, message: (error as any).message });
  }
  console.error(`[inbox] ${fallback}:`, error);
  return res.status(500).json({ success: false, message: fallback });
}

// ---------------------------------------------------------------------------
// My Inbox
// ---------------------------------------------------------------------------

router.get('/summary', isAuthenticated, async (req: Request, res: Response) => {
  try {
    res.set('Cache-Control', 'no-store');
    res.json({ success: true, ...(await inboxSummary(req.user!._id as Id)) });
  } catch (error) {
    fail(res, error, 'Could not load the Inbox');
  }
});

router.get('/items', isAuthenticated, async (req: Request, res: Response) => {
  try {
    const q = req.query as Record<string, string | undefined>;
    res.json({ success: true, ...(await listItems(req.user!._id as Id, { box: q.box, status: q.status, page: Number(q.page) || 1, limit: Number(q.limit) || 50 })) });
  } catch (error) {
    fail(res, error, 'Could not load the Inbox');
  }
});

router.post('/items/read-all', isAuthenticated, async (req: Request, res: Response) => {
  try {
    res.json({ success: true, updated: await markAllRead(req.user!._id as Id, req.body?.box) });
  } catch (error) {
    fail(res, error, 'Could not update the Inbox');
  }
});

router.post('/items/:id/read', isAuthenticated, async (req: Request, res: Response) => {
  try {
    res.json({ success: true, item: shapeItem(await markRead(await loadItemForUser(req.user!, req.params.id))) });
  } catch (error) {
    fail(res, error, 'Could not update the item');
  }
});

router.post('/items/:id/actions/:action', isAuthenticated, async (req: Request, res: Response) => {
  try {
    const item = await loadItemForUser(req.user!, req.params.id);
    res.json({ success: true, ...(await runAction(req.user!, item, req.params.action, typeof req.body?.value === 'string' ? req.body.value.slice(0, 500) : undefined)) });
  } catch (error) {
    fail(res, error, 'Could not do that');
  }
});

router.post('/items/:id/reply', isAuthenticated, async (req: Request, res: Response) => {
  try {
    const item = await loadItemForUser(req.user!, req.params.id);
    res.json({ success: true, ...(await replyToItem(req.user!, item, String(req.body?.text || ''))) });
  } catch (error) {
    fail(res, error, 'Could not send the reply');
  }
});

router.get('/preferences', isAuthenticated, async (req: Request, res: Response) => {
  res.json({ success: true, muted: (req.user!.inboxMuted || []).filter((m) => MUTABLE.includes(m)), mutable: MUTABLE });
});

router.put('/preferences', isAuthenticated, async (req: Request, res: Response) => {
  try {
    const muted = Array.isArray(req.body?.muted) ? req.body.muted.filter((m: unknown) => typeof m === 'string' && MUTABLE.includes(m)) : [];
    await User.updateOne({ _id: req.user!._id }, { $set: { inboxMuted: muted } });
    res.json({ success: true, muted });
  } catch (error) {
    fail(res, error, 'Could not save preferences');
  }
});

// Conversations with the admin team

router.get('/threads', isAuthenticated, async (req: Request, res: Response) => {
  try {
    const threads = await SupportThread.find({ userId: req.user!._id }).sort({ lastMessageAt: -1 }).limit(100);
    res.json({ success: true, threads: threads.map((t) => ({ ...shapeThread(t, 'user'), messages: undefined })) });
  } catch (error) {
    fail(res, error, 'Could not load conversations');
  }
});

router.post('/threads', isAuthenticated, async (req: Request, res: Response) => {
  try {
    const thread = await createThread(req.user!, String(req.body?.subject || ''), String(req.body?.body || ''));
    res.status(201).json({ success: true, thread: shapeThread(thread, 'user') });
  } catch (error) {
    fail(res, error, 'Could not send the message');
  }
});

router.get('/threads/:id', isAuthenticated, async (req: Request, res: Response) => {
  try {
    const thread = await loadThreadForUser(req.user!, req.params.id);
    if (thread.userUnread) {
      thread.userUnread = 0;
      await thread.save();
    }
    res.json({ success: true, thread: shapeThread(thread, 'user') });
  } catch (error) {
    fail(res, error, 'Could not load the conversation');
  }
});

router.post('/threads/:id/messages', isAuthenticated, async (req: Request, res: Response) => {
  try {
    const thread = await postUserMessage(req.user!, await loadThreadForUser(req.user!, req.params.id), String(req.body?.body || ''));
    res.json({ success: true, thread: shapeThread(thread, 'user') });
  } catch (error) {
    fail(res, error, 'Could not send the message');
  }
});

// ---------------------------------------------------------------------------
// Outreach (System Admin)
// ---------------------------------------------------------------------------

const admin = express.Router();
admin.use(isAuthenticated, isSystemAdmin);

admin.get('/overview', async (_req: Request, res: Response) => {
  try {
    res.json({ success: true, overview: await adminOverview() });
  } catch (error) {
    fail(res, error, 'Could not load the overview');
  }
});

/** Choices for the audience picker: sectors and tags in use, with how many users have each. */
admin.get('/audience-options', async (_req: Request, res: Response) => {
  try {
    const [sectors, tags] = await Promise.all([
      User.aggregate([
        { $match: { isActive: { $ne: false }, 'companyInfo.sector': { $type: 'string', $ne: '' } } },
        { $group: { _id: { $trim: { input: '$companyInfo.sector' } }, n: { $sum: 1 } } },
        { $sort: { n: -1 } },
        { $limit: 200 }
      ]),
      User.aggregate([{ $match: { isActive: { $ne: false } } }, { $unwind: '$tags' }, { $group: { _id: '$tags', n: { $sum: 1 } } }, { $sort: { n: -1 } }, { $limit: 200 }])
    ]);
    res.json({ success: true, sectors: sectors.map((s) => ({ value: s._id, count: s.n })), tags: tags.map((t) => ({ value: t._id, count: t.n })) });
  } catch (error) {
    fail(res, error, 'Could not load audience options');
  }
});

admin.post('/audience-count', async (req: Request, res: Response) => {
  try {
    res.json({ success: true, ...(await countAudience(req.body?.audience || {})) });
  } catch (error) {
    fail(res, error, 'Could not count recipients');
  }
});

function readMessageBody(b: any) {
  const title = typeof b?.title === 'string' ? b.title.trim() : '';
  const body = typeof b?.body === 'string' ? b.body.trim() : '';
  if (!title) throw new InboxError(400, 'Add a title');
  if (!body) throw new InboxError(400, 'Write the message');
  if (title.length > 200) throw new InboxError(400, 'Titles can be up to 200 characters');
  if (body.length > 10000) throw new InboxError(400, 'Messages can be up to 10,000 characters');
  const category = ['announcement', 'tip', 'trend', 'billing', 'event'].includes(b?.category) ? b.category : 'announcement';
  return { title, body, category };
}

admin.get('/announcements', async (req: Request, res: Response) => {
  try {
    const status = typeof req.query.status === 'string' ? req.query.status.split(',') : undefined;
    const list = await Announcement.find(status ? { status: { $in: status } } : {}).sort({ createdAt: -1 }).limit(200);
    const stats = await announcementStats(list.filter((a) => ['sent', 'withdrawn'].includes(a.status)).map((a) => a._id as Id));
    res.json({ success: true, announcements: list.map((a) => shapeAnnouncement(a, stats.get(String(a._id)))) });
  } catch (error) {
    fail(res, error, 'Could not load messages');
  }
});

/** Create a message: send now, schedule, or keep as a draft. */
admin.post('/announcements', async (req: Request, res: Response) => {
  try {
    const { title, body, category } = readMessageBody(req.body);
    const audience = cleanAudience(req.body?.audience);
    const when = ['now', 'schedule', 'draft'].includes(req.body?.when) ? req.body.when : 'draft';
    let scheduledAt: Date | undefined;
    if (when === 'schedule') {
      scheduledAt = new Date(String(req.body?.scheduledAt || ''));
      if (Number.isNaN(scheduledAt.getTime())) throw new InboxError(400, 'Choose a date and time');
      if (scheduledAt.getTime() < Date.now() - 60_000) throw new InboxError(400, 'That time is in the past');
    }
    if (when !== 'draft') {
      const { count } = await countAudience(audience);
      if (!count) throw new InboxError(400, 'Nobody matches this audience');
    }
    const a = await Announcement.create({
      authorId: req.user!._id,
      title,
      body,
      category,
      audience,
      offerPost: req.body?.offerPost === true,
      allowReplies: req.body?.allowReplies !== false,
      status: when === 'schedule' ? 'scheduled' : 'draft',
      scheduledAt
    });
    const result = when === 'now' ? await sendAnnouncementNow(a) : a;
    await logAudit({ action: AuditAction.MESSAGE_SENT, userId: req.user!._id as Id, targetType: 'Announcement', targetId: a._id as Id, metadata: { title, when, recipients: result.recipientCount }, req });
    res.status(201).json({ success: true, announcement: shapeAnnouncement(result) });
  } catch (error) {
    fail(res, error, 'Could not save the message');
  }
});

async function loadAnnouncement(id: unknown) {
  if (!mongoose.isValidObjectId(id)) throw new InboxError(400, 'Invalid message');
  const a = await Announcement.findById(id);
  if (!a) throw new InboxError(404, 'Message not found');
  return a;
}

admin.patch('/announcements/:id', async (req: Request, res: Response) => {
  try {
    const a = await loadAnnouncement(req.params.id);
    if (!['draft', 'scheduled'].includes(a.status)) throw new InboxError(409, 'Sent messages can no longer be edited');
    const { title, body, category } = readMessageBody({ title: a.title, body: a.body, category: a.category, ...req.body });
    a.title = title;
    a.body = body;
    a.category = category;
    if (req.body?.audience) a.audience = cleanAudience(req.body.audience) as any;
    if (typeof req.body?.offerPost === 'boolean') a.offerPost = req.body.offerPost;
    if (typeof req.body?.allowReplies === 'boolean') a.allowReplies = req.body.allowReplies;
    if (req.body?.scheduledAt !== undefined) {
      const d = req.body.scheduledAt ? new Date(req.body.scheduledAt) : null;
      if (d && Number.isNaN(d.getTime())) throw new InboxError(400, 'Choose a date and time');
      a.scheduledAt = d;
      a.status = d ? 'scheduled' : 'draft';
    }
    await a.save();
    res.json({ success: true, announcement: shapeAnnouncement(a) });
  } catch (error) {
    fail(res, error, 'Could not save the message');
  }
});

admin.post('/announcements/:id/send', async (req: Request, res: Response) => {
  try {
    const a = await loadAnnouncement(req.params.id);
    const { count } = await countAudience({ ...a.audience, userIds: (a.audience.userIds || []).map(String) });
    if (!count) throw new InboxError(400, 'Nobody matches this audience');
    const sent = await sendAnnouncementNow(a);
    await logAudit({ action: AuditAction.MESSAGE_SENT, userId: req.user!._id as Id, targetType: 'Announcement', targetId: a._id as Id, metadata: { title: a.title, recipients: sent.recipientCount }, req });
    res.json({ success: true, announcement: shapeAnnouncement(sent) });
  } catch (error) {
    fail(res, error, 'Could not send the message');
  }
});

admin.post('/announcements/:id/cancel', async (req: Request, res: Response) => {
  try {
    const a = await Announcement.findOneAndUpdate({ _id: req.params.id, status: { $in: ['draft', 'scheduled'] } }, { $set: { status: 'cancelled' } }, { new: true });
    if (!a) throw new InboxError(409, 'Only drafts and scheduled messages can be cancelled');
    res.json({ success: true, announcement: shapeAnnouncement(a) });
  } catch (error) {
    fail(res, error, 'Could not cancel the message');
  }
});

admin.post('/announcements/:id/withdraw', async (req: Request, res: Response) => {
  try {
    const a = await withdrawAnnouncement(await loadAnnouncement(req.params.id));
    await logAudit({ action: AuditAction.MESSAGE_WITHDRAWN, userId: req.user!._id as Id, targetType: 'Announcement', targetId: a._id as Id, metadata: { title: a.title }, req });
    res.json({ success: true, announcement: shapeAnnouncement(a) });
  } catch (error) {
    fail(res, error, 'Could not withdraw the message');
  }
});

admin.delete('/announcements/:id', async (req: Request, res: Response) => {
  try {
    const a = await loadAnnouncement(req.params.id);
    if (!['draft', 'cancelled'].includes(a.status)) throw new InboxError(409, 'Only drafts and cancelled messages can be deleted');
    await a.deleteOne();
    res.json({ success: true });
  } catch (error) {
    fail(res, error, 'Could not delete the message');
  }
});

// Support queue

admin.get('/threads', async (req: Request, res: Response) => {
  try {
    const status = req.query.status === 'resolved' ? 'resolved' : req.query.status === 'all' ? undefined : 'open';
    const threads = await SupportThread.find(status ? { status } : {}).sort({ adminUnread: -1, lastMessageAt: -1 }).limit(200);
    const info = await threadUserInfo(threads);
    res.json({ success: true, threads: threads.map((t) => ({ ...shapeThread(t, 'admin', info(t)), messages: undefined })) });
  } catch (error) {
    fail(res, error, 'Could not load conversations');
  }
});

async function loadThread(id: unknown) {
  if (!mongoose.isValidObjectId(id)) throw new InboxError(400, 'Invalid conversation');
  const t = await SupportThread.findById(id);
  if (!t) throw new InboxError(404, 'Conversation not found');
  return t;
}

admin.get('/threads/:id', async (req: Request, res: Response) => {
  try {
    const t = await loadThread(req.params.id);
    if (t.adminUnread) {
      t.adminUnread = 0;
      await t.save();
    }
    const info = await threadUserInfo([t]);
    res.json({ success: true, thread: shapeThread(t, 'admin', info(t)) });
  } catch (error) {
    fail(res, error, 'Could not load the conversation');
  }
});

admin.post('/threads/:id/messages', async (req: Request, res: Response) => {
  try {
    const t = await postAdminMessage(req.user!, await loadThread(req.params.id), String(req.body?.body || ''));
    const info = await threadUserInfo([t]);
    res.json({ success: true, thread: shapeThread(t, 'admin', info(t)) });
  } catch (error) {
    fail(res, error, 'Could not send the reply');
  }
});

admin.patch('/threads/:id', async (req: Request, res: Response) => {
  try {
    const t = await loadThread(req.params.id);
    if (!['open', 'resolved'].includes(req.body?.status)) throw new InboxError(400, 'status must be open or resolved');
    t.status = req.body.status;
    t.resolvedBy = req.body.status === 'resolved' ? (req.user!._id as Id) : undefined;
    if (req.body.status === 'resolved') t.adminUnread = 0;
    await t.save();
    const info = await threadUserInfo([t]);
    res.json({ success: true, thread: shapeThread(t, 'admin', info(t)) });
  } catch (error) {
    fail(res, error, 'Could not update the conversation');
  }
});

// Templates

admin.get('/templates', async (_req: Request, res: Response) => {
  try {
    const list = await MessageTemplate.find().sort({ name: 1 }).limit(200);
    res.json({ success: true, templates: list.map((t) => ({ id: String(t._id), name: t.name, title: t.title, body: t.body, category: t.category })) });
  } catch (error) {
    fail(res, error, 'Could not load templates');
  }
});

admin.post('/templates', async (req: Request, res: Response) => {
  try {
    const { title, body, category } = readMessageBody(req.body);
    const name = typeof req.body?.name === 'string' && req.body.name.trim() ? req.body.name.trim().slice(0, 100) : title.slice(0, 100);
    const t = await MessageTemplate.create({ name, title, body, category, createdBy: req.user!._id });
    res.status(201).json({ success: true, template: { id: String(t._id), name: t.name, title: t.title, body: t.body, category: t.category } });
  } catch (error) {
    fail(res, error, 'Could not save the template');
  }
});

admin.delete('/templates/:id', async (req: Request, res: Response) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) throw new InboxError(400, 'Invalid template');
    await MessageTemplate.deleteOne({ _id: req.params.id });
    res.json({ success: true });
  } catch (error) {
    fail(res, error, 'Could not delete the template');
  }
});

router.use('/admin', admin);

export default router;
