// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {HookFixture} from "./support/HookFixture.sol";
import {OHLCCandleHook} from "../src/OHLCCandleHook.sol";
import {PoolSwapTest} from "v4-core/src/test/PoolSwapTest.sol";
import {PoolDonateTest} from "v4-core/src/test/PoolDonateTest.sol";
import {IPoolManager} from "v4-core/src/interfaces/IPoolManager.sol";
import {SwapParams, ModifyLiquidityParams} from "v4-core/src/types/PoolOperation.sol";
import {BalanceDelta} from "v4-core/src/types/BalanceDelta.sol";
import {TickMath} from "v4-core/src/libraries/TickMath.sol";
import {TransientStateLibrary} from "v4-core/src/libraries/TransientStateLibrary.sol";
import {StateLibrary} from "v4-core/src/libraries/StateLibrary.sol";

contract SettlementTest is HookFixture {
    using StateLibrary for IPoolManager;

    function test_failedNativeSettlementRollsBackPriceAndCandle() public {
        int24 beforeTick = tickOf(id);
        vm.expectRevert();
        router.swap(
            key, SwapParams(true, -1 ether, TickMath.MIN_SQRT_PRICE + 1), PoolSwapTest.TestSettings(false, false), ""
        );
        assertEq(tickOf(id), beforeTick);
        assertEq(getCandle(10).swaps, 0);
        assertEq(hook.lastTick(id), beforeTick);
    }

    function test_failedTokenSettlementRollsBackExistingCandle() public {
        swap(true, -1 ether);
        bytes32 candleBefore = keccak256(abi.encode(getCandle(10)));
        int24 beforeTick = tickOf(id);
        token.approve(address(router), 0);
        vm.expectRevert();
        router.swap(
            key, SwapParams(false, -1 ether, TickMath.MAX_SQRT_PRICE - 1), PoolSwapTest.TestSettings(false, false), ""
        );
        assertEq(tickOf(id), beforeTick);
        assertEq(keccak256(abi.encode(getCandle(10))), candleBefore);
        assertEq(hook.lastTick(id), beforeTick);
    }

    function test_rejectedSwapDoesNotCreateCandle() public {
        vm.expectRevert(IPoolManager.SwapAmountCannotBeZero.selector);
        router.swap(key, SwapParams(true, 0, Q96 / 2), PoolSwapTest.TestSettings(false, false), "");
        assertEq(getCandle(10).swaps, 0);
    }

    function test_donationChangesNeitherPriceNorCandles() public {
        swap(true, -1 ether);
        PoolDonateTest donor = new PoolDonateTest(manager);
        token.approve(address(donor), type(uint256).max);
        int24 beforeTick = tickOf(id);
        bytes32 beforeCandle = keccak256(abi.encode(getCandle(10)));
        donor.donate{value: 1 ether}(key, 1 ether, 1 ether, "");
        assertEq(tickOf(id), beforeTick);
        assertEq(hook.lastTick(id), beforeTick);
        assertEq(keccak256(abi.encode(getCandle(10))), beforeCandle);
    }

    function test_swapBalanceConservationAndLiquidityUnwind() public {
        uint256 beforeEth = address(this).balance + address(manager).balance;
        uint256 beforeToken = token.balanceOf(address(this)) + token.balanceOf(address(manager));
        swap(true, -1 ether);
        swap(false, -1 ether);
        OHLCCandleHook.CandleData memory before = getCandle(10);
        BalanceDelta removed = liquidityRouter.modifyLiquidity(key, ModifyLiquidityParams(-600, 600, -1e24, 0), "");
        assertGt(removed.amount0(), 0);
        assertGt(removed.amount1(), 0);
        assertEq(manager.getLiquidity(id), 0);
        assertEq(keccak256(abi.encode(getCandle(10))), keccak256(abi.encode(before)));
        assertEq(address(this).balance + address(manager).balance, beforeEth);
        assertEq(token.balanceOf(address(this)) + token.balanceOf(address(manager)), beforeToken);
        assertEq(TransientStateLibrary.getNonzeroDeltaCount(manager), 0);
        assertEq(address(router).balance, 0);
        assertEq(address(liquidityRouter).balance, 0);
        assertEq(address(hook).balance, 0);
        assertEq(token.balanceOf(address(hook)), 0);
    }
}
