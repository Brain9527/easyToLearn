import { useEffect, useRef, useState } from 'preact/hooks';

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  description: string;
  confirmText?: string;
  cancelText?: string;
  onConfirm: () => void | Promise<void>;
  onCancel: () => void;
}

export function ConfirmDialog({
  open,
  title,
  description,
  confirmText = '确认',
  cancelText = '取消',
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const cancelRef = useRef<HTMLButtonElement>(null);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    if (!open) return undefined;
    const previous = document.activeElement as HTMLElement | null;
    cancelRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onCancel();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      previous?.focus?.();
    };
  }, [open, onCancel]);

  if (!open) return null;

  const confirm = async () => {
    if (pending) return;
    setPending(true);
    try {
      await onConfirm();
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="dialogBackdrop" role="dialog" aria-modal="true" aria-labelledby="dialog-title" aria-describedby="dialog-desc">
      <div className="dialog card">
        <h3 id="dialog-title">{title}</h3>
        <p id="dialog-desc">{description}</p>
        <div className="dialogActions">
          <button ref={cancelRef} type="button" className="secondaryButton" onClick={onCancel}>{cancelText}</button>
          <button type="button" className="dangerButton" disabled={pending} onClick={() => void confirm()}>
            {pending ? '处理中...' : confirmText}
          </button>
        </div>
      </div>
    </div>
  );
}
