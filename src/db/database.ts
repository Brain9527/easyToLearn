import { DBSchema, IDBPDatabase, openDB } from 'idb';
import type { AttemptLog, StudyRecord, UserSettings, Vocabulary, WrongQuestion } from '../types/models';
import { LATEST_DB_VERSION, runMigrations } from './migrations';

export interface EasyLearnDB extends DBSchema {
  vocabularies: {
    key: string;
    value: Vocabulary;
    indexes: {
      'by-normalized-word': string;
      'by-created-at': string;
    };
  };
  studyRecords: {
    key: string;
    value: StudyRecord;
    indexes: {
      'by-vocabulary-id': string;
      'by-mastery-status': string;
    };
  };
  wrongQuestions: {
    key: string;
    value: WrongQuestion;
    indexes: {
      'by-vocabulary-id': string;
      'by-status': string;
      'by-last-wrong-at': string;
    };
  };
  attemptLogs: {
    key: string;
    value: AttemptLog;
    indexes: {
      'by-vocabulary-id': string;
      'by-at': string;
    };
  };
  settings: {
    key: string;
    value: UserSettings & { id: string };
  };
}

export const DB_NAME = 'easy-learn-db';
export const SETTINGS_KEY = 'user-settings';

let dbPromise: Promise<IDBPDatabase<EasyLearnDB>> | null = null;

export const defaultSettings: UserSettings = {
  speechVoiceURI: '',
  speechRate: 0.9,
  speechAutoPlay: false,
  playSuccessSound: true,
  showPhonetic: true,
  answerIgnorePunctuation: false,
  muscleMemoryMode: false,
  learnCount: 10,
  learnScope: 'all',
  learnOrder: 'sequential',
  aiApiKey: '',
  aiModel: 'deepseek-chat',
};

export const getDatabase = async (): Promise<IDBPDatabase<EasyLearnDB>> => {
  if (typeof indexedDB === 'undefined') {
    throw new Error('当前浏览器不支持 IndexedDB');
  }
  if (!dbPromise) {
    dbPromise = openDB<EasyLearnDB>(DB_NAME, LATEST_DB_VERSION, {
      upgrade(database, oldVersion, _newVersion, transaction) {
        runMigrations(database, oldVersion, transaction);
      },
      blocking() {
        // 其他标签页需要升级数据库时，关闭当前连接，下次访问时重新打开
        void dbPromise?.then((db) => db.close());
        dbPromise = null;
      },
    }).catch((error: unknown) => {
      dbPromise = null;
      throw error;
    });
  }

  return dbPromise;
};

/** 关闭并丢弃当前连接（测试中用于模拟页面刷新） */
export const resetDatabaseConnection = async (): Promise<void> => {
  if (dbPromise) {
    const current = dbPromise;
    dbPromise = null;
    try {
      (await current).close();
    } catch {
      // 打开失败的连接无需关闭
    }
  }
};
