import { readFile, writeFile, mkdir, readdir, stat } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { resolve, relative } from 'node:path'
import { keccak256, toBytes } from 'viem'
import { interfaces } from '../config/interfaces.mjs'
const root = fileURLToPath(new URL('../../', import.meta.url))
const dist = resolve(root, 'dist')
const read = async path => JSON.parse(await readFile(resolve(root, path), 'utf8'))
const handoff = await read('web/config/handoff.json')
const networkText = await readFile(resolve(root, 'web/config/network.json'), 'utf8')
const { network, walletAddChain } = JSON.parse(networkText)
const router = await read('web/config/router.json')
const canonical = x => Array.isArray(x) ? x.map(canonical) : x && typeof x === 'object' ? Object.fromEntries(Object.keys(x).sort().map(k => [k, canonical(x[k])])) : x
const hashAbi = abi => keccak256(toBytes(JSON.stringify(canonical(abi)))).slice(2)
if (handoff.chainId !== network.chainId || Number(BigInt(walletAddChain.chainId)) !== handoff.chainId) throw Error('Network chain mismatch')
const contracts = []
const check = process.argv.includes('--check')
if (!check) await mkdir(resolve(dist, 'abi'), { recursive: true })
for (const c of handoff.contracts) {
  const path = `docs/abi/${c.name}.json`
  const pinned = execFileSync('git', ['show', `${handoff.sourceCommit}:${path}`], { cwd: root, encoding: 'utf8' })
  if (await readFile(resolve(root, path), 'utf8') !== pinned) throw Error(`Source ABI changed: ${path}`)
  if (hashAbi(JSON.parse(pinned)) !== c.abiHash) throw Error(`ABI hash mismatch: ${c.name}`)
  if (!check) await writeFile(resolve(dist, `abi/${c.name}.json`), pinned)
  contracts.push({ name: c.name, address: c.address, abiHash: c.abiHash, abiPath: `abi/${c.name}.json` })
}
const abiPaths = {}
for (const [name, abi] of Object.entries(interfaces)) {
  abiPaths[name] = `abi/${name}.json`
  if (!check) await writeFile(resolve(dist, abiPaths[name]), JSON.stringify(abi, null, 2) + '\n')
}
const files = async dir => (await Promise.all((await readdir(dir, { withFileTypes: true })).map(e => e.isDirectory() ? files(resolve(dir, e.name)) : [resolve(dir, e.name)]))).flat()
const assets = []
let bytes = 0
for (const file of (await files(dist)).sort()) {
  const path = relative(dist, file)
  if (path === 'imd-deployment.json') continue
  const size = (await stat(file)).size
  if (size > 8388608) throw Error(`Asset exceeds 8 MiB: ${path}`)
  bytes += size
  assets.push({ path, sha256: createHash('sha256').update(await readFile(file)).digest('hex') })
}
if (assets.length > 128 || bytes > 7 * 1024 * 1024) throw Error('Export exceeds project budget')
const manifest = {
  version: 1, launchId: handoff.launchId, chainId: handoff.chainId,
  sourceCommit: handoff.sourceCommit, attestationHash: handoff.attestationHash,
  contracts, assets, network,
  app: {
    pool: handoff.manifest.pool, token: handoff.manifest.token,
    hookContract: handoff.manifest.hook.contract,
    deploymentBlock: Math.min(...handoff.contracts.map(c => c.blockNumber)),
    walletAddChain, router, abiPaths,
  },
}
if (check) {
  const actual = await read('dist/imd-deployment.json')
  if (JSON.stringify(canonical(actual)) !== JSON.stringify(canonical(manifest))) throw Error('Export inventory or deployment differs; rebuild')
  for (const c of contracts) if (hashAbi(await read(`dist/${c.abiPath}`)) !== c.abiHash) throw Error('Exported ABI mismatch')
} else {
  const rawNetwork = networkText.match(/"network": (\{[\s\S]*?\n  \}),\n  "walletAddChain"/)[1]
  await writeFile(resolve(dist, 'imd-deployment.json'), JSON.stringify({ ...manifest, network: '__RAW_NETWORK__' }, null, 2).replace('"__RAW_NETWORK__"', rawNetwork) + '\n')
}
console.log(`${check ? 'Verified' : 'Exported'} ${assets.length} assets, ${bytes} bytes; both canonical ABI hashes match ${handoff.sourceCommit}`)
