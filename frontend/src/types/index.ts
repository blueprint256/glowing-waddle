// User types
export enum UserRole {
  SYSTEM_ADMIN = 'system_admin',
  HYBRID = 'hybrid',
  CLIENT = 'client',
  MARKETER = 'marketer',
  DESIGNER = 'designer'
}

export interface User {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  role: UserRole;
  teamId?: string;
  isActive: boolean;
}

// Team types
export interface Team {
  _id: string;
  name: string;
  description?: string;
  createdBy: string;
  isActive: boolean;
  members?: User[];
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
  teamId: any;
  status: CampaignStatus;
  startDate?: string;
  endDate?: string;
  budget?: number;
  goals?: string[];
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
  teamId: any;
  status: ProjectStatus;
  assignments: ProjectAssignment[];
  startDate?: string;
  dueDate?: string;
  createdBy: any;
  createdAt: string;
  updatedAt: string;
}

// Event types
export enum EventStatus {
  DRAFT = 'draft',
  IN_PROGRESS = 'in_progress',
  PENDING_APPROVAL = 'pending_approval',
  APPROVED = 'approved',
  REJECTED = 'rejected',
  PUBLISHED = 'published',
  COMPLETED = 'completed'
}

export enum EventType {
  POST = 'post',
  LAUNCH = 'launch',
  ACTIVATION = 'activation',
  DELIVERABLE = 'deliverable',
  OTHER = 'other'
}

export interface Event {
  _id: string;
  name: string;
  description?: string;
  type: EventType;
  projectId: any;
  campaignId: any;
  teamId: any;
  status: EventStatus;
  assignedTo?: any;
  scheduledDate?: string;
  content?: string;
  createdBy: any;
  lastModifiedBy?: any;
  createdAt: string;
  updatedAt: string;
}

// Comment types
export interface Comment {
  _id: string;
  content: string;
  eventId?: string;
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
  eventId: any;
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
  eventId?: string;
  projectId?: string;
  campaignId?: string;
  uploadedBy: any;
  version: number;
  createdAt: string;
  updatedAt: string;
}
