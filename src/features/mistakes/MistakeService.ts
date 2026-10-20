import { createId } from '../../utils/id';
import type { WrongQuestion, WrongQuestionStatus } from '../../types/models';

/** 在不同复习回合中连续独立答对的次数达到该值即视为掌握 */
export const MASTERY_THRESHOLD = 3;

export const WRONG_STATUS_LABELS: Record<WrongQuestionStatus, string> = {
  pending: '待复习',
  reviewing: '复习中',
  mastered: '已掌握',
};

const createEmpty = (vocabularyId: string, at: string): WrongQuestion => ({
  id: createId('wrong'),
  vocabularyId,
  wrongCount: 0,
  lastWrongAt: at,
  lastWrongAnswer: '',
  reviewCount: 0,
  consecutiveCorrect: 0,
  status: 'pending',
  lastReviewedAt: null,
  history: [],
  lastReviewSessionId: null,
});

export const mistakeService = {
  /** 答错：不存在则创建，存在则更新同一条记录（按 vocabularyId 唯一） */
  recordWrong(existing: WrongQuestion | null, vocabularyId: string, wrongAnswer: string, at: string): WrongQuestion {
    const current = existing ?? createEmpty(vocabularyId, at);
    return {
      ...current,
      wrongCount: current.wrongCount + 1,
      lastWrongAt: at,
      lastWrongAnswer: wrongAnswer,
      consecutiveCorrect: 0,
      status: 'pending',
      history: [...current.history, { at, answer: wrongAnswer, action: 'wrong' }],
    };
  },

  /**
   * 显示答案：说明用户未能独立拼写，因此收录到错题本（若尚未收录）以便复习，
   * 但不增加错误次数；同时清零连续答对次数。
   */
  recordShowAnswer(existing: WrongQuestion | null, vocabularyId: string, at: string): WrongQuestion {
    const current = existing ?? createEmpty(vocabularyId, at);
    return {
      ...current,
      consecutiveCorrect: 0,
      status: current.status === 'mastered' || current.status === 'reviewing' ? 'reviewing' : 'pending',
      history: [...current.history, { at, answer: '', action: 'show-answer' }],
    };
  },

  /**
   * 错题答对。只有 countsForMastery（本回合未答错、未显示答案）且是新回合时才累计连续答对；
   * 同一回合内重复答对不累计。
   */
  recordReviewCorrect(
    existing: WrongQuestion,
    at: string,
    sessionId: string,
    countsForMastery: boolean,
  ): WrongQuestion {
    const isNewRound = existing.lastReviewSessionId !== sessionId;
    let nextConsecutive = existing.consecutiveCorrect;
    if (!countsForMastery) nextConsecutive = 0;
    else if (isNewRound) nextConsecutive += 1;

    const status: WrongQuestionStatus = nextConsecutive >= MASTERY_THRESHOLD ? 'mastered' : 'reviewing';
    return {
      ...existing,
      reviewCount: existing.reviewCount + 1,
      consecutiveCorrect: nextConsecutive,
      status,
      lastReviewedAt: at,
      lastReviewSessionId: countsForMastery ? sessionId : existing.lastReviewSessionId,
      history: [...existing.history, { at, answer: '', action: 'review-correct' }],
    };
  },

  markPending(question: WrongQuestion): WrongQuestion {
    return { ...question, status: 'pending', consecutiveCorrect: 0 };
  },

  markMastered(question: WrongQuestion): WrongQuestion {
    return { ...question, status: 'mastered' };
  },
};
