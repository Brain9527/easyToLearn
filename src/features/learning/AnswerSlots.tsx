import type { Ref } from 'preact';
import { useState } from 'preact/hooks';

interface AnswerSlotsProps {
  word: string;
  value: string;
  /** 答错后输入框已清空时，用于短暂展示刚才的错误拼写 */
  wrongValue?: string;
  status: 'success' | 'error' | 'info' | null;
  /** 每次变化都会重新触发整体动画（答错抖动 / 答对波浪） */
  animationKey: number;
  disabled: boolean;
  inputRef: Ref<HTMLInputElement>;
  onInput: (value: string) => void;
}

interface Slot {
  index: number;
  isSpace: boolean;
}

/** 按空格把答案拆成若干组，保证换行只发生在单词之间 */
const groupSlots = (word: string): Slot[][] => {
  const groups: Slot[][] = [[]];
  Array.from(word).forEach((char, index) => {
    if (char === ' ') {
      groups.push([{ index, isSpace: true }], []);
    } else {
      groups[groups.length - 1].push({ index, isSpace: false });
    }
  });
  return groups.filter((group) => group.length > 0);
};

export function AnswerSlots({ word, value, wrongValue, status, animationKey, disabled, inputRef, onInput }: AnswerSlotsProps) {
  const [focused, setFocused] = useState(false);
  const showingWrong = !value && status === 'error' && Boolean(wrongValue);
  const typed = Array.from(showingWrong ? wrongValue ?? '' : value);
  const wordLength = Array.from(word).length;
  const extra = typed.slice(wordLength);
  const letterCount = Array.from(word).filter((char) => char !== ' ').length;
  const wordCount = word.trim().split(/\s+/).length;

  const renderSlot = ({ index, isSpace }: Slot) => {
    const char = typed[index];
    const active = focused && !disabled && !showingWrong && index === typed.length;
    const className = [
      'slot',
      isSpace ? 'space' : '',
      char !== undefined ? 'filled' : '',
      active ? 'active' : '',
      char === ' ' && !isSpace ? 'blank' : '',
    ]
      .filter(Boolean)
      .join(' ');
    return (
      <span key={index} className={className} style={{ '--i': index }}>
        {char !== undefined && char !== ' ' ? (
          <span key={`${index}-${char}`} className="slotChar">{char}</span>
        ) : null}
      </span>
    );
  };

  return (
    <div className={`slotsField ${focused ? 'focused' : ''}`}>
      <div className="slotsStage">
      <div
        key={animationKey}
        className={`slots ${status ?? ''} ${showingWrong ? 'showingWrong' : ''}`}
        aria-hidden="true"
      >
        {groupSlots(word).map((group, groupIndex) => (
          <span key={groupIndex} className={group[0].isSpace ? 'slotGap' : 'slotGroup'}>
            {group.map(renderSlot)}
          </span>
        ))}
        {extra.length > 0 ? (
          <span className="slotGroup extra">
            {extra.map((char, offset) => (
              <span key={`x${offset}`} className="slot filled extra" style={{ '--i': wordLength + offset }}>
                <span className="slotChar">{char === ' ' ? '·' : char}</span>
              </span>
            ))}
          </span>
        ) : null}
      </div>
      <input
        ref={inputRef}
        className="slotsInput"
        aria-label="请输入英文单词"
        value={value}
        onInput={(event) => onInput(event.currentTarget.value)}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        autoComplete="off"
        autoCapitalize="off"
        autoCorrect="off"
        spellcheck={false}
        aria-invalid={status === 'error'}
        aria-describedby="answer-feedback"
        disabled={disabled}
      />
      </div>
      <p className="slotsMeta">
        {wordCount > 1 ? `${wordCount} 个单词 · ` : ''}共 {letterCount} 个字符 · 直接键盘输入，Enter 提交
      </p>
    </div>
  );
}
