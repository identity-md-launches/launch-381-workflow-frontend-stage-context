// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {HookFixture} from "./support/HookFixture.sol";
import {OHLCCandleHook} from "../src/OHLCCandleHook.sol";
import {PoolKey} from "v4-core/src/types/PoolKey.sol";
import {PoolId} from "v4-core/src/types/PoolId.sol";
import {IPoolManager} from "v4-core/src/interfaces/IPoolManager.sol";
import {SwapParams, ModifyLiquidityParams} from "v4-core/src/types/PoolOperation.sol";
import {BalanceDelta} from "v4-core/src/types/BalanceDelta.sol";
import {PoolSwapTest} from "v4-core/src/test/PoolSwapTest.sol";
import {TickMath} from "v4-core/src/libraries/TickMath.sol";
import {StateLibrary} from "v4-core/src/libraries/StateLibrary.sol";
import {Pool} from "v4-core/src/libraries/Pool.sol";

contract CandleAdversarialTest is HookFixture {
    using StateLibrary for IPoolManager;

    function testFuzz_emptyPoolSignedTicksRoundTrip(int24 rawStart, int24 rawEnd) public {
        int24 start = int24(bound(int256(rawStart), TickMath.MIN_TICK + 1, TickMath.MAX_TICK - 1));
        int24 end = int24(bound(int256(rawEnd), TickMath.MIN_TICK + 1, TickMath.MAX_TICK - 1));
        // Keep the limit strictly on the requested side; equal prices are rejected by PoolManager.
        if (end == start) end = start == TickMath.MAX_TICK - 1 ? start - 1 : start + 1;
        PoolKey memory empty = key;
        empty.fee = 100;
        manager.initialize(empty, TickMath.getSqrtPriceAtTick(start));
        _emptySwapTo(empty, end);
        int24 post = tickOf(empty.toId());
        OHLCCandleHook.CandleData memory first = hook.getCandles(empty.toId(), 10, 1)[0];
        _assertTicks(first, start, post, 1);
        assertEq(first.volumeEth, 0);
        assertEq(first.volumeToken, 0);
        vm.warp(3300);
        _emptySwapTo(empty, start);
        OHLCCandleHook.CandleData memory second = hook.getCandles(empty.toId(), 11, 1)[0];
        _assertTicks(second, post, tickOf(empty.toId()), 1);
        assertEq(second.volumeEth, 0);
        assertEq(second.volumeToken, 0);
        assertEq(abi.encode(hook.getCandles(empty.toId(), 10, 1)[0]), abi.encode(first));
        assertEq(getCandle(10).swaps, 0, "other pool remains untouched");
    }

    function test_extremeTicksKeepSignedHighLowAcrossSameBucket() public {
        PoolKey memory empty = key;
        empty.fee = 100;
        manager.initialize(empty, TickMath.MIN_SQRT_PRICE);
        int24 minimum = tickOf(empty.toId());
        assertEq(minimum, TickMath.MIN_TICK);
        _emptySwapTo(empty, TickMath.MAX_TICK - 1);
        int24 maximum = tickOf(empty.toId());
        _emptySwapTo(empty, TickMath.MIN_TICK + 1);
        OHLCCandleHook.CandleData memory c = hook.getCandles(empty.toId(), 10, 1)[0];
        assertEq(c.open, minimum);
        assertEq(c.high, maximum);
        assertEq(c.low, minimum);
        assertEq(c.close, tickOf(empty.toId()));
        assertEq(c.swaps, 2);
        assertEq(c.volumeEth, 0);
        assertEq(c.volumeToken, 0);
    }

    function test_negativeTickWithLiquidityHasNonzeroSignedPackedVolumes() public {
        PoolKey memory negative = key;
        negative.fee = 100;
        manager.initialize(negative, TickMath.getSqrtPriceAtTick(-120));
        liquidityRouter.modifyLiquidity{value: 1e24}(negative, ModifyLiquidityParams(-600, 600, 1e22, 0), "");
        BalanceDelta down = swapOn(negative, true, -1e20);
        int24 low = tickOf(negative.toId());
        BalanceDelta up = swapOn(negative, false, -3e20);
        int24 high = tickOf(negative.toId());
        assertLt(low, -120);
        assertGt(high, 0, "exercise a sign change with populated volume fields");
        OHLCCandleHook.CandleData memory c = hook.getCandles(negative.toId(), 10, 1)[0];
        assertEq(c.open, -120);
        assertEq(c.low, low);
        assertEq(c.high, high);
        assertEq(c.close, high);
        assertEq(c.swaps, 2);
        assertEq(c.volumeEth, uint256(abs128(down.amount0())) + abs128(up.amount0()));
        assertEq(c.volumeToken, uint256(abs128(down.amount1())) + abs128(up.amount1()));
        assertGt(c.volumeEth, 0);
        assertGt(c.volumeToken, 0);
    }

    function testFuzz_liquidityAndFailedReinitializeCannotConsumeBoundaryOpen(uint96 rawLiquidity) public {
        swap(true, -1 ether);
        OHLCCandleHook.CandleData memory prior = getCandle(10);
        (uint160 price, int24 tick,,) = manager.getSlot0(id);
        vm.warp(3300);
        int256 liquidity = int256(bound(rawLiquidity, 1e12, 1e22));
        liquidityRouter.modifyLiquidity{value: 1e24}(
            key, ModifyLiquidityParams(-600, 600, liquidity, bytes32(uint256(7))), ""
        );
        vm.expectRevert(Pool.PoolAlreadyInitialized.selector);
        manager.initialize(key, Q96 * 2);
        (uint160 afterPrice,,,) = manager.getSlot0(id);
        assertEq(afterPrice, price);
        assertEq(hook.lastTick(id), tick);
        assertEq(hook.latestBucket(id), 10);
        assertEq(getCandle(11).swaps, 0);
        assertEq(abi.encode(getCandle(10)), abi.encode(prior));
        BalanceDelta delta = swap(false, -1 ether);
        _assertTicks(getCandle(11), tick, tickOf(id), 1);
        assertEq(getCandle(11).volumeEth, abs128(delta.amount0()));
        assertEq(getCandle(11).volumeToken, abs128(delta.amount1()));
    }

    function test_invalidLimitsDoNotCreateBoundaryCandle() public {
        swap(true, -1 ether);
        bytes memory prior = abi.encode(getCandle(10));
        (uint160 price, int24 tick,,) = manager.getSlot0(id);
        vm.warp(3300);
        for (uint256 i; i < 4; ++i) {
            bool down = i % 2 == 0;
            uint160 limit = i < 2 ? price : down ? TickMath.MIN_SQRT_PRICE : TickMath.MAX_SQRT_PRICE;
            bytes memory reason = i < 2
                ? abi.encodeWithSelector(Pool.PriceLimitAlreadyExceeded.selector, price, limit)
                : abi.encodeWithSelector(Pool.PriceLimitOutOfBounds.selector, limit);
            vm.expectRevert(reason);
            router.swap(key, SwapParams(down, -1 ether, limit), PoolSwapTest.TestSettings(false, false), "");
        }
        assertEq(abi.encode(getCandle(10)), prior);
        assertEq(getCandle(11).swaps, 0);
        assertEq(tickOf(id), tick);
        assertEq(hook.lastTick(id), tick);
        assertEq(hook.latestBucket(id), 10);
    }

    function testFuzz_getCandlesClampsAndPreservesPopulatedEntries(uint256 count) public {
        swap(true, -1 ether);
        OHLCCandleHook.CandleData memory first = getCandle(10);
        vm.warp(312 * 300);
        swap(false, -1 ether);
        OHLCCandleHook.CandleData[] memory page = hook.getCandles(id, 25, count);
        assertEq(page.length, count > 288 ? 288 : count);
        for (uint256 i; i < page.length; ++i) {
            if (i == 287) assertEq(abi.encode(page[i]), abi.encode(getCandle(312)));
            else _assertEmpty(page[i]);
        }
        assertEq(abi.encode(getCandle(10)), abi.encode(first), "reads and later buckets preserve history");
        assertEq(hook.getCandles(id, 25, 289).length, 288);
        assertEq(hook.getCandles(id, 25, type(uint256).max).length, 288);
    }

    function testFuzz_getCandlesUint256EndDoesNotWrap(uint16 tail, uint256 count) public view {
        uint256 from = type(uint256).max - uint256(tail);
        uint256 expected = count > 288 ? 288 : count;
        if (expected > uint256(tail) + 1) expected = uint256(tail) + 1;
        OHLCCandleHook.CandleData[] memory page = hook.getCandles(id, from, count);
        assertEq(page.length, expected);
        for (uint256 i; i < page.length; ++i) {
            _assertEmpty(page[i]);
        }
    }

    function _emptySwapTo(PoolKey memory empty, int24 target) private {
        (uint160 price,,,) = manager.getSlot0(empty.toId());
        uint160 limit = TickMath.getSqrtPriceAtTick(target);
        BalanceDelta delta =
            router.swap(empty, SwapParams(limit < price, -1, limit), PoolSwapTest.TestSettings(false, false), "");
        assertEq(BalanceDelta.unwrap(delta), 0);
        (uint160 afterPrice,,,) = manager.getSlot0(empty.toId());
        assertEq(afterPrice, limit);
        assertEq(hook.lastTick(empty.toId()), tickOf(empty.toId()));
    }

    function _assertTicks(OHLCCandleHook.CandleData memory c, int24 pre, int24 post, uint128 swaps) private pure {
        assertEq(c.open, pre);
        assertEq(c.close, post);
        assertEq(c.high, pre > post ? pre : post);
        assertEq(c.low, pre < post ? pre : post);
        assertEq(c.swaps, swaps);
    }

    function _assertEmpty(OHLCCandleHook.CandleData memory c) private pure {
        OHLCCandleHook.CandleData memory empty;
        assertEq(abi.encode(c), abi.encode(empty));
    }
}
