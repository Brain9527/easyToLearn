import type { ImportColumnMap, ParsedImportFile } from '../types/models';

export const DEEPSEEK_ENDPOINT = 'https://api.deepseek.com/chat/completions';
export const DEFAULT_AI_MODEL = 'deepseek-chat';
export const AI_MAX_COUNT = 50;
export const AI_MAX_WORDS = 100;
const REQUEST_TIMEOUT_MS = 90_000;

/** 生成结果使用与 Excel 模板一致的表头，便于直接复用导入映射与校验 */
export const AI_HEADERS: (keyof ImportColumnMap)[] = ['word', 'phonetic', 'meaning', 'mnemonic', 'example', 'exampleMeaning', 'notes'];

export type AiAccent = 'us' | 'uk';

export type AiGenerateRequest =
  | { mode: 'topic'; topic: string; count: number; level: string; accent: AiAccent; avoidWords?: string[] }
  | { mode: 'words'; words: string[]; accent: AiAccent };

/** 发给模型的「禁止重复」清单上限，防止 prompt 过长 */
export const AI_AVOID_PROMPT_LIMIT = 200;

export class AiServiceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AiServiceError';
  }
}

/** 按行、逗号或分号拆分用户粘贴的单词，保留短语内部空格并去重 */
export const parseWordList = (text: string): string[] => {
  const seen = new Set<string>();
  const result: string[] = [];
  text
    .split(/[\n,，;；]+/)
    .map((item) => item.trim().replace(/\s+/g, ' '))
    .filter(Boolean)
    .forEach((word) => {
      const key = word.toLowerCase();
      if (!seen.has(key)) {
        seen.add(key);
        result.push(word);
      }
    });
  return result;
};

export const validateAiRequest = (request: AiGenerateRequest): string | null => {
  if (request.mode === 'topic') {
    if (!request.topic.trim()) return '请填写主题，例如“机场出行”“日常问候”。';
    if (!Number.isInteger(request.count) || request.count < 1 || request.count > AI_MAX_COUNT) {
      return `生成数量需在 1～${AI_MAX_COUNT} 之间。`;
    }
    return null;
  }
  if (request.words.length === 0) return '请至少输入一个英文单词或短语。';
  if (request.words.length > AI_MAX_WORDS) return `单次最多补全 ${AI_MAX_WORDS} 个单词，请分批处理。`;
  return null;
};

const SYSTEM_PROMPT = [
  '你是一名严谨的英语词汇老师，为中文母语学习者编写词卡。',
  '只输出 JSON 对象，格式为 {"items":[{"word":"","phonetic":"","meaning":"","mnemonic":"","example":"","exampleMeaning":"","notes":""}]}，不要输出任何解释。',
  '字段要求：word 为英文单词或短语（保持常规拼写与大小写）；phonetic 为国际音标 IPA，用斜杠包裹；meaning 为简洁的中文释义，可含词性；',
  'mnemonic 为用汉字模拟英文读音的中文谐音（仅辅助记忆）；example 为简单自然的英文例句；exampleMeaning 为例句的中文翻译；notes 可写词性、搭配或易错点，没有则为空字符串。',
  '不要编造不存在的单词；如无法确定某个字段，请填空字符串。',
].join('\n');

export const buildMessages = (request: AiGenerateRequest) => {
  const accentText = request.accent === 'uk' ? '英式（British English）' : '美式（American English）';
  let user: string;
  if (request.mode === 'topic') {
    const avoid = normalizeAvoidWords(request.avoidWords);
    const sampled = sampleAvoidWords(avoid, AI_AVOID_PROMPT_LIMIT);
    const avoidText =
      sampled.length > 0
        ? `\n禁止使用以下已学过的单词或短语（忽略大小写，严禁出现在 word 字段中${avoid.length > sampled.length ? `，这里只列出了 ${sampled.length}/${avoid.length} 个样本` : ''}）：\n${sampled.map((word) => `- ${word}`).join('\n')}`
        : '';
    user = `请围绕主题“${request.topic.trim()}”，生成 ${request.count} 个适合「${request.level}」水平学习者的常用英文单词或短语，彼此不重复。音标使用${accentText}发音。${avoidText}`;
  } else {
    user = `请为以下 ${request.words.length} 个英文单词或短语逐一生成词卡，word 字段必须与给定拼写保持一致，按给定顺序输出。音标使用${accentText}发音。\n${request.words.map((word) => `- ${word}`).join('\n')}`;
  }
  return [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: `${user}\n请以 json 格式输出。` },
  ];
};

const normalizeAvoidWords = (words: string[] | undefined): string[] => {
  if (!words || words.length === 0) return [];
  const seen = new Set<string>();
  const result: string[] = [];
  words.forEach((raw) => {
    const word = raw.trim().replace(/\s+/g, ' ');
    if (!word) return;
    const key = word.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    result.push(word);
  });
  return result;
};

/** 均匀抽样，保留头尾，避免只给模型看最早添加的词 */
const sampleAvoidWords = (words: string[], limit: number): string[] => {
  if (words.length <= limit) return words;
  const step = words.length / limit;
  const picked: string[] = [];
  for (let i = 0; i < limit; i += 1) {
    picked.push(words[Math.min(words.length - 1, Math.floor(i * step))]);
  }
  return picked;
};

const asText = (value: unknown): string => {
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number') return String(value);
  return '';
};

/** 解析模型输出：兼容代码块包裹、顶层数组或 {items: [...]} */
export const parseAiContent = (content: string): Record<string, string>[] => {
  let text = content.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  if (!text.startsWith('{') && !text.startsWith('[')) {
    const start = text.search(/[[{]/);
    if (start < 0) throw new AiServiceError('AI 返回的内容不是有效的 JSON，请重试。');
    text = text.slice(start);
  }
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new AiServiceError('AI 返回的内容不是有效的 JSON，请重试或减少生成数量。');
  }
  const list = Array.isArray(data)
    ? data
    : data && typeof data === 'object' && Array.isArray((data as { items?: unknown }).items)
      ? (data as { items: unknown[] }).items
      : null;
  if (!list) throw new AiServiceError('AI 返回的数据缺少 items 列表，请重试。');

  return list
    .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object')
    .map((item) =>
      AI_HEADERS.reduce<Record<string, string>>((row, field) => {
        row[field] = asText(item[field]);
        return row;
      }, {}),
    );
};

const describeHttpError = async (response: Response): Promise<string> => {
  let detail = '';
  try {
    const body = (await response.json()) as { error?: { message?: string } };
    detail = body.error?.message ?? '';
  } catch {
    // 忽略无法解析的错误体
  }
  const suffix = detail ? `（${detail}）` : '';
  switch (response.status) {
    case 401:
      return 'API Key 无效或已失效，请在设置中检查 DeepSeek API Key。';
    case 402:
      return 'DeepSeek 账户余额不足，请充值后重试。';
    case 422:
    case 400:
      return `请求参数有误，请检查模型名称${suffix}。`;
    case 429:
      return '请求过于频繁，请稍后再试。';
    default:
      return response.status >= 500 ? `DeepSeek 服务暂时不可用（${response.status}），请稍后重试。` : `生成失败（HTTP ${response.status}）${suffix}。`;
  }
};

export interface AiGenerateOptions {
  apiKey: string;
  model?: string;
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
}

/**
 * 调用 DeepSeek 生成词卡。API Key 只放在请求头中直接发往 DeepSeek，不经过其他服务。
 * 返回结构与 Excel 解析结果一致，由导入流程继续映射、校验、预览和确认写入。
 */
export const generateVocabularyRows = async (
  request: AiGenerateRequest,
  { apiKey, model = DEFAULT_AI_MODEL, signal, fetchImpl = fetch }: AiGenerateOptions,
): Promise<ParsedImportFile> => {
  const key = apiKey.trim();
  if (!key) throw new AiServiceError('请先在设置中填写 DeepSeek API Key。');
  const invalid = validateAiRequest(request);
  if (invalid) throw new AiServiceError(invalid);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  const onAbort = () => controller.abort();
  signal?.addEventListener('abort', onAbort);

  // topic 模式略多生成一些以便本地按 avoidWords 去重后仍能达量
  const effectiveRequest: AiGenerateRequest =
    request.mode === 'topic'
      ? { ...request, count: Math.min(AI_MAX_COUNT, request.count + Math.min(10, Math.ceil(request.count * 0.3))) }
      : request;

  const modelName = model.trim() || DEFAULT_AI_MODEL;
  let response: Response;
  try {
    response = await fetchImpl(DEEPSEEK_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model: modelName,
        messages: buildMessages(effectiveRequest),
        temperature: 0.3,
        stream: false,
        ...(modelName === 'deepseek-chat' ? { response_format: { type: 'json_object' } } : {}),
      }),
      signal: controller.signal,
    });
  } catch (err) {
    if (signal?.aborted) throw new AiServiceError('已取消生成。');
    if (controller.signal.aborted) throw new AiServiceError('请求超时，请减少数量后重试。');
    throw new AiServiceError(`无法连接 DeepSeek，请检查网络${err instanceof Error && err.message ? `（${err.message}）` : ''}。`);
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  }

  if (!response.ok) throw new AiServiceError(await describeHttpError(response));

  let content = '';
  try {
    const body = (await response.json()) as { choices?: { message?: { content?: string } }[] };
    content = body.choices?.[0]?.message?.content ?? '';
  } catch {
    throw new AiServiceError('无法解析 DeepSeek 的响应，请重试。');
  }
  if (!content.trim()) throw new AiServiceError('AI 未返回内容，请重试。');

  const rows = parseAiContent(content);
  if (rows.length === 0) throw new AiServiceError('AI 未生成任何词条，请调整主题或单词后重试。');

  const finalRows =
    request.mode === 'topic' && request.avoidWords && request.avoidWords.length > 0
      ? dedupeRows(rows, request.avoidWords, request.count)
      : rows;
  if (finalRows.length === 0) throw new AiServiceError('AI 生成的词卡都与已有词库重复，请换一个主题或扩展方向再试。');

  const label = request.mode === 'topic' ? `AI 生成：${request.topic.trim()}` : `AI 补全：${request.words.length} 个单词`;
  return { fileName: label, headers: [...AI_HEADERS], rows: finalRows };
};

/** 结合 avoidWords 与本次结果自身，按归一化拼写去重，并裁剪到期望数量 */
const dedupeRows = (rows: Record<string, string>[], avoidWords: string[] | undefined, expected: number): Record<string, string>[] => {
  const seen = new Set(normalizeAvoidWords(avoidWords).map((word) => word.toLowerCase()));
  const result: Record<string, string>[] = [];
  for (const row of rows) {
    const key = (row.word ?? '').trim().replace(/\s+/g, ' ').toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push(row);
    if (result.length >= expected) break;
  }
  return result;
};
