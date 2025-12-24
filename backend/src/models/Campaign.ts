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
  teamId: mongoose.Types.ObjectId;
  status: CampaignStatus;
  startDate?: Date;
  endDate?: Date;
  createdBy: mongoose.Types.ObjectId;
  budget?: number;
  goals?: string[];
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
    teamId: {
      type: Schema.Types.ObjectId,
      ref: 'Team',
      required: true
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
    budget: {
      type: Number,
      min: 0
    },
    goals: [{
      type: String
    }]
  },
  {
    timestamps: true
  }
);

// Indexes for performance
campaignSchema.index({ teamId: 1, status: 1 });
campaignSchema.index({ createdAt: -1 });

export const Campaign = mongoose.model<ICampaign>('Campaign', campaignSchema);
