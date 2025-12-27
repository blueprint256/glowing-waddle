import mongoose, { Document, Schema } from 'mongoose';

export interface IComment extends Document {
  content: string;
  projectId?: mongoose.Types.ObjectId;
  campaignId?: mongoose.Types.ObjectId;
  authorId: mongoose.Types.ObjectId;
  mentions: mongoose.Types.ObjectId[];
  parentCommentId?: mongoose.Types.ObjectId;
  isEdited: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const commentSchema = new Schema<IComment>(
  {
    content: {
      type: String,
      required: true,
      trim: true
    },
    projectId: {
      type: Schema.Types.ObjectId,
      ref: 'Project',
      index: true
    },
    campaignId: {
      type: Schema.Types.ObjectId,
      ref: 'Campaign',
      index: true
    },
    authorId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true
    },
    mentions: [{
      type: Schema.Types.ObjectId,
      ref: 'User'
    }],
    parentCommentId: {
      type: Schema.Types.ObjectId,
      ref: 'Comment'
    },
    isEdited: {
      type: Boolean,
      default: false
    }
  },
  {
    timestamps: true
  }
);

// Indexes
commentSchema.index({ authorId: 1 });

export const Comment = mongoose.model<IComment>('Comment', commentSchema);
