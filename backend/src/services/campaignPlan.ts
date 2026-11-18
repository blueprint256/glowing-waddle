import mongoose from 'mongoose';
import type { ICampaign } from '../models/Campaign';
import { Task } from '../models/Task';
import { autoTitle } from './posts';
import { User } from '../models/User';
import { CommandMapping } from '../models/CommandMapping';
import { compileSuperPrompt, executeCommandChain, sendToLLM } from './llmService';
import { AIError } from '../lib/aiError';
import { BUILTIN_PLAN_CAMPAIGN, PLAN_COMMAND, PLAN_LIMITS, normalizePlan, parsePlanReply, planWindow, type PlanOptions, type PlanPost } from '../lib/campaignPlan';

export * from '../lib/campaignPlan';

/**
 * Plan with AI: the AI drafts posts for a campaign; nothing is saved until the person
 * reviews the draft and creates it (decision 17). The connector's generate_campaign_content keeps the
 * one-step behaviour by running both steps.
 *
 * The admin's "generate-campaign" command is used when it is set up; otherwise a built-in prompt,
 * so it works from day one. Always with the brand of the campaign's owner.
 */

type Id = mongoose.Types.ObjectId;

/** Asks the AI for a draft plan. Nothing is saved. */
export async function draftCampaignPlan(campaign: ICampaign, opts: PlanOptions, userId: Id): Promise<{ posts: PlanPost[]; from: string; to: string; source: 'command' | 'builtin' }> {
  const owner = await User.findById(campaign.createdBy);
  const { from, to } = planWindow(campaign, opts);
  const perWeek = Number.isFinite(opts.perWeek) ? Math.min(14, Math.max(1, Math.round(Number(opts.perWeek)))) : null;
  const notes = typeof opts.notes === 'string' ? opts.notes.trim().slice(0, PLAN_LIMITS.notes) : '';

  // Days that already have a post in this campaign, so the plan fills the gaps.
  const planned = await Task.find({
    campaignId: campaign._id,
    taskDate: { $gte: new Date(`${from}T00:00:00Z`), $lte: new Date(`${to}T23:59:59Z`) }
  })
    .select('name taskDate')
    .sort({ taskDate: 1 })
    .limit(60)
    .lean();

  const instruction = [
    `Plan posts from ${from} to ${to} (dates as YYYY-MM-DD, all within that period).`,
    perWeek ? `About ${perWeek} post${perWeek === 1 ? '' : 's'} a week in total.` : 'A realistic number of posts for the period (usually 2 to 4 a week).',
    planned.length
      ? `Posts already planned (don't repeat them; plan around them): ${planned.map((p) => `${new Date(p.taskDate as Date).toISOString().slice(0, 10)} “${p.name}”`).join('; ')}.`
      : '',
    notes ? `What the person asked for: ${notes}` : ''
  ]
    .filter(Boolean)
    .join('\n');

  const data = {
    companyInfo: owner?.companyInfo || {},
    campaignDetails: {
      name: campaign.name,
      description: campaign.description,
      goals: campaign.goals,
      coreMessages: campaign.coreMessages,
      hashtags: campaign.hashtags,
      startDate: campaign.startDate,
      endDate: campaign.endDate
    },
    instruction
  };

  const command = (opts.command || PLAN_COMMAND).trim();
  const mapping = await CommandMapping.findOne({ command }).populate('promptId').populate('chainId').populate('steps.promptId');
  const usable = mapping && (mapping.promptId || mapping.chainId || (mapping.steps && mapping.steps.length > 0));
  if (opts.command && !usable) throw new AIError(404, `The AI command “${command}” isn’t set up.`);

  let content: string;
  let source: 'command' | 'builtin';
  if (usable) {
    content = (await executeCommandChain(mapping, data as any, { userId })).content;
    source = 'command';
  } else {
    const prompt = compileSuperPrompt(BUILTIN_PLAN_CAMPAIGN, data as any);
    content = (await sendToLLM(prompt, { userId, promptName: 'Plan with AI (built-in)', temperature: 0.7, maxTokens: 8000 })).content;
    source = 'builtin';
  }

  const posts = normalizePlan(parsePlanReply(content));
  if (!posts.length) throw new AIError(502, 'The AI didn’t suggest any posts. Try again, perhaps with a note on what you want.');
  return { posts, from, to, source };
}

/** Creates the posts of a reviewed plan in the campaign. */
export async function applyCampaignPlan(campaign: ICampaign, posts: PlanPost[], userId: Id) {
  const docs = await Task.create(
    posts.map((p) => {
      const typed = p.name.trim();
      return {
        name: autoTitle(typed, p.caption, p.brief),
        autoName: !typed,
        description: p.brief,
        content: p.caption,
        taskDate: p.day ? new Date(`${p.day}T00:00:00Z`) : null,
        status: p.status,
        ownerId: campaign.createdBy,
        campaignId: campaign._id,
        createdBy: userId
      };
    })
  );
  const postIds = docs.map((d) => String(d._id));
  return { postIds, postCount: postIds.length };
}
