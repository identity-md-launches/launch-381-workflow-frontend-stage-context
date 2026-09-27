import { createPublicClient, createWalletClient, custom, defineChain, fallback, http, keccak256, toBytes, type Abi, type Address, type EIP1193Provider } from 'viem'
export interface Deployment {
  version: number; launchId: string; chainId: number; sourceCommit: string; attestationHash: string
  contracts: { name: string; address: Address; abiHash: string; abiPath: string }[]
  assets: { path: string; sha256: string }[]
  network: { chainId: number; name: string; testnet: boolean; rpcUrls: string[]; explorer: string; nativeCurrency: {name: string; symbol: string; decimals: number}; faucets: string[]; uniswapV4: Record<string, Address> }
  app: {pool: {pairedCurrency: Address; fee: number; tickSpacing: number; initialPrice: string}; token: {name: string; symbol: string; contract: string; decimals: number}; hookContract: string; deploymentBlock: number; walletAddChain: Record<string, unknown>; router: {name: string; address: Address; source: string}; abiPaths: Record<string, string>}
}
export type Provider = EIP1193Provider & { on?: (event: string, listener: (...args: unknown[]) => void) => void; removeListener?: (event: string, listener: (...args: unknown[]) => void) => void }
declare global { interface Window { ethereum?: Provider } }
function canonical(x: unknown): unknown {
  if (Array.isArray(x)) return x.map(canonical)
  if (x && typeof x === 'object') return Object.fromEntries(Object.entries(x).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, canonical(v)]))
  return x
}
export const abiHash = (abi: Abi) => keccak256(toBytes(JSON.stringify(canonical(abi)))).slice(2)
export function safePath(path: string) {
  if (!/^[a-zA-Z0-9_./-]+$/.test(path) || path.startsWith('/') || path.split('/').some(x => x === '..' || x === '.')) throw Error('Unsafe deployment asset path')
  return path
}
export async function loadConfig() {
  const get = async (path: string) => {
    const response = await fetch(new URL(safePath(path), document.baseURI), { cache: 'no-cache' })
    if (!response.ok) throw Error(`Unable to load ${path}. Reload this page.`)
    return response.json()
  }
  const d = await get('imd-deployment.json') as Deployment
  if (d.version !== 1 || d.chainId !== d.network.chainId || Number(BigInt(d.app.walletAddChain.chainId as string)) !== d.chainId) throw Error('Deployment network mismatch. Trading is disabled.')
  const abis: Record<string, Abi> = {}
  for (const c of d.contracts) {
    const abi = await get(c.abiPath) as Abi
    if (!Array.isArray(abi) || abiHash(abi) !== c.abiHash) throw Error(`ABI verification failed for ${c.name}. Trading is disabled.`)
    abis[c.name] = abi
  }
  for (const [name, path] of Object.entries(d.app.abiPaths)) {
    const response = await fetch(new URL(safePath(path), document.baseURI))
    const bytes = await response.arrayBuffer()
    const digest = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(x => x.toString(16).padStart(2, '0')).join('')
    if (!response.ok || d.assets.find(a => a.path === path)?.sha256 !== digest) throw Error(`${name} interface failed integrity verification.`)
    abis[name] = JSON.parse(new TextDecoder().decode(bytes))
  }
  const token = d.contracts.find(c => c.name === d.app.token.contract)
  const hook = d.contracts.find(c => c.name === d.app.hookContract)
  if (!token || !hook || d.app.pool.pairedCurrency !== '0x0000000000000000000000000000000000000000') throw Error('Unsupported pool configuration')
  const chain = defineChain({ id: d.chainId, name: d.network.name, nativeCurrency: d.network.nativeCurrency, rpcUrls: {default: {http: d.network.rpcUrls}}, blockExplorers: {default: {name: 'Explorer', url: d.network.explorer}}, testnet: d.network.testnet })
  return { d, abis, token, hook, chain }
}
export type Config = Awaited<ReturnType<typeof loadConfig>>
export function publicClient(c: Config, provider?: Provider) {
  const transports = c.d.network.rpcUrls.map(url => http(url, { timeout: 9000, retryCount: 0 }))
  return createPublicClient({ chain: c.chain, transport: fallback(provider ? [...transports, custom(provider, { retryCount: 0 })] : transports, { retryCount: 0 }) })
}
export const walletClient = (c: Config, provider: Provider) => createWalletClient({ chain: c.chain, transport: custom(provider) })
export async function switchChain(c: Config, provider: Provider) {
  const params: [{chainId: string}] = [{chainId: `0x${c.d.chainId.toString(16)}`}]
  try { await provider.request({ method: 'wallet_switchEthereumChain', params }) }
  catch (error) {
    const e = error as { code?: number; message?: string; data?: {originalError?: {code?: number}} }
    if (e.code !== 4902 && e.data?.originalError?.code !== 4902 && !/unknown chain|unrecognized chain|not added/i.test(e.message || '')) throw error
    await provider.request({method: 'wallet_addEthereumChain', params: [c.d.app.walletAddChain as never]})
    await provider.request({method: 'wallet_switchEthereumChain', params})
  }
}
export function errorText(error: unknown) {
  const e = error as {shortMessage?: string; message?: string; code?: number}
  if (e.code === 4001 || /rejected|denied/i.test(e.shortMessage || e.message || '')) return 'Request declined in your wallet. You can try again when ready.'
  return (e.shortMessage || e.message || 'Request failed. Check your connection and try again.').slice(0, 360)
}
