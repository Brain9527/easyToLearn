import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/preact';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { defaultSettings } from '../db/database';
import { LearningPage, type PracticePersistPayload } from '../features/learning/LearningPage';
import { makeVocabulary } from './fixtures';

 afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const hello = makeVocabulary('hello', { meaning: '你好', mnemonic: '哈喽', phonetic: '/həˈləʊ/' });
const world = makeVocabulary('world', { meaning: '世界', createdAt: '2026-01-02T00:00:00.000Z' });

const setup = (ids = [hello.id, world.id], vocabularies = [hello, world]) => {
  const onPersist = vi.fn<(payload: PracticePersistPayload) => Promise<void>>().mockResolvedValue(undefined);
  render(
    <LearningPage
      vocabularies={vocabularies}
      studyRecords={[]}
      wrongQuestions={[]}
      settings={{ ...defaultSettings, playSuccessSound: false }}
      launchRequest={{ ids, reviewMode: false, stamp: 'test' }}
      onSpeak={vi.fn().mockResolvedValue(undefined)}
      onPersist={onPersist}
      onUpdateSettings={vi.fn().mockResolvedValue(undefined)}
      onGoVocabulary={vi.fn()}
      onRestartMistakes={vi.fn()}
    />,
  );
  const input = screen.getByLabelText('请输入英文单词') as HTMLInputElement;
  const submit = (value: string) => {
    fireEvent.input(input, { target: { value } });
    fireEvent.click(screen.getByRole('button', { name: '提交' }));
  };
  return { input, submit, onPersist };
};

const hint = () => screen.getByRole('button', { name: /^提示（/ }) as HTMLButtonElement;
const waitUntilReady = () => waitFor(() => expect(screen.getByLabelText('请输入英文单词').getAttribute('aria-disabled')).toBe('false'));

 describe('学习页面', () => {
  it('题目区域展示释义和谐音，但不直接显示英文答案', () => {
    setup();
    expect(screen.getByText('你好')).toBeTruthy();
    expect(screen.getByText('谐音：哈喽')).toBeTruthy();
    expect(screen.queryByText('hello')).toBeNull();
    expect(screen.getByText('1 / 2', { exact: false })).toBeTruthy();
  });

  it('答错后清空输入、保留题目、提示错误并写入错题；重复答错更新同一条记录', async () => {
    const { input, submit, onPersist } = setup();
    submit('helo');
    await screen.findByText('回答错误，请重新输入');
    expect(input.value).toBe('');
    expect(screen.getByText('你的输入：helo')).toBeTruthy();
    expect(screen.getByText('你好')).toBeTruthy();
    await waitFor(() => expect(onPersist).toHaveBeenCalledTimes(1));
    const first = onPersist.mock.calls[0][0];
    expect(first.wrongQuestion).toMatchObject({ vocabularyId: hello.id, wrongCount: 1, lastWrongAnswer: 'helo' });

    await waitFor(() => expect((screen.getByRole('button', { name: '提交' }) as HTMLButtonElement).disabled).toBe(false));
    submit('hallo');
    await waitFor(() => expect(onPersist).toHaveBeenCalledTimes(2));
    const second = onPersist.mock.calls[1][0];
    expect(second.wrongQuestion?.id).toBe(first.wrongQuestion?.id);
    expect(second.wrongQuestion?.wrongCount).toBe(2);
  });

  it('答对后显示成功反馈并自动进入下一题，完成后统计准确', async () => {
    const { submit, onPersist } = setup();
    submit('helo');
    await waitFor(() => expect(onPersist).toHaveBeenCalledTimes(1));
    await waitFor(() => expect((screen.getByRole('button', { name: '提交' }) as HTMLButtonElement).disabled).toBe(false));
    submit(' HELLO ');
    await screen.findByText('回答正确！');
    await screen.findByText('世界', {}, { timeout: 2000 });

    submit('world');
    await screen.findByText('本轮学习完成', {}, { timeout: 2000 });
    const value = (label: string) => screen.getByText(label).nextElementSibling?.textContent;
    expect(value('总题数')).toBe('2');
    expect(value('首次答对')).toBe('1');
    expect(value('曾经答错')).toBe('1');
    expect(value('总错误次数')).toBe('1');
    expect(value('正确率')).toBe('50%');
    expect(value('新增错题')).toBe('1');
  });

  it('主动显示答案后答对不计为首次答对', async () => {
    const { submit, onPersist } = setup([hello.id]);
    fireEvent.click(screen.getByRole('button', { name: '显示答案' }));
    await screen.findByText('hello');
    await waitFor(() => expect(onPersist).toHaveBeenCalledTimes(1));
    await waitUntilReady();
    submit('hello');
    await screen.findByText('拼写正确（已查看答案，不计为独立答对）。');
    await screen.findByText('本轮学习完成', {}, { timeout: 2000 });
    expect(screen.getByText('首次答对').nextElementSibling?.textContent).toBe('0');
    expect(screen.getByText('显示答案').nextElementSibling?.textContent).toBe('1');
  });

  it('空输入不提交', () => {
    const { submit, onPersist } = setup();
    submit('   ');
    expect(screen.getByText('请先输入英文答案再提交。')).toBeTruthy();
    expect(onPersist).not.toHaveBeenCalled();
  });

  it('渲染的下划线槽位数量等于单词字母数', () => {
    setup();
    const slots = document.querySelectorAll('.slots .slot:not(.space)');
    expect(slots.length).toBe('hello'.length);
  });

  it('显示全屏切换按钮', () => {
    setup();
    expect(screen.getByRole('button', { name: '全屏' })).toBeTruthy();
  });

  it('两次提示替换输入为半词和全词，不自动提交，最多两次且全词不计独立答对', async () => {
    const { input, onPersist } = setup([hello.id]);
    fireEvent.input(input, { target: { value: 'wrong' } });
    fireEvent.click(hint());
    expect(input.value).toBe('hel');
    expect(hint().textContent).toContain('1/2');
    expect(onPersist).not.toHaveBeenCalled();
    fireEvent.click(hint());
    expect(input.value).toBe('hello');
    expect(hint().disabled).toBe(true);
    expect(hint().textContent).toContain('2/2');
    await waitUntilReady();
    fireEvent.click(hint());
    fireEvent.click(screen.getByRole('button', { name: '显示答案' }));
    expect(onPersist).toHaveBeenCalledTimes(1);
    const revealed = onPersist.mock.calls[0][0];
    expect(revealed.attemptLog).toBeNull();
    expect(revealed.studyRecord).toMatchObject({ attempts: 0, wrongCount: 0, correctCount: 0 });
    expect(revealed.wrongQuestion?.history.map((item) => item.action)).toEqual(['show-answer']);
    expect(screen.getByText('你好')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '提交' }));
    await screen.findByText('本轮学习完成', {}, { timeout: 2000 });
    expect(onPersist).toHaveBeenCalledTimes(2);
    expect(onPersist.mock.calls[1][0].studyRecord).toMatchObject({ attempts: 1, correctCount: 1, wrongCount: 0, consecutiveCorrect: 0 });
    expect(screen.getByText('首次答对').nextElementSibling?.textContent).toBe('0');
    expect(screen.getByText('显示答案').nextElementSibling?.textContent).toBe('1');
  });

  it('提示在保存期间及答对等待换题时禁用，下一题重置', async () => {
    const { input, submit, onPersist } = setup();
    let finishSave!: () => void;
    onPersist.mockImplementationOnce(() => new Promise<void>((resolve) => { finishSave = resolve; }));
    submit('helo');
    expect(hint().disabled).toBe(true);
    fireEvent.click(hint());
    expect(input.value).toBe('');
    expect(hint().textContent).toContain('0/2');
    finishSave();
    await waitUntilReady();
    fireEvent.click(hint());
    expect(input.value).toBe('hel');
    submit('hello');
    expect(hint().disabled).toBe(true);
    fireEvent.click(hint());
    expect(hint().textContent).toContain('1/2');
    await screen.findByText('世界', {}, { timeout: 2000 });
    expect(input.value).toBe('');
    expect(hint().textContent).toContain('0/2');
    expect(hint().disabled).toBe(false);
    expect(document.querySelector('.hintBox')).toBeNull();
    fireEvent.click(hint());
    expect(input.value).toBe('wor');
  });

  it('跳过及重新开始也重置提示', async () => {
    const { input } = setup();
    fireEvent.click(hint());
    fireEvent.click(hint());
    await waitUntilReady();
    fireEvent.click(screen.getByRole('button', { name: '跳过' }));
    expect(hint().textContent).toContain('0/2');
    expect(input.value).toBe('');
    expect(document.querySelector('.answerReveal')).toBeNull();
    fireEvent.click(hint());
    fireEvent.click(screen.getByRole('button', { name: '开始学习' }));
    expect(hint().textContent).toContain('0/2');
    expect(input.value).toBe('');
  });

  it('第三次答错显示答案供照写且只持久化一次，后续提示不重复记录', async () => {
    const { input, submit, onPersist } = setup([hello.id]);
    for (let index = 1; index <= 3; index += 1) {
      submit('helo');
      await waitUntilReady();
      expect(onPersist).toHaveBeenCalledTimes(index);
      if (index < 3) expect(document.querySelector('.answerReveal')).toBeNull();
    }
    expect(screen.getByText('已答错三次，已显示正确答案，请照着拼写一遍。')).toBeTruthy();
    expect(document.querySelector('.answerReveal')?.textContent).toBe('答案：hello');
    expect(input.value).toBe('');
    expect(screen.getByText('你好')).toBeTruthy();
    expect(onPersist.mock.calls[2][0].studyRecord).toMatchObject({ attempts: 3, wrongCount: 3, correctCount: 0 });
    expect(onPersist.mock.calls[2][0].wrongQuestion?.history.map((item) => item.action)).toEqual(['wrong', 'wrong', 'wrong', 'show-answer']);
    expect(new Set(onPersist.mock.calls.map(([payload]) => payload.attemptLog?.id)).size).toBe(3);
    fireEvent.click(hint());
    fireEvent.click(hint());
    expect(input.value).toBe('hello');
    expect(onPersist).toHaveBeenCalledTimes(3);
    fireEvent.click(screen.getByRole('button', { name: '提交' }));
    await screen.findByText('本轮学习完成', {}, { timeout: 2000 });
    expect(screen.getByText('总错误次数').nextElementSibling?.textContent).toBe('3');
    expect(screen.getByText('显示答案').nextElementSibling?.textContent).toBe('1');
    expect(screen.getByText('首次答对').nextElementSibling?.textContent).toBe('0');
  });

  it('主动显示后再使用两次提示不会重复保存显示答案', async () => {
    const { input, onPersist } = setup();
    fireEvent.click(screen.getByRole('button', { name: '显示答案' }));
    await waitUntilReady();
    fireEvent.click(hint());
    fireEvent.click(hint());
    expect(input.value).toBe('hello');
    expect(onPersist).toHaveBeenCalledTimes(1);
  });

  it.each(['hello', 'a'] )('触屏提示填充 %s 不触发自动提交，完整答案仅记录显示', async (word) => {
    vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({ matches: true }));
    const vocabulary = makeVocabulary(word);
    const { input, onPersist } = setup([vocabulary.id], [vocabulary]);
    expect(screen.queryByRole('button', { name: '提交' })).toBeNull();
    fireEvent.click(hint());
    await waitUntilReady();
    fireEvent.click(hint());
    await waitUntilReady();
    expect(input.value).toBe(word);
    expect(onPersist).toHaveBeenCalledTimes(1);
    expect(onPersist.mock.calls[0][0].attemptLog).toBeNull();
    expect(onPersist.mock.calls[0][0].studyRecord.attempts).toBe(0);
    expect(screen.queryByText('本轮学习完成')).toBeNull();
  });
});
