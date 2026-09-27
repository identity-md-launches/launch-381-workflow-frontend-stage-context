// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {HookFixture} from "./support/HookFixture.sol";
import {CNDL} from "../src/CNDL.sol";
import {OHLCCandleHook} from "../src/OHLCCandleHook.sol";
import {IPoolManager} from "v4-core/src/interfaces/IPoolManager.sol";
import {IHooks} from "v4-core/src/interfaces/IHooks.sol";
import {PoolKey} from "v4-core/src/types/PoolKey.sol";
import {PoolId} from "v4-core/src/types/PoolId.sol";
import {SwapParams, ModifyLiquidityParams} from "v4-core/src/types/PoolOperation.sol";
import {BalanceDelta} from "v4-core/src/types/BalanceDelta.sol";
import {PoolSwapTest} from "v4-core/src/test/PoolSwapTest.sol";
import {PoolModifyLiquidityTest} from "v4-core/src/test/PoolModifyLiquidityTest.sol";
import {StateLibrary} from "v4-core/src/libraries/StateLibrary.sol";
import {TransientStateLibrary} from "v4-core/src/libraries/TransientStateLibrary.sol";
import {TickMath} from "v4-core/src/libraries/TickMath.sol";

/// @dev Ghost state uses full-width fields and only PoolManager ticks and returned deltas.
/// It never derives expected OHLC values, volumes, or previous ticks from the hook.
contract CandleHandler is Test {
    using StateLibrary for IPoolManager;

    struct Expected {
        int256 open;
        int256 high;
        int256 low;
        int256 close;
        uint256 ethVolume;
        uint256 tokenVolume;
        uint256 swaps;
    }

    IPoolManager immutable manager;
    CNDL immutable token;
    OHLCCandleHook immutable hook;
    PoolSwapTest immutable router;
    PoolModifyLiquidityTest immutable liquidityRouter;
    PoolKey key;
    PoolId id;
    mapping(uint256 => Expected) expected;
    uint256[] populatedBuckets;
    int24 expectedTick;
    uint256 expectedLatest;
    uint256 public successfulSwaps;
    uint256 public failedSwaps;
    uint256 public liquidityCycles;
    uint256 immutable firstBucket;

    constructor(
        IPoolManager manager_,
        CNDL token_,
        OHLCCandleHook hook_,
        PoolKey memory key_,
        PoolSwapTest router_,
        PoolModifyLiquidityTest liquidityRouter_
    ) {
        manager = manager_;
        token = token_;
        hook = hook_;
        key = key_;
        id = key_.toId();
        router = router_;
        liquidityRouter = liquidityRouter_;
        (, expectedTick,,) = manager_.getSlot0(id);
        firstBucket = block.timestamp / 300;
        token_.approve(address(router_), type(uint256).max);
        token_.approve(address(liquidityRouter_), type(uint256).max);
    }

    function trade(bool down, bool exactInput, uint96 rawAmount) external {
        // 64 actions cannot exhaust the fixture's 1e24 liquidity or the handler's funds.
        int256 amount = int256(bound(rawAmount, 1, 1 ether));
        (, int24 beforeTick,,) = manager.getSlot0(id);
        BalanceDelta delta = router.swap{value: down ? 10 ether : 0}(
            key,
            SwapParams(
                down, exactInput ? -amount : amount, down ? TickMath.MIN_SQRT_PRICE + 1 : TickMath.MAX_SQRT_PRICE - 1
            ),
            PoolSwapTest.TestSettings(false, false),
            ""
        );
        (, int24 afterTick,,) = manager.getSlot0(id);
        uint256 bucket = block.timestamp / 300;
        Expected storage e = expected[bucket];
        if (e.swaps == 0) {
            populatedBuckets.push(bucket);
            e.open = beforeTick;
            e.high = beforeTick;
            e.low = beforeTick;
        }
        if (afterTick > e.high) e.high = afterTick;
        if (afterTick < e.low) e.low = afterTick;
        e.close = afterTick;
        e.ethVolume += _abs(delta.amount0());
        e.tokenVolume += _abs(delta.amount1());
        ++e.swaps;
        ++successfulSwaps;
        expectedTick = afterTick;
        expectedLatest = bucket;
    }

    function advanceTime(uint96 rawSeconds, bool exactBoundary) external {
        uint256 next = exactBoundary
            ? (block.timestamp / 300 + 1 + uint256(rawSeconds) % 3) * 300
            : block.timestamp + uint256(rawSeconds) % 901;
        vm.warp(next);
    }

    function addAndRemoveLiquidity(uint96 rawLiquidity) external {
        int256 liquidity = int256(bound(rawLiquidity, 1e12, 1e21));
        bytes32 salt = bytes32(++liquidityCycles);
        liquidityRouter.modifyLiquidity{value: 1e23}(key, ModifyLiquidityParams(-600, 600, liquidity, salt), "");
        // Check the addition independently, so removal cannot mask a temporary candle mutation.
        assertModel();
        liquidityRouter.modifyLiquidity(key, ModifyLiquidityParams(-600, 600, -liquidity, salt), "");
    }

    function failedSettlement(bool nativeDebt) external {
        (uint160 beforePrice,,,) = manager.getSlot0(id);
        if (!nativeDebt) token.approve(address(router), 0);
        // Both paths reach the hook and then fail payment. No ETH is forwarded to the router.
        vm.expectCall(address(hook), abi.encodePacked(IHooks.afterSwap.selector));
        vm.expectRevert();
        router.swap(
            key,
            SwapParams(nativeDebt, -1 ether, nativeDebt ? TickMath.MIN_SQRT_PRICE + 1 : TickMath.MAX_SQRT_PRICE - 1),
            PoolSwapTest.TestSettings(false, false),
            ""
        );
        if (!nativeDebt) token.approve(address(router), type(uint256).max);
        (uint160 afterPrice,,,) = manager.getSlot0(id);
        assertEq(afterPrice, beforePrice, "failed settlement must roll back the entire swap");
        ++failedSwaps;
    }

    function rejectedZeroSwap(bool down) external {
        vm.expectRevert(IPoolManager.SwapAmountCannotBeZero.selector);
        router.swap(
            key,
            SwapParams(down, 0, down ? TickMath.MIN_SQRT_PRICE + 1 : TickMath.MAX_SQRT_PRICE - 1),
            PoolSwapTest.TestSettings(false, false),
            ""
        );
        ++failedSwaps;
    }

    function assertModel() public view {
        (, int24 currentTick,,) = manager.getSlot0(id);
        assertEq(currentTick, expectedTick, "only successful swaps move price");
        assertEq(hook.lastTick(id), expectedTick);
        assertEq(hook.latestBucket(id), expectedLatest);
        uint256 totalSwaps;
        uint256 nextBucket = firstBucket;
        for (uint256 i; i < populatedBuckets.length; ++i) {
            uint256 bucket = populatedBuckets[i];
            // Also compare every gap, rather than only the buckets that have swaps.
            for (; nextBucket < bucket; ++nextBucket) {
                _assertEmpty(nextBucket);
            }
            Expected memory e = expected[bucket];
            OHLCCandleHook.CandleData memory c = hook.getCandles(id, bucket, 1)[0];
            assertEq(c.open, e.open);
            assertEq(c.high, e.high);
            assertEq(c.low, e.low);
            assertEq(c.close, e.close);
            assertEq(c.volumeEth, e.ethVolume);
            assertEq(c.volumeToken, e.tokenVolume);
            assertEq(c.swaps, e.swaps);
            totalSwaps += c.swaps;
            nextBucket = bucket + 1;
        }
        for (; nextBucket <= block.timestamp / 300; ++nextBucket) {
            _assertEmpty(nextBucket);
        }
        assertEq(totalSwaps, successfulSwaps);
    }

    function _assertEmpty(uint256 bucket) private view {
        OHLCCandleHook.CandleData memory empty;
        assertEq(abi.encode(hook.getCandles(id, bucket, 1)[0]), abi.encode(empty));
    }

    function _abs(int128 value) private pure returns (uint256) {
        return uint256(value < 0 ? -int256(value) : int256(value));
    }

    receive() external payable {}
}

contract CandleInvariantTest is HookFixture {
    CandleHandler handler;
    uint256 initialEth;

    function setUp() public override {
        super.setUp();
        handler = new CandleHandler(manager, token, hook, key, router, liquidityRouter);
        token.transfer(address(handler), token.balanceOf(address(this)));
        vm.deal(address(handler), 1e30);
        initialEth = address(handler).balance + address(manager).balance;
        targetContract(address(handler));
        bytes4[] memory selectors = new bytes4[](5);
        selectors[0] = handler.trade.selector;
        selectors[1] = handler.advanceTime.selector;
        selectors[2] = handler.addAndRemoveLiquidity.selector;
        selectors[3] = handler.failedSettlement.selector;
        selectors[4] = handler.rejectedZeroSwap.selector;
        targetSelector(FuzzSelector(address(handler), selectors));
    }

    /// forge-config: default.invariant.runs = 128
    /// forge-config: default.invariant.depth = 64
    /// forge-config: default.invariant.fail-on-revert = true
    function invariant_candlesMatchIndependentHistoryAndSettlement() public view {
        handler.assertModel();
        assertEq(token.balanceOf(address(handler)) + token.balanceOf(address(manager)), token.totalSupply());
        assertEq(address(handler).balance + address(manager).balance, initialEth);
        assertEq(TransientStateLibrary.getNonzeroDeltaCount(manager), 0);
        assertFalse(TransientStateLibrary.isUnlocked(manager));
        assertEq(address(hook).balance, 0);
        assertEq(token.balanceOf(address(hook)), 0);
        assertEq(address(router).balance, 0);
        assertEq(address(liquidityRouter).balance, 0);
        assertEq(manager.balanceOf(address(hook), 0), 0);
        assertEq(manager.balanceOf(address(hook), uint256(uint160(address(token)))), 0);
    }

    function test_handlerExercisesAllActionsAndBothSettlementFailures() public {
        handler.failedSettlement(true);
        handler.failedSettlement(false);
        handler.addAndRemoveLiquidity(1e20);
        handler.trade(true, true, 1 ether);
        handler.trade(false, false, 1 ether);
        handler.advanceTime(0, true);
        handler.failedSettlement(false);
        handler.addAndRemoveLiquidity(1e20);
        handler.rejectedZeroSwap(true);
        handler.trade(true, false, 1 ether);
        handler.trade(false, true, 1 ether);
        handler.advanceTime(899, false);
        invariant_candlesMatchIndependentHistoryAndSettlement();
        assertEq(handler.successfulSwaps(), 4);
        assertEq(handler.failedSwaps(), 4);
        assertEq(handler.liquidityCycles(), 2);
    }
}
