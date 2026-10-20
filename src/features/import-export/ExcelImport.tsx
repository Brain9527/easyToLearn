import { useMemo, useRef, useState } from 'preact/hooks';
import { AiGeneratePanel } from './AiGeneratePanel';
import { downloadTemplate, parseImportFile } from './excel';
import { commitImportRows, suggestColumnMap, validateImportRows } from './importValidation';
import type {
  ImportColumnMap,
  ImportDuplicateStrategy,
  ImportPreviewRow,
  ImportValidationIssue,
  ParsedImportFile,
  Vocabulary,
} from '../../types/models';

interface ExcelImportProps {
  existing: Vocabulary[];
  /** 仅传入本次新增或更新的词汇；写入失败时应抛出异常 */
  onCommit: (changed: Vocabulary[]) => Promise<void>;
  aiApiKey?: string;
  aiModel?: string;
}

export const IMPORT_FIELD_LABELS: Record<keyof ImportColumnMap, string> = {
  word: '英文',
  phonetic: '音标',
  meaning: '中文释义',
  mnemonic: '中文谐音',
  example: '例句',
  exampleMeaning: '例句翻译',
  notes: '备注',
};

const issueFieldLabel = (field: ImportValidationIssue['field']) => (field === 'row' ? '整行' : IMPORT_FIELD_LABELS[field]);

const ROW_STATUS_LABELS: Record<ImportPreviewRow['status'], string> = {
  valid: '可导入',
  blank: '空行跳过',
  error: '错误',
  duplicate: '重复',
};

const emptyMap: ImportColumnMap = {
  word: '',
  phonetic: '',
  meaning: '',
  mnemonic: '',
  example: '',
  exampleMeaning: '',
  notes: '',
};

const PREVIEW_LIMIT = 8;
const STEPS = ['选择文件', '字段映射', '预览校验', '确认写入'];

type Status = { type: 'info' | 'success' | 'error'; text: string } | null;

export function ExcelImport({ existing, onCommit, aiApiKey = '', aiModel = 'deepseek-chat' }: ExcelImportProps) {
  const [source, setSource] = useState<'file' | 'ai'>('file');
  const [parsed, setParsed] = useState<ParsedImportFile | null>(null);
  const [mapping, setMapping] = useState<ImportColumnMap>(emptyMap);
  const [strategy, setStrategy] = useState<ImportDuplicateStrategy>('skip');
  const [status, setStatus] = useState<Status>(null);
  const [parsing, setParsing] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const validation = useMemo(() => {
    if (!parsed || !mapping.word) return null;
    return validateImportRows(parsed.rows, mapping, existing);
  }, [parsed, mapping, existing]);

  const plan = useMemo(() => {
    if (!validation) return null;
    return commitImportRows(validation.rows, existing, strategy, new Date().toISOString()).result;
  }, [validation, existing, strategy]);

  const step = !parsed ? 0 : !mapping.word ? 1 : 2;

  const reset = () => {
    setParsed(null);
    setMapping(emptyMap);
    if (inputRef.current) inputRef.current.value = '';
  };

  const handleFile = async (file: File | undefined) => {
    if (!file) return;
    setParsing(true);
    setStatus({ type: 'info', text: `正在解析 ${file.name}...` });
    try {
      const nextParsed = await parseImportFile(file);
      if (nextParsed.rows.length === 0) {
        reset();
        setStatus({ type: 'error', text: '文件中没有可读取的数据行，请检查第一行是否为表头。' });
        return;
      }
      setParsed(nextParsed);
      setMapping(suggestColumnMap(nextParsed.headers));
      setStatus({ type: 'info', text: `已解析 ${nextParsed.fileName}（共 ${nextParsed.rows.length} 行），请确认字段映射。` });
    } catch (err) {
      reset();
      setStatus({ type: 'error', text: err instanceof Error ? err.message : '文件解析失败。' });
    } finally {
      setParsing(false);
    }
  };

  const handleCommit = async () => {
    if (!validation || submitting) return;
    setSubmitting(true);
    try {
      const { changed, result } = commitImportRows(validation.rows, existing, strategy, new Date().toISOString());
      if (changed.length === 0) {
        setStatus({ type: 'info', text: `没有需要写入的数据（跳过 ${result.skipped} 行），词库未修改。` });
        return;
      }
      await onCommit(changed);
      reset();
      setStatus({
        type: 'success',
        text: `导入完成：成功 ${result.inserted + result.updated} 条（新增 ${result.inserted}，更新 ${result.updated}），跳过 ${result.skipped} 行。`,
      });
    } catch (err) {
      setStatus({ type: 'error', text: err instanceof Error ? err.message : '写入词库失败，本次导入未生效。' });
    } finally {
      setSubmitting(false);
    }
  };

  const errorIssues = validation?.rows.filter((row) => row.status !== 'blank').flatMap((row) => row.issues) ?? [];

  return (
    <section id="excel-import" className="card stack" aria-labelledby="import-title">
      <div className="sectionHeader">
        <div>
          <h3 id="import-title">导入词库（Excel / AI 生成）</h3>
          <p>支持 .xlsx / .xls / .csv（首行为表头），或用 AI 按主题生成词卡。确认前不会修改词库。</p>
        </div>
        <button type="button" className="secondaryButton" onClick={downloadTemplate}>下载模板</button>
      </div>

      <ol className="stepper" aria-label="导入步骤">
        {STEPS.map((label, index) => (
          <li key={label} className={index < step ? 'done' : index === step ? 'current' : ''} aria-current={index === step ? 'step' : undefined}>
            {label}
          </li>
        ))}
      </ol>

      <div className="toggleGroup" role="radiogroup" aria-label="导入来源">
        <label className="checkboxLabel">
          <input type="radio" name="import-source" checked={source === 'file'} onChange={() => setSource('file')} />
          Excel / CSV 文件
        </label>
        <label className="checkboxLabel">
          <input type="radio" name="import-source" checked={source === 'ai'} onChange={() => setSource('ai')} />
          AI 在线生成
        </label>
      </div>

      {source === 'file' ? (
        <label className="filePicker">
          {parsing
            ? '正在解析...'
            : parsed && !parsed.fileName.startsWith('AI ')
              ? `重新选择文件（当前：${parsed.fileName}）`
              : '选择 XLSX / XLS / CSV 文件'}
          <input
            ref={inputRef}
            id="excel-import-input"
            type="file"
            accept=".xlsx,.xls,.csv"
            disabled={parsing || submitting}
            onChange={(event) => void handleFile(event.currentTarget.files?.[0])}
          />
        </label>
      ) : (
        <AiGeneratePanel
          apiKey={aiApiKey}
          model={aiModel}
          disabled={parsing || submitting}
          existing={existing}
          onGenerated={(nextParsed) => {
            setParsed(nextParsed);
            setMapping(suggestColumnMap(nextParsed.headers));
            if (inputRef.current) inputRef.current.value = '';
          }}
          onStatus={setStatus}
        />
      )}

      {parsed ? <p className="helperText">当前数据来源：{parsed.fileName}（共 {parsed.rows.length} 行）</p> : null}

      {parsed ? (
        <>
          <fieldset className="mappingGrid">
            <legend>字段映射（已自动识别，可手动修改）</legend>
            {(Object.keys(IMPORT_FIELD_LABELS) as (keyof ImportColumnMap)[]).map((field) => (
              <label key={field}>
                {IMPORT_FIELD_LABELS[field]}{field === 'word' ? ' *' : ''}
                <select value={mapping[field]} onChange={(event) => setMapping({ ...mapping, [field]: event.currentTarget.value })}>
                  <option value="">未映射</option>
                  {parsed.headers.map((header) => (
                    <option key={header} value={header}>{header}</option>
                  ))}
                </select>
              </label>
            ))}
          </fieldset>
          {!mapping.word ? <p className="alert warning">请先为“英文”选择对应的列，英文为必填字段。</p> : null}

          <label>
            已存在单词的处理方式
            <select value={strategy} onChange={(event) => setStrategy(event.currentTarget.value as ImportDuplicateStrategy)}>
              <option value="skip">跳过（保留词库中的原数据）</option>
              <option value="overwrite">覆盖（用文件数据替换原数据）</option>
              <option value="fill-empty">仅补充空字段</option>
            </select>
          </label>

          {validation && plan ? (
            <>
              <div className="statsRow" aria-live="polite">
                <span>文件总行数：{validation.totalRows}</span>
                <span>有效行数：{validation.validRows}</span>
                <span>预计成功：{plan.inserted + plan.updated}（新增 {plan.inserted} / 更新 {plan.updated}）</span>
                <span>跳过数：{plan.skipped}（含空行 {validation.skippedRows}）</span>
                <span>重复数：{validation.duplicateRows}（文件内 {validation.duplicateInFileRows} / 与词库 {validation.duplicateExistingRows}）</span>
                <span className={validation.errorRows ? 'errorText' : ''}>错误数：{validation.errorRows}</span>
              </div>

              <div className="tableWrap">
                <table>
                  <caption className="helperText">数据预览（前 {Math.min(PREVIEW_LIMIT, validation.rows.length)} 行）</caption>
                  <thead>
                    <tr>
                      <th scope="col">行号</th>
                      <th scope="col">英文</th>
                      <th scope="col">音标</th>
                      <th scope="col">中文释义</th>
                      <th scope="col">谐音</th>
                      <th scope="col">状态</th>
                    </tr>
                  </thead>
                  <tbody>
                    {validation.rows.slice(0, PREVIEW_LIMIT).map((row) => (
                      <tr key={row.rowIndex}>
                        <td>{row.rowIndex}</td>
                        <td>{row.data.word || '-'}</td>
                        <td>{row.data.phonetic || '-'}</td>
                        <td>{row.data.meaning || '-'}</td>
                        <td>{row.data.mnemonic || '-'}</td>
                        <td>
                          <span className={`badge ${row.status === 'error' ? 'danger' : row.status === 'duplicate' ? 'warning' : ''}`}>
                            {row.status === 'duplicate' && !row.duplicateInFile ? '与词库重复' : ROW_STATUS_LABELS[row.status]}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {errorIssues.length > 0 ? (
                <details className="issueList" open={errorIssues.length <= 5}>
                  <summary>问题明细（{errorIssues.length} 条）</summary>
                  <ul>
                    {errorIssues.map((issue, index) => (
                      <li key={`${issue.rowIndex}-${index}`}>
                        第 {issue.rowIndex} 行 · {issueFieldLabel(issue.field)}：{issue.message}
                      </li>
                    ))}
                  </ul>
                </details>
              ) : null}

              <div className="buttonRow start">
                <button
                  type="button"
                  className="primaryButton"
                  disabled={submitting || plan.inserted + plan.updated === 0}
                  onClick={() => void handleCommit()}
                >
                  {submitting ? '正在写入...' : `确认写入 ${plan.inserted + plan.updated} 条`}
                </button>
                <button
                  type="button"
                  className="secondaryButton"
                  disabled={submitting}
                  onClick={() => {
                    reset();
                    setStatus({ type: 'info', text: '已取消导入，本地词库未修改。' });
                  }}
                >
                  取消导入
                </button>
              </div>
            </>
          ) : null}
        </>
      ) : null}

      {status ? (
        <p className={`feedback ${status.type}`} role={status.type === 'error' ? 'alert' : 'status'}>{status.text}</p>
      ) : null}
    </section>
  );
}
