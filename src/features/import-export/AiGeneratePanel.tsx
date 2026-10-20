import { useEffect, useRef, useState } from 'preact/hooks';
import {
  AI_MAX_COUNT,
  AI_MAX_WORDS,
  generateVocabularyRows,
  parseWordList,
  type AiAccent,
  type AiGenerateRequest,
} from '../../services/aiVocabularyService';
import type { ParsedImportFile, Vocabulary } from '../../types/models';

interface AiGeneratePanelProps {
  apiKey: string;
  model: string;
  disabled: boolean;
  /** 已有词库，用于让 AI 生成时避开重复 */
  existing: Vocabulary[];
  onGenerated: (parsed: ParsedImportFile) => void;
  onStatus: (status: { type: 'info' | 'success' | 'error'; text: string }) => void;
}

const LEVELS = ['小学', '初中', '高中', '大学四六级', '雅思/托福', '商务英语'];
const COUNTS = [10, 20, 30, 50];

export function AiGeneratePanel({ apiKey, model, disabled, existing, onGenerated, onStatus }: AiGeneratePanelProps) {
  const [mode, setMode] = useState<'topic' | 'words'>('topic');
  const [topic, setTopic] = useState('');
  const [count, setCount] = useState(20);
  const [level, setLevel] = useState(LEVELS[1]);
  const [wordsText, setWordsText] = useState('');
  const [accent, setAccent] = useState<AiAccent>('us');
  const [loading, setLoading] = useState(false);
  const controllerRef = useRef<AbortController | null>(null);

  useEffect(() => () => controllerRef.current?.abort(), []);

  const words = parseWordList(wordsText);
  const hasKey = apiKey.trim().length > 0;

  const handleGenerate = async () => {
    if (loading) return;
    const avoidWords = existing.map((item) => item.word);
    const request: AiGenerateRequest =
      mode === 'topic' ? { mode, topic, count, level, accent, avoidWords } : { mode, words, accent };
    const controller = new AbortController();
    controllerRef.current = controller;
    setLoading(true);
    const avoidHint = mode === 'topic' && avoidWords.length > 0 ? `，并避开已有的 ${avoidWords.length} 个单词` : '';
    onStatus({ type: 'info', text: `AI 正在生成词卡${avoidHint}，通常需要 10～60 秒...` });
    try {
      const parsed = await generateVocabularyRows(request, { apiKey, model, signal: controller.signal });
      onGenerated(parsed);
      const shortfall = mode === 'topic' && parsed.rows.length < count ? `（实际 ${parsed.rows.length}/${count}，可再次点击“AI 生成词卡”继续补充）` : '';
      onStatus({ type: 'info', text: `AI 已生成 ${parsed.rows.length} 条词卡${shortfall}。内容可能有误，请核对预览后再确认写入。` });
    } catch (err) {
      onStatus({ type: 'error', text: err instanceof Error ? err.message : 'AI 生成失败。' });
    } finally {
      controllerRef.current = null;
      setLoading(false);
    }
  };

  if (!hasKey) {
    return (
      <p className="alert warning">
        尚未配置 DeepSeek API Key。请在下方“AI 在线生成设置”中填写后再使用。Key 仅保存在本机浏览器。
      </p>
    );
  }

  return (
    <div className="stack">
      <div className="toggleGroup" role="radiogroup" aria-label="AI 生成方式">
        <label className="checkboxLabel">
          <input type="radio" name="ai-mode" checked={mode === 'topic'} onChange={() => setMode('topic')} />
          按主题生成
        </label>
        <label className="checkboxLabel">
          <input type="radio" name="ai-mode" checked={mode === 'words'} onChange={() => setMode('words')} />
          补全已有单词
        </label>
      </div>

      {mode === 'topic' ? (
        <>
          <label>
            主题 *
            <input
              type="text"
              value={topic}
              maxLength={60}
              placeholder="例如：机场出行、日常问候、办公室"
              onInput={(event) => setTopic(event.currentTarget.value)}
            />
          </label>
          <div className="formGrid">
            <label>
              数量（最多 {AI_MAX_COUNT}）
              <select value={count} onChange={(event) => setCount(Number(event.currentTarget.value))}>
                {COUNTS.map((value) => <option key={value} value={value}>{value}</option>)}
              </select>
            </label>
            <label>
              难度
              <select value={level} onChange={(event) => setLevel(event.currentTarget.value)}>
                {LEVELS.map((value) => <option key={value} value={value}>{value}</option>)}
              </select>
            </label>
          </div>
        </>
      ) : (
        <label>
          英文单词或短语 *（每行一个，或用逗号分隔，最多 {AI_MAX_WORDS} 个）
          <textarea
            rows={5}
            value={wordsText}
            placeholder={'hello\nlook after\nairport'}
            onInput={(event) => setWordsText(event.currentTarget.value)}
          />
          <span className="helperText">已识别 {words.length} 个（自动去重）</span>
        </label>
      )}

      <label>
        音标口音
        <select value={accent} onChange={(event) => setAccent(event.currentTarget.value as AiAccent)}>
          <option value="us">美式</option>
          <option value="uk">英式</option>
        </select>
      </label>

      <p className="helperText">
        生成时会把主题或单词连同 API Key 直接发送给 DeepSeek（{model || 'deepseek-chat'}），不会发送你的词库。生成结果需在预览中确认后才会写入。
      </p>

      <div className="buttonRow start">
        <button type="button" className="primaryButton" disabled={disabled || loading} onClick={() => void handleGenerate()}>
          {loading ? '正在生成...' : 'AI 生成词卡'}
        </button>
        {loading ? (
          <button type="button" className="secondaryButton" onClick={() => controllerRef.current?.abort()}>
            取消生成
          </button>
        ) : null}
      </div>
    </div>
  );
}
