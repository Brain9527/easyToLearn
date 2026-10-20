import * as XLSX from 'xlsx';
import type { ParsedImportFile, Vocabulary } from '../../types/models';

const TEMPLATE_ROWS = [
  {
    word: 'Hello!',
    phonetic: '/həˈləʊ/',
    meaning: '你好',
    mnemonic: '哈喽',
    example: 'Hello, how are you?',
    exampleMeaning: '你好，你好吗？',
    notes: '日常问候',
  },
];

export const SUPPORTED_EXTENSIONS = ['.xlsx', '.xls', '.csv'];

const readFileBuffer = (file: Blob): Promise<ArrayBuffer> => {
  if (typeof file.arrayBuffer === 'function') return file.arrayBuffer();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as ArrayBuffer);
    reader.onerror = () => reject(reader.error ?? new Error('文件读取失败'));
    reader.readAsArrayBuffer(file);
  });
};

/**
 * 解析 Excel / CSV。返回的 rows 与表格行一一对应（含空白行），
 * 因此 rows[i] 对应 Excel 中的第 i + 2 行（第 1 行为表头）。
 */
export const parseImportFile = async (file: File): Promise<ParsedImportFile> => {
  const lowerName = file.name.toLowerCase();
  if (!SUPPORTED_EXTENSIONS.some((ext) => lowerName.endsWith(ext))) {
    throw new Error('不支持的文件格式，请选择 .xlsx、.xls 或 .csv 文件。');
  }
  let matrix: unknown[][];
  try {
    const buffer = await readFileBuffer(file);
    const workbook = lowerName.endsWith('.csv')
      ? XLSX.read(new TextDecoder('utf-8').decode(buffer), { type: 'string' })
      : XLSX.read(buffer, { type: 'array' });
    const sheetName = workbook.SheetNames[0];
    if (!sheetName) throw new Error('文件中没有工作表');
    matrix = XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets[sheetName], {
      header: 1,
      defval: '',
      blankrows: true,
      raw: false,
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`文件解析失败，请确认文件未损坏且格式正确（${reason}）。`);
  }

  const headers = (matrix[0] ?? []).map((item) => String(item ?? '').trim());
  if (headers.every((item) => !item)) {
    throw new Error('未读取到表头，请确认第一行为列名。');
  }
  const body = matrix.slice(1);
  while (body.length > 0 && body[body.length - 1].every((cell) => String(cell ?? '').trim() === '')) {
    body.pop();
  }
  const rows = body.map((line) => {
    const record: Record<string, string> = {};
    headers.forEach((header, index) => {
      if (header && !(header in record)) record[header] = String(line[index] ?? '');
    });
    return record;
  });
  return { fileName: file.name, headers: headers.filter(Boolean), rows };
};

const downloadWorkbook = (workbook: XLSX.WorkBook, name: string): void => {
  XLSX.writeFile(workbook, name);
};

export const downloadTemplate = (): void => {
  const sheet = XLSX.utils.json_to_sheet(TEMPLATE_ROWS);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, 'Template');
  downloadWorkbook(workbook, 'easy-learn-template.xlsx');
};

export const exportVocabularies = (vocabularies: Vocabulary[], name = 'easy-learn-export.xlsx'): void => {
  const rows = vocabularies.map((item) => ({
    word: item.word,
    phonetic: item.phonetic,
    meaning: item.meaning,
    mnemonic: item.mnemonic,
    example: item.example,
    exampleMeaning: item.exampleMeaning,
    notes: item.notes,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
  }));
  const sheet = XLSX.utils.json_to_sheet(rows);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, 'Vocabulary');
  downloadWorkbook(workbook, name);
};
