import mongoose, { Document, Schema } from 'mongoose';
import { PLATFORMS, PlatformId } from '../publishing/types';

/**
 * One post to one place. Publishing a task to three channels creates three SocialPosts sharing a
 * groupId. mode "auto" posts through the platform's API; mode "manual" is a reminder + record for
 * posting by hand (works with no platform approvals at all).
 *
 * Status flow:  draft → scheduled → publishing → published
 *                                 ↘ failed (retry) / cancelled
 *               manual: scheduled → due (time to post by hand) → published (marked, with link)
 */
export const POST_STATUSES = ['draft', 'scheduled', 'publishing', 'processing', 'published', 'failed', 'cancelled', 'due'] as const;
export type PostStatus = (typeof POST_STATUSES)[number];

export interface PostMedia {
  kind: 'image' | 'video';
  source: 'url' | 'library';
  url?: string;
  assetId?: mongoose.Types.ObjectId;
  versionId?: mongoose.Types.ObjectId;
  mime?: string;
  size?: number;
  width?: number;
  height?: number;
  name?: string;
}

export interface ISocialPost extends Document {
  ownerId: mongoose.Types.ObjectId;
  groupId: string;
  taskId?: mongoose.Types.ObjectId;
  campaignId?: mongoose.Types.ObjectId;
  channelId?: mongoose.Types.ObjectId;
  platform: PlatformId;
  mode: 'auto' | 'manual';
  text: string;
  media: PostMedia[];
  options: Record<string, any>;
  status: PostStatus;
  scheduledAt?: Date;
  publishedAt?: Date;
  remoteId?: string;
  remoteUrl?: string;
  attempts: number;
  nextAttemptAt?: Date;
  lockedAt?: Date;
  progress?: string;
  lastError?: string;
  events: { at: Date; type: string; message?: string; by?: mongoose.Types.ObjectId }[];
  createdBy: mongoose.Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const mediaSchema = new Schema<PostMedia>(
  {
    kind: { type: String, enum: ['image', 'video'], required: true },
    source: { type: String, enum: ['url', 'library'], required: true },
    url: String,
    assetId: { type: Schema.Types.ObjectId, ref: 'LibraryAsset' },
    versionId: { type: Schema.Types.ObjectId, ref: 'LibraryVersion' },
    mime: String,
    size: Number,
    width: Number,
    height: Number,
    name: String
  },
  { _id: false }
);

// A field literally called "type" must be written as { type: String }: Mongoose reads a bare
// `type: String` as the type of the whole object, which turned this list into a list of strings.
const eventSchema = new Schema(
  {
    at: { type: Date, default: Date.now },
    type: { type: String, required: true },
    message: String,
    by: { type: Schema.Types.ObjectId, ref: 'User' }
  },
  { _id: false }
);

const schema = new Schema<ISocialPost>(
  {
    ownerId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    groupId: { type: String, required: true, index: true },
    taskId: { type: Schema.Types.ObjectId, ref: 'Task', index: true },
    campaignId: { type: Schema.Types.ObjectId, ref: 'Campaign' },
    channelId: { type: Schema.Types.ObjectId, ref: 'SocialChannel' },
    platform: { type: String, enum: PLATFORMS, required: true },
    mode: { type: String, enum: ['auto', 'manual'], required: true },
    text: { type: String, default: '', maxlength: 70000 },
    media: { type: [mediaSchema], default: [] },
    options: { type: Schema.Types.Mixed, default: {} },
    status: { type: String, enum: POST_STATUSES, default: 'draft' },
    scheduledAt: Date,
    publishedAt: Date,
    remoteId: String,
    remoteUrl: String,
    attempts: { type: Number, default: 0 },
    nextAttemptAt: Date,
    lockedAt: Date,
    progress: String,
    lastError: String,
    events: { type: [eventSchema], default: [] },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true }
  },
  { timestamps: true, minimize: false }
);

schema.index({ ownerId: 1, scheduledAt: -1 });
schema.index({ status: 1, nextAttemptAt: 1 });
schema.index({ ownerId: 1, status: 1, scheduledAt: 1 });

export const SocialPost = mongoose.model<ISocialPost>('SocialPost', schema);
