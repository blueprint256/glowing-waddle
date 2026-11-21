import mongoose, { Document, Schema } from 'mongoose';

/**
 * The preview image of a built-in design for the admin design library: one portrait render with
 * typical words, three partners and a neutral brand. Made once per design version.
 */
export interface IDesignPreview extends Document {
  designId: string;
  version: number;
  url: string;
  createdAt: Date;
  updatedAt: Date;
}

const designPreviewSchema = new Schema<IDesignPreview>(
  {
    designId: { type: String, required: true, unique: true },
    version: { type: Number, required: true },
    url: { type: String, required: true }
  },
  { timestamps: true }
);

export const DesignPreviewModel = mongoose.model<IDesignPreview>('DesignPreview', designPreviewSchema);
