# Local validation and independent-review handoff

Recorded with Forge 1.8.3 and Solidity 0.8.26, optimizer 200, Cancun, metadata bytecode hash disabled.

| Check | Result |
| --- | --- |
| Authored Foundry suite | 33 passed, 0 failed, 0 skipped |
| Fuzzing | 256 cases each for token transfers, all swap modes/sizes, signed deltas, and 16-swap candle sequences |
| Supplied protected checks | 9 passed, 0 failed, 0 skipped |
| Minimal environment / four workers | Same 33 tests passed; only PATH and HOME supplied |
| Storage writes inside an existing bucket | Two hook slots, observed during an actual manager swap |
| Fresh first-candle callback, cold | 85,553 gas |
| Existing-bucket callback, cold | 24,542 gas |
| Rollover callback, cold | 68,415 gas |

The protected checks were copied unchanged into `test/scratch/univ4_hook/` for the run. Their required environment inputs were supplied only to the child forge process: compiled CNDL creation code, compiled hook creation code with the sole Sepolia PoolManager constructor argument appended, flags 4160, and decimals 18. The temporary Solidity copies were removed afterward; their protected definitions are not part of this deliverable. The protected hook's relocated manager is used only for its static/access checks, as its own comments require. All authored pool lifecycle tests use a real manager at its original deployment address.

The gas meter wraps the hook call in another contract to measure nested callback execution; a top-level test call under Foundry transaction isolation would also include intrinsic transaction gas. Tests explicitly cool relevant storage and accounts. Figures include CALL overhead and a cold manager state read, whereas that read normally accesses a warm slot after a real swap. These measurements exercise fresh storage separately, and each has an asserted budget. Total swap/router gas is separate. Arithmetic or storage exhaustion must not be handled by reverting the observer: saturating counters and fixed work per callback keep those paths bounded. Insufficient transaction gas still causes ordinary EVM out-of-gas failure; callers must fund the entire transaction's execution.

## Review targets and reproducible sequences

This is the implementation author's test record, **not an independent adversarial review**. The independent assignment should inspect the final source and generated manifest and report each finding with its exact trigger sequence. Relevant sequences are already executable:

| Area | Sequence / test |
| --- | --- |
| Factory compatibility and initial open | Deploy token to the test factory; deploy a mined hook; initialize at the documented sqrt price; add a below-price currency1-only position; assert manager ETH balance zero; buy 1 ETH; sell half the output (`LaunchRehearsalTest`). Confirm the final manifest's actual numerical parameters separately. |
| Price changes outside swaps | Initialize; add liquidity; buy; add/remove another position and donate; compare pool slot0 and stored candles (`test_liquidityAddsAndRemovalDoNotChangeCandlesOrPrice`, `test_donationChangesNeitherPriceNorCandles`). Inspect v4's initialize-once and hook self-call behavior. |
| Empty liquidity / extreme price | Initialize four pools near minimum, maximum and signed interior ticks, with no liquidity; make accepted swaps across empty ranges; verify opens, closes and zero volumes (`test_realSwapsAtNegativeAndExtremeTicksWithNoLiquidity`). |
| Signed packing and absolute values | Exercise real negative ticks; invoke manager-authenticated arithmetic tests over all int128 deltas, including minimum int128; verify no truncation/wrapping of magnitudes (`testFuzz_fullSignedDeltaDomainNeverReverts`, `test_minInt128AndVolumeSaturation`). |
| Counter exhaustion | Drive volumes to saturation; inject max swap count into its packed field; execute a real buy/sell; verify open survives and count stays nonzero; roll over into a new bucket (`test_swapCountSaturationDoesNotResetOpen`). Storage injection is confined to this otherwise unreachable arithmetic boundary test. |
| Continuity and bucket math | Swap at 3299, again at 3300, then after a large gap; verify each new open equals the prior close. Separately exercise bucket zero and uint256-max timestamp. Fuzz 16 swaps with changing directions, sizes and gaps. |
| View bounds | Request counts 0, 1, 289 and uint256.max; include absent buckets and fromBucket values uint256.max / max-1. Confirm no wrapping and at most 288 entries. |
| Pool isolation | Swap in two native pools and an ERC20/ERC20 pool; assert separate candles and no hook writes/events for the latter. |
| Transaction rollback | Swap without enough native settlement value, then swap without token allowance after an earlier successful swap; verify reverted transactions preserve price and candle state (`SettlementTest`). |
| Authority and permissions | Call all ten callbacks as a non-manager; deploy using a wrong salt; compare all 14 permission fields and all 14 address bits; scan runtime excluding PUSH data for forbidden escape-hatch opcodes. |
| Funds and deltas | Exercise all four swap modes; compare absolute deltas to volumes; assert zero transient debt, zero hook holdings and zero claims; remove liquidity and check conservation. |

The implementation has no router-dependent identity logic and ignores arbitrary hookData. Inputs to candles are deliberately manipulable. Source attestation, signed artifact linkage, publication, admission and deployment are service steps after this contribution. No RPC fork rehearsal, deployed-address assertion, final manifest approval, or independent review is represented by the local results.
