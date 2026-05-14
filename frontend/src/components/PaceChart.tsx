import { useMemo, useState } from "react";

interface Track {
  trackId: string;
  trackName: string;
  artistNames: string[];
  playedAt: string;
  imageUrl?: string;
}

interface Streams {
  time: number[];      // seconds from activity start
  distance: number[];  // meters
  velocity: number[];  // m/s
}

interface Props {
  startTime: string;   // ISO start of activity
  elapsedSeconds: number;
  streams: Streams;
  tracks: Track[];
}

// Render a clean SVG line chart of pace over time, with little dots at the
// moment each track started. Hovering a dot shows the track + artist.
export function PaceChart({ startTime, elapsedSeconds, streams, tracks }: Props) {
  const W = 720, H = 220;
  const padL = 44, padR = 12, padT = 14, padB = 32;
  const innerW = W - padL - padR;
  const innerH = H - padT - padB;

  const startMs = useMemo(() => new Date(startTime).getTime(), [startTime]);

  // Pace = min/km. velocity 0 → effectively paused; clip to a sensible ceiling.
  const PACE_CEIL = 12; // min/km
  const points = useMemo(() => streams.time.map((t, i) => {
    const v = streams.velocity[i] ?? 0;
    const paceMinPerKm = v > 0.3 ? 1000 / v / 60 : PACE_CEIL;
    return { t, pace: Math.min(paceMinPerKm, PACE_CEIL) };
  }), [streams]);

  // Y axis: lower pace = faster = higher on chart. Invert.
  const maxPace = Math.min(PACE_CEIL, Math.max(4, ...points.map(p => p.pace)) + 0.5);
  const minPace = Math.max(2.5, Math.min(...points.map(p => p.pace)) - 0.3);
  const xT = (t: number) => padL + (t / elapsedSeconds) * innerW;
  const yP = (p: number) => padT + ((p - minPace) / (maxPace - minPace)) * innerH;

  const linePath = useMemo(() => {
    if (points.length === 0) return "";
    return points.map((p, i) =>
      `${i === 0 ? "M" : "L"} ${xT(p.t).toFixed(2)} ${yP(p.pace).toFixed(2)}`
    ).join(" ");
  }, [points, elapsedSeconds, minPace, maxPace]);

  // Track dots: position each track at its play time relative to the run start.
  const trackDots = useMemo(() => tracks
    .map(track => ({
      track,
      offsetSec: (new Date(track.playedAt).getTime() - startMs) / 1000,
    }))
    .filter(d => d.offsetSec >= 0 && d.offsetSec <= elapsedSeconds + 60)
    .map(d => ({
      ...d,
      x: xT(Math.min(d.offsetSec, elapsedSeconds)),
      // Find pace at this moment for vertical placement (nearest point).
      pace: nearestPace(points, d.offsetSec),
    })), [tracks, startMs, elapsedSeconds, points, minPace, maxPace]);

  const [hovered, setHovered] = useState<number | null>(null);
  // Touch devices don't have real hover. Avoid attaching mouse-enter/leave
  // there or the tooltip flashes on tap.
  const isTouch = useMemo(
    () => typeof window !== "undefined" && window.matchMedia("(hover: none)").matches,
    [],
  );

  // Y-axis pace ticks (3 lines).
  const ticks = useMemo(() => {
    const step = (maxPace - minPace) / 3;
    return [0, 1, 2, 3].map(i => minPace + step * i);
  }, [minPace, maxPace]);

  return (
    <div className="relative w-full">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto block">
        {/* gridlines */}
        {ticks.map((p, i) => (
          <g key={i}>
            <line x1={padL} y1={yP(p)} x2={W - padR} y2={yP(p)}
              stroke="#242424" strokeWidth={1} />
            <text x={padL - 8} y={yP(p) + 4} textAnchor="end"
              fontSize="10" fill="#707070">{p.toFixed(1)}</text>
          </g>
        ))}
        <text x={padL - 30} y={padT + innerH / 2} textAnchor="middle"
          transform={`rotate(-90 ${padL - 30} ${padT + innerH / 2})`}
          fontSize="10" fill="#a3a3a3">pace (min/km)</text>

        {/* x axis: time labels at 25/50/75/100% */}
        {[0, 0.25, 0.5, 0.75, 1].map((f, i) => {
          const sec = elapsedSeconds * f;
          return (
            <text key={i} x={padL + innerW * f} y={H - padB + 18}
              textAnchor={i === 0 ? "start" : i === 4 ? "end" : "middle"}
              fontSize="10" fill="#707070">{fmtTimeShort(sec)}</text>
          );
        })}

        {/* pace line */}
        <path d={linePath} fill="none" stroke="#1ed760" strokeWidth={2}
          strokeLinejoin="round" strokeLinecap="round" />

        {/* Dismiss tooltip when tapping empty chart area on mobile */}
        <rect x={0} y={0} width={W} height={H} fill="transparent"
          onClick={() => setHovered(null)} />

        {/* track dots */}
        {trackDots.map((d, i) => {
          const y = yP(d.pace);
          const active = hovered === i;
          const hoverHandlers = isTouch ? {} : {
            onMouseEnter: () => setHovered(i),
            onMouseLeave: () => setHovered(null),
          };
          return (
            <g key={i}
              {...hoverHandlers}
              onClick={(e) => { e.stopPropagation(); setHovered(i); }}
              style={{ cursor: "pointer" }}>
              <line x1={d.x} y1={padT} x2={d.x} y2={H - padB}
                stroke={active ? "#1ed76055" : "transparent"} strokeWidth={1} />
              <circle cx={d.x} cy={y} r={14} fill="transparent" />
              <circle cx={d.x} cy={y} r={active ? 6 : 4}
                fill="#0a0a0a" stroke="#1ed760" strokeWidth={2}
                pointerEvents="none" />
            </g>
          );
        })}
      </svg>

      {/* Tooltip */}
      {hovered !== null && trackDots[hovered] && (
        <div
          className="absolute bg-card-2 border border-line-strong rounded px-3 py-2 text-xs pointer-events-none flex items-center gap-2.5"
          style={{
            left: `${(trackDots[hovered].x / W) * 100}%`,
            top: 0,
            transform: "translate(-50%, calc(-100% - 6px))",
          }}
        >
          {trackDots[hovered].track.imageUrl ? (
            <img
              src={trackDots[hovered].track.imageUrl}
              alt=""
              className="w-10 h-10 rounded-sm object-cover shrink-0 bg-card"
            />
          ) : (
            <div className="w-10 h-10 rounded-sm bg-card border border-line shrink-0" />
          )}
          <div className="min-w-0">
            <div className="font-medium text-fg whitespace-nowrap">{trackDots[hovered].track.trackName}</div>
            <div className="text-muted whitespace-nowrap">{trackDots[hovered].track.artistNames.join(", ")}</div>
            <div className="text-dim mt-1 tabular-nums">{fmtTimeShort(trackDots[hovered].offsetSec)} in · {trackDots[hovered].pace.toFixed(2)} min/km</div>
          </div>
        </div>
      )}
    </div>
  );
}

function nearestPace(points: { t: number; pace: number }[], sec: number) {
  if (points.length === 0) return 0;
  let best = points[0];
  let bestDiff = Math.abs(points[0].t - sec);
  for (let i = 1; i < points.length; i++) {
    const diff = Math.abs(points[i].t - sec);
    if (diff < bestDiff) { best = points[i]; bestDiff = diff; }
  }
  return best.pace;
}

function fmtTimeShort(sec: number): string {
  const total = Math.max(0, Math.round(sec));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${m}:${String(s).padStart(2, "0")}`;
}
