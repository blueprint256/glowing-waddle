import mongoose, { Document, Schema } from 'mongoose';

export enum ApprovalStatus {
  PENDING = 'pending',
  APPROVED = 'approved',
  REJECTED = 'rejected',
  CANCELLED = 'cancelled'
}

export interface IApproval extends Document {
  eventId: mongoose.Types.ObjectId;
  requestedBy: mongoose.Types.ObjectId;
  reviewerId: mongoose.Types.ObjectId;
  status: ApprovalStatus;
  feedback?: string;
  reviewedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const approvalSchema = new Schema<IApproval>(
  {
    eventId: {
      type: Schema.Types.ObjectId,
      ref: 'Event',
      required: true,
      index: true
    },
    requestedBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true
    },
    reviewerId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true
    },
    status: {
      type: String,
      enum: Object.values(ApprovalStatus),
      default: ApprovalStatus.PENDING
    },
    feedback: {
      type: String,
      trim: true
    },
    reviewedAt: {
      type: Date
    }
  },
  {
    timestamps: true
  }
);

// Indexes
approvalSchema.index({ eventId: 1, status: 1 });
approvalSchema.index({ reviewerId: 1, status: 1 });

export const Approval = mongoose.model<IApproval>('Approval', approvalSchema);
