import { readFile,writeFile } from 'node:fs/promises'
import { defineChain,createPublicClient,http,type Abi } from 'viem'
import { verifyChain,readMarket,readEvents } from '../src/chain'
import {publicClient,type Config,type Deployment} from '../src/config'
const d=JSON.parse(await readFile(new URL('../../dist/imd-deployment.json',import.meta.url),'utf8')) as Deployment
const abis:Record<string,Abi>={}
for(const [name,path] of [...d.contracts.map(c=>[c.name,c.abiPath]),...Object.entries(d.app.abiPaths)])abis[name]=JSON.parse(await readFile(new URL(`../../dist/${path}`,import.meta.url),'utf8'))
const chain=defineChain({id:d.chainId,name:d.network.name,nativeCurrency:d.network.nativeCurrency,rpcUrls:{default:{http:d.network.rpcUrls}},blockExplorers:{default:{name:'Explorer',url:d.network.explorer}},testnet:d.network.testnet})
const config:Config={d,abis,token:d.contracts.find(c=>c.name===d.app.token.contract)!,hook:d.contracts.find(c=>c.name===d.app.hookContract)!,chain}
const client=publicClient(config)
const record:Record<string,unknown>={timestamp:new Date().toISOString(),rpc:d.network.rpcUrls[0],transactionsBroadcast:0}
try{
 await verifyChain(config,client)
 const m=await readMarket(config,client)
 record.verified=true;record.market={poolId:m.id,block:m.block,timestamp:m.timestamp,sqrtPrice:m.sqrtPrice,tick:m.tick,lastTick:m.lastTick,latestBucket:m.latestBucket,liquidity:m.liquidity,decimals:m.decimals,symbol:m.symbol,supply:m.supply,price:m.price,candles:m.candles.length,recordedCandles:m.candles.filter(c=>!c.gap).length}
 try{const events=await readEvents(config,client,m.block);record.events={fromBlock:events.fromBlock,toBlock:events.toBlock,count:events.logs.length}}catch(e){record.eventsError=String(e).slice(0,500)}
 const quote=await client.simulateContract({address:d.network.uniswapV4.quoter,abi:abis.Quoter,functionName:'quoteExactInputSingle',args:[{poolKey:m.key,zeroForOne:true,exactAmount:100000000000000n,hookData:'0x'}]})
 record.quote={inputWei:'100000000000000',result:quote.result,method:'eth_call only'}
}catch(e){record.error=String(e).slice(0,1000);process.exitCode=2}
const output=JSON.stringify(record,(_,v)=>typeof v==='bigint'?v.toString():v,2)+'\n'
await writeFile(new URL('../../docs/evidence/live-reads.json',import.meta.url),output)
console.log(output)
