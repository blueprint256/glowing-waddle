import mongoose, { Document, Schema } from 'mongoose';

export interface ISlot extends Document {
  name: string;
  projectId: mongoose.Types.ObjectId;
  userId: mongoose.Types.ObjectId;
  assetId?: mongoose.Types.ObjectId;
  pendingRequestId?: mongoose.Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const slotSchema = new Schema<ISlot>(
  {
    name: {
      type: String,
      required: true,
      trim: true
    },
    projectId: {
      type: Schema.Types.ObjectId,
      ref: 'HubProject',
      required: true,
      index: true
    },
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true
    },
    assetId: {
      type: Schema.Types.ObjectId,
      ref: 'HubAsset'
    },
    pendingRequestId: {
      type: Schema.Types.ObjectId,
      ref: 'PendingRequest'
    }
  },
  {
    timestamps: true
  }
);

export const Slot = mongoose.model<ISlot>('Slot', slotSchema);