import { createId } from '../../utils/id';
import { normalizeSearch, normalizeWord, trimValue } from '../../utils/text';
import type {
  AppStats,
  AttemptLog,
  StudyRecord,
  Vocabulary,
  VocabularyDraft,
  VocabularyFilters,
  WrongQuestion,
} from '../../types/models';
import { isToday } from '../../utils/date';

export const vocabularyService = {
  createFromDraft(draft: VocabularyDraft, now: string): Vocabulary {
    return {
      id: createId('vocab'),
      word: trimValue(draft.word),
      phonetic: trimValue(draft.phonetic),
      meaning: trimValue(draft.meaning),
      mnemonic: trimValue(draft.mnemonic),
      example: trimValue(draft.example),
      exampleMeaning: trimValue(draft.exampleMeaning),
      notes: trimValue(draft.notes),
      createdAt: now,
      updatedAt: now,
      normalizedWord: normalizeWord(draft.word),
    };
  },

  mergeDraft(current: Vocabulary, draft: VocabularyDraft, now: string): Vocabulary {
    return {
      ...current,
      word: trimValue(draft.word),
      phonetic: trimValue(draft.phonetic),
      meaning: trimValue(draft.meaning),
      mnemonic: trimValue(draft.mnemonic),
      example: trimValue(draft.example),
      exampleMeaning: trimValue(draft.exampleMeaning),
      notes: trimValue(draft.notes),
      updatedAt: now,
      normalizedWord: normalizeWord(draft.word),
    };
  },

  filterVocabularies(
    vocabularies: Vocabulary[],
    records: StudyRecord[],
    wrongQuestions: WrongQuestion[],
    filters: VocabularyFilters,
  ): Vocabulary[] {
    const recordsById = new Map(records.map((record) => [record.vocabularyId, record]));
    const wrongById = new Map(wrongQuestions.map((item) => [item.vocabularyId, item]));

    return [...vocabularies]
      .filter((item) => normalizeSearch(item.word).includes(normalizeSearch(filters.wordQuery)))
      .filter((item) => normalizeSearch(item.meaning).includes(normalizeSearch(filters.meaningQuery)))
      .filter((item) => normalizeSearch(item.mnemonic).includes(normalizeSearch(filters.mnemonicQuery)))
      .filter((item) => {
        if (filters.masteryStatus === 'all') return true;
        return (recordsById.get(item.id)?.masteryStatus ?? 'new') === filters.masteryStatus;
      })
      .filter((item) => {
        if (filters.wrongOnly === 'all') return true;
        const hasWrong = Boolean(wrongById.get(item.id)) && wrongById.get(item.id)?.status !== 'mastered';
        return filters.wrongOnly === 'yes' ? hasWrong : !hasWrong;
      })
      .sort((left, right) => {
        switch (filters.sortBy) {
          case 'created-asc':
            return left.createdAt.localeCompare(right.createdAt);
          case 'word-asc':
            return left.word.localeCompare(right.word, 'en');
          case 'word-desc':
            return right.word.localeCompare(left.word, 'en');
          case 'created-desc':
          default:
            return right.createdAt.localeCompare(left.createdAt);
        }
      });
  },

  /**
   * 统计口径：
   * - 已学习：StudyRecord.attempts > 0 的词数
   * - 已掌握：StudyRecord.masteryStatus 为 mastered 或错题状态为 mastered 的词（按词去重）
   * - 今日学习数量：今日答题日志中不同单词的数量
   * - 今日正确率：今日答对次数 / 今日提交次数
   */
  buildStats(
    vocabularies: Vocabulary[],
    records: StudyRecord[],
    wrongQuestions: WrongQuestion[],
    attemptLogs: AttemptLog[],
    now: Date = new Date(),
  ): AppStats {
    const vocabIds = new Set(vocabularies.map((item) => item.id));
    const validRecords = records.filter((item) => vocabIds.has(item.vocabularyId));
    const validWrong = wrongQuestions.filter((item) => vocabIds.has(item.vocabularyId));
    const mastered = new Set<string>([
      ...validRecords.filter((item) => item.masteryStatus === 'mastered').map((item) => item.vocabularyId),
      ...validWrong.filter((item) => item.status === 'mastered').map((item) => item.vocabularyId),
    ]);
    const todayLogs = attemptLogs.filter((item) => isToday(item.at, now));
    const todayCorrect = todayLogs.filter((item) => item.correct).length;
    return {
      vocabularyCount: vocabularies.length,
      studiedWordCount: validRecords.filter((item) => item.attempts > 0).length,
      masteredWordCount: mastered.size,
      pendingMistakeCount: validWrong.filter((item) => item.status !== 'mastered').length,
      todayStudiedCount: new Set(todayLogs.map((item) => item.vocabularyId)).size,
      todayAttempts: todayLogs.length,
      todayCorrect,
      todayAccuracy: todayLogs.length === 0 ? 0 : Math.round((todayCorrect / todayLogs.length) * 100),
      totalAttempts: validRecords.reduce((sum, item) => sum + item.attempts, 0),
    };
  },
};
