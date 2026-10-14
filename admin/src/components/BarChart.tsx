import { useState } from 'react'
import { formatDay } from '../lib/format'

type Point = { date: string; value: number; detail: string }

// Orders per day: one series, so the title names it and no legend is needed.
// Hovering (or focusing) a bar shows that day's numbers.
//
// The bars are SVG stretched to the card's width; the labels are ordinary
// text underneath, so they are never stretched with them.
export default function BarChart({ points, label }: { points: Point[]; label: string }) {
  const [active, setActive] = useState<number | null>(null)
  const max = Math.max(1, ...points.map((point) => point.value))
  const width = 640
  const height = 160
  const gap = 6
  const barWidth = (width - gap * (points.length - 1)) / points.length
  const shown = active !== null ? points[active] : null
  const labelled = (index: number) => index === 0 || index === points.length - 1 || index % 7 === 0

  return (
    <figure className="chart">
      <div className="chart-readout" aria-live="polite">
        {shown ? (
          <>
            <strong>{formatDay(shown.date)}</strong> · {shown.detail}
          </>
        ) : (
          <span className="muted">Hover a bar for that day · busiest day: {max}</span>
        )}
      </div>
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={label} preserveAspectRatio="none">
        <line className="chart-grid" x1={0} x2={width} y1={height / 2} y2={height / 2} vectorEffect="non-scaling-stroke" />
        <line className="chart-grid" x1={0} x2={width} y1={1} y2={1} vectorEffect="non-scaling-stroke" />
        {points.map((point, index) => {
          const barHeight = point.value ? Math.max(3, (point.value / max) * (height - 2)) : 0
          const x = index * (barWidth + gap)
          const y = height - barHeight

          return (
            <g
              key={point.date}
              tabIndex={0}
              onMouseEnter={() => setActive(index)}
              onMouseLeave={() => setActive(null)}
              onFocus={() => setActive(index)}
              onBlur={() => setActive(null)}
            >
              {/* A hit area as tall as the chart, so short bars are easy to hover. */}
              <rect x={x} y={0} width={barWidth} height={height} fill="transparent" />
              {barHeight > 0 && (
                <rect className={active === index ? 'chart-bar active' : 'chart-bar'} x={x} y={y} width={barWidth} height={barHeight} rx={3} />
              )}
            </g>
          )
        })}
        <line className="chart-axis" x1={0} x2={width} y1={height} y2={height} vectorEffect="non-scaling-stroke" />
      </svg>
      <div className="chart-labels" aria-hidden="true">
        {points.map((point, index) => (
          <span key={point.date}>{labelled(index) ? (index === points.length - 1 ? 'Today' : formatDay(point.date)) : ''}</span>
        ))}
      </div>
      <figcaption className="sr-only">
        {points.map((point) => `${formatDay(point.date)}: ${point.detail}`).join('; ')}
      </figcaption>
    </figure>
  )
}
