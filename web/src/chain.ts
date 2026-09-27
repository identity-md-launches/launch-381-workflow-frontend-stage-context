import { formatUnits, getAbiItem, type AbiEvent, type Address } from 'viem'
import { publicClient, type Config, type Provider } from './config'
import { fillCandles, poolId, poolKey, spotPrice, type Candle } from './core'
export type Client = ReturnType<typeof publicClient>
export async function verifyChain(c: Config, client: Client) {
  if (await client.getChainId() !== c.d.chainId) throw Error('RPC returned the wrong chain. Trading is disabled.')
  const addresses = [...c.d.contracts, ...['poolManager', 'stateView', 'quoter'].map(name => ({name, address: c.d.network.uniswapV4[name]})), c.d.app.router]
  await Promise.all(addresses.map(async x => { const code = await client.getCode({address: x.address}); if (!code || code === '0x') throw Error(`No contract code at ${x.name}. Trading is disabled.`) }))
  const [hookManager, routerManager] = await Promise.all([
    client.readContract({address: c.hook.address, abi: c.abis[c.hook.name], functionName: 'poolManager'}),
    client.readContract({address: c.d.app.router.address, abi: c.abis.PoolSwapTest, functionName: 'manager'}),
  ])
  if ([hookManager, routerManager].some(a => String(a).toLowerCase() !== c.d.network.uniswapV4.poolManager.toLowerCase())) throw Error('Router or hook PoolManager mismatch. Trading is disabled.')
}
export async function readMarket(c: Config, client: Client, account?: Address) {
  const key = poolKey(c), id = poolId(key)
  const block = await client.getBlock()
  const from = Math.floor(Number(block.timestamp) / 300) - 287
  const hookRead = (functionName: string, args: unknown[] = []) => client.readContract({address: c.hook.address, abi: c.abis[c.hook.name], functionName, args, blockNumber: block.number})
  const tokenRead = (functionName: string, args: unknown[] = []) => client.readContract({address: c.token.address, abi: c.abis[c.token.name], functionName, args, blockNumber: block.number})
  const [slot, liquidity, candles, lastTick, latestBucket, decimals, symbol, supply, tokenBalance, nativeBalance, allowance] = await Promise.all([
    client.readContract({address: c.d.network.uniswapV4.stateView, abi: c.abis.StateView, functionName: 'getSlot0', args: [id], blockNumber: block.number}) as Promise<readonly [bigint, number, number, number]>,
    client.readContract({address: c.d.network.uniswapV4.stateView, abi: c.abis.StateView, functionName: 'getLiquidity', args: [id], blockNumber: block.number}) as Promise<bigint>,
    hookRead('getCandles', [id, BigInt(from), 288n]) as Promise<Candle[]>,
    hookRead('lastTick', [id]) as Promise<number>, hookRead('latestBucket', [id]) as Promise<bigint>,
    tokenRead('decimals') as Promise<number>, tokenRead('symbol') as Promise<string>, tokenRead('totalSupply') as Promise<bigint>,
    account ? tokenRead('balanceOf', [account]) as Promise<bigint> : 0n,
    account ? client.getBalance({address: account, blockNumber: block.number}) : 0n,
    account ? tokenRead('allowance', [account, c.d.app.router.address]) as Promise<bigint> : 0n,
  ])
  if (decimals !== c.d.app.token.decimals || symbol !== c.d.app.token.symbol) throw Error('Token metadata differs from deployment. Trading is disabled.')
  if (!slot[0]) throw Error('The pool is not initialized. Trading is unavailable.')
  return {id, key, block: block.number, timestamp: Number(block.timestamp), from, sqrtPrice: slot[0], tick: slot[1], protocolFee: slot[2], lpFee: slot[3], liquidity, candles: fillCandles(candles, from, lastTick), lastTick, latestBucket, decimals, symbol, supply, tokenBalance, nativeBalance, allowance, price: spotPrice(slot[0], decimals, c.d.network.nativeCurrency.decimals), fetchedAt: Date.now()}
}
export type Market = Awaited<ReturnType<typeof readMarket>>
export async function readEvents(c: Config, client: Client, block: bigint) {
  const floor = BigInt(c.d.app.deploymentBlock)
  const start = block > floor + 1999n ? block - 1999n : floor
  const event = getAbiItem({abi: c.abis[c.hook.name], name: 'Candle'}) as AbiEvent
  const logs = []
  for (let fromBlock = start; fromBlock <= block; fromBlock += 500n) {
    const toBlock = fromBlock + 499n > block ? block : fromBlock + 499n
    const chunk = await client.getLogs({address: c.hook.address, event, args: {poolId: poolId(poolKey(c))}, fromBlock, toBlock})
    logs.push(...chunk)
  }
  return {fromBlock: start, toBlock: block, logs: logs.filter(x => !x.removed).reverse().slice(0, 8)}
}
export type Events = Awaited<ReturnType<typeof readEvents>>
export async function requireWallet(c: Config, provider: Provider, account: Address) {
  const [chain, accounts] = await Promise.all([provider.request({method: 'eth_chainId'}), provider.request({method: 'eth_accounts'})])
  if (Number(BigInt(chain)) !== c.d.chainId || accounts[0]?.toLowerCase() !== account.toLowerCase()) throw Error('Wallet account or network changed. Connect again and request a fresh quote.')
}
export function units(value: bigint, decimals: number, max = 5) {
  const exact = formatUnits(value, decimals)
  const n = Number(exact)
  if (n && n < 10 ** -max) return n.toExponential(2)
  return new Intl.NumberFormat('en-US', {maximumFractionDigits: max}).format(n)
}
