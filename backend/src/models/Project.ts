import mongoose, { Document, Schema } from 'mongoose';

export enum ProjectStatus {
  PLANNING = 'planning',
  IN_PROGRESS = 'in_progress',
  REVIEW = 'review',
  COMPLETED = 'completed',
  ON_HOLD = 'on_hold'
}

export enum ProjectRole {
  PROJECT_MANAGER = 'project_manager',
  PROJECT_MARKETER = 'project_marketer',
  PROJECT_DESIGNER = 'project_designer',
  VIEWER = 'viewer'
}

export interface IProjectAssignment {
  userId: mongoose.Types.ObjectId;
  role: ProjectRole;
  assignedBy: mongoose.Types.ObjectId;
  assignedAt: Date;
}

export interface IProject extends Document {
  name: string;
  description?: string;
  campaignId: mongoose.Types.ObjectId;
  teamId: mongoose.Types.ObjectId; // Inherited from campaign
  status: ProjectStatus;
  assignments: IProjectAssignment[];
  startDate?: Date;
  dueDate?: Date;
  createdBy: mongoose.Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const projectAssignmentSchema = new Schema<IProjectAssignment>(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true
    },
    role: {
      type: String,
      enum: Object.values(ProjectRole),
      required: true
    },
    assignedBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true
    },
    assignedAt: {
      type: Date,
      default: Date.now
    }
  },
  { _id: false }
);

const projectSchema = new Schema<IProject>(
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
    campaignId: {
      type: Schema.Types.ObjectId,
      ref: 'Campaign',
      required: true,
      index: true
    },
    teamId: {
      type: Schema.Types.ObjectId,
      ref: 'Team',
      required: true,
      index: true
    },
    status: {
      type: String,
      enum: Object.values(ProjectStatus),
      default: ProjectStatus.PLANNING
    },
    assignments: [projectAssignmentSchema],
    startDate: {
      type: Date
    },
    dueDate: {
      type: Date
    },
    createdBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true
    }
  },
  {
    timestamps: true
  }
);

// Indexes
projectSchema.index({ campaignId: 1, status: 1 });
projectSchema.index({ teamId: 1 });
projectSchema.index({ 'assignments.userId': 1 });

export const Project = mongoose.model<IProject>('Project', projectSchema);
