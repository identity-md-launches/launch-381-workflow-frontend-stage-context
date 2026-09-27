# Frontend validation and Better Interface review

Worker validation on 2026-09-27. This is the worker’s own evidence, not independent certification or a publication check.

## Scope and consequential assumptions

Implemented one Vite/React/TypeScript page with source/configuration/lockfile under `web/`, export under `dist/`, and documentation/evidence under `docs/`. The deployed Solidity source and protected root configuration are unchanged. Runtime deployment identity comes only from `dist/imd-deployment.json` and its referenced ABIs. Public RPC reads, injected-wallet connection, chain addition/switching, exact-input buy/sell, explicit sell approval, simulation review, transaction status, transfer and approval revocation are included.

Two supplied requirements cannot both be followed literally:

1. Root `DESIGN.md` is forbidden by the overriding path budget. The implemented design is delivered as `docs/DESIGN.md`.
2. The website explicitly requires PoolSwapTest, but the generic rule restricts every router/spender to a network table that omits it. The specific PoolSwapTest requirement takes precedence in this implementation. Its address is obtained from [Uniswap’s published deployment list](https://developers.uniswap.org/deployments), centralized in `web/config/router.json`, emitted in the runtime manifest’s `app.router`, and verified onchain. The network block remains unchanged. Quoter/StateView/PoolManager use the supplied network addresses. This does not satisfy a literal “every router is in the original network table” check; it is documented, not silently substituted with Universal Router.

No contracts were deployed, no real wallet transactions were sent, and no site was published. No owner/admin/hook callback controls are invented. The ERC-20’s normal `transfer`/`approve` actions have controls; delegated `transferFrom` is part of router settlement.

## Commands and results

| Check | Result / evidence |
| --- | --- |
| `npm install --prefix web …` | Frontend dependencies installed; resulting lockfile delivered with source; npm reported zero known vulnerabilities at installation. No dependency/cache directories included. |
| `npm run --prefix web build` | Passed after final application corrections; typechecks, creates relative Vite export, then generates manifest. |
| `npm run --prefix web typecheck` | Passed, including source, build config, tests and TypeScript validation scripts. |
| `npm run --prefix web test` | 12/12 tests passed: gap reconstruction, valid zero/signed/extreme ticks, saturated bigint counters, strict amount bounds, price bounds, signed deltas, pool encoding, both ABI hashes, asset paths, chain-add fallback and rejected switch. |
| `npm run --prefix web test:browser` | 21/21 checks passed on final export using Chromium 153.0.8010.12. Exact assertions and screenshots: `docs/evidence/browser-results.json`. |
| `npm run --prefix web check:export` | Passed; all exported files accounted for, both pinned implementation ABIs match handoff Keccak hashes, full manifest matches build inputs. |
| `npm run --prefix web check:chain` | All three supplied RPCs returned chain ID 11155111 and nonempty code for both deployed contracts, all six network-table contracts and PoolSwapTest. `docs/evidence/live-chain.json`. |
| `cd web && npx tsx scripts/read-live.ts` | Passed: router/hook manager bindings, StateView slot/liquidity, token metadata/supply, 288 hook buckets, event range and a buy quote via `eth_call`. `docs/evidence/live-reads.json`. |
| `cd web && npx tsx tests/live-browser.ts` | Passed: final export in Chromium with 19 live RPC read requests relayed unchanged by Node, zero browser errors, desktop/mobile screenshots showing the real flat window. `docs/evidence/live-browser.json`. |

The final export contains 11 inventory assets (including `index.html` and five ABI JSON files), approximately 0.61 MiB before the manifest. Every inventory hash is SHA-256 of final bytes; the manifest excludes itself. All files are far below 8 MiB and the export is far below the checker’s response budget. The final size/path audit is in `docs/evidence/submission-audit.json`.

Initial direct Python HTTP probes returned 403; the application’s Node/viem transport later passed all listed live checks. Those initial failures are not reported as the final RPC result.

## Browser and interaction coverage

The worker denied loopback browser navigation (`ERR_ACCESS_DENIED` and browser-tool timeout), and no managed `test/scratch/browser/preview.json` was supplied. The browser suite therefore fulfills requests with the **exact final export bytes** under `https://candles.test/preview/`. This is real Chromium execution of built JavaScript, with real relative resource resolution; there is no source-only substitute or fake screenshot. RPC/wallet responses in the interaction suite are explicitly mocked. This does not establish actual production HTTP headers, gateway behavior or native-wallet compatibility. A separate live-browser check relays real configured-RPC responses rather than fixtures; its responses advertised `Access-Control-Allow-Origin: *`, but direct browser CORS and production hosting remain untested.

Checks include disconnected reads, absent wallets, wrong chain, exact add-chain fallback, connected balances, all 288 candles/volume bars, keyboard candle selection, the data table, invalid-field focus, native buy calldata/value, token sell approval spender/amount, zero-native-value sell, partial fills, changed input, reverted simulation, rejected signing, account changes, quote expiry, transfer, revocation, missing code, RPC recovery, separate event errors and tampered ABI rejection. Quotes and previews caused no wallet transaction; mocked sends were checked only after explicit confirmation.

Screenshots examined include final desktop buy review, 320px mobile reflow, visible amount-field focus, and the real live flat-window state at 1440px and 390px. The suite also saves 1440px desktop, 390px mobile and RPC-error captures. No console page errors or failed exported-resource responses were recorded. Source files and mocks are not shipped to `dist/`.

## Six-domain coverage

| Domain | Coverage | Evidence / limits |
| --- | --- | --- |
| Accessibility | Checked | Native links/buttons/forms/details, labels, skip link, one main/H1, status/alert regions, grouped pressed-state trade buttons, disabled prerequisites, keyboard range/table access, visible 3px focus and reduced motion. Axe reports zero WCAG 2/2.1 A/AA violations in the populated connected state. Screen-reader speech, full keyboard-only wallet flow, physical-device use and browser-native zoom were not performed. |
| Layout | Checked | Chart/trade hierarchy, shared edges, stacked mobile order, disclosures and table-local scrolling. Measured document widths equal 1440/940/750/390/320 viewports; no document overflow. 200% root-text enlargement also passed. RTL and localization are not supported variants and were not tested. |
| Writing | Checked | Buy/sell/approve/preview/confirm labels match their actions; units, network and balances are explicit; no-oracle warning, partial fills and router limitations are explained. Missing-wallet/RPC/rejection/expired states offer recovery. |
| Typography | Checked | Local variable font loaded at all sampled widths; heading hierarchy, regular-or-heavier small text, tabular market numbers, wrapping IDs, at-least-16px inputs. SVG axes are intentionally dense at mobile widths; range readout and table provide readable exact values. |
| Colors | Checked | Semantic role tokens, non-color state text, actual foreground/background sampling and axe. Five measured text pairs range from 5.09:1 to 14.71:1. SVG/decorative-glyph contrast is flagged for manual review by axe; axes use the measured muted/white pair, glyphs repeat nearby text, and the table exposes chart values. This is not a claim of exhaustive accessibility compliance. |
| UI | Checked | Hover/focus/pressed/disabled/loading/empty/error/quote/preview/receipt states; restrained surfaces and motion; correct segment radii. Reduced-motion removes transitions. Slow-motion animation-panel inspection was not performed. Modals, dark theme, localization, drag interactions and theme switching are not implemented and are not applicable. |

## Findings, corrections and rechecks

| Severity | Source | Finding and correction | Recheck |
| --- | --- | --- | --- |
| Medium | `web/src/styles.css:5`, `:95` | Axe measured inactive Sell label `#687264` on `#eeefe8` at 4.34:1. Darkened the shared muted-text primitive to `#616b5e`. | Final axe contrast check passes; rendered pair measurements saved. |
| Medium | `web/src/App.tsx:168` | Trade-direction container had an accessible label without an explicit grouping role, producing an axe manual-review item. Added `role="group"`. | Final scan no longer flags that container. |
| Low | `web/src/Chart.tsx:22` | Desktop inspection showed two adjacent price-axis labels rounding to “1M”. Increased compact-format precision to two fractional digits. | Final buy screenshot distinguishes 1.04M and 1.02M. |
| Medium | `web/src/App.tsx:176` | Get quote retained primary fill when approval/preview/confirmation was available, competing with the next action. It now becomes neutral while a quote is valid. | Final buy-review screenshot has one filled confirmation action. |
| Build | `web/src/main.tsx`, `web/src/styles.css:1` | Initial font package subpath was not exported. Replaced it with an explicit Latin-only WOFF2 face. | Production build resolves it; font availability verified in all five viewport checks. |

Harness corrections (wallet init serialization and a URL-normalization issue) are test infrastructure fixes; they do not count as product findings. Successful final artifacts replace stale debug screenshots/reports.

## Live-chain observations and limits

At the recorded read, StateView reported tick 177284 and 50,000,000 CNDL/ETH. The hook returned lastTick 177284, latestBucket 0, and 288 empty buckets; the bounded event scan was empty. Thus the live 24h chart should draw a flat line using lastTick, not fabricated activity. The initial-price handoff is not used as a live-price substitute. The quoter returned a nonzero result for a 0.0001 ETH input despite zero active liquidity at the current tick; liquidity may sit in another range. No claim about executable size or final settlement is inferred from that quote.

Untested real-chain behavior: live wallet signing, balances for a funded visitor, approval settlement, actual buys/sells/transfers/revocations, mining/reorg/replacement behavior, and cross-wallet compatibility. Simulation is not a promise of inclusion. PoolSwapTest’s lack of minimum-output/deadline controls and possible partial fills are stated in the UI and README. Local expiry cannot cancel an already pending wallet prompt or transaction.

Overall: implementation, static export and local build/typecheck/browser/interaction work are complete; **Git commit completion is blocked**. `git add -- web dist docs` failed with `Unable to create .git/index.lock: Read-only file system`. The workspace mounts `.git` read-only, so no commit was created and no bypass was attempted. All deliverable files remain ready for the publisher/collector. The requested committed-submission step is therefore incomplete in this worker. The two assignment conflicts above remain explicit exceptions. Publication checks, fixed-CID/named hosting, and real funded transactions are not worker-verified.

## Design attribution

The six-domain review used the supplied Better Interface guide (Jakub Krehel, MIT, pinned commit `267330e1adfc66a718fb65fa6918c1f06d0a689e`). The design documentation follows the supplied Impeccable method (Paul Bakaus, Apache-2.0, pinned commit `9d715cc4f5564a990ca8345abfdd5df6dc9b41c8`). Source links and the implemented token/component reference are in `docs/DESIGN.md`.
