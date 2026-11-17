import mongoose, { Document, Schema } from 'mongoose';

/** A conversation between one user and the admin team (support question, or a reply to an announcement). */
export interface ThreadMessage {
  _id?: mongoose.Types.ObjectId;
  authorId: mongoose.Types.ObjectId;
  authorName: string;
  fromAdmin: boolean;
  body: string;
  at: Date;
}

export interface ISupportThread extends Document {
  userId: mongoose.Types.ObjectId;
  subject: string;
  status: 'open' | 'resolved';
  announcementId?: mongoose.Types.ObjectId;
  messages: ThreadMessage[];
  lastMessageAt: Date;
  lastFromAdmin: boolean;
  userUnread: number;
  adminUnread: number;
  resolvedBy?: mongoose.Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const messageSchema = new Schema<ThreadMessage>({
  authorId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  authorName: { type: String, required: true },
  fromAdmin: { type: Boolean, required: true },
  body: { type: String, required: true, maxlength: 5000 },
  at: { type: Date, default: Date.now }
});

const schema = new Schema<ISupportThread>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    subject: { type: String, required: true, trim: true, maxlength: 200 },
    status: { type: String, enum: ['open', 'resolved'], default: 'open' },
    announcementId: { type: Schema.Types.ObjectId, ref: 'Announcement' },
    messages: { type: [messageSchema], default: [] },
    lastMessageAt: { type: Date, default: Date.now },
    lastFromAdmin: { type: Boolean, default: false },
    userUnread: { type: Number, default: 0 },
    adminUnread: { type: Number, default: 0 },
    resolvedBy: { type: Schema.Types.ObjectId, ref: 'User' }
  },
  { timestamps: true }
);

schema.index({ userId: 1, lastMessageAt: -1 });
schema.index({ status: 1, lastMessageAt: -1 });
schema.index({ userId: 1, announcementId: 1 });

export const SupportThread = mongoose.model<ISupportThread>('SupportThread', schema);
