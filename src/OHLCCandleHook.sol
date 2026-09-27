// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {PoolManagerHook} from "./base/PoolManagerHook.sol";
import {Hooks} from "v4-core/src/libraries/Hooks.sol";
import {IHooks} from "v4-core/src/interfaces/IHooks.sol";
import {IPoolManager} from "v4-core/src/interfaces/IPoolManager.sol";
import {StateLibrary} from "v4-core/src/libraries/StateLibrary.sol";
import {PoolKey} from "v4-core/src/types/PoolKey.sol";
import {PoolId} from "v4-core/src/types/PoolId.sol";
import {SwapParams} from "v4-core/src/types/PoolOperation.sol";
import {BalanceDelta} from "v4-core/src/types/BalanceDelta.sol";

/// @notice Manipulable five-minute display candles, NOT an oracle. Never use these values for pricing.
contract OHLCCandleHook is PoolManagerHook {
    using StateLibrary for IPoolManager;

    uint256 public constant BUCKET_SECONDS = 300;
    uint256 public constant MAX_CANDLES = 288;

    /// @dev Two slots: OHLC + ETH volume in slot 0; token volume + swap count in slot 1.
    /// Counters saturate at uint128.max so observation cannot block an otherwise valid swap.
    struct CandleData {
        int24 open;
        int24 high;
        int24 low;
        int24 close;
        uint128 volumeEth;
        uint128 volumeToken;
        uint128 swaps;
    }

    mapping(PoolId => mapping(uint256 bucket => CandleData)) public candle;
    mapping(PoolId => int24) private initialTick;
    mapping(PoolId => uint256) public latestBucket;

    event Candle(
        PoolId indexed poolId,
        uint256 indexed bucket,
        int24 open,
        int24 high,
        int24 low,
        int24 close,
        uint128 volumeEth,
        uint128 volumeToken,
        uint128 swaps
    );

    constructor(IPoolManager manager) PoolManagerHook(manager) {
        Hooks.validateHookPermissions(IHooks(address(this)), getHookPermissions());
    }

    function getHookPermissions() public pure returns (Hooks.Permissions memory permissions) {
        permissions.afterInitialize = true;
        permissions.afterSwap = true;
    }

    function afterInitialize(address, PoolKey calldata key, uint160, int24 tick)
        external
        override
        onlyPoolManager
        returns (bytes4)
    {
        if (key.currency0.isAddressZero()) initialTick[key.toId()] = tick;
        return IHooks.afterInitialize.selector;
    }

    /// @notice Initial tick until the first swap, then the latest candle's close.
    /// @dev Avoids a redundant write on every swap; latestBucket changes only for a new candle.
    function lastTick(PoolId poolId) public view returns (int24) {
        CandleData storage latest = candle[poolId][latestBucket[poolId]];
        return latest.swaps == 0 ? initialTick[poolId] : latest.close;
    }

    function afterSwap(address, PoolKey calldata key, SwapParams calldata, BalanceDelta delta, bytes calldata)
        external
        override
        onlyPoolManager
        returns (bytes4, int128)
    {
        if (!key.currency0.isAddressZero()) return (IHooks.afterSwap.selector, 0);

        PoolId poolId = key.toId();
        (, int24 tick,,) = poolManager.getSlot0(poolId);
        uint256 bucket = block.timestamp / BUCKET_SECONDS;
        CandleData memory c = candle[poolId][bucket];
        if (c.swaps == 0) {
            int24 open = lastTick(poolId);
            c.open = open;
            c.high = open;
            c.low = open;
            latestBucket[poolId] = bucket;
        }
        if (tick > c.high) c.high = tick;
        if (tick < c.low) c.low = tick;
        c.close = tick;
        c.volumeEth = saturatedAdd(c.volumeEth, magnitude(delta.amount0()));
        c.volumeToken = saturatedAdd(c.volumeToken, magnitude(delta.amount1()));
        c.swaps = saturatedAdd(c.swaps, 1);
        candle[poolId][bucket] = c;

        emit Candle(poolId, bucket, c.open, c.high, c.low, c.close, c.volumeEth, c.volumeToken, c.swaps);
        return (IHooks.afterSwap.selector, 0);
    }

    /// @notice Consecutive buckets, including zero structs for gaps. count is capped at 288.
    /// @dev At the uint256 boundary the result stops rather than wrapping bucket numbers.
    function getCandles(PoolId poolId, uint256 fromBucket, uint256 count)
        external
        view
        returns (CandleData[] memory candles)
    {
        if (count > MAX_CANDLES) count = MAX_CANDLES;
        if (count != 0 && fromBucket > type(uint256).max - (count - 1)) {
            count = type(uint256).max - fromBucket + 1;
        }
        candles = new CandleData[](count);
        for (uint256 i; i < count; ++i) {
            candles[i] = candle[poolId][fromBucket + i];
        }
    }

    function magnitude(int128 amount) private pure returns (uint128) {
        // Widen before negation: abs(int128.min) is representable as uint128.
        // Both casts are safe: the result is nonnegative and at most 2**127.
        // forge-lint: disable-next-line(unsafe-typecast)
        return uint128(uint256(amount < 0 ? -int256(amount) : int256(amount)));
    }

    function saturatedAdd(uint128 a, uint128 b) private pure returns (uint128) {
        uint256 sum = uint256(a) + b;
        // The uint128 cast is reached only when sum fits.
        // forge-lint: disable-next-line(unsafe-typecast)
        return sum > type(uint128).max ? type(uint128).max : uint128(sum);
    }
}
