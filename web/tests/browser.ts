import { createServer } from 'node:http'
import { readFile, mkdir, writeFile } from 'node:fs/promises'
import { resolve, extname } from 'node:path'
import { fileURLToPath } from 'node:url'
import assert from 'node:assert/strict'
import { chromium, type BrowserContext, type Page } from 'playwright'
import { decodeFunctionData, parseUnits } from 'viem'
import { deployment, abis, makeState, respond, walletInit, account, otherAccount, type MockState } from './fixture'
const root=fileURLToPath(new URL('../../',import.meta.url)), dist=resolve(root,'dist'), evidence=resolve(root,'docs/evidence')
await mkdir(evidence,{recursive:true})
const state=makeState()
const handleRpc=(body:{id:number;method:string;params?:unknown[]})=>{try{return {jsonrpc:'2.0',id:body.id,result:respond(state,body.method,body.params)}}catch(error){const e=error as {code?:number;message?:string};return {jsonrpc:'2.0',id:body.id,error:{code:e.code??-32000,message:e.message??String(error)}}}}
// Serve the exact export bytes through Playwright routing: this worker denies browser loopback sockets.
const url='https://candles.test/preview/'
async function routeRequest(route: import('playwright').Route) {
  const request=route.request(), requestUrl=new URL(request.url())
  if(request.method()==='POST') { await route.fulfill({json:handleRpc(request.postDataJSON())}); return }
  if(requestUrl.origin!=='https://candles.test') { await route.abort(); return }
  const pathname=decodeURIComponent(requestUrl.pathname)
  const path=resolve(dist,pathname.replace(/^\/preview\//,'')||'index.html')
  if(!path.startsWith(dist+'/')) {await route.fulfill({status:404,body:''});return}
  try {await route.fulfill({body:await readFile(path),contentType:({'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.woff2':'font/woff2'} as Record<string,string>)[extname(path)]||'application/octet-stream'})}
  catch {await route.fulfill({status:404,body:''})}
}
const browser=await chromium.launch({headless:true,args:['--no-sandbox']})
let latestPage:Page|undefined
const checks:string[]=[],screenshots:string[]=[],errors:string[]=[]
const check=(name:string)=>{checks.push(name);console.log(`PASS ${name}`)}
async function newPage(wallet=true, chain=deployment.app.walletAddChain.chainId as string){
  const context=await browser.newContext({viewport:{width:1440,height:1080}})
  await context.route('**/*',routeRequest)
  await context.addInitScript({content: `window.__name = (value) => value; ${wallet ? '('+walletInit.toString()+')('+JSON.stringify({initialChain:chain})+');' : ''}`})
  const page=await context.newPage();latestPage=page;page.setDefaultTimeout(12000)
  page.on('pageerror',e=>errors.push(e.message))
  page.on('response',r=>{if(r.url().startsWith(url)&&r.status()>=400)errors.push(`Resource ${r.status()}: ${r.url()}`)})
  await page.goto(url)
  await page.getByRole('heading',{name:'Trade Candles'}).waitFor()
  return {page,context}
}
const waitReady=async(page:Page)=>{await page.getByText('Live pool',{exact:true}).waitFor();await page.waitForFunction(()=>!(document.querySelector('button.primary') as HTMLButtonElement)?.disabled)}
const connect=async(page:Page)=>{await page.getByRole('button',{name:'Connect wallet'}).click();await waitReady(page)}
const quote=async(page:Page,value:string)=>{await page.getByLabel('You pay').fill(value);await page.getByRole('button',{name:'Get quote',exact:true}).click();await page.getByText('Quote ready.',{exact:false}).waitFor()}
async function screenshot(page:Page,name:string){await page.screenshot({path:resolve(evidence,name),fullPage:true});screenshots.push(`docs/evidence/${name}`)}
try{
  let {page,context}=await newPage(false)
  await page.getByText('Live pool',{exact:true}).waitFor()
  assert.equal(await page.getByRole('button',{name:'Get quote',exact:true}).isDisabled(),true)
  await page.getByRole('button',{name:'Connect wallet'}).click();await page.getByText('No browser wallet found.',{exact:false}).waitFor()
  check('Disconnected reads, disabled transactions, and actionable missing-wallet error')
  await context.close()
  ;({page,context}=await newPage(true,'0x1'))
  await page.getByRole('button',{name:'Connect wallet'}).click()
  await page.getByRole('button',{name:'Switch to Sepolia'}).waitFor()
  assert.equal(await page.getByRole('button',{name:'Get quote',exact:true}).isDisabled(),true)
  await page.getByRole('button',{name:'Switch to Sepolia'}).click();await waitReady(page)
  const walletCalls=await page.evaluate(()=> (window.ethereum as any).state.calls)
  assert.deepEqual(walletCalls.filter((x:any)=>x.method.startsWith('wallet_')).map((x:any)=>x.method),['wallet_switchEthereumChain','wallet_addEthereumChain','wallet_switchEthereumChain'])
  assert.deepEqual(walletCalls.find((x:any)=>x.method==='wallet_addEthereumChain').params,[deployment.app.walletAddChain])
  check('Wrong chain blocks trading; unknown chain adds exact supplied parameters and switches again')
  assert.equal(await page.locator('[data-volume-bar]').count(),288)
  await page.getByLabel('Inspect five-minute candle').fill('0');await page.getByText('Flat gap',{exact:false}).first().waitFor()
  await page.getByLabel('Inspect five-minute candle').press('ArrowRight');assert.equal(await page.getByLabel('Inspect five-minute candle').inputValue(),'1')
  await page.getByText('View candle data',{exact:false}).click();assert.equal(await page.locator('tbody tr').count(),288);await page.getByText('View candle data',{exact:false}).click()
  check('288 chart candles and volume bars, leading flat gap, keyboard selector and data table')
  await page.getByRole('button',{name:'Get quote',exact:true}).click();await page.locator('#amount[aria-invalid=true]').waitFor();assert.equal(await page.locator('#amount').evaluate(e=>e===document.activeElement),true)
  await page.getByLabel('You pay').fill('0.001');await page.getByLabel('Price tolerance').fill('99');await page.getByRole('button',{name:'Get quote',exact:true}).click();await page.locator('#slippage[aria-invalid=true]').waitFor()
  await page.getByLabel('Price tolerance').fill('0.5')
  check('Invalid amounts/tolerance show inline errors and focus the offending input')
  await quote(page,'0.001');assert.equal(state.submitted.length,0)
  await page.getByRole('button',{name:'Preview swap'}).click();await page.getByRole('button',{name:'Confirm buy'}).waitFor()
  await screenshot(page,'desktop-buy.png')
  await page.getByRole('button',{name:'Confirm buy'}).click();await page.getByText('Swap confirmed.',{exact:false}).waitFor()
  const buyTx=state.submitted.at(-1)!
  assert.equal(buyTx.to.toLowerCase(),deployment.app.router.address)
  assert.equal(BigInt(buyTx.value!),parseUnits('0.001',18))
  const buyArgs=decodeFunctionData({abi:abis.PoolSwapTest,data:buyTx.data as `0x${string}`}).args!
  assert.equal((buyArgs[1] as any).amountSpecified,-parseUnits('0.001',18));assert.deepEqual(buyArgs[2],{takeClaims:false,settleUsingBurn:false})
  check('Buy quotes and simulations are eth_call only; wallet request uses exact PoolSwapTest arguments and native value; receipt confirmed')
  await page.getByRole('button',{name:'Sell CNDL',exact:true}).click();await quote(page,'100')
  await page.getByRole('button',{name:'Approve 100 CNDL'}).click();await page.getByText('CNDL approval confirmed.',{exact:false}).waitFor()
  const approval=decodeFunctionData({abi:abis[deployment.app.token.contract],data:state.submitted.at(-1)!.data as `0x${string}`})
  assert.equal(approval.functionName,'approve');assert.equal(String(approval.args![0]).toLowerCase(),deployment.app.router.address);assert.equal(approval.args![1],parseUnits('100',18))
  await quote(page,'100');await page.getByRole('button',{name:'Preview swap'}).click();await page.getByRole('button',{name:'Confirm sell'}).click();await page.getByText('Swap confirmed.',{exact:false}).waitFor()
  assert.equal(BigInt(state.submitted.at(-1)!.value||'0x0'),0n)
  check('Sell requires separate exact CNDL approval to PoolSwapTest, then quotes, simulates and confirms a zero-value sell')
  state.partial=true
  await page.getByRole('button',{name:'Buy CNDL',exact:true}).click();await quote(page,'0.002');await page.getByRole('button',{name:'Preview swap'}).click();await page.getByText('Partial fill:',{exact:true}).waitFor()
  check('Partial-fill simulation shows actual spend and unspent input')
  state.partial=false
  await page.getByLabel('You pay').fill('0.003');assert.equal(await page.getByRole('button',{name:'Confirm buy'}).count(),0)
  await quote(page,'0.003');state.revertSwap=true;const sendsBefore=state.submitted.length;await page.getByRole('button',{name:'Preview swap'}).click();await page.locator('#trade-error').filter({hasText:/revert|PriceLimit/i}).waitFor();assert.equal(state.submitted.length,sendsBefore);state.revertSwap=false
  check('Input changes invalidate previews; failed simulation surfaces revert and prevents signing')
  await quote(page,'0.003');await page.getByRole('button',{name:'Preview swap'}).click();await page.getByRole('button',{name:'Confirm buy'}).waitFor();await page.evaluate(()=>{(window.ethereum as any).state.rejectSend=true});await page.getByRole('button',{name:'Confirm buy'}).click();await page.getByText('Request declined in your wallet.',{exact:false}).waitFor();assert.equal(state.submitted.length,sendsBefore);await page.evaluate(()=>{(window.ethereum as any).state.rejectSend=false})
  check('Wallet transaction rejection is recoverable and sends nothing')
  await quote(page,'0.004');await page.evaluate(other=>{const e=window.ethereum as any;e.state.accounts=[other];e.emit('accountsChanged',[other])},otherAccount);await page.getByRole('button',{name:/0x2222/}).waitFor();assert.equal(await page.getByRole('button',{name:'Preview swap'}).count(),0)
  check('Account change invalidates quote and refreshes balances')
  await waitReady(page);await quote(page,'0.001');await page.clock.install();await page.clock.fastForward(61000);await page.getByText('Quote expired or prerequisites changed.',{exact:false}).waitFor();assert.equal(await page.getByRole('button',{name:'Preview swap'}).count(),0)
  check('Quotes expire and block stale confirmation after 60 seconds')
  await context.close()
  ;({page,context}=await newPage());await connect(page)
  await page.getByText('Wallet tools',{exact:false}).first().click()
  await page.getByLabel('Recipient address').fill(otherAccount);await page.getByLabel('Amount in CNDL',{exact:true}).fill('5');await page.getByRole('button',{name:'Send CNDL',exact:true}).click();await page.getByText('CNDL transfer confirmed.',{exact:false}).waitFor()
  const transfer=decodeFunctionData({abi:abis[deployment.app.token.contract],data:state.submitted.at(-1)!.data as `0x${string}`});assert.equal(transfer.functionName,'transfer');assert.equal(transfer.args![1],parseUnits('5',18))
  await page.getByRole('button',{name:'Revoke approval'}).click();await page.getByText('Router allowance revoked.',{exact:false}).waitFor();assert.equal(state.allowance,0n)
  check('Token transfer and router-approval revocation simulate, send and wait for receipts')
  await page.getByText('Wallet tools',{exact:false}).first().click()
  const axePath=resolve(root,'web/node_modules/axe-core/axe.min.js')
  await page.addScriptTag({path:axePath});const audit=await page.evaluate(async()=>await (window as any).axe.run(document,{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21aa']}}))
  await writeFile(resolve(evidence,'accessibility.json'),JSON.stringify({violations:audit.violations,passes:audit.passes.map((p:any)=>p.id),incomplete:audit.incomplete.map((p:any)=>({id:p.id,impact:p.impact,nodes:p.nodes.map((n:any)=>n.target)}))},null,2))
  assert.deepEqual(audit.violations.map((v:any)=>v.id),[])
  check('Automated axe WCAG 2/2.1 A/AA scan has no violations in connected populated state')
  const layouts=[]
  for(const width of [1440,940,750,390,320]){
    await page.setViewportSize({width,height:1000});await page.waitForTimeout(100)
    const layout=await page.evaluate(()=>({viewport:innerWidth,scroll:document.documentElement.scrollWidth,font:document.fonts.check('500 16px "DM Sans Variable"')}))
    assert.ok(layout.scroll<=width,`Overflow at ${width}: ${layout.scroll}`);assert.equal(layout.font,true);layouts.push(layout)
    if(width===1440)await screenshot(page,'desktop.png')
    if(width===390)await screenshot(page,'mobile.png')
    if(width===320)await screenshot(page,'mobile-320.png')
  }
  await writeFile(resolve(evidence,'layouts.json'),JSON.stringify(layouts,null,2))
  await page.setViewportSize({width:940,height:1080});await page.evaluate(()=>document.documentElement.style.fontSize='32px');assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.evaluate(()=>document.documentElement.style.fontSize='')
  check('1440/940/750/390/320px reflow, local font loaded, plus 200% text enlargement without document overflow')
  await page.setViewportSize({width:390,height:1000});await page.keyboard.press('Tab');await page.getByLabel('You pay').focus();await screenshot(page,'keyboard-focus.png')
  const focus=await page.getByLabel('You pay').evaluate(e=>({outline:getComputedStyle(e).outlineWidth,color:getComputedStyle(e).outlineColor}));assert.equal(focus.outline,'3px')
  await page.emulateMedia({reducedMotion:'reduce'});assert.equal(await page.getByRole('button',{name:'Get quote',exact:true}).evaluate(e=>getComputedStyle(e).transitionDuration),'0s')
  check('Visible 3px keyboard focus and reduced-motion transition suppression')
  const contrast=await page.evaluate(()=>{
    const luminance=(rgb:string)=>{const a=rgb.match(/[\d.]+/g)!.slice(0,3).map(Number).map(x=>{x/=255;return x<=.04045?x/12.92:((x+.055)/1.055)**2.4});return a[0]*.2126+a[1]*.7152+a[2]*.0722}
    const pair=(selector:string,bgSelector:string)=>{const fg=getComputedStyle(document.querySelector(selector)!).color,bg=getComputedStyle(document.querySelector(bgSelector)!).backgroundColor;const a=luminance(fg),b=luminance(bg);return {selector,foreground:fg,background:bg,ratio:(Math.max(a,b)+.05)/(Math.min(a,b)+.05)}}
    return [pair('.page-intro > p',':root'),pair('.chart-note','.chart-panel'),pair('.primary','.primary'),pair('.testnet-badge','.testnet-badge'),pair('.trade-panel h2','.trade-panel')]
  })
  await writeFile(resolve(evidence,'contrast.json'),JSON.stringify(contrast,null,2));assert.ok(contrast.every(p=>p.ratio>=4.5));check('Measured five actual text/background pairs meet 4.5:1')
  await context.close()
  state.missingCode=true
  ;({page,context}=await newPage());await page.getByText('No contract code at PoolSwapTest.',{exact:false}).waitFor();await page.getByRole('button',{name:'Connect wallet'}).click();await page.getByText('No contract code at PoolSwapTest.',{exact:false}).waitFor();assert.equal(await page.getByRole('button',{name:'Get quote',exact:true}).isDisabled(),true);check('Missing router bytecode blocks transactions');await context.close();state.missingCode=false
  state.eventsFail=true
  ;({page,context}=await newPage());await page.getByText('Activity unavailable:',{exact:false}).waitFor();await connect(page);assert.equal(await page.getByRole('button',{name:'Get quote',exact:true}).isEnabled(),true);check('Event RPC errors are separate from pool reads and trading readiness');await context.close();state.eventsFail=false
  state.failRpc=true
  ;({page,context}=await newPage());await page.getByText('Live reads unavailable.',{exact:false}).waitFor();assert.equal(await page.getByRole('button',{name:'Get quote',exact:true}).isDisabled(),true);await screenshot(page,'rpc-error.png');state.failRpc=false;await page.getByRole('button',{name:'Refresh',exact:false}).click();await page.getByText('Live pool',{exact:true}).waitFor();check('RPC failure keeps actions disabled and Refresh recovers');await context.close()
  const corrupt=await browser.newContext();await corrupt.route('**/*',routeRequest);await corrupt.route('**/abi/CNDL.json',async route=>{await route.fulfill({json:[]})});const corruptPage=await corrupt.newPage();await corruptPage.goto(url);await corruptPage.getByText('ABI verification failed for CNDL.',{exact:false}).waitFor();check('Tampered implementation ABI stops startup');await corrupt.close()
  assert.deepEqual(errors,[])
  check('No page errors or failed local production resources; relative subpath assets resolve')
  await writeFile(resolve(evidence,'browser-results.json'),JSON.stringify({timestamp:new Date().toISOString(),urlPath:'/preview/',browser:await browser.version(),checks,screenshots,errors,transactions:'Mock EIP-1193 and RPC only; no real broadcast',passed:true},null,2))
  console.log(`${checks.length} browser checks passed`)
} catch(error){if(latestPage && !latestPage.isClosed()){await latestPage.screenshot({path:resolve(evidence,'failure-debug.png'),fullPage:true});console.log((await latestPage.locator('body').innerText()).slice(-4000))}await writeFile(resolve(evidence,'browser-failure.txt'),String(error));throw error}
finally{await browser.close()}
