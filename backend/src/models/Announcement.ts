import mongoose, { Document, Schema } from 'mongoose';

/** Who an admin message goes to. Empty filters + everyone=true → all active users. */
export interface Audience {
  everyone: boolean;
  roles: string[];
  accessModes: string[];
  sectors: string[];
  tags: string[];
  userIds: mongoose.Types.ObjectId[];
}

/** A message from the admin team to a chosen group of users (announcement, tip, trend, billing…). */
export interface IAnnouncement extends Document {
  authorId: mongoose.Types.ObjectId;
  title: string;
  body: string;
  category: 'announcement' | 'tip' | 'trend' | 'billing' | 'event';
  audience: Audience;
  offerPost: boolean;
  allowReplies: boolean;
  status: 'draft' | 'scheduled' | 'sending' | 'sent' | 'cancelled' | 'withdrawn';
  scheduledAt?: Date | null;
  sentAt?: Date | null;
  recipientCount: number;
  error?: string;
  createdAt: Date;
  updatedAt: Date;
}

const schema = new Schema<IAnnouncement>(
  {
    authorId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    title: { type: String, required: true, trim: true, maxlength: 200 },
    body: { type: String, required: true, maxlength: 10000 },
    category: { type: String, enum: ['announcement', 'tip', 'trend', 'billing', 'event'], default: 'announcement' },
    audience: {
      everyone: { type: Boolean, default: false },
      roles: { type: [String], default: [] },
      accessModes: { type: [String], default: [] },
      sectors: { type: [String], default: [] },
      tags: { type: [String], default: [] },
      userIds: { type: [Schema.Types.ObjectId], ref: 'User', default: [] }
    },
    offerPost: { type: Boolean, default: false },
    allowReplies: { type: Boolean, default: true },
    status: { type: String, enum: ['draft', 'scheduled', 'sending', 'sent', 'cancelled', 'withdrawn'], default: 'draft' },
    scheduledAt: Date,
    sentAt: Date,
    recipientCount: { type: Number, default: 0 },
    error: String
  },
  { timestamps: true }
);

schema.index({ status: 1, scheduledAt: 1 });
schema.index({ createdAt: -1 });

export const Announcement = mongoose.model<IAnnouncement>('Announcement', schema);
