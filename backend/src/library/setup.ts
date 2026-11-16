import { AppConfig } from '../models/AppConfig';
import { getProviderKey } from '../services/llmService';
import { BLUE_PROVIDERS, BLUE_DEFAULT_MODELS, BlueProviderName } from '../blue/setup';

/** Resolved Library (Aggregator) settings: which AI reads files, limits, search by meaning. */
export interface LibrarySetup {
  enabled: boolean;
  provider?: BlueProviderName;
  model?: string;
  monthlyAiLimit: number;
  semanticRequested: boolean;
  semantic: boolean; // requested and an OpenAI key exists
  configuredProviders: BlueProviderName[];
  aiProblem?: string;
}

async function hasKey(p: BlueProviderName): Promise<boolean> {
  try {
    return Boolean(await getProviderKey(p));
  } catch {
    return false;
  }
}

let cache: { at: number; value: LibrarySetup } | null = null;

export function invalidateLibrarySetup() {
  cache = null;
}

export async function loadLibrarySetup(): Promise<LibrarySetup> {
  if (cache && Date.now() - cache.at < 30_000) return cache.value;
  const config = await AppConfig.getConfig();
  const configuredProviders: BlueProviderName[] = [];
  for (const p of BLUE_PROVIDERS) if (await hasKey(p)) configuredProviders.push(p);

  const setup: LibrarySetup = {
    enabled: config.libraryEnabled !== false,
    monthlyAiLimit: typeof config.libraryMonthlyAiLimit === 'number' ? config.libraryMonthlyAiLimit : 500,
    semanticRequested: config.librarySemanticSearch !== false,
    semantic: config.librarySemanticSearch !== false && configuredProviders.includes('openai'),
    configuredProviders
  };

  const provider = (config.libraryProvider as BlueProviderName | undefined) || (config.blueProvider as BlueProviderName | undefined) || configuredProviders[0];
  if (!provider) setup.aiProblem = 'No AI provider key is configured, so files are stored and indexed without AI descriptions.';
  else if (!configuredProviders.includes(provider)) setup.aiProblem = `The Library is set to use ${provider}, but no ${provider} API key is configured.`;
  else {
    const model = config.libraryModel || (config.libraryProvider ? undefined : config.blueModel) || BLUE_DEFAULT_MODELS[provider];
    if (!model) setup.aiProblem = `Choose a ${provider} model for the Library in Settings.`;
    else {
      setup.provider = provider;
      setup.model = model;
    }
  }
  cache = { at: Date.now(), value: setup };
  return setup;
}
