import { useEffect, useState } from 'preact/hooks';
import type { Vocabulary, VocabularyDraft } from '../../types/models';

interface VocabularyFormProps {
  open: boolean;
  initialValue?: Vocabulary | null;
  onSubmit: (draft: VocabularyDraft) => void | Promise<void>;
  onCancel: () => void;
}

const emptyDraft: VocabularyDraft = {
  word: '',
  phonetic: '',
  meaning: '',
  mnemonic: '',
  example: '',
  exampleMeaning: '',
  notes: '',
};

export function VocabularyForm({ open, initialValue, onSubmit, onCancel }: VocabularyFormProps) {
  const [draft, setDraft] = useState<VocabularyDraft>(emptyDraft);

  useEffect(() => {
    if (!open) return;
    setDraft(initialValue ?? emptyDraft);
  }, [open, initialValue]);

  if (!open) return null;

  return (
    <div className="dialogBackdrop" role="dialog" aria-modal="true" aria-labelledby="vocabulary-form-title">
      <form
        className="dialog large card"
        onSubmit={(event) => {
          event.preventDefault();
          void onSubmit(draft);
        }}
      >
        <h3 id="vocabulary-form-title">{initialValue ? '编辑单词' : '添加单词'}</h3>
        <div className="formGrid">
          <label>
            英文
            <input required value={draft.word ?? ''} onInput={(event) => setDraft({ ...draft, word: event.currentTarget.value })} />
          </label>
          <label>
            音标
            <input value={draft.phonetic ?? ''} onInput={(event) => setDraft({ ...draft, phonetic: event.currentTarget.value })} />
          </label>
          <label>
            中文释义
            <input value={draft.meaning ?? ''} onInput={(event) => setDraft({ ...draft, meaning: event.currentTarget.value })} />
          </label>
          <label>
            中文谐音
            <input value={draft.mnemonic ?? ''} onInput={(event) => setDraft({ ...draft, mnemonic: event.currentTarget.value })} />
          </label>
          <label className="fullSpan">
            例句
            <textarea rows={2} value={draft.example ?? ''} onInput={(event) => setDraft({ ...draft, example: event.currentTarget.value })} />
          </label>
          <label className="fullSpan">
            例句翻译
            <textarea rows={2} value={draft.exampleMeaning ?? ''} onInput={(event) => setDraft({ ...draft, exampleMeaning: event.currentTarget.value })} />
          </label>
          <label className="fullSpan">
            备注
            <textarea rows={3} value={draft.notes ?? ''} onInput={(event) => setDraft({ ...draft, notes: event.currentTarget.value })} />
          </label>
        </div>
        <div className="dialogActions">
          <button type="button" className="secondaryButton" onClick={onCancel}>取消</button>
          <button type="submit" className="primaryButton">保存</button>
        </div>
      </form>
    </div>
  );
}
