import { useCallback, useEffect, useRef, useState } from 'react'
import { formatUnits, isAddress, type Abi, type Address, type Hash } from 'viem'
import { errorText, publicClient, switchChain, walletClient, type Config } from './config'
import { readEvents, readMarket, requireWallet, units, verifyChain, type Events, type Market } from './chain'
import { amountValue, number, poolKey, priceLimit, shortAddress, slippageBps, unpackDelta, MAX_COUNTER } from './core'
import { Chart } from './Chart'
interface Quote { amount: bigint; out: bigint; buy: boolean; account: Address; limit: bigint; created: number }
interface Preview {spent: bigint; received: bigint; created: number}
export default function App({config: c}: {config: Config}) {
  const [account, setAccount] = useState<Address>(), [chain, setChain] = useState<number>()
  const [market, setMarket] = useState<Market | null>(null), [events, setEvents] = useState<Events | null>(null)
  const [readError, setReadError] = useState(''), [eventError, setEventError] = useState(''), [actionError, setActionError] = useState('')
  const [loading, setLoading] = useState(true), [verified, setVerified] = useState(false)
  const [buy, setBuy] = useState(true), [amount, setAmount] = useState(''), [slippage, setSlippage] = useState('0.5')
  const [quote, setQuote] = useState<Quote | null>(null), [preview, setPreview] = useState<Preview | null>(null)
  const [busy, setBusy] = useState(''), [status, setStatus] = useState(''), [tx, setTx] = useState<Hash>()
  const [now, setNow] = useState(Date.now()), [recipient, setRecipient] = useState(''), [sendAmount, setSendAmount] = useState('')
  const requestVersion = useRef(0), walletVersion = useRef(0), mutex = useRef(false)
  const amountInput = useRef<HTMLInputElement>(null), slippageInput = useRef<HTMLInputElement>(null)
  const [fieldError, setFieldError] = useState<'amount' | 'slippage' | null>(null)
  const rightChain = chain === c.d.chainId
  const client = useCallback(() => publicClient(c, rightChain ? window.ethereum : undefined), [c, rightChain])
  const invalidate = useCallback(() => { setQuote(null); setPreview(null); setActionError(''); setFieldError(null) }, [])
  const refresh = useCallback(async () => {
    const version = ++requestVersion.current
    setLoading(true)
    try {
      const rpc = client()
      await verifyChain(c, rpc)
      const data = await readMarket(c, rpc, rightChain ? account : undefined)
      if (requestVersion.current !== version) return
      setMarket(data); setVerified(true); setReadError('')
      try {
        const logs = await readEvents(c, rpc, data.block)
        if (requestVersion.current === version) { setEvents(logs); setEventError('') }
      } catch (error) { if (requestVersion.current === version) setEventError(`Activity unavailable: ${errorText(error)} Refresh to retry.`) }
    } catch (error) {
      if (requestVersion.current === version) {setVerified(false); setReadError(`Live reads unavailable. ${errorText(error)} Use Refresh to retry.`); setQuote(null); setPreview(null)}
    } finally {if (requestVersion.current === version) setLoading(false)}
  }, [account, c, client, rightChain])
  useEffect(() => {
    void refresh()
    const timer = setInterval(() => {if (!mutex.current) void refresh()}, 30000)
    return () => {clearInterval(timer); requestVersion.current++}
  }, [refresh])
  useEffect(() => {const timer = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(timer)}, [])
  useEffect(() => {
    const provider = window.ethereum
    if (!provider) return
    const changed = () => {
      walletVersion.current++; setVerified(false); setMarket(null); invalidate()
      void Promise.all([provider.request({method:'eth_accounts'}), provider.request({method:'eth_chainId'})]).then(([accounts, chainId]) => {setAccount(accounts[0]); setChain(Number(BigInt(chainId)))}).catch(() => {setAccount(undefined); setChain(undefined)})
    }
    changed()
    provider.on?.('accountsChanged', changed); provider.on?.('chainChanged', changed); provider.on?.('disconnect', changed)
    return () => {provider.removeListener?.('accountsChanged', changed); provider.removeListener?.('chainChanged', changed); provider.removeListener?.('disconnect', changed)}
  }, [invalidate])
  const stale = !market || now - market.fetchedAt > 90000
  const ready = Boolean(account && rightChain && verified && !stale && !readError)
  const validQuote = quote && now - quote.created < 60000 && quote.account === account && quote.buy === buy && ready
  const validPreview = validQuote && preview && now - preview.created < 60000
  const needsApproval = Boolean(validQuote && !buy && market && market.allowance < quote!.amount)
  async function run(label: string, action: () => Promise<void>) {
    if (mutex.current) return
    mutex.current = true; setBusy(label); setActionError(''); setStatus('')
    try {await action()} catch (error) {setActionError(errorText(error)); setPreview(null)} finally {mutex.current = false; setBusy('')}
  }
  async function connect() {
    await run('Connecting…', async () => {
      if (!window.ethereum) throw Error('No browser wallet found. Install or open an Ethereum browser wallet, then reload this page.')
      const accounts = await window.ethereum.request({method:'eth_requestAccounts'})
      setAccount(accounts[0]); setChain(Number(BigInt(await window.ethereum.request({method:'eth_chainId'})))); invalidate()
    })
  }
  async function preflight() {
    if (!ready || !account || !window.ethereum) throw Error('Connect your wallet on Sepolia and refresh verified pool data first.')
    await requireWallet(c, window.ethereum, account)
    const rpc = client(); await verifyChain(c, rpc)
    return {rpc, provider: window.ethereum, address: account}
  }
  async function getQuote() {
    await run('Quoting…', async () => {
      setQuote(null); setPreview(null); setFieldError(null)
      let input: bigint, bps: bigint
      try {input = amountValue(amount, buy ? c.d.network.nativeCurrency.decimals : market!.decimals)} catch (error) {setFieldError('amount'); amountInput.current?.focus(); throw error}
      try {bps = slippageBps(slippage)} catch (error) {setFieldError('slippage'); slippageInput.current?.focus(); throw error}
      if (input > (buy ? market!.nativeBalance : market!.tokenBalance)) {setFieldError('amount'); amountInput.current?.focus(); throw Error(`Amount exceeds your ${buy ? 'ETH' : 'CNDL'} balance. Enter a smaller amount.`)}
      const generation = walletVersion.current
      const {rpc, provider, address} = await preflight()
      const current = await readMarket(c, rpc, address)
      const result = await rpc.simulateContract({address: c.d.network.uniswapV4.quoter, abi: c.abis.Quoter, functionName:'quoteExactInputSingle', args:[{poolKey: current.key, zeroForOne: buy, exactAmount: input, hookData:'0x'}], account: address})
      const [out] = result.result as readonly [bigint, bigint]
      if (out <= 0n) throw Error('This amount has no quoted output. Try a larger amount or refresh the pool.')
      await requireWallet(c, provider, address)
      if (generation !== walletVersion.current) throw Error('Wallet changed. Request a new quote.')
      setMarket(current); setQuote({amount: input, out, buy, account: address, limit: priceLimit(current.sqrtPrice, buy, bps), created: Date.now()}); setStatus('Quote ready. Review the price tolerance and continue.')
    })
  }
  const swapCall = (q: Quote) => ({address: c.d.app.router.address, abi: c.abis.PoolSwapTest, functionName:'swap', args:[poolKey(c), {zeroForOne:q.buy, amountSpecified:-q.amount, sqrtPriceLimitX96:q.limit}, {takeClaims:false, settleUsingBurn:false}, '0x'], value: q.buy ? q.amount : 0n})
  async function simulateSwap() {
    await run('Simulating…', async () => {
      if (!validQuote || !quote) throw Error('Quote expired. Get a fresh quote.')
      const generation = walletVersion.current
      const {rpc, provider, address} = await preflight()
      const result = await rpc.simulateContract({...swapCall(quote), account: address})
      const values = unpackDelta(result.result as bigint, quote.buy)
      if (values.spent <= 0n || values.received <= 0n || values.spent > quote.amount) throw Error('Simulation returned no usable swap. Try a different amount or price tolerance.')
      await requireWallet(c, provider, address)
      if (generation !== walletVersion.current || Date.now() - quote.created >= 60000) throw Error('Quote expired or wallet changed. Get a fresh quote.')
      setPreview({...values, created:Date.now()}); setStatus('Simulation passed. Review the amounts before confirming in your wallet.')
    })
  }
  async function send(call: {address: Address; abi: Abi; functionName: string; args: unknown[]; value?: bigint}, success: string) {
    const {rpc, provider, address} = await preflight()
    const result = await rpc.simulateContract({...call, account: address})
    await requireWallet(c, provider, address)
    setStatus('Confirm this transaction in your wallet.')
    const hash = await walletClient(c, provider).writeContract(result.request)
    setTx(hash); setStatus('Transaction submitted. Waiting for confirmation…')
    const receipt = await rpc.waitForTransactionReceipt({hash, confirmations:1, timeout:120000})
    if (receipt.status !== 'success') throw Error('Transaction reverted. Open the transaction for details, then refresh.')
    setStatus(success); setQuote(null); setPreview(null); await refresh()
  }
  async function approve(revoke = false) {
    await run(revoke ? 'Revoking…' : 'Approving…', async () => {
      if (!revoke && (!quote || !validQuote)) throw Error('Quote expired. Get a fresh quote before approval.')
      await send({address:c.token.address, abi:c.abis[c.token.name], functionName:'approve', args:[c.d.app.router.address, revoke ? 0n : quote!.amount]}, revoke ? 'Router allowance revoked.' : 'CNDL approval confirmed. Get a fresh quote to preview the swap.')
    })
  }
  async function confirmSwap() {
    await run('Confirming…', async () => {
      if (!quote || !validPreview) throw Error('Preview expired. Get a fresh quote and preview again.')
      // Re-simulate the exact reviewed parameters; refuse changed amounts instead of silently changing the trade.
      const {rpc, provider, address} = await preflight()
      const result = await rpc.simulateContract({...swapCall(quote), account:address})
      const values = unpackDelta(result.result as bigint, quote.buy)
      if (values.spent !== preview!.spent || values.received !== preview!.received || Date.now() - quote.created >= 60000) throw Error('The pool or quote changed. Get a fresh quote and review the new amounts.')
      await requireWallet(c, provider, address)
      setStatus('Confirm this swap in your wallet.')
      const hash = await walletClient(c, provider).writeContract(result.request)
      setTx(hash); setStatus('Swap submitted. Waiting for confirmation…')
      const receipt = await rpc.waitForTransactionReceipt({hash, confirmations:1, timeout:120000})
      if (receipt.status !== 'success') throw Error('Swap reverted. Check the transaction and request a new quote.')
      setStatus('Swap confirmed. Pool data refreshed.'); setQuote(null); setPreview(null); setAmount(''); await refresh()
    })
  }
  const inputSymbol = buy ? 'ETH' : 'CNDL', outputSymbol = buy ? 'CNDL' : 'ETH'
  const inputDecimals = buy ? c.d.network.nativeCurrency.decimals : (market?.decimals ?? c.d.app.token.decimals)
  const outputDecimals = buy ? (market?.decimals ?? c.d.app.token.decimals) : c.d.network.nativeCurrency.decimals
  const volume = market?.candles.reduce((sum, v) => sum + v.volumeEth, 0n)
  const swaps = market?.candles.reduce((sum, v) => sum + v.swaps, 0n)
  const saturated = market?.candles.some(v => v.volumeEth === MAX_COUNTER || v.swaps === MAX_COUNTER)
  const addressLink = (name: string, address: Address) => <a href={`${c.d.network.explorer}/address/${address}`} target="_blank" rel="noreferrer" title={address}>{name}<span className="mono">{shortAddress(address)} ↗</span></a>
  return <>
    <a className="skip-link" href="#market">Skip to market</a>
    <header className="site-header"><a href="#market" className="brand" aria-label="Candles home"><span className="brand-icon" aria-hidden="true"><i/><i/><i/></span>Candles<span className="brand-dot">.</span></a><nav aria-label="Main"><a href="#market" aria-current="page">Market</a><a href="#about">About the hook</a></nav><div className="wallet-bar"><span className="network-tag"><span aria-hidden="true">◌</span> {c.d.network.name}</span><button className="wallet-button" disabled={!!busy} onClick={connect}>{account ? shortAddress(account) : 'Connect wallet'} <span aria-hidden="true">↗</span></button></div></header>
    <main id="market">
      <div className="page-intro"><div><p className="eyebrow">The onchain market record</p><h1>A little more clarity.<br/><span>One candle at a time.</span></h1></div><p>Five-minute candles, written by the pool.<br/>Explore and trade Candles on Sepolia.</p></div>
      <div className="market-heading"><div className="pair-title"><span className="token-icon" aria-hidden="true">C</span><div><h2>CNDL <span>/ ETH</span></h2><p>Candles <span>·</span> Uniswap v4</p></div></div><div className="market-status"><span className={`status-dot ${verified && !stale ? 'online' : ''}`}/><span>{loading ? 'Reading chain…' : verified && !stale ? 'Live pool' : market ? 'Data is stale' : 'Awaiting RPC'}</span><button className="small-button" disabled={loading || !!busy} onClick={() => void refresh()}>Refresh <span aria-hidden="true">↻</span></button></div></div>
      {readError && <div className="notice error" role="alert">{readError}</div>}
      {account && !rightChain && <div className="notice network-notice"><div><strong>Switch to {c.d.network.name}</strong><p>Your wallet is on another network. Trading is disabled.</p></div><button disabled={!!busy} onClick={() => void run('Switching…', async () => {if (!window.ethereum) return; await switchChain(c, window.ethereum); setChain(Number(BigInt(await window.ethereum.request({method:'eth_chainId'})))); invalidate(); setStatus('Network switched. Refreshing pool data.')})}>Switch to {c.d.network.name}</button></div>}
      <div className="market-grid"><section className="chart-panel" aria-labelledby="chart-title">
        <div className="stats"><div className="price-stat"><p id="chart-title">Pool price <span className="small">CNDL per ETH</span></p><strong>{market ? number(market.price, 2) : '—'}</strong><span className="small muted">{market ? `1 CNDL ≈ ${number(1 / market.price, 9)} ETH` : 'Read directly from StateView'}</span></div><div><p>24h volume</p><strong>{volume !== undefined ? `${saturated ? '≥ ' : ''}${units(volume, 18, 4)}` : '—'} <small>ETH</small></strong></div><div><p>24h swaps</p><strong>{swaps !== undefined ? `${saturated ? '≥ ' : ''}${swaps}` : '—'}</strong></div></div>
        <div className="chart-toolbar"><div><span className="selected-pill">24 hours</span><span className="muted small">5-minute candles</span></div><span className="chart-legend"><i className="up-key"/> Up <i className="down-key"/> Down <i className="flat-key"/> Flat gap</span></div>
        <Chart market={market}/>
        <p className="chart-note"><span aria-hidden="true">ⓘ</span> Anyone can paint these candles with swaps. This is a display record, never an oracle or a source for quotes.</p>
      </section>
      <aside className="trade-panel" aria-labelledby="trade-title"><div className="section-heading"><h2 id="trade-title">Trade Candles</h2><span className="testnet-badge">Testnet</span></div><div className="segmented" role="group" aria-label="Trade direction"><button aria-pressed={buy} disabled={!!busy} onClick={() => {setBuy(true); setAmount(''); invalidate()}}>Buy CNDL</button><button aria-pressed={!buy} disabled={!!busy} onClick={() => {setBuy(false); setAmount(''); invalidate()}}>Sell CNDL</button></div>
        <form onSubmit={e => {e.preventDefault(); void getQuote()}} noValidate>
          <div className="amount-box"><label htmlFor="amount">You pay</label><div className="amount-row"><input ref={amountInput} id="amount" name="amount" inputMode="decimal" autoComplete="off" placeholder="0.00" value={amount} disabled={!!busy} aria-invalid={fieldError === 'amount'} aria-describedby="trade-error balance" onChange={e => {setAmount(e.target.value); invalidate()}}/><span>{inputSymbol}</span></div><p id="balance">Balance: {account && market && rightChain ? `${units(buy ? market.nativeBalance : market.tokenBalance, inputDecimals)} ${inputSymbol}` : 'Connect to view'}</p></div>
          <div className="direction-arrow" aria-hidden="true">↓</div>
          <div className="output-box"><span>Estimated receive</span><div><strong>{validQuote ? units(quote!.out, outputDecimals, 6) : '—'}</strong><b>{outputSymbol}</b></div><p>Quoted by Uniswap · actual output may differ</p></div>
          <div className="tolerance"><label htmlFor="slippage">Price tolerance</label><div><input ref={slippageInput} id="slippage" name="slippage" inputMode="decimal" value={slippage} disabled={!!busy} aria-invalid={fieldError === 'slippage'} aria-describedby="tolerance-help trade-error" onChange={e => {setSlippage(e.target.value); invalidate()}}/><span>%</span></div></div>
          <p id="tolerance-help" className="small muted">Limits movement from the current pool price. Partial fills are possible; unused input is returned or stays in your wallet.</p>
          <div className="trade-facts"><span>Pool fee <b>{number((market?.lpFee ?? c.d.app.pool.fee)/10000,2)}%</b></span><span>Network <b>{c.d.network.name}</b></span></div>
          <button className={`quote-button ${validQuote ? '' : 'primary'}`} type="submit" disabled={!ready || !!busy}>{busy === 'Quoting…' ? busy : 'Get quote'}</button>
        </form>
        {!account && <p className="trade-hint">Connect your wallet to view balances and trade.</p>}
        {account && rightChain && !ready && <p className="trade-hint">Trading unlocks after live chain and contract checks pass.</p>}
        {validQuote && <div className="quote-actions"><p className="small muted">Quote expires in {Math.max(0, Math.ceil((60000 - (now - quote!.created))/1000))}s.</p>{needsApproval ? <><p>Allow PoolSwapTest to spend exactly {units(quote!.amount, inputDecimals)} CNDL. This is a separate transaction.</p><button className="primary" disabled={!!busy} onClick={() => void approve()}>Approve {units(quote!.amount, inputDecimals)} CNDL</button></> : validPreview ? <div className="preview-box"><h3>Review swap</h3><p>Simulated spend: <b>{units(preview!.spent, inputDecimals, 8)} {inputSymbol}</b><br/>Simulated receive: <b>{units(preview!.received, outputDecimals, 8)} {outputSymbol}</b></p>{preview!.spent < quote!.amount && <p><strong>Partial fill:</strong> {units(quote!.amount - preview!.spent, inputDecimals, 8)} {inputSymbol} stays unspent.</p>}<p className="small">PoolSwapTest has no guaranteed minimum output or onchain deadline. Your price limit still applies. Confirm promptly or reject a delayed wallet request.</p><button className="primary" disabled={!!busy} onClick={() => void confirmSwap()}>Confirm {buy ? 'buy' : 'sell'}</button></div> : <button className="primary" disabled={!!busy} onClick={() => void simulateSwap()}>Preview swap</button>}</div>}
        {quote && !validQuote && <p className="trade-hint">Quote expired or prerequisites changed. Get a fresh quote.</p>}
        <div id="trade-error" className="action-error" role="alert">{actionError}</div><div className="action-status" role="status">{busy || status}</div>{tx && <a className="transaction-link" href={`${c.d.network.explorer}/tx/${tx}`} target="_blank" rel="noreferrer">View transaction {shortAddress(tx)} ↗</a>}
        <p className="router-note">Via <a href={`${c.d.network.explorer}/address/${c.d.app.router.address}`} target="_blank" rel="noreferrer">PoolSwapTest ↗</a> · Sepolia assets only</p>
      </aside></div>
      <div className="lower-grid"><section className="activity" aria-labelledby="activity-title"><div className="section-heading"><div><p className="eyebrow">Written onchain</p><h2 id="activity-title">Recent activity</h2></div><span className="subtle-label">Candle events</span></div>{eventError ? <p className="notice">{eventError}</p> : events?.logs.length ? <div className="event-list">{events.logs.map((log, i) => {const args = log.args as {bucket?: bigint; swaps?: bigint; close?: number; volumeEth?: bigint}; return <a key={`${log.transactionHash}-${log.logIndex}-${i}`} className="event-row" href={`${c.d.network.explorer}/tx/${log.transactionHash}`} target="_blank" rel="noreferrer"><span className="event-icon" aria-hidden="true">↗</span><div><strong>Candle updated</strong><span>{new Date(Number(args.bucket ?? 0n)*300000).toLocaleString('en-GB', {timeZone:'UTC'})} UTC</span></div><div><strong>{args.swaps?.toString()} bucket swaps</strong><span>{units(args.volumeEth ?? 0n, 18)} ETH cumulative ↗</span></div></a>})}</div> : <div className="activity-empty"><span aria-hidden="true">⌁</span><div><strong>{events ? 'No recent candle events' : 'Waiting for activity'}</strong><p>{events ? 'A pool swap writes the next record. Earlier candles can still appear above.' : 'Recent hook events will appear after the RPC responds.'}</p></div></div>}<p className="small muted">{events ? `Blocks ${events.fromBlock}–${events.toBlock}. ` : 'Scans up to 2,000 recent blocks. '}Events contain cumulative bucket totals and are never added together.</p></section>
      <section id="about" className="about-hook"><p className="eyebrow">A small, transparent hook</p><h2>The market leaves a record.</h2><p>Every swap writes a five-minute candle: open, high, low, close, volume and swap count. Quiet intervals stay flat at the previous close.</p><div className="hook-features"><span><b>5 min</b> per candle</span><span><b>24 hours</b> of history</span><span><b>No admin</b> or hook fee</span></div><details><summary>Pool & deployment details</summary><dl className="details-list"><div><dt>Pool ID</dt><dd className="mono wrap">{market?.id ?? 'Awaiting pool reads'}</dd></div><div><dt>Current tick / hook last tick</dt><dd>{market ? `${market.tick} / ${market.lastTick}` : '—'}</dd></div><div><dt>Latest recorded bucket</dt><dd>{market?.latestBucket.toString() ?? '—'}</dd></div><div><dt>Active liquidity (raw)</dt><dd>{market?.liquidity.toString() ?? '—'}</dd></div><div><dt>Total supply</dt><dd>{market ? `${units(market.supply,market.decimals,0)} CNDL` : '—'}</dd></div><div><dt>Read at block</dt><dd>{market?.block.toString() ?? '—'}</dd></div><div><dt>Source commit</dt><dd className="mono wrap">{c.d.sourceCommit}</dd></div><div><dt>Contract checks</dt><dd>{verified ? 'Chain ID, code, ABIs and manager links verified' : 'Awaiting live verification'}</dd></div></dl><div className="contract-links">{c.d.contracts.map(x => <div key={x.name}>{addressLink(x.name,x.address)}</div>)}{addressLink('StateView',c.d.network.uniswapV4.stateView)}{addressLink('Quoter',c.d.network.uniswapV4.quoter)}{addressLink('PoolManager',c.d.network.uniswapV4.poolManager)}{addressLink('PoolSwapTest',c.d.app.router.address)}<a href="./imd-deployment.json">Deployment manifest ↗</a></div></details></section></div>
      <details className="wallet-tools"><summary>Wallet tools <span>Send CNDL or revoke a router approval</span></summary><div className="wallet-tools-content"><form onSubmit={e => {e.preventDefault(); void run('Sending…', async () => {if (!isAddress(recipient) || /^0x0{40}$/i.test(recipient)) throw Error('Enter a valid, nonzero Ethereum recipient address.'); const value = amountValue(sendAmount,market!.decimals); if (value > market!.tokenBalance) throw Error('Amount exceeds your CNDL balance.'); await send({address:c.token.address,abi:c.abis[c.token.name],functionName:'transfer',args:[recipient,value]},'CNDL transfer confirmed.'); setSendAmount('')})}}><h3>Send CNDL</h3><label htmlFor="recipient">Recipient address</label><input id="recipient" autoComplete="off" placeholder="0x…" value={recipient} disabled={!!busy} onChange={e => setRecipient(e.target.value)}/><label htmlFor="send-amount">Amount in CNDL</label><input id="send-amount" inputMode="decimal" placeholder="0.00" value={sendAmount} disabled={!!busy} onChange={e => setSendAmount(e.target.value)}/><p className="small muted">Check the recipient carefully. Your wallet will ask you to confirm the transfer.</p><button disabled={!ready || !!busy}>Send CNDL</button></form><div><h3>Router allowance</h3><p>{market && account && rightChain ? `${formatUnits(market.allowance,market.decimals)} CNDL` : 'Connect to view your allowance.'}</p><p className="small muted">Revoking removes PoolSwapTest’s permission to spend your CNDL. It requires a transaction.</p><button disabled={!ready || !!busy || !market?.allowance} onClick={() => void approve(true)}>Revoke approval</button></div></div></details>
    </main><footer><a href="#market" className="brand">Candles.</a><p>An onchain experiment. A clearer view.</p><span>{c.d.network.name} testnet · {c.d.chainId}</span></footer>
  </>
}
