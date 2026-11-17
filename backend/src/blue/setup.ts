import { AppConfig } from '../models/AppConfig';
import { getProviderKey } from '../services/llmService';
import { createAnthropicProvider, createOpenAICompatibleProvider } from './providers';
import type { ChatProvider } from './types';

export type BlueProviderName = 'anthropic' | 'openai' | 'grok';
export const BLUE_PROVIDERS: BlueProviderName[] = ['anthropic', 'openai', 'grok'];

/** Sensible starting models when the admin hasn't picked one (the admin can type any model ID). */
export const BLUE_DEFAULT_MODELS: Record<BlueProviderName, string | undefined> = {
  anthropic: 'claude-haiku-5-5',
  openai: 'gpt-4o-mini',
  grok: undefined
};

export interface BlueSetup {
  enabled: boolean;
  provider?: BlueProviderName;
  model?: string;
  dailyMessageLimit: number;
  configuredProviders: BlueProviderName[];
  /** Why Blue can't run, if it can't. */
  problem?: string;
}

async function hasKey(provider: BlueProviderName): Promise<boolean> {
  try {
    return Boolean(await getProviderKey(provider));
  } catch {
    return false;
  }
}

export async function loadBlueSetup(): Promise<BlueSetup> {
  const config = await AppConfig.getConfig();
  const configuredProviders: BlueProviderName[] = [];
  for (const p of BLUE_PROVIDERS) if (await hasKey(p)) configuredProviders.push(p);

  const setup: BlueSetup = {
    enabled: config.blueEnabled !== false,
    dailyMessageLimit: typeof config.blueDailyMessageLimit === 'number' ? config.blueDailyMessageLimit : 100,
    configuredProviders
  };

  const provider = (config.blueProvider as BlueProviderName | undefined) || configuredProviders[0];
  if (!provider) {
    setup.problem = 'No AI provider is set up for Blue yet. A System Admin can add an Anthropic, OpenAI or Grok key in Settings › AI.';
    return setup;
  }
  if (!configuredProviders.includes(provider)) {
    setup.problem = `Blue is set to use ${provider}, but no ${provider} API key is configured.`;
    return setup;
  }
  const model = config.blueModel || BLUE_DEFAULT_MODELS[provider];
  if (!model) {
    setup.problem = `Choose a ${provider} model for Blue in Settings › AI.`;
    return setup;
  }
  setup.provider = provider;
  setup.model = model;
  return setup;
}

export async function createBlueProvider(setup: BlueSetup): Promise<ChatProvider> {
  if (!setup.provider || !setup.model) throw new Error(setup.problem || 'Blue is not configured');
  const apiKey = await getProviderKey(setup.provider);
  if (setup.provider === 'anthropic') return createAnthropicProvider({ apiKey, model: setup.model });
  return createOpenAICompatibleProvider({ provider: setup.provider, apiKey, model: setup.model });
}
