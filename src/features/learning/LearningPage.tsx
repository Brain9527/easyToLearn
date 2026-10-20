import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { AudioButton } from '../../components/AudioButton';
import { EmptyState } from '../../components/EmptyState';
import { ProgressBar } from '../../components/ProgressBar';
import { AnswerSlots } from './AnswerSlots';
import { soundService } from '../../services/soundService';
import { speechService } from '../../services/speechService';
import type {
  AttemptLog,
  LearnCount,
  LearnOrder,
  LearnScope,
  LearningCard,
  SessionCardState,
  SessionSummary,
  StudyRecord,
  UserSettings,
  Vocabulary,
  WrongQuestion,
} from '../../types/models';
import { createId } from '../../utils/id';
import {
  MAX_HINT_LEVEL,
  buildHints,
  buildSessionCards,
  createSessionState,
  revealAnswer,
  skipCard,
  submitAnswer,
  summarizeSession,
} from './LearningSession';

export interface LearningLaunchRequest {
  ids: string[];
  reviewMode: boolean;
  stamp: string;
}

export interface PracticePersistPayload {
  studyRecord: StudyRecord;
  wrongQuestion: WrongQuestion | null;
  attemptLog: AttemptLog | null;
}

interface LearningPageProps {
  vocabularies: Vocabulary[];
  studyRecords: StudyRecord[];
  wrongQuestions: WrongQuestion[];
  settings: UserSettings;
  launchRequest: LearningLaunchRequest | null;
  onSpeak: (word: string) => Promise<void>;
  onPersist: (payload: PracticePersistPayload) => Promise<void>;
  onUpdateSettings: (next: UserSettings) => Promise<void>;
  onGoVocabulary: () => void;
  onRestartMistakes: () => void;
}

type FeedbackKind = 'success' | 'error' | 'info';
interface Feedback {
  kind: FeedbackKind;
  text: string;
  wrongInput?: string;
}

/** 答对后成功状态展示时长（毫秒） */
export const SUCCESS_DELAY_MS = 450;

export function LearningPage({
  vocabularies,
  studyRecords,
  wrongQuestions,
  settings,
  launchRequest,
  onSpeak,
  onPersist,
  onUpdateSettings,
  onGoVocabulary,
  onRestartMistakes,
}: LearningPageProps) {
  const [sessionId, setSessionId] = useState('');
  const [cards, setCards] = useState<LearningCard[]>([]);
  const [states, setStates] = useState<Record<string, SessionCardState>>({});
  const [currentIndex, setCurrentIndex] = useState(0);
  const [answer, setAnswer] = useState('');
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [hintLevel, setHintLevel] = useState(0);
  const [summary, setSummary] = useState<SessionSummary | null>(null);
  const [reviewMode, setReviewMode] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const cardRef = useRef<HTMLFormElement>(null);
  const [attemptKey, setAttemptKey] = useState(0);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const timersRef = useRef<number[]>([]);
  // 本轮内最新的记录，避免异步持久化期间读到旧数据
  const studyRef = useRef(new Map<string, StudyRecord>());
  const wrongRef = useRef(new Map<string, WrongQuestion>());

  const studyMap = useMemo(() => new Map(studyRecords.map((item) => [item.vocabularyId, item])), [studyRecords]);
  const wrongMap = useMemo(() => new Map(wrongQuestions.map((item) => [item.vocabularyId, item])), [wrongQuestions]);

  const schedule = (callback: () => void, delay: number) => {
    const timer = window.setTimeout(() => {
      timersRef.current = timersRef.current.filter((item) => item !== timer);
      callback();
    }, delay);
    timersRef.current.push(timer);
  };

  const clearTimers = () => {
    timersRef.current.forEach((timer) => window.clearTimeout(timer));
    timersRef.current = [];
  };

  useEffect(
    () => () => {
      clearTimers();
      speechService.stop();
    },
    [],
  );

  useEffect(() => {
    const sync = () => setIsFullscreen(Boolean(document.fullscreenElement) && document.fullscreenElement === cardRef.current);
    document.addEventListener('fullscreenchange', sync);
    return () => document.removeEventListener('fullscreenchange', sync);
  }, []);

  const exitFullscreen = async () => {
    if (document.fullscreenElement && document.exitFullscreen) {
      await document.exitFullscreen().catch(() => undefined);
    }
    setIsFullscreen(false);
  };

  const toggleFullscreen = async () => {
    const card = cardRef.current;
    if (!card) return;
    if (isFullscreen) {
      await exitFullscreen();
    } else if (card.requestFullscreen) {
      // 浏览器拒绝时退回到页面内铺满
      await card.requestFullscreen().catch(() => setIsFullscreen(true));
    } else {
      setIsFullscreen(true);
    }
    inputRef.current?.focus();
  };

  const beginSession = (ids?: string[], useReviewMode = false) => {
    clearTimers();
    const nextCards = buildSessionCards({
      vocabularies,
      studyRecords,
      wrongQuestions,
      scope: useReviewMode && !ids ? 'mistakes' : settings.learnScope,
      order: settings.learnOrder,
      count: ids ? 'all' : settings.learnCount,
      ids,
    });
    studyRef.current = new Map(studyMap);
    wrongRef.current = new Map(wrongMap);
    setSessionId(createId('session'));
    setCards(nextCards);
    setStates(
      Object.fromEntries(
        nextCards.map((card) => [
          card.vocabulary.id,
          createSessionState(card.vocabulary.id, Boolean(card.wrongQuestion && card.wrongQuestion.status !== 'mastered')),
        ]),
      ),
    );
    setCurrentIndex(0);
    setAnswer('');
    setFeedback(null);
    setHintLevel(0);
    setSummary(null);
    setBusy(false);
    setReviewMode(useReviewMode);
    setNotice(nextCards.length === 0 ? '当前学习范围内没有可练习的单词，请调整学习范围或先添加单词。' : '');
  };

  useEffect(() => {
    if (launchRequest) beginSession(launchRequest.ids, launchRequest.reviewMode);
    // 仅在新的启动请求到来时开始新一轮
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [launchRequest?.stamp]);

  const currentCard = summary ? null : cards[currentIndex] ?? null;
  const currentId = currentCard?.vocabulary.id ?? '';

  useEffect(() => {
    if (!currentCard) return;
    // 只在用户主动开始本轮后、每题切换时最多自动播放一次
    if (settings.speechAutoPlay) void onSpeak(currentCard.vocabulary.word);
    inputRef.current?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId, currentIndex]);

  // 肌肉记忆模式：进入新题时标记为已显示答案（不计首次答对），但不会写入错题本
  useEffect(() => {
    if (!currentCard) return;
    if (!settings.muscleMemoryMode) return;
    const state = states[currentId];
    if (!state || state.showAnswerUsed) return;
    setStates((prev) => ({ ...prev, [currentId]: { ...state, showAnswerUsed: true, firstTryCorrect: false } }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId, currentIndex, settings.muscleMemoryMode]);

  const finishSession = (finalStates: Record<string, SessionCardState>) => {
    clearTimers();
    speechService.stop();
    void exitFullscreen();
    setSummary(summarizeSession(Object.values(finalStates)));
    setBusy(false);
  };

  const goNext = (finalStates: Record<string, SessionCardState>) => {
    if (currentIndex >= cards.length - 1) {
      finishSession(finalStates);
      return;
    }
    setCurrentIndex(currentIndex + 1);
    setAnswer('');
    setFeedback(null);
    setHintLevel(0);
    setBusy(false);
  };

  const persist = async (payload: PracticePersistPayload) => {
    try {
      await onPersist(payload);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : '保存练习结果失败。');
    }
  };

  const updateSettings = (patch: Partial<UserSettings>) => {
    void onUpdateSettings({ ...settings, ...patch }).catch((error: unknown) => {
      setNotice(error instanceof Error ? error.message : '保存设置失败。');
    });
  };

  const currentState = currentCard ? states[currentId] : null;

  const handleSubmit = async (event: Event) => {
    event.preventDefault();
    if (!currentCard || !currentState || busy || currentState.solved) return;
    if (!answer.trim()) {
      setFeedback({ kind: 'info', text: '请先输入英文答案再提交。' });
      inputRef.current?.focus();
      return;
    }
    setBusy(true);
    setAttemptKey((key) => key + 1);
    const result = submitAnswer({
      card: currentCard,
      currentState,
      studyRecord: studyRef.current.get(currentId) ?? null,
      wrongQuestion: wrongRef.current.get(currentId) ?? null,
      input: answer,
      now: new Date().toISOString(),
      sessionId,
      ignorePunctuation: settings.answerIgnorePunctuation,
    });
    const nextStates = { ...states, [currentId]: result.state };
    studyRef.current.set(currentId, result.studyRecord);
    if (result.wrongQuestion) wrongRef.current.set(currentId, result.wrongQuestion);
    setStates(nextStates);
    setAnswer(result.nextInputValue);

    if (result.isCorrect) {
      setFeedback({ kind: 'success', text: result.message });
      if (settings.playSuccessSound) void soundService.playSuccess();
      await persist({ studyRecord: result.studyRecord, wrongQuestion: result.wrongQuestion, attemptLog: result.attemptLog });
      schedule(() => goNext(nextStates), SUCCESS_DELAY_MS);
      return;
    }

    setFeedback({ kind: 'error', text: result.message, wrongInput: answer.trim() });
    await persist({ studyRecord: result.studyRecord, wrongQuestion: result.wrongQuestion, attemptLog: result.attemptLog });
    setBusy(false);
    schedule(() => inputRef.current?.focus(), 0);
  };

  const handleSkip = () => {
    if (!currentCard || !currentState || busy) return;
    const nextStates = { ...states, [currentId]: skipCard(currentState) };
    setStates(nextStates);
    goNext(nextStates);
  };

  const handleHint = () => {
    if (!currentCard || !currentState || hintLevel >= MAX_HINT_LEVEL) return;
    const nextLevel = hintLevel + 1;
    setHintLevel(nextLevel);
    setStates({ ...states, [currentId]: { ...currentState, hintsUsed: nextLevel } });
    if (nextLevel === 4) void onSpeak(currentCard.vocabulary.word);
    inputRef.current?.focus();
  };

  const handleReveal = async () => {
    if (!currentCard || !currentState || currentState.showAnswerUsed || busy) return;
    const next = revealAnswer({
      currentState,
      studyRecord: studyRef.current.get(currentId) ?? null,
      wrongQuestion: wrongRef.current.get(currentId) ?? null,
      vocabularyId: currentId,
      now: new Date().toISOString(),
    });
    studyRef.current.set(currentId, next.studyRecord);
    wrongRef.current.set(currentId, next.wrongQuestion);
    setStates({ ...states, [currentId]: next.state });
    setFeedback({ kind: 'info', text: '已显示答案，本题不计为独立答对，并已加入错题本。请照着拼写一遍。' });
    await persist({ studyRecord: next.studyRecord, wrongQuestion: next.wrongQuestion, attemptLog: null });
    inputRef.current?.focus();
  };

  if (vocabularies.length === 0) {
    return (
      <EmptyState
        title="还没有可学习的单词"
        description="请先在侧栏通过 Excel 导入词库，或在单词列表中手动添加单词。"
        action={<button type="button" className="primaryButton" onClick={onGoVocabulary}>前往单词列表</button>}
      />
    );
  }

  const hints = currentCard ? buildHints(currentCard.vocabulary, hintLevel) : [];

  return (
    <div className="stack">
      <section className="card stack" aria-labelledby="learn-config-title">
        <div className="sectionHeader">
          <div>
            <h2 id="learn-config-title">学习设置</h2>
            <p className="helperText">题量会按当前范围内实际可学习的单词数自动裁切，设置自动保存。</p>
          </div>
          <div className="buttonRow">
            <button type="button" className="primaryButton" onClick={() => beginSession(undefined, false)}>开始学习</button>
            <button type="button" className="secondaryButton" onClick={() => beginSession(undefined, true)}>复习错题</button>
          </div>
        </div>
        <div className="filtersGrid">
          <label>
            每轮题量
            <select
              value={String(settings.learnCount)}
              onChange={(event) => {
                const value = event.currentTarget.value;
                updateSettings({ learnCount: (value === 'all' ? 'all' : Number(value)) as LearnCount });
              }}
            >
              <option value="10">10 题</option>
              <option value="20">20 题</option>
              <option value="50">50 题</option>
              <option value="all">全部</option>
            </select>
          </label>
          <label>
            学习范围
            <select value={settings.learnScope} onChange={(event) => updateSettings({ learnScope: event.currentTarget.value as LearnScope })}>
              <option value="all">全部单词</option>
              <option value="unmastered">未掌握</option>
              <option value="mistakes">错题</option>
            </select>
          </label>
          <label>
            题目顺序
            <select value={settings.learnOrder} onChange={(event) => updateSettings({ learnOrder: event.currentTarget.value as LearnOrder })}>
              <option value="sequential">顺序（按添加时间）</option>
              <option value="random">随机</option>
            </select>
          </label>
          <div className="toggleGroup">
            <label className="toggleItem"><input type="checkbox" checked={settings.speechAutoPlay} onChange={(event) => updateSettings({ speechAutoPlay: event.currentTarget.checked })} /> 自动播放发音</label>
            <label className="toggleItem"><input type="checkbox" checked={settings.playSuccessSound} onChange={(event) => updateSettings({ playSuccessSound: event.currentTarget.checked })} /> 正确音效</label>
            <label className="toggleItem"><input type="checkbox" checked={settings.showPhonetic} onChange={(event) => updateSettings({ showPhonetic: event.currentTarget.checked })} /> 音标与谐音</label>
            <label className="toggleItem"><input type="checkbox" checked={settings.muscleMemoryMode} onChange={(event) => updateSettings({ muscleMemoryMode: event.currentTarget.checked })} /> 肌肉记忆学习（显示完整单词）</label>
          </div>
        </div>
        {notice ? <p className="alert warning" role="status">{notice}</p> : null}
      </section>

      {summary ? (
        <section className="card stack" aria-labelledby="summary-title">
          <h2 id="summary-title">本轮学习完成</h2>
          <div className="summaryGrid">
            <div><span>总题数</span><strong>{summary.total}</strong></div>
            <div><span>首次答对</span><strong>{summary.firstTryCorrect}</strong></div>
            <div><span>曾经答错</span><strong>{summary.everWrong}</strong></div>
            <div><span>总错误次数</span><strong>{summary.totalWrongAttempts}</strong></div>
            <div><span>正确率</span><strong>{summary.accuracy}%</strong></div>
            <div><span>新增错题</span><strong>{summary.newMistakes}</strong></div>
            <div><span>显示答案</span><strong>{summary.revealed}</strong></div>
            <div><span>跳过</span><strong>{summary.skipped}</strong></div>
          </div>
          <p className="helperText">
            正确率 = 首次答对题数 / 总题数。首次答对指未答错、未显示答案、未跳过即拼写正确；答错后再答对的 {summary.correctedAfterMistake} 题不计入首次答对。
          </p>
          <div className="buttonRow start">
            <button type="button" className="primaryButton" onClick={() => beginSession(undefined, reviewMode)}>继续学习</button>
            <button type="button" className="secondaryButton" onClick={onRestartMistakes}>重新练习错题</button>
            <button type="button" className="ghostButton" onClick={onGoVocabulary}>返回单词列表</button>
          </div>
        </section>
      ) : null}

      {!summary && (!currentCard || !currentState) ? (
        <EmptyState
          title="还没开始本轮学习"
          description="选择题量和范围后点击“开始学习”，或者从单词列表、错题本直接进入练习。"
        />
      ) : null}

      {currentCard && currentState ? (
        <form
          ref={cardRef}
          className={`card stack learningCard ${feedback?.kind === 'success' ? 'success' : ''} ${isFullscreen ? 'isFullscreen' : ''}`}
          onSubmit={(event) => void handleSubmit(event)}
          aria-labelledby="learning-title"
        >
          <div className="sectionHeader">
            <div>
              <h2 id="learning-title">{reviewMode ? '错题复习' : '拼写学习'}</h2>
              <p className="helperText">根据中文释义和发音，拼写出正确的英文。</p>
            </div>
            <div className="buttonRow">
              <button
                type="button"
                className="secondaryButton"
                onClick={() => void toggleFullscreen()}
                aria-pressed={isFullscreen}
              >
                {isFullscreen ? '退出全屏' : '全屏'}
              </button>
              <button type="button" className="ghostButton" onClick={() => finishSession(states)}>退出本轮学习</button>
            </div>
          </div>
          <ProgressBar value={currentIndex + 1} total={cards.length} />
          <div className="promptBox" key={`${sessionId}-${currentId}`}>
            <span className="eyebrow">中文释义</span>
            <h3 className="promptMeaning">{currentCard.vocabulary.meaning || '暂无释义'}</h3>
            <div className="buttonRow start">
              <AudioButton onClick={() => onSpeak(currentCard.vocabulary.word)} label="播放发音" />
            </div>
            {settings.showPhonetic ? (
              <div className="phoneticBlock">
                <span className="phoneticLine">IPA：{currentCard.vocabulary.phonetic || '未填写'}</span>
                <span className="mnemonicLine">谐音：{currentCard.vocabulary.mnemonic || '未填写'}</span>
              </div>
            ) : null}
          </div>
          {settings.muscleMemoryMode ? (
            <div className="muscleMemoryHint" aria-live="polite">
              <span className="eyebrow">完整单词（肌肉记忆）</span>
              <strong className="muscleMemoryWord">{currentCard.vocabulary.word}</strong>
              <span className="helperText">照着输入即可，此模式下不计入“首次答对”，也不会加入错题本。</span>
            </div>
          ) : null}
          <AnswerSlots
            key={`${sessionId}-${currentId}`}
            word={currentCard.vocabulary.word}
            value={answer}
            wrongValue={feedback?.wrongInput}
            status={feedback?.kind ?? null}
            animationKey={attemptKey}
            disabled={currentState.solved}
            inputRef={inputRef}
            onInput={(next) => {
              // 用户输入到达目标词空格位置时自动补齐空格，避免手动打空格
              const target = currentCard.vocabulary.word;
              const trimmed = next.replace(/ +$/g, '');
              let appended = trimmed;
              while (appended.length < target.length && target[appended.length] === ' ') {
                appended += ' ';
              }
              setAnswer(appended);
            }}
          />
          <div id="answer-feedback" aria-live="polite">
            {feedback ? (
              <div className={`feedback ${feedback.kind}`}>
                <strong>{feedback.text}</strong>
                {feedback.wrongInput ? <span>你的输入：{feedback.wrongInput}</span> : null}
              </div>
            ) : null}
          </div>
          {hints.length > 0 || currentState.showAnswerUsed ? (
            <div className="hintBox" aria-live="polite">
              {hints.map((hint) => (
                <p key={hint.level}><strong>{hint.label}：</strong>{hint.text}</p>
              ))}
              {currentState.showAnswerUsed ? <p className="answerReveal"><strong>答案：</strong>{currentCard.vocabulary.word}</p> : null}
            </div>
          ) : null}
          <div className="buttonRow start">
            <button type="submit" className="primaryButton" disabled={busy || currentState.solved}>提交</button>
            <button type="button" className="secondaryButton" onClick={handleSkip} disabled={busy}>跳过</button>
            <button type="button" className="secondaryButton" onClick={handleHint} disabled={hintLevel >= MAX_HINT_LEVEL}>
              提示（{hintLevel}/{MAX_HINT_LEVEL}）
            </button>
            <button type="button" className="ghostButton" onClick={() => void handleReveal()} disabled={busy || currentState.showAnswerUsed}>
              显示答案
            </button>
          </div>
        </form>
      ) : null}
    </div>
  );
}
