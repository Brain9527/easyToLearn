import { describe, expect, it } from 'vitest';
import {
  MAX_HINT_LEVEL,
  buildHints,
  buildSessionCards,
  createSessionState,
  revealAnswer,
  skipCard,
  submitAnswer,
  summarizeSession,
} from '../features/learning/LearningSession';
import type { LearningCard, SessionCardState, StudyRecord, WrongQuestion } from '../types/models';
import { makeVocabulary } from './fixtures';

const hello = makeVocabulary('hello', { meaning: '你好', example: 'Hello, how are you?', exampleMeaning: '你好，你好吗？' });
const card: LearningCard = { vocabulary: hello, studyRecord: null, wrongQuestion: null };

interface Ctx {
  state: SessionCardState;
  study: StudyRecord | null;
  wrong: WrongQuestion | null;
}

const answer = (ctx: Ctx, input: string, sessionId = 's1') => {
  const result = submitAnswer({
    card,
    currentState: ctx.state,
    studyRecord: ctx.study,
    wrongQuestion: ctx.wrong,
    input,
    now: '2026-10-20T08:00:00.000Z',
    sessionId,
    ignorePunctuation: false,
  });
  ctx.state = result.state;
  ctx.study = result.studyRecord;
  ctx.wrong = result.wrongQuestion ?? ctx.wrong;
  return result;
};

const freshCtx = (): Ctx => ({ state: createSessionState(hello.id), study: null, wrong: null });

 describe('学习会话', () => {
  it('正确答案更新学习记录并计为首次答对', () => {
    const ctx = freshCtx();
    const result = answer(ctx, ' Hello ');
    expect(result.isCorrect).toBe(true);
    expect(result.wrongQuestion).toBeNull();
    expect(ctx.study).toMatchObject({ attempts: 1, correctCount: 1, wrongCount: 0, consecutiveCorrect: 1, masteryStatus: 'learning' });
    expect(ctx.state).toMatchObject({ solved: true, firstTryCorrect: true });
  });

  it('错误答案清空输入、保留题目并写入错题本', () => {
    const ctx = freshCtx();
    const result = answer(ctx, 'helo');
    expect(result.isCorrect).toBe(false);
    expect(result.nextInputValue).toBe('');
    expect(result.message).toBe('回答错误，请重新输入');
    expect(ctx.state.solved).toBe(false);
    expect(result.wrongQuestion).toMatchObject({ vocabularyId: hello.id, wrongCount: 1, lastWrongAnswer: 'helo', status: 'pending' });
  });

  it('重复答错只更新同一条错题记录', () => {
    const ctx = freshCtx();
    const first = answer(ctx, 'helo');
    const second = answer(ctx, 'hallo');
    expect(second.wrongQuestion?.id).toBe(first.wrongQuestion?.id);
    expect(second.wrongQuestion).toMatchObject({ wrongCount: 2, lastWrongAnswer: 'hallo' });
    expect(second.wrongQuestion?.history).toHaveLength(2);
  });

  it('答错后再答对不计为首次答对', () => {
    const ctx = freshCtx();
    answer(ctx, 'helo');
    const result = answer(ctx, 'hello');
    expect(result.isCorrect).toBe(true);
    expect(ctx.state.firstTryCorrect).toBe(false);
    expect(ctx.study).toMatchObject({ attempts: 2, correctCount: 1, wrongCount: 1, consecutiveCorrect: 0 });
  });

  it('显示答案不计为独立答对，并收录到错题本', () => {
    const ctx = freshCtx();
    const revealed = revealAnswer({ currentState: ctx.state, studyRecord: null, wrongQuestion: null, vocabularyId: hello.id, now: 'now' });
    ctx.state = revealed.state;
    ctx.study = revealed.studyRecord;
    ctx.wrong = revealed.wrongQuestion;
    expect(ctx.wrong).toMatchObject({ wrongCount: 0, status: 'pending' });
    expect(ctx.wrong?.history[0].action).toBe('show-answer');

    const result = answer(ctx, 'hello');
    expect(result.isCorrect).toBe(true);
    expect(ctx.state.firstTryCorrect).toBe(false);
    expect(ctx.study?.consecutiveCorrect).toBe(0);
    expect(result.wrongQuestion?.consecutiveCorrect).toBe(0);
  });

  it('完成一轮后统计准确', () => {
    const states: SessionCardState[] = [
      { ...createSessionState('a'), solved: true, firstTryCorrect: true },
      { ...createSessionState('b'), solved: true, firstTryCorrect: false, wrongAttempts: 2 },
      { ...createSessionState('c', true), solved: true, firstTryCorrect: false, wrongAttempts: 1 },
      { ...createSessionState('d'), solved: true, firstTryCorrect: false, showAnswerUsed: true },
      skipCard(createSessionState('e')),
    ];
    expect(summarizeSession(states)).toEqual({
      total: 5,
      firstTryCorrect: 1,
      everWrong: 2,
      correctedAfterMistake: 2,
      totalWrongAttempts: 3,
      revealed: 1,
      skipped: 1,
      accuracy: 20,
      newMistakes: 2,
    });
  });

  it('题量按可学习数量裁切，范围筛选正确', () => {
    const words = ['a', 'b', 'c'].map((word) => makeVocabulary(word));
    const wrong: WrongQuestion = {
      id: 'w', vocabularyId: words[1].id, wrongCount: 1, lastWrongAt: '', lastWrongAnswer: '', reviewCount: 0,
      consecutiveCorrect: 0, status: 'pending', lastReviewedAt: null, history: [], lastReviewSessionId: null,
    };
    const all = buildSessionCards({ vocabularies: words, studyRecords: [], wrongQuestions: [wrong], scope: 'all', order: 'sequential', count: 10 });
    expect(all).toHaveLength(3);
    const mistakes = buildSessionCards({ vocabularies: words, studyRecords: [], wrongQuestions: [wrong], scope: 'mistakes', order: 'sequential', count: 'all' });
    expect(mistakes.map((item) => item.vocabulary.word)).toEqual(['b']);
  });

  it.each([
    ['hello', 'hel'],
    ['planet', 'pla'],
    ['a', 'a'],
    ["I'm happy!", "I'm ha"],
    ['a-b cdef', 'a-b c'],
    ['---', ''],
  ])('第一次提示 %s 的前半字母为 %s，第二次为完整答案', (word, prefix) => {
    const vocabulary = makeVocabulary(word);
    expect(MAX_HINT_LEVEL).toBe(2);
    expect(buildHints(vocabulary, 0)).toEqual([]);
    expect(buildHints(vocabulary, 1).map((hint) => hint.text)).toEqual([prefix]);
    expect(buildHints(vocabulary, 2).map((hint) => hint.text)).toEqual([prefix, word]);
    expect(buildHints(vocabulary, 5)).toHaveLength(2);
  });

  it('第三次错误显示答案但不通过，后续错误不重复记录显示答案', () => {
    const ctx = freshCtx();
    answer(ctx, 'helo');
    answer(ctx, 'helo');
    expect(ctx.state.showAnswerUsed).toBe(false);
    const third = answer(ctx, 'helo');
    expect(third).toMatchObject({ isCorrect: false, nextInputValue: '', attemptLog: { correct: false } });
    expect(ctx.state).toMatchObject({ wrongAttempts: 3, showAnswerUsed: true, solved: false, firstTryCorrect: false });
    expect(ctx.study).toMatchObject({ attempts: 3, wrongCount: 3, correctCount: 0 });
    expect(ctx.wrong?.history.map((item) => item.action)).toEqual(['wrong', 'wrong', 'wrong', 'show-answer']);
    answer(ctx, 'helo');
    expect(ctx.study).toMatchObject({ attempts: 4, wrongCount: 4 });
    expect(ctx.wrong?.wrongCount).toBe(4);
    expect(ctx.wrong?.history.filter((item) => item.action === 'show-answer')).toHaveLength(1);
    answer(ctx, 'hello');
    expect(ctx.state).toMatchObject({ solved: true, firstTryCorrect: false });
    expect(ctx.study).toMatchObject({ attempts: 5, wrongCount: 4, correctCount: 1, consecutiveCorrect: 0 });
    expect(summarizeSession([ctx.state])).toMatchObject({ revealed: 1, totalWrongAttempts: 4, firstTryCorrect: 0 });
  });

  it('已显示答案后第三次答错不重复记录显示答案', () => {
    const ctx = freshCtx();
    const revealed = revealAnswer({ currentState: ctx.state, studyRecord: null, wrongQuestion: null, vocabularyId: hello.id, now: 'now' });
    ctx.state = revealed.state;
    ctx.study = revealed.studyRecord;
    ctx.wrong = revealed.wrongQuestion;
    for (let index = 0; index < 3; index += 1) answer(ctx, 'helo');
    expect(ctx.study).toMatchObject({ attempts: 3, wrongCount: 3 });
    expect(ctx.wrong?.history.filter((item) => item.action === 'show-answer')).toHaveLength(1);
  });
});
