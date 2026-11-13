export interface HubAssetInfo {
  _id: string;
  originalFileName: string;
  contentType: string;
  size: number;
  width?: number;
  height?: number;
  createdAt: string;
}

export interface HubSlot {
  _id: string;
  name: string;
  projectId: string;
  /** Populated by the API; null/absent when the slot is still empty. */
  assetId?: HubAssetInfo | null;
  /** When set, a one-time upload link is live until this time. */
  pendingUntil?: string | null;
}

export interface HubVersion {
  _id: string;
  number: number;
  createdAt: string;
  structuredData: import('../../services/api').StructuredPoster;
  renderedAssetId: HubAssetInfo;
}

export interface HubProjectSummary {
  _id: string;
  name: string;
  description?: string;
  updatedAt: string;
  slotCount: number;
  versionCount: number;
}
