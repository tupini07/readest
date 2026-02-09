import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useEnv } from '@/context/EnvContext';
import { useSettingsStore } from '@/store/settingsStore';
import { useReaderStore } from '@/store/readerStore';
import { useBookDataStore } from '@/store/bookDataStore';
import { useLibraryStore } from '@/store/libraryStore';
import { useTranslation } from '@/hooks/useTranslation';
import { HardcoverClient } from '@/services/sync/HardcoverClient';
import {
  HardcoverBookLink,
  HardcoverStatusId,
  HardcoverUserBook,
} from '@/types/hardcover';
import { BookNote } from '@/types/book';
import { debounce } from '@/utils/debounce';
import { eventDispatcher } from '@/utils/event';

type HardcoverSyncState = 'idle' | 'syncing' | 'synced' | 'error';

/** Module-level cache so ViewMenu can read current state on mount */
const hardcoverStateCache = new Map<
  string,
  { rating: number | null; statusId: number | null }
>();

/** Read the last known Hardcover state for a book (used by ViewMenu) */
export function getHardcoverCachedState(bookKey: string) {
  return hardcoverStateCache.get(bookKey) ?? { rating: null, statusId: null };
}

export const useHardcover = (bookKey: string) => {
  const _ = useTranslation();
  const { appService } = useEnv();
  const { envConfig } = useEnv();
  const { settings, setSettings, saveSettings } = useSettingsStore();
  const { getProgress } = useReaderStore();
  const { getBookData } = useBookDataStore();

  const [client, setClient] = useState<HardcoverClient | null>(null);
  const [syncState, setSyncState] = useState<HardcoverSyncState>('idle');
  const [userBook, setUserBook] = useState<HardcoverUserBook | null>(null);
  const userBookRef = useRef<HardcoverUserBook | null>(null);
  const hasSyncedOnce = useRef(false);
  const lastSyncedPercent = useRef<number | null>(null);
  const forceProgressSync = useRef(false);

  // Keep ref in sync so debounced callbacks can read latest value
  useEffect(() => {
    userBookRef.current = userBook;
  }, [userBook]);

  const progress = getProgress(bookKey);
  const bookData = getBookData(bookKey);
  const currentBook = bookData?.book;
  const hardcoverSettings = settings.hardcover;

  // Get the linked book for the current book hash
  const linkedBook: HardcoverBookLink | null = useMemo(() => {
    if (!currentBook?.hash) return null;
    return hardcoverSettings.linkedBooks[currentBook.hash] ?? null;
  }, [currentBook?.hash, hardcoverSettings.linkedBooks]);

  // Initialize synced highlight IDs from persisted settings
  const lastSyncedHighlightIds = useRef<Set<string>>(
    new Set(linkedBook?.syncedHighlightIds ?? []),
  );

  // Initialize client when settings change
  useEffect(() => {
    if (!hardcoverSettings.enabled || !hardcoverSettings.apiToken) {
      setClient(null);
      return;
    }
    setClient(new HardcoverClient(hardcoverSettings));
  }, [hardcoverSettings]);

  // ── Link / Unlink book ─────────────────────────────────────────────

  const linkBook = useCallback(
    async (link: HardcoverBookLink) => {
      if (!currentBook?.hash) return;
      const newLinkedBooks = {
        ...hardcoverSettings.linkedBooks,
        [currentBook.hash]: link,
      };
      const newSettings = {
        ...settings,
        hardcover: { ...hardcoverSettings, linkedBooks: newLinkedBooks },
      };
      setSettings(newSettings);
      await saveSettings(envConfig, newSettings);
      eventDispatcher.dispatch('toast', {
        message: _('Linked to Hardcover: {{title}}', { title: link.title }),
        type: 'info',
      });
    },
    [currentBook?.hash, hardcoverSettings, settings, setSettings, saveSettings, envConfig, _],
  );

  const unlinkBook = useCallback(async () => {
    if (!currentBook?.hash) return;
    const newLinkedBooks = { ...hardcoverSettings.linkedBooks };
    delete newLinkedBooks[currentBook.hash];
    const newSettings = {
      ...settings,
      hardcover: { ...hardcoverSettings, linkedBooks: newLinkedBooks },
    };
    setSettings(newSettings);
    await saveSettings(envConfig, newSettings);
    setUserBook(null);
    hasSyncedOnce.current = false;
  }, [currentBook?.hash, hardcoverSettings, settings, setSettings, saveSettings, envConfig]);

  // ── Fetch user book state from Hardcover ───────────────────────────

  const fetchUserBook = useCallback(async () => {
    if (!client || !linkedBook) return null;
    try {
      const ub = await client.findUserBook(linkedBook.bookId);
      setUserBook(ub);
      return ub;
    } catch (e) {
      console.error('Hardcover: Failed to fetch user book', e);
      return null;
    }
  }, [client, linkedBook]);

  // ── Sync Progress ──────────────────────────────────────────────────

  const syncProgress = useMemo(
    () =>
      debounce(async () => {
        if (!client || !linkedBook || !hardcoverSettings.syncProgress) return;
        if (!hasSyncedOnce.current) return;

        const bookData = getBookData(bookKey);
        const book = bookData?.book;
        const progress = useReaderStore.getState().getProgress(bookKey);

        if (!book || !progress?.pageinfo) return;

        const currentPage = progress.pageinfo.current ?? 0;
        const totalPages = progress.pageinfo.total ?? 1;
        const hardcoverPages = linkedBook.pages ?? totalPages;

        const currentPercent = ((currentPage + 1) / totalPages) * 100;

        // Only sync if progress changed by >= 5% since last sync (or forced)
        if (!forceProgressSync.current && lastSyncedPercent.current !== null) {
          const delta = Math.abs(currentPercent - lastSyncedPercent.current);
          if (delta < 5) return;
        }
        forceProgressSync.current = false;

        const mappedPage = HardcoverClient.progressToPage(
          currentPage + 1,
          totalPages,
          hardcoverPages,
        );

        if (mappedPage <= 0) return;

        try {
          // Use ref to get latest userBook (useMemo closure would be stale)
          let ub = userBookRef.current;
          if (!ub) {
            ub = await fetchUserBook();
          }

          // If no user book entry exists, create one with "Currently Reading" status
          if (!ub) {
            ub = await client.updateUserBook(
              linkedBook.bookId,
              HardcoverStatusId.Reading,
              undefined,
              linkedBook.editionId,
            );
            if (ub) setUserBook(ub);
          }

          if (!ub) return;

          const reads = ub.user_book_reads;
          const currentRead = reads?.[reads.length - 1];

          if (currentRead) {
            const result = await client.updateProgress(
              currentRead.id,
              currentRead.edition_id,
              mappedPage,
              currentRead.started_at,
            );
            if (result) {
              setUserBook(result);
              lastSyncedPercent.current = currentPercent;
            }
          } else {
            const today = new Date().toISOString().slice(0, 10);
            const result = await client.createRead(
              ub.id,
              linkedBook.editionId ?? null,
              mappedPage,
              today,
            );
            if (result) {
              setUserBook(result);
              lastSyncedPercent.current = currentPercent;
            }
          }
        } catch (e) {
          console.error('Hardcover: Failed to sync progress', e);
        }
      }, 10000), // Debounce 10s to respect API rate limits (60 req/min)
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [bookKey, client, linkedBook, hardcoverSettings.syncProgress],
  );

  // ── Sync Status ────────────────────────────────────────────────────

  const syncStatus = useCallback(
    async (statusId?: HardcoverStatusId) => {
      if (!client || !linkedBook || !hardcoverSettings.syncStatus) return;

      // If no explicit statusId, derive from the library store's readingStatus
      let hardcoverStatus = statusId ?? null;
      if (hardcoverStatus === null) {
        const { library } = useLibraryStore.getState();
        const bookHash = getBookData(bookKey)?.book?.hash;
        const libraryBook = bookHash ? library.find((b) => b.hash === bookHash) : null;
        const readingStatus = libraryBook?.readingStatus;
        hardcoverStatus = HardcoverClient.readingStatusToHardcover(readingStatus);
      }
      if (hardcoverStatus === null) return;

      try {
        const result = await client.updateUserBook(
          linkedBook.bookId,
          hardcoverStatus,
          undefined,
          linkedBook.editionId,
        );
        if (result) {
          setUserBook(result);
          eventDispatcher.dispatch('toast', {
            message: _('Hardcover status updated'),
            type: 'info',
          });
        }
      } catch (e) {
        console.error('Hardcover: Failed to sync status', e);
        eventDispatcher.dispatch('toast', {
          message: _('Failed to sync status to Hardcover'),
          type: 'error',
        });
      }
    },
    [client, linkedBook, hardcoverSettings.syncStatus, bookKey, getBookData, _],
  );

  // ── Sync Rating ────────────────────────────────────────────────────

  const syncRating = useCallback(
    async (rating: number | undefined) => {
      if (!client || !linkedBook || !hardcoverSettings.syncRating) return;
      if (rating === undefined) return;

      const ub = userBook ?? (await fetchUserBook());
      if (!ub) return;

      try {
        const result = await client.updateRating(ub.id, rating);
        if (result) {
          setUserBook(result);
          eventDispatcher.dispatch('toast', {
            message: rating > 0
              ? _('Hardcover rating set to {{rating}}', { rating })
              : _('Hardcover rating cleared'),
            type: 'info',
          });
        }
      } catch (e) {
        console.error('Hardcover: Failed to sync rating', e);
        eventDispatcher.dispatch('toast', {
          message: _('Failed to sync rating to Hardcover'),
          type: 'error',
        });
      }
    },
    [client, linkedBook, hardcoverSettings.syncRating, userBook, fetchUserBook, _],
  );

  // ── Sync Highlights as Journal Entries ─────────────────────────────

  /** Persist synced highlight IDs to settings so they survive across sessions */
  const persistSyncedHighlightIds = useCallback(async () => {
    if (!currentBook?.hash) return;
    const ids = Array.from(lastSyncedHighlightIds.current);
    const existingLink = hardcoverSettings.linkedBooks[currentBook.hash];
    if (!existingLink) return;

    const newLinkedBooks = {
      ...hardcoverSettings.linkedBooks,
      [currentBook.hash]: { ...existingLink, syncedHighlightIds: ids },
    };
    const newSettings = {
      ...settings,
      hardcover: { ...hardcoverSettings, linkedBooks: newLinkedBooks },
    };
    setSettings(newSettings);
    await saveSettings(envConfig, newSettings);
  }, [currentBook?.hash, hardcoverSettings, settings, setSettings, saveSettings, envConfig]);

  const syncHighlights = useCallback(
    async (notes: BookNote[]) => {
      if (!client || !linkedBook || !hardcoverSettings.syncHighlights) return;

      // Only sync annotations (highlights with text)
      const newHighlights = notes.filter(
        (note) =>
          note.type === 'annotation' &&
          note.text &&
          !note.deletedAt &&
          !lastSyncedHighlightIds.current.has(note.id),
      );

      if (newHighlights.length === 0) {
        eventDispatcher.dispatch('toast', {
          message: _('No new highlights to sync'),
          type: 'info',
        });
        return;
      }

      let successCount = 0;
      try {
        for (const highlight of newHighlights) {
          const entry = highlight.note
            ? `> ${highlight.text}\n\n${highlight.note}`
            : `> ${highlight.text}`;

          const result = await client.createJournalEntry({
            book_id: linkedBook.bookId,
            edition_id: linkedBook.editionId,
            entry,
            event: 'quote',
            privacy_setting_id: 1, // Public by default
          });
          if (result) {
            lastSyncedHighlightIds.current.add(highlight.id);
            successCount++;
          }
        }

        // Persist synced IDs so we don't create duplicates on next session
        await persistSyncedHighlightIds();

        if (successCount > 0) {
          eventDispatcher.dispatch('toast', {
            message: _('{{count}} highlight(s) synced to Hardcover', {
              count: successCount,
            }),
            type: 'info',
          });
        }
        if (successCount < newHighlights.length) {
          eventDispatcher.dispatch('toast', {
            message: _('{{count}} highlight(s) failed to sync', {
              count: newHighlights.length - successCount,
            }),
            type: 'error',
          });
        }
      } catch (e) {
        console.error('Hardcover: Failed to sync highlights', e);
        eventDispatcher.dispatch('toast', {
          message: _('Failed to sync highlights to Hardcover'),
          type: 'error',
        });
      }
    },
    [client, linkedBook, hardcoverSettings.syncHighlights, _, persistSyncedHighlightIds],
  );

  // ── Initial pull when book opens ───────────────────────────────────

  useEffect(() => {
    if (!appService || !client || !linkedBook || !progress?.location) return;
    if (hasSyncedOnce.current) return;

    hasSyncedOnce.current = true;
    setSyncState('syncing');

    fetchUserBook()
      .then(() => setSyncState('synced'))
      .catch(() => setSyncState('error'));
  }, [appService, client, linkedBook, progress?.location, fetchUserBook]);

  // ── Notify ViewMenu of userBook changes (e.g. rating, status) ───────

  useEffect(() => {
    if (!userBook) return;
    const state = { rating: userBook.rating, statusId: userBook.status_id };
    hardcoverStateCache.set(bookKey, state);
    eventDispatcher.dispatch('hardcover-userbook-updated', {
      bookKey,
      rating: userBook.rating,
      statusId: userBook.status_id,
    });
  }, [userBook, bookKey]);

  // ── Auto-push progress ─────────────────────────────────────────────

  useEffect(() => {
    if (syncState !== 'synced' || !progress || !linkedBook) return;
    if (!hardcoverSettings.syncProgress) return;

    syncProgress();
  }, [progress, syncState, linkedBook, hardcoverSettings.syncProgress, syncProgress]);

  // ── Event listeners ────────────────────────────────────────────────

  useEffect(() => {
    const handleSyncStatus = (event: CustomEvent) => {
      if (event.detail.bookKey !== bookKey) return;
      // Support explicit statusId from ViewMenu, or derive from library store
      syncStatus(event.detail.statusId as HardcoverStatusId | undefined);
    };

    const handleSyncRating = (event: CustomEvent) => {
      if (event.detail.bookKey !== bookKey) return;
      syncRating(event.detail.rating);
    };

    const handleSyncHighlights = (event: CustomEvent) => {
      if (event.detail.bookKey !== bookKey) return;
      const bookData = getBookData(bookKey);
      const notes = bookData?.config?.booknotes ?? [];
      syncHighlights(notes);
    };

    const handleSyncProgress = (event: CustomEvent) => {
      if (event.detail.bookKey !== bookKey) return;
      // Force sync (bypass 5% threshold) for manual trigger
      forceProgressSync.current = true;
      syncProgress();
      syncProgress.flush();
      // Toast will come from the sync result or error
      eventDispatcher.dispatch('toast', {
        message: _('Syncing progress to Hardcover…'),
        type: 'info',
      });
    };

    eventDispatcher.on('hardcover-sync-status', handleSyncStatus);
    eventDispatcher.on('hardcover-sync-rating', handleSyncRating);
    eventDispatcher.on('hardcover-sync-highlights', handleSyncHighlights);
    eventDispatcher.on('hardcover-sync-progress', handleSyncProgress);

    return () => {
      eventDispatcher.off('hardcover-sync-status', handleSyncStatus);
      eventDispatcher.off('hardcover-sync-rating', handleSyncRating);
      eventDispatcher.off('hardcover-sync-highlights', handleSyncHighlights);
      eventDispatcher.off('hardcover-sync-progress', handleSyncProgress);
      syncProgress.flush();
    };
  }, [bookKey, syncStatus, syncRating, syncHighlights, syncProgress, getBookData, _]);

  // ── Search books on Hardcover ──────────────────────────────────────

  const searchBooks = useCallback(
    async (query: string) => {
      if (!client) return [];
      try {
        return await client.searchBooks(query);
      } catch (e) {
        console.error('Hardcover: Search failed', e);
        return [];
      }
    },
    [client],
  );

  return {
    syncState,
    userBook,
    linkedBook,
    linkBook,
    unlinkBook,
    searchBooks,
    fetchUserBook,
    syncStatus,
    syncRating,
    syncProgress,
    syncHighlights,
    isEnabled: hardcoverSettings.enabled && !!client,
    isLinked: !!linkedBook,
  };
};
