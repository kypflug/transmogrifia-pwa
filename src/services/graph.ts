import { getAccessToken } from './auth';
import type { OneDriveArticleMeta, UserProfile } from '../types';

const GRAPH_BASE = 'https://graph.microsoft.com/v1.0';
const APP_FOLDER = 'articles';

async function authHeaders(): Promise<Record<string, string>> {
  const token = await getAccessToken();
  return { Authorization: `Bearer ${token}` };
}

/**
 * List all article metadata from OneDrive.
 * Fetches all .json files from the articles folder and downloads each one.
 */
export async function listArticles(): Promise<OneDriveArticleMeta[]> {
  const headers = await authHeaders();
  const metas: OneDriveArticleMeta[] = [];

  // Don't use $filter — it's not supported on consumer OneDrive.
  // Filter for .json files client-side instead.
  let url: string | null =
    `${GRAPH_BASE}/me/drive/special/approot:/${APP_FOLDER}:/children` +
    `?$select=name&$top=200`;

  while (url) {
    const res: Response = await fetch(url, { headers });

    if (!res.ok) {
      if (res.status === 404) return []; // no articles folder yet
      const body = await res.text().catch(() => '');
      throw new Error(`List articles failed: ${res.status} ${body}`);
    }

    const data: Record<string, unknown> = await res.json();

    const items = (data.value as Array<{ name: string }>) || [];
    for (const item of items) {
      const name: string = item.name;
      if (!name.endsWith('.json')) continue;
      const id = name.replace('.json', '');
      try {
        const meta = await downloadMeta(id, headers);
        metas.push(meta);
      } catch (err) {
        console.warn('Skipping unreadable metadata:', name, err);
      }
    }

    url = (data['@odata.nextLink'] as string) || null;
  }

  return metas;
}

async function downloadMeta(
  id: string,
  headers: Record<string, string>,
): Promise<OneDriveArticleMeta> {
  const res = await fetch(
    `${GRAPH_BASE}/me/drive/special/approot:/${APP_FOLDER}/${id}.json:/content`,
    { headers },
  );
  if (!res.ok) throw new Error(`Download meta failed: ${res.status}`);
  return res.json();
}

/**
 * Download article HTML content from OneDrive.
 */
export async function downloadArticleHtml(id: string): Promise<string> {
  const headers = await authHeaders();
  const res = await fetch(
    `${GRAPH_BASE}/me/drive/special/approot:/${APP_FOLDER}/${id}.html:/content`,
    { headers },
  );
  if (!res.ok) throw new Error(`Download HTML failed: ${res.status}`);
  return res.text();
}

/**
 * Upload updated metadata (used for favorite toggle).
 */
export async function uploadMeta(meta: OneDriveArticleMeta): Promise<void> {
  const headers = await authHeaders();
  const res = await fetch(
    `${GRAPH_BASE}/me/drive/special/approot:/${APP_FOLDER}/${meta.id}.json:/content`,
    {
      method: 'PUT',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify(meta, null, 2),
    },
  );
  if (!res.ok) throw new Error(`Upload meta failed: ${res.status}`);
}

/**
 * Fetch the signed-in user's profile.
 */
export async function getUserProfile(): Promise<UserProfile> {
  const headers = await authHeaders();
  const res = await fetch(`${GRAPH_BASE}/me`, { headers });
  if (!res.ok) throw new Error('Failed to fetch profile');
  return res.json();
}
