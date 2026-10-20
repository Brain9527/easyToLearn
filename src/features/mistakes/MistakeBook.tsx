import { useMemo, useState } from 'preact/hooks';
import { AudioButton } from '../../components/AudioButton';
import { EmptyState } from '../../components/EmptyState';
import { formatDateTime } from '../../utils/date';
import type { Vocabulary, WrongHistoryItem, WrongQuestion, WrongQuestionStatus } from '../../types/models';
import { MASTERY_THRESHOLD, WRONG_STATUS_LABELS, mistakeService } from './MistakeService';

interface MistakeBookProps {
  vocabularies: Vocabulary[];
  wrongQuestions: WrongQuestion[];
  onSpeak: (word: string) => Promise<void>;
  onPractice: (ids: string[], reviewMode: boolean) => void;
  onUpdate: (wrongQuestion: WrongQuestion) => Promise<void>;
}

type SortBy = 'wrongCount' | 'recent';
type StatusFilter = 'all' | WrongQuestionStatus;

const RECENT_DAYS = 7;
const HISTORY_LABELS: Record<WrongHistoryItem['action'], string> = {
  wrong: '答错',
  'show-answer': '显示答案',
  'review-correct': '复习答对',
};

const byWrongCount = (left: WrongQuestion, right: WrongQuestion) =>
  right.wrongCount - left.wrongCount || right.lastWrongAt.localeCompare(left.lastWrongAt);
const byRecent = (left: WrongQuestion, right: WrongQuestion) => right.lastWrongAt.localeCompare(left.lastWrongAt);

export function MistakeBook({ vocabularies, wrongQuestions, onSpeak, onPractice, onUpdate }: MistakeBookProps) {
  const [sortBy, setSortBy] = useState<SortBy>('wrongCount');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [hideMastered, setHideMastered] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const vocabularyMap = useMemo(() => new Map(vocabularies.map((item) => [item.id, item])), [vocabularies]);

  const valid = useMemo(() => wrongQuestions.filter((item) => vocabularyMap.has(item.vocabularyId)), [wrongQuestions, vocabularyMap]);
  const active = useMemo(() => valid.filter((item) => item.status !== 'mastered'), [valid]);

  const list = useMemo(
    () =>
      valid
        .filter((item) => statusFilter === 'all' || item.status === statusFilter)
        .filter((item) => !hideMastered || statusFilter === 'mastered' || item.status !== 'mastered')
        .sort(sortBy === 'recent' ? byRecent : byWrongCount),
    [valid, sortBy, statusFilter, hideMastered],
  );

  const ids = (items: WrongQuestion[]) => items.map((item) => item.vocabularyId);
  const recentCutoff = new Date(Date.now() - RECENT_DAYS * 24 * 3600 * 1000).toISOString();
  const recentList = [...active].filter((item) => item.lastWrongAt >= recentCutoff).sort(byRecent);
  const pendingList = active.filter((item) => item.status === 'pending');
  const frequentList = [...active].sort(byWrongCount);

  const toggle = async (item: WrongQuestion) => {
    if (busyId) return;
    setBusyId(item.id);
    try {
      await onUpdate(item.status === 'mastered' ? mistakeService.markPending(item) : mistakeService.markMastered(item));
    } finally {
      setBusyId(null);
    }
  };

  if (valid.length === 0) {
    return <EmptyState title="错题本还是空的" description="在学习模式中答错或显示答案的单词会自动收录到这里，无需手动维护。" />;
  }

  return (
    <div className="stack">
      <div className="card stack">
        <div className="sectionHeader">
          <div>
            <h2>错题本</h2>
            <p>
              共 {valid.length} 个错题，未掌握 {active.length} 个。复习与学习模式共用同一套判题规则；
              在不同复习回合中连续独立答对 {MASTERY_THRESHOLD} 次（不含显示答案）即标记为已掌握。
            </p>
          </div>
        </div>
        <div className="buttonRow">
          <button type="button" className="primaryButton" disabled={active.length === 0} onClick={() => onPractice(ids(frequentList), true)}>
            练习全部未掌握（{active.length}）
          </button>
          <button type="button" className="secondaryButton" disabled={recentList.length === 0} onClick={() => onPractice(ids(recentList), true)}>
            最近 {RECENT_DAYS} 天错误（{recentList.length}）
          </button>
          <button type="button" className="secondaryButton" disabled={frequentList.length === 0} onClick={() => onPractice(ids(frequentList.slice(0, 10)), true)}>
            高频错误优先 10 题
          </button>
          <button type="button" className="secondaryButton" disabled={pendingList.length === 0} onClick={() => onPractice(ids(pendingList), true)}>
            仅待复习（{pendingList.length}）
          </button>
        </div>
        <div className="filtersGrid">
          <select aria-label="错题排序" value={sortBy} onChange={(event) => setSortBy(event.currentTarget.value as SortBy)}>
            <option value="wrongCount">按错误次数排序</option>
            <option value="recent">按最近错误时间排序</option>
          </select>
          <select aria-label="错题状态筛选" value={statusFilter} onChange={(event) => setStatusFilter(event.currentTarget.value as StatusFilter)}>
            <option value="all">全部状态</option>
            {Object.entries(WRONG_STATUS_LABELS).map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
          <label className="checkboxLabel">
            <input type="checkbox" checked={hideMastered} onChange={(event) => setHideMastered(event.currentTarget.checked)} />
            隐藏已掌握
          </label>
        </div>
      </div>

      {list.length === 0 ? (
        <EmptyState title="当前视图没有错题" description="已掌握的错题可能被隐藏，可取消“隐藏已掌握”或切换状态筛选。" />
      ) : (
        <div className="card tableWrap">
          <table>
            <caption className="srOnly">错题列表</caption>
            <thead>
              <tr>
                <th scope="col">英文</th>
                <th scope="col">音标</th>
                <th scope="col">中文释义</th>
                <th scope="col">中文谐音</th>
                <th scope="col">累计错误</th>
                <th scope="col">最近错误</th>
                <th scope="col">最近错误答案</th>
                <th scope="col">复习次数</th>
                <th scope="col">状态</th>
                <th scope="col">操作</th>
              </tr>
            </thead>
            <tbody>
              {list.map((item) => {
                const vocabulary = vocabularyMap.get(item.vocabularyId)!;
                return (
                  <tr key={item.id}>
                    <td data-label="英文"><strong>{vocabulary.word}</strong></td>
                    <td data-label="音标">{vocabulary.phonetic || '-'}</td>
                    <td data-label="中文释义">{vocabulary.meaning || '-'}</td>
                    <td data-label="中文谐音">{vocabulary.mnemonic || '-'}</td>
                    <td data-label="累计错误">{item.wrongCount}</td>
                    <td data-label="最近错误">{item.wrongCount > 0 ? formatDateTime(item.lastWrongAt) : '-'}</td>
                    <td data-label="最近错误答案">{item.lastWrongAnswer ? <code>{item.lastWrongAnswer}</code> : '-'}</td>
                    <td data-label="复习次数">{item.reviewCount}</td>
                    <td data-label="状态">
                      <span className={`badge ${item.status === 'mastered' ? 'success' : item.status === 'pending' ? 'warning' : ''}`}>
                        {WRONG_STATUS_LABELS[item.status]}
                      </span>
                      <div className="mutedText">连续答对 {Math.min(item.consecutiveCorrect, MASTERY_THRESHOLD)}/{MASTERY_THRESHOLD}</div>
                    </td>
                    <td className="rowActions" data-label="操作">
                      <AudioButton label={`播放 ${vocabulary.word} 的发音`} onClick={() => onSpeak(vocabulary.word)} />
                      <button type="button" className="ghostButton" onClick={() => onPractice([item.vocabularyId], true)}>重新练习</button>
                      <button type="button" className="ghostButton" disabled={busyId === item.id} onClick={() => void toggle(item)}>
                        {item.status === 'mastered' ? '重新加入待复习' : '标记已掌握'}
                      </button>
                      <details>
                        <summary>历史（{item.history.length}）</summary>
                        <div className="detailBox">
                          {item.history.length === 0 ? (
                            <p className="mutedText">暂无历史记录</p>
                          ) : (
                            <ul className="historyList">
                              {[...item.history].reverse().map((entry, index) => (
                                <li key={`${entry.at}-${index}`}>
                                  <span>{formatDateTime(entry.at)}</span> · {HISTORY_LABELS[entry.action]}
                                  {entry.answer ? <> · 输入 <code>{entry.answer}</code></> : null}
                                </li>
                              ))}
                            </ul>
                          )}
                          <p className="mutedText">最近复习：{formatDateTime(item.lastReviewedAt)}</p>
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
    </div>
  );
}
