import { useEffect, useRef, useCallback } from 'react';
import { useEnv } from '@/context/EnvContext';
import { useSettingsStore } from '@/store/settingsStore';
import { useLibraryStore } from '@/store/libraryStore';
import { useTranslation } from '@/hooks/useTranslation';
import { ReadeckClient } from '@/services/sync/ReadeckClient';
import { eventDispatcher } from '@/utils/event';

export const useReadeckLibrary = () => {
  const _ = useTranslation();
  const { appService, envConfig } = useEnv();
  const { settings } = useSettingsStore();
  const { library } = useLibraryStore();
  const isSyncing = useRef(false);
  const lastSyncTimestamp = useRef(0);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const syncArticles = useCallback(async () => {
    if (!appService || isSyncing.current) return;
    const { readeck } = settings;
    if (!readeck?.enabled || !readeck.apiToken || !readeck.serverUrl) return;

    isSyncing.current = true;
    try {
      const client = new ReadeckClient(readeck);
      const response = await client.listBookmarks({ archived: false, limit: 50 });

      const existingReadeckIds = new Set(
        library.filter((b) => b.readeckId).map((b) => b.readeckId),
      );

      let importedCount = 0;
      for (const bookmark of response.items) {
        if (existingReadeckIds.has(bookmark.id)) continue;
        if (!bookmark.has_article) continue;

        try {
          const epubData = await client.getBookmarkEpub(bookmark.id);
          const blob = new Blob([epubData], { type: 'application/epub+zip' });
          const filename = `${bookmark.title.replace(/[/\\:*?"<>|]/g, '_')}.epub`;
          const file = new File([blob], filename, { type: 'application/epub+zip' });

          const { library: currentLibrary } = useLibraryStore.getState();
          const book = await appService.importBook(file, currentLibrary);
          if (book) {
            book.readeckId = bookmark.id;
            book.groupName = 'Readeck';
            book.author = bookmark.authors?.join(', ') || bookmark.site_name || '';
            useLibraryStore.getState().updateBook(envConfig, book);
            importedCount++;
          }
        } catch (e) {
          console.error(`Readeck: Failed to import "${bookmark.title}"`, e);
        }
      }

      lastSyncTimestamp.current = Date.now();

      if (importedCount > 0) {
        eventDispatcher.dispatch('toast', {
          message: _('Imported {{count}} article(s) from Readeck', { count: importedCount }),
          type: 'info',
        });
      }
    } catch (e) {
      console.error('Readeck: Library sync failed', e);
    } finally {
      isSyncing.current = false;
    }
  }, [appService, envConfig, settings, library, _]);

  // Sync on mount and periodically
  useEffect(() => {
    const { readeck } = settings;
    if (!readeck?.enabled || !readeck.apiToken || !readeck.serverUrl) return;
    if (!appService) return;

    // Initial sync after a short delay
    const initialTimer = setTimeout(() => {
      syncArticles();
    }, 3000);

    // Periodic sync
    const intervalMs = (readeck.syncIntervalMinutes || 30) * 60 * 1000;
    intervalRef.current = setInterval(() => {
      syncArticles();
    }, intervalMs);

    return () => {
      clearTimeout(initialTimer);
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appService, settings.readeck?.enabled, settings.readeck?.syncIntervalMinutes]);
};
