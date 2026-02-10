/** Metadata for a single transmogrified article (stored as {id}.json in OneDrive) */
export interface OneDriveArticleMeta {
  id: string;
  title: string;
  originalUrl: string;
  recipeId: string;
  recipeName: string;
  createdAt: number;    // epoch ms
  updatedAt: number;    // epoch ms
  isFavorite: boolean;
  size: number;         // HTML size in bytes
  // Sharing fields (optional)
  sharedUrl?: string;
  sharedBlobUrl?: string;
  shareShortCode?: string;
  sharedAt?: number;
  shareExpiresAt?: number;
}

/** User profile from Microsoft Graph */
export interface UserProfile {
  displayName: string;
  mail: string | null;
  userPrincipalName: string;
}

/** Sort options for the article list */
export type SortOrder = 'newest' | 'oldest' | 'alpha';

/** Filter options for the article list */
export type FilterMode = 'all' | 'favorites' | 'downloaded' | string; // string = recipe ID

/** Theme options */
export type Theme = 'light' | 'dark' | 'sepia' | 'system';

// ─── AI/Image Provider Types (shared with extension) ────────────────

export type AIProvider = 'azure-openai' | 'openai' | 'anthropic' | 'google';
export type ImageProvider = 'azure-openai' | 'openai' | 'google' | 'none';

// ─── Settings Types (shared with extension) ────────────────

/** Per-provider AI configuration (user-editable) */
export interface AIProviderSettings {
  azureOpenai?: {
    endpoint: string;
    apiKey: string;
    deployment: string;
    apiVersion: string;
  };
  openai?: {
    apiKey: string;
    model: string;
  };
  anthropic?: {
    apiKey: string;
    model: string;
  };
  google?: {
    apiKey: string;
    model: string;
  };
}

/** Per-provider Image configuration (user-editable) */
export interface ImageProviderSettings {
  azureOpenai?: {
    endpoint: string;
    apiKey: string;
    deployment: string;
    apiVersion: string;
  };
  openai?: {
    apiKey: string;
    model: string;
  };
  google?: {
    apiKey: string;
    model: string;
  };
}

/** Cloud processing configuration */
export interface CloudSettings {
  apiUrl: string;
}

/** Sharing storage provider */
export type SharingProvider = 'none' | 'azure-blob';

/** Per-provider sharing configuration */
export interface SharingProviderSettings {
  azureBlob?: {
    accountName: string;
    containerName: string;
    sasToken: string;
  };
}

/** Full settings object (encrypted at rest) */
export interface TransmogrifierSettings {
  /** Schema version for future migrations */
  version: number;
  /** Active AI provider */
  aiProvider: AIProvider;
  /** Per-provider AI config */
  ai: AIProviderSettings;
  /** Active image provider */
  imageProvider: ImageProvider;
  /** Per-provider image config */
  image: ImageProviderSettings;
  /** Cloud processing settings */
  cloud: CloudSettings;
  /** Active sharing storage provider */
  sharingProvider: SharingProvider;
  /** Per-provider sharing config */
  sharing: SharingProviderSettings;
  /** When these settings were last updated (epoch ms) */
  updatedAt: number;
}

/** AI config discriminated union for cloud queue requests */
export type UserAIConfig =
  | { provider: 'azure-openai'; endpoint: string; apiKey: string; deployment: string; apiVersion: string }
  | { provider: 'openai'; apiKey: string; model: string }
  | { provider: 'anthropic'; apiKey: string; model: string }
  | { provider: 'google'; apiKey: string; model: string };

/** Image config discriminated union for cloud queue requests */
export type UserImageConfig =
  | { provider: 'azure-openai'; endpoint: string; apiKey: string; deployment: string; apiVersion: string }
  | { provider: 'openai'; apiKey: string; model: string }
  | { provider: 'google'; apiKey: string; model: string };
