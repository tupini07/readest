import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  MdDelete,
  MdExpandMore,
  MdExpandLess,
  MdSchool,
  MdSync,
  MdFileDownload,
  MdFileUpload,
} from 'react-icons/md';
import { useTranslation } from '@/hooks/useTranslation';
import { useVocabularyStore } from '@/store/vocabularyStore';
import { VocabEntry } from '@/types/vocabulary';
import Dialog from '@/components/Dialog';

// ── Visibility controller (same pattern as ReadeckSettings) ──────────

export const setVocabularyScreenVisible = (visible: boolean) => {
  const dialog = document.getElementById('vocabulary_screen_window');
  if (dialog) {
    const event = new CustomEvent('setVocabularyScreenVisibility', {
      detail: { visible },
    });
    dialog.dispatchEvent(event);
  }
};

// ── Review Screen (Flashcard) ────────────────────────────────────────

const ReviewScreen: React.FC<{
  language: string;
  onClose: () => void;
}> = ({ language, onClose }) => {
  const _ = useTranslation();
  const { getDueEntries, recordReview } = useVocabularyStore();
  const [dueCards, setDueCards] = useState<VocabEntry[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [revealed, setRevealed] = useState(false);

  useEffect(() => {
    const due = getDueEntries().filter((e) => e.language === language);
    setDueCards(due);
    setCurrentIndex(0);
    setRevealed(false);
  }, [language, getDueEntries]);

  const currentCard = dueCards[currentIndex];

  const handleRate = (quality: 0 | 1 | 2 | 3 | 4 | 5) => {
    if (!currentCard) return;
    recordReview(currentCard.id, quality);
    setRevealed(false);
    if (currentIndex + 1 < dueCards.length) {
      setCurrentIndex(currentIndex + 1);
    } else {
      setDueCards([]);
    }
  };

  if (!currentCard || dueCards.length === 0) {
    return (
      <div className='flex flex-col items-center justify-center gap-4 py-12'>
        <MdSchool size={48} className='text-success' />
        <p className='text-lg font-medium'>{_('All caught up!')}</p>
        <p className='text-base-content/60 text-sm'>
          {_('No more cards to review for this language.')}
        </p>
        <button className='btn btn-ghost btn-sm' onClick={onClose}>
          {_('Back')}
        </button>
      </div>
    );
  }

  const remaining = dueCards.length - currentIndex;

  return (
    <div className='flex flex-col items-center gap-6 py-4'>
      <p className='text-base-content/60 text-sm'>
        {_('{{count}} cards remaining', { count: remaining })}
      </p>

      <div
        className='bg-base-200 flex min-h-[200px] w-full max-w-md cursor-pointer flex-col items-center justify-center rounded-xl p-6'
        onClick={() => setRevealed(true)}
        role='button'
        tabIndex={0}
        onKeyDown={(e) => e.key === 'Enter' && setRevealed(true)}
      >
        <p className='text-2xl font-bold'>{currentCard.word}</p>
        <p className='text-base-content/60 mt-1 text-sm italic'>{currentCard.language}</p>

        {revealed ? (
          <div className='mt-4 w-full border-t pt-4'>
            <div
              className='prose prose-sm max-h-40 overflow-y-auto text-sm'
              dangerouslySetInnerHTML={{ __html: currentCard.definition.slice(0, 500) }}
            />
            {currentCard.context && (
              <p className='text-base-content/60 mt-3 text-xs italic'>
                &ldquo;{currentCard.context}&rdquo;
              </p>
            )}
            {currentCard.bookTitle && (
              <p className='text-base-content/40 mt-1 text-xs'>— {currentCard.bookTitle}</p>
            )}
          </div>
        ) : (
          <p className='text-base-content/40 mt-4 text-sm'>{_('Tap to reveal')}</p>
        )}
      </div>

      {revealed && (
        <div className='flex gap-3'>
          <button className='btn btn-error btn-sm' onClick={() => handleRate(2)}>
            {_('Hard')}
          </button>
          <button className='btn btn-warning btn-sm' onClick={() => handleRate(3)}>
            {_('Good')}
          </button>
          <button className='btn btn-success btn-sm' onClick={() => handleRate(5)}>
            {_('Easy')}
          </button>
        </div>
      )}
    </div>
  );
};

// ── Vocabulary Screen ────────────────────────────────────────────────

export const VocabularyScreen: React.FC = () => {
  const _ = useTranslation();
  const {
    entries,
    loaded,
    syncing,
    lastSyncError,
    loadVocabulary,
    removeEntry,
    getDueEntries,
    syncWithCloud,
    exportJSON,
    importJSON,
  } = useVocabularyStore();
  const [isOpen, setIsOpen] = useState(false);
  const [expandedLangs, setExpandedLangs] = useState<Set<string>>(new Set());
  const [reviewLang, setReviewLang] = useState<string | null>(null);
  const [importMsg, setImportMsg] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const handleCustomEvent = (event: CustomEvent) => {
      setIsOpen(event.detail.visible);
      if (event.detail.visible && !loaded) {
        loadVocabulary();
      }
    };
    const el = document.getElementById('vocabulary_screen_window');
    el?.addEventListener('setVocabularyScreenVisibility', handleCustomEvent as EventListener);
    return () => {
      el?.removeEventListener('setVocabularyScreenVisibility', handleCustomEvent as EventListener);
    };
  }, [loaded, loadVocabulary]);

  const groupedByLang = useMemo(() => {
    const groups: Record<string, VocabEntry[]> = {};
    for (const entry of entries) {
      if (!groups[entry.language]) groups[entry.language] = [];
      groups[entry.language]!.push(entry);
    }
    return groups;
  }, [entries]);

  const languages = Object.keys(groupedByLang).sort();

  const toggleLang = (lang: string) => {
    setExpandedLangs((prev) => {
      const next = new Set(prev);
      if (next.has(lang)) {
        next.delete(lang);
      } else {
        next.add(lang);
      }
      return next;
    });
  };

  const dueCount = (lang: string) => {
    return getDueEntries().filter((e) => e.language === lang).length;
  };

  const handleExport = () => {
    const json = exportJSON();
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `readest-vocabulary-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleImport = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const count = importJSON(reader.result as string);
      setImportMsg(count > 0 ? _('Imported {{count}} entries', { count }) : _('Import failed'));
      setTimeout(() => setImportMsg(null), 3000);
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  return (
    <Dialog
      id='vocabulary_screen_window'
      isOpen={isOpen}
      onClose={() => {
        setIsOpen(false);
        setReviewLang(null);
      }}
      title={_('Vocabulary')}
      boxClassName='sm:!min-w-[560px] sm:h-auto'
    >
      {isOpen && (
        <div className='mb-4 mt-0 flex flex-col gap-2 p-2 sm:p-4'>
          {/* ── Toolbar: Sync / Export / Import ── */}
          {!reviewLang && entries.length > 0 && (
            <div className='flex flex-wrap items-center gap-2'>
              <button
                className='btn btn-ghost btn-xs gap-1'
                onClick={() => syncWithCloud()}
                disabled={syncing}
                title={_('Sync with cloud')}
              >
                <MdSync size={16} className={syncing ? 'animate-spin' : ''} />
                {syncing ? _('Syncing…') : _('Sync')}
              </button>
              <button
                className='btn btn-ghost btn-xs gap-1'
                onClick={handleExport}
                title={_('Export vocabulary')}
              >
                <MdFileDownload size={16} />
                {_('Export')}
              </button>
              <button
                className='btn btn-ghost btn-xs gap-1'
                onClick={() => fileInputRef.current?.click()}
                title={_('Import vocabulary')}
              >
                <MdFileUpload size={16} />
                {_('Import')}
              </button>
              <input
                ref={fileInputRef}
                type='file'
                accept='.json'
                className='hidden'
                onChange={handleImport}
              />
              {lastSyncError && (
                <span className='text-error text-xs'>{lastSyncError}</span>
              )}
              {importMsg && <span className='text-success text-xs'>{importMsg}</span>}
            </div>
          )}

          {reviewLang ? (
            <ReviewScreen language={reviewLang} onClose={() => setReviewLang(null)} />
          ) : entries.length === 0 ? (
            <div className='flex flex-col items-center justify-center gap-2 py-12'>
              <MdSchool size={40} className='text-base-content/30' />
              <p className='text-base-content/60 text-sm'>
                {_('No vocabulary saved yet. Look up words in the dictionary and save them!')}
              </p>
              <div className='mt-2 flex gap-2'>
                <button
                  className='btn btn-ghost btn-xs gap-1'
                  onClick={() => syncWithCloud()}
                  disabled={syncing}
                >
                  <MdSync size={16} className={syncing ? 'animate-spin' : ''} />
                  {syncing ? _('Syncing…') : _('Sync from cloud')}
                </button>
                <button
                  className='btn btn-ghost btn-xs gap-1'
                  onClick={() => fileInputRef.current?.click()}
                >
                  <MdFileUpload size={16} />
                  {_('Import')}
                </button>
                <input
                  ref={fileInputRef}
                  type='file'
                  accept='.json'
                  className='hidden'
                  onChange={handleImport}
                />
              </div>
              {lastSyncError && (
                <span className='text-error mt-1 text-xs'>{lastSyncError}</span>
              )}
            </div>
          ) : (
            languages.map((lang) => {
              const langEntries = groupedByLang[lang]!;
              const isExpanded = expandedLangs.has(lang);
              const due = dueCount(lang);

              return (
                <div key={lang} className='rounded-lg'>
                  <button
                    className='bg-base-200 hover:bg-base-300 flex w-full items-center justify-between rounded-lg px-4 py-3'
                    onClick={() => toggleLang(lang)}
                  >
                    <div className='flex items-center gap-2'>
                      <span className='font-medium uppercase'>{lang}</span>
                      <span className='badge badge-sm'>{langEntries.length}</span>
                      {due > 0 && (
                        <span className='badge badge-warning badge-sm'>
                          {_('{{count}} due', { count: due })}
                        </span>
                      )}
                    </div>
                    <div className='flex items-center gap-2'>
                      {due > 0 && (
                        <button
                          className='btn btn-primary btn-xs'
                          onClick={(e) => {
                            e.stopPropagation();
                            setReviewLang(lang);
                          }}
                        >
                          {_('Review')}
                        </button>
                      )}
                      {isExpanded ? <MdExpandLess size={20} /> : <MdExpandMore size={20} />}
                    </div>
                  </button>

                  {isExpanded && (
                    <div className='mt-1 flex flex-col gap-1'>
                      {langEntries
                        .sort((a, b) => b.createdAt - a.createdAt)
                        .map((entry) => (
                          <div
                            key={entry.id}
                            className='bg-base-100 border-base-200 flex items-start justify-between rounded-lg border px-4 py-3'
                          >
                            <div className='min-w-0 flex-1'>
                              <p className='font-bold'>{entry.word}</p>
                              <div
                                className='text-base-content/70 mt-1 line-clamp-2 text-sm'
                                dangerouslySetInnerHTML={{
                                  __html: entry.definition.slice(0, 200),
                                }}
                              />
                              {entry.bookTitle && (
                                <p className='text-base-content/40 mt-1 text-xs'>
                                  {entry.bookTitle}
                                </p>
                              )}
                              <p className='text-base-content/30 mt-1 text-xs'>
                                {new Date(entry.createdAt).toLocaleDateString()}
                              </p>
                            </div>
                            <button
                              className='btn btn-ghost btn-sm ml-2 text-error'
                              onClick={() => removeEntry(entry.id)}
                              aria-label={_('Delete')}
                            >
                              <MdDelete size={18} />
                            </button>
                          </div>
                        ))}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      )}
    </Dialog>
  );
};
