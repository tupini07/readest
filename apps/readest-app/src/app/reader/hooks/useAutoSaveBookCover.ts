import { useCallback, useEffect } from 'react';
import { useEnv } from '@/context/EnvContext';
import { useTranslation } from '@/hooks/useTranslation';
import { useBookDataStore } from '@/store/bookDataStore';
import { useSettingsStore } from '@/store/settingsStore';
import { throttle } from '@/utils/throttle';
import { getCoverFilename } from '@/utils/book';
import { eventDispatcher } from '@/utils/event';
import { AppService } from '@/types/system';

async function createScreenSizedCover(
  appService: AppService,
  coverFilename: string,
): Promise<ArrayBuffer> {
  const coverData = (await appService.readFile(coverFilename, 'Books', 'binary')) as ArrayBuffer;
  const blob = new Blob([coverData]);
  const imageBitmap = await createImageBitmap(blob);

  const screenWidth = screen.width;
  const screenHeight = screen.height;

  const scale = screenWidth / imageBitmap.width;
  const scaledWidth = screenWidth;
  const scaledHeight = imageBitmap.height * scale;

  const canvas = new OffscreenCanvas(screenWidth, screenHeight);
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    imageBitmap.close();
    throw new Error('Failed to create 2D rendering context for cover image');
  }

  const y = (screenHeight - scaledHeight) / 2;
  ctx.drawImage(imageBitmap, 0, y, scaledWidth, scaledHeight);
  imageBitmap.close();

  const outputBlob = await canvas.convertToBlob({ type: 'image/png' });
  return await outputBlob.arrayBuffer();
}

export const useBookCoverAutoSave = (bookKey: string) => {
  const _ = useTranslation();
  const { envConfig, appService } = useEnv();

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const saveBookCover = useCallback(
    throttle(
      () => {
        setTimeout(async () => {
          const settings = useSettingsStore.getState().settings;
          const bookData = useBookDataStore.getState().getBookData(bookKey);
          const book = bookData?.book;
          const savedBookHash = settings.savedBookCoverForLockScreen;
          const savedCoverPath = settings.savedBookCoverForLockScreenPath;
          if (appService && book && savedBookHash && savedBookHash !== book?.hash) {
            try {
              const coverImageData = await createScreenSizedCover(
                appService,
                getCoverFilename(book),
              );
              const lastCoverFilename = 'last_book_cover.png';
              const builtinImagesPath = await appService.resolveFilePath('', 'Images');
              if (!savedCoverPath || savedCoverPath === builtinImagesPath) {
                await appService.writeFile(lastCoverFilename, 'Images', coverImageData);
              } else {
                await appService.writeFile(
                  `${savedCoverPath}/${lastCoverFilename}`,
                  'None',
                  coverImageData,
                );
              }
              settings.savedBookCoverForLockScreen = book.hash;
              useSettingsStore.getState().setSettings(settings);
              useSettingsStore.getState().saveSettings(envConfig, settings);
            } catch (error) {
              eventDispatcher.dispatch('toast', {
                type: 'error',
                message: _('Failed to auto-save book cover for lock screen: {{error}}', {
                  error: error instanceof Error ? error.message : String(error),
                }),
              });
            }
          }
        }, 5000);
      },
      5000,
      { emitLast: false },
    ),
    [],
  );

  useEffect(() => {
    saveBookCover();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
};
