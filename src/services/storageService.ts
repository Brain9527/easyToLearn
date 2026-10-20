import { SETTINGS_KEY, defaultSettings, getDatabase } from '../db/database';
import type {
  AppDataBundle,
  AttemptLog,
  StudyRecord,
  UserSettings,
  Vocabulary,
  WrongQuestion,
} from '../types/models';

export class StorageError extends Error {
  constructor(message: string, public readonly causeError?: unknown) {
    super(message);
    this.name = 'StorageError';
  }
}

const describeCause = (error: unknown): string => {
  if (error instanceof DOMException) {
    if (error.name === 'QuotaExceededError') return '浏览器存储空间不足';
    if (error.name === 'ConstraintError') return '数据唯一性冲突（可能存在重复单词）';
    return error.name;
  }
  if (error instanceof Error) return error.message;
  return '未知错误';
};

const wrap = async <T>(message: string, action: () => Promise<T>): Promise<T> => {
  try {
    return await action();
  } catch (error) {
    if (error instanceof StorageError) throw error;
    throw new StorageError(`${message}（${describeCause(error)}）`, error);
  }
};

export interface PracticeWrite {
  studyRecord?: StudyRecord | null;
  wrongQuestion?: WrongQuestion | null;
  attemptLog?: AttemptLog | null;
}

export const storageService = {
  async getBundle(): Promise<AppDataBundle> {
    return wrap('读取本地数据失败，请检查浏览器是否允许站点存储数据', async () => {
      const db = await getDatabase();
      const [vocabularies, studyRecords, wrongQuestions, attemptLogs, rawSettings] = await Promise.all([
        db.getAll('vocabularies'),
        db.getAll('studyRecords'),
        db.getAll('wrongQuestions'),
        db.getAll('attemptLogs'),
        db.get('settings', SETTINGS_KEY),
      ]);
      let settings: UserSettings = defaultSettings;
      if (rawSettings) {
        const { id: _id, ...rest } = rawSettings;
        settings = { ...defaultSettings, ...rest };
      }
      return { vocabularies, studyRecords, wrongQuestions, attemptLogs, settings };
    });
  },

  async saveSettings(settings: UserSettings): Promise<void> {
    return wrap('保存设置失败', async () => {
      const db = await getDatabase();
      await db.put('settings', { id: SETTINGS_KEY, ...settings });
    });
  },

  async saveVocabulary(vocabulary: Vocabulary): Promise<void> {
    return wrap('保存单词失败', async () => {
      const db = await getDatabase();
      await db.put('vocabularies', vocabulary);
    });
  },

  /** 在单个事务中批量写入：任何一条失败，整批回滚 */
  async saveVocabularies(vocabularies: Vocabulary[]): Promise<void> {
    return wrap('批量保存单词失败，本次导入未写入任何数据', async () => {
      const db = await getDatabase();
      const tx = db.transaction('vocabularies', 'readwrite');
      // put 失败时 IndexedDB 会自动中止整个事务，已写入的条目随之回滚
      await Promise.all([...vocabularies.map((vocabulary) => tx.store.put(vocabulary)), tx.done]);
    });
  },

  async saveWrongQuestion(question: WrongQuestion): Promise<void> {
    return wrap('保存错题记录失败', async () => {
      const db = await getDatabase();
      await db.put('wrongQuestions', question);
    });
  },

  /** 一次答题产生的学习记录、错题与日志在同一事务中写入 */
  async savePractice(records: PracticeWrite): Promise<void> {
    return wrap('保存练习结果失败', async () => {
      const db = await getDatabase();
      const tx = db.transaction(['studyRecords', 'wrongQuestions', 'attemptLogs'], 'readwrite');
      const writes: Promise<unknown>[] = [];
      if (records.studyRecord) writes.push(tx.objectStore('studyRecords').put(records.studyRecord));
      if (records.wrongQuestion) writes.push(tx.objectStore('wrongQuestions').put(records.wrongQuestion));
      if (records.attemptLog) writes.push(tx.objectStore('attemptLogs').put(records.attemptLog));
      await Promise.all([...writes, tx.done]);
    });
  },

  /** 删除单词，并在同一事务内删除其学习记录、错题记录与答题日志 */
  async removeVocabularyCascade(vocabularyId: string): Promise<void> {
    return wrap('删除单词失败', async () => {
      const db = await getDatabase();
      const tx = db.transaction(['vocabularies', 'studyRecords', 'wrongQuestions', 'attemptLogs'], 'readwrite');
      await tx.objectStore('vocabularies').delete(vocabularyId);

      const studyKey = await tx.objectStore('studyRecords').index('by-vocabulary-id').getKey(vocabularyId);
      if (studyKey) await tx.objectStore('studyRecords').delete(studyKey);
      const wrongKey = await tx.objectStore('wrongQuestions').index('by-vocabulary-id').getKey(vocabularyId);
      if (wrongKey) await tx.objectStore('wrongQuestions').delete(wrongKey);
      const logKeys = await tx.objectStore('attemptLogs').index('by-vocabulary-id').getAllKeys(vocabularyId);
      for (const key of logKeys) {
        await tx.objectStore('attemptLogs').delete(key);
      }
      await tx.done;
    });
  },

  async clearAll(): Promise<void> {
    return wrap('清空本地数据失败', async () => {
      const db = await getDatabase();
      const tx = db.transaction(['vocabularies', 'studyRecords', 'wrongQuestions', 'attemptLogs', 'settings'], 'readwrite');
      await Promise.all([
        tx.objectStore('vocabularies').clear(),
        tx.objectStore('studyRecords').clear(),
        tx.objectStore('wrongQuestions').clear(),
        tx.objectStore('attemptLogs').clear(),
        tx.objectStore('settings').clear(),
        tx.done,
      ]);
    });
  },
};
