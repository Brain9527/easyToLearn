import { useMemo, useState } from 'preact/hooks';
import { AudioButton } from '../../components/AudioButton';
import { EmptyState } from '../../components/EmptyState';
import { formatDateTime } from '../../utils/date';
import type { StudyRecord, Vocabulary, VocabularyDraft, VocabularyFilters, WrongQuestion } from '../../types/models';
import { vocabularyService } from './VocabularyService';
import { VocabularyForm } from './VocabularyForm';
import { exportVocabularies } from '../import-export/excel';
import { MASTERY_LABELS } from '../learning/LearningSession';

interface VocabularyListProps {
  vocabularies: Vocabulary[];
  studyRecords: StudyRecord[];
  wrongQuestions: WrongQuestion[];
  onSpeak: (word: string) => Promise<void>;
  /** 返回 true 表示保存成功，表单可关闭 */
  onSave: (draft: VocabularyDraft, target?: Vocabulary | null) => Promise<boolean>;
  onDelete: (target: Vocabulary) => void;
  onStartPractice: (ids: string[]) => void;
}

const defaultFilters: VocabularyFilters = {
  wordQuery: '',
  meaningQuery: '',
  mnemonicQuery: '',
  masteryStatus: 'all',
  wrongOnly: 'all',
  sortBy: 'created-desc',
};

const focusImport = () => {
  const section = document.getElementById('excel-import');
  section?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  document.getElementById('excel-import-input')?.focus();
};

export function VocabularyList({
  vocabularies,
  studyRecords,
  wrongQuestions,
  onSpeak,
  onSave,
  onDelete,
  onStartPractice,
}: VocabularyListProps) {
  const [filters, setFilters] = useState<VocabularyFilters>(defaultFilters);
  const [editing, setEditing] = useState<Vocabulary | null>(null);
  const [formOpen, setFormOpen] = useState(false);

  const filtered = useMemo(
    () => vocabularyService.filterVocabularies(vocabularies, studyRecords, wrongQuestions, filters),
    [vocabularies, studyRecords, wrongQuestions, filters],
  );
  const recordsById = useMemo(() => new Map(studyRecords.map((record) => [record.vocabularyId, record])), [studyRecords]);
  const wrongById = useMemo(() => new Map(wrongQuestions.map((item) => [item.vocabularyId, item])), [wrongQuestions]);
  const hasFilter = JSON.stringify(filters) !== JSON.stringify(defaultFilters);

  const openCreate = () => {
    setEditing(null);
    setFormOpen(true);
  };
  const update = (patch: Partial<VocabularyFilters>) => setFilters((current) => ({ ...current, ...patch }));

  return (
    <div className="stack">
      <div className="card stack">
        <div className="sectionHeader">
          <div>
            <h2>单词列表</h2>
            <p>共 {vocabularies.length} 个单词，当前显示 {filtered.length} 个。谐音仅用于辅助记忆，请以发音和音标为准。</p>
          </div>
          <div className="buttonRow">
            <button type="button" className="secondaryButton" disabled={vocabularies.length === 0} onClick={() => exportVocabularies(vocabularies, 'easy-learn-all.xlsx')}>
              导出全部
            </button>
            <button type="button" className="secondaryButton" disabled={filtered.length === 0} onClick={() => exportVocabularies(filtered, 'easy-learn-filtered.xlsx')}>
              导出当前筛选
            </button>
            <button type="button" className="secondaryButton" disabled={filtered.length === 0} onClick={() => onStartPractice(filtered.map((item) => item.id))}>
              练习当前筛选
            </button>
            <button type="button" className="primaryButton" onClick={openCreate}>手动添加</button>
          </div>
        </div>
        <div className="filtersGrid" role="search">
          <input aria-label="按英文搜索" placeholder="按英文搜索" value={filters.wordQuery} onInput={(event) => update({ wordQuery: event.currentTarget.value })} />
          <input aria-label="按中文释义搜索" placeholder="按中文释义搜索" value={filters.meaningQuery} onInput={(event) => update({ meaningQuery: event.currentTarget.value })} />
          <input aria-label="按谐音搜索" placeholder="按谐音搜索" value={filters.mnemonicQuery} onInput={(event) => update({ mnemonicQuery: event.currentTarget.value })} />
          <select aria-label="学习状态筛选" value={filters.masteryStatus} onChange={(event) => update({ masteryStatus: event.currentTarget.value as VocabularyFilters['masteryStatus'] })}>
            <option value="all">全部学习状态</option>
            {Object.entries(MASTERY_LABELS).map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
          <select aria-label="错题筛选" value={filters.wrongOnly} onChange={(event) => update({ wrongOnly: event.currentTarget.value as VocabularyFilters['wrongOnly'] })}>
            <option value="all">全部（含错题）</option>
            <option value="yes">仅错题</option>
            <option value="no">排除错题</option>
          </select>
          <select aria-label="排序方式" value={filters.sortBy} onChange={(event) => update({ sortBy: event.currentTarget.value as VocabularyFilters['sortBy'] })}>
            <option value="created-desc">按添加时间（新→旧）</option>
            <option value="created-asc">按添加时间（旧→新）</option>
            <option value="word-asc">按英文 A-Z</option>
            <option value="word-desc">按英文 Z-A</option>
          </select>
          <button type="button" className="ghostButton" disabled={!hasFilter} onClick={() => setFilters(defaultFilters)}>清空条件</button>
        </div>
      </div>

      {vocabularies.length === 0 ? (
        <EmptyState
          title="词库还是空的"
          description="导入 Excel / CSV 词库，或手动添加几个单词开始练习。"
          action={
            <div className="buttonRow">
              <button type="button" className="primaryButton" onClick={focusImport}>导入 Excel 词库</button>
              <button type="button" className="secondaryButton" onClick={openCreate}>手动添加单词</button>
            </div>
          }
        />
      ) : filtered.length === 0 ? (
        <EmptyState
          title="没有符合条件的单词"
          description="请调整搜索或筛选条件。"
          action={<button type="button" className="secondaryButton" onClick={() => setFilters(defaultFilters)}>清空条件</button>}
        />
      ) : (
        <div className="card tableWrap">
          <table>
            <caption className="srOnly">单词列表</caption>
            <thead>
              <tr>
                <th scope="col">英文</th>
                <th scope="col">音标与谐音</th>
                <th scope="col">发音</th>
                <th scope="col">中文释义</th>
                <th scope="col">学习状态</th>
                <th scope="col">操作</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((item) => {
                const record = recordsById.get(item.id);
                const wrong = wrongById.get(item.id);
                const status = record?.masteryStatus ?? 'new';
                return (
                  <tr key={item.id}>
                    <td data-label="英文">
                      <strong>{item.word}</strong>
                      <div className="mutedText">添加于 {formatDateTime(item.createdAt)}</div>
                    </td>
                    <td data-label="音标与谐音">
                      <div>{item.phonetic || '-'}</div>
                      <div className="mutedText">谐音：{item.mnemonic || '-'}</div>
                    </td>
                    <td data-label="发音"><AudioButton label={`播放 ${item.word} 的发音`} onClick={() => onSpeak(item.word)} /></td>
                    <td data-label="中文释义">{item.meaning || '-'}</td>
                    <td data-label="学习状态">
                      <span className={`badge ${status === 'mastered' ? 'success' : ''}`}>{MASTERY_LABELS[status]}</span>
                      {wrong && wrong.status !== 'mastered' ? <span className="badge warning">错题 ×{wrong.wrongCount}</span> : null}
                      {record ? <div className="mutedText">答题 {record.attempts} 次 · 对 {record.correctCount} · 错 {record.wrongCount}</div> : null}
                    </td>
                    <td className="rowActions" data-label="操作">
                      <button type="button" className="ghostButton" onClick={() => onStartPractice([item.id])}>练习</button>
                      <button type="button" className="ghostButton" onClick={() => { setEditing(item); setFormOpen(true); }}>编辑</button>
                      <details>
                        <summary>详情</summary>
                        <div className="detailBox">
                          <p>例句：{item.example || '-'}</p>
                          <p>例句翻译：{item.exampleMeaning || '-'}</p>
                          <p>备注：{item.notes || '-'}</p>
                          <p className="mutedText">更新于 {formatDateTime(item.updatedAt)}</p>
                          <p className="mutedText">删除将同时移除该词的学习记录、错题记录和答题日志。</p>
                          <button type="button" className="dangerButton" onClick={() => onDelete(item)}>删除该词</button>
                        </div>
                      </details>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <VocabularyForm
        open={formOpen}
        initialValue={editing}
        onCancel={() => setFormOpen(false)}
        onSubmit={async (draft) => {
          const ok = await onSave(draft, editing);
          if (ok) setFormOpen(false);
        }}
      />
    </div>
  );
}
