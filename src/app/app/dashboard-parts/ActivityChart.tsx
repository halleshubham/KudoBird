"use client";
import { useState } from "react";

/**
 * Certificates issued per day. One series, one hue, thin rounded bars on a shared baseline, recessive grid,
 * hover/focus tooltip, and the same numbers available as a table (never colour-only or hover-only).
 */
export function ActivityChart({ series }: { series: { date: string; count: number }[] }) {
  const [hover, setHover] = useState<number | null>(null);
  const W = 640, H = 200, PAD = { l: 32, r: 8, t: 12, b: 26 };
  const max = Math.max(1, ...series.map((s) => s.count));
  const niceMax = max <= 4 ? 4 : Math.ceil(max / 4) * 4;
  const innerW = W - PAD.l - PAD.r, innerH = H - PAD.t - PAD.b;
  const step = innerW / series.length;
  const bar = Math.max(3, Math.min(14, step * 0.6));
  const y = (v: number) => PAD.t + innerH - (v / niceMax) * innerH;
  const fmt = (d: string) => new Date(d + "T00:00:00Z").toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "UTC" });
  const total = series.reduce((n, s) => n + s.count, 0);
  const active = hover !== null ? series[hover] : null;

  return (
    <div className="space-y-2">
      <div className="relative">
        <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Certificates issued per day, ${total} in the last ${series.length} days`} className="w-full">
          {[0, 0.5, 1].map((f) => (
            <g key={f}>
              <line x1={PAD.l} x2={W - PAD.r} y1={y(niceMax * f)} y2={y(niceMax * f)} stroke="#e5e7eb" strokeWidth={1} />
              <text x={PAD.l - 6} y={y(niceMax * f) + 4} textAnchor="end" fontSize={10} fill="#6b7280">{Math.round(niceMax * f)}</text>
            </g>
          ))}
          {series.map((s, i) => {
            const x = PAD.l + i * step + (step - bar) / 2;
            const h = Math.max(s.count > 0 ? 2 : 0, innerH - (y(s.count) - PAD.t));
            return (
              <g key={s.date}>
                {/* generous invisible hit target, larger than the mark */}
                <rect x={PAD.l + i * step} y={PAD.t} width={step} height={innerH} fill="transparent" tabIndex={0} aria-label={`${fmt(s.date)}: ${s.count}`}
                  onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)} onFocus={() => setHover(i)} onBlur={() => setHover(null)} />
                {s.count > 0 && <path d={`M${x},${PAD.t + innerH} v${-(h - 4)} a4,4 0 0 1 4,-4 h${bar - 8} a4,4 0 0 1 4,4 v${h - 4} z`} fill="#7c3aed" opacity={hover === null || hover === i ? 1 : 0.45} pointerEvents="none" />}
              </g>
            );
          })}
          <line x1={PAD.l} x2={W - PAD.r} y1={PAD.t + innerH} y2={PAD.t + innerH} stroke="#9ca3af" strokeWidth={1} />
          {[0, Math.floor(series.length / 2), series.length - 1].map((i) => (
            <text key={i} x={PAD.l + i * step + step / 2} y={H - 8} textAnchor={i === 0 ? "start" : i === series.length - 1 ? "end" : "middle"} fontSize={10} fill="#6b7280">{fmt(series[i].date)}</text>
          ))}
        </svg>
        {active && (
          <div className="pointer-events-none absolute top-0 rounded-md border bg-white px-2 py-1 text-xs shadow" style={{ left: `${Math.min(80, Math.max(0, ((PAD.l + (hover! + 0.5) * step) / W) * 100 - 8))}%` }} role="status">
            <p className="text-gray-500">{fmt(active.date)}</p><p className="font-semibold">{active.count} certificate{active.count === 1 ? "" : "s"}</p>
          </div>
        )}
      </div>
      <details className="text-xs text-gray-600">
        <summary className="cursor-pointer">View as table</summary>
        <table className="mt-2 w-full max-w-xs text-left"><thead><tr><th className="py-1">Date</th><th>Certificates</th></tr></thead>
          <tbody>{series.filter((s) => s.count > 0).map((s) => <tr key={s.date} className="border-t"><td className="py-1">{fmt(s.date)}</td><td>{s.count}</td></tr>)}</tbody></table>
      </details>
    </div>
  );
}
