export interface AnswerComparisonOptions {
  ignoreCase: boolean;
  ignoreOuterWhitespace: boolean;
  ignorePunctuation: boolean;
}

export const defaultAnswerComparisonOptions: AnswerComparisonOptions = {
  ignoreCase: true,
  ignoreOuterWhitespace: true,
  ignorePunctuation: false,
};

const punctuationPattern = /[.,/#!$%^&*;:{}=\-_`~()?"'[\]\\|+<>]/g;

export const normalizeAnswer = (
  value: string,
  options: AnswerComparisonOptions = defaultAnswerComparisonOptions,
): string => {
  let result = value;
  if (options.ignoreOuterWhitespace) {
    result = result.trim();
  }
  if (options.ignorePunctuation) {
    result = result.replace(punctuationPattern, '');
  }
  if (options.ignoreCase) {
    result = result.toLowerCase();
  }
  return result;
};

export const isAnswerCorrect = (
  input: string,
  expected: string,
  options: AnswerComparisonOptions = defaultAnswerComparisonOptions,
): boolean => normalizeAnswer(input, options) === normalizeAnswer(expected, options);
