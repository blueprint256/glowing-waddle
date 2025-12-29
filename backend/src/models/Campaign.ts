import mongoose, { Document, Schema } from 'mongoose';

export enum CampaignStatus {
  DRAFT = 'draft',
  ACTIVE = 'active',
  PAUSED = 'paused',
  COMPLETED = 'completed',
  ARCHIVED = 'archived'
}

export interface ICampaign extends Document {
  name: string;
  description?: string;
  status: CampaignStatus;
  startDate?: Date;
  endDate?: Date;
  createdBy: mongoose.Types.ObjectId;
  goals?: string[];
  coreMessages?: string;
  hashtags?: string[];
  archived: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const campaignSchema = new Schema<ICampaign>(
  {
    name: {
      type: String,
      required: true,
      trim: true
    },
    description: {
      type: String,
      trim: true
    },
    status: {
      type: String,
      enum: Object.values(CampaignStatus),
      default: CampaignStatus.DRAFT
    },
    startDate: {
      type: Date
    },
    endDate: {
      type: Date
    },
    createdBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true
    },
    goals: [{
      type: String
    }],
    coreMessages: {
      type: String,
      trim: true
    },
    hashtags: [{
      type: String,
      trim: true
    }],
    archived: {
      type: Boolean,
      default: false
    }
  },
  {
    timestamps: true
  }
);

// Indexes for performance
campaignSchema.index({ status: 1 });
campaignSchema.index({ createdAt: -1 });

export const Campaign = mongoose.model<ICampaign>('Campaign', campaignSchema);
