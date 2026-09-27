import { chromium } from 'playwright'
import {readFile,writeFile} from 'node:fs/promises'
import {resolve,extname} from 'node:path'
import {fileURLToPath} from 'node:url'
const root=fileURLToPath(new URL('../../',import.meta.url)),dist=resolve(root,'dist')
const deployment=JSON.parse(await readFile(resolve(dist,'imd-deployment.json'),'utf8'))
const browser=await chromium.launch({headless:true,args:['--no-sandbox']})
const context=await browser.newContext({viewport:{width:1440,height:1080}})
const requests:{url:string;method:string;status:number;cors:string|null}[]=[],errors:string[]=[]
await context.route('**/*',async route=>{
 const req=route.request(),url=new URL(req.url())
 if(req.method()==='POST'){
  const body=req.postDataJSON()
  if(!deployment.network.rpcUrls.some((rpc:string)=>new URL(rpc).href===url.href)||!['eth_chainId','eth_call','eth_getCode','eth_getBlockByNumber','eth_getBalance','eth_getLogs','eth_blockNumber'].includes(body.method)){await route.abort();return}
  try{const response=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json','Origin':'https://candles.test'},body:req.postData(),signal:AbortSignal.timeout(15000)});requests.push({url:url.href,method:body.method,status:response.status,cors:response.headers.get('access-control-allow-origin')});await route.fulfill({status:response.status,contentType:'application/json',body:await response.text()})}catch(error){errors.push(String(error));await route.abort()}
  return
 }
 if(url.origin!=='https://candles.test'){await route.abort();return}
 const path=resolve(dist,url.pathname.replace(/^\/preview\//,'')||'index.html')
 if(!path.startsWith(dist+'/')){await route.abort();return}
 try{await route.fulfill({body:await readFile(path),contentType:({'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.woff2':'font/woff2'} as Record<string,string>)[extname(path)]||'application/octet-stream'})}catch{await route.fulfill({status:404,body:''})}
})
const page=await context.newPage()
page.on('pageerror',e=>errors.push(e.message))
try{
 await page.goto('https://candles.test/preview/')
 await page.getByText('Live pool',{exact:true}).waitFor({timeout:60000})
 await page.getByRole('button',{name:'Refresh',exact:false}).waitFor({state:'visible'})
 await page.screenshot({path:resolve(root,'docs/evidence/live-desktop.png'),fullPage:true})
 await page.setViewportSize({width:390,height:1000})
 await page.screenshot({path:resolve(root,'docs/evidence/live-mobile.png'),fullPage:true})
 const text=await page.locator('body').innerText()
 await writeFile(resolve(root,'docs/evidence/live-browser.json'),JSON.stringify({timestamp:new Date().toISOString(),browser:await browser.version(),transport:'Exact production bytes served by Playwright; public RPC responses relayed unchanged by Node fetch because browser loopback/network is restricted.',requests,errors,livePoolVisible:text.includes('Live pool'),flatGapVisible:text.includes('Flat gap'),transactionsBroadcast:0},null,2)+'\n')
 console.log(`Live browser reads passed, ${requests.length} RPC requests, ${errors.length} errors`)
}catch(error){errors.push(String(error));await writeFile(resolve(root,'docs/evidence/live-browser.json'),JSON.stringify({timestamp:new Date().toISOString(),livePoolVisible:false,requests,errors,transactionsBroadcast:0},null,2));console.log((await page.locator('body').innerText()).slice(0,1600));process.exitCode=2}finally{await browser.close()}
