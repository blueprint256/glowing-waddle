import OpenAI from 'openai';
import Anthropic from '@anthropic-ai/sdk';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { Prompt } from '../models/Prompt';
import { LLMUsage } from '../models/LLMUsage';
import { AppConfig } from '../models/AppConfig';
import mongoose from 'mongoose';

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
async function getProviderKey(provider: LLMProvider): Promise<string> {
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
        throw new Error('OpenAI API key not configured. Please configure it in Settings → Integrations.');

      case 'anthropic':
        if (config.anthropicApiKey) {
          return config.decryptApiKey(config.anthropicApiKey);
        }
        if (process.env.ANTHROPIC_API_KEY) {
          return process.env.ANTHROPIC_API_KEY;
        }
        throw new Error('Anthropic API key not configured. Please configure it in Settings → Integrations.');

      case 'grok':
        if (config.grokApiKey) {
          return config.decryptApiKey(config.grokApiKey);
        }
        if (process.env.GROK_API_KEY) {
          return process.env.GROK_API_KEY;
        }
        throw new Error('Grok API key not configured. Please configure it in Settings → Integrations.');

      case 'gemini':
        if (config.geminiApiKey) {
          return config.decryptApiKey(config.geminiApiKey);
        }
        if (process.env.GEMINI_API_KEY) {
          return process.env.GEMINI_API_KEY;
        }
        throw new Error('Gemini API key not configured. Please configure it in Settings → Integrations.');

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
  let compiledPrompt = promptTemplate;

  // Replace {companyInfo} with formatted company information
  if (params.companyInfo) {
    const companyInfoStr = formatCompanyInfo(params.companyInfo);
    compiledPrompt = compiledPrompt.replace(/\{companyInfo\}/g, companyInfoStr);
  }

  // Replace individual company fields
  if (params.companyInfo?.companyName) {
    compiledPrompt = compiledPrompt.replace(/\{companyName\}/g, params.companyInfo.companyName);
  }
  if (params.companyInfo?.sector) {
    compiledPrompt = compiledPrompt.replace(/\{sector\}/g, params.companyInfo.sector);
  }
  if (params.companyInfo?.brandTone) {
    compiledPrompt = compiledPrompt.replace(/\{brandTone\}/g, params.companyInfo.brandTone);
  }

  // Replace brand asset placeholders
  if (params.companyInfo?.brandGuidelines) {
    compiledPrompt = compiledPrompt.replace(/\{brandGuidelines\}/g, params.companyInfo.brandGuidelines);
  }
  if (params.companyInfo?.primaryLogoUrl) {
    compiledPrompt = compiledPrompt.replace(/\{primaryLogo\}/g, params.companyInfo.primaryLogoUrl);
  }
  if (params.companyInfo?.secondaryLogoUrl) {
    compiledPrompt = compiledPrompt.replace(/\{secondaryLogo\}/g, params.companyInfo.secondaryLogoUrl);
  }
  if (params.companyInfo?.tertiaryLogoUrl) {
    compiledPrompt = compiledPrompt.replace(/\{tertiaryLogo\}/g, params.companyInfo.tertiaryLogoUrl);
  }

  // Replace {campaignDetails} with formatted campaign information
  if (params.campaignDetails) {
    const campaignDetailsStr = formatCampaignDetails(params.campaignDetails);
    compiledPrompt = compiledPrompt.replace(/\{campaignDetails\}/g, campaignDetailsStr);
  }

  // Replace individual campaign fields
  if (params.campaignDetails?.name) {
    compiledPrompt = compiledPrompt.replace(/\{campaignName\}/g, params.campaignDetails.name);
  }
  if (params.campaignDetails?.coreMessages) {
    compiledPrompt = compiledPrompt.replace(/\{coreMessages\}/g, params.campaignDetails.coreMessages);
  }
  if (params.campaignDetails?.hashtags) {
    compiledPrompt = compiledPrompt.replace(/\{hashtags\}/g, params.campaignDetails.hashtags.join(', '));
  }

  // Replace {taskDescription} if provided
  if (params.taskDescription) {
    compiledPrompt = compiledPrompt.replace(/\{taskDescription\}/g, params.taskDescription);
  }

  // Replace {baseImage} if provided (URL of the task's base/original image)
  if (params.baseImage) {
    compiledPrompt = compiledPrompt.replace(/\{baseImage\}/g, params.baseImage);
  }

  // Replace any custom placeholders
  Object.keys(params).forEach(key => {
    if (key !== 'companyInfo' && key !== 'campaignDetails' && key !== 'taskDescription' && key !== 'baseImage') {
      const value = typeof params[key] === 'object'
        ? JSON.stringify(params[key], null, 2)
        : String(params[key]);
      const regex = new RegExp(`\\{${key}\\}`, 'g');
      compiledPrompt = compiledPrompt.replace(regex, value);
    }
  });

  return compiledPrompt;
}

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
  if (campaignDetails.startDate) {
    parts.push(`Start Date: ${campaignDetails.startDate.toLocaleDateString()}`);
  }
  if (campaignDetails.endDate) {
    parts.push(`End Date: ${campaignDetails.endDate.toLocaleDateString()}`);
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
function calculateEstimatedCost(
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
      model: `${provider}/${model}`, // Store as "provider/model"
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

    return { content, usage };
  } catch (error: any) {
    const duration = Date.now() - startTime;

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
 * Generate an image using an image generation LLM with a compiled prompt
 */
export async function generateImageWithPrompt(
  promptName: string,
  params: SuperPromptParams,
  options?: {
    model?: string;
    size?: '1024x1024' | '1792x1024' | '1024x1792';
    quality?: 'standard' | 'hd';
    userId?: mongoose.Types.ObjectId;
  }
): Promise<{ imageUrl: string; compiledPrompt: string }> {
  try {
    // Fetch and compile the prompt
    const compiledPrompt = await fetchAndCompilePrompt(promptName, params);

    // Get the prompt configuration to check for image LLM overrides
    const prompt = await Prompt.findOne({ name: promptName });

    // Determine which image model to use (priority: options > prompt override > default)
    const config = await AppConfig.getConfig();
    const imageModel = options?.model
      || prompt?.imageLLMModel
      || config.defaultImageModel
      || 'dall-e-3';

    const imageProvider = prompt?.imageLLMProvider || config.defaultImageProvider || 'openai';

    // For now, we only support OpenAI image generation
    if (imageProvider !== 'openai') {
      throw new Error(`Image provider "${imageProvider}" is not yet supported. Please use OpenAI.`);
    }

    // Get OpenAI client
    const openai = await getOpenAIClient();

    // Generate image using DALL-E
    const response = await openai.images.generate({
      model: imageModel,
      prompt: compiledPrompt,
      n: 1,
      size: options?.size || '1024x1024',
      quality: options?.quality || 'standard',
      response_format: 'url'
    });

    const imageUrl = response.data[0]?.url;

    if (!imageUrl) {
      throw new Error('No image URL returned from image generation API');
    }

    // Log usage if userId provided
    if (options?.userId) {
      await LLMUsage.create({
        userId: options.userId,
        provider: imageProvider,
        model: imageModel,
        promptTokens: 0, // Image generation doesn't use token-based pricing
        completionTokens: 0,
        totalTokens: 0,
        estimatedCost: 0, // Could calculate based on model and size
        promptName,
        createdAt: new Date()
      });
    }

    return {
      imageUrl,
      compiledPrompt
    };
  } catch (error: any) {
    console.error('Error generating image with prompt:', error);
    throw new Error(`Image generation failed: ${error.message}`);
  }
}
