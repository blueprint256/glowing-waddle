import mongoose, { Document, Schema } from 'mongoose';

export interface ICommandMapping extends Document {
  command: string; // Unique command identifier (e.g., "generate-campaign")
  promptId: mongoose.Types.ObjectId; // Reference to Prompt
  createdAt: Date;
  updatedAt: Date;
}

const commandMappingSchema = new Schema<ICommandMapping>(
  {
    command: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      index: true
    },
    promptId: {
      type: Schema.Types.ObjectId,
      ref: 'Prompt',
      required: true
    }
  },
  {
    timestamps: true
  }
);

export const CommandMapping = mongoose.model<ICommandMapping>('CommandMapping', commandMappingSchema);
