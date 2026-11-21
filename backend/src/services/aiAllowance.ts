import mongoose from 'mongoose';
import { LLMUsage } from '../models/LLMUsage';
import { AppConfig } from '../models/AppConfig';
import { UserRole, type IUser } from '../models/User';
import { AIError } from '../lib/aiError';
import { IMAGE_USAGE_MODEL_PATTERN } from '../lib/imageModels';
import { DEFAULT_ALLOWANCE, effectiveLimit, limitMessage, monthWindow, remainingOf, type AllowanceKind } from '../lib/aiAllowance';

export * from '../lib/aiAllowance';

/**
 * Monthly AI allowance (decision 20), counted from the usage log: AI pictures (designed posters, AI
 * photos and photo changes; a poster's own steps don't count extra) and Blue messages that succeeded
 * this month. Admins have no limit. Posters and photos share one allowance.
 */

/** The label Blue records its messages under (routes/blue.routes.ts). */
export const BLUE_USAGE_LABEL = 'Blue assistant';
/** One record with this label per finished poster (design engine); its AI steps use "Design · …". */
export const DESIGN_USAGE_LABEL = 'Design';
/** Every image model logs as "openai/gpt-image-…" (lib/imageModels.ts), so a model change keeps counting. */
const IMAGE_MODEL = IMAGE_USAGE_MODEL_PATTERN;

type Who = Pick<IUser, 'role' | 'aiAllowance'> & { _id: unknown };

export interface AllowanceLine {
  used: number;
  /** 0 = no limit */
  limit: number;
  /** null = no limit */
  remaining: number | null;
}

export interface AIUsage {
  /** AI pictures: posters and photos together. */
  images: AllowanceLine;
  /** The same line as images (older screens read it for posters). */
  designs: AllowanceLine;
  blueMessages: AllowanceLine;
  resetsAt: string;
  unlimited: boolean;
}

async function limits(user: Who) {
  const config = await AppConfig.getConfig();
  return {
    images: effectiveLimit(user.aiAllowance?.images, config.aiImagesPerMonth, DEFAULT_ALLOWANCE.images),
    blueMessages: effectiveLimit(user.aiAllowance?.blueMessages, config.blueMessagesPerMonth, DEFAULT_ALLOWANCE.blueMessages)
  };
}

/** Posters and photos are one allowance. */
const lineOf = (kind: AllowanceKind): 'images' | 'blueMessages' => (kind === 'blueMessages' ? 'blueMessages' : 'images');

async function usedThisMonth(userId: mongoose.Types.ObjectId, kind: AllowanceKind, start: Date): Promise<number> {
  const base = { userId, success: true, createdAt: { $gte: start } };
  if (lineOf(kind) === 'blueMessages') return LLMUsage.countDocuments({ ...base, promptName: BLUE_USAGE_LABEL });
  // AI photos and photo changes (any image model, but not a poster's own background), plus one per
  // finished poster.
  return LLMUsage.countDocuments({ ...base, $or: [{ llmModel: IMAGE_MODEL, promptName: { $not: /^Design/ } }, { promptName: DESIGN_USAGE_LABEL }] });
}

export async function aiUsage(user: Who): Promise<AIUsage> {
  const { start, resetsAt } = monthWindow();
  const id = new mongoose.Types.ObjectId(String(user._id));
  const [l, images, blueMessages] = await Promise.all([limits(user), usedThisMonth(id, 'images', start), usedThisMonth(id, 'blueMessages', start)]);
  const unlimited = user.role === UserRole.SYSTEM_ADMIN;
  const line = (used: number, limit: number): AllowanceLine => (unlimited ? { used, limit: 0, remaining: null } : { used, limit, remaining: remainingOf(limit, used) });
  const pictures = line(images, l.images);
  return { images: pictures, designs: pictures, blueMessages: line(blueMessages, l.blueMessages), resetsAt: resetsAt.toISOString(), unlimited };
}

/** Throws a 429 with a plain message when the account has used its allowance of this kind. */
export async function assertAllowance(user: Who, kind: AllowanceKind): Promise<void> {
  if (user.role === UserRole.SYSTEM_ADMIN) return;
  const { start, resetsAt } = monthWindow();
  const limit = (await limits(user))[lineOf(kind)];
  if (limit === 0) return;
  const used = await usedThisMonth(new mongoose.Types.ObjectId(String(user._id)), kind, start);
  if (used >= limit) throw new AIError(429, limitMessage(kind, limit, resetsAt));
}
