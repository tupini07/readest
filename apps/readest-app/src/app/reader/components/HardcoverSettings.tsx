import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { MdSearch, MdCheckCircle, MdLink, MdLinkOff } from 'react-icons/md';
import { useEnv } from '@/context/EnvContext';
import { useTranslation } from '@/hooks/useTranslation';
import { useSettingsStore } from '@/store/settingsStore';
import { useBookDataStore } from '@/store/bookDataStore';
import { useSidebarStore } from '@/store/sidebarStore';
import { eventDispatcher } from '@/utils/event';
import { HardcoverClient } from '@/services/sync/HardcoverClient';
import { HardcoverBookResult, HardcoverBookLink } from '@/types/hardcover';
import Dialog from '@/components/Dialog';

// ── Visibility controller (same pattern as KOSyncSettings) ──────────

export const setHardcoverSettingsWindowVisible = (visible: boolean) => {
  const dialog = document.getElementById('hardcover_settings_window');
  if (dialog) {
    const event = new CustomEvent('setHardcoverSettingsVisibility', {
      detail: { visible },
    });
    dialog.dispatchEvent(event);
  }
};

// ── Book Search Sub-dialog ──────────────────────────────────────────

interface BookSearchDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onSelect: (book: HardcoverBookLink) => void;
  client: HardcoverClient | null;
  initialQuery: string;
}

const BookSearchDialog: React.FC<BookSearchDialogProps> = ({
  isOpen,
  onClose,
  onSelect,
  client,
  initialQuery,
}) => {
  const _ = useTranslation();
  const [query, setQuery] = useState(initialQuery);
  const [results, setResults] = useState<HardcoverBookResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);

  useEffect(() => {
    if (isOpen && initialQuery) {
      handleSearch(initialQuery);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, initialQuery]);

  const handleSearch = async (searchQuery?: string) => {
    const q = searchQuery ?? query;
    if (!client || !q.trim()) return;
    setIsSearching(true);
    try {
      const books = await client.searchBooks(q.trim());
      setResults(books);
    } catch {
      setResults([]);
    }
    setIsSearching(false);
  };

  const handleSelectBook = (book: HardcoverBookResult) => {
    onSelect({
      bookId: book.book_id,
      editionId: book.edition_id,
      title: book.title,
      pages: book.pages ?? undefined,
    });
    onClose();
  };

  if (!isOpen) return null;

  return (
    <Dialog
      id='hardcover_book_search'
      isOpen={isOpen}
      onClose={onClose}
      title={_('Link to Hardcover Book')}
      boxClassName='sm:!min-w-[520px] sm:max-h-[80vh]'
    >
      <div className='flex flex-col gap-3 p-2 sm:p-4'>
        <div className='flex gap-2'>
          <input
            type='text'
            placeholder={_('Search for a book...')}
            className='input input-bordered h-10 flex-1 text-sm focus:outline-none focus:ring-0'
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
          />
          <button
            className='btn btn-primary btn-sm h-10 min-h-10'
            onClick={() => handleSearch()}
            disabled={isSearching || !query.trim()}
          >
            {isSearching ? (
              <span className='loading loading-spinner loading-sm' />
            ) : (
              <MdSearch size={18} />
            )}
          </button>
        </div>

        <div className='max-h-[50vh] overflow-y-auto'>
          {results.length === 0 && !isSearching && (
            <p className='text-base-content/50 py-4 text-center text-sm'>
              {_('Search for a book to link it with Hardcover')}
            </p>
          )}
          {results.map((book) => {
            const authors = Array.isArray(book.contributions)
              ? book.contributions
                  .map((c) => (typeof c.author === 'string' ? c.author : c.author?.name))
                  .filter(Boolean)
                  .join(', ')
              : typeof book.contributions === 'object' && 'author' in book.contributions
                ? String(book.contributions.author ?? '')
                : '';

            return (
              <button
                key={book.book_id}
                className='hover:bg-base-200 flex w-full items-start gap-3 rounded-lg p-2 text-left transition-colors'
                onClick={() => handleSelectBook(book)}
              >
                {book.cached_image && (
                  <img
                    src={book.cached_image}
                    alt={book.title}
                    className='h-16 w-11 flex-shrink-0 rounded object-cover shadow-sm'
                    onError={(e) => {
                      (e.target as HTMLImageElement).style.display = 'none';
                    }}
                  />
                )}
                <div className='min-w-0 flex-1'>
                  <p className='text-base-content text-sm font-medium leading-tight'>
                    {book.title}
                    {book.release_year && (
                      <span className='text-base-content/50 ml-1'>({book.release_year})</span>
                    )}
                  </p>
                  {authors && (
                    <p className='text-base-content/60 mt-0.5 truncate text-xs'>{authors}</p>
                  )}
                  <p className='text-base-content/40 mt-0.5 text-xs'>
                    {book.pages && `${book.pages} pages`}
                    {book.users_read_count ? ` · ${book.users_read_count} reads` : ''}
                  </p>
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </Dialog>
  );
};

// ── Main Settings Window ────────────────────────────────────────────

export const HardcoverSettingsWindow: React.FC = () => {
  const _ = useTranslation();
  const { settings, setSettings, saveSettings } = useSettingsStore();
  const { envConfig } = useEnv();
  const { sideBarBookKey } = useSidebarStore();
  const { getBookData } = useBookDataStore();

  const [isOpen, setIsOpen] = useState(false);
  const [apiToken, setApiToken] = useState(settings.hardcover.apiToken || '');
  const [isConnecting, setIsConnecting] = useState(false);
  const [showBookSearch, setShowBookSearch] = useState(false);

  const hardcover = settings.hardcover;
  const isConfigured = useMemo(
    () => !!hardcover.apiToken && hardcover.userId !== null,
    [hardcover.apiToken, hardcover.userId],
  );

  // Get current book info for linking
  const bookData = sideBarBookKey ? getBookData(sideBarBookKey) : null;
  const currentBook = bookData?.book;
  const currentLinkedBook = currentBook?.hash
    ? hardcover.linkedBooks[currentBook.hash] ?? null
    : null;

  const client = useMemo(
    () => (hardcover.apiToken ? new HardcoverClient(hardcover) : null),
    [hardcover],
  );

  // ── Visibility handling ──────────────────────────────────────────

  useEffect(() => {
    const handleCustomEvent = (event: CustomEvent) => {
      setIsOpen(event.detail.visible);
      if (event.detail.visible) {
        setApiToken(settings.hardcover.apiToken || '');
      }
    };
    const el = document.getElementById('hardcover_settings_window');
    el?.addEventListener('setHardcoverSettingsVisibility', handleCustomEvent as EventListener);
    return () => {
      el?.removeEventListener(
        'setHardcoverSettingsVisibility',
        handleCustomEvent as EventListener,
      );
    };
  }, [settings.hardcover.apiToken]);

  // ── Connect / Disconnect ─────────────────────────────────────────

  const handleConnect = async () => {
    if (!apiToken.trim()) return;
    setIsConnecting(true);

    const tempClient = new HardcoverClient({
      ...hardcover,
      apiToken: apiToken.trim(),
    });
    const validation = await tempClient.validateToken();

    if (validation.valid && validation.userId) {
      const newSettings = {
        ...settings,
        hardcover: {
          ...hardcover,
          apiToken: apiToken.trim(),
          userId: validation.userId,
          enabled: true,
        },
      };
      setSettings(newSettings);
      await saveSettings(envConfig, newSettings);
      eventDispatcher.dispatch('toast', {
        message: _('Connected to Hardcover as {{username}}', {
          username: validation.username || '',
        }),
        type: 'info',
      });
    } else {
      eventDispatcher.dispatch('toast', {
        message: _('Invalid Hardcover API token. Get yours from hardcover.app/account/api'),
        type: 'error',
      });
    }
    setIsConnecting(false);
  };

  const handleDisconnect = async () => {
    const newSettings = {
      ...settings,
      hardcover: {
        ...hardcover,
        apiToken: '',
        userId: null,
        enabled: false,
      },
    };
    setSettings(newSettings);
    await saveSettings(envConfig, newSettings);
    setApiToken('');
    eventDispatcher.dispatch('toast', { message: _('Disconnected from Hardcover'), type: 'info' });
  };

  // ── Toggle features ──────────────────────────────────────────────

  const toggleFeature = useCallback(
    async (
      feature: 'syncProgress' | 'syncStatus' | 'syncRating' | 'syncHighlights',
    ) => {
      const newSettings = {
        ...settings,
        hardcover: { ...hardcover, [feature]: !hardcover[feature] },
      };
      setSettings(newSettings);
      await saveSettings(envConfig, newSettings);
    },
    [settings, hardcover, setSettings, saveSettings, envConfig],
  );

  // ── Book linking ─────────────────────────────────────────────────

  const handleLinkBook = (link: HardcoverBookLink) => {
    if (!currentBook?.hash) return;
    const newLinkedBooks = { ...hardcover.linkedBooks, [currentBook.hash]: link };
    const newSettings = {
      ...settings,
      hardcover: { ...hardcover, linkedBooks: newLinkedBooks },
    };
    setSettings(newSettings);
    saveSettings(envConfig, newSettings);
    eventDispatcher.dispatch('toast', {
      message: _('Linked to: {{title}}', { title: link.title }),
      type: 'info',
    });
  };

  const handleUnlinkBook = () => {
    if (!currentBook?.hash) return;
    const newLinkedBooks = { ...hardcover.linkedBooks };
    delete newLinkedBooks[currentBook.hash];
    const newSettings = {
      ...settings,
      hardcover: { ...hardcover, linkedBooks: newLinkedBooks },
    };
    setSettings(newSettings);
    saveSettings(envConfig, newSettings);
    eventDispatcher.dispatch('toast', {
      message: _('Book unlinked from Hardcover'),
      type: 'info',
    });
  };

  const searchQuery = currentBook
    ? `${currentBook.title} ${currentBook.author}`.trim()
    : '';

  return (
    <>
      <Dialog
        id='hardcover_settings_window'
        isOpen={isOpen}
        onClose={() => setIsOpen(false)}
        title={_('Hardcover Sync')}
        boxClassName='sm:!min-w-[520px] sm:h-auto'
      >
        {isOpen && (
          <div className='mb-4 mt-0 flex flex-col gap-4 p-2 sm:p-4'>
            {isConfigured ? (
              <>
                {/* Connected state */}
                <div className='flex items-center justify-between'>
                  <div className='flex items-center gap-2'>
                    <MdCheckCircle className='text-success' size={20} />
                    <span className='text-base-content/80 text-sm'>
                      {_('Connected to Hardcover')}
                    </span>
                  </div>
                  <button
                    className='btn btn-ghost btn-sm text-error'
                    onClick={handleDisconnect}
                  >
                    {_('Disconnect')}
                  </button>
                </div>

                <hr className='border-base-200' />

                {/* Sync feature toggles */}
                <div className='space-y-3'>
                  <h3 className='text-base-content text-sm font-medium'>{_('Sync Options')}</h3>
                  {([
                    ['syncProgress', _('Sync Reading Progress')],
                    ['syncStatus', _('Sync Reading Status')],
                    ['syncRating', _('Sync Rating')],
                    ['syncHighlights', _('Sync Highlights as Quotes')],
                  ] as const).map(([key, label]) => (
                    <div key={key} className='flex h-10 items-center justify-between'>
                      <span className='text-base-content/80 text-sm'>{label}</span>
                      <input
                        type='checkbox'
                        className='toggle toggle-sm'
                        checked={hardcover[key]}
                        onChange={() => toggleFeature(key)}
                      />
                    </div>
                  ))}
                </div>

                <hr className='border-base-200' />

                {/* Book linking section */}
                {currentBook && (
                  <div className='space-y-3'>
                    <h3 className='text-base-content text-sm font-medium'>
                      {_('Current Book')}
                    </h3>
                    <p className='text-base-content/60 truncate text-xs'>
                      {currentBook.title}
                    </p>

                    {currentLinkedBook ? (
                      <div className='bg-base-200/50 flex items-center justify-between rounded-lg p-3'>
                        <div className='flex items-center gap-2'>
                          <MdLink className='text-primary' size={18} />
                          <div>
                            <p className='text-sm font-medium'>{currentLinkedBook.title}</p>
                            {currentLinkedBook.pages && (
                              <p className='text-base-content/50 text-xs'>
                                {currentLinkedBook.pages} {_('pages')}
                              </p>
                            )}
                          </div>
                        </div>
                        <button
                          className='btn btn-ghost btn-sm'
                          onClick={handleUnlinkBook}
                          title={_('Unlink book')}
                        >
                          <MdLinkOff size={16} />
                        </button>
                      </div>
                    ) : (
                      <button
                        className='btn btn-outline btn-sm w-full'
                        onClick={() => setShowBookSearch(true)}
                      >
                        <MdSearch size={16} />
                        {_('Link to Hardcover Book')}
                      </button>
                    )}
                  </div>
                )}
              </>
            ) : (
              <>
                {/* Not connected state */}
                <p className='text-base-content/70 text-center text-sm'>
                  {_('Connect your Hardcover account to sync reading progress, status, and highlights.')}
                </p>
                <p className='text-base-content/50 text-center text-xs'>
                  {_('Get your API token from')}{' '}
                  <a
                    href='https://hardcover.app/account/api'
                    target='_blank'
                    rel='noopener noreferrer'
                    className='link link-primary'
                  >
                    hardcover.app/account/api
                  </a>
                </p>

                <div className='form-control w-full'>
                  <label className='label py-1'>
                    <span className='label-text font-medium'>{_('API Token')}</span>
                  </label>
                  <input
                    type='password'
                    placeholder={_('Paste your Hardcover API token')}
                    className='input input-bordered h-12 w-full text-sm focus:outline-none focus:ring-0'
                    value={apiToken}
                    onChange={(e) => setApiToken(e.target.value)}
                  />
                </div>

                <button
                  className='btn btn-primary mt-2 h-12 min-h-12 w-full'
                  onClick={handleConnect}
                  disabled={isConnecting || !apiToken.trim()}
                >
                  {isConnecting ? (
                    <span className='loading loading-spinner' />
                  ) : (
                    _('Connect')
                  )}
                </button>
              </>
            )}
          </div>
        )}
      </Dialog>

      {/* Book search dialog */}
      <BookSearchDialog
        isOpen={showBookSearch}
        onClose={() => setShowBookSearch(false)}
        onSelect={handleLinkBook}
        client={client}
        initialQuery={searchQuery}
      />
    </>
  );
};
