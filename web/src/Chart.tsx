import { useState } from 'react'
import { MAX_COUNTER, number, tickPrice, type PlotCandle } from './core'
import { units, type Market } from './chain'
export function Chart({market}: {market: Market | null}) {
  const [selected, setSelected] = useState(287)
  if (!market) return <div className="chart-empty"><span className="empty-mark" aria-hidden="true">▥</span><strong>Waiting for the chain</strong><p>The last 24 hours will appear when the pool responds.</p><span className="small muted">288 candles · 5 minutes each</span></div>
  const candles = market.candles
  const current = candles[selected] ?? candles[candles.length - 1]
  const price = (tick: number) => tickPrice(tick, market.decimals)
  const low = Math.min(...candles.map(c => price(c.low))), high = Math.max(...candles.map(c => price(c.high)))
  const span = Math.max(high - low, high * .004, 0.0001)
  const bottom = low - span * .14, top = high + span * .14
  const y = (p: number) => 22 + (top - p) / (top - bottom) * 220
  const maxVol = Math.max(...candles.map(c => Number(c.volumeEth)), 1)
  const x = (i: number) => 12 + i * 2.32
  const time = (c: PlotCandle) => new Date(c.bucket * 300000).toLocaleTimeString('en-GB', {timeZone: 'UTC', hour:'2-digit', minute:'2-digit'})
  const count = candles.reduce((s, c) => s + c.swaps, 0n)
  return <>
    <div className="candle-readout"><span>{time(current)} UTC {current.gap && '· Flat gap'}</span><span>O <b>{number(price(current.open), 2)}</b></span><span>H <b>{number(price(current.high), 2)}</b></span><span>L <b>{number(price(current.low), 2)}</b></span><span>C <b>{number(price(current.close), 2)}</b></span></div>
    <div className="chart-wrap">
      <svg viewBox="0 0 760 328" role="img" aria-label={`24-hour CNDL per ETH candlestick chart. ${count} swaps. Flat lines mark buckets without swaps. Use the candle selector or table below for exact values.`}>
        {[0,1,2,3,4].map(i => {const p = top - (top-bottom)*i/4; return <g key={i}><line className="grid-line" x1="8" x2="683" y1={y(p)} y2={y(p)} /><text className="axis" x="694" y={y(p)+4}>{new Intl.NumberFormat('en-US', {notation:'compact', maximumFractionDigits:2}).format(p)}</text></g>})}
        <text className="axis" x="12" y="272">Volume · ETH</text>
        {candles.map((c, i) => <g key={c.bucket} className={c.gap ? 'candle-flat' : c.close >= c.open ? 'candle-up' : 'candle-down'}>
          <line x1={x(i)} x2={x(i)} y1={y(price(c.high))} y2={y(price(c.low))} />
          {c.gap ? <line x1={x(i)-.8} x2={x(i)+.8} y1={y(price(c.close))} y2={y(price(c.close))}/> : <rect x={x(i)-.7} y={Math.min(y(price(c.open)), y(price(c.close)))} width="1.4" height={Math.max(Math.abs(y(price(c.open))-y(price(c.close))),1)} />}
          <rect data-volume-bar="true" x={x(i)-.7} y={307-Number(c.volumeEth)/maxVol*27} width="1.4" height={Number(c.volumeEth)/maxVol*27} />
        </g>)}
        <line className="crosshair" x1={x(selected)} x2={x(selected)} y1="16" y2="308" />
        {[0,72,144,216,287].map(i => <text key={i} className="axis" x={x(i)} y="326" textAnchor={i === 287 ? 'end' : 'start'}>{time(candles[i])}</text>)}
      </svg>
    </div>
    <div className="chart-selector"><label htmlFor="candle-range">Inspect candle <span>{time(current)} UTC</span></label><input id="candle-range" aria-label="Inspect five-minute candle" type="range" min="0" max={candles.length-1} value={selected} onChange={e => setSelected(Number(e.target.value))}/><span className="small muted">{current.swaps === MAX_COUNTER ? '≥ ' : ''}{current.swaps.toString()} swaps · {current.volumeEth === MAX_COUNTER ? '≥ ' : ''}{units(current.volumeEth, 18)} ETH · {current.volumeToken === MAX_COUNTER ? '≥ ' : ''}{units(current.volumeToken, market.decimals)} CNDL</span></div>
    <details className="candle-table"><summary>View candle data <span>288 buckets</span></summary><div className="table-scroll" tabIndex={0} role="region" aria-label="24-hour candle data"><table><caption>Five-minute candles · UTC · OHLC in CNDL per ETH. ≥ means a saturated onchain counter.</caption><thead><tr>{['Time','Open','High','Low','Close','ETH volume','CNDL volume','Swaps','Record'].map(h => <th key={h} scope="col">{h}</th>)}</tr></thead><tbody>{candles.slice().reverse().map(c => <tr key={c.bucket}><th scope="row">{time(c)}</th>{[c.open,c.high,c.low,c.close].map((tick,i) => <td key={i}>{number(price(tick), 4)}</td>)}<td>{c.volumeEth === MAX_COUNTER && '≥ '}{units(c.volumeEth,18)}</td><td>{c.volumeToken === MAX_COUNTER && '≥ '}{units(c.volumeToken,market.decimals)}</td><td>{c.swaps === MAX_COUNTER && '≥ '}{c.swaps.toString()}</td><td>{c.gap ? 'Flat gap' : 'Recorded'}</td></tr>)}</tbody></table></div></details>
  </>
}
