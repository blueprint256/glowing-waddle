import mongoose, { Document, Schema } from 'mongoose';

/**
 * One item in one user's Inbox. Three boxes:
 *  - action:  the app needs a decision (post due by hand, post failed, account needs reconnecting…)
 *  - update:  information, often with optional actions (upcoming post, admin announcement, tip)
 *  - message: a conversation with the admin team (support thread)
 * System items point at the real thing behind them (ref) and close themselves when it's dealt with
 * anywhere in the app; dedupeKey stops the same reminder being created twice.
 */
export type InboxBox = 'action' | 'update' | 'message';
export type InboxStatus = 'open' | 'done' | 'dismissed' | 'expired';

export interface InboxAction {
  id: string;
  label: string;
  style?: 'primary' | 'secondary' | 'danger';
  /** Frontend path to open instead of calling the server. */
  link?: string;
  /** Asks for a short text value first (e.g. the link of a post made by hand). */
  input?: { label: string; placeholder?: string; optional?: boolean };
  /** Shown before running (e.g. publishing publicly). */
  confirm?: string;
}

export interface IInboxItem extends Document {
  recipientId: mongoose.Types.ObjectId;
  box: InboxBox;
  category: string;
  source: 'system' | 'admin' | 'support';
  title: string;
  body: string;
  fromName?: string;
  actions: InboxAction[];
  link?: string;
  ref?: { type: string; id: mongoose.Types.ObjectId };
  status: InboxStatus;
  readAt?: Date | null;
  actedAt?: Date | null;
  actionTaken?: string;
  resultMessage?: string;
  snoozedUntil?: Date | null;
  expiresAt?: Date | null;
  dedupeKey?: string;
  announcementId?: mongoose.Types.ObjectId;
  threadId?: mongoose.Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const actionSchema = new Schema<InboxAction>(
  {
    id: { type: String, required: true },
    label: { type: String, required: true },
    style: { type: String, enum: ['primary', 'secondary', 'danger'] },
    link: String,
    input: { label: String, placeholder: String, optional: Boolean },
    confirm: String
  },
  { _id: false }
);

const schema = new Schema<IInboxItem>(
  {
    recipientId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    box: { type: String, enum: ['action', 'update', 'message'], required: true },
    category: { type: String, required: true },
    source: { type: String, enum: ['system', 'admin', 'support'], required: true },
    title: { type: String, required: true, maxlength: 300 },
    body: { type: String, default: '', maxlength: 20000 },
    fromName: String,
    actions: { type: [actionSchema], default: [] },
    link: String,
    ref: { type: { type: String }, id: { type: Schema.Types.ObjectId } },
    status: { type: String, enum: ['open', 'done', 'dismissed', 'expired'], default: 'open' },
    readAt: Date,
    actedAt: Date,
    actionTaken: String,
    resultMessage: String,
    snoozedUntil: Date,
    expiresAt: Date,
    dedupeKey: String,
    announcementId: { type: Schema.Types.ObjectId, ref: 'Announcement' },
    threadId: { type: Schema.Types.ObjectId, ref: 'SupportThread' }
  },
  { timestamps: true }
);

schema.index({ recipientId: 1, status: 1, box: 1, createdAt: -1 });
schema.index({ recipientId: 1, dedupeKey: 1 }, { unique: true, partialFilterExpression: { dedupeKey: { $type: 'string' } } });
schema.index({ announcementId: 1 });
schema.index({ category: 1, status: 1 });
schema.index({ status: 1, updatedAt: 1 });

export const InboxItem = mongoose.model<IInboxItem>('InboxItem', schema);
