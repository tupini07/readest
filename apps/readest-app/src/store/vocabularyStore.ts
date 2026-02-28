import { create } from 'zustand';
import { VocabEntry, vocabEntryToBookNote, bookNoteToVocabEntry } from '@/types/vocabulary';
import { SyncClient } from '@/libs/sync';
import { BookNote } from '@/types/book';

const STORAGE_KEY = 'readest-vocabulary';

function loadEntries(): VocabEntry[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as VocabEntry[]) : [];
  } catch {
    return [];
  }
}

function persistEntries(entries: VocabEntry[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
  } catch {
    // silently fail on quota exceeded
  }
}

// SM-2 algorithm: compute next review interval and ease factor
function sm2(
  reviewCount: number,
  ease: number,
  quality: 0 | 1 | 2 | 3 | 4 | 5,
): { nextInterval: number; ease: number; reviewCount: number } {
  let newEase = ease + (0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02));
  if (newEase < 1.3) newEase = 1.3;

  if (quality < 3) {
    // Failed: reset
    return { nextInterval: 1, ease: newEase, reviewCount: 0 };
  }

  let interval: number;
  const newReviewCount = reviewCount + 1;
  if (newReviewCount === 1) {
    interval = 1;
  } else if (newReviewCount === 2) {
    interval = 6;
  } else {
    // For reviewCount >= 3, compute interval based on previous
    let prev = 6;
    for (let i = 3; i <= newReviewCount; i++) {
      prev = Math.round(prev * newEase);
    }
    interval = prev;
  }

  return { nextInterval: interval, ease: newEase, reviewCount: newReviewCount };
}

interface VocabularyState {
  entries: VocabEntry[];
  loaded: boolean;
  syncing: boolean;
  lastSyncError: string | null;
  addEntry: (entry: VocabEntry) => void;
  removeEntry: (id: string) => void;
  updateEntry: (id: string, partial: Partial<VocabEntry>) => void;
  getEntriesByLanguage: (lang: string) => VocabEntry[];
  getDueEntries: () => VocabEntry[];
  recordReview: (id: string, quality: 0 | 1 | 2 | 3 | 4 | 5) => void;
  loadVocabulary: () => void;
  /** Merge remote entries with local ones (newer wins by updatedAt). */
  mergeEntries: (remote: VocabEntry[]) => void;
  /** Sync vocabulary with cloud via the book_notes sync API. */
  syncWithCloud: () => Promise<void>;
  /** Export all entries as JSON string. */
  exportJSON: () => string;
  /** Import entries from JSON string, merging by ID (newer wins). */
  importJSON: (json: string) => number;
}

export const useVocabularyStore = create<VocabularyState>((set, get) => ({
  entries: [],
  loaded: false,
  syncing: false,
  lastSyncError: null,

  loadVocabulary: () => {
    const entries = loadEntries();
    set({ entries, loaded: true });
  },

  addEntry: (entry: VocabEntry) => {
    const now = Date.now();
    const entryWithTimestamps = { ...entry, updatedAt: entry.updatedAt || now };
    const entries = [...get().entries, entryWithTimestamps];
    set({ entries });
    persistEntries(entries);
  },

  removeEntry: (id: string) => {
    const entries = get().entries.filter((e) => e.id !== id);
    set({ entries });
    persistEntries(entries);
  },

  updateEntry: (id: string, partial: Partial<VocabEntry>) => {
    const entries = get().entries.map((e) =>
      e.id === id ? { ...e, ...partial, updatedAt: Date.now() } : e,
    );
    set({ entries });
    persistEntries(entries);
  },

  getEntriesByLanguage: (lang: string) => {
    return get().entries.filter((e) => e.language === lang);
  },

  getDueEntries: () => {
    const now = Date.now();
    return get()
      .entries.filter((e) => e.nextReviewAt <= now)
      .sort((a, b) => a.nextReviewAt - b.nextReviewAt);
  },

  recordReview: (id: string, quality: 0 | 1 | 2 | 3 | 4 | 5) => {
    const entry = get().entries.find((e) => e.id === id);
    if (!entry) return;

    const result = sm2(entry.reviewCount, entry.ease, quality);
    const DAY_MS = 86400000;
    const nextReviewAt = Date.now() + result.nextInterval * DAY_MS;

    const entries = get().entries.map((e) =>
      e.id === id
        ? {
            ...e,
            ease: result.ease,
            reviewCount: result.reviewCount,
            nextReviewAt,
            updatedAt: Date.now(),
          }
        : e,
    );
    set({ entries });
    persistEntries(entries);
  },

  mergeEntries: (remote: VocabEntry[]) => {
    const local = get().entries;
    const localMap = new Map(local.map((e) => [e.id, e]));
    let changed = false;

    for (const remoteEntry of remote) {
      const localEntry = localMap.get(remoteEntry.id);
      if (!localEntry) {
        // New from remote
        if (!remoteEntry.deletedAt) {
          localMap.set(remoteEntry.id, remoteEntry);
          changed = true;
        }
      } else if ((remoteEntry.updatedAt || 0) > (localEntry.updatedAt || 0)) {
        // Remote is newer
        if (remoteEntry.deletedAt) {
          localMap.delete(remoteEntry.id);
        } else {
          localMap.set(remoteEntry.id, remoteEntry);
        }
        changed = true;
      }
    }

    if (changed) {
      const merged = Array.from(localMap.values());
      set({ entries: merged });
      persistEntries(merged);
    }
  },

  syncWithCloud: async () => {
    set({ syncing: true, lastSyncError: null });
    try {
      const syncClient = new SyncClient();
      const lastSyncStr = localStorage.getItem('readest-vocabulary-last-sync');
      const lastSync = lastSyncStr ? parseInt(lastSyncStr, 10) : 0;

      // Pull all notes, then filter for type='vocabulary'
      const result = await syncClient.pullChanges(lastSync, 'notes');
      const allNotes = result.notes || [];
      const vocabNotes = allNotes.filter((n) => (n as BookNote).type === 'vocabulary');

      if (vocabNotes.length > 0) {
        const remoteEntries = vocabNotes.map((n) =>
          bookNoteToVocabEntry(n as unknown as BookNote),
        );
        get().mergeEntries(remoteEntries);
      }

      // Push local entries
      const entries = get().entries;
      if (entries.length > 0) {
        const bookNotes = entries.map((e) => vocabEntryToBookNote(e));
        await syncClient.pushChanges({ notes: bookNotes as unknown as Partial<BookNote>[] });
      }

      localStorage.setItem('readest-vocabulary-last-sync', String(Date.now()));
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Sync failed';
      set({ lastSyncError: msg });
      console.error('Vocabulary sync error:', msg);
    } finally {
      set({ syncing: false });
    }
  },

  exportJSON: () => {
    return JSON.stringify(get().entries, null, 2);
  },

  importJSON: (json: string) => {
    try {
      const imported = JSON.parse(json) as VocabEntry[];
      if (!Array.isArray(imported)) throw new Error('Invalid format');
      get().mergeEntries(imported);
      return imported.length;
    } catch {
      return 0;
    }
  },
}));
