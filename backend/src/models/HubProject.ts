import mongoose, { Document, Schema } from 'mongoose';

/**
 * A Content Hub project (Part two). Independent of campaigns so that users restricted
 * to the hub never need the campaign suite.
 */
export interface IHubProject extends Document {
  userId: mongoose.Types.ObjectId;
  name: string;
  description?: string;
  createdAt: Date;
  updatedAt: Date;
}

const hubProjectSchema = new Schema<IHubProject>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    name: { type: String, required: true, trim: true, maxlength: 120 },
    description: { type: String, trim: true, maxlength: 1000 }
  },
  { timestamps: true }
);

export const HubProject = mongoose.model<IHubProject>('HubProject', hubProjectSchema);
