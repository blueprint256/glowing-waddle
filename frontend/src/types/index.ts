// User types
export enum UserRole {
  SYSTEM_ADMIN = 'system_admin',
  HYBRID = 'hybrid'
}

export interface User {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  role: UserRole;
  isActive: boolean;
}

// Campaign types
export enum CampaignStatus {
  DRAFT = 'draft',
  ACTIVE = 'active',
  PAUSED = 'paused',
  COMPLETED = 'completed',
  ARCHIVED = 'archived'
}

export interface Campaign {
  _id: string;
  name: string;
  description?: string;
  status: CampaignStatus;
  startDate?: string;
  endDate?: string;
  goals?: string[];
  archived: boolean;
  createdBy: any;
  createdAt: string;
  updatedAt: string;
}

// Project types
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

export interface ProjectAssignment {
  userId: any;
  role: ProjectRole;
  assignedBy: any;
  assignedAt: string;
}

export interface Project {
  _id: string;
  name: string;
  description?: string;
  campaignId: any;
  status: ProjectStatus;
  assignments: ProjectAssignment[];
  startDate?: string;
  dueDate?: string;
  createdBy: any;
  createdAt: string;
  updatedAt: string;
}

// Task types
export enum TaskStatus {
  PENDING = 'Pending',
  IN_PROGRESS = 'In Progress',
  COMPLETED = 'Completed'
}

export interface Task {
  _id: string;
  name: string;
  description?: string;
  projectId: any;
  campaignId: any;
  status: TaskStatus;
  taskDate?: string; // Single date for when task should be carried out
  content?: string;
  designedImage?: string;
  createdBy: any;
  lastModifiedBy?: any;
  createdAt: string;
  updatedAt: string;
}

// Comment types
export interface Comment {
  _id: string;
  content: string;
  taskId?: string;
  projectId?: string;
  campaignId?: string;
  authorId: any;
  mentions: any[];
  parentCommentId?: string;
  isEdited: boolean;
  createdAt: string;
  updatedAt: string;
}

// Approval types
export enum ApprovalStatus {
  PENDING = 'pending',
  APPROVED = 'approved',
  REJECTED = 'rejected',
  CANCELLED = 'cancelled'
}

export interface Approval {
  _id: string;
  taskId: any;
  requestedBy: any;
  reviewerId: any;
  status: ApprovalStatus;
  feedback?: string;
  reviewedAt?: string;
  createdAt: string;
  updatedAt: string;
}

// Asset types
export enum AssetType {
  IMAGE = 'image',
  VIDEO = 'video',
  DOCUMENT = 'document',
  OTHER = 'other'
}

export interface Asset {
  _id: string;
  filename: string;
  originalName: string;
  mimeType: string;
  size: number;
  type: AssetType;
  path: string;
  location: string;
  taskId?: string;
  projectId?: string;
  campaignId?: string;
  uploadedBy: any;
  version: number;
  createdAt: string;
  updatedAt: string;
}
