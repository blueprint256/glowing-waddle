import OpenAI from 'openai';
import Anthropic from '@anthropic-ai/sdk';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { Prompt } from '../models/Prompt';
import { LLMUsage } from '../models/LLMUsage';
import { AppConfig } from '../models/AppConfig';
import mongoose from 'mongoose';
import { downloadImageFromUrl, uploadBufferToS3 } from '../utils/s3Service';
import { toFile } from 'openai/uploads';
import { applyPlaceholderAliases, knownPlaceholderRegex } from '../lib/placeholders';
import { editExtras, imageCost, isImageModelId, qualityFor, resolveImageModel, type ImagePurpose } from '../lib/imageModels';

// Cache for LLM clients and keys
let cachedOpenAI: { client: OpenAI; key: string; timestamp: number } | null = null;
let cachedAnthropic: { client: Anthropic; key: string; timestamp: number } | null = null;
let cachedGemini: { client: GoogleGenerativeAI; key: string; timestamp: number } | null = null;
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

// Supported providers
export type LLMProvider = 'openai' | 'anthropic' | 'grok' | 'gemini';

// LLM configuration
export interface LLMConfig {
  provider: LLMProvider;
  model: string;
}

/**
 * Get API key for a specific provider from database or environment variable
 * Priority: Database > Environment Variable
 */
export async function getProviderKey(provider: LLMProvider): Promise<string> {
  try {
    const config = await AppConfig.getConfig();

    switch (provider) {
      case 'openai':
        if (config.openAIApiKey) {
          return config.decryptApiKey(config.openAIApiKey);
        }
        if (process.env.OPENAI_API_KEY) {
          return process.env.OPENAI_API_KEY;
        }
        throw new Error('OpenAI API key not configured. An admin adds it in Settings › AI.');

      case 'anthropic':
        if (config.anthropicApiKey) {
          return config.decryptApiKey(config.anthropicApiKey);
        }
        if (process.env.ANTHROPIC_API_KEY) {
          return process.env.ANTHROPIC_API_KEY;
        }
        throw new Error('Anthropic API key not configured. An admin adds it in Settings › AI.');

      case 'grok':
        if (config.grokApiKey) {
          return config.decryptApiKey(config.grokApiKey);
        }
        if (process.env.GROK_API_KEY) {
          return process.env.GROK_API_KEY;
        }
        throw new Error('Grok API key not configured. An admin adds it in Settings › AI.');

      case 'gemini':
        if (config.geminiApiKey) {
          return config.decryptApiKey(config.geminiApiKey);
        }
        if (process.env.GEMINI_API_KEY) {
          return process.env.GEMINI_API_KEY;
        }
        throw new Error('Gemini API key not configured. An admin adds it in Settings › AI.');

      default:
        throw new Error(`Unknown provider: ${provider}`);
    }
  } catch (error: any) {
    throw error;
  }
}

/**
 * Get OpenAI client with cached key management
 */
async function getOpenAIClient(): Promise<OpenAI> {
  const now = Date.now();
  const currentKey = await getProviderKey('openai');

  if (cachedOpenAI && cachedOpenAI.key === currentKey && (now - cachedOpenAI.timestamp) < CACHE_TTL) {
    return cachedOpenAI.client;
  }

  const client = new OpenAI({ apiKey: currentKey });
  cachedOpenAI = { client, key: currentKey, timestamp: now };
  return client;
}

/**
 * Get Anthropic client with cached key management
 */
async function getAnthropicClient(): Promise<Anthropic> {
  const now = Date.now();
  const currentKey = await getProviderKey('anthropic');

  if (cachedAnthropic && cachedAnthropic.key === currentKey && (now - cachedAnthropic.timestamp) < CACHE_TTL) {
    return cachedAnthropic.client;
  }

  const client = new Anthropic({ apiKey: currentKey });
  cachedAnthropic = { client, key: currentKey, timestamp: now };
  return client;
}

/**
 * Get Gemini client with cached key management
 */
async function getGeminiClient(): Promise<GoogleGenerativeAI> {
  const now = Date.now();
  const currentKey = await getProviderKey('gemini');

  if (cachedGemini && cachedGemini.key === currentKey && (now - cachedGemini.timestamp) < CACHE_TTL) {
    return cachedGemini.client;
  }

  const client = new GoogleGenerativeAI(currentKey);
  cachedGemini = { client, key: currentKey, timestamp: now };
  return client;
}

/**
 * Interface for super prompt compilation parameters
 */
export interface SuperPromptParams {
  companyInfo?: {
    companyName?: string;
    sector?: string;
    about?: string;
    productsServices?: string;
    usp?: string;
    brandTone?: string;
    audienceProfile?: string;
    globalRules?: string;
    brandGuidelines?: string;
    primaryLogoUrl?: string;
    secondaryLogoUrl?: string;
    tertiaryLogoUrl?: string;
  };
  campaignDetails?: {
    name?: string;
    description?: string;
    goals?: string[];
    coreMessages?: string;
    hashtags?: string[];
    startDate?: Date;
    endDate?: Date;
  };
  taskDescription?: string;
  // Image URLs as individual placeholders (prompt-driven selection)
  baseImage?: string; // S3 URL - {baseImage}
  primaryLogo?: string; // S3 URL - {primaryLogo}
  secondaryLogo?: string; // S3 URL - {secondaryLogo}
  tertiaryLogo?: string; // S3 URL - {tertiaryLogo}
  attachedImage1?: string; // S3 URL - {attachedImage1}
  attachedImage2?: string; // S3 URL - {attachedImage2}
  // ... and so on for additional attached images
  // Multi-step chain support
  previousOutput?: string; // Output from previous step in chain - {previousOutput}
  [key: string]: any;
}

/**
 * Fetch a prompt by name from the database
 */
export async function getPromptByName(name: string): Promise<string | null> {
  try {
    const prompt = await Prompt.findOne({ name });
    return prompt ? prompt.details : null;
  } catch (error) {
    console.error('Error fetching prompt by name:', error);
    throw new Error('Failed to fetch prompt');
  }
}

/**
 * Compile a super prompt by replacing placeholders with dynamic data
 *
 * Supports placeholders like:
 * - {companyInfo} - full company information as JSON
 * - {companyName} - just the company name
 * - {campaignDetails} - full campaign details as JSON
 * - {campaignName} - just the campaign name
 * - {taskDescription} - current task description
 * - {brandGuidelines} - brand visual/writing style guidelines
 * - {primaryLogo} - primary logo URL
 * - {secondaryLogo} - secondary logo URL
 * - {tertiaryLogo} - tertiary logo URL
 * - Any custom placeholder that matches a key in the params
 */
export function compileSuperPrompt(promptTemplate: string, params: SuperPromptParams): string {
  // New names ({brief}, {caption}, {brand} …) are written as the older names the code below fills.
  let compiledPrompt = applyPlaceholderAliases(promptTemplate);

  // Replace {companyInfo} with formatted company information
  if (params.companyInfo) {
    const companyInfoStr = formatCompanyInfo(params.companyInfo);
    compiledPrompt = compiledPrompt.replace(/\{companyInfo\}/g, () => companyInfoStr);
  }

  // Replace individual company fields (values are read once, so the replacers below don't depend
  // on narrowing inside callbacks).
  const company = params.companyInfo || {};
  const companyFields: [RegExp, unknown][] = [
    [/\{companyName\}/g, company.companyName],
    [/\{sector\}/g, company.sector],
    [/\{brandTone\}/g, company.brandTone],
    // Brand assets
    [/\{brandGuidelines\}/g, company.brandGuidelines],
    [/\{primaryLogo\}/g, company.primaryLogoUrl],
    [/\{secondaryLogo\}/g, company.secondaryLogoUrl],
    [/\{tertiaryLogo\}/g, company.tertiaryLogoUrl]
  ];
  for (const [pattern, value] of companyFields) {
    if (value) {
      const text = String(value);
      compiledPrompt = compiledPrompt.replace(pattern, () => text);
    }
  }

  // Replace {campaignDetails} with formatted campaign information
  if (params.campaignDetails) {
    const campaignDetailsStr = formatCampaignDetails(params.campaignDetails);
    compiledPrompt = compiledPrompt.replace(/\{campaignDetails\}/g, () => campaignDetailsStr);
  }

  // Replace individual campaign fields
  const campaign = params.campaignDetails || {};
  const campaignFields: [RegExp, unknown][] = [
    [/\{campaignName\}/g, campaign.name],
    [/\{coreMessages\}/g, campaign.coreMessages],
    [/\{hashtags\}/g, Array.isArray(campaign.hashtags) && campaign.hashtags.length ? campaign.hashtags.join(', ') : '']
  ];
  for (const [pattern, value] of campaignFields) {
    if (value) {
      const text = String(value);
      compiledPrompt = compiledPrompt.replace(pattern, () => text);
    }
  }

  // Replace {taskDescription} if provided
  if (params.taskDescription) {
    const brief = String(params.taskDescription);
    compiledPrompt = compiledPrompt.replace(/\{taskDescription\}/g, () => brief);
  }

  // Replace {baseImage} if provided (URL of the task's base/original image)
  if (params.baseImage) {
    const image = String(params.baseImage);
    compiledPrompt = compiledPrompt.replace(/\{baseImage\}/g, () => image);
  }

  // Replace {previousOutput} if provided (for multi-step chains)
  if (params.previousOutput !== undefined) {
    const previous = String(params.previousOutput);
    compiledPrompt = compiledPrompt.replace(/\{previousOutput\}/g, () => previous);
  }

  // Replace any custom placeholders
  Object.keys(params).forEach(key => {
    if (key !== 'companyInfo' && key !== 'campaignDetails' && key !== 'taskDescription' && key !== 'baseImage' && key !== 'previousOutput') {
      if (params[key] === undefined || params[key] === null) return;
      const value = typeof params[key] === 'object'
        ? JSON.stringify(params[key], null, 2)
        : String(params[key]);
      const regex = new RegExp(`\\{${key}\\}`, 'g');
      compiledPrompt = compiledPrompt.replace(regex, () => value);
    }
  });

  // Known placeholders with no data (e.g. a company without a logo) are removed rather than sent to
  // the AI as literal "{primaryLogo}" text, which it would copy into posts.
  compiledPrompt = compiledPrompt.replace(KNOWN_PLACEHOLDERS, '');

  return compiledPrompt;
}

// Every placeholder the app knows (old and new names; lib/placeholders.ts).
const KNOWN_PLACEHOLDERS = knownPlaceholderRegex();

/**
 * Format company information into a readable string
 */
function formatCompanyInfo(companyInfo: SuperPromptParams['companyInfo']): string {
  if (!companyInfo) return '';

  const parts: string[] = [];

  if (companyInfo.companyName) {
    parts.push(`Company Name: ${companyInfo.companyName}`);
  }
  if (companyInfo.sector) {
    parts.push(`Sector: ${companyInfo.sector}`);
  }
  if (companyInfo.about) {
    parts.push(`About: ${companyInfo.about}`);
  }
  if (companyInfo.productsServices) {
    parts.push(`Products & Services: ${companyInfo.productsServices}`);
  }
  if (companyInfo.usp) {
    parts.push(`Unique Selling Position: ${companyInfo.usp}`);
  }
  if (companyInfo.brandTone) {
    parts.push(`Brand Tone: ${companyInfo.brandTone}`);
  }
  if (companyInfo.audienceProfile) {
    parts.push(`Audience Profile: ${companyInfo.audienceProfile}`);
  }
  if (companyInfo.globalRules) {
    parts.push(`Content Guidelines: ${companyInfo.globalRules}`);
  }
  if (companyInfo.brandGuidelines) {
    parts.push(`Brand Guidelines: ${companyInfo.brandGuidelines}`);
  }

  return parts.join('\n');
}

/**
 * Format campaign details into a readable string
 */
function formatCampaignDetails(campaignDetails: SuperPromptParams['campaignDetails']): string {
  if (!campaignDetails) return '';

  const parts: string[] = [];

  if (campaignDetails.name) {
    parts.push(`Campaign Name: ${campaignDetails.name}`);
  }
  if (campaignDetails.description) {
    parts.push(`Description: ${campaignDetails.description}`);
  }
  if (campaignDetails.goals && campaignDetails.goals.length > 0) {
    parts.push(`Goals:\n${campaignDetails.goals.map(g => `- ${g}`).join('\n')}`);
  }
  if (campaignDetails.coreMessages) {
    parts.push(`Core Messages: ${campaignDetails.coreMessages}`);
  }
  if (campaignDetails.hashtags && campaignDetails.hashtags.length > 0) {
    parts.push(`Hashtags: ${campaignDetails.hashtags.join(', ')}`);
  }
  // Campaign dates are calendar days (midnight UTC); written as YYYY-MM-DD so the AI can't misread them.
  const day = (value: unknown) => {
    const d = new Date(value as any);
    return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
  };
  if (campaignDetails.startDate && day(campaignDetails.startDate)) {
    parts.push(`Start Date: ${day(campaignDetails.startDate)}`);
  }
  if (campaignDetails.endDate && day(campaignDetails.endDate)) {
    parts.push(`End Date: ${day(campaignDetails.endDate)}`);
  }

  return parts.join('\n');
}

/**
 * Fetch prompt by name and compile it with dynamic parameters
 */
export async function fetchAndCompilePrompt(
  promptName: string,
  params: SuperPromptParams
): Promise<string> {
  const promptTemplate = await getPromptByName(promptName);

  if (!promptTemplate) {
    throw new Error(`Prompt '${promptName}' not found`);
  }

  return compileSuperPrompt(promptTemplate, params);
}

/**
 * Resolve LLM configuration (provider and model) for a given prompt
 * Priority: Prompt override > Default config > Fallback
 */
async function resolveLLMConfig(promptName?: string): Promise<LLMConfig> {
  const config = await AppConfig.getConfig();

  // If promptName is provided, check for per-prompt overrides
  if (promptName) {
    try {
      const prompt = await Prompt.findOne({ name: promptName });
      if (prompt && prompt.llmProvider && prompt.llmModel) {
        return {
          provider: prompt.llmProvider as LLMProvider,
          model: prompt.llmModel
        };
      }
    } catch (error) {
      console.warn('Failed to fetch prompt for LLM config resolution:', error);
    }
  }

  // Use default configuration
  const provider = (config.defaultLLMProvider || 'openai') as LLMProvider;
  const model = config.defaultLLMModel || 'gpt-4o-mini';

  return { provider, model };
}

/**
 * Calculate estimated cost based on provider, model and token usage
 * Pricing as of December 2024 (approximate, subject to change)
 */
export function calculateEstimatedCost(
  provider: LLMProvider,
  model: string,
  promptTokens: number,
  completionTokens: number
): number {
  // Prices per 1M tokens (in USD)
  const pricing: Record<string, { input: number; output: number }> = {
    // OpenAI
    'gpt-4o': { input: 2.5, output: 10 },
    'gpt-4o-mini': { input: 0.15, output: 0.6 },
    'gpt-4.1': { input: 2.0, output: 8.0 },
    'gpt-4.1-mini': { input: 0.4, output: 1.6 },
    'gpt-4.1-nano': { input: 0.1, output: 0.4 },
    'gpt-5-mini': { input: 0.25, output: 2.0 },
    'gpt-5-nano': { input: 0.05, output: 0.4 },
    'gpt-3.5-turbo': { input: 0.5, output: 1.5 },

    // Anthropic
    'claude-3-5-sonnet-20241022': { input: 3.0, output: 15.0 },
    'claude-3-opus-20240229': { input: 15.0, output: 75.0 },
    'claude-3-haiku-20240307': { input: 0.25, output: 1.25 },

    // Grok (xAI)
    'grok-beta': { input: 5.0, output: 15.0 },
    'grok-2': { input: 2.0, output: 10.0 },

    // Google Gemini
    'gemini-1.5-pro': { input: 1.25, output: 5.0 },
    'gemini-1.5-flash': { input: 0.075, output: 0.3 }
  };

  const modelPricing = pricing[model] || pricing['gpt-4o-mini'];
  const inputCost = (promptTokens / 1000000) * modelPricing.input;
  const outputCost = (completionTokens / 1000000) * modelPricing.output;

  return inputCost + outputCost;
}

/**
 * Log LLM usage to database for tracking and cost analysis
 */
async function logLLMUsage(
  userId: mongoose.Types.ObjectId,
  promptName: string,
  provider: LLMProvider,
  model: string,
  usage: { prompt_tokens: number; completion_tokens: number; total_tokens: number },
  duration: number,
  success: boolean,
  errorMessage?: string
): Promise<void> {
  try {
    const estimatedCost = calculateEstimatedCost(provider, model, usage.prompt_tokens, usage.completion_tokens);

    await LLMUsage.create({
      userId,
      promptName,
      llmModel: `${provider}/${model}`, // Store as "provider/model"
      promptTokens: usage.prompt_tokens,
      completionTokens: usage.completion_tokens,
      totalTokens: usage.total_tokens,
      estimatedCost,
      success,
      errorMessage,
      requestDuration: duration
    });
  } catch (error) {
    console.error('Error logging LLM usage:', error);
    // Don't throw - logging failure shouldn't break the main flow
  }
}

/** Image quality from IMAGE_QUALITY in the server's .env (lib/imageModels.ts: medium by default). */
export function imageQuality(model: string = resolveImageModel('create')): any {
  return qualityFor(model, process.env.IMAGE_QUALITY);
}

/** The image model to call for making (create) or editing pictures (Settings › AI, lib/imageModels.ts). */
export async function currentImageModel(purpose: ImagePurpose): Promise<string> {
  try {
    const config = await AppConfig.getConfig();
    return resolveImageModel(purpose, config.defaultImageLLMModel);
  } catch {
    return resolveImageModel(purpose);
  }
}

/** Records an image generation with its real token usage and cost. Logged as "openai/<model>". */
async function logImageUsage(
  userId: mongoose.Types.ObjectId | undefined,
  promptName: string,
  response: any,
  duration: number,
  success: boolean,
  errorMessage?: string,
  model: string = resolveImageModel('create')
): Promise<void> {
  if (!userId) return;
  try {
    const u = response?.usage || {};
    const input = Number(u.input_tokens) || 0;
    const output = Number(u.output_tokens) || 0;
    const imageIn = Number(u.input_tokens_details?.image_tokens) || 0;
    const textIn = Number(u.input_tokens_details?.text_tokens) || Math.max(0, input - imageIn);
    await LLMUsage.create({
      userId,
      promptName,
      llmModel: `openai/${model}`,
      promptTokens: input,
      completionTokens: output,
      totalTokens: Number(u.total_tokens) || input + output,
      estimatedCost: imageCost(model, { textIn, imageIn, out: output }),
      success,
      errorMessage,
      requestDuration: duration
    });
  } catch (error) {
    console.error('Error logging image usage:', error);
  }
}

/**
 * Send compiled prompt to configured LLM provider
 * Automatically resolves provider and model based on prompt configuration
 */
export async function sendToLLM(
  prompt: string,
  options?: {
    model?: string;
    provider?: LLMProvider;
    temperature?: number;
    maxTokens?: number;
    userId?: mongoose.Types.ObjectId;
    promptName?: string;
  }
): Promise<{ content: string; usage: any }> {
  const startTime = Date.now();

  // Resolve LLM configuration
  const llmConfig = await resolveLLMConfig(options?.promptName);
  const provider = options?.provider || llmConfig.provider;
  const model = options?.model || llmConfig.model;
  const temperature = options?.temperature || 0.7;
  const maxTokens = options?.maxTokens || 2000;

  console.log('\n========================================');
  console.log('📤 TEXT LLM REQUEST');
  console.log('========================================');
  console.log('Provider:', provider);
  console.log('Model:', model);
  console.log('Prompt Name:', options?.promptName || 'N/A');
  console.log('Temperature:', temperature);
  console.log('Max Tokens:', maxTokens);
  console.log('Prompt Length:', prompt.length, 'characters');
  console.log('Prompt Preview:', prompt.substring(0, 200) + (prompt.length > 200 ? '...' : ''));
  console.log('User ID:', options?.userId || 'N/A');
  console.log('Timestamp:', new Date().toISOString());
  console.log('========================================\n');

  try {
    let content: string;
    let usage: { prompt_tokens: number; completion_tokens: number; total_tokens: number };

    switch (provider) {
      case 'openai': {
        const client = await getOpenAIClient();
        const response = await client.chat.completions.create({
          model,
          messages: [{ role: 'user', content: prompt }],
          temperature,
          max_tokens: maxTokens
        });
        content = response.choices[0]?.message?.content || '';
        usage = response.usage || { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };
        break;
      }

      case 'anthropic': {
        const client = await getAnthropicClient();
        const response = await client.messages.create({
          model,
          max_tokens: maxTokens,
          temperature,
          messages: [{ role: 'user', content: prompt }]
        });
        content = response.content[0]?.type === 'text' ? response.content[0].text : '';
        usage = {
          prompt_tokens: response.usage.input_tokens,
          completion_tokens: response.usage.output_tokens,
          total_tokens: response.usage.input_tokens + response.usage.output_tokens
        };
        break;
      }

      case 'grok': {
        const apiKey = await getProviderKey('grok');
        const response = await fetch('https://api.x.ai/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`
          },
          body: JSON.stringify({
            model,
            messages: [{ role: 'user', content: prompt }],
            temperature,
            max_tokens: maxTokens
          })
        });

        if (!response.ok) {
          const errorData = await response.json().catch(() => ({})) as any;
          throw new Error(errorData.error?.message || `Grok API error: ${response.statusText}`);
        }

        const data = await response.json() as any;
        content = data.choices[0]?.message?.content || '';
        usage = data.usage || { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };
        break;
      }

      case 'gemini': {
        const client = await getGeminiClient();
        const geminiModel = client.getGenerativeModel({ model });
        const result = await geminiModel.generateContent(prompt);
        const response = await result.response;
        content = response.text();

        // Gemini doesn't provide detailed token usage in the same format
        // We'll estimate based on response
        const estimatedPromptTokens = Math.ceil(prompt.length / 4);
        const estimatedCompletionTokens = Math.ceil(content.length / 4);
        usage = {
          prompt_tokens: estimatedPromptTokens,
          completion_tokens: estimatedCompletionTokens,
          total_tokens: estimatedPromptTokens + estimatedCompletionTokens
        };
        break;
      }

      default:
        throw new Error(`Unsupported provider: ${provider}`);
    }

    const duration = Date.now() - startTime;

    // Log usage if userId and promptName are provided
    if (options?.userId && options?.promptName) {
      await logLLMUsage(
        options.userId,
        options.promptName,
        provider,
        model,
        usage,
        duration,
        true
      );
    }

    console.log('\n========================================');
    console.log('✅ TEXT LLM RESPONSE');
    console.log('========================================');
    console.log('Provider:', provider);
    console.log('Model:', model);
    console.log('Response Length:', content.length, 'characters');
    console.log('Response Preview:', content.substring(0, 200) + (content.length > 200 ? '...' : ''));
    console.log('Tokens Used:', usage.total_tokens);
    console.log('Duration:', duration, 'ms');
    console.log('Timestamp:', new Date().toISOString());
    console.log('========================================\n');

    return { content, usage };
  } catch (error: any) {
    const duration = Date.now() - startTime;

    console.log('\n========================================');
    console.log('❌ TEXT LLM ERROR');
    console.log('========================================');
    console.log('Provider:', provider);
    console.log('Model:', model);
    console.log('Error:', error.message);
    console.log('Duration:', duration, 'ms');
    console.log('Timestamp:', new Date().toISOString());
    console.log('========================================\n');

    // Log failed attempt if userId and promptName are provided
    if (options?.userId && options?.promptName) {
      await logLLMUsage(
        options.userId,
        options.promptName,
        provider,
        model,
        { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
        duration,
        false,
        error.message
      );
    }

    // Handle provider-specific errors
    if (error.status === 401 || error.message?.includes('401') || error.message?.includes('Invalid API key')) {
      throw new Error(`Invalid ${provider} API key. Please check your configuration.`);
    } else if (error.status === 429 || error.message?.includes('429') || error.message?.includes('rate limit')) {
      throw new Error(`${provider} API rate limit exceeded. Please try again later.`);
    } else if (error.status === 500 || error.status === 503) {
      throw new Error(`${provider} API is currently unavailable. Please try again later.`);
    }

    throw new Error(`${provider} API error: ${error.message}`);
  }
}

/**
 * Complete workflow: Fetch prompt, compile with params, and send to LLM
 */
export async function generateWithPrompt(
  promptName: string,
  params: SuperPromptParams,
  options?: {
    model?: string;
    temperature?: number;
    maxTokens?: number;
    userId?: mongoose.Types.ObjectId;
  }
): Promise<{ content: string; usage: any; compiledPrompt: string }> {
  const compiledPrompt = await fetchAndCompilePrompt(promptName, params);
  const result = await sendToLLM(compiledPrompt, {
    ...options,
    promptName
  });

  return {
    ...result,
    compiledPrompt
  };
}

/**
 * Makes or edits one picture and returns it as a PNG buffer (nothing is stored; the caller trims it,
 * adds the logo and saves it). With `images`, the edit endpoint is used and the pictures are sent in
 * the order given. The model comes from Settings › AI (lib/imageModels.ts): making uses the default
 * (GPT-Image-2.5 Flare), editing uses Sunburst. Usage is logged for the AI allowance.
 */
export async function renderImage(options: {
  prompt: string;
  images?: { buffer: Buffer; name: string; contentType: string }[];
  size: string;
  /** "high" keeps the attached pictures as close as possible (only sent to models that take it). */
  fidelity?: 'high' | 'low';
  /** "edit" (Change image, blending) uses the editing model; default "create". */
  purpose?: ImagePurpose;
  /** PNG with a mask: only the transparent areas may change (edit endpoint only). */
  mask?: { buffer: Buffer; name: string; contentType: string };
  userId?: mongoose.Types.ObjectId;
  promptName: string;
}): Promise<Buffer> {
  const startTime = Date.now();
  const model = await currentImageModel(options.purpose || 'create');
  try {
    const openai = await getOpenAIClient();
    const files = await Promise.all(
      (options.images || []).map((img, i) => toFile(img.buffer, `${i + 1}-${img.name.replace(/[^\w.-]+/g, '_') || 'picture'}`, { type: img.contentType }))
    );
    const mask = options.mask ? await toFile(options.mask.buffer, options.mask.name || 'mask.png', { type: 'image/png' }) : undefined;
    const response: any = files.length
      ? await openai.images.edit({
          model,
          image: files,
          prompt: options.prompt,
          n: 1,
          size: options.size,
          quality: imageQuality(model),
          ...(mask ? { mask } : {}),
          ...editExtras(model, options.fidelity)
        } as any)
      : await openai.images.generate({ model, prompt: options.prompt, n: 1, size: options.size, quality: imageQuality(model) } as any);
    const b64 = response?.data?.[0]?.b64_json;
    if (!b64) throw new Error('No image came back from the image AI');
    await logImageUsage(options.userId, options.promptName, response, Date.now() - startTime, true, undefined, model);
    return Buffer.from(b64, 'base64');
  } catch (error: any) {
    await logImageUsage(options.userId, options.promptName, null, Date.now() - startTime, false, error?.message, model);
    throw error;
  }
}

/**
 * Generate an image using an image generation LLM with a compiled prompt
 */
export async function generateImageWithPrompt(
  promptName: string,
  params: SuperPromptParams,
  options?: {
    model?: string;
    size?: '1024x1024' | '1792x1024' | '1024x1792';
    quality?: 'standard' | 'hd'; // Deprecated: not used (quality comes from IMAGE_QUALITY)
    userId?: mongoose.Types.ObjectId;
  }
): Promise<{ imageUrl: string; compiledPrompt: string }> {
  const startTime = Date.now();

  try {
    // Get the prompt configuration first to parse for image placeholders
    const prompt = await Prompt.findOne({ name: promptName });
    if (!prompt) {
      throw new Error(`Prompt "${promptName}" not found`);
    }

    // Parse the prompt template to detect which image placeholders are referenced
    // ({image} / {referenceImage1} count as {baseImage} / {attachedImage1}).
    const promptTemplate = applyPlaceholderAliases(prompt.details);
    const referencedImages: string[] = [];

    // Define known image placeholders
    const imagePlaceholders = [
      'baseImage',
      'primaryLogo',
      'secondaryLogo',
      'tertiaryLogo',
      'attachedImage1',
      'attachedImage2',
      'attachedImage3',
      'attachedImage4',
      'attachedImage5',
      'attachedImage6',
      'attachedImage7',
      'attachedImage8',
      'attachedImage9',
      'attachedImage10'
    ];

    // Check which placeholders are actually used in the template
    for (const placeholder of imagePlaceholders) {
      if (promptTemplate.includes(`{${placeholder}}`)) {
        referencedImages.push(placeholder);
      }
    }

    console.log('\n========================================');
    console.log('🔍 PROMPT ANALYSIS');
    console.log('========================================');
    console.log('Prompt Template:', promptName);
    console.log('Referenced Images:', referencedImages.length > 0 ? referencedImages.join(', ') : 'None');
    console.log('========================================\n');

    // Fetch and compile the prompt
    const compiledPrompt = await fetchAndCompilePrompt(promptName, params);

    // The image model comes from Settings › AI (lib/imageModels.ts); retired models are never called.
    const imageModel = await currentImageModel('create');
    const imageProvider = 'openai';

    // Map size to supported values for image.edit API
    // Valid sizes: "256x256" | "512x512" | "1024x1024" | "1536x1024" | "1024x1536" | "auto"
    const requestedSize = options?.size || (typeof params.__size === 'string' ? params.__size : '') || '1024x1024';
    const validEditSizes = ['256x256', '512x512', '1024x1024', '1536x1024', '1024x1536', 'auto'];
    const size: '256x256' | '512x512' | '1024x1024' | '1536x1024' | '1024x1536' | 'auto' =
      validEditSizes.includes(requestedSize) ? requestedSize as any : '1024x1024';

    // Log if prompt tried to use a different model (for debugging/migration purposes)
    if (prompt?.imageLLMModel && prompt.imageLLMModel !== imageModel) {
      console.log(`⚠️  Prompt "${promptName}" configured for "${prompt.imageLLMModel}" but using ${imageModel}`);
    }
    if (prompt?.imageLLMProvider && prompt.imageLLMProvider !== 'openai') {
      console.log(`⚠️  Prompt "${promptName}" configured for provider "${prompt.imageLLMProvider}" but enforcing openai`);
    }

    // Download ONLY the images that are referenced in the prompt template
    const imagesToDownload: { placeholder: string; url: string }[] = [];

    // Build list of images to download based on what's referenced in the template
    for (const placeholder of referencedImages) {
      const imageUrl = params[placeholder];
      if (imageUrl && typeof imageUrl === 'string') {
        imagesToDownload.push({ placeholder, url: imageUrl });
      } else {
        console.log(`⚠️  Prompt references {${placeholder}} but no URL provided`);
      }
    }

    // Post v2: the post's reference pictures are always sent (after any the prompt names), so they
    // work with an admin's own "generate-poster" prompt too.
    const extraImages: unknown = params.__extraImages;
    if (Array.isArray(extraImages)) {
      extraImages.forEach((url, i) => {
        if (typeof url === 'string' && url && !imagesToDownload.some((x) => x.url === url)) imagesToDownload.push({ placeholder: `reference${i + 1}`, url });
      });
    }

    console.log(`\n📥 Downloading ${imagesToDownload.length} referenced image(s)...\n`);

    // Download all referenced images
    const imageFiles: any[] = [];
    for (let i = 0; i < imagesToDownload.length; i++) {
      const { placeholder, url } = imagesToDownload[i];
      console.log(`   [${i + 1}/${imagesToDownload.length}] {${placeholder}}: ${url}`);

      try {
        const { buffer, contentType, extension } = await downloadImageFromUrl(url);

        // Convert buffer to File object for OpenAI API
        const imageFile = await toFile(buffer, `${placeholder}.${extension}`, { type: contentType });
        imageFiles.push(imageFile);

        console.log(`   ✅ Downloaded: ${buffer.length} bytes`);
      } catch (error: any) {
        console.log(`   ❌ Failed to download {${placeholder}}: ${error.message}`);
        throw new Error(`Failed to download {${placeholder}}: ${error.message}`);
      }
    }

    if (imageFiles.length > 0) {
      console.log(`\n✅ ${imageFiles.length} referenced image(s) downloaded and prepared for upload\n`);
    } else {
      console.log(`\n📝 No images referenced in prompt - using text-only generation\n`);
    }

    console.log('\n========================================');
    console.log('🖼️  IMAGE LLM REQUEST');
    console.log('========================================');
    console.log('Provider:', imageProvider, '(ENFORCED)');
    console.log('Model:', imageModel);
    console.log('Prompt Name:', promptName);
    console.log('Referenced Images:', imageFiles.length, '(from prompt template)');
    console.log('Image Size:', size);
    console.log('Prompt Length:', compiledPrompt.length, 'characters');
    console.log('Prompt:', compiledPrompt);
    console.log('User ID:', options?.userId || 'N/A');
    console.log('Timestamp:', new Date().toISOString());
    console.log('========================================\n');

    // Get OpenAI client
    const openai = await getOpenAIClient();

    console.log('📡 Sending request to OpenAI Images API...');

    // Generate or edit image based on whether we have input images
    // GPT image models don't take 'response_format':
    // It always returns base64-encoded images (b64_json format)
    let response;
    if (imageFiles.length > 0) {
      console.log(`🎨 Using images.edit endpoint with ${imageFiles.length} referenced image(s)`);

      // Use edit endpoint when images are provided
      // Pass only the images that were referenced in the prompt
      response = await openai.images.edit({
        model: imageModel,
        image: imageFiles, // Array of ONLY referenced images (prompt-driven)
        prompt: compiledPrompt,
        n: 1,
        size: size,
        quality: imageQuality(imageModel)
      } as any);
    } else {
      console.log('✨ Using images.generate endpoint (no images referenced in prompt)');

      // Use generate endpoint when no images referenced
      response = await openai.images.generate({
        model: imageModel,
        prompt: compiledPrompt,
        n: 1,
        size: size,
        quality: imageQuality(imageModel)
      } as any);
    }

    // GPT image models return base64-encoded images, not URLs
    const base64Image = response.data?.[0]?.b64_json;

    if (!base64Image) {
      throw new Error('No base64 image data returned from image generation API');
    }

    console.log('📥 Received base64 image from API');
    console.log('   Base64 length:', base64Image.length, 'characters');

    // Decode base64 to buffer
    const imageBuffer = Buffer.from(base64Image, 'base64');
    console.log('   Decoded buffer size:', imageBuffer.length, 'bytes');

    // Upload buffer to S3 and get permanent URL
    const imageUrl = await uploadBufferToS3(imageBuffer, 'image/png', 'generated-images');

    const duration = Date.now() - startTime;

    console.log('\n========================================');
    console.log('✅ IMAGE LLM RESPONSE');
    console.log('========================================');
    console.log('Provider:', imageProvider);
    console.log('Model:', imageModel);
    console.log('Input Images:', imageFiles.length, 'referenced image(s)');
    console.log('Generated Image URL:', imageUrl);
    console.log('Image Size:', size);
    console.log('Duration:', duration, 'ms');
    console.log('Timestamp:', new Date().toISOString());
    console.log('========================================\n');

    // Log usage if userId provided
    await logImageUsage(options?.userId, promptName, response, duration, true, undefined, imageModel);

    return {
      imageUrl,
      compiledPrompt
    };
  } catch (error: any) {
    const duration = Date.now() - startTime;
    await logImageUsage(options?.userId, promptName, null, duration, false, error.message);

    console.log('\n========================================');
    console.log('❌ IMAGE LLM ERROR');
    console.log('========================================');
    console.log('Prompt Name:', promptName);
    console.log('Error:', error.message);
    console.log('Error Stack:', error.stack);
    console.log('Duration:', duration, 'ms');
    console.log('Timestamp:', new Date().toISOString());
    console.log('========================================\n');

    throw new Error(`Image generation failed: ${error.message}`);
  }
}

/**
 * Execute a multi-step LLM chain based on command mapping
 * Each step's output feeds into the next step as {previousOutput}
 * Attachments (images) are carried forward through the chain
 */
export async function executeCommandChain(
  commandMapping: any, // ICommandMapping with populated steps
  params: SuperPromptParams,
  options?: {
    userId?: mongoose.Types.ObjectId;
  }
): Promise<{
  content: string;
  imageUrl?: string;
  usage: any;
  compiledPrompts: string[];
  stepResults: Array<{ stepNumber: number; output: string; imageUrl?: string }>;
}> {
  const startTime = Date.now();

  try {
    console.log('\n========================================');
    console.log('🔗 MULTI-STEP CHAIN EXECUTION');
    console.log('========================================');
    console.log('Command:', commandMapping.command);
    console.log('User ID:', options?.userId || 'N/A');
    console.log('Timestamp:', new Date().toISOString());
    console.log('========================================\n');

    // Determine steps: from chainId (embedded prompts), steps array, or promptId
    let steps: any[];
    let isChainExecution = false;

    if (commandMapping.chainId) {
      // New chain execution with embedded prompts
      const chain = commandMapping.chainId;
      if (!chain || !chain.steps || chain.steps.length === 0) {
        throw new Error('Chain must have at least one step');
      }

      // Convert chain steps (embedded prompts) to execution steps
      steps = chain.steps.map((chainStep: any) => ({
        prompt: chainStep.prompt, // Embedded prompt text
        description: chainStep.description,
        provider: chainStep.provider, // Enforced provider
        model: chainStep.model, // Enforced model
        carryForwardImages: chainStep.carryForwardImages !== false, // Default to true
        isEmbedded: true
      }));
      isChainExecution = true;
      console.log(`📋 Executing Chain: ${chain.name} (${steps.length} step(s))\n`);
    } else if (commandMapping.steps && Array.isArray(commandMapping.steps) && commandMapping.steps.length > 0) {
      // Legacy steps array (references to prompts)
      steps = commandMapping.steps;
      console.log(`📋 Executing ${steps.length} step(s) from steps array\n`);
    } else if (commandMapping.promptId) {
      // Legacy single-prompt mapping - convert to single-step chain
      steps = [{
        promptId: commandMapping.promptId,
        provider: undefined,
        model: undefined
      }];
      console.log('📋 Executing single prompt mapping\n');
    } else {
      throw new Error('Command mapping must have either chainId, steps array, or promptId');
    }

    let previousOutput = '';
    let previousImageUrl: string | undefined;
    const compiledPrompts: string[] = [];
    const stepResults: Array<{ stepNumber: number; output: string; imageUrl?: string }> = [];
    let totalUsage = {
      prompt_tokens: 0,
      completion_tokens: 0,
      total_tokens: 0
    };

    // Execute each step in sequence
    for (let i = 0; i < steps.length; i++) {
      const step = steps[i];
      const stepNumber = i + 1;

      console.log(`\n========================================`);
      console.log(`🔹 STEP ${stepNumber} of ${steps.length}`);
      console.log(`========================================`);

      // Get prompt details - handle both embedded (from chains) and referenced prompts
      let promptText: string;
      let promptName: string;
      let isImageGeneration: boolean;

      if (step.isEmbedded) {
        // Embedded prompt from chain (new approach)
        promptText = step.prompt;
        promptName = step.description;

        // Detect image generation based on model name
        // Any GPT image model (gpt-image-*) makes this an image step
        isImageGeneration = isImageModelId(step.model);

        console.log('Prompt Type: Embedded (from Chain)');
        console.log('Step Description:', step.description);
        console.log('Provider (Enforced):', step.provider);
        console.log('Model (Enforced):', step.model);
        console.log('Is Image Generation:', isImageGeneration);
      } else {
        // Referenced prompt (legacy approach)
        const prompt = step.promptId;
        if (!prompt || !prompt.details) {
          throw new Error(`Step ${stepNumber}: Prompt details not found. Ensure prompt is populated.`);
        }

        promptText = prompt.details;
        promptName = prompt.name;
        isImageGeneration = !!(prompt.imageLLMProvider || prompt.imageLLMModel);

        console.log('Prompt Type: Referenced');
        console.log('Prompt Name:', prompt.name);
        console.log('Provider Override:', step.provider || 'None (use default or prompt config)');
        console.log('Model Override:', step.model || 'None (use default or prompt config)');
      }

      console.log('Previous Output Available:', !!previousOutput);
      console.log('Previous Image Available:', !!previousImageUrl);

      // Build params for this step, including previousOutput
      const stepParams: SuperPromptParams = {
        ...params,
        previousOutput: previousOutput || '',
      };

      // Carry forward previous image URL if available and enabled for this step
      // For embedded prompts (chains), check the carryForwardImages flag (defaults to true)
      // For referenced prompts, always carry forward (legacy behavior)
      const shouldCarryForwardImages = step.isEmbedded
        ? (step.carryForwardImages !== false)
        : true;

      if (previousImageUrl && shouldCarryForwardImages) {
        // Add previous image as a new attachment placeholder
        // Count existing attachedImage placeholders and add next one
        let attachmentIndex = 1;
        while (stepParams[`attachedImage${attachmentIndex}`]) {
          attachmentIndex++;
        }
        stepParams[`attachedImage${attachmentIndex}`] = previousImageUrl;
        console.log(`Added previous image as {attachedImage${attachmentIndex}}`);
      } else if (previousImageUrl && !shouldCarryForwardImages) {
        console.log(`Skipping image carry-forward (disabled for this step)`);
      }

      // Compile prompt for this step. When the app sends rules the answer must follow ({instruction},
      // e.g. Plan with AI's period and output shape) and the admin's prompt doesn't place them, they
      // go at the end of the first step, so the feature still works with any prompt.
      let compiledPrompt = compileSuperPrompt(promptText, stepParams);
      const appendix = typeof (stepParams as any).__appendInstruction === 'string' ? (stepParams as any).__appendInstruction : '';
      if (i === 0 && appendix && !/\{instruction\}/.test(promptText)) compiledPrompt = `${compiledPrompt}\n\n${appendix}`;
      compiledPrompts.push(compiledPrompt);

      console.log('Compiled Prompt Length:', compiledPrompt.length, 'characters');
      console.log('Compiled Prompt Preview:', compiledPrompt.substring(0, 150) + (compiledPrompt.length > 150 ? '...' : ''));

      console.log('Step Type:', isImageGeneration ? 'Image Generation' : 'Text Generation');

      let stepOutput = '';
      let stepImageUrl: string | undefined;
      let stepUsage: any;

      if (isImageGeneration) {
        // Image generation step
        console.log('🎨 Executing image generation...');

        if (step.isEmbedded) {
          // For embedded prompts, handle image generation inline
          console.log('🎨 Image generation with embedded prompt');

          // Collect available images based on carryForwardImages setting
          const imagePlaceholders = [
            'baseImage', 'primaryLogo', 'secondaryLogo', 'tertiaryLogo',
            'attachedImage1', 'attachedImage2', 'attachedImage3', 'attachedImage4',
            'attachedImage5', 'attachedImage6', 'attachedImage7', 'attachedImage8',
            'attachedImage9', 'attachedImage10'
          ];

          let imagesToUse: string[] = [];

          // Determine which images to use based on carryForwardImages setting
          const shouldCarryForward = step.carryForwardImages !== false; // Default to true

          if (shouldCarryForward) {
            // Carry forward mode: Use ALL available images from stepParams
            console.log('🔄 Carry Forward Images: ENABLED');
            for (const placeholder of imagePlaceholders) {
              if (stepParams[placeholder] && typeof stepParams[placeholder] === 'string') {
                imagesToUse.push(placeholder);
              }
            }
            console.log('Available Images to Carry Forward:', imagesToUse.length > 0 ? imagesToUse.join(', ') : 'None');
          } else {
            // No carry forward: Only use explicitly referenced images in the prompt
            console.log('🔄 Carry Forward Images: DISABLED');
            for (const placeholder of imagePlaceholders) {
              if (compiledPrompt.includes(`{${placeholder}}`)) {
                imagesToUse.push(placeholder);
              }
            }
            console.log('Referenced Images in Prompt:', imagesToUse.length > 0 ? imagesToUse.join(', ') : 'None');
          }

          // Download images
          const imageFiles: any[] = [];
          for (const placeholder of imagesToUse) {
            const imageUrl = stepParams[placeholder];
            if (imageUrl && typeof imageUrl === 'string') {
              try {
                console.log(`📥 Downloading ${placeholder} from: ${imageUrl.substring(0, 100)}...`);
                const { buffer, contentType, extension } = await downloadImageFromUrl(imageUrl);
                const imageFile = await toFile(buffer, `${placeholder}.${extension}`, { type: contentType });
                imageFiles.push(imageFile);
                console.log(`✅ Downloaded: ${placeholder} (${buffer.length} bytes)`);
              } catch (error: any) {
                console.error(`❌ Failed to download ${placeholder}:`, error.message);
                console.error(`   URL: ${imageUrl}`);
              }
            } else {
              console.log(`⚠️  Skipping ${placeholder}: ${!imageUrl ? 'No URL available' : 'Invalid URL type'}`);
            }
          }

          console.log(`\n📦 Total images downloaded: ${imageFiles.length} of ${imagesToUse.length}`);
          if (imageFiles.length < imagesToUse.length) {
            console.warn(`⚠️  Warning: Not all images were downloaded successfully`);
          }

          // Initialize OpenAI client
          const openai = await getOpenAIClient();
          const imageModel = await currentImageModel(imagesToUse.length ? 'edit' : 'create');
          const size = typeof stepParams.__size === 'string' && /^\d+x\d+$/.test(stepParams.__size) ? stepParams.__size : '1024x1024';

          // Generate or edit image
          const imageStart = Date.now();
          let response;
          if (imageFiles.length > 0) {
            console.log(`🎨 Using images.edit with ${imageFiles.length} image(s)`);
            response = await openai.images.edit({
              model: imageModel,
              image: imageFiles,
              prompt: compiledPrompt,
              n: 1,
              size: size,
              quality: imageQuality(imageModel)
            } as any);
          } else {
            console.log('✨ Using images.generate (no images referenced)');
            response = await openai.images.generate({
              model: imageModel,
              prompt: compiledPrompt,
              n: 1,
              size: size,
              quality: imageQuality(imageModel)
            } as any);
          }

          await logImageUsage(options?.userId, promptName, response, Date.now() - imageStart, true, undefined, imageModel);

          // Get base64 image and upload to S3
          const base64Image = response.data?.[0]?.b64_json;
          if (!base64Image) {
            throw new Error('No base64 image data returned from image generation API');
          }

          const imageBuffer = Buffer.from(base64Image, 'base64');
          stepImageUrl = await uploadBufferToS3(imageBuffer, 'image/png', 'generated-images');

          console.log('✅ Image generated and uploaded:', stepImageUrl);
        } else {
          // For referenced prompts, use existing function
          const imageResult = await generateImageWithPrompt(
            promptName,
            stepParams,
            {
              userId: options?.userId
            }
          );
          stepImageUrl = imageResult.imageUrl;
        }

        stepOutput = `[Image generated: ${stepImageUrl}]`;
        stepUsage = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 }; // Image gen doesn't use tokens

        console.log('✅ Image generated:', stepImageUrl);
      } else {
        // Text generation step
        console.log('📝 Executing text generation...');

        // Determine provider and model for this step
        let provider: LLMProvider;
        let model: string;

        if (step.isEmbedded) {
          // For embedded prompts, use enforced provider and model from chain
          provider = step.provider as LLMProvider;
          model = step.model;
        } else {
          // For referenced prompts, allow overrides or use prompt config
          const llmConfig = await resolveLLMConfig(promptName);
          provider = (step.provider || llmConfig.provider) as LLMProvider;
          model = step.model || llmConfig.model;
        }

        console.log('Using Provider:', provider);
        console.log('Using Model:', model);

        const textResult = await sendToLLM(compiledPrompt, {
          provider,
          model,
          userId: options?.userId,
          promptName: promptName
        });

        stepOutput = textResult.content;
        stepUsage = textResult.usage;

        console.log('✅ Text generated, length:', stepOutput.length, 'characters');
      }

      // Accumulate usage
      if (stepUsage) {
        totalUsage.prompt_tokens += stepUsage.prompt_tokens || 0;
        totalUsage.completion_tokens += stepUsage.completion_tokens || 0;
        totalUsage.total_tokens += stepUsage.total_tokens || 0;
      }

      // Store step result
      stepResults.push({
        stepNumber,
        output: stepOutput,
        imageUrl: stepImageUrl
      });

      // Update previousOutput and previousImageUrl for next step
      previousOutput = stepOutput;
      if (stepImageUrl) {
        previousImageUrl = stepImageUrl;
      }

      console.log(`✅ Step ${stepNumber} completed\n`);
    }

    const duration = Date.now() - startTime;

    console.log('\n========================================');
    console.log('✅ CHAIN EXECUTION COMPLETE');
    console.log('========================================');
    console.log('Total Steps:', steps.length);
    console.log('Final Output Length:', previousOutput.length, 'characters');
    console.log('Final Image URL:', previousImageUrl || 'None');
    console.log('Total Tokens:', totalUsage.total_tokens);
    console.log('Duration:', duration, 'ms');
    console.log('Timestamp:', new Date().toISOString());
    console.log('========================================\n');

    return {
      content: previousOutput,
      imageUrl: previousImageUrl,
      usage: totalUsage,
      compiledPrompts,
      stepResults
    };
  } catch (error: any) {
    const duration = Date.now() - startTime;

    console.log('\n========================================');
    console.log('❌ CHAIN EXECUTION ERROR');
    console.log('========================================');
    console.log('Command:', commandMapping.command);
    console.log('Error:', error.message);
    console.log('Error Stack:', error.stack);
    console.log('Duration:', duration, 'ms');
    console.log('Timestamp:', new Date().toISOString());
    console.log('========================================\n');

    throw new Error(`Chain execution failed: ${error.message}`);
  }
}
