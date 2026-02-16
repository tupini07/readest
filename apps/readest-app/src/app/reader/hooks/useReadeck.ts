import { useEffect, useRef, useMemo } from 'react';
import { useEnv } from '@/context/EnvContext';
import { useSettingsStore } from '@/store/settingsStore';
import { useReaderStore } from '@/store/readerStore';
import { useBookDataStore } from '@/store/bookDataStore';
import { ReadeckClient } from '@/services/sync/ReadeckClient';
import { debounce } from '@/utils/debounce';
import { eventDispatcher } from '@/utils/event';

export const useReadeck = (bookKey: string) => {
  const { appService } = useEnv();
  const { settings } = useSettingsStore();
  const { getProgress } = useReaderStore();
  const { getBookData } = useBookDataStore();

  const readeckClient = useRef<ReadeckClient | null>(null);
  const hasPushedOnce = useRef(false);
  const lastSyncedPercent = useRef<number | null>(null);

  const progress = getProgress(bookKey);

  // Initialize client when settings change
  useEffect(() => {
    const { readeck } = settings;
    if (!readeck?.enabled || !readeck.apiToken || !readeck.serverUrl) {
      readeckClient.current = null;
      return;
    }
    readeckClient.current = new ReadeckClient(readeck);
  }, [settings]);

  const pushProgress = useMemo(
    () =>
      debounce(async () => {
        const client = readeckClient.current;
        if (!bookKey || !appService || !client) return;

        const { settings } = useSettingsStore.getState();
        if (!settings.readeck?.enabled) return;

        const bookData = getBookData(bookKey);
        const book = bookData?.book;
        if (!book?.readeckId) return;

        const progress = useReaderStore.getState().getProgress(bookKey);
        if (!progress?.pageinfo) return;

        const currentPage = progress.pageinfo.current ?? 0;
        const totalPages = progress.pageinfo.total ?? 1;
        const percent = Math.round(((currentPage + 1) / totalPages) * 100);

        // Only sync if progress changed by >= 2% since last sync
        if (lastSyncedPercent.current !== null) {
          const delta = Math.abs(percent - lastSyncedPercent.current);
          if (delta < 2) return;
        }

        const success = await client.updateProgress(book.readeckId, percent);
        if (success) {
          lastSyncedPercent.current = percent;
          hasPushedOnce.current = true;

          // Auto-archive when finished reading
          if (percent >= 100 && settings.readeck.autoArchive) {
            await client.archiveBookmark(book.readeckId);
          }
        }
      }, 5000),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [bookKey, appService],
  );

  // Push progress on change
  useEffect(() => {
    if (!progress || !readeckClient.current) return;

    const bookData = getBookData(bookKey);
    if (!bookData?.book?.readeckId) return;
    if (!settings.readeck?.enabled) return;

    pushProgress();
  }, [progress, bookKey, getBookData, settings.readeck?.enabled, pushProgress]);

  // Event listeners
  useEffect(() => {
    const handlePushProgress = (event: CustomEvent) => {
      if (event.detail.bookKey !== bookKey) return;
      pushProgress();
      pushProgress.flush();
    };
    const handleFlush = (event: CustomEvent) => {
      if (event.detail.bookKey !== bookKey) return;
      pushProgress.flush();
    };
    eventDispatcher.on('push-readeck', handlePushProgress);
    eventDispatcher.on('flush-readeck', handleFlush);
    return () => {
      eventDispatcher.off('push-readeck', handlePushProgress);
      eventDispatcher.off('flush-readeck', handleFlush);
      pushProgress.flush();
    };
  }, [bookKey, pushProgress]);
};
