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

/** An earlier picture of a post (the current one is designedImage). */
export interface PostImageHistory {
  url: string;
  source: string;
  note?: string;
  at: string;
  /** A designed poster keeps its document, so it can be edited again when brought back. */
  design?: PostDesign;
}

export type PosterFormat = 'square' | 'portrait' | 'story' | 'landscape' | 'a4' | 'a3';
export type PosterField = 'eyebrow' | 'headline' | 'subhead' | 'body' | 'cta' | 'footnote' | 'hashtag' | 'sponsorsTitle' | 'personLabel' | 'personName' | 'personRole' | 'social' | 'web';
export type DetailKind = 'date' | 'time' | 'place' | 'phone' | 'web' | 'info';

/** The words on a poster (design engine). */
export interface PosterText extends Partial<Record<PosterField, string>> {
  headline: string;
  details?: { kind: DetailKind; text: string }[];
  badge?: { top?: string; main: string; bottom?: string };
}

/** A designed poster's document (only what the app reads; the server keeps the rest). */
export interface PosterDoc {
  designId: string;
  format: PosterFormat;
  params: Record<string, number | string | boolean>;
  text: PosterText;
  photos: { url: string }[];
  sponsors: { name: string }[];
  background?: { url: string } | null;
  tweaks?: { headlineScale?: number; colorSwap?: boolean };
}

/** A poster made by the design engine: what's needed to edit and print it. */
export interface PostDesign {
  doc: PosterDoc;
  issues?: { level: string; code: string; message: string }[];
  score?: number;
  note?: string;
  why?: string;
  jobId?: string;
  /** Where each editable line sits on the picture (0..1). */
  areas?: { field: PosterField | 'details' | 'badge'; x: number; y: number; w: number; h: number }[];
  pdf_a4?: string;
  pdf_a3?: string;
}

/** An AI picture not chosen yet (deleted after 7 days). */
export interface PostAIDraft {
  id: string;
  url: string;
  kind: 'create' | 'change' | 'design';
  /** kind "design": the poster behind the picture. */
  design?: PostDesign;
  /** Create: what the post was about; change: the instruction. */
  prompt?: string;
  /** Change: the picture that was changed. */
  from?: string;
  size?: string;
  at: string;
}

export type ReferenceRole = 'include' | 'style';

/** A picture Create image should include, or whose style it should follow. */
export interface PostReference {
  id: string;
  url: string;
  role: ReferenceRole;
  name?: string;
  at: string;
}

export type PictureFormat = 'square' | 'portrait' | 'landscape';
export type LogoCorner = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';

export interface Task {
  _id: string;
  /** Post title (a label only you see). */
  name: string;
  /** True while the title is automatic (it follows the caption). */
  autoName?: boolean;
  /** What the post is about (the brief the AI works from). */
  description?: string;
  /** The account the post belongs to. */
  ownerId: string;
  /** The campaign, or null for a post without one. */
  campaignId: any;
  /** The theme the post was in before themes were retired. */
  legacyTheme?: string;
  status: TaskStatus | string;
  /** The day it goes out (stored as midnight UTC). */
  taskDate?: string | null;
  /** The caption: the text that gets published. */
  content?: string;
  /** The post's picture. */
  designedImage?: string;
  /** The current picture's poster document, when it's a designed poster. */
  pictureDesign?: PostDesign | null;
  /** Up to 3 earlier pictures, newest first. */
  imageHistory?: PostImageHistory[];
  /** AI pictures not chosen yet, newest first. */
  aiDrafts?: PostAIDraft[];
  /** Pictures for Create image (up to 6). */
  references?: PostReference[];
  /** The choices last used for Create image. */
  pictureOptions?: { format?: PictureFormat; logo?: LogoCorner | null };
  /** The newest AI draft (older clients). */
  pendingGeneratedImage?: string;
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
