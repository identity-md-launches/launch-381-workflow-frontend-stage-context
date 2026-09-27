import { encodeAbiParameters, keccak256, parseUnits, type Address } from 'viem'
import type { Config } from './config'
export interface Candle {open: number; high: number; low: number; close: number; volumeEth: bigint; volumeToken: bigint; swaps: bigint}
export interface PlotCandle extends Candle {bucket: number; gap: boolean}
export function poolKey(c: Config) { return {currency0: c.d.app.pool.pairedCurrency, currency1: c.token.address, fee: c.d.app.pool.fee, tickSpacing: c.d.app.pool.tickSpacing, hooks: c.hook.address} }
export function poolId(key: ReturnType<typeof poolKey>) { return keccak256(encodeAbiParameters([{type:'address'}, {type:'address'}, {type:'uint24'}, {type:'int24'}, {type:'address'}], [key.currency0, key.currency1, key.fee, key.tickSpacing, key.hooks])) }
export const tickPrice = (tick: number, tokenDecimals = 18, nativeDecimals = 18) => 1.0001 ** tick * 10 ** (nativeDecimals - tokenDecimals)
export const spotPrice = (sqrt: bigint, tokenDecimals: number, nativeDecimals: number) => (Number(sqrt) / 2 ** 96) ** 2 * 10 ** (nativeDecimals - tokenDecimals)
export function fillCandles(raw: Candle[], from: number, lastTick: number): PlotCandle[] {
  // The first recorded open is the previous close, including all leading gaps.
  let previous = raw.find(c => c.swaps > 0n)?.open ?? lastTick
  return raw.map((c, i) => {
    const gap = c.swaps === 0n
    const entry = gap ? {...c, open: previous, high: previous, low: previous, close: previous} : c
    previous = entry.close
    return {...entry, bucket: from + i, gap}
  })
}
export const MAX_COUNTER = (1n << 128n) - 1n
export function amountValue(text: string, decimals: number) {
  if (!/^\d+(\.\d*)?$/.test(text) || (text.split('.')[1]?.length || 0) > decimals) throw Error(`Enter a positive amount with at most ${decimals} decimal places.`)
  const amount = parseUnits(text, decimals)
  if (amount <= 0n || amount > (1n << 127n) - 1n) throw Error('Enter an amount greater than zero and within the pool’s supported range.')
  return amount
}
export function slippageBps(text: string) {
  if (!/^\d+(\.\d{0,2})?$/.test(text)) throw Error('Use a price tolerance from 0.1% to 5%, with up to two decimal places.')
  const bps = Math.round(Number(text) * 100)
  if (bps < 10 || bps > 500) throw Error('Use a price tolerance from 0.1% to 5%.')
  return BigInt(bps)
}
function sqrt(value: bigint) {
  if (value < 0n) throw Error('Negative square root')
  if (value < 2n) return value
  let x = value, y = (x + 1n) / 2n
  while (y < x) { x = y; y = (x + value / x) / 2n }
  return x
}
// Bound marginal pool-price movement; PoolSwapTest permits partial fills and has no min-output or deadline argument.
export function priceLimit(current: bigint, buy: boolean, bps: bigint) {
  const limit = buy ? sqrt(current * current * (10000n - bps) / 10000n) : sqrt(current * current * 10000n / (10000n - bps))
  const min = 4295128740n, max = 1461446703485210103287273052203988822378723970341n
  return limit < min ? min : limit > max ? max : limit
}
export function unpackDelta(delta: bigint, buy: boolean) {
  const amount0 = BigInt.asIntN(128, delta >> 128n), amount1 = BigInt.asIntN(128, delta)
  return {spent: -(buy ? amount0 : amount1), received: buy ? amount1 : amount0}
}
export const shortAddress = (a: Address | string) => `${a.slice(0, 6)}…${a.slice(-4)}`
export const number = (n: number, max = 4) => new Intl.NumberFormat('en-US', { maximumFractionDigits: max }).format(n)
