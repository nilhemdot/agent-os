// 4px gold-gradient bar with a Caveat percentage. value is 0–100.
export default function ProgressBar({ value, showValue = true }: { value: number; showValue?: boolean }) {
  const v = Math.max(0, Math.min(100, value));
  return (
    <div className="flex items-center gap-3.5">
      <div className="pbar"><div className="fill" style={{ width: `${v}%` }} /></div>
      {showValue && <span className="pbar-value">{Math.round(v)}%</span>}
    </div>
  );
}
