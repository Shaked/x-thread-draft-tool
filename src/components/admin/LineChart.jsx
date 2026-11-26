import './LineChart.css'

const W = 600
const H = 180
const PAD = 8

// A small line chart in inline SVG (#337). Each series is drawn on its own scale, 0 to its own maximum, so a
// count and a time can share one picture; the legend names the maximum of each. Colours come from tokens, and the
// second series is dashed, so the lines differ by more than colour. A null value leaves a gap in the line.
// `series`: [{ key, label, unit, values: [number | null] }], all of the same length.
export default function LineChart({ title, series, firstLabel, lastLabel }) {
  const count = Math.max(...series.map((s) => s.values.length), 0)
  const x = (i) => PAD + (count > 1 ? (i * (W - 2 * PAD)) / (count - 1) : (W - 2 * PAD) / 2)
  return (
    <figure className="line-chart">
      <figcaption className="line-chart__legend">
        {series.map((s, index) => {
          const max = Math.max(0, ...s.values.filter((v) => v !== null))
          return (
            <span key={s.key} className="line-chart__key">
              <svg width="24" height="8" aria-hidden="true">
                <line x1="0" y1="4" x2="24" y2="4" className={`line-chart__line line-chart__line--${index}`} />
              </svg>
              {s.label}, highest {Math.round(max * 10) / 10} {s.unit}
            </span>
          )
        })}
      </figcaption>
      <div className="line-chart__plot" dir="ltr">
        <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={title} className="line-chart__svg">
          <line x1={PAD} y1={H - PAD} x2={W - PAD} y2={H - PAD} className="line-chart__axis" />
          {series.map((s, index) => {
            const max = Math.max(0, ...s.values.filter((v) => v !== null)) || 1
            const y = (v) => H - PAD - (v / max) * (H - 2 * PAD)
            let path = ''
            let pen = false
            s.values.forEach((v, i) => {
              if (v === null) {
                pen = false
                return
              }
              path += `${pen ? 'L' : 'M'}${x(i).toFixed(1)} ${y(v).toFixed(1)}`
              pen = true
            })
            return (
              <g key={s.key} className={`line-chart__series line-chart__series--${index}`}>
                <path d={path} className={`line-chart__line line-chart__line--${index}`} />
                {s.values.map((v, i) => v !== null && <circle key={i} cx={x(i)} cy={y(v)} r="2.5" className="line-chart__dot" />)}
              </g>
            )
          })}
        </svg>
      </div>
      <div className="line-chart__ends" dir="ltr">
        <span>{firstLabel}</span>
        <span>{lastLabel}</span>
      </div>
    </figure>
  )
}
