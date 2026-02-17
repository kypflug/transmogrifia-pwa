/**
 * Cloud Queue Service for Library of Transmogrifia
 *
 * Sends URLs to the cloud API for asynchronous transmogrification.
 * The cloud function processes the page, generates HTML via AI, and
 * uploads the result directly to the user's OneDrive. The PWA
 * picks it up on the next sync pull.
 *
 * Requirements:
 * - User must be signed in (needs a valid Microsoft Graph access token)
 * - Cloud API URL must be configured in Settings
 * - AI keys must be configured in Settings (server has no keys of its own)
 */

import { getAccessToken } from './auth';
import { loadSettings, getEffectiveAIConfig, getEffectiveImageConfig } from './settings';
import type { UserAIConfig, UserImageConfig, TransmogrifierSettings } from '../types';
import { getDefaultRecipeId, recipeRequiresAI } from '../recipes';

const CLOUD_API_URL = 'https://transmogrifier-api.azurewebsites.net';

export interface CloudQueueResponse {
  jobId: string;
  message: string;
  recipe?: string;
  recipeName?: string;
}

/**
 * Check prerequisites for cloud queue (signed in, cloud URL set, AI configured).
 * Returns null if ready, or a user-facing error message string.
 */
export async function checkQueuePrereqs(recipeId: string = getDefaultRecipeId()): Promise<string | null> {
  if (!recipeRequiresAI(recipeId)) {
    return null;
  }

  const aiConfig = await getEffectiveAIConfig();
  if (!aiConfig) {
    return 'AI provider not configured. Go to Settings to set up your API keys.';
  }

  return null;
}

/**
 * Queue a URL for cloud transmogrification.
 *
 * @param url - The URL to transmogrify
 * @param recipeId - Recipe to apply (default: Fast/no inference)
 * @param customPrompt - Optional custom prompt for the 'custom' recipe
 * @param generateImages - Whether to generate AI images
 * @returns Job info with jobId
 * @throws If not signed in, not configured, or API error
 */
export async function queueForCloud(
  url: string,
  recipeId: string = getDefaultRecipeId(),
  customPrompt?: string,
  generateImages: boolean = false,
): Promise<CloudQueueResponse> {
  const accessToken = await getAccessToken();

  const settings = await loadSettings();
  const requiresAI = recipeRequiresAI(recipeId);
  const userAIConfig = requiresAI ? buildUserAIConfig(settings) : null;
  if (requiresAI && !userAIConfig) {
    throw new Error('AI keys are not configured. Set up your AI provider in Settings.');
  }

  const body: Record<string, unknown> = {
    url,
    recipeId,
    accessToken,
    customPrompt,
  };

  if (userAIConfig) {
    body.aiConfig = userAIConfig;
  }

  // Include image config if user toggled image generation
  if (generateImages) {
    const imageConfig = await getEffectiveImageConfig();
    if (imageConfig) {
      body.imageConfig = buildUserImageConfig(settings);
    }
  }

  const response = await fetch(`${CLOUD_API_URL}/api/queue`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errorBody = await response.json().catch(() => ({ error: response.statusText }));
    throw new Error((errorBody as { error?: string }).error || `Cloud API error: ${response.status}`);
  }

  return response.json();
}

/**
 * Build UserAIConfig from decrypted settings.
 * Same discriminated union as the extension's getCloudAIConfig().
 */
function buildUserAIConfig(settings: TransmogrifierSettings): UserAIConfig | null {
  const provider = settings.aiProvider;

  switch (provider) {
    case 'azure-openai': {
      const c = settings.ai.azureOpenai;
      if (!c?.apiKey) return null;
      return { provider: 'azure-openai', endpoint: c.endpoint, apiKey: c.apiKey, deployment: c.deployment, apiVersion: c.apiVersion };
    }
    case 'openai': {
      const c = settings.ai.openai;
      if (!c?.apiKey) return null;
      return { provider: 'openai', apiKey: c.apiKey, model: c.model };
    }
    case 'anthropic': {
      const c = settings.ai.anthropic;
      if (!c?.apiKey) return null;
      return { provider: 'anthropic', apiKey: c.apiKey, model: c.model };
    }
    case 'google': {
      const c = settings.ai.google;
      if (!c?.apiKey) return null;
      return { provider: 'google', apiKey: c.apiKey, model: c.model };
    }
  }
}

/**
 * Build UserImageConfig from decrypted settings.
 */
function buildUserImageConfig(settings: TransmogrifierSettings): UserImageConfig | null {
  const provider = settings.imageProvider;
  if (provider === 'none') return null;

  switch (provider) {
    case 'azure-openai': {
      const c = settings.image.azureOpenai;
      if (!c?.apiKey) return null;
      return { provider: 'azure-openai', endpoint: c.endpoint, apiKey: c.apiKey, deployment: c.deployment, apiVersion: c.apiVersion };
    }
    case 'openai': {
      const c = settings.image.openai;
      if (!c?.apiKey) return null;
      return { provider: 'openai', apiKey: c.apiKey, model: c.model };
    }
    case 'google': {
      const c = settings.image.google;
      if (!c?.apiKey) return null;
      return { provider: 'google', apiKey: c.apiKey, model: c.model };
    }
  }
}
