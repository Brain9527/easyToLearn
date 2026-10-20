import { Volume2 } from 'lucide-preact';

interface AudioButtonProps {
  onClick: () => void | Promise<void>;
  label?: string;
  disabled?: boolean;
}

export function AudioButton({ onClick, label = '播放发音', disabled = false }: AudioButtonProps) {
  return (
    <button type="button" className="iconButton" onClick={() => void onClick()} disabled={disabled} aria-label={label} title={label}>
      <Volume2 size={16} />
    </button>
  );
}
