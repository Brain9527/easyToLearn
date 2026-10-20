export type MasteryStatus = 'new' | 'learning' | 'review' | 'mastered';
export type WrongQuestionStatus = 'pending' | 'reviewing' | 'mastered';
export type ImportDuplicateStrategy = 'skip' | 'overwrite' | 'fill-empty';
export type SortOption = 'created-desc' | 'created-asc' | 'word-asc' | 'word-desc';
export type LearnScope = 'all' | 'unmastered' | 'mistakes';
export type LearnOrder = 'sequential' | 'random';
export type LearnCount = 10 | 20 | 50 | 'all';

export interface Vocabulary {
  id: string;
  word: string;
  phonetic: string;
  meaning: string;
  mnemonic: string;
  example: string;
  exampleMeaning: string;
  notes: string;
  createdAt: string;
  updatedAt: string;
  normalizedWord: string;
}

export interface StudyRecord {
  id: string;
  vocabularyId: string;
  attempts: number;
  correctCount: number;
  wrongCount: number;
  consecutiveCorrect: number;
  lastStudiedAt: string | null;
  masteryStatus: MasteryStatus;
  /** 最近一次计入连续答对的学习回合 ID，同一回合只计一次 */
  lastReviewSessionId: string | null;
}

export interface WrongQuestion {
  id: string;
  vocabularyId: string;
  wrongCount: number;
  lastWrongAt: string;
  lastWrongAnswer: string;
  reviewCount: number;
  consecutiveCorrect: number;
  status: WrongQuestionStatus;
  lastReviewedAt: string | null;
  history: WrongHistoryItem[];
  lastReviewSessionId: string | null;
}

export interface WrongHistoryItem {
  at: string;
  answer: string;
  action: 'wrong' | 'show-answer' | 'review-correct';
}

/** 每一次提交答案的日志，用于计算“今日”统计 */
export interface AttemptLog {
  id: string;
  vocabularyId: string;
  sessionId: string;
  at: string;
  correct: boolean;
}

export interface UserSettings {
  speechVoiceURI: string;
  speechRate: number;
  speechAutoPlay: boolean;
  playSuccessSound: boolean;
  /** 显示音标与谐音（两者共用一个开关，谐音显示在音标下方） */
  showPhonetic: boolean;
  answerIgnorePunctuation: boolean;
  /** 肌肉记忆模式：直接显示完整单词，让用户照着输入 */
  muscleMemoryMode: boolean;
  learnCount: LearnCount;
  learnScope: LearnScope;
  learnOrder: LearnOrder;
  /** DeepSeek API Key，仅保存在本机 IndexedDB */
  aiApiKey: string;
  aiModel: string;
}

export interface VocabularyDraft {
  word: string;
  phonetic?: string;
  meaning?: string;
  mnemonic?: string;
  example?: string;
  exampleMeaning?: string;
  notes?: string;
}

export interface VocabularyFilters {
  wordQuery: string;
  meaningQuery: string;
  mnemonicQuery: string;
  masteryStatus: 'all' | MasteryStatus;
  wrongOnly: 'all' | 'yes' | 'no';
  sortBy: SortOption;
}

export interface LearningConfig {
  count: LearnCount;
  scope: LearnScope;
  order: LearnOrder;
  autoPlay: boolean;
  soundEnabled: boolean;
  showMnemonic: boolean;
  showPhonetic: boolean;
}

export interface LearningCard {
  vocabulary: Vocabulary;
  studyRecord: StudyRecord | null;
  wrongQuestion: WrongQuestion | null;
}

export interface SessionCardState {
  id: string;
  wrongAttempts: number;
  firstTryCorrect: boolean | null;
  solved: boolean;
  showAnswerUsed: boolean;
  hintsUsed: number;
  skipped: boolean;
  /** 本轮开始前该词是否已在错题本中（用于统计“本轮新增错题”） */
  hadMistakeBefore: boolean;
}

export interface SessionSummary {
  total: number;
  /** 未答错、未显示答案、未跳过且答对的题数 */
  firstTryCorrect: number;
  /** 本轮至少答错过一次的题数 */
  everWrong: number;
  correctedAfterMistake: number;
  totalWrongAttempts: number;
  revealed: number;
  skipped: number;
  /** 首次答对数 / 总题数 */
  accuracy: number;
  newMistakes: number;
}

export interface AppStats {
  vocabularyCount: number;
  studiedWordCount: number;
  masteredWordCount: number;
  pendingMistakeCount: number;
  todayStudiedCount: number;
  todayAttempts: number;
  todayCorrect: number;
  /** 今日答对次数 / 今日答题次数（百分比） */
  todayAccuracy: number;
  totalAttempts: number;
}

export interface ImportColumnMap {
  word: string;
  phonetic: string;
  meaning: string;
  mnemonic: string;
  example: string;
  exampleMeaning: string;
  notes: string;
}

export interface ParsedImportFile {
  fileName: string;
  headers: string[];
  rows: Record<string, string>[];
}

export interface ImportValidationIssue {
  rowIndex: number;
  field: keyof ImportColumnMap | 'row';
  message: string;
}

export interface ImportPreviewRow {
  rowIndex: number;
  data: VocabularyDraft;
  normalizedWord: string;
  duplicateInFile: boolean;
  existingMatch: Vocabulary | null;
  status: 'valid' | 'blank' | 'error' | 'duplicate';
  issues: ImportValidationIssue[];
}

export interface ImportValidationResult {
  totalRows: number;
  /** 校验通过的行（含与已有词库重复、需按策略处理的行） */
  validRows: number;
  /** 空白行 */
  skippedRows: number;
  /** 文件内重复 + 与已有词库重复 */
  duplicateRows: number;
  duplicateInFileRows: number;
  duplicateExistingRows: number;
  errorRows: number;
  rows: ImportPreviewRow[];
  issues: ImportValidationIssue[];
}

export interface ImportCommitResult {
  inserted: number;
  updated: number;
  skipped: number;
}

export interface AppDataBundle {
  vocabularies: Vocabulary[];
  studyRecords: StudyRecord[];
  wrongQuestions: WrongQuestion[];
  attemptLogs: AttemptLog[];
  settings: UserSettings;
}
