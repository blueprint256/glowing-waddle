import express, { Request, Response } from 'express';
import mongoose from 'mongoose';
import { isAuthenticated } from '../middleware/auth';
import { isSystemAdmin } from '../middleware/rbac';
import { getInternalSecret, INTERNAL_HEADER, ACT_AS_HEADER } from '../middleware/bearerAuth';
import { canUseAI, canUseBlue, IUser } from '../models/User';
import { AppConfig } from '../models/AppConfig';
import { LLMUsage } from '../models/LLMUsage';
import { BlueConversation, IBlueConversation } from '../models/BlueConversation';
import { calculateEstimatedCost } from '../services/llmService';
import { createApiClient } from '../mcp/apiClient';
import { TOOLS, ToolContext } from '../mcp/tools';
import { ToolDefinition } from '../mcp/protocol';
import { getFrontendUrl } from '../config/publicUrl';
import { runAgent, executeCall, declinedResults, trimHistory } from '../blue/agent';
import { buildSystemPrompt } from '../blue/prompt';
import { toTranscript, titleFrom } from '../blue/transcript';
import { loadBlueSetup, createBlueProvider, BLUE_PROVIDERS, BLUE_DEFAULT_MODELS, BlueSetup } from '../blue/setup';
import { ProviderError } from '../blue/providers';
import type { BlueEvent, NeutralMessage, ToolCall, Usage } from '../blue/types';

/**
 * Blue — the in-app assistant.
 *   GET    /api/blue/status
 *   GET    /api/blue/conversations                     list (newest first)
 *   POST   /api/blue/conversations                     start a chat
 *   GET    /api/blue/conversations/:id                 transcript
 *   DELETE /api/blue/conversations/:id
 *   POST   /api/blue/conversations/:id/messages        { text, path?, timeZone? } → text/event-stream
 *   POST   /api/blue/conversations/:id/confirm         { approve, path?, timeZone? } → text/event-stream
 *   GET    /api/blue/settings  · PATCH /api/blue/settings   (System Admin)
 *
 * Blue runs on the app's own AI keys and acts through the same tool catalog as the Claude
 * connector, as the signed-in user, so permissions are identical to the web app.
 */
const router = express.Router();

const USAGE_LABEL = 'Blue assistant';
const running = new Set<string>(); // one run per conversation at a time

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function startOfToday(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

async function messagesUsedToday(userId: mongoose.Types.ObjectId): Promise<number> {
  return LLMUsage.countDocuments({ userId, promptName: USAGE_LABEL, success: true, createdAt: { $gte: startOfToday() } });
}

function remaining(setup: BlueSetup, used: number): number | null {
  return setup.dailyMessageLimit > 0 ? Math.max(0, setup.dailyMessageLimit - used) : null;
}

/** Why this user can't use Blue right now (null = they can). */
function unavailableReason(user: IUser, setup: BlueSetup): { code: string; message: string } | null {
  if (!setup.enabled) return { code: 'BLUE_DISABLED', message: 'Blue is switched off for this workspace.' };
  if (!canUseBlue(user)) return { code: 'BLUE_DISABLED_FOR_USER', message: 'Your administrator has turned Blue off for your account.' };
  if (setup.problem) return { code: 'BLUE_NOT_CONFIGURED', message: setup.problem };
  return null;
}

function buildContext(user: IUser): ToolContext {
  const port = process.env.PORT || 5000;
  return {
    api: createApiClient({
      baseUrl: `http://127.0.0.1:${port}`,
      actAsUserId: String(user._id),
      actAsHeader: ACT_AS_HEADER,
      internalHeader: INTERNAL_HEADER,
      internalSecret: getInternalSecret(),
      userAgent: 'Blue assistant'
    }),
    user: {
      id: String(user._id),
      email: user.email,
      name: `${user.firstName} ${user.lastName}`.trim(),
      role: user.role,
      accessMode: user.accessMode,
      canUseAI: canUseAI(user)
    },
    appUrl: getFrontendUrl()
  };
}

/** A readable line for the Confirm card, e.g. "Delete task “Teaser post”". */
async function describeAction(call: ToolCall, tool: ToolDefinition<ToolContext>, ctx: ToolContext): Promise<string> {
  const a = call.args as Record<string, string>;
  const name = async (path: string, key: string, field = 'name') => {
    try {
      const res = await ctx.api.request('GET', path);
      return res?.[key]?.[field] as string | undefined;
    } catch {
      return undefined;
    }
  };
  switch (call.name) {
    case 'delete_task': {
      const n = await name(`/api/tasks/${a.task_id}`, 'task');
      return n ? `Delete task “${n}” (this can't be undone)` : 'Delete a task (this can’t be undone)';
    }
    case 'archive_campaign': {
      const n = await name(`/api/campaigns/${a.campaign_id}`, 'campaign');
      return n ? `Archive campaign “${n}”` : 'Archive a campaign';
    }
    case 'remove_user_from_project': {
      const n = await name(`/api/projects/${a.project_id}`, 'project');
      return n ? `Remove a team member from “${n}”` : 'Remove a team member from a project';
    }
    case 'deactivate_user': {
      const n = await name(`/api/users/${a.user_id}`, 'user', 'email');
      return n ? `Deactivate the account ${n}` : 'Deactivate a user account';
    }
    case 'delete_comment':
      return 'Delete a comment (this can’t be undone)';
    default:
      return tool.title;
  }
}

function openStream(res: Response) {
  res.status(200);
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders?.();
  let closed = false;
  res.on('close', () => {
    closed = true;
  });
  return {
    send(event: BlueEvent) {
      if (closed) return; // keep working server-side; the chat reloads its history when reopened
      res.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
    },
    end() {
      if (!closed) res.end();
    }
  };
}

function friendlyError(error: unknown): string {
  if (error instanceof ProviderError) {
    if (error.status === 401 || error.status === 403) return 'Blue couldn’t sign in to the AI provider. An admin should check the API key in Settings.';
    if (error.status === 404) return 'The AI model chosen for Blue wasn’t found. An admin should check the model name in Settings → Blue.';
    if (error.status === 429) return 'The AI provider is busy or out of quota right now. Please try again in a moment.';
    return `The AI provider had a problem: ${error.message}`;
  }
  return 'Something went wrong while Blue was working. Please try again.';
}

async function logUsage(user: IUser, setup: BlueSetup, usage: Usage, startedAt: number, label: string, errorMessage?: string) {
  try {
    await LLMUsage.create({
      userId: user._id,
      promptName: label,
      llmModel: `${setup.provider}/${setup.model}`,
      promptTokens: usage.input,
      completionTokens: usage.output,
      totalTokens: usage.input + usage.output,
      estimatedCost: calculateEstimatedCost(setup.provider as any, setup.model || '', usage.input, usage.output),
      success: !errorMessage,
      errorMessage,
      requestDuration: Date.now() - startedAt
    });
  } catch (error) {
    console.error('[blue] Could not log usage:', error);
  }
}

async function loadOwnConversation(req: Request, res: Response): Promise<IBlueConversation | null> {
  if (!mongoose.isValidObjectId(req.params.id)) {
    res.status(400).json({ success: false, message: 'Invalid conversation id' });
    return null;
  }
  const conversation = await BlueConversation.findOne({ _id: req.params.id, userId: req.user!._id });
  if (!conversation) {
    res.status(404).json({ success: false, message: 'Conversation not found' });
    return null;
  }
  return conversation;
}

/** Shared run: stream events, save history, log usage. */
async function runAndStream(
  req: Request,
  res: Response,
  conversation: IBlueConversation,
  setup: BlueSetup,
  prepare: (ctx: ToolContext, send: (e: BlueEvent) => void) => Promise<{ messages: NeutralMessage[]; skipModel?: boolean }>,
  usageLabel: string
) {
  const user = req.user!;
  const stream = openStream(res);
  const startedAt = Date.now();
  const ctx = buildContext(user);
  let usage: Usage = { input: 0, output: 0 };
  let errorMessage: string | undefined;

  try {
    const prepared = await prepare(ctx, stream.send);
    let messages = prepared.messages;
    let pending = null;

    if (!prepared.skipModel) {
      const provider = await createBlueProvider(setup);
      const system = buildSystemPrompt({
        user: { name: ctx.user.name, role: ctx.user.role, part: ctx.user.accessMode, canUseAI: ctx.user.canUseAI },
        timeZone: typeof req.body?.timeZone === 'string' ? req.body.timeZone : undefined,
        path: typeof req.body?.path === 'string' ? req.body.path : undefined
      });
      const trimmed = trimHistory(messages);
      const dropped = messages.length - trimmed.length;
      const result = await runAgent({
        provider,
        system,
        messages: trimmed,
        tools: TOOLS,
        ctx,
        onEvent: stream.send,
        describeAction: (call, tool) => describeAction(call, tool, ctx),
        log: (m, e) => console.error(`[blue] ${m}:`, e)
      });
      messages = [...messages.slice(0, dropped), ...result.messages];
      pending = result.pending;
      usage = result.usage;
      if (result.error) {
        console.error('[blue] AI provider failed:', result.error);
        errorMessage = result.error instanceof Error ? result.error.message : String(result.error);
        stream.send({ type: 'error', message: friendlyError(result.error) });
      }
    }

    conversation.messages = messages;
    conversation.pending = pending;
    conversation.markModified('messages');
    conversation.markModified('pending');
    await conversation.save();
  } catch (error) {
    console.error('[blue] Run failed:', error);
    errorMessage = error instanceof Error ? error.message : String(error);
    stream.send({ type: 'error', message: friendlyError(error) });
    // Keep what the user wrote so the chat still shows it.
    try {
      await conversation.save();
    } catch {
      /* ignore */
    }
  } finally {
    // Log every AI call (failures too, for the admin); a cancel with no AI call logs nothing.
    // Only successful user messages count toward the daily limit (see messagesUsedToday).
    if (usage.input + usage.output > 0 || errorMessage) {
      await logUsage(user, setup, usage, startedAt, usageLabel, errorMessage);
    }
    const used = await messagesUsedToday(user._id as mongoose.Types.ObjectId);
    stream.send({ type: 'done', remainingToday: remaining(setup, used) });
    stream.end();
    running.delete(String(conversation._id));
  }
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

router.get('/status', isAuthenticated, async (req: Request, res: Response) => {
  try {
    const setup = await loadBlueSetup();
    const reason = unavailableReason(req.user!, setup);
    const used = await messagesUsedToday(req.user!._id as mongoose.Types.ObjectId);
    res.json({
      success: true,
      available: !reason,
      reason: reason?.message,
      code: reason?.code,
      dailyMessageLimit: setup.dailyMessageLimit,
      remainingToday: remaining(setup, used)
    });
  } catch (error) {
    console.error('[blue] status failed:', error);
    res.status(500).json({ success: false, message: 'Could not load Blue status' });
  }
});

router.get('/conversations', isAuthenticated, async (req: Request, res: Response) => {
  try {
    const list = await BlueConversation.find({ userId: req.user!._id })
      .select('title updatedAt createdAt')
      .sort({ updatedAt: -1 })
      .limit(30);
    res.json({ success: true, conversations: list.map((c) => ({ id: String(c._id), title: c.title, updatedAt: c.updatedAt })) });
  } catch (error) {
    console.error('[blue] list failed:', error);
    res.status(500).json({ success: false, message: 'Could not load your chats' });
  }
});

router.post('/conversations', isAuthenticated, async (req: Request, res: Response) => {
  try {
    const conversation = await BlueConversation.create({ userId: req.user!._id, title: 'New chat', messages: [] });
    res.status(201).json({ success: true, conversation: { id: String(conversation._id), title: conversation.title, items: [] } });
  } catch (error) {
    console.error('[blue] create failed:', error);
    res.status(500).json({ success: false, message: 'Could not start a chat' });
  }
});

router.get('/conversations/:id', isAuthenticated, async (req: Request, res: Response) => {
  try {
    const conversation = await loadOwnConversation(req, res);
    if (!conversation) return;
    res.json({
      success: true,
      conversation: {
        id: String(conversation._id),
        title: conversation.title,
        items: toTranscript(conversation.messages, conversation.pending),
        busy: running.has(String(conversation._id))
      }
    });
  } catch (error) {
    console.error('[blue] load failed:', error);
    res.status(500).json({ success: false, message: 'Could not load this chat' });
  }
});

router.delete('/conversations/:id', isAuthenticated, async (req: Request, res: Response) => {
  try {
    const conversation = await loadOwnConversation(req, res);
    if (!conversation) return;
    await conversation.deleteOne();
    res.json({ success: true, message: 'Chat deleted' });
  } catch (error) {
    console.error('[blue] delete failed:', error);
    res.status(500).json({ success: false, message: 'Could not delete this chat' });
  }
});

router.post('/conversations/:id/messages', isAuthenticated, async (req: Request, res: Response) => {
  try {
    const text = typeof req.body?.text === 'string' ? req.body.text.trim() : '';
    if (!text || text.length > 8000) {
      return res.status(400).json({ success: false, message: 'Write a message (up to 8,000 characters).' });
    }

    const setup = await loadBlueSetup();
    const reason = unavailableReason(req.user!, setup);
    if (reason) return res.status(403).json({ success: false, code: reason.code, message: reason.message });

    const used = await messagesUsedToday(req.user!._id as mongoose.Types.ObjectId);
    if (setup.dailyMessageLimit > 0 && used >= setup.dailyMessageLimit) {
      return res.status(429).json({
        success: false,
        code: 'BLUE_DAILY_LIMIT',
        message: `You've used all ${setup.dailyMessageLimit} Blue messages for today. They reset at midnight.`
      });
    }

    const conversation = await loadOwnConversation(req, res);
    if (!conversation) return;
    const key = String(conversation._id);
    if (running.has(key)) return res.status(409).json({ success: false, message: 'Blue is still working on your last message.' });
    running.add(key);

    await runAndStream(
      req,
      res,
      conversation,
      setup,
      async () => {
        const messages: NeutralMessage[] = [...conversation.messages];
        // Sending a new message instead of answering a confirmation counts as "don't do it".
        if (conversation.pending) {
          messages.push(declinedResults(conversation.pending, 'Not confirmed: the user sent a new message instead.'));
          conversation.pending = null;
        }
        messages.push({ role: 'user', text, at: new Date().toISOString() });
        if (!conversation.messages.length || conversation.title === 'New chat') conversation.title = titleFrom(text);
        conversation.messages = messages;
        conversation.markModified('messages');
        return { messages };
      },
      USAGE_LABEL
    );
  } catch (error) {
    console.error('[blue] message failed:', error);
    if (!res.headersSent) res.status(500).json({ success: false, message: 'Blue could not process that message' });
  }
});

router.post('/conversations/:id/confirm', isAuthenticated, async (req: Request, res: Response) => {
  try {
    if (typeof req.body?.approve !== 'boolean') {
      return res.status(400).json({ success: false, message: 'Body must include approve: true or false' });
    }
    const approve: boolean = req.body.approve;

    const setup = await loadBlueSetup();
    const reason = unavailableReason(req.user!, setup);
    if (reason) return res.status(403).json({ success: false, code: reason.code, message: reason.message });

    const conversation = await loadOwnConversation(req, res);
    if (!conversation) return;
    if (!conversation.pending) return res.status(409).json({ success: false, message: 'There is nothing waiting for confirmation.' });
    const key = String(conversation._id);
    if (running.has(key)) return res.status(409).json({ success: false, message: 'Blue is still working.' });
    running.add(key);

    const pending = conversation.pending;
    await runAndStream(
      req,
      res,
      conversation,
      setup,
      async (ctx, send) => {
        const messages: NeutralMessage[] = [...conversation.messages];
        conversation.pending = null;
        if (!approve) {
          messages.push(declinedResults(pending, 'The user pressed Cancel. Do not do this.'));
          const note = 'Okay, I didn’t do that.';
          messages.push({ role: 'assistant', text: note, at: new Date().toISOString() });
          send({ type: 'assistant_text', text: note });
          return { messages, skipModel: true };
        }
        const results = [];
        for (const call of pending.calls) {
          results.push(await executeCall(call, TOOLS, ctx, send, (m, e) => console.error(`[blue] ${m}:`, e)));
        }
        messages.push({ role: 'tool', results, at: new Date().toISOString() });
        return { messages };
      },
      `${USAGE_LABEL} (confirmed action)`
    );
  } catch (error) {
    console.error('[blue] confirm failed:', error);
    if (!res.headersSent) res.status(500).json({ success: false, message: 'Blue could not process that' });
  }
});

// ---------------------------------------------------------------------------
// Admin settings
// ---------------------------------------------------------------------------

router.get('/settings', isAuthenticated, isSystemAdmin, async (_req: Request, res: Response) => {
  try {
    const config = await AppConfig.getConfig();
    const setup = await loadBlueSetup();
    res.json({
      success: true,
      settings: {
        enabled: config.blueEnabled !== false,
        provider: config.blueProvider || null,
        model: config.blueModel || '',
        dailyMessageLimit: setup.dailyMessageLimit,
        effectiveProvider: setup.provider || null,
        effectiveModel: setup.model || null,
        problem: setup.problem || null,
        configuredProviders: setup.configuredProviders,
        defaultModels: BLUE_DEFAULT_MODELS
      }
    });
  } catch (error) {
    console.error('[blue] settings load failed:', error);
    res.status(500).json({ success: false, message: 'Could not load Blue settings' });
  }
});

router.patch('/settings', isAuthenticated, isSystemAdmin, async (req: Request, res: Response) => {
  try {
    const { enabled, provider, model, dailyMessageLimit } = req.body || {};
    const config = await AppConfig.getConfig();

    if (enabled !== undefined) {
      if (typeof enabled !== 'boolean') return res.status(400).json({ success: false, message: 'enabled must be true or false' });
      config.blueEnabled = enabled;
    }
    if (provider !== undefined) {
      if (provider !== null && !BLUE_PROVIDERS.includes(provider)) {
        return res.status(400).json({ success: false, message: `provider must be one of: ${BLUE_PROVIDERS.join(', ')}` });
      }
      if (provider) {
        const setup = await loadBlueSetup();
        if (!setup.configuredProviders.includes(provider)) {
          return res.status(400).json({ success: false, message: `Add a ${provider} API key first (Settings → Integrations).` });
        }
      }
      config.blueProvider = provider || undefined;
    }
    if (model !== undefined) {
      if (typeof model !== 'string' || model.trim().length > 100) {
        return res.status(400).json({ success: false, message: 'model must be a model ID (up to 100 characters)' });
      }
      config.blueModel = model.trim() || undefined;
    }
    if (dailyMessageLimit !== undefined) {
      if (!Number.isInteger(dailyMessageLimit) || dailyMessageLimit < 0 || dailyMessageLimit > 100000) {
        return res.status(400).json({ success: false, message: 'dailyMessageLimit must be a whole number (0 = unlimited)' });
      }
      config.blueDailyMessageLimit = dailyMessageLimit;
    }
    await config.save();

    const setup = await loadBlueSetup();
    res.json({
      success: true,
      message: 'Blue settings saved',
      settings: {
        enabled: config.blueEnabled !== false,
        provider: config.blueProvider || null,
        model: config.blueModel || '',
        dailyMessageLimit: setup.dailyMessageLimit,
        effectiveProvider: setup.provider || null,
        effectiveModel: setup.model || null,
        problem: setup.problem || null,
        configuredProviders: setup.configuredProviders,
        defaultModels: BLUE_DEFAULT_MODELS
      }
    });
  } catch (error) {
    console.error('[blue] settings save failed:', error);
    res.status(500).json({ success: false, message: 'Could not save Blue settings' });
  }
});

export default router;
