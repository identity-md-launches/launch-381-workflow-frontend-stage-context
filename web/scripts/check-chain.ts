import { readFile, writeFile } from 'node:fs/promises'
import { createPublicClient, http, type Address } from 'viem'
import type { Deployment } from '../src/config'
const d=JSON.parse(await readFile(new URL('../../dist/imd-deployment.json',import.meta.url),'utf8')) as Deployment
const results=await Promise.all(d.network.rpcUrls.map(async url=>{
  const client=createPublicClient({transport:http(url,{timeout:10000,retryCount:0})})
  try{
    const chainId=await client.getChainId()
    if(chainId!==d.chainId)throw Error(`Wrong chain ${chainId}`)
    const contracts=await Promise.all([...d.contracts,...Object.entries(d.network.uniswapV4).map(([name,address])=>({name,address})),d.app.router].map(async c=>{const code=await client.getCode({address:c.address as Address});return {name:c.name,address:c.address,codeBytes:code?(code.length-2)/2:0}}))
    return {url,chainId,contracts,passed:contracts.every(c=>c.codeBytes>0)}
  }catch(error){const e=error as {shortMessage?:string;message?:string};return {url,passed:false,error:(e.shortMessage||e.message||String(error)).slice(0,700)}}
}))
const record={timestamp:new Date().toISOString(),expectedChainId:d.chainId,routerSource:d.app.router.source,results,liveChainVerified:results.some(r=>r.passed),realTransactionsBroadcast:0}
await writeFile(new URL('../../docs/evidence/live-chain.json',import.meta.url),JSON.stringify(record,null,2)+'\n')
console.log(JSON.stringify(record,null,2))
if(!record.liveChainVerified)process.exitCode=2
