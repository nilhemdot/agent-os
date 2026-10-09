// 4px gold-gradient bar with a Caveat percentage. value is clamped to 0–100; NaN/Infinity render as 0.
export default function ProgressBar({ value, showValue = true }: { value: number; showValue?: boolean }) {
  const v = Number.isFinite(value) ? Math.max(0, Math.min(100, value)) : 0;
  return (
    <div className="flex items-center gap-3.5">
      <div className="pbar"><div className="fill" style={{ width: `${v}%` }} /></div>
      {showValue && <span className="pbar-value">{Math.round(v)}%</span>}
    </div>
  );
}
