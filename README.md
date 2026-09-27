# Candles / CNDL

Sepolia contract contribution for `lab-candles-hook`: a fixed-supply ERC-20 and a passive Uniswap v4 hook that records five-minute OHLC tick candles. **Anyone can paint these candles with swaps. They are a display record, not an oracle, and nothing may price off them.** Empty-liquidity swaps can also move the tick and create zero-volume candles.

`CNDL` has a zero-argument constructor, name `Candles`, symbol `CNDL`, 18 decimals, and exactly `1_000_000_000 * 10**18` units minted once to `msg.sender`. There is no external mint, burn, owner, admin, pause, or upgrade interface. Transfers use the vendored OpenZeppelin ERC-20 implementation without a transfer fee.

`OHLCCandleHook` takes exactly one constructor argument, `IPoolManager`. The Sepolia launch argument is `0xE03A1074c86CFeDd5C142C4F04F1a1536e203543`. The constructor validates that its address enables exactly `afterInitialize` and `afterSwap` (`address & 0x3fff == 0x1040`). Every callback authenticates the PoolManager; disabled callbacks revert if called directly. Initialization and liquidity operations have no extra gate. No hook return-delta permissions are enabled; `afterSwap` always returns its selector and zero. The hook does not settle, take, mint claims, transfer funds, or charge a fee. It has no administrative or recovery interface.

## Candle semantics

State is isolated by `PoolId`, the hash of the complete pool key. Only pools with native ETH as currency0 are recorded; a non-native currency0 makes both enabled callbacks return immediately without reads of pool state, writes, events, or adjustments. The token address is learned from the pool key, so the hook imposes no token allowlist or constructor token argument. All native-ETH pools using it can record candles.

After initialization, `lastTick(poolId)` is the initial tick. On a swap the hook reads the post-swap tick using the pinned v4-core `StateLibrary.getSlot0`. For `bucket = block.timestamp / 300`:

- The first swap opens at `lastTick`, including across any number of empty buckets.
- High and low include the open and every post-swap tick; close is the most recent post-swap tick.
- ETH volume adds `abs(delta.amount0())`; token volume adds `abs(delta.amount1())`, in raw base units and using executed deltas, including the LP fee in the input delta.
- Swaps increases by one, including accepted zero-volume swaps. `lastTick` becomes the close and a `Candle` event emits the cumulative bucket state.

Ticks are signed `int24`; the display price is approximately `1.0001**tick` CNDL per ETH for the launch's two 18-decimal currencies. A tick is a quantized price; use StateView's sqrt price for the precise pool price. Liquidity modification, fee collection and donation do not change the pool price. Reinitializing an initialized pool is rejected by the manager. The hook never initiates swaps, so v4's self-hook callback exemption cannot bypass recording.

Candles use two storage slots. `lastTick` derives the latest close instead of duplicating it in another slot. A swap in an existing bucket writes just those two slots; a new bucket also updates `latestBucket`. `afterInitialize` stores the initial tick separately. Production timestamps are assumed to be nondecreasing, as on Sepolia; the implementation does not narrow timestamps or bucket numbers.

Volumes and swap counts are saturating `uint128` values: at `2**128 - 1`, the field remains capped. This explicit exceptional-case policy prevents packed-counter overflow from blocking pool swaps or wrapping a candle's nonzero count back to zero. Negation widens to `int256`, so even `int128.min` is supported. Below the cap accounting is exact; a capped value is a lower bound, and an indexer can recover full volume from PoolManager swap events. A new bucket starts fresh counters.

`getCandles(poolId, fromBucket, count)` returns consecutive buckets in ascending order, caps count at 288, and returns all-zero structs for absent buckets. At the uint256 boundary it truncates instead of wrapping. `swaps == 0` identifies an absent candle; a zero tick alone does not. Readers render gaps flat at the previous close, with zero volume. For a completely empty pool, use `lastTick`; for a window beginning with gaps, obtain its preceding close from indexed history. `latestBucket` is zero before the first candle and is also valid for timestamp bucket zero.

## Build and verification

```sh
forge build
forge test
forge fmt --check
forge test --match-contract CandleGasTest -vv
python3 tools/export_abi.py --check
```

Solidity is pinned to `0.8.26`, Cancun, optimizer 200 runs, and `bytecode_hash = "none"`. Dependencies are ordinary vendored files with pinned commits and checksums in [DEPENDENCIES.md](DEPENDENCIES.md). A verifier needs Foundry and the pinned compiler installed; it needs no dependency download. Tests use no RPC, environment reads or writes, FFI, or filesystem cheatcodes.

The suite deploys an actual v4-core PoolManager and CREATE2-mined production hook. It covers one-sided factory launch and the first buy, all four exact-in/out directions, dust, multiple swaps per bucket, exact boundaries, gaps, two pools, non-native pools, negative/extreme ticks and empty liquidity, callback authentication, constructor validation, settlement rollback, donation, unwind/conservation, full signed delta fuzzing, saturation, and repeated randomized candle sequences. The storage check observes a real swap's writes.

Cold nested callback measurements with Solidity 0.8.26 include the external CALL cost and separately check fresh buckets, existing buckets, and rollover. They exclude transaction intrinsic gas, which belongs to the swap transaction. The test requires <100,000 gas for fresh/rollover and <30,000 for an existing bucket. These are callback budgets; the pool/router transaction additionally needs its own gas. See [docs/VALIDATION.md](docs/VALIDATION.md) for recorded results and review handoff.

## Launch parameters and responsibilities

The supplied approved workflow contains **no numeric manifest price, liquidity allocation, range, or factory address**. The included rehearsal therefore makes the following explicit proposal; it does not assert that an unseen manifest has these values:

| Parameter | Value |
| --- | --- |
| Chain | Sepolia, 11155111 |
| PoolManager constructor argument | `0xE03A1074c86CFeDd5C142C4F04F1a1536e203543` |
| Currency0 / currency1 | Native ETH (`address(0)`) / newly deployed CNDL |
| Pool fee / tick spacing | 3000 / 60 |
| Hook flags | `0x1040` (4160) |
| Rehearsal initial sqrtPriceX96 | `79228162514264337593543950336000` |
| Rehearsal price | 1,000,000 CNDL per ETH |
| Rehearsal seed amount | Up to 900,000,000 CNDL, liquidity rounded down |
| Rehearsal seed ticks | -887220 through 138120 |

The range lies below the initial tick (138162), making the seed entirely currency1. The first buy crosses the initial empty interval and enters that range, while its candle opens at the initial tick. The test factory receives the whole token supply, initializes, unlocks, adds liquidity, then performs `sync(currency1) → transfer CNDL → settle()`. The standard swap router settles native ETH with value and ERC-20 with sync/transfer/settle, and takes outputs. The hook contributes no unsettled balance.

[test/support/LaunchFactory.sol](test/support/LaunchFactory.sol) models this specified sequence. The real factory's bytecode, salt transformation, distribution splits and address were not supplied; the test helper is not a production deployment contract. The manifest contributor must reconcile the numerical proposal with the final manifest and actual factory range/seed policy, and the services must rerun the rehearsal with those exact values. Both price and seed parameters are explicit function arguments to the test helper.

[script/PrepareDeployment.s.sol](script/PrepareDeployment.s.sol) exposes `creationCode(manager)` and a bounded `find(create2Deployer, manager, start, attempts)` salt search, tested through actual deployments. Mine against the exact final creation code, sole ABI-encoded manager argument, and address actually executing CREATE2. If the factory transforms salts, its effective salt must be used. A source/compiler/constructor/deployer change requires mining again. Validate the predicted address's bits and runtime against the reviewed artifacts before admission. The helper has no broadcasts or wallet configuration.

This source contribution supplies implementation, tests, ABI exports and documentation. The separate manifest assignment owns `launch.json`. An independent reviewer inspects accepted source and that manifest, including concrete constructor/policy/authorization conflicts. Publishing source, signed artifact linkage, attestation, admission, deployment and the subsequent static frontend are service responsibilities. The frontend operator uses the live pool key and deployment addresses, verifies Sepolia StateView/router code, and labels the chart as manipulable display data. No deployment or independent-review completion is claimed here.
