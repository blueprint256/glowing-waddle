import { Prompt } from '../models/Prompt';

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
 * Send compiled prompt to LLM API (placeholder implementation)
 * This can be extended to integrate with OpenAI, Anthropic, or other LLM providers
 */
export async function sendToLLM(prompt: string, options?: {
  model?: string;
  temperature?: number;
  maxTokens?: number;
}): Promise<string> {
  // Placeholder implementation
  // In a real implementation, this would call OpenAI API:
  /*
  const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY
  });

  const response = await openai.chat.completions.create({
    model: options?.model || 'gpt-4',
    messages: [{ role: 'user', content: prompt }],
    temperature: options?.temperature || 0.7,
    max_tokens: options?.maxTokens || 2000
  });

  return response.choices[0].message.content || '';
  */

  console.log('LLM Prompt:', prompt);
  return 'LLM response placeholder - integrate with actual LLM API (OpenAI, Anthropic, etc.)';
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
  }
): Promise<string> {
  const compiledPrompt = await fetchAndCompilePrompt(promptName, params);
  return await sendToLLM(compiledPrompt, options);
}
