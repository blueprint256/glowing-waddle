import mongoose, { Document, Schema } from 'mongoose';

/** A reusable admin message (invoice reminder, welcome note…). */
export interface IMessageTemplate extends Document {
  name: string;
  title: string;
  body: string;
  category: string;
  createdBy: mongoose.Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const schema = new Schema<IMessageTemplate>(
  {
    name: { type: String, required: true, trim: true, maxlength: 100 },
    title: { type: String, required: true, trim: true, maxlength: 200 },
    body: { type: String, required: true, maxlength: 10000 },
    category: { type: String, default: 'announcement' },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true }
  },
  { timestamps: true }
);

export const MessageTemplate = mongoose.model<IMessageTemplate>('MessageTemplate', schema);
