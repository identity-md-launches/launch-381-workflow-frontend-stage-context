import { readFileSync } from 'node:fs'
import { decodeFunctionData, encodeFunctionResult, encodeEventTopics, encodeAbiParameters, parseUnits, toHex, type Abi, type Hex } from 'viem'
import type { Deployment } from '../src/config'
export const deployment = JSON.parse(readFileSync(new URL('../../dist/imd-deployment.json',import.meta.url),'utf8')) as Deployment
export const account = '0x1111111111111111111111111111111111111111'
export const otherAccount = '0x2222222222222222222222222222222222222222'
export const abis = Object.fromEntries([...deployment.contracts.map(c=>[c.name,c.abiPath]),...Object.entries(deployment.app.abiPaths)].map(([n,p])=>[n,JSON.parse(readFileSync(new URL(`../../dist/${p}`,import.meta.url),'utf8')) as Abi]))
const token = deployment.contracts.find(c=>c.name===deployment.app.token.contract)!, hook = deployment.contracts.find(c=>c.name===deployment.app.hookContract)!
const byAddress = new Map([[token.address.toLowerCase(),abis[token.name]],[hook.address.toLowerCase(),abis[hook.name]],[deployment.app.router.address.toLowerCase(),abis.PoolSwapTest],[deployment.network.uniswapV4.stateView.toLowerCase(),abis.StateView],[deployment.network.uniswapV4.quoter.toLowerCase(),abis.Quoter]])
export const blockNumber = 11890000n
export const blockHash = '0x'+'ab'.repeat(32)
export const txHash = '0x'+'cd'.repeat(32)
export interface MockState {allowance:bigint;failRpc:boolean;missingCode:boolean;revertSwap:boolean;revertQuote:boolean;eventsFail:boolean;partial:boolean;submitted:{to:string;data:string;value?:string}[];calls:{method:string;params:unknown[]}[];receiptStatus:string}
export function makeState():MockState{return {allowance:0n,failRpc:false,missingCode:false,revertSwap:false,revertQuote:false,eventsFail:false,partial:false,submitted:[],calls:[],receiptStatus:'0x1'}}
const timestamp=Math.floor(Date.now()/1000)
const from = Math.floor(timestamp/300)-287
const empty={open:0,high:0,low:0,close:0,volumeEth:0n,volumeToken:0n,swaps:0n}
let previous=137910
export const candles=Array.from({length:288},(_,i)=>{
  if(i<9||i%11===0||i>283)return {...empty}
  const drift=Math.round(Math.sin(i*.16)*22+Math.cos(i*.07)*9)+2
  const open=previous,close=open+drift;previous=close
  return {open,high:Math.max(open,close)+12+(i%5)*8,low:Math.min(open,close)-10-(i%7)*7,close,volumeEth:parseUnits(String((i%17+1)*.001),18),volumeToken:parseUnits(String(1000*(i%17+1)),18),swaps:BigInt(i%6+1)}
})
const sqrtPrice=BigInt(Math.floor(Math.sqrt(1.0001**previous)*2**96))
export function respond(state:MockState, method:string,params:unknown[]=[]):unknown {
  state.calls.push({method,params})
  if(state.failRpc)throw {code:-32000,message:'RPC temporarily unavailable'}
  if(method==='eth_chainId')return toHex(deployment.chainId)
  if(method==='eth_blockNumber')return toHex(blockNumber)
  if(method==='eth_getCode')return state.missingCode && String(params[0]).toLowerCase()===deployment.app.router.address ? '0x':'0x6080604052'
  if(method==='eth_getBalance')return toHex(parseUnits('10',18))
  if(method==='eth_getBlockByNumber')return {number:toHex(blockNumber),hash:blockHash,parentHash:blockHash,nonce:'0x0000000000000000',sha3Uncles:blockHash,logsBloom:'0x'+'00'.repeat(256),transactionsRoot:blockHash,stateRoot:blockHash,receiptsRoot:blockHash,miner:account,difficulty:'0x0',totalDifficulty:'0x0',extraData:'0x',size:'0x100',gasLimit:'0x1c9c380',gasUsed:'0x100',timestamp:toHex(timestamp),transactions:[],uncles:[],baseFeePerGas:'0x3b9aca00',mixHash:blockHash}
  if(method==='eth_getTransactionReceipt')return {transactionHash:txHash,transactionIndex:'0x0',blockHash,blockNumber:toHex(blockNumber),from:account,to:state.submitted.at(-1)?.to??deployment.app.router.address,cumulativeGasUsed:'0x186a0',gasUsed:'0x186a0',contractAddress:null,logs:[],logsBloom:'0x'+'00'.repeat(256),status:state.receiptStatus,effectiveGasPrice:'0x3b9aca00',type:'0x2'}
  if(method==='eth_getTransactionByHash')return {hash:txHash,nonce:'0x1',blockHash,blockNumber:toHex(blockNumber),transactionIndex:'0x0',from:account,to:deployment.app.router.address,value:'0x0',gas:'0x186a0',gasPrice:'0x3b9aca00',input:'0x',v:'0x1',r:'0x1',s:'0x1',type:'0x2',chainId:toHex(deployment.chainId)}
  if(method==='eth_getLogs'){
    if(state.eventsFail)throw {code:-32000,message:'Log range unsupported'}
    const filter=params[0] as {fromBlock:string;toBlock:string;topics:Hex[]}
    if(BigInt(filter.toBlock)!==blockNumber)return []
    const candle=candles[280]
    return [{address:hook.address,topics:encodeEventTopics({abi:abis[hook.name],eventName:'Candle',args:{poolId:filter.topics[1],bucket:BigInt(from+280)}}),data:encodeAbiParameters([{type:'int24'},{type:'int24'},{type:'int24'},{type:'int24'},{type:'uint128'},{type:'uint128'},{type:'uint128'}],[candle.open,candle.high,candle.low,candle.close,candle.volumeEth,candle.volumeToken,candle.swaps]),blockNumber:toHex(blockNumber),blockHash,transactionHash:txHash,transactionIndex:'0x0',logIndex:'0x0',removed:false}]
  }
  if(method==='eth_sendTransaction'){
    const tx=params[0] as {to:string;data:Hex;value?:string};state.submitted.push(tx)
    if(tx.to.toLowerCase()===token.address.toLowerCase()){
      const decoded=decodeFunctionData({abi:abis[token.name],data:tx.data})
      if(decoded.functionName==='approve')state.allowance=decoded.args![1] as bigint
    }
    return txHash
  }
  if(method==='eth_estimateGas')return '0x493e0'
  if(method==='eth_call'){
    const tx=params[0] as {to:string;data:Hex;value?:string}
    const abi=byAddress.get(tx.to.toLowerCase());if(!abi)throw Error(`Unknown contract ${tx.to}`)
    const {functionName:name,args}=decodeFunctionData({abi,data:tx.data})
    let result:unknown
    switch(name){
      case 'manager':case 'poolManager':result=deployment.network.uniswapV4.poolManager;break
      case 'getSlot0':result=[sqrtPrice,previous,0,3000];break
      case 'getLiquidity':result=parseUnits('10',18);break
      case 'getCandles':result=candles;break
      case 'lastTick':result=previous;break
      case 'latestBucket':result=BigInt(from+283);break
      case 'decimals':result=18;break
      case 'symbol':result='CNDL';break
      case 'totalSupply':result=parseUnits('1000000000',18);break
      case 'balanceOf':result=parseUnits('5000',18);break
      case 'allowance':result=state.allowance;break
      case 'approve':case 'transfer':result=true;break
      case 'quoteExactInputSingle':{
        if(state.revertQuote)throw {code:3,message:'execution reverted: insufficient liquidity'}
        const a=args![0] as {zeroForOne:boolean;exactAmount:bigint};result=[a.zeroForOne?a.exactAmount*1000000n:a.exactAmount/1000000n,180000n];break
      }
      case 'swap':{
        if(state.revertSwap)throw {code:3,message:'execution reverted: PriceLimitAlreadyExceeded'}
        const a=args![1] as {zeroForOne:boolean;amountSpecified:bigint};let input=-a.amountSpecified
        if(state.partial)input/=2n
        const output=a.zeroForOne?input*1000000n:input/1000000n
        const a0=a.zeroForOne?-input:output,a1=a.zeroForOne?output:-input
        result=BigInt.asIntN(256,(BigInt.asUintN(128,a0)<<128n)|BigInt.asUintN(128,a1));break
      }
      default:throw Error(`Unimplemented function ${name}`)
    }
    return encodeFunctionResult({abi,functionName:name,result})
  }
  throw Error(`Unimplemented RPC ${method}`)
}
export const walletInit = ({initialChain, rejectConnect=false}:{initialChain:string;rejectConnect?:boolean}) => {
  const listeners:Record<string,Function[]>={}
  const state={chain:initialChain,accounts:[] as string[],unknownChain:true,rejectConnect,rejectSend:false,calls:[] as {method:string;params?:unknown}[]}
  const wallet={
    state,
    request: async ({method,params}:{method:string;params?:unknown[]})=>{
      state.calls.push({method,params})
      if(method==='eth_chainId')return state.chain
      if(method==='eth_accounts')return state.accounts
      if(method==='eth_requestAccounts'){if(state.rejectConnect)throw {code:4001,message:'User rejected'};state.accounts=['0x1111111111111111111111111111111111111111'];return state.accounts}
      if(method==='wallet_switchEthereumChain'){
        if(state.unknownChain)throw {code:4902,message:'Unknown chain'}
        state.chain=(params![0] as {chainId:string}).chainId;listeners.chainChanged?.forEach(fn=>fn(state.chain));return null
      }
      if(method==='wallet_addEthereumChain'){state.unknownChain=false;return null}
      if(method==='eth_sendTransaction'&&state.rejectSend)throw {code:4001,message:'User rejected transaction'}
      const response=await fetch('/mock-rpc',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method,params})});const json=await response.json();if(json.error)throw json.error;return json.result
    },
    on:(name:string,fn:Function)=>{(listeners[name]??=[]).push(fn)},
    removeListener:(name:string,fn:Function)=>{listeners[name]=listeners[name]?.filter(x=>x!==fn)},
    emit:(name:string,value:unknown)=>{listeners[name]?.forEach(fn=>fn(value))},
  }
  Object.defineProperty(window,'ethereum',{value:wallet,configurable:true})
}
