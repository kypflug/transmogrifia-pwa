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
