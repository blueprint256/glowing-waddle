import type { ReactNode } from 'react';

/** Shared by the Settings sections. */

/** Suggested models per provider (any other model name can be typed in). */
export const LLM_MODELS: Record<string, string[]> = {
  openai: ['gpt-4o', 'gpt-4o-mini', 'gpt-3.5-turbo', 'gpt-image-2.5-flare'],
  anthropic: ['claude-sonnet-5-5', 'claude-opus-5-5', 'claude-haiku-5-5'],
  grok: ['grok-beta', 'grok-2'],
  gemini: ['gemini-1.5-pro', 'gemini-1.5-flash']
};

export type ProviderId = 'openai' | 'anthropic' | 'grok' | 'gemini';

export const PROVIDERS: { id: ProviderId; name: string; keyHint: string; placeholder: string }[] = [
  { id: 'openai', name: 'OpenAI', keyHint: 'Starts with sk-. Makes AI photos and (by default) posters’ concepts.', placeholder: 'sk-…' },
  { id: 'anthropic', name: 'Anthropic (Claude)', keyHint: 'Starts with sk-ant-. Needed for designed posters (reading concepts into layers, the review and poster edits).', placeholder: 'sk-ant-…' },
  { id: 'grok', name: 'Grok (xAI)', keyHint: 'From console.x.ai.', placeholder: 'xai-…' },
  { id: 'gemini', name: 'Google Gemini', keyHint: 'From Google AI Studio.', placeholder: 'AIza…' }
];

/** Providers with a key in Settings › AI: the text models above, plus fal.ai (pictures and cut-outs only). */
export type KeyProviderId = ProviderId | 'fal';
export const KEY_PROVIDERS: { id: KeyProviderId; name: string; keyHint: string; placeholder: string }[] = [
  ...PROVIDERS,
  { id: 'fal', name: 'fal.ai (Qwen, SAM 3)', keyHint: 'From fal.ai › Keys (id:secret). Runs the Qwen image models, and cuts people out of photos so they can break out of a poster’s frame.', placeholder: 'xxxxxxxx-…:…' }
];

export const SECTORS = ['Tech', 'Retail', 'Healthcare', 'Finance', 'Education', 'Manufacturing', 'Food and drink', 'Hospitality', 'Beauty', 'Non-profit', 'Club or association', 'Faith', 'Government', 'Other'];
export const BRAND_TONES = ['Professional', 'Friendly', 'Fun', 'Casual', 'Formal', 'Serious', 'Warm', 'Bold'];

export type SettingsSectionId = 'profile' | 'brand' | 'integrations' | 'ai' | 'prompts';

export interface SectionDef {
  id: SettingsSectionId;
  label: string;
  description: string;
  admin?: boolean;
  icon?: ReactNode;
}
