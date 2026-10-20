import { createId } from '../../utils/id';
import type {
  AttemptLog,
  LearnCount,
  LearnOrder,
  LearnScope,
  LearningCard,
  MasteryStatus,
  SessionCardState,
  SessionSummary,
  StudyRecord,
  Vocabulary,
  WrongQuestion,
} from '../../types/models';
import { isAnswerCorrect } from './answerNormalizer';
import { MASTERY_THRESHOLD, mistakeService } from '../mistakes/MistakeService';

export const MASTERY_LABELS: Record<MasteryStatus, string> = {
  new: '未学习',
  learning: '学习中',
  review: '需复习',
  mastered: '已掌握',
};

export interface SubmitAnswerResult {
  isCorrect: boolean;
  nextInputValue: string;
  message: string;
  state: SessionCardState;
  studyRecord: StudyRecord;
  wrongQuestion: WrongQuestion | null;
  attemptLog: AttemptLog;
}

const masteryFromCounts = (record: StudyRecord): MasteryStatus => {
  if (record.consecutiveCorrect >= MASTERY_THRESHOLD) return 'mastered';
  if (record.wrongCount > 0) return 'review';
  if (record.correctCount > 0) return 'learning';
  return 'new';
};

export const createStudyRecord = (vocabularyId: string): StudyRecord => ({
  id: createId('study'),
  vocabularyId,
  attempts: 0,
  correctCount: 0,
  wrongCount: 0,
  consecutiveCorrect: 0,
  lastStudiedAt: null,
  masteryStatus: 'new',
  lastReviewSessionId: null,
});

/** 本题是否属于“独立拼写正确”：未答错、未显示答案、未跳过 */
const isIndependent = (state: SessionCardState): boolean =>
  state.wrongAttempts === 0 && !state.showAnswerUsed && !state.skipped;

export const submitAnswer = ({
  card,
  currentState,
  studyRecord,
  wrongQuestion,
  input,
  now,
  sessionId,
  ignorePunctuation,
}: {
  card: LearningCard;
  currentState: SessionCardState;
  studyRecord: StudyRecord | null;
  wrongQuestion: WrongQuestion | null;
  input: string;
  now: string;
  sessionId: string;
  ignorePunctuation: boolean;
}): SubmitAnswerResult => {
  const vocabularyId = card.vocabulary.id;
  const record: StudyRecord = studyRecord ? { ...studyRecord } : createStudyRecord(vocabularyId);
  record.attempts += 1;
  record.lastStudiedAt = now;

  const correct = isAnswerCorrect(input, card.vocabulary.word, {
    ignoreCase: true,
    ignoreOuterWhitespace: true,
    ignorePunctuation,
  });
  const attemptLog: AttemptLog = { id: createId('attempt'), vocabularyId, sessionId, at: now, correct };

  if (correct) {
    const independent = isIndependent(currentState);
    record.correctCount += 1;
    if (!independent) {
      record.consecutiveCorrect = 0;
    } else if (record.lastReviewSessionId !== sessionId) {
      // 同一回合内只计一次连续答对
      record.consecutiveCorrect += 1;
      record.lastReviewSessionId = sessionId;
    }
    record.masteryStatus = masteryFromCounts(record);

    const nextWrong = wrongQuestion
      ? mistakeService.recordReviewCorrect(wrongQuestion, now, sessionId, independent)
      : null;

    return {
      isCorrect: true,
      nextInputValue: '',
      message: currentState.showAnswerUsed ? '拼写正确（已查看答案，不计为独立答对）。' : '回答正确！',
      state: { ...currentState, solved: true, firstTryCorrect: independent },
      studyRecord: record,
      wrongQuestion: nextWrong,
      attemptLog,
    };
  }

  record.wrongCount += 1;
  record.consecutiveCorrect = 0;
  record.masteryStatus = masteryFromCounts(record);
  const trimmed = input.trim();
  return {
    isCorrect: false,
    nextInputValue: '',
    message: '回答错误，请重新输入',
    state: {
      ...currentState,
      wrongAttempts: currentState.wrongAttempts + 1,
      firstTryCorrect: false,
      solved: false,
    },
    studyRecord: record,
    wrongQuestion: mistakeService.recordWrong(wrongQuestion, vocabularyId, trimmed, now),
    attemptLog,
  };
};

/** 用户主动显示答案：记录操作、本题不再计为独立答对，并清零连续答对 */
export const revealAnswer = ({
  currentState,
  studyRecord,
  wrongQuestion,
  vocabularyId,
  now,
}: {
  currentState: SessionCardState;
  studyRecord: StudyRecord | null;
  wrongQuestion: WrongQuestion | null;
  vocabularyId: string;
  now: string;
}): { state: SessionCardState; studyRecord: StudyRecord; wrongQuestion: WrongQuestion } => {
  const record: StudyRecord = studyRecord ? { ...studyRecord } : createStudyRecord(vocabularyId);
  record.consecutiveCorrect = 0;
  record.lastStudiedAt = now;
  record.masteryStatus = record.masteryStatus === 'mastered' || record.masteryStatus === 'new' ? 'review' : record.masteryStatus;
  return {
    state: { ...currentState, showAnswerUsed: true, firstTryCorrect: false },
    studyRecord: record,
    wrongQuestion: mistakeService.recordShowAnswer(wrongQuestion, vocabularyId, now),
  };
};

export const skipCard = (state: SessionCardState): SessionCardState => ({
  ...state,
  skipped: !state.solved,
  firstTryCorrect: state.solved ? state.firstTryCorrect : false,
});

export const createSessionState = (cardId: string, hadMistakeBefore = false): SessionCardState => ({
  id: cardId,
  wrongAttempts: 0,
  firstTryCorrect: null,
  solved: false,
  showAnswerUsed: false,
  hintsUsed: 0,
  skipped: false,
  hadMistakeBefore,
});

/**
 * 统计口径：
 * - total：本轮题目总数（含未作答即退出的题）
 * - firstTryCorrect：未答错、未显示答案、未跳过即答对的题数
 * - everWrong：本轮至少答错一次的题数；correctedAfterMistake：其中最终答对的题数
 * - accuracy：firstTryCorrect / total
 * - newMistakes：本轮开始前不在错题本（或已掌握）、本轮答错或显示答案而被收录的题数
 */
export const summarizeSession = (states: SessionCardState[]): SessionSummary => {
  const total = states.length;
  const firstTryCorrect = states.filter((item) => item.firstTryCorrect === true).length;
  const everWrong = states.filter((item) => item.wrongAttempts > 0).length;
  const correctedAfterMistake = states.filter((item) => item.solved && item.wrongAttempts > 0).length;
  const totalWrongAttempts = states.reduce((sum, item) => sum + item.wrongAttempts, 0);
  const revealed = states.filter((item) => item.showAnswerUsed).length;
  const skipped = states.filter((item) => item.skipped).length;
  const newMistakes = states.filter((item) => !item.hadMistakeBefore && (item.wrongAttempts > 0 || item.showAnswerUsed)).length;
  const accuracy = total === 0 ? 0 : Math.round((firstTryCorrect / total) * 100);
  return { total, firstTryCorrect, everWrong, correctedAfterMistake, totalWrongAttempts, revealed, skipped, accuracy, newMistakes };
};

const shuffle = <T,>(items: T[], random: () => number): T[] => {
  const result = [...items];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(random() * (index + 1));
    [result[index], result[swap]] = [result[swap], result[index]];
  }
  return result;
};

export interface BuildSessionOptions {
  vocabularies: Vocabulary[];
  studyRecords: StudyRecord[];
  wrongQuestions: WrongQuestion[];
  scope: LearnScope;
  order: LearnOrder;
  count: LearnCount;
  /** 指定单词（按给定顺序），优先于 scope */
  ids?: string[];
  random?: () => number;
}

/** 根据学习配置生成本轮题目；题量会按实际可学习数量裁切 */
export const buildSessionCards = ({
  vocabularies,
  studyRecords,
  wrongQuestions,
  scope,
  order,
  count,
  ids,
  random = Math.random,
}: BuildSessionOptions): LearningCard[] => {
  const studyMap = new Map(studyRecords.map((item) => [item.vocabularyId, item]));
  const wrongMap = new Map(wrongQuestions.map((item) => [item.vocabularyId, item]));
  let source: Vocabulary[];
  if (ids) {
    const byId = new Map(vocabularies.map((item) => [item.id, item]));
    source = ids.map((id) => byId.get(id)).filter((item): item is Vocabulary => Boolean(item));
  } else if (scope === 'mistakes') {
    source = vocabularies.filter((item) => {
      const wrong = wrongMap.get(item.id);
      return wrong && wrong.status !== 'mastered';
    });
  } else if (scope === 'unmastered') {
    source = vocabularies.filter((item) => (studyMap.get(item.id)?.masteryStatus ?? 'new') !== 'mastered');
  } else {
    source = [...vocabularies].sort((left, right) => left.createdAt.localeCompare(right.createdAt));
  }

  const ordered = order === 'random' ? shuffle(source, random) : source;
  const limited = count === 'all' ? ordered : ordered.slice(0, count);
  return limited.map((vocabulary) => ({
    vocabulary,
    studyRecord: studyMap.get(vocabulary.id) ?? null,
    wrongQuestion: wrongMap.get(vocabulary.id) ?? null,
  }));
};

export interface HintItem {
  level: number;
  label: string;
  text: string;
}

export const MAX_HINT_LEVEL = 5;

const maskPartial = (word: string): string => {
  const letters = word.split('').filter((char) => /[a-z]/i.test(char)).length;
  const reveal = Math.max(1, Math.floor(letters / 2));
  let shown = 0;
  return word
    .split('')
    .map((char) => {
      if (!/[a-z]/i.test(char)) return char;
      shown += 1;
      return shown <= reveal ? char : '_';
    })
    .join(' ')
    .replace(/ {3}/g, '   ');
};

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** 根据真实词汇数据逐级生成提示（不会直接给出完整答案） */
export const buildHints = (vocabulary: Vocabulary, level: number): HintItem[] => {
  const word = vocabulary.word;
  const hints: HintItem[] = [];
  if (level >= 1) hints.push({ level: 1, label: '首字母', text: word.trim().charAt(0) });
  if (level >= 2) {
    const parts = word.trim().split(/\s+/);
    const text = parts.length > 1 ? `${parts.length} 个单词，各 ${parts.map((item) => item.length).join(' / ')} 个字符` : `${word.length} 个字符`;
    hints.push({ level: 2, label: '长度', text });
  }
  if (level >= 3) hints.push({ level: 3, label: '部分字母', text: maskPartial(word) });
  if (level >= 4) hints.push({ level: 4, label: '发音', text: '已重新播放发音，请仔细听' });
  if (level >= 5) {
    const masked = vocabulary.example
      ? vocabulary.example.replace(new RegExp(escapeRegExp(word), 'gi'), '____')
      : '';
    const extra = [
      masked ? `例句：${masked}` : '',
      vocabulary.exampleMeaning ? `例句翻译：${vocabulary.exampleMeaning}` : '',
      vocabulary.notes ? `备注：${vocabulary.notes}` : '',
    ].filter(Boolean);
    hints.push({ level: 5, label: '更多释义', text: extra.length ? extra.join('；') : '该单词没有填写例句或备注' });
  }
  return hints;
};
