export interface VocabEntry {
  id: string;
  word: string;
  language: string; // ISO 639-1
  definition: string; // HTML definition text
  context?: string; // surrounding sentence from book
  bookHash?: string;
  bookTitle?: string;
  cfi?: string;
  createdAt: number;
  updatedAt: number;
  deletedAt?: number | null;
  nextReviewAt: number;
  reviewCount: number;
  ease: number; // SM-2 factor, default 2.5
}

// Payload stored in the `note` field of a BookNote when type='vocabulary'
interface VocabNotePayload {
  definition: string;
  context?: string;
  bookTitle?: string;
  nextReviewAt: number;
  reviewCount: number;
  ease: number;
}

/**
 * Convert a VocabEntry to a BookNote-shaped object for cloud sync.
 * Maps vocabulary-specific fields into the generic BookNote structure:
 *   text  → word
 *   style → language
 *   note  → JSON-encoded SM-2 / definition payload
 */
export function vocabEntryToBookNote(entry: VocabEntry) {
  const payload: VocabNotePayload = {
    definition: entry.definition,
    context: entry.context,
    bookTitle: entry.bookTitle,
    nextReviewAt: entry.nextReviewAt,
    reviewCount: entry.reviewCount,
    ease: entry.ease,
  };
  return {
    bookHash: entry.bookHash || 'vocabulary-orphan',
    id: entry.id,
    type: 'vocabulary' as const,
    cfi: entry.cfi || '',
    text: entry.word,
    style: entry.language,
    color: '',
    note: JSON.stringify(payload),
    createdAt: entry.createdAt,
    updatedAt: entry.updatedAt,
    deletedAt: entry.deletedAt ?? null,
  };
}

/** Convert a BookNote (pulled from cloud) back to a VocabEntry. */
export function bookNoteToVocabEntry(note: {
  bookHash?: string;
  id: string;
  cfi?: string;
  text?: string;
  style?: string;
  note?: string;
  createdAt?: number;
  updatedAt?: number;
  deletedAt?: number | null;
}): VocabEntry {
  let payload: VocabNotePayload = {
    definition: '',
    nextReviewAt: Date.now(),
    reviewCount: 0,
    ease: 2.5,
  };
  try {
    if (note.note) payload = { ...payload, ...JSON.parse(note.note) };
  } catch {
    // malformed JSON — use defaults
  }
  return {
    id: note.id,
    word: note.text || '',
    language: note.style || 'en',
    definition: payload.definition,
    context: payload.context,
    bookHash: note.bookHash,
    bookTitle: payload.bookTitle,
    cfi: note.cfi,
    createdAt: note.createdAt ?? Date.now(),
    updatedAt: note.updatedAt ?? Date.now(),
    deletedAt: note.deletedAt,
    nextReviewAt: payload.nextReviewAt,
    reviewCount: payload.reviewCount,
    ease: payload.ease,
  };
}
