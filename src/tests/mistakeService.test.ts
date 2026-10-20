import { describe, expect, it } from 'vitest';
import { MASTERY_THRESHOLD, mistakeService } from '../features/mistakes/MistakeService';

const at = '2026-10-20T08:00:00.000Z';

describe('错题本规则', () => {
  it('多次错误正确累计', () => {
    let question = mistakeService.recordWrong(null, 'v1', 'helo', at);
    question = mistakeService.recordWrong(question, 'v1', 'hallo', at);
    question = mistakeService.recordWrong(question, 'v1', 'hullo', at);
    expect(question).toMatchObject({ wrongCount: 3, lastWrongAnswer: 'hullo', status: 'pending' });
    expect(question.history.map((item) => item.answer)).toEqual(['helo', 'hallo', 'hullo']);
  });

  it('复习次数正确更新', () => {
    let question = mistakeService.recordWrong(null, 'v1', 'x', at);
    question = mistakeService.recordReviewCorrect(question, at, 'r1', true);
    expect(question).toMatchObject({ reviewCount: 1, consecutiveCorrect: 1, status: 'reviewing', lastReviewedAt: at });
  });

  it('不同回合连续答对三次才掌握，同一回合重复答对不累计', () => {
    let question = mistakeService.recordWrong(null, 'v1', 'x', at);
    question = mistakeService.recordReviewCorrect(question, at, 'r1', true);
    question = mistakeService.recordReviewCorrect(question, at, 'r1', true);
    expect(question.consecutiveCorrect).toBe(1);
    question = mistakeService.recordReviewCorrect(question, at, 'r2', true);
    expect(question.status).toBe('reviewing');
    question = mistakeService.recordReviewCorrect(question, at, 'r3', true);
    expect(question.consecutiveCorrect).toBe(MASTERY_THRESHOLD);
    expect(question.status).toBe('mastered');
    expect(question.wrongCount).toBe(1);
  });

  it('非独立答对（答错过或显示答案）不计入掌握', () => {
    let question = mistakeService.recordWrong(null, 'v1', 'x', at);
    question = mistakeService.recordReviewCorrect(question, at, 'r1', true);
    question = mistakeService.recordReviewCorrect(question, at, 'r2', false);
    expect(question.consecutiveCorrect).toBe(0);
    expect(question.reviewCount).toBe(2);
  });

  it('再次答错后重置连续答对次数并回到待复习', () => {
    let question = mistakeService.recordWrong(null, 'v1', 'x', at);
    question = mistakeService.recordReviewCorrect(question, at, 'r1', true);
    question = mistakeService.recordReviewCorrect(question, at, 'r2', true);
    question = mistakeService.recordWrong(question, 'v1', 'y', at);
    expect(question).toMatchObject({ consecutiveCorrect: 0, status: 'pending', wrongCount: 2, reviewCount: 2 });
  });

  it('手动标记已掌握 / 重新加入待复习不删除历史', () => {
    const base = mistakeService.recordWrong(null, 'v1', 'x', at);
    const mastered = mistakeService.markMastered(base);
    expect(mastered.status).toBe('mastered');
    const pending = mistakeService.markPending(mastered);
    expect(pending).toMatchObject({ status: 'pending', consecutiveCorrect: 0, wrongCount: 1 });
    expect(pending.history).toHaveLength(1);
  });
});
