import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { encodeAbiParameters, parseUnits, type Abi } from 'viem'
import { abiHash, safePath, switchChain, type Config, type Provider } from '../src/config'
import { amountValue, fillCandles, MAX_COUNTER, poolId, priceLimit, slippageBps, tickPrice, unpackDelta, type Candle } from '../src/core'
const empty: Candle = {open:0,high:0,low:0,close:0,volumeEth:0n,volumeToken:0n,swaps:0n}
const recorded: Candle = {...empty,open:-10,high:2,low:-20,close:0,volumeEth:1n,swaps:1n}
test('leading, middle and trailing gaps carry true preceding tick; recorded zero ticks remain records', () => {
  const result = fillCandles([empty,empty,recorded,empty,{...recorded,open:0,close:12},empty],100,99)
  assert.deepEqual(result.map(c=>c.close),[-10,-10,0,0,12,12])
  assert.equal(result[2].gap,false); assert.equal(result[3].volumeEth,0n)
  assert.equal(result[5].bucket,105)
})
test('an entirely empty 24h window uses hook lastTick, never a fake price',()=>{const result=fillCandles(Array(288).fill(empty),42,-123);assert.equal(result.length,288);assert.ok(result.every(c=>c.open===-123 && c.gap))})
test('signed and extreme ticks remain finite; native/token decimal adjustment is explicit',()=>{for(const t of [-887272,-1,0,1,887272])assert.ok(Number.isFinite(tickPrice(t))&&tickPrice(t)>0);assert.equal(tickPrice(0,6,18),1e12)})
test('volumes preserve bigint precision and saturated counters',()=>{assert.equal(fillCandles([{...recorded,volumeEth:MAX_COUNTER}],0,0)[0].volumeEth,MAX_COUNTER)})
test('amount validation rejects zero, negatives, exponent, overprecision and uint128 overflow',()=>{for(const value of ['0','-1','1e3','.1','1.0000001','340282366920938463463374607431768211456'])assert.throws(()=>amountValue(value,6));assert.equal(amountValue('1.000001',6),1000001n)})
test('tolerance is restricted and both directions enforce a bounded sqrt price',()=>{for(const s of ['0','-1','5.01','NaN','0.001'])assert.throws(()=>slippageBps(s));const x=1000n*2n**96n;assert.ok(priceLimit(x,true,50n)<x);assert.ok(priceLimit(x,false,50n)>x);assert.equal(slippageBps('0.5'),50n)})
test('PoolSwapTest balance deltas decode signed 128-bit halves for buy and sell',()=>{const pack=(a:bigint,b:bigint)=>BigInt.asIntN(256,(BigInt.asUintN(128,a)<<128n)|BigInt.asUintN(128,b));assert.deepEqual(unpackDelta(pack(-100n,90n),true),{spent:100n,received:90n});assert.deepEqual(unpackDelta(pack(80n,-100n),false),{spent:100n,received:80n})})
test('pool identifier uses canonical ABI encoding',()=>{const key={currency0:'0x0000000000000000000000000000000000000000',currency1:'0x0000000000000000000000000000000000000001',fee:3000,tickSpacing:60,hooks:'0x0000000000000000000000000000000000001040'} as const; assert.equal(poolId(key).length,66);assert.notEqual(poolId(key),poolId({...key,fee:500}))})
test('both pinned implementation ABI hashes match their attestation',()=>{const handoff=JSON.parse(readFileSync(new URL('../config/handoff.json',import.meta.url),'utf8'));for(const c of handoff.contracts){const abi=JSON.parse(readFileSync(new URL(`../../docs/abi/${c.name}.json`,import.meta.url),'utf8')) as Abi;assert.equal(abiHash(abi),c.abiHash)}})
test('asset paths reject traversal, absolute paths and URLs',()=>{for(const p of ['../x','a/../x','/index.html','https://example.org/x','a/./x'])assert.throws(()=>safePath(p));assert.equal(safePath('abi/CNDL.json'),'abi/CNDL.json')})
test('unknown wallet chain adds exact handoff parameters, then switches again',async()=>{const n=JSON.parse(readFileSync(new URL('../config/network.json',import.meta.url),'utf8'));const c={d:{chainId:n.network.chainId,app:{walletAddChain:n.walletAddChain}}} as Config;const calls:{method:string;params?:unknown}[]=[];const provider={request:async(args:{method:string;params?:unknown})=>{calls.push(args);if(calls.length===1)throw {code:4902};return null}} as unknown as Provider;await switchChain(c,provider);assert.deepEqual(calls.map(x=>x.method),['wallet_switchEthereumChain','wallet_addEthereumChain','wallet_switchEthereumChain']);assert.deepEqual(calls[1].params,[n.walletAddChain])})
test('switch rejection is surfaced and never triggers add-chain',async()=>{const n=JSON.parse(readFileSync(new URL('../config/network.json',import.meta.url),'utf8'));const c={d:{chainId:n.network.chainId}} as Config;let calls=0;await assert.rejects(switchChain(c,{request:async()=>{calls++;throw {code:4001}}} as unknown as Provider));assert.equal(calls,1)})
