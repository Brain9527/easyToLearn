import type { IDBPDatabase, IDBPTransaction, StoreNames } from 'idb';
import type { EasyLearnDB } from './database';

type UpgradeTx = IDBPTransaction<EasyLearnDB, StoreNames<EasyLearnDB>[], 'versionchange'>;

/**
 * 按版本号依次执行的迁移。新增版本时在数组末尾追加，不要修改已发布的迁移。
 * migrations[i] 负责把数据库从版本 i 升级到 i + 1。
 */
const migrations: ((db: IDBPDatabase<EasyLearnDB>, tx: UpgradeTx) => void)[] = [
  // v0 -> v1：基础仓库
  (db) => {
    const vocabularyStore = db.createObjectStore('vocabularies', { keyPath: 'id' });
    vocabularyStore.createIndex('by-normalized-word', 'normalizedWord', { unique: true });
    vocabularyStore.createIndex('by-created-at', 'createdAt');

    const studyStore = db.createObjectStore('studyRecords', { keyPath: 'id' });
    studyStore.createIndex('by-vocabulary-id', 'vocabularyId', { unique: true });
    studyStore.createIndex('by-mastery-status', 'masteryStatus');

    const wrongStore = db.createObjectStore('wrongQuestions', { keyPath: 'id' });
    wrongStore.createIndex('by-vocabulary-id', 'vocabularyId', { unique: true });
    wrongStore.createIndex('by-status', 'status');
    wrongStore.createIndex('by-last-wrong-at', 'lastWrongAt');

    db.createObjectStore('settings', { keyPath: 'id' });
  },
  // v1 -> v2：答题日志，用于准确统计今日答题与正确率
  (db) => {
    const attemptStore = db.createObjectStore('attemptLogs', { keyPath: 'id' });
    attemptStore.createIndex('by-vocabulary-id', 'vocabularyId');
    attemptStore.createIndex('by-at', 'at');
  },
];

export const LATEST_DB_VERSION = migrations.length;

export const runMigrations = (db: IDBPDatabase<EasyLearnDB>, oldVersion: number, tx: UpgradeTx): void => {
  for (let version = oldVersion; version < migrations.length; version += 1) {
    migrations[version](db, tx);
  }
};
