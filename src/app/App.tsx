import { useEffect, useMemo, useState } from 'preact/hooks';
import { AppLayout, type AppView } from '../components/AppLayout';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { defaultSettings } from '../db/database';
import { BuiltinLibraryDialog } from '../features/builtin-library/BuiltinLibraryDialog';
import { ExcelImport } from '../features/import-export/ExcelImport';
import { LearningPage, type LearningLaunchRequest, type PracticePersistPayload } from '../features/learning/LearningPage';
import { MistakeBook } from '../features/mistakes/MistakeBook';
import { VocabularyList } from '../features/vocabulary/VocabularyList';
import { vocabularyService } from '../features/vocabulary/VocabularyService';
import {
  ACCENT_LABELS,
  SPEECH_SOURCE_LABEL,
  speechService,
  type SpeechAccent,
  type SpeechVoiceOption,
} from '../services/speechService';
import { storageService, StorageError } from '../services/storageService';
import type { AppDataBundle, UserSettings, Vocabulary, VocabularyDraft, WrongQuestion } from '../types/models';
import { normalizeWord } from '../utils/text';

const pageMeta: Record<AppView, { title: string; subtitle: string }> = {
  vocabulary: { title: '单词列表', subtitle: '统一管理词库、搜索筛选、导入导出与发音播放。' },
  learning: { title: '学习', subtitle: '根据中文释义、发音与提示完成英文拼写训练。' },
  mistakes: { title: '错题本', subtitle: '自动沉淀错题，按规则复习并逐步掌握。' },
};

const createEmptyBundle = (): AppDataBundle => ({
  vocabularies: [],
  studyRecords: [],
  wrongQuestions: [],
  attemptLogs: [],
  settings: { ...defaultSettings },
});

const errorText = (err: unknown, fallback: string) => (err instanceof Error && err.message ? err.message : fallback);

const upsertById = <T extends { id: string }>(list: T[], item: T): T[] =>
  list.some((entry) => entry.id === item.id) ? list.map((entry) => (entry.id === item.id ? item : entry)) : [...list, item];

export function App() {
  const [view, setView] = useState<AppView>('vocabulary');
  const [bundle, setBundle] = useState<AppDataBundle>(createEmptyBundle);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Vocabulary | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);
  const [voices, setVoices] = useState<SpeechVoiceOption[]>([]);
  const [launchRequest, setLaunchRequest] = useState<LearningLaunchRequest | null>(null);
  const [showApiKey, setShowApiKey] = useState(false);
  const [showBuiltinLibrary, setShowBuiltinLibrary] = useState(false);

  const notify = (type: 'success' | 'error', text: string) => setMessage({ type, text });

  const loadBundle = async () => {
    setLoading(true);
    setError('');
    try {
      setBundle(await storageService.getBundle());
    } catch (err) {
      setError(err instanceof StorageError ? err.message : '读取应用数据失败。');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadBundle();
    const updateVoices = () => setVoices(speechService.getVoiceOptions());
    updateVoices();
    const unsubscribe = speechService.onVoicesChanged(updateVoices);
    return () => {
      unsubscribe();
      speechService.stop();
    };
  }, []);

  useEffect(() => {
    if (!message) return undefined;
    const timer = window.setTimeout(() => setMessage(null), 4000);
    return () => window.clearTimeout(timer);
  }, [message]);

  // 首次打开（词库为空且未关闭过）时提示用户从内置词库中选择性导入
  useEffect(() => {
    if (loading) return;
    if (bundle.vocabularies.length > 0) return;
    try {
      if (window.localStorage.getItem('builtinLibraryPromptDismissed') === '1') return;
    } catch {
      /* localStorage 不可用则忽略 */
    }
    setShowBuiltinLibrary(true);
  }, [loading, bundle.vocabularies.length]);

  const closeBuiltinLibrary = () => {
    setShowBuiltinLibrary(false);
    try {
      window.localStorage.setItem('builtinLibraryPromptDismissed', '1');
    } catch {
      /* ignore */
    }
  };

  const stats = useMemo(
    () => vocabularyService.buildStats(bundle.vocabularies, bundle.studyRecords, bundle.wrongQuestions, bundle.attemptLogs),
    [bundle],
  );

  const topStats = [
    { label: '词库总量', value: stats.vocabularyCount },
    { label: '已掌握', value: stats.masteredWordCount },
    { label: '待复习', value: stats.pendingMistakeCount },
    { label: '累计答题', value: stats.totalAttempts },
  ];

  const voiceGroups = useMemo(() => {
    const groups = new Map<SpeechAccent, SpeechVoiceOption[]>();
    voices.forEach((voice) => groups.set(voice.accent, [...(groups.get(voice.accent) ?? []), voice]));
    return Array.from(groups.entries());
  }, [voices]);

  const updateSettings = async (next: UserSettings) => {
    try {
      await storageService.saveSettings(next);
      setBundle((current) => ({ ...current, settings: next }));
    } catch (err) {
      notify('error', errorText(err, '保存设置失败。'));
      throw err;
    }
  };

  const changeSetting = (patch: Partial<UserSettings>) => {
    updateSettings({ ...bundle.settings, ...patch }).catch(() => undefined);
  };

  const handleSpeak = async (word: string) => {
    try {
      await speechService.speak(word, bundle.settings.speechVoiceURI, bundle.settings.speechRate);
    } catch (err) {
      notify('error', errorText(err, '播放发音失败。'));
    }
  };

  const saveVocabulary = async (draft: VocabularyDraft, target?: Vocabulary | null): Promise<boolean> => {
    const normalized = normalizeWord(draft.word);
    const duplicate = bundle.vocabularies.find((item) => item.normalizedWord === normalized && item.id !== target?.id);
    if (duplicate) {
      notify('error', `“${duplicate.word}”已存在，请直接编辑原词或更换拼写。`);
      return false;
    }
    const now = new Date().toISOString();
    const next = target ? vocabularyService.mergeDraft(target, draft, now) : vocabularyService.createFromDraft(draft, now);
    try {
      await storageService.saveVocabulary(next);
    } catch (err) {
      notify('error', errorText(err, '保存单词失败。'));
      return false;
    }
    setBundle((current) => ({
      ...current,
      vocabularies: target
        ? current.vocabularies.map((item) => (item.id === target.id ? next : item))
        : [next, ...current.vocabularies],
    }));
    notify('success', target ? '单词已更新。' : '单词已添加。');
    return true;
  };

  /** 写入失败时抛出，由学习页展示错误 */
  const persistPractice = async ({ studyRecord, wrongQuestion, attemptLog }: PracticePersistPayload) => {
    await storageService.savePractice({ studyRecord, wrongQuestion, attemptLog });
    setBundle((current) => ({
      ...current,
      studyRecords: upsertById(current.studyRecords, studyRecord),
      wrongQuestions: wrongQuestion ? upsertById(current.wrongQuestions, wrongQuestion) : current.wrongQuestions,
      attemptLogs: attemptLog ? [...current.attemptLogs, attemptLog] : current.attemptLogs,
    }));
  };

  const importVocabularies = async (changed: Vocabulary[]) => {
    await storageService.saveVocabularies(changed);
    setBundle((current) => {
      const map = new Map(current.vocabularies.map((item) => [item.id, item]));
      changed.forEach((item) => map.set(item.id, item));
      return { ...current, vocabularies: Array.from(map.values()) };
    });
  };

  const launch = (ids: string[], reviewMode: boolean) => {
    setView('learning');
    setLaunchRequest({ ids, reviewMode, stamp: `${Date.now()}-${Math.random()}` });
  };

  const aside = (
    <div className="stack">
      <section className="card stack" aria-labelledby="stats-title">
        <h3 id="stats-title">学习统计</h3>
        <dl className="statsColumn">
          <div><dt>已学习词汇</dt><dd>{stats.studiedWordCount}</dd></div>
          <div><dt>今日学习单词</dt><dd>{stats.todayStudiedCount}</dd></div>
          <div><dt>今日答题</dt><dd>{stats.todayAttempts} 次</dd></div>
          <div><dt>今日正确率</dt><dd>{stats.todayAttempts === 0 ? '-' : `${stats.todayAccuracy}%`}</dd></div>
        </dl>
        <p className="helperText">今日正确率 = 今日答对提交次数 {stats.todayCorrect} ÷ 今日全部提交次数 {stats.todayAttempts}（不含跳过与显示答案）。</p>
      </section>
      <ExcelImport
        existing={bundle.vocabularies}
        onCommit={importVocabularies}
        aiApiKey={bundle.settings.aiApiKey}
        aiModel={bundle.settings.aiModel}
        onOpenBuiltinLibrary={() => setShowBuiltinLibrary(true)}
      />
      <section className="card stack" aria-labelledby="ai-settings-title">
        <h3 id="ai-settings-title">AI 在线生成设置</h3>
        <label>
          DeepSeek API Key
          <input
            type={showApiKey ? 'text' : 'password'}
            value={bundle.settings.aiApiKey}
            placeholder="sk-..."
            autoComplete="off"
            spellcheck={false}
            onChange={(event) => changeSetting({ aiApiKey: event.currentTarget.value.trim() })}
          />
        </label>
        <div className="buttonRow start">
          <button type="button" className="secondaryButton" onClick={() => setShowApiKey((value) => !value)}>
            {showApiKey ? '隐藏 Key' : '显示 Key'}
          </button>
          <button
            type="button"
            className="secondaryButton"
            disabled={!bundle.settings.aiApiKey}
            onClick={() => changeSetting({ aiApiKey: '' })}
          >
            清除 Key
          </button>
        </div>
        <label>
          模型
          <select value={bundle.settings.aiModel} onChange={(event) => changeSetting({ aiModel: event.currentTarget.value })}>
            <option value="deepseek-chat">deepseek-chat（推荐，速度快）</option>
            <option value="deepseek-reasoner">deepseek-reasoner（推理模型，较慢）</option>
          </select>
        </label>
        <p className="helperText">
          Key 仅保存在本机浏览器（IndexedDB），由浏览器直接请求 DeepSeek，费用计入你的 DeepSeek 账户。请勿在公共电脑上保存 Key。
        </p>
      </section>
      <section className="card stack" aria-labelledby="settings-title">
        <h3 id="settings-title">发音与判题设置</h3>
        <label>
          英语语音（{SPEECH_SOURCE_LABEL}）
          <select value={bundle.settings.speechVoiceURI} onChange={(event) => changeSetting({ speechVoiceURI: event.currentTarget.value })}>
            <option value="">自动选择英语语音</option>
            {voiceGroups.map(([accent, list]) => (
              <optgroup key={accent} label={ACCENT_LABELS[accent]}>
                {list.map((voice) => (
                  <option key={voice.voiceURI} value={voice.voiceURI}>{voice.name} ({voice.lang})</option>
                ))}
              </optgroup>
            ))}
          </select>
        </label>
        {!speechService.isSupported() ? (
          <p className="alert warning">当前浏览器不支持语音合成，可参考音标和谐音学习。</p>
        ) : voices.length === 0 ? (
          <p className="helperText">暂未检测到英语语音，播放时将使用浏览器默认语音。</p>
        ) : null}
        <label>
          语速：{bundle.settings.speechRate.toFixed(2)}（推荐 0.85～0.95）
          <input
            type="range"
            min="0.6"
            max="1.2"
            step="0.05"
            value={bundle.settings.speechRate}
            onChange={(event) => changeSetting({ speechRate: Number(event.currentTarget.value) })}
          />
        </label>
        <button type="button" className="secondaryButton" onClick={() => void handleSpeak('Hello, nice to meet you.')}>试听当前语音</button>
        <label className="toggleItem">
          <input type="checkbox" checked={bundle.settings.answerIgnorePunctuation} onChange={(event) => changeSetting({ answerIgnorePunctuation: event.currentTarget.checked })} />
          判题时忽略标点（默认关闭）
        </label>
        <p className="helperText">学习相关的题量、范围、音效等设置在“学习”页配置，均自动保存。</p>
        <button type="button" className="dangerButton" onClick={() => setConfirmClear(true)}>清空全部本地数据</button>
      </section>
    </div>
  );

  if (loading) {
    return <div className="appLoading" role="status">正在加载本地词库与学习记录...</div>;
  }

  if (error) {
    return (
      <div className="appLoading stack" role="alert">
        <p>{error}</p>
        <button type="button" className="primaryButton" onClick={() => void loadBundle()}>重新加载</button>
      </div>
    );
  }

  return (
    <>
      <AppLayout
        view={view}
        onChangeView={setView}
        title={pageMeta[view].title}
        subtitle={pageMeta[view].subtitle}
        stats={topStats}
        aside={aside}
      >
        {message ? (
          <div className={`toast ${message.type}`} role={message.type === 'error' ? 'alert' : 'status'}>
            <span>{message.text}</span>
            <button type="button" className="ghostButton" aria-label="关闭提示" onClick={() => setMessage(null)}>×</button>
          </div>
        ) : null}
        {view === 'vocabulary' ? (
          <VocabularyList
            vocabularies={bundle.vocabularies}
            studyRecords={bundle.studyRecords}
            wrongQuestions={bundle.wrongQuestions}
            onSpeak={handleSpeak}
            onSave={saveVocabulary}
            onDelete={(target) => setDeleteTarget(target)}
            onStartPractice={(ids) => launch(ids, false)}
          />
        ) : null}
        {view === 'learning' ? (
          <LearningPage
            vocabularies={bundle.vocabularies}
            studyRecords={bundle.studyRecords}
            wrongQuestions={bundle.wrongQuestions}
            settings={bundle.settings}
            launchRequest={launchRequest}
            onSpeak={handleSpeak}
            onPersist={persistPractice}
            onUpdateSettings={updateSettings}
            onGoVocabulary={() => setView('vocabulary')}
            onRestartMistakes={() =>
              launch(
                bundle.wrongQuestions.filter((item) => item.status !== 'mastered').map((item) => item.vocabularyId),
                true,
              )
            }
          />
        ) : null}
        {view === 'mistakes' ? (
          <MistakeBook
            vocabularies={bundle.vocabularies}
            wrongQuestions={bundle.wrongQuestions}
            onSpeak={handleSpeak}
            onPractice={launch}
            onUpdate={async (wrongQuestion: WrongQuestion) => {
              try {
                await storageService.saveWrongQuestion(wrongQuestion);
                setBundle((current) => ({ ...current, wrongQuestions: upsertById(current.wrongQuestions, wrongQuestion) }));
                notify('success', '错题状态已更新。');
              } catch (err) {
                notify('error', errorText(err, '更新错题状态失败。'));
              }
            }}
          />
        ) : null}
      </AppLayout>

      {showBuiltinLibrary ? (
        <BuiltinLibraryDialog
          existing={bundle.vocabularies}
          onImport={importVocabularies}
          onClose={closeBuiltinLibrary}
          onNotify={notify}
        />
      ) : null}

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        title={`删除单词“${deleteTarget?.word ?? ''}”`}
        description="删除后将同时永久移除该词的学习记录、错题记录和答题日志，统计数据会随之减少。此操作仅影响当前浏览器，且无法撤销。"
        confirmText="确认删除"
        onCancel={() => setDeleteTarget(null)}
        onConfirm={async () => {
          if (!deleteTarget) return;
          const id = deleteTarget.id;
          try {
            await storageService.removeVocabularyCascade(id);
            setBundle((current) => ({
              ...current,
              vocabularies: current.vocabularies.filter((item) => item.id !== id),
              studyRecords: current.studyRecords.filter((item) => item.vocabularyId !== id),
              wrongQuestions: current.wrongQuestions.filter((item) => item.vocabularyId !== id),
              attemptLogs: current.attemptLogs.filter((item) => item.vocabularyId !== id),
            }));
            notify('success', '单词及其关联记录已删除。');
          } catch (err) {
            notify('error', errorText(err, '删除单词失败。'));
          } finally {
            setDeleteTarget(null);
          }
        }}
      />
      <ConfirmDialog
        open={confirmClear}
        title="清空本地数据"
        description="这会永久删除当前浏览器中的词库、学习记录、错题记录、答题日志和设置，且无法恢复。清空前建议先在单词列表中导出词库备份。"
        confirmText="确认清空"
        onCancel={() => setConfirmClear(false)}
        onConfirm={async () => {
          try {
            await storageService.clearAll();
            setBundle(createEmptyBundle());
            setLaunchRequest(null);
            notify('success', '本地数据已清空。');
          } catch (err) {
            notify('error', errorText(err, '清空数据失败。'));
          } finally {
            setConfirmClear(false);
          }
        }}
      />
    </>
  );
}
