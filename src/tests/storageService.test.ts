import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetDatabaseConnection } from '../db/database';
import { commitImportRows, suggestColumnMap, validateImportRows } from '../features/import-export/importValidation';
import { createStudyRecord } from '../features/learning/LearningSession';
import { mistakeService } from '../features/mistakes/MistakeService';
import { StorageError, storageService } from '../services/storageService';
import { makeVocabulary } from './fixtures';

beforeEach(async () => {
  await storageService.clearAll();
});

afterEach(async () => {
  vi.unstubAllGlobals();
  await resetDatabaseConnection();
});

describe('本地持久化', () => {
  it('刷新（重新打开数据库连接）后数据仍然存在', async () => {
    const hello = makeVocabulary('hello');
    await storageService.saveVocabularies([hello, makeVocabulary('world')]);
    const wrong = mistakeService.recordWrong(null, hello.id, 'helo', 'now');
    await storageService.savePractice({ studyRecord: { ...createStudyRecord(hello.id), wrongCount: 1 }, wrongQuestion: wrong });
    await storageService.saveSettings({ ...(await storageService.getBundle()).settings, speechRate: 0.85 });

    await resetDatabaseConnection();
    const bundle = await storageService.getBundle();
    expect(bundle.vocabularies.map((item) => item.word).sort()).toEqual(['hello', 'world']);
    expect(bundle.wrongQuestions).toHaveLength(1);
    expect(bundle.wrongQuestions[0]).toMatchObject({ vocabularyId: hello.id, wrongCount: 1, lastWrongAnswer: 'helo' });
    expect(bundle.studyRecords[0].wrongCount).toBe(1);
    expect(bundle.settings.speechRate).toBe(0.85);
  });

  it('错题多次写入只保留同一条记录并累计', async () => {
    const hello = makeVocabulary('hello');
    await storageService.saveVocabulary(hello);
    let wrong = mistakeService.recordWrong(null, hello.id, 'a', 'now');
    await storageService.savePractice({ wrongQuestion: wrong });
    wrong = mistakeService.recordWrong(wrong, hello.id, 'b', 'now');
    await storageService.savePractice({ wrongQuestion: wrong });
    const bundle = await storageService.getBundle();
    expect(bundle.wrongQuestions).toHaveLength(1);
    expect(bundle.wrongQuestions[0].wrongCount).toBe(2);
  });

  it('删除词汇时级联删除学习记录、错题与答题日志', async () => {
    const hello = makeVocabulary('hello');
    const world = makeVocabulary('world');
    await storageService.saveVocabularies([hello, world]);
    await storageService.savePractice({
      studyRecord: createStudyRecord(hello.id),
      wrongQuestion: mistakeService.recordWrong(null, hello.id, 'x', 'now'),
      attemptLog: { id: 'log1', vocabularyId: hello.id, sessionId: 's', at: 'now', correct: false },
    });
    await storageService.savePractice({ studyRecord: createStudyRecord(world.id) });

    await storageService.removeVocabularyCascade(hello.id);
    const bundle = await storageService.getBundle();
    expect(bundle.vocabularies.map((item) => item.id)).toEqual([world.id]);
    expect(bundle.studyRecords.map((item) => item.vocabularyId)).toEqual([world.id]);
    expect(bundle.wrongQuestions).toHaveLength(0);
    expect(bundle.attemptLogs).toHaveLength(0);
  });

  it('批量导入事务原子：任意一条失败则整批不写入', async () => {
    await storageService.saveVocabulary(makeVocabulary('hello'));
    const conflict = makeVocabulary('hello', { id: 'another-id' });
    await expect(storageService.saveVocabularies([makeVocabulary('apple'), conflict])).rejects.toBeInstanceOf(StorageError);
    const bundle = await storageService.getBundle();
    expect(bundle.vocabularies.map((item) => item.word)).toEqual(['hello']);
  });

  it('IndexedDB 不可用时给出清晰的中文错误', async () => {
    await resetDatabaseConnection();
    vi.stubGlobal('indexedDB', undefined);
    await expect(storageService.getBundle()).rejects.toThrow(/读取本地数据失败.*不支持 IndexedDB/);
  });

  it('取消导入（只做预览和校验、未确认写入）不修改正式词库', async () => {
    await storageService.saveVocabulary(makeVocabulary('hello', { meaning: '你好' }));
    const before = await storageService.getBundle();
    const rows = [{ word: 'hello', meaning: '新释义' }, { word: 'world', meaning: '世界' }];
    const validation = validateImportRows(rows, suggestColumnMap(['word', 'meaning']), before.vocabularies);
    commitImportRows(validation.rows, before.vocabularies, 'overwrite', 'now');
    // 用户点击取消：不调用 saveVocabularies
    const after = await storageService.getBundle();
    expect(after.vocabularies).toEqual(before.vocabularies);
  });

  it('确认导入后写入数据库', async () => {
    const before = await storageService.getBundle();
    const validation = validateImportRows([{ word: 'world', meaning: '世界' }], suggestColumnMap(['word', 'meaning']), before.vocabularies);
    const { changed } = commitImportRows(validation.rows, before.vocabularies, 'skip', 'now');
    await storageService.saveVocabularies(changed);
    await resetDatabaseConnection();
    const after = await storageService.getBundle();
    expect(after.vocabularies.map((item) => item.word)).toEqual(['world']);
  });
});
