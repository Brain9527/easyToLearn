import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/preact';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { defaultSettings } from '../db/database';
import { LearningPage, type PracticePersistPayload } from '../features/learning/LearningPage';
import { makeVocabulary } from './fixtures';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const hello = makeVocabulary('hello', { meaning: '你好', mnemonic: '哈喽', phonetic: '/həˈləʊ/' });
const world = makeVocabulary('world', { meaning: '世界', createdAt: '2026-01-02T00:00:00.000Z' });

const setup = (ids = [hello.id, world.id]) => {
  const onPersist = vi.fn<(payload: PracticePersistPayload) => Promise<void>>().mockResolvedValue(undefined);
  render(
    <LearningPage
      vocabularies={[hello, world]}
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

  it('显示答案需主动点击，之后答对不计为首次答对', async () => {
    const { submit, onPersist } = setup([hello.id]);
    fireEvent.click(screen.getByRole('button', { name: '显示答案' }));
    await screen.findByText('hello');
    await waitFor(() => expect(onPersist).toHaveBeenCalledTimes(1));
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
});
