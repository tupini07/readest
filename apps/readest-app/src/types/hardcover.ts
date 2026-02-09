/**
 * Types for Hardcover.app integration
 * API docs: https://docs.hardcover.app/api/getting-started/
 */

/** Hardcover reading status IDs */
export enum HardcoverStatusId {
  WantToRead = 1,
  Reading = 2,
  Finished = 3,
  Paused = 4,
  DNF = 5,
}

/** Hardcover privacy setting IDs */
export enum HardcoverPrivacyId {
  Public = 1,
  Follows = 2,
  Private = 3,
}

/** Maps Readest ReadingStatus to Hardcover status IDs */
export type ReadingStatus = 'unread' | 'reading' | 'finished';

/** A linked Hardcover book stored per-book in settings */
export interface HardcoverBookLink {
  bookId: number;
  editionId?: number;
  title: string;
  pages?: number;
  /** IDs of highlights already synced to Hardcover (prevents duplicates) */
  syncedHighlightIds?: string[];
}

/** Represents a user_book record from Hardcover API */
export interface HardcoverUserBook {
  id: number;
  book_id: number;
  status_id: number | null;
  edition_id: number | null;
  privacy_setting_id: number | null;
  rating: number | null;
  user_book_reads?: HardcoverUserBookRead[];
}

/** Represents a user_book_read record from Hardcover API */
export interface HardcoverUserBookRead {
  id: number;
  started_at: string | null;
  finished_at: string | null;
  progress_pages: number | null;
  edition_id: number | null;
}

/** A book search result from Hardcover */
export interface HardcoverBookResult {
  book_id: number;
  title: string;
  release_year: number | null;
  pages: number | null;
  cached_image: string | null;
  contributions: { author?: { name: string } }[] | { author?: string };
  users_read_count: number | null;
  edition_id?: number;
}

/** Hardcover settings stored in system settings */
export interface HardcoverSettings {
  enabled: boolean;
  apiToken: string;
  userId: number | null;
  syncProgress: boolean;
  syncStatus: boolean;
  syncRating: boolean;
  syncHighlights: boolean;
  /** Map from book hash -> linked Hardcover book */
  linkedBooks: Record<string, HardcoverBookLink>;
}
