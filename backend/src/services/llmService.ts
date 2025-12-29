import OpenAI from 'openai';
import { Prompt } from '../models/Prompt';
import { LLMUsage } from '../models/LLMUsage';
import mongoose from 'mongoose';

// Initialize OpenAI client
let openai: OpenAI | null = null;

function getOpenAIClient(): OpenAI {
  if (!openai) {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new Error('OPENAI_API_KEY environment variable is not set');
    }
    openai = new OpenAI({ apiKey });
  }
  return openai;
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

  // Replace any custom placeholders
  Object.keys(params).forEach(key => {
    if (key !== 'companyInfo' && key !== 'campaignDetails') {
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
 * Calculate estimated cost based on model and token usage
 * Pricing as of 2024 (approximate, subject to change)
 */
function calculateEstimatedCost(model: string, promptTokens: number, completionTokens: number): number {
  // Prices per 1M tokens (in USD)
  const pricing: Record<string, { input: number; output: number }> = {
    'gpt-4o': { input: 2.5, output: 10 },
    'gpt-4o-mini': { input: 0.15, output: 0.6 },
    'gpt-4-turbo': { input: 10, output: 30 },
    'gpt-4': { input: 30, output: 60 },
    'gpt-3.5-turbo': { input: 0.5, output: 1.5 }
  };

  const modelPricing = pricing[model] || pricing['gpt-4o'];
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
  model: string,
  usage: { prompt_tokens: number; completion_tokens: number; total_tokens: number },
  duration: number,
  success: boolean,
  errorMessage?: string
): Promise<void> {
  try {
    const estimatedCost = calculateEstimatedCost(model, usage.prompt_tokens, usage.completion_tokens);

    await LLMUsage.create({
      userId,
      promptName,
      model,
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
 * Send compiled prompt to OpenAI ChatGPT API
 */
export async function sendToLLM(
  prompt: string,
  options?: {
    model?: string;
    temperature?: number;
    maxTokens?: number;
    userId?: mongoose.Types.ObjectId;
    promptName?: string;
  }
): Promise<{ content: string; usage: any }> {
  const startTime = Date.now();
  const model = options?.model || process.env.OPENAI_MODEL || 'gpt-4o';
  const temperature = options?.temperature || parseFloat(process.env.OPENAI_TEMPERATURE || '0.7');
  const maxTokens = options?.maxTokens || parseInt(process.env.OPENAI_MAX_TOKENS || '2000');

  try {
    const client = getOpenAIClient();

    const response = await client.chat.completions.create({
      model,
      messages: [{ role: 'user', content: prompt }],
      temperature,
      max_tokens: maxTokens
    });

    const duration = Date.now() - startTime;
    const content = response.choices[0]?.message?.content || '';
    const usage = response.usage || { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };

    // Log usage if userId and promptName are provided
    if (options?.userId && options?.promptName) {
      await logLLMUsage(
        options.userId,
        options.promptName,
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
        model,
        { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
        duration,
        false,
        error.message
      );
    }

    // Handle specific OpenAI errors
    if (error.status === 401) {
      throw new Error('Invalid OpenAI API key. Please check your configuration.');
    } else if (error.status === 429) {
      throw new Error('OpenAI API rate limit exceeded. Please try again later.');
    } else if (error.status === 500 || error.status === 503) {
      throw new Error('OpenAI API is currently unavailable. Please try again later.');
    }

    throw new Error(`OpenAI API error: ${error.message}`);
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
