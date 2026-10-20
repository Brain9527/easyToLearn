import { describe, expect, it, vi } from 'vitest';
import {
  AI_HEADERS,
  DEEPSEEK_ENDPOINT,
  buildMessages,
  generateVocabularyRows,
  parseAiContent,
  parseWordList,
  validateAiRequest,
} from '../services/aiVocabularyService';
import { commitImportRows, suggestColumnMap, validateImportRows } from '../features/import-export/importValidation';

const okResponse = (content: string) =>
  new Response(JSON.stringify({ choices: [{ message: { content } }] }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });

const sampleContent = JSON.stringify({
  items: [
    { word: 'airport', phonetic: '/ˈerpɔːrt/', meaning: 'n. 机场', mnemonic: '爱坡特', example: 'We arrived at the airport.', exampleMeaning: '我们到达了机场。', notes: '' },
    { word: 'boarding pass', phonetic: '/ˈbɔːrdɪŋ pæs/', meaning: '登机牌', mnemonic: '', example: '', exampleMeaning: '', notes: '' },
  ],
});

describe('parseWordList', () => {
  it('按换行、中英文逗号和分号拆分，去重并保留短语', () => {
    expect(parseWordList('hello\n  look   after ,Hello；airport;，\n')).toEqual(['hello', 'look after', 'airport']);
  });
});

describe('validateAiRequest', () => {
  it('校验主题、数量和单词列表', () => {
    expect(validateAiRequest({ mode: 'topic', topic: ' ', count: 10, level: '初中', accent: 'us' })).toMatch('主题');
    expect(validateAiRequest({ mode: 'topic', topic: '机场', count: 51, level: '初中', accent: 'us' })).toMatch('数量');
    expect(validateAiRequest({ mode: 'topic', topic: '机场', count: 20, level: '初中', accent: 'us' })).toBeNull();
    expect(validateAiRequest({ mode: 'words', words: [], accent: 'us' })).toMatch('至少');
    expect(validateAiRequest({ mode: 'words', words: Array.from({ length: 101 }, (_, i) => `w${i}`), accent: 'us' })).toMatch('最多');
  });
});

describe('buildMessages', () => {
  it('提示词包含 json 字样与请求参数', () => {
    const messages = buildMessages({ mode: 'words', words: ['hello', 'look after'], accent: 'uk' });
    expect(messages[1].content).toContain('json');
    expect(messages[1].content).toContain('- look after');
    expect(messages[1].content).toContain('英式');
  });

  it('topic 模式会把 avoidWords 写入提示词', () => {
    const messages = buildMessages({ mode: 'topic', topic: '机场', count: 10, level: '初中', accent: 'us', avoidWords: ['Airport', '  gate ', 'airport'] });
    expect(messages[1].content).toContain('禁止使用以下已学过的单词');
    expect(messages[1].content).toContain('- Airport');
    expect(messages[1].content).toContain('- gate');
    // 大小写重复的只保留一次
    expect(messages[1].content.match(/- airport/gi)).toHaveLength(1);
  });
});

describe('parseAiContent', () => {
  it('解析 items 对象、顶层数组和代码块包裹', () => {
    expect(parseAiContent(sampleContent)).toHaveLength(2);
    expect(parseAiContent('```json\n[{"word":"hi","meaning":"你好"}]\n```')[0]).toMatchObject({ word: 'hi', meaning: '你好', phonetic: '' });
    expect(parseAiContent('结果如下：{"items":[{"word":"ok"}]}')[0].word).toBe('ok');
  });

  it('只保留约定字段并把非字符串转为文本', () => {
    const [row] = parseAiContent('{"items":[{"word":"one","meaning":1,"extra":"x"}]}');
    expect(Object.keys(row)).toEqual(AI_HEADERS);
    expect(row.meaning).toBe('1');
  });

  it('非法 JSON 或缺少 items 时报错', () => {
    expect(() => parseAiContent('not json')).toThrow('JSON');
    expect(() => parseAiContent('{"items": [')).toThrow('JSON');
    expect(() => parseAiContent('{"data": []}')).toThrow('items');
  });
});

describe('generateVocabularyRows', () => {
  const request = { mode: 'topic', topic: '机场出行', count: 10, level: '初中', accent: 'us' } as const;

  it('空 Key 时不发请求', async () => {
    const fetchImpl = vi.fn();
    await expect(generateVocabularyRows(request, { apiKey: '  ', fetchImpl })).rejects.toThrow('API Key');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('发送正确的请求并返回可导入的数据', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(okResponse(sampleContent));
    const parsed = await generateVocabularyRows(request, { apiKey: ' sk-test ', fetchImpl });

    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(DEEPSEEK_ENDPOINT);
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer sk-test');
    const body = JSON.parse(init.body as string);
    expect(body.model).toBe('deepseek-chat');
    expect(body.response_format).toEqual({ type: 'json_object' });
    expect(body.stream).toBe(false);

    expect(parsed.fileName).toBe('AI 生成：机场出行');
    expect(parsed.headers).toEqual(AI_HEADERS);
    expect(parsed.rows).toHaveLength(2);
  });

  it('reasoner 模型不附加 response_format', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(okResponse(sampleContent));
    await generateVocabularyRows(request, { apiKey: 'sk', model: 'deepseek-reasoner', fetchImpl });
    const body = JSON.parse((fetchImpl.mock.calls[0][1] as RequestInit).body as string);
    expect(body.model).toBe('deepseek-reasoner');
    expect(body.response_format).toBeUndefined();
  });

  it('把 401 / 402 映射为中文提示', async () => {
    const error = (status: number) => vi.fn().mockResolvedValue(new Response('{"error":{"message":"x"}}', { status }));
    await expect(generateVocabularyRows(request, { apiKey: 'sk', fetchImpl: error(401) })).rejects.toThrow('API Key 无效');
    await expect(generateVocabularyRows(request, { apiKey: 'sk', fetchImpl: error(402) })).rejects.toThrow('余额不足');
  });

  it('网络异常与用户取消给出明确提示', async () => {
    await expect(
      generateVocabularyRows(request, { apiKey: 'sk', fetchImpl: vi.fn().mockRejectedValue(new TypeError('Failed to fetch')) }),
    ).rejects.toThrow('无法连接');

    const controller = new AbortController();
    controller.abort();
    await expect(
      generateVocabularyRows(request, {
        apiKey: 'sk',
        signal: controller.signal,
        fetchImpl: vi.fn().mockRejectedValue(new DOMException('aborted', 'AbortError')),
      }),
    ).rejects.toThrow('已取消');
  });

  it('生成结果可直接走导入流水线：自动映射、去重与校验', async () => {
    const content = JSON.stringify({
      items: [
        { word: 'airport', meaning: '机场' },
        { word: 'Airport', meaning: '机场（重复）' },
        { word: 'gate', meaning: '' },
      ],
    });
    const parsed = await generateVocabularyRows(request, { apiKey: 'sk', fetchImpl: vi.fn().mockResolvedValue(okResponse(content)) });
    const mapping = suggestColumnMap(parsed.headers);
    expect(mapping.word).toBe('word');
    expect(mapping.meaning).toBe('meaning');

    const validation = validateImportRows(parsed.rows, mapping, []);
    expect(validation.duplicateInFileRows).toBe(1);
    const { changed } = commitImportRows(validation.rows, [], 'skip', new Date().toISOString());
    expect(changed.map((item) => item.word)).toContain('airport');
    expect(changed.filter((item) => item.normalizedWord === 'airport')).toHaveLength(1);
  });

  it('topic 模式会过滤 avoidWords 中已存在的词并裁剪到期望数量', async () => {
    const content = JSON.stringify({
      items: [
        { word: 'airport', meaning: '机场' },
        { word: 'Gate', meaning: '登机口' },
        { word: 'runway', meaning: '跑道' },
        { word: 'terminal', meaning: '航站楼' },
      ],
    });
    const fetchImpl = vi.fn().mockResolvedValue(okResponse(content));
    const parsed = await generateVocabularyRows(
      { mode: 'topic', topic: '机场', count: 2, level: '初中', accent: 'us', avoidWords: ['Airport', 'gate'] },
      { apiKey: 'sk', fetchImpl },
    );
    expect(parsed.rows.map((row) => row.word)).toEqual(['runway', 'terminal']);
    // 发给模型时应该超发以便本地裁剪
    const body = JSON.parse((fetchImpl.mock.calls[0][1] as RequestInit).body as string);
    expect(body.messages[1].content).toContain('生成 3 个');
    expect(body.messages[1].content).toContain('- Airport');
  });

  it('topic 模式结果全部命中 avoidWords 时抛出可读错误', async () => {
    const content = JSON.stringify({ items: [{ word: 'airport' }, { word: 'Airport' }] });
    await expect(
      generateVocabularyRows(
        { mode: 'topic', topic: '机场', count: 2, level: '初中', accent: 'us', avoidWords: ['airport'] },
        { apiKey: 'sk', fetchImpl: vi.fn().mockResolvedValue(okResponse(content)) },
      ),
    ).rejects.toThrow('都与已有词库重复');
  });
});
