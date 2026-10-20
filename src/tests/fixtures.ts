import type { Vocabulary } from '../types/models';
import { normalizeWord } from '../utils/text';

export const makeVocabulary = (word: string, patch: Partial<Vocabulary> = {}): Vocabulary => ({
  id: `vocab-${normalizeWord(word).replace(/\W+/g, '-')}`,
  word,
  phonetic: '',
  meaning: `${word} 的释义`,
  mnemonic: '',
  example: '',
  exampleMeaning: '',
  notes: '',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  normalizedWord: normalizeWord(word),
  ...patch,
});
