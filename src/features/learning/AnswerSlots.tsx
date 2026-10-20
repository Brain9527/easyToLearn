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
  /** 需要高亮的错误单词序号（按空格分隔，从 0 开始） */
  wrongWordIndexes?: number[];
  /** 触屏设备：输入满后自动提交，无需回车 */
  autoSubmit?: boolean;
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

/** 按字符位置逐个单词比对，返回拼错的单词序号 */
export const findWrongWordIndexes = (word: string, input: string, ignorePunctuation = false): number[] => {
  const clean = (text: string) => {
    const lower = text.toLowerCase();
    return ignorePunctuation ? lower.replace(/[^\p{L}\p{N}]/gu, '') : lower;
  };
  const chars = Array.from(input);
  const result: number[] = [];
  let wordIndex = 0;
  groupSlots(word).forEach((group, groupIndex, groups) => {
    if (group[0].isSpace) return;
    const start = group[0].index;
    const end = group[group.length - 1].index + 1;
    const isLast = groups.slice(groupIndex + 1).every((item) => item[0].isSpace);
    // 最后一个单词吸收多余输入，避免多打字符被忽略
    const typed = chars.slice(start, isLast ? undefined : end).join('').trim();
    const expected = Array.from(word).slice(start, end).join('');
    if (clean(typed) !== clean(expected)) result.push(wordIndex);
    wordIndex += 1;
  });
  return result;
};

export function AnswerSlots({
  word,
  value,
  wrongValue,
  status,
  animationKey,
  disabled,
  inputRef,
  onInput,
  wrongWordIndexes = [],
  autoSubmit = false,
}: AnswerSlotsProps) {
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
        {(() => {
          let wordIndex = -1;
          return groupSlots(word).map((group, groupIndex) => {
            if (group[0].isSpace) {
              return <span key={groupIndex} className="slotGap">{group.map(renderSlot)}</span>;
            }
            wordIndex += 1;
            const wrong = wrongWordIndexes.includes(wordIndex);
            return (
              <span key={groupIndex} className={`slotGroup ${wrong ? 'wrongWord' : ''}`}>
                {group.map(renderSlot)}
              </span>
            );
          });
        })()}
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
        onInput={(event) => {
          // 不使用 disabled，避免 iOS 输入框失焦后键盘收起；锁定期间回退输入
          if (disabled) {
            event.currentTarget.value = value;
            return;
          }
          onInput(event.currentTarget.value);
        }}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        autoComplete="off"
        autoCapitalize="off"
        autoCorrect="off"
        spellcheck={false}
        enterKeyHint="done"
        aria-invalid={status === 'error'}
        aria-describedby="answer-feedback"
        aria-disabled={disabled}
      />
      </div>
      <p className="slotsMeta">
        {wordCount > 1 ? `${wordCount} 个单词 · ` : ''}共 {letterCount} 个字符 · {autoSubmit ? '填满后自动提交' : '直接键盘输入，Enter 提交'}
      </p>
    </div>
  );
}
