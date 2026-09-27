# Contract interfaces

Canonical Solidity ABI arrays are exported at [abi/CNDL.json](abi/CNDL.json) and [abi/OHLCCandleHook.json](abi/OHLCCandleHook.json). Regenerate with `python3 tools/export_abi.py`; verify without changing exports with `python3 tools/export_abi.py --check`.

`CNDL` has constructor `()`, `name()`, `symbol()`, `decimals()`, `totalSupply()`, `balanceOf(address)`, `allowance(address,address)`, `approve(address,uint256)`, `transfer(address,uint256)`, and `transferFrom(address,address,uint256)`. Transfers and approvals follow OpenZeppelin v5.1 ERC-20 semantics, including infinite allowance preservation and ERC-6093 errors. Events are `Transfer` and `Approval`.

The hook constructor is `(address manager)`; the ABI names the type `IPoolManager`. `poolManager()` returns its immutable manager. `getHookPermissions()` returns the standard 14-boolean v4 tuple, with only `afterInitialize` and `afterSwap` true. Enabled callbacks return their exact IHooks selector; `afterSwap` additionally returns `int128(0)`. Direct unauthorized calls revert `NotPoolManager()`; inactive callbacks from the manager revert `CallbackNotEnabled()`. Constructor/address mismatches revert the v4 `HookAddressNotValid(address)` error.

| Read | Result |
| --- | --- |
| `BUCKET_SECONDS()` | `uint256(300)` |
| `MAX_CANDLES()` | `uint256(288)` |
| `lastTick(bytes32 poolId)` | Initial or most recent close as `int24` |
| `latestBucket(bytes32 poolId)` | Latest recorded bucket as `uint256`; zero also represents unrecorded state |
| `candle(bytes32 poolId,uint256 bucket)` | Flat tuple `(int24 open,int24 high,int24 low,int24 close,uint128 volumeEth,uint128 volumeToken,uint128 swaps)` |
| `getCandles(bytes32 poolId,uint256 fromBucket,uint256 count)` | Array of the same tuple, corresponding to consecutive buckets |

`PoolId` encodes as `bytes32`. Compute it as `keccak256(abi.encode(currency0,currency1,fee,tickSpacing,hooks))`, retaining signed tickSpacing ABI encoding. Prices are signed integers, volumes are unsigned raw token units, and bucket timestamps are `bucket * 300` seconds. Use bigint-capable clients for uint128/uint256; JavaScript Number cannot safely hold volumes.

```solidity
event Candle(
    bytes32 indexed poolId,
    uint256 indexed bucket,
    int24 open,
    int24 high,
    int24 low,
    int24 close,
    uint128 volumeEth,
    uint128 volumeToken,
    uint128 swaps
);
```

The Solidity source uses the ABI-equivalent `PoolId` type for the first event parameter. Events carry cumulative values, so replace a bucket's previous event state rather than summing event volumes. Reverted swaps leave neither events nor candle changes. Indexers must handle chain reorganizations. Empty buckets produce no event, and there is no event at initialization. An absent candle is identified by `swaps == 0`; zero open/high/low/close are valid tick values. A uint128-max field has saturated and must be displayed as a lower bound.
