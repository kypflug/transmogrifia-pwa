import type { OneDriveArticleMeta } from '../types';
import { getRecipe } from '../recipes';

/**
 * Format a timestamp to a relative date string.
 */
function relativeDate(timestamp: number): string {
  const now = Date.now();
  const diff = now - timestamp;
  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  const weeks = Math.floor(days / 7);
  const months = Math.floor(days / 30);

  if (seconds < 60) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days < 7) return `${days}d ago`;
  if (weeks < 5) return `${weeks}w ago`;
  if (months < 12) return `${months}mo ago`;
  return new Date(timestamp).toLocaleDateString();
}

/**
 * Render a single article list item.
 */
export function renderArticleItem(
  meta: OneDriveArticleMeta,
  isCached: boolean,
  isActive: boolean,
): string {
  const recipe = getRecipe(meta.recipeId);
  const icon = recipe?.icon ?? '📄';
  const recipeName = recipe?.name ?? meta.recipeName ?? 'Article';
  const star = meta.isFavorite ? '<span class="fav-star active">★</span>' : '<span class="fav-star">☆</span>';
  const cloudBadge = isCached ? '' : '<span class="cloud-badge" title="Not downloaded">☁️</span>';
  const activeClass = isActive ? ' active' : '';

  return `
    <div class="article-item${activeClass}" data-id="${meta.id}" tabindex="0" role="button">
      <div class="article-item-top">
        ${star}
        <span class="article-title">${escapeHtml(meta.title)}</span>
      </div>
      <div class="article-item-bottom">
        <span class="article-recipe">${icon} ${escapeHtml(recipeName)}</span>
        <span class="article-date">${relativeDate(meta.createdAt)}</span>
        ${cloudBadge}
      </div>
    </div>
  `;
}

/**
 * Render the full article list.
 */
export function renderArticleList(
  container: HTMLElement,
  articles: OneDriveArticleMeta[],
  cachedIds: Set<string>,
  activeId: string | null,
): void {
  if (articles.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <span class="empty-icon">📭</span>
        <p>No articles found</p>
        <p class="empty-hint">Create articles with the Transmogrifier extension, then view them here.</p>
      </div>
    `;
    return;
  }

  container.innerHTML = articles
    .map(a => renderArticleItem(a, cachedIds.has(a.id), a.id === activeId))
    .join('');
}

function escapeHtml(text: string): string {
  const el = document.createElement('span');
  el.textContent = text;
  return el.innerHTML;
}
