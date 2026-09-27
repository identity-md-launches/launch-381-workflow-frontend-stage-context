// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {LaunchFactory} from "./support/LaunchFactory.sol";
import {CNDL} from "../src/CNDL.sol";
import {OHLCCandleHook} from "../src/OHLCCandleHook.sol";
import {PrepareDeployment} from "../script/PrepareDeployment.s.sol";
import {PoolManager} from "v4-core/src/PoolManager.sol";
import {IPoolManager} from "v4-core/src/interfaces/IPoolManager.sol";
import {IHooks} from "v4-core/src/interfaces/IHooks.sol";
import {PoolKey} from "v4-core/src/types/PoolKey.sol";
import {PoolId} from "v4-core/src/types/PoolId.sol";
import {SwapParams} from "v4-core/src/types/PoolOperation.sol";
import {BalanceDelta} from "v4-core/src/types/BalanceDelta.sol";
import {PoolSwapTest} from "v4-core/src/test/PoolSwapTest.sol";
import {StateLibrary} from "v4-core/src/libraries/StateLibrary.sol";
import {TransientStateLibrary} from "v4-core/src/libraries/TransientStateLibrary.sol";
import {TickMath} from "v4-core/src/libraries/TickMath.sol";
import {FullMath} from "v4-core/src/libraries/FullMath.sol";

contract FactoryCandleLifecycleTest is Test {
    using StateLibrary for IPoolManager;

    // Same explicit proposal as LaunchRehearsal: the supplied workflow has no numeric manifest price.
    uint160 constant INITIAL_PRICE = 79228162514264337593543950336000;
    int24 constant LOWER = -887220;
    int24 constant UPPER = 138120;
    IPoolManager manager;
    CNDL token;
    OHLCCandleHook hook;
    PoolSwapTest router;
    PoolKey key;
    PoolId id;

    function setUp() public {
        vm.warp(3299);
        vm.deal(address(this), 1000 ether);
        manager = IPoolManager(address(new PoolManager(address(this))));
        LaunchFactory factory = new LaunchFactory(manager);
        PrepareDeployment preparation = new PrepareDeployment();
        (bytes32 salt, address predicted) = preparation.find(address(factory), manager, 0, 200_000);
        uint128 liquidity = uint128(
            FullMath.mulDiv(
                900_000_000 ether, 1 << 96, TickMath.getSqrtPriceAtTick(UPPER) - TickMath.getSqrtPriceAtTick(LOWER)
            )
        );
        (token, hook, key) = factory.launch(salt, INITIAL_PRICE, LOWER, UPPER, liquidity);
        id = key.toId();
        router = new PoolSwapTest(manager);
        token.approve(address(router), type(uint256).max);
        assertEq(address(hook), predicted);
        assertEq(uint160(address(hook)) & 0x3fff, 0x1040);
        assertEq(factory.supplyReceived(), token.totalSupply());
        assertEq(address(manager).balance, 0);
        assertEq(manager.getLiquidity(id), 0, "seed range starts below the initial price");
        assertGt(token.balanceOf(address(manager)), 0);
        assertEq(hook.getCandles(id, 10, 1)[0].swaps, 0);
        assertEq(hook.lastTick(id), _tick());
    }

    function testFuzz_firstFactoryBuyOpensAtPreSwapTick(bool exactInput, uint96 rawAmount) public {
        uint256 amount = exactInput ? bound(rawAmount, 1, 10 ether) : bound(rawAmount, 1, 1_000_000 ether);
        int24 beforeTick = _tick();
        BalanceDelta delta = _buy(exactInput ? -int256(amount) : int256(amount), TickMath.MIN_SQRT_PRICE + 1);
        if (exactInput) assertEq(delta.amount0(), -int256(amount));
        else assertEq(delta.amount1(), int256(amount));
        _assertFirst(delta, beforeTick, 10);
        assertEq(address(manager).balance, uint128(-delta.amount0()));
        assertEq(TransientStateLibrary.getNonzeroDeltaCount(manager), 0);
        assertEq(address(hook).balance, 0);
        assertEq(token.balanceOf(address(hook)), 0);
    }

    function test_failedFirstBuyPreservesInitialOpenUntilExactBoundaryRetry() public {
        int24 beforeTick = _tick();
        uint256 tokensBefore = token.balanceOf(address(manager));
        // This reaches afterSwap, but the router cannot settle its ETH debt.
        vm.expectCall(address(hook), abi.encodePacked(IHooks.afterSwap.selector));
        vm.expectRevert();
        router.swap(
            key, SwapParams(true, -1 ether, TickMath.MIN_SQRT_PRICE + 1), PoolSwapTest.TestSettings(false, false), ""
        );
        (uint160 price,,,) = manager.getSlot0(id);
        assertEq(price, INITIAL_PRICE);
        assertEq(hook.lastTick(id), beforeTick);
        assertEq(hook.latestBucket(id), 0);
        assertEq(hook.getCandles(id, 10, 1)[0].swaps, 0);
        assertEq(token.balanceOf(address(manager)), tokensBefore);
        assertEq(address(manager).balance, 0);
        assertEq(TransientStateLibrary.getNonzeroDeltaCount(manager), 0);
        vm.warp(3300);
        BalanceDelta delta = _buy(-1 ether, TickMath.MIN_SQRT_PRICE + 1);
        _assertFirst(delta, beforeTick, 11);
        assertEq(hook.getCandles(id, 10, 1)[0].swaps, 0);
    }

    function test_priceLimitedFirstBuyCountsExecutedVolumeAndRefundsRemainder() public {
        int24 beforeTick = _tick();
        uint160 limit = TickMath.getSqrtPriceAtTick(UPPER - 60);
        uint256 ethBefore = address(this).balance;
        uint256 tokensBefore = token.balanceOf(address(this));
        BalanceDelta delta = _buy(-100 ether, limit);
        assertLt(delta.amount0(), 0);
        assertGt(delta.amount0(), -int128(100 ether), "price limit must cause a partial fill");
        assertGt(delta.amount1(), 0);
        (uint160 price,,,) = manager.getSlot0(id);
        assertEq(price, limit);
        assertEq(ethBefore - address(this).balance, uint128(-delta.amount0()));
        assertEq(token.balanceOf(address(this)) - tokensBefore, uint128(delta.amount1()));
        assertEq(address(router).balance, 0);
        _assertFirst(delta, beforeTick, 10);
    }

    function _buy(int256 amount, uint160 limit) private returns (BalanceDelta) {
        return router.swap{value: 100 ether}(
            key, SwapParams(true, amount, limit), PoolSwapTest.TestSettings(false, false), ""
        );
    }

    function _assertFirst(BalanceDelta delta, int24 beforeTick, uint256 bucket) private view {
        OHLCCandleHook.CandleData memory c = hook.getCandles(id, bucket, 1)[0];
        int24 postTick = _tick();
        assertEq(c.open, beforeTick);
        assertEq(c.high, beforeTick > postTick ? beforeTick : postTick);
        assertEq(c.low, beforeTick < postTick ? beforeTick : postTick);
        assertEq(c.close, postTick);
        assertEq(c.volumeEth, uint128(-delta.amount0()));
        assertEq(c.volumeToken, uint128(delta.amount1()));
        assertEq(c.swaps, 1);
        assertEq(hook.lastTick(id), postTick);
        assertEq(hook.latestBucket(id), bucket);
    }

    function _tick() private view returns (int24 tick) {
        (, tick,,) = manager.getSlot0(id);
    }

    receive() external payable {}
}
