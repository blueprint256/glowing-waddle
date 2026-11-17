import mongoose from 'mongoose';
import { CommandMapping } from '../models/CommandMapping';
import { Campaign } from '../models/Campaign';
import { User } from '../models/User';
import type { ITask } from '../models/Task';
import { compileSuperPrompt, executeCommandChain, sendToLLM } from './llmService';
import { AIError } from '../lib/aiError';

/**
 * AI writing help on a post (Improve caption, Improve brief).
 *
 * Each feature runs the admin's command when one is set up (Settings → AI, or the connector's
 * set_command), and otherwise a built-in prompt, so it works from day one. Always uses the brand of
 * the campaign's owner (an admin working on a client's post gets the client's brand).
 */

type Id = mongoose.Types.ObjectId;

/** Kept under its first name for the post routes. */
export { AIError as PostAIError } from '../lib/aiError';

/** Ways to improve a caption, as offered in the app. */
export const CAPTION_STYLES: Record<string, { label: string; instruction: string; platform?: string }> = {
  improve: { label: 'Improve', instruction: 'Improve it: clearer and more engaging, same meaning, about the same length.' },
  shorter: { label: 'Shorter', instruction: 'Make it noticeably shorter (about half), keeping the key message and any call to action.' },
  playful: { label: 'More playful', instruction: 'Make it more playful and warm, without losing the message.' },
  professional: { label: 'More professional', instruction: 'Make it more professional and polished.' },
  fix: { label: 'Fix spelling and grammar', instruction: 'Only fix spelling, grammar and punctuation. Do not change the wording otherwise.' },
  cta: { label: 'Add a call to action', instruction: 'Add one clear call to action that fits the post. Keep the rest.' },
  hashtags: { label: 'Add hashtags', instruction: 'Add 3 to 5 relevant hashtags at the end (keep any already there; use the campaign hashtags when they fit).' },
  x: { label: 'Fit for X', platform: 'X', instruction: 'Fit X (Twitter): at most 270 characters in total, hashtags included. Keep the core message.' },
  linkedin: {
    label: 'Fit for LinkedIn',
    platform: 'LinkedIn',
    instruction: 'Fit LinkedIn: a strong first line (only about the first 210 characters show before "see more"), a professional tone, short paragraphs, at most 3 hashtags.'
  },
  instagram: {
    label: 'Fit for Instagram',
    platform: 'Instagram',
    instruction: 'Fit Instagram: a hook in the first 125 characters (shown before "more"), line breaks for easy reading, hashtags at the end (30 at most).'
  },
  write: { label: 'Write caption', instruction: 'There is no caption yet. Write one from the brief and the post title.' }
};

export const BUILTIN_IMPROVE_CAPTION = `You are the social media copywriter for this brand.

Brand:
{brand}

Campaign:
{campaign}

Post title: {postTitle}
Brief: {brief}

Current caption:
"""
{caption}
"""

What to do: {instruction}

Rules:
- Follow the brand's tone of voice and its rules.
- Keep the facts. Do not invent prices, dates, offers, names or links.
- Use emojis sparingly unless the brand's tone calls for them.
- Reply with the caption only: no quotation marks, no title, no explanation.`;

export const BUILTIN_IMPROVE_BRIEF = `You are a senior social media strategist. Rewrite the brief for one social media post so a designer and a copywriter can make it without asking questions.

Brand:
{brand}

Campaign:
{campaign}

Post title: {postTitle}
Current brief: {brief}
Current caption (may be empty): {caption}

Write the improved brief as plain text (no headings, no preamble), 60 to 120 words, covering the goal of the post, the key message, the visual idea, the call to action and the best platform. Follow the brand's tone and rules. Do not invent prices, dates or offers. Reply with the brief only.`;

/** The brand (of the campaign owner) and the campaign, for prompts. */
export async function postContext(task: ITask, fallbackUserId: Id) {
  const campaign = await Campaign.findById(task.campaignId);
  const owner = await User.findById(campaign?.createdBy || fallbackUserId);
  return { campaign, companyInfo: owner?.companyInfo };
}

/** Removes what models wrap answers in: code fences, quotes, a "Caption:" label. */
export function cleanAIText(text: string): string {
  let s = String(text || '').trim();
  const fence = s.match(/^```[a-z]*\s*([\s\S]*?)```$/i);
  if (fence) s = fence[1].trim();
  s = s.replace(/^(caption|brief|post|improved caption|new caption)\s*:\s*/i, '');
  if (s.length > 1 && /^["“'].*["”']$/s.test(s)) s = s.slice(1, -1).trim();
  return s;
}

/**
 * Runs a post command: the admin's mapping when it exists, else the built-in prompt.
 * Returns the cleaned text.
 */
export async function runPostCommand(
  command: string,
  builtin: { name: string; template: string },
  data: Record<string, unknown>,
  userId: Id
): Promise<{ text: string; source: 'command' | 'builtin' }> {
  const mapping = await CommandMapping.findOne({ command }).populate('promptId').populate('chainId').populate('steps.promptId');
  const usable = mapping && (mapping.promptId || mapping.chainId || (mapping.steps && mapping.steps.length > 0));
  let content: string;
  let source: 'command' | 'builtin';
  if (usable) {
    const result = await executeCommandChain(mapping, data as any, { userId });
    content = result.content;
    source = 'command';
  } else {
    const prompt = compileSuperPrompt(builtin.template, data as any);
    const result = await sendToLLM(prompt, { userId, promptName: builtin.name, temperature: 0.7, maxTokens: 1200 });
    content = result.content;
    source = 'builtin';
  }
  const text = cleanAIText(content);
  if (!text) throw new AIError(502, 'The AI returned an empty answer. Try again.');
  return { text, source };
}

/** Turns provider failures into messages people can act on. */
export function aiErrorMessage(error: any, fallback: string): { status: number; message: string } {
  if (error instanceof AIError) return { status: error.status, message: error.message };
  const m = String(error?.message || '');
  if (/api key/i.test(m)) return { status: 503, message: 'AI isn’t set up yet. Ask your admin to add an AI key in Settings.' };
  if (/rate limit|429/i.test(m)) return { status: 429, message: 'The AI is busy right now. Try again in a minute.' };
  if (/timeout|timed out|ETIMEDOUT/i.test(m)) return { status: 504, message: 'The AI took too long. Try again.' };
  return { status: 500, message: fallback };
}
