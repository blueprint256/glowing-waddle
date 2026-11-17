/**
 * Publishing: shared types. A *provider* is the developer app you register with a company (X, LinkedIn,
 * Meta, TikTok, Google). A *platform* is where a post appears; Meta's one app serves both Facebook
 * Pages and Instagram. Each platform has one adapter (plug-in) that knows how to connect accounts and
 * post; everything else (scheduling, retries, status, screens) is shared.
 */

export const PLATFORMS = ['x', 'linkedin', 'facebook', 'instagram', 'tiktok', 'youtube'] as const;
export type PlatformId = (typeof PLATFORMS)[number];

export const PROVIDERS = ['x', 'linkedin', 'meta', 'tiktok', 'google'] as const;
export type ProviderId = (typeof PROVIDERS)[number];

export type FetchLike = (url: string, init?: any) => Promise<{
  ok: boolean;
  status: number;
  headers: { get(name: string): string | null };
  text(): Promise<string>;
}>;

/** Credentials and options an admin enters for one provider (secrets already decrypted). */
export interface ProviderSettings {
  enabled: boolean;
  clientId: string;
  clientSecret: string;
  /** e.g. LinkedIn: allow company pages (needs Community Management API approval). */
  options: Record<string, string | boolean | undefined>;
}

/** One file to publish. Reads are ranged so large videos are never held whole in memory. */
export interface MediaFile {
  kind: 'image' | 'video';
  mime: string;
  size: number;
  name: string;
  width?: number;
  height?: number;
  read(start: number, end: number): Promise<Buffer>;
  readAll(): Promise<Buffer>;
  /** A temporary public link (signed) for platforms that fetch the file themselves (Meta). */
  publicUrl(): Promise<string>;
  /** Same, but guaranteed JPEG (Instagram accepts only JPEG images). */
  publicJpegUrl(): Promise<string>;
}

/** What an adapter needs to publish one post. */
export interface PublishRequest {
  text: string;
  media: MediaFile[];
  options: PostOptions;
  /** The connected account (decrypted tokens). */
  account: AccountAuth;
  settings: ProviderSettings;
  fetchImpl: FetchLike;
  /** Lets long uploads keep the job's lock alive and report progress. */
  heartbeat: (message?: string) => Promise<void>;
}

export interface PostOptions {
  /** YouTube title; TikTok photo title. */
  title?: string;
  /** TikTok privacy_level (must be one the creator allows) or YouTube privacyStatus. */
  privacy?: string;
  disableComments?: boolean;
  disableDuet?: boolean;
  disableStitch?: boolean;
  /** TikTok commercial content disclosure. */
  brandOrganic?: boolean;
  brandedContent?: boolean;
  /** YouTube: made for kids declaration (required). */
  madeForKids?: boolean;
}

export interface AccountAuth {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: Date | null;
  /** Platform account id (X user id, LinkedIn person/organization URN, Page id, IG user id, TikTok open_id, YouTube channel id). */
  accountId: string;
  username?: string;
  meta: Record<string, any>;
}

export interface PublishResult {
  remoteId: string;
  url?: string;
  /** Some platforms (TikTok) finish processing later; the worker checks again. */
  pending?: boolean;
}

/** An account found while connecting (a person, a company page, a Facebook Page, an IG account…). */
export interface DiscoveredAccount {
  platform: PlatformId;
  accountId: string;
  name: string;
  username?: string;
  avatarUrl?: string;
  accountType: 'person' | 'organization' | 'page' | 'business' | 'creator' | 'channel';
  accessToken: string;
  refreshToken?: string;
  expiresAt?: Date | null;
  scopes?: string[];
  meta?: Record<string, any>;
}

export interface TokenSet {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: Date | null;
  scopes?: string[];
}

export interface ProviderAdapter {
  id: ProviderId;
  name: string;
  platforms: PlatformId[];
  /** Where the admin creates the developer app. */
  developerPortal: string;
  /** Plain-language summary of what approval is needed. */
  approvalNote: string;
  /** Extra admin fields beyond client id/secret. */
  optionFields?: { key: string; label: string; type: 'boolean' | 'text'; help?: string }[];
  buildAuthorizeUrl(p: { settings: ProviderSettings; redirectUri: string; state: string; codeChallenge: string }): string;
  exchangeCode(p: { settings: ProviderSettings; redirectUri: string; code: string; codeVerifier: string; fetchImpl: FetchLike }): Promise<TokenSet>;
  /** All accounts this sign-in can post to (one per page/org/channel). */
  discoverAccounts(p: { settings: ProviderSettings; tokens: TokenSet; fetchImpl: FetchLike }): Promise<DiscoveredAccount[]>;
  /** Returns fresh tokens, or null when this provider's tokens don't expire / can't be refreshed. */
  refresh?(p: { settings: ProviderSettings; account: AccountAuth; fetchImpl: FetchLike }): Promise<TokenSet | null>;
  publish(platform: PlatformId, req: PublishRequest): Promise<PublishResult>;
  /** For platforms that finish asynchronously. */
  checkStatus?(platform: PlatformId, req: { account: AccountAuth; remoteId: string; settings: ProviderSettings; fetchImpl: FetchLike }): Promise<PublishResult>;
  /** Live per-account choices the post form must show (TikTok creator info). */
  accountOptions?(platform: PlatformId, req: { account: AccountAuth; settings: ProviderSettings; fetchImpl: FetchLike }): Promise<Record<string, unknown>>;
}

/** Errors from platforms, classified so the scheduler knows what to do. */
export class PublishError extends Error {
  constructor(
    message: string,
    public readonly opts: { retryable?: boolean; reconnect?: boolean; status?: number } = {}
  ) {
    super(message);
  }
}
