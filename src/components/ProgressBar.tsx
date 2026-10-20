interface ProgressBarProps {
  value: number;
  total: number;
}

export function ProgressBar({ value, total }: ProgressBarProps) {
  const percentage = total === 0 ? 0 : Math.round((value / total) * 100);
  return (
    <div className="progressBar">
      <div
        className="progressTrack"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={total}
        aria-valuenow={value}
        aria-label={`当前进度 ${value}/${total}`}
      >
        <div className="progressFill" style={{ width: `${percentage}%` }} />
      </div>
      <span className="helperText">{value} / {total}</span>
    </div>
  );
}
