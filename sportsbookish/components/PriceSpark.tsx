// Tiny inline sparkline showing the recent line movement.
// Pure SVG; no charting library.

interface Point { t: string; p: number }

interface Props {
  points: Point[];
  width?: number;
  height?: number;
  className?: string;
  stroke?: string;
}

export default function PriceSpark({ points, width = 120, height = 32, className = "", stroke = "currentColor" }: Props) {
  if (!points || points.length < 2) {
    return <div className={`text-[10px] text-neutral-600 italic ${className}`}>insufficient history</div>;
  }
  const xs = points.map((_, i) => i);
  const ys = points.map((p) => p.p);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const yRange = maxY - minY || 0.001;
  const xRange = xs.length - 1;
  const path = points.map((p, i) => {
    const x = (i / xRange) * width;
    const y = height - ((p.p - minY) / yRange) * height;
    return `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(" ");

  const first = points[0].p;
  const last = points[points.length - 1].p;
  const delta = last - first;
  const trendColor = stroke === "currentColor" ? (delta >= 0 ? "#34d399" : "#fb7185") : stroke;

  return (
    <svg width={width} height={height} className={className} viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none">
      <path d={path} fill="none" stroke={trendColor} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
