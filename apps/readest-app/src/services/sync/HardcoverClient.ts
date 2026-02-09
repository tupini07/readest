/**
 * Hardcover.app GraphQL API client
 *
 * API endpoint: https://api.hardcover.app/v1/graphql
 * Auth: Bearer token from https://hardcover.app/account/api
 *
 * Inspired by the KOReader plugin: github.com/Billiam/hardcoverapp.koplugin
 */

import { fetch as tauriFetch } from '@tauri-apps/plugin-http';
import {
  HardcoverBookResult,
  HardcoverSettings,
  HardcoverStatusId,
  HardcoverUserBook,
} from '@/types/hardcover';
import { isTauriAppPlatform } from '../environment';

const API_URL = 'https://api.hardcover.app/v1/graphql';

// ---------- GraphQL Fragments ----------

const USER_BOOK_FRAGMENT = `
fragment UserBookParts on user_books {
  id
  book_id
  status_id
  edition_id
  privacy_setting_id
  rating
  user_book_reads(order_by: {id: asc}) {
    id
    started_at
    finished_at
    progress_pages
    edition_id
  }
}`;

// ---------- Client ----------

export class HardcoverClient {
  private token: string;
  private userId: number | null;

  constructor(config: HardcoverSettings) {
    this.token = config.apiToken;
    this.userId = config.userId;
  }

  // ── Low-level GraphQL request ──────────────────────────────────────

  private async graphql<T = Record<string, unknown>>(
    query: string,
    variables?: Record<string, unknown>,
  ): Promise<{ data?: T; errors?: Array<{ message: string; extensions?: { code?: string } }> }> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      authorization: `Bearer ${this.token}`,
      'User-Agent': 'Readest/1.0 (https://github.com/readest/readest)',
    };

    const body = JSON.stringify({ query, variables });

    const fetchFn = isTauriAppPlatform() ? tauriFetch : window.fetch;
    const response = await fetchFn(API_URL, {
      method: 'POST',
      headers,
      body,
    });

    if (!response.ok) {
      throw new Error(`Hardcover API error: ${response.status}`);
    }

    return response.json();
  }

  /** Check GraphQL response for errors and throw if found */
  private checkErrors<T>(result: {
    data?: T;
    errors?: Array<{ message: string }>;
  }): void {
    if (result.errors?.length) {
      const msg = result.errors.map((e) => e.message).join('; ');
      throw new Error(`Hardcover GraphQL error: ${msg}`);
    }
  }

  /** Check mutation-level error field (Hardcover returns `error` inside data) */
  private checkMutationError(error?: string | null): void {
    if (error) {
      throw new Error(`Hardcover mutation error: ${error}`);
    }
  }

  // ── Auth / User ────────────────────────────────────────────────────

  async getMe(): Promise<{ id: number; username: string } | null> {
    const result = await this.graphql<{
      me: Array<{ id: number; username: string }>;
    }>(`{ me { id, username } }`);

    if (result.errors) {
      const msg = result.errors[0]?.message || 'Unknown error';
      throw new Error(msg);
    }
    return result.data?.me?.[0] ?? null;
  }

  async validateToken(): Promise<{ valid: boolean; userId?: number; username?: string }> {
    try {
      const me = await this.getMe();
      if (me) {
        this.userId = me.id;
        return { valid: true, userId: me.id, username: me.username };
      }
      return { valid: false };
    } catch {
      return { valid: false };
    }
  }

  // ── Search ─────────────────────────────────────────────────────────

  async searchBooks(query: string): Promise<HardcoverBookResult[]> {
    const searchQuery = `
      query ($query: String!, $page: Int!) {
        search(query: $query, per_page: 15, page: $page, query_type: "Book") {
          ids
        }
      }`;

    const result = await this.graphql<{
      search: { ids: string[] };
    }>(searchQuery, { query, page: 1 });

    const ids = result.data?.search?.ids?.map(Number) ?? [];
    if (ids.length === 0) return [];

    return this.hydrateBooks(ids);
  }

  private async hydrateBooks(ids: number[]): Promise<HardcoverBookResult[]> {
    if (ids.length === 0) return [];

    const bookQuery = `
      query ($ids: [Int!], $userId: Int!) {
        books(where: { id: { _in: $ids }}) {
          book_id: id
          title
          release_year
          users_read_count
          pages
          contributions: cached_contributors
          cached_image
          user_books(where: { user_id: { _eq: $userId }}) {
            id
          }
        }
      }`;

    const result = await this.graphql<{
      books: HardcoverBookResult[];
    }>(bookQuery, { ids, userId: this.userId ?? 0 });

    return result.data?.books ?? [];
  }

  // ── User Book Status ───────────────────────────────────────────────

  async findUserBook(bookId: number): Promise<HardcoverUserBook | null> {
    const query = `
      query ($id: Int!, $userId: Int!) {
        user_books(where: { book_id: { _eq: $id }, user_id: { _eq: $userId }}) {
          ...UserBookParts
        }
      }
      ${USER_BOOK_FRAGMENT}`;

    const result = await this.graphql<{
      user_books: HardcoverUserBook[];
    }>(query, { id: bookId, userId: this.userId ?? 0 });

    return result.data?.user_books?.[0] ?? null;
  }

  async updateUserBook(
    bookId: number,
    statusId: HardcoverStatusId,
    privacySettingId?: number,
    editionId?: number,
  ): Promise<HardcoverUserBook | null> {
    // Get default privacy setting if not provided
    if (!privacySettingId) {
      const me = await this.getMe();
      privacySettingId = 1; // default to public
      if (me) {
        // Could fetch account_privacy_setting_id, but 1 (public) is a safe default
      }
    }

    const query = `
      mutation ($object: UserBookCreateInput!) {
        insert_user_book(object: $object) {
          error
          user_book {
            ...UserBookParts
          }
        }
      }
      ${USER_BOOK_FRAGMENT}`;

    const result = await this.graphql<{
      insert_user_book: { error?: string; user_book: HardcoverUserBook };
    }>(query, {
      object: {
        book_id: bookId,
        status_id: statusId,
        privacy_setting_id: privacySettingId,
        edition_id: editionId,
      },
    });

    this.checkErrors(result);
    this.checkMutationError(result.data?.insert_user_book?.error);
    return result.data?.insert_user_book?.user_book ?? null;
  }

  // ── Reading Progress ───────────────────────────────────────────────

  async updateProgress(
    userBookReadId: number,
    editionId: number | null,
    page: number,
    startedAt: string | null,
  ): Promise<HardcoverUserBook | null> {
    const query = `
      mutation UpdateBookProgress($id: Int!, $pages: Int, $editionId: Int, $startedAt: date) {
        update_user_book_read(id: $id, object: {
          progress_pages: $pages,
          edition_id: $editionId,
          started_at: $startedAt,
        }) {
          error
          user_book_read {
            id
            started_at
            finished_at
            edition_id
            progress_pages
            user_book {
              id
              book_id
              status_id
              edition_id
              privacy_setting_id
              rating
            }
          }
        }
      }`;

    const result = await this.graphql<{
      update_user_book_read: {
        error?: string;
        user_book_read: {
          user_book: HardcoverUserBook;
        };
      };
    }>(query, {
      id: userBookReadId,
      pages: page,
      editionId,
      startedAt,
    });

    this.checkErrors(result);
    this.checkMutationError(result.data?.update_user_book_read?.error);
    const ubr = result.data?.update_user_book_read?.user_book_read;
    if (ubr) {
      const userBook = ubr.user_book;
      userBook.user_book_reads = [ubr as unknown as HardcoverUserBook['user_book_reads'] extends (infer U)[] ? U : never];
      return userBook;
    }
    return null;
  }

  async createRead(
    userBookId: number,
    editionId: number | null,
    page: number | null,
    startedAt: string | null,
  ): Promise<HardcoverUserBook | null> {
    const query = `
      mutation InsertUserBookRead($id: Int!, $pages: Int, $editionId: Int, $startedAt: date) {
        insert_user_book_read(user_book_id: $id, user_book_read: {
          progress_pages: $pages,
          edition_id: $editionId,
          started_at: $startedAt,
        }) {
          error
          user_book_read {
            id
            started_at
            finished_at
            edition_id
            progress_pages
            user_book {
              id
              book_id
              status_id
              edition_id
              privacy_setting_id
              rating
            }
          }
        }
      }`;

    const result = await this.graphql<{
      insert_user_book_read: {
        error?: string;
        user_book_read: {
          user_book: HardcoverUserBook;
        };
      };
    }>(query, {
      id: userBookId,
      pages: page,
      editionId,
      startedAt,
    });

    this.checkErrors(result);
    this.checkMutationError(result.data?.insert_user_book_read?.error);
    const ubr = result.data?.insert_user_book_read?.user_book_read;
    if (ubr) {
      const userBook = ubr.user_book;
      return userBook;
    }
    return null;
  }

  // ── Rating ─────────────────────────────────────────────────────────

  async updateRating(
    userBookId: number,
    rating: number | null,
  ): Promise<HardcoverUserBook | null> {
    const query = `
      mutation ($id: Int!, $rating: numeric) {
        update_user_book(id: $id, object: { rating: $rating }) {
          error
          user_book {
            ...UserBookParts
          }
        }
      }
      ${USER_BOOK_FRAGMENT}`;

    const result = await this.graphql<{
      update_user_book: { error?: string; user_book: HardcoverUserBook };
    }>(query, {
      id: userBookId,
      rating: rating === 0 ? null : rating,
    });

    this.checkErrors(result);
    this.checkMutationError(result.data?.update_user_book?.error);
    return result.data?.update_user_book?.user_book ?? null;
  }

  // ── Highlights as Journal Entries ──────────────────────────────────

  async createJournalEntry(entry: {
    book_id: number;
    edition_id?: number;
    entry: string;
    event: string;
    privacy_setting_id?: number;
    tags?: string[];
  }): Promise<{ id: number } | null> {
    const query = `
      mutation InsertReadingJournalEntry($object: ReadingJournalCreateType!) {
        insert_reading_journal(object: $object) {
          reading_journal {
            id
          }
        }
      }`;

    const object = {
      ...entry,
      tags: entry.tags ?? [],
    };

    const result = await this.graphql<{
      insert_reading_journal: { reading_journal: { id: number } };
    }>(query, { object });

    this.checkErrors(result);
    return result.data?.insert_reading_journal?.reading_journal ?? null;
  }

  // ── Remove ─────────────────────────────────────────────────────────

  async removeUserBook(userBookId: number): Promise<boolean> {
    const query = `
      mutation($id: Int!) {
        delete_user_book(id: $id) {
          id
        }
      }`;

    const result = await this.graphql<{
      delete_user_book: { id: number };
    }>(query, { id: userBookId });

    this.checkErrors(result);
    return !!result.data?.delete_user_book?.id;
  }

  // ── Utility ────────────────────────────────────────────────────────

  /**
   * Maps a Readest reading progress percentage to a Hardcover page number
   */
  static progressToPage(
    progressCurrent: number,
    progressTotal: number,
    hardcoverPages: number,
  ): number {
    if (progressTotal <= 0 || hardcoverPages <= 0) return 0;
    return Math.round((progressCurrent / progressTotal) * hardcoverPages);
  }

  /**
   * Maps a Readest ReadingStatus to Hardcover status ID
   */
  static readingStatusToHardcover(
    status: 'unread' | 'reading' | 'finished' | undefined,
  ): HardcoverStatusId | null {
    switch (status) {
      case 'unread':
        return HardcoverStatusId.WantToRead;
      case 'reading':
        return HardcoverStatusId.Reading;
      case 'finished':
        return HardcoverStatusId.Finished;
      default:
        return null;
    }
  }

  /**
   * Maps a Hardcover status ID to Readest ReadingStatus
   */
  static hardcoverToReadingStatus(
    statusId: number | null,
  ): 'unread' | 'reading' | 'finished' | undefined {
    switch (statusId) {
      case HardcoverStatusId.WantToRead:
        return 'unread';
      case HardcoverStatusId.Reading:
        return 'reading';
      case HardcoverStatusId.Finished:
        return 'finished';
      default:
        return undefined;
    }
  }
}
