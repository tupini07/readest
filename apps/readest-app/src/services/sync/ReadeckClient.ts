import { ReadeckSettings } from '@/types/readeck';
import { fetch as tauriFetch } from '@tauri-apps/plugin-http';
import { isTauriAppPlatform } from '../environment';

export interface ReadeckBookmark {
  id: string;
  title: string;
  site_name: string;
  url: string;
  authors: string[];
  read_progress: number; // 0-100
  is_archived: boolean;
  is_marked: boolean;
  word_count: number;
  reading_time: number;
  created: string;
  updated: string;
  has_article: boolean;
  resources: {
    article?: { src: string };
    image?: { src: string };
    thumbnail?: { src: string };
  };
}

export interface ReadeckListResponse {
  items: ReadeckBookmark[];
  total_pages: number;
  page: number;
}

export class ReadeckClient {
  private config: ReadeckSettings;

  constructor(config: ReadeckSettings) {
    this.config = config;
    this.config.serverUrl = config.serverUrl.replace(/\/$/, '');
  }

  private async request(
    endpoint: string,
    options: {
      method?: 'GET' | 'PATCH';
      body?: BodyInit | null;
      headers?: HeadersInit;
      accept?: string;
    } = {},
  ): Promise<Response> {
    const { method = 'GET', body, headers: additionalHeaders, accept } = options;

    const headers = new Headers(additionalHeaders || {});
    headers.set('Authorization', `Bearer ${this.config.apiToken}`);

    const fetchFn = isTauriAppPlatform() ? tauriFetch : window.fetch;
    const url = `${this.config.serverUrl}/api${endpoint}`;

    return fetchFn(url, {
      method,
      headers: {
        Accept: accept || 'application/json',
        ...(body ? { 'Content-Type': 'application/json' } : {}),
        ...Object.fromEntries(headers.entries()),
      },
      body,
    });
  }

  /**
   * Validates the API token by making a minimal request
   * @returns Promise with boolean indicating whether the token is valid
   */
  async validateToken(): Promise<boolean> {
    try {
      const response = await this.request('/bookmarks?limit=1');
      return response.ok;
    } catch (e) {
      console.error('Readeck: Token validation failed', e);
      return false;
    }
  }

  /**
   * Lists bookmarks from the Readeck server
   * @param opts - Filter options for the bookmark list
   * @returns Promise with the list response
   */
  async listBookmarks(opts: {
    archived?: boolean;
    limit?: number;
    offset?: number;
  }): Promise<ReadeckListResponse> {
    const params = new URLSearchParams();
    if (opts.limit !== undefined) params.set('limit', opts.limit.toString());
    if (opts.offset !== undefined) params.set('offset', opts.offset.toString());
    if (opts.archived !== undefined) params.set('is_archived', opts.archived.toString());

    try {
      const response = await this.request(`/bookmarks?${params.toString()}`);
      if (!response.ok) {
        console.error(`Readeck: Failed to list bookmarks. Status: ${response.status}`);
        return { items: [], total_pages: 0, page: 0 };
      }
      const data = await response.json();
      return {
        items: Array.isArray(data) ? data : data.items ?? [],
        total_pages: data.total_pages ?? 1,
        page: data.page ?? 1,
      };
    } catch (e) {
      console.error('Readeck: listBookmarks failed', e);
      return { items: [], total_pages: 0, page: 0 };
    }
  }

  /**
   * Downloads the EPUB version of a bookmark's article
   * @param id - The bookmark ID
   * @returns Promise with the EPUB data as ArrayBuffer
   */
  async getBookmarkEpub(id: string): Promise<ArrayBuffer> {
    const response = await this.request(`/bookmarks/${id}/article.epub`, {
      accept: 'application/epub+zip',
    });

    if (!response.ok) {
      throw new Error(`Readeck: Failed to download EPUB for ${id}. Status: ${response.status}`);
    }

    return response.arrayBuffer();
  }

  /**
   * Updates reading progress for a bookmark
   * @param id - The bookmark ID
   * @param progress - Reading progress (0-100)
   * @param readAnchor - Optional read anchor position
   * @returns Promise with boolean indicating success
   */
  async updateProgress(id: string, progress: number, readAnchor?: string): Promise<boolean> {
    const payload: Record<string, unknown> = { read_progress: progress };
    if (readAnchor) {
      payload['read_anchor'] = readAnchor;
    }

    try {
      const response = await this.request(`/bookmarks/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        console.error(`Readeck: Failed to update progress for ${id}. Status: ${response.status}`);
        return false;
      }
      return true;
    } catch (e) {
      console.error('Readeck: updateProgress failed', e);
      return false;
    }
  }

  /**
   * Archives a bookmark on the Readeck server
   * @param id - The bookmark ID
   * @returns Promise with boolean indicating success
   */
  async archiveBookmark(id: string): Promise<boolean> {
    try {
      const response = await this.request(`/bookmarks/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ is_archived: true }),
      });

      if (!response.ok) {
        console.error(`Readeck: Failed to archive ${id}. Status: ${response.status}`);
        return false;
      }
      return true;
    } catch (e) {
      console.error('Readeck: archiveBookmark failed', e);
      return false;
    }
  }
}
