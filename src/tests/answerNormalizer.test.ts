import { describe, expect, it } from 'vitest';
import { isAnswerCorrect, normalizeAnswer } from '../features/learning/answerNormalizer';

const withPunctuation = { ignoreCase: true, ignoreOuterWhitespace: true, ignorePunctuation: true };

describe('答案判定', () => {
  it('正确答案通过校验', () => {
    expect(isAnswerCorrect('hello', 'hello')).toBe(true);
  });

  it('大小写差异不影响判定', () => {
    expect(isAnswerCorrect('HeLLo', 'hello')).toBe(true);
  });

  it('首尾空格不影响判定', () => {
    expect(isAnswerCorrect('   hello  ', 'hello')).toBe(true);
  });

  it('拼写错误不能通过，也不会被自动纠正', () => {
    expect(isAnswerCorrect('helo', 'hello')).toBe(false);
    expect(isAnswerCorrect('hellp', 'hello')).toBe(false);
  });

  it('短语保留内部空格，缺少或多余空格判错', () => {
    expect(isAnswerCorrect('look after', 'look after')).toBe(true);
    expect(isAnswerCorrect('lookafter', 'look after')).toBe(false);
    expect(isAnswerCorrect('look  after', 'look after')).toBe(false);
  });

  it('默认不忽略标点：Hello! 必须带感叹号', () => {
    expect(isAnswerCorrect('hello', 'Hello!')).toBe(false);
    expect(isAnswerCorrect('hello!', 'Hello!')).toBe(true);
  });

  it('开启忽略标点后，标点差异不影响判定，但字母仍需精确', () => {
    expect(isAnswerCorrect('hello', 'Hello!', withPunctuation)).toBe(true);
    expect(isAnswerCorrect("dont", "don't", withPunctuation)).toBe(true);
    expect(isAnswerCorrect('helo', 'Hello!', withPunctuation)).toBe(false);
  });

  it('normalizeAnswer 只做去首尾空白和小写', () => {
    expect(normalizeAnswer('  Ice Cream ')).toBe('ice cream');
  });
});
