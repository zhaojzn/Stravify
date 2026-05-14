// Minimal SVG pie chart with no dependencies. Each slice is a single <path>
// using an arc. Labels are rendered with the legend on the right.

interface Slice { label: string; value: number; color: string }

const COLORS = [
  "#1ed760", // brand green
  "#f472b6", // pink
  "#fb923c", // orange
  "#a78bfa", // purple
  "#facc15", // yellow
  "#22d3ee", // cyan
  "#f87171", // soft red
  "#84cc16", // lime
  "#e879f9", // fuchsia
  "#fde047", // light yellow
];

function polar(cx: number, cy: number, r: number, angle: number) {
  return {
    x: cx + r * Math.cos(angle - Math.PI / 2),
    y: cy + r * Math.sin(angle - Math.PI / 2),
  };
}

function arcPath(cx: number, cy: number, r: number, start: number, end: number): string {
  const s = polar(cx, cy, r, start);
  const e = polar(cx, cy, r, end);
  const largeArc = end - start > Math.PI ? 1 : 0;
  return `M ${cx} ${cy} L ${s.x} ${s.y} A ${r} ${r} 0 ${largeArc} 1 ${e.x} ${e.y} Z`;
}

export function PieChart({ data }: { data: { label: string; value: number }[] }) {
  if (data.length === 0) return null;
  const total = data.reduce((a, b) => a + b.value, 0) || 1;
  const slices: Slice[] = data.map((d, i) => ({
    label: d.label,
    value: d.value,
    color: COLORS[i % COLORS.length],
  }));

  const cx = 110, cy = 110, r = 100;
  let cursor = 0;
  const paths = slices.map((s) => {
    const angle = (s.value / total) * Math.PI * 2;
    // Slight epsilon so a single 100% slice still draws as a full circle.
    const path = data.length === 1
      ? `M ${cx} ${cy - r} A ${r} ${r} 0 1 1 ${cx - 0.01} ${cy - r} Z`
      : arcPath(cx, cy, r, cursor, cursor + angle);
    cursor += angle;
    return { ...s, path };
  });

  return (
    <div className="flex flex-col sm:flex-row gap-6 items-center sm:items-start">
      <svg viewBox="0 0 220 220" className="w-[220px] h-[220px] shrink-0">
        {paths.map((p, i) => (
          <path key={i} d={p.path} fill={p.color} stroke="#0a0a0a" strokeWidth={1.5} />
        ))}
      </svg>
      <ul className="flex-1 w-full">
        {slices.map((s, i) => {
          const pct = Math.round((s.value / total) * 100);
          return (
            <li key={i} className="flex items-center justify-between py-2 border-b border-line last:border-b-0 text-sm">
              <span className="flex items-center gap-2.5">
                <span className="inline-block w-2.5 h-2.5 rounded-sm" style={{ background: s.color }} />
                <span className="text-fg">{s.label}</span>
              </span>
              <span className="text-muted tabular-nums">{pct}%</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
