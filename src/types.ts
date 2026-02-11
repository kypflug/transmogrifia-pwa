/**
 * Types for the Library of Transmogrifia PWA
 *
 * Shared types (OneDriveArticleMeta, settings, AI/image provider config)
 * are imported from @kypflug/transmogrifier-core.
 * PWA-specific types are defined here.
 */

// Re-export shared types from core
export type {
  OneDriveArticleMeta,
  OneDriveImageAsset,
  AIProvider,
  ImageProvider,
  AIProviderSettings,
  ImageProviderSettings,
  CloudSettings,
  SharingProvider,
  SharingProviderSettings,
  TransmogrifierSettings,
  UserAIConfig,
  UserImageConfig,
} from '@kypflug/transmogrifier-core';

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
