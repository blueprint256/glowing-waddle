// User types
export enum UserRole {
  SYSTEM_ADMIN = 'system_admin',
  HYBRID = 'hybrid'
}

/** How each kind of account is called in the app. */
export const ROLE_LABELS: Record<UserRole, string> = {
  [UserRole.SYSTEM_ADMIN]: 'Admin',
  [UserRole.HYBRID]: 'Client'
};

/**
 * Which part of the platform a user is on (set by a System Admin).
 * Same app and data for both; Part two simply has AI generation switched off.
 */
export enum AccessMode {
  PART_ONE = 'part_one',
  PART_TWO = 'part_two'
}

export const ACCESS_MODE_LABELS: Record<AccessMode, string> = {
  [AccessMode.PART_ONE]: 'AI on',
  [AccessMode.PART_TWO]: 'AI off (everything else works as usual)'
};

/** Same rule as the API: System Admins always keep AI access. */
export function canUseAI(user: { role: UserRole; accessMode?: AccessMode | string } | null | undefined): boolean {
  if (!user) return false;
  if (user.role === UserRole.SYSTEM_ADMIN) return true;
  return user.accessMode !== AccessMode.PART_TWO;
}

export interface CompanyInfo {
  companyName?: string;
  sector?: string;
  about?: string;
  productsServices?: string;
  usp?: string;
  brandTone?: string;
  audienceProfile?: string;
  globalRules?: string;
}

export interface User {
  _id?: string;
  id?: string;
  email: string;
  firstName: string;
  lastName: string;
  role: UserRole;
  accessMode?: AccessMode;
  /** Claude connector (MCP) access; set by a System Admin. Treated as enabled when absent. */
  mcpEnabled?: boolean;
  /** Blue (in-app assistant) access; set by a System Admin. Treated as enabled when absent. */
  assistantEnabled?: boolean;
  /** Library (Aggregator) access; set by a System Admin. Treated as enabled when absent. */
  libraryEnabled?: boolean;
  /** Publishing (scheduling/posting) access; set by a System Admin. Treated as enabled when absent. */
  publishingEnabled?: boolean;
  /** Admin labels for targeting Outreach messages. */
  tags?: string[];
  isActive: boolean;
  authProvider?: 'local' | 'google';
  /** From /auth/me: whether the account has a password (Google sign-ins may not). */
  hasPassword?: boolean;
  companyInfo?: CompanyInfo;
  campaignCount?: number;
  loginMethod?: string;
  hasCanvaIntegration?: boolean;
  createdAt?: string;
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
  coreMessages?: string;
  hashtags?: string[];
  archived: boolean;
  createdBy: User | string;
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

// Posts (the API calls them tasks). Statuses: lib/status.ts.
export enum TaskStatus {
  IDEA = 'Idea',
  DRAFT = 'Draft',
  READY = 'Ready',
  SCHEDULED = 'Scheduled',
  PUBLISHED = 'Published',
  NEEDS_ATTENTION = 'Needs attention'
}

export interface Task {
  _id: string;
  /** Post title (internal; not published). */
  name: string;
  /** The brief: what the post should achieve and show. */
  description?: string;
  /** Theme (API: project). */
  projectId: any;
  campaignId: any;
  status: TaskStatus | string;
  /** The day it goes out (stored as midnight UTC). */
  taskDate?: string;
  /** The caption: the text that gets published. */
  content?: string;
  /** The post's image. */
  designedImage?: string;
  /** An AI image waiting to be used or discarded. */
  pendingGeneratedImage?: string;
  /** Reference images (for the AI or a designer). */
  attachedImages?: string[];
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
