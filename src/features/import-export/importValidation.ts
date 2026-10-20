import { createId } from '../../utils/id';
import { normalizeWord, trimValue, isBlankRow } from '../../utils/text';
import type {
  ImportColumnMap,
  ImportCommitResult,
  ImportDuplicateStrategy,
  ImportPreviewRow,
  ImportValidationIssue,
  ImportValidationResult,
  Vocabulary,
  VocabularyDraft,
} from '../../types/models';

export const IMPORT_COLUMN_ALIASES: Record<keyof ImportColumnMap, string[]> = {
  word: ['word', '英文', '英语', '单词', '词汇', 'english'],
  phonetic: ['phonetic', '音标', '国际音标', 'ipa'],
  meaning: ['meaning', '中文', '中文意思', '中文释义', '释义', '翻译'],
  mnemonic: ['mnemonic', '谐音', '中文谐音', '发音谐音', '记忆提示'],
  example: ['example', '例句', '英文例句'],
  exampleMeaning: ['examplemeaning', '例句翻译', '中文例句'],
  notes: ['notes', '备注'],
};

const fieldOrder: (keyof ImportColumnMap)[] = ['word', 'phonetic', 'meaning', 'mnemonic', 'example', 'exampleMeaning', 'notes'];

export const suggestColumnMap = (headers: string[]): ImportColumnMap => {
  const normalizedHeaders = headers.map((header) => header.trim().toLowerCase());
  return fieldOrder.reduce<ImportColumnMap>((acc, field) => {
    const matchedIndex = normalizedHeaders.findIndex((header) => IMPORT_COLUMN_ALIASES[field].includes(header));
    acc[field] = matchedIndex >= 0 ? headers[matchedIndex] : '';
    return acc;
  }, {
    word: '',
    phonetic: '',
    meaning: '',
    mnemonic: '',
    example: '',
    exampleMeaning: '',
    notes: '',
  });
};

export const rowToDraft = (row: Record<string, string>, map: ImportColumnMap): VocabularyDraft => ({
  word: trimValue(row[map.word]),
  phonetic: trimValue(row[map.phonetic]),
  meaning: trimValue(row[map.meaning]),
  mnemonic: trimValue(row[map.mnemonic]),
  example: trimValue(row[map.example]),
  exampleMeaning: trimValue(row[map.exampleMeaning]),
  notes: trimValue(row[map.notes]),
});

export const validateImportRows = (
  rows: Record<string, string>[],
  map: ImportColumnMap,
  existing: Vocabulary[],
): ImportValidationResult => {
  const issues: ImportValidationIssue[] = [];
  const existingByWord = new Map(existing.map((item) => [item.normalizedWord, item]));
  const seenInFile = new Map<string, number>();
  const previewRows: ImportPreviewRow[] = rows.map((row, index) => {
    const rowIndex = index + 2;
    if (isBlankRow(row)) {
      return {
        rowIndex,
        data: rowToDraft(row, map),
        normalizedWord: '',
        duplicateInFile: false,
        existingMatch: null,
        status: 'blank',
        issues: [{ rowIndex, field: 'row', message: '整行为空，已跳过。' }],
      };
    }

    const data = rowToDraft(row, map);
    const rowIssues: ImportValidationIssue[] = [];
    const normalized = normalizeWord(data.word);
    if (!normalized) {
      rowIssues.push({ rowIndex, field: 'word', message: '英文单词不能为空。' });
    }

    const duplicateRow = normalized ? seenInFile.get(normalized) : undefined;
    if (normalized && duplicateRow) {
      rowIssues.push({ rowIndex, field: 'word', message: `与第 ${duplicateRow} 行重复。` });
    }
    if (normalized && !duplicateRow) {
      seenInFile.set(normalized, rowIndex);
    }

    const existingMatch = normalized ? existingByWord.get(normalized) ?? null : null;
    const status =
      rowIssues.length > 0 ? (duplicateRow ? 'duplicate' : 'error') : existingMatch ? 'duplicate' : 'valid';
    issues.push(...rowIssues);
    return {
      rowIndex,
      data,
      normalizedWord: normalized,
      duplicateInFile: Boolean(duplicateRow),
      existingMatch,
      status,
      issues: rowIssues,
    };
  });

  const duplicateInFileRows = previewRows.filter((row) => row.duplicateInFile).length;
  const duplicateExistingRows = previewRows.filter((row) => !row.duplicateInFile && row.existingMatch).length;

  return {
    totalRows: rows.length,
    validRows: previewRows.filter((row) => row.status === 'valid' || (row.status === 'duplicate' && !row.duplicateInFile)).length,
    skippedRows: previewRows.filter((row) => row.status === 'blank').length,
    duplicateRows: duplicateInFileRows + duplicateExistingRows,
    duplicateInFileRows,
    duplicateExistingRows,
    errorRows: previewRows.filter((row) => row.status === 'error').length,
    rows: previewRows,
    issues,
  };
};

export const commitImportRows = (
  rows: ImportPreviewRow[],
  existing: Vocabulary[],
  strategy: ImportDuplicateStrategy,
  now: string,
): { vocabularies: Vocabulary[]; changed: Vocabulary[]; result: ImportCommitResult } => {
  const nextMap = new Map(existing.map((item) => [item.normalizedWord, item]));
  const changedKeys = new Set<string>();
  let inserted = 0;
  let updated = 0;
  let skipped = 0;

  for (const row of rows) {
    if (row.status === 'blank' || row.status === 'error' || !row.normalizedWord) {
      skipped += 1;
      continue;
    }
    const current = nextMap.get(row.normalizedWord);
    if (!current) {
      nextMap.set(row.normalizedWord, {
        id: createId('vocab'),
        word: row.data.word,
        phonetic: row.data.phonetic ?? '',
        meaning: row.data.meaning ?? '',
        mnemonic: row.data.mnemonic ?? '',
        example: row.data.example ?? '',
        exampleMeaning: row.data.exampleMeaning ?? '',
        notes: row.data.notes ?? '',
        createdAt: now,
        updatedAt: now,
        normalizedWord: row.normalizedWord,
      });
      changedKeys.add(row.normalizedWord);
      inserted += 1;
      continue;
    }

    if (strategy === 'skip' || row.duplicateInFile) {
      skipped += 1;
      continue;
    }

    const merged = strategy === 'overwrite'
      ? {
          ...current,
          word: row.data.word,
          phonetic: row.data.phonetic ?? '',
          meaning: row.data.meaning ?? '',
          mnemonic: row.data.mnemonic ?? '',
          example: row.data.example ?? '',
          exampleMeaning: row.data.exampleMeaning ?? '',
          notes: row.data.notes ?? '',
        }
      : {
          ...current,
          phonetic: current.phonetic || row.data.phonetic || '',
          meaning: current.meaning || row.data.meaning || '',
          mnemonic: current.mnemonic || row.data.mnemonic || '',
          example: current.example || row.data.example || '',
          exampleMeaning: current.exampleMeaning || row.data.exampleMeaning || '',
          notes: current.notes || row.data.notes || '',
        };
    nextMap.set(row.normalizedWord, { ...merged, updatedAt: now });
    changedKeys.add(row.normalizedWord);
    updated += 1;
  }

  return {
    vocabularies: Array.from(nextMap.values()),
    changed: Array.from(changedKeys, (key) => nextMap.get(key) as Vocabulary),
    result: { inserted, updated, skipped },
  };
};
