import { AppConfig } from '../models/AppConfig';
import { PROVIDERS, ProviderId, ProviderSettings } from './types';
import { decryptSecret } from './secrets';

/** Resolved publishing settings (secrets decrypted, cached for 30 s). */
export interface PublishingSetup {
  enabled: boolean;
  testMode: boolean;
  providers: Record<ProviderId, ProviderSettings & { ready: boolean }>;
}

let cache: { at: number; value: PublishingSetup } | null = null;

export function invalidatePublishingSetup() {
  cache = null;
}

export async function loadPublishingSetup(): Promise<PublishingSetup> {
  if (cache && Date.now() - cache.at < 30_000) return cache.value;
  const config = await AppConfig.getConfig();
  const stored = (config.publishingProviders || {}) as Record<string, any>;
  const providers = {} as PublishingSetup['providers'];
  for (const id of PROVIDERS) {
    const s = stored[id] || {};
    let clientSecret = '';
    try {
      clientSecret = decryptSecret(s.clientSecretEnc);
    } catch {
      clientSecret = '';
    }
    const clientId = typeof s.clientId === 'string' ? s.clientId.trim() : '';
    providers[id] = {
      enabled: s.enabled === true,
      clientId,
      clientSecret,
      options: (s.options || {}) as ProviderSettings['options'],
      ready: s.enabled === true && Boolean(clientId && clientSecret)
    };
  }
  const value: PublishingSetup = { enabled: config.publishingEnabled !== false, testMode: config.publishingTestMode !== false, providers };
  cache = { at: Date.now(), value };
  return value;
}
