import * as XLSX from 'xlsx';
import { describe, expect, it } from 'vitest';
import { parseImportFile } from '../features/import-export/excel';
import { commitImportRows, suggestColumnMap, validateImportRows } from '../features/import-export/importValidation';
import type { Vocabulary } from '../types/models';

const existing: Vocabulary[] = [
  {
    id: '1',
    word: 'hello',
    phonetic: '',
    meaning: '你好',
    mnemonic: '',
    example: '',
    exampleMeaning: '',
    notes: '',
    createdAt: '2026-01-01',
    updatedAt: '2026-01-01',
    normalizedWord: 'hello',
  },
];

describe('导入与校验', () => {
  it('可以解析合法 xlsx 文件并自动映射列名', async () => {
    const sheet = XLSX.utils.json_to_sheet([{ 英文: 'World', 中文释义: '世界', 谐音: '沃德' }]);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, sheet, 'Sheet1');
    const output = XLSX.write(workbook, { bookType: 'xlsx', type: 'array' });
    const file = new File([output], 'words.xlsx');
    const parsed = await parseImportFile(file);
    const map = suggestColumnMap(parsed.headers);
    expect(map.word).toBe('英文');
    expect(map.meaning).toBe('中文释义');
  });

  it('可以解析 csv 文件', async () => {
    const file = new File(['word,meaning\nhello,你好'], 'words.csv', { type: 'text/csv' });
    const parsed = await parseImportFile(file);
    expect(parsed.rows).toHaveLength(1);
    expect(parsed.rows[0].word).toBe('hello');
  });

  it('识别不同名称的同义列，并支持手动指定映射', () => {
    const map = suggestColumnMap(['English', 'IPA', '翻译', '记忆提示', '英文例句', '中文例句', '备注']);
    expect(map).toEqual({
      word: 'English',
      phonetic: 'IPA',
      meaning: '翻译',
      mnemonic: '记忆提示',
      example: '英文例句',
      exampleMeaning: '中文例句',
      notes: '备注',
    });

    const unknown = suggestColumnMap(['列A', '列B']);
    expect(unknown.word).toBe('');
    const result = validateImportRows([{ 列A: '  look after ', 列B: '照顾' }], { ...unknown, word: '列A', meaning: '列B' }, []);
    expect(result.validRows).toBe(1);
    expect(result.rows[0].data).toMatchObject({ word: 'look after', meaning: '照顾' });
    expect(result.rows[0].normalizedWord).toBe('look after');
  });

  it('缺失英文时报告具体行号、字段和原因，且不影响其他有效行', () => {
    const map = suggestColumnMap(['word', 'meaning']);
    const result = validateImportRows([{ word: 'apple', meaning: '苹果' }, { word: '  ', meaning: '香蕉' }, { word: 'pear', meaning: '梨' }], map, []);
    expect(result.issues).toEqual([{ rowIndex: 3, field: 'word', message: '英文单词不能为空。' }]);
    expect(result.validRows).toBe(2);
    const { result: commit } = commitImportRows(result.rows, [], 'skip', 'now');
    expect(commit).toEqual({ inserted: 2, updated: 0, skipped: 1 });
  });

  it('会跳过空白行并报告缺失英文和重复项', () => {
    const rows = [
      { word: '', meaning: '' },
      { word: '', meaning: '没有英文' },
      { word: 'HELLO', meaning: '重复' },
      { word: 'hello', meaning: '同批重复' },
    ];
    const result = validateImportRows(rows, {
      word: 'word',
      phonetic: '',
      meaning: 'meaning',
      mnemonic: '',
      example: '',
      exampleMeaning: '',
      notes: '',
    }, existing);
    expect(result.skippedRows).toBe(1);
    expect(result.errorRows).toBe(1);
    expect(result.duplicateRows).toBe(2);
  });

  it('覆盖与补充空字段策略工作正常，取消导入不修改正式词库', () => {
    const rows = validateImportRows([{ word: 'hello', meaning: '你好呀', phonetic: '/h/' }, { word: 'world', meaning: '世界' }], {
      word: 'word',
      phonetic: 'phonetic',
      meaning: 'meaning',
      mnemonic: '',
      example: '',
      exampleMeaning: '',
      notes: '',
    }, existing);
    const overwrite = commitImportRows(rows.rows, existing, 'overwrite', '2026-01-02');
    const fillEmpty = commitImportRows(rows.rows, existing, 'fill-empty', '2026-01-02');
    expect(overwrite.vocabularies.find((item) => item.normalizedWord === 'hello')?.meaning).toBe('你好呀');
    expect(fillEmpty.vocabularies.find((item) => item.normalizedWord === 'hello')?.meaning).toBe('你好');
    expect(existing).toHaveLength(1);
  });
});
