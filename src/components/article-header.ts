import type { OneDriveArticleMeta } from '../types';
import { getRecipe } from '../recipes';

/**
 * Render the article header bar in the reader pane.
 */
export function renderArticleHeader(
  container: HTMLElement,
  meta: OneDriveArticleMeta,
): void {
  const recipe = getRecipe(meta.recipeId);
  const icon = recipe?.icon ?? '📄';
  const recipeName = recipe?.name ?? meta.recipeName ?? 'Article';
  const date = new Date(meta.createdAt).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
  const hostname = getHostname(meta.originalUrl);
  const favIcon = '★';
  const favClass = meta.isFavorite ? ' active' : '';
  const shareIcon = meta.sharedUrl ? '🔗' : '📤';
  const shareClass = meta.sharedUrl ? ' active' : '';
  const shareTitle = meta.sharedUrl ? 'Manage share link' : 'Share article';

  container.innerHTML = `
    <div class="article-header">
      <button class="mobile-back" id="backBtn" title="Back to list" aria-label="Back to list">←</button>
      <div class="article-header-info">
        <h2 class="article-header-title">${escapeHtml(meta.title)}</h2>
        <div class="article-header-meta">
          <span class="article-header-source">${escapeHtml(hostname)}</span>
          <span class="article-header-sep">·</span>
          <span class="article-header-recipe">${icon} ${escapeHtml(recipeName)}</span>
          <span class="article-header-sep">·</span>
          <span class="article-header-date">${date}</span>
        </div>
      </div>
      <div class="article-header-actions">
        <button class="action-btn fav-btn${favClass}" id="favBtn" title="Toggle favorite">
          <span class="fav-icon">${favIcon}</span>
        </button>
        <button class="action-btn share-btn${shareClass}" id="shareBtn" title="${shareTitle}">
          <span class="share-icon">${shareIcon}</span>
        </button>
        <button class="action-btn orig-btn" id="origBtn" title="Open original article">
          🌐
        </button>
        <button class="action-btn del-btn" id="delBtn" title="Delete article">
          🗑️
        </button>
      </div>
    </div>
  `;
}

function getHostname(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

function escapeHtml(text: string): string {
  const el = document.createElement('span');
  el.textContent = text;
  return el.innerHTML;
}
