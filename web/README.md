# Candles frontend

One static React/TypeScript page for the deployed CNDL / native ETH Uniswap v4 pool on Sepolia. The deployer’s Solidity source is unchanged. `dist/` is the publishable export; publication and contract deployment are outside this assignment.

## Install, build, preview

Use Node 22.12+ and npm. From the repository root:

```sh
npm ci --prefix web
npm run --prefix web typecheck
npm run --prefix web test
npm run --prefix web build
npm run --prefix web check:export
npm run --prefix web preview
```

`npm run --prefix web dev` rebuilds and previews the production export. Edit source and rebuild to update it. Vite uses `base: './'`; no backend, rewrite rule, external font service, or private credential is required. Serve all of `dist/`, including its manifest and ABI directory. Hash navigation supports gateway subpaths. Do not edit an exported file by hand: rebuild the manifest with the export.

## Configuration and provenance

The browser fetches `./imd-deployment.json` as its sole deployment configuration, then loads its referenced ABI JSON. No bundled address/chain/ABI map overrides it. It checks canonical Keccak hashes for both implementation ABIs and SHA-256 for protocol interfaces before opening the app.

Build inputs are `web/config/handoff.json` and `web/config/network.json`, preserved copies of the supplied handoff. `scripts/export.mjs` reads each ABI from `docs/abi/<Contract>.json` at the attested `sourceCommit` using `git show`, checks the current export against the pinned bytes, verifies canonical Keccak, copies the raw JSON arrays, and inventories all final files except the manifest. Keep that Git commit available when rebuilding. The provided `network` object is copied unchanged, including its original JSON text. Wallet chain-add parameters are preserved under `app.walletAddChain`.

The manifest’s `app` extension also carries pool parameters, token metadata, deployment block, protocol ABI paths, and the assignment-specific router. `web/config/interfaces.mjs` generates the minimal StateView, Quoter and PoolSwapTest interfaces from their implementation signatures. Implementation ABIs always come from the pinned source exports.

**Conflicting router requirements:** the specific website requirement requests PoolSwapTest, while the generic acceptance rule says every spender/router must come from `network.uniswapV4`, which omits PoolSwapTest. This implementation follows the specific PoolSwapTest requirement. Its published address is centralized in `web/config/router.json`, emitted under `app.router`, and its code and immutable manager are checked before trading. The supplied network block is not extended or rewritten. Quotes and pool reads use the supplied network’s Quoter and StateView; sell approvals go directly to PoolSwapTest. This is a documented exception to the generic address-table-only acceptance sentence. The Universal Router and Permit2 flow is not used.

Router reference: [Uniswap’s official deployment list](https://developers.uniswap.org/deployments). Router signature/settlement reference: pinned `lib/v4-core/src/test/PoolSwapTest.sol`. Quoter interface: [Uniswap IV4Quoter](https://github.com/Uniswap/v4-periphery/blob/main/src/interfaces/IV4Quoter.sol). No runtime address lookup occurs.

## Reads and trading

- Public reads use configured RPCs in order, with an injected wallet transport fallback only when that wallet reports the configured chain. Signing stays with the visitor’s wallet. Browser wallets exposing `window.ethereum` are supported; no WalletConnect project ID was supplied.
- On connection, balances and allowances are refreshed. Unknown-chain switching uses `wallet_switchEthereumChain`, then exact `wallet_addEthereumChain` parameters on error 4902/unknown-chain, then another switch. Account and chain events invalidate quotes.
- Each refresh verifies chain ID, nonempty code for deployed contracts and used Uniswap contracts, and the hook/router PoolManager link. Reads share one block number. Failed verification or data older than 90 seconds disables actions. PoolManager callback functions have no public action controls: they are not visitor actions. The hook has no administrative actions.
- The price comes from StateView’s `sqrtPriceX96`, with token decimals read onchain. Quotes use `simulateContract` on the network’s Quoter. Candle ticks never determine transaction prices.
- Enter an exact-input amount, get a quote, approve CNDL separately if selling, get a fresh quote, preview the simulated swap, then confirm. Native ETH buys require no approval. ERC-20 approvals are limited to the entered amount. Wallet tools provide CNDL transfer and allowance revocation; `transferFrom` is exercised by the router’s settlement rather than exposed as a separate delegated-spending form.
- Price tolerance is 0.1–5%, applied as a marginal pool-price movement bound to `sqrtPriceLimitX96` using bigint square roots. **This is not a guaranteed minimum output. PoolSwapTest permits partial fills and exposes neither a minimum-output nor deadline argument.** Preview shows simulated spend/output and unused input. Changes to simulated amounts require another review. Quote expiry is local (60 seconds); it cannot revoke an already-open wallet request or a submitted transaction. Confirm promptly or reject a delayed request.
- All transactions are simulated before a wallet request, use the configured chain, and display submission/receipt/revert/rejection states and an explorer link. A swap is re-simulated against the reviewed parameters immediately before signing. Public chain state can still change before inclusion.

## Candles and events

The page calls `getCandles(poolId, currentBucket - 287, 288)`. Missing buckets are identified by `swaps == 0`, not zero-valued ticks. Leading gaps use the first recorded candle’s open; an entirely empty window uses the hook’s `lastTick`. Intermediate/trailing gaps carry the previous close and zero volume. There is one SVG volume bar per bucket. The range input supports keyboard inspection and the expandable table exposes all values. Saturated uint128 counters use a ≥ indicator.

Recent events scan up to 2,000 blocks in 500-block chunks. Each 30-second refresh replaces that bounded window to tolerate reorganizations. Event rows show cumulative bucket values; they are never summed. Event errors are separate from candle/price errors. This is a bounded recent-activity view, not a complete historical indexer. Readers must not treat any candle as an oracle: anyone can paint them with swaps, including zero-volume swaps.

## Validation and limitations

```sh
npm run --prefix web test:browser
npm run --prefix web check:chain
cd web && npx tsx scripts/read-live.ts
npx tsx tests/live-browser.ts
```

The browser suite uses installed Playwright Chromium (install with `npx playwright install chromium` in `web/` if needed) and mocked EIP-1193/RPC responses. It serves the exact production bytes at a `/preview/` URL through Playwright request fulfillment because this worker denies browser loopback HTTP. This exercises real browser JavaScript and relative requests without a real wallet or funds. It writes screenshots and JSON evidence to `docs/evidence/`. No test fixture or mock RPC is included in `dist/`.

See [validation and six-domain review](../docs/frontend/VALIDATION.md), [implemented design](../docs/DESIGN.md), and [evidence](../docs/evidence/). The root `DESIGN.md` requested by one criterion conflicts with the higher-priority allowed paths; the design document is delivered at `docs/DESIGN.md`.

No real wallet transaction is broadcast by these checks. Publication, IPFS naming and immutable/named hosting checks remain the publisher’s responsibility. Local worker checks are evidence, not independent certification.

## Size and dependency hygiene

Only `web/.gitignore` is changed/created as an ignore file, using the assignment’s explicit path allowance. Its recursive rules exclude nested dependencies, caches, test outputs and package archives. No vendored registry, submodule or dependency directory belongs in the submission. The exported app bundles its runtime assets locally. `scripts/export.mjs` enforces the 128-file and 8 MiB per-file manifest limits plus a stricter 7 MiB export ceiling; the whole Git submission must still fit 8 MiB.

## Worker handoff status

Source, lockfile, static export and evidence are present. This workspace mounts `.git` read-only: the requested `git add`/commit step failed at `.git/index.lock`. No commit could be created here. The publisher/collector must commit these files; see the validation record.
