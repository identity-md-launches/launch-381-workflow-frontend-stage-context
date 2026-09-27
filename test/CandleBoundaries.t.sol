// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {HookFixture} from "./support/HookFixture.sol";
import {OHLCCandleHook} from "../src/OHLCCandleHook.sol";
import {PoolKey} from "v4-core/src/types/PoolKey.sol";
import {PoolId} from "v4-core/src/types/PoolId.sol";
import {IHooks} from "v4-core/src/interfaces/IHooks.sol";
import {SwapParams} from "v4-core/src/types/PoolOperation.sol";
import {BalanceDelta, toBalanceDelta} from "v4-core/src/types/BalanceDelta.sol";
import {TickMath} from "v4-core/src/libraries/TickMath.sol";
import {StateLibrary} from "v4-core/src/libraries/StateLibrary.sol";

contract CandleBoundariesTest is HookFixture {
    function test_realSwapsAtNegativeAndExtremeTicksWithNoLiquidity() public {
        int24[4] memory ticks = [int24(-887271), int24(-100_001), int24(100_001), int24(887271)];
        for (uint256 i; i < ticks.length; ++i) {
            PoolKey memory edge = key;
            edge.fee = uint24(100 + i);
            manager.initialize(edge, TickMath.getSqrtPriceAtTick(ticks[i]));
            assertEq(hook.lastTick(edge.toId()), ticks[i]);
            // Empty pools accept swaps and can move price even with zero currency delta.
            swapOn(edge, i % 2 == 1, -1);
            OHLCCandleHook.CandleData memory c = hook.getCandles(edge.toId(), 10, 1)[0];
            assertEq(c.open, ticks[i]);
            assertEq(c.close, tickOf(edge.toId()));
            assertEq(c.swaps, 1);
            assertEq(c.volumeEth, 0);
            assertEq(c.volumeToken, 0);
            assertGe(c.high, c.open);
            assertGe(c.high, c.close);
            assertLe(c.low, c.open);
            assertLe(c.low, c.close);
        }
    }

    function testFuzz_fullSignedDeltaDomainNeverReverts(int128 amount0, int128 amount1) public {
        // A focused arithmetic test: production callbacks in the other suites come from real swaps.
        vm.prank(address(manager));
        (bytes4 selector, int128 delta) = hook.afterSwap(
            address(this), key, SwapParams(true, -1, Q96 / 2), toBalanceDelta(amount0, amount1), hex"ff00"
        );
        assertEq(selector, IHooks.afterSwap.selector);
        assertEq(delta, 0);
        OHLCCandleHook.CandleData memory c = getCandle(10);
        assertEq(c.volumeEth, abs128(amount0));
        assertEq(c.volumeToken, abs128(amount1));
    }

    function test_minInt128AndVolumeSaturation() public {
        for (uint256 i; i < 3; ++i) {
            vm.prank(address(manager));
            hook.afterSwap(
                address(this),
                key,
                SwapParams(true, -1, Q96 / 2),
                toBalanceDelta(type(int128).min, type(int128).min),
                ""
            );
        }
        OHLCCandleHook.CandleData memory c = getCandle(10);
        assertEq(c.volumeEth, type(uint128).max);
        assertEq(c.volumeToken, type(uint128).max);
        assertEq(c.swaps, 3);
        swap(true, -1 ether);
        assertEq(getCandle(10).volumeEth, type(uint128).max);
        assertEq(getCandle(10).swaps, 4);
        vm.warp(3_300);
        swap(true, -1 ether);
        assertEq(getCandle(11).swaps, 1);
        assertEq(getCandle(11).volumeEth, 1 ether);
    }

    function test_swapCountSaturationDoesNotResetOpen() public {
        swap(true, -1 ether);
        OHLCCandleHook.CandleData memory before = getCandle(10);
        // candle is the first storage mapping; slot 1 packs token volume in low 128 bits and swaps above it.
        bytes32 inner = keccak256(abi.encode(id, uint256(0)));
        bytes32 slot = bytes32(uint256(keccak256(abi.encode(uint256(10), inner))) + 1);
        vm.store(address(hook), slot, bytes32(uint256(before.volumeToken) | (uint256(type(uint128).max) << 128)));
        swap(false, -1 ether);
        OHLCCandleHook.CandleData memory c = getCandle(10);
        assertEq(c.swaps, type(uint128).max);
        assertEq(c.open, before.open);
        assertEq(c.close, tickOf(id));
    }

    function test_bucketZeroAndLargestTimestamp() public {
        vm.warp(0);
        swap(true, -1 ether);
        assertEq(getCandle(0).open, 0);
        assertEq(hook.lastTick(id), tickOf(id));
        int24 prior = tickOf(id);
        vm.warp(type(uint256).max);
        swap(false, -1 ether);
        uint256 bucket = type(uint256).max / 300;
        assertEq(getCandle(bucket).open, prior);
        assertEq(hook.latestBucket(id), bucket);
        assertEq(hook.lastTick(id), tickOf(id));
    }

    function testFuzz_candleContinuityAcrossSwapsAndGaps(uint256 seed) public {
        uint128 ethVolume;
        uint128 tokenVolume;
        int24 previous = tickOf(id);
        uint256 previousBucket = 10;
        int24 expectedOpen = previous;
        int24 expectedHigh = previous;
        int24 expectedLow = previous;
        uint128 swaps;
        for (uint256 i; i < 16; ++i) {
            seed = uint256(keccak256(abi.encode(seed, i)));
            uint256 bucket = previousBucket + seed % 3;
            vm.warp(bucket * 300);
            if (bucket != previousBucket) {
                expectedOpen = previous;
                expectedHigh = previous;
                expectedLow = previous;
                ethVolume = 0;
                tokenVolume = 0;
                swaps = 0;
            }
            BalanceDelta d = swap(seed & 4 == 0, -int256(1 + seed % 1e20));
            int24 post = tickOf(id);
            if (post > expectedHigh) expectedHigh = post;
            if (post < expectedLow) expectedLow = post;
            ethVolume += abs128(d.amount0());
            tokenVolume += abs128(d.amount1());
            ++swaps;
            OHLCCandleHook.CandleData memory c = getCandle(bucket);
            assertEq(c.open, expectedOpen);
            assertEq(c.close, post);
            assertEq(c.high, expectedHigh);
            assertEq(c.low, expectedLow);
            assertEq(c.volumeEth, ethVolume);
            assertEq(c.volumeToken, tokenVolume);
            assertEq(c.swaps, swaps);
            previous = post;
            previousBucket = bucket;
        }
    }
}
