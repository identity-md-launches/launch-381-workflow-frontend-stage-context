// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {HookFixture} from "./support/HookFixture.sol";
import {MockERC20} from "./mocks/MockERC20.sol";
import {OHLCCandleHook} from "../src/OHLCCandleHook.sol";
import {PoolManagerHook} from "../src/base/PoolManagerHook.sol";
import {Hooks} from "v4-core/src/libraries/Hooks.sol";
import {IHooks} from "v4-core/src/interfaces/IHooks.sol";
import {PoolKey} from "v4-core/src/types/PoolKey.sol";
import {PoolId} from "v4-core/src/types/PoolId.sol";
import {Currency} from "v4-core/src/types/Currency.sol";
import {BalanceDelta} from "v4-core/src/types/BalanceDelta.sol";
import {ModifyLiquidityParams, SwapParams} from "v4-core/src/types/PoolOperation.sol";
import {TransientStateLibrary} from "v4-core/src/libraries/TransientStateLibrary.sol";
import {Vm} from "forge-std/Vm.sol";

contract OHLCCandleHookTest is HookFixture {
    function test_exactPermissionsAndConstructorValidation() public {
        Hooks.Permissions memory expected;
        expected.afterInitialize = true;
        expected.afterSwap = true;
        assertEq(abi.encode(hook.getHookPermissions()), abi.encode(expected));
        assertEq(uint160(address(hook)) & 0x3fff, 0x1040);
        bytes32 salt = bytes32(uint256(123));
        address predicted = vm.computeCreate2Address(salt, keccak256(preparation.creationCode(manager)), address(this));
        assertTrue(uint160(predicted) & 0x3fff != 0x1040);
        vm.expectRevert(abi.encodeWithSelector(Hooks.HookAddressNotValid.selector, predicted));
        new OHLCCandleHook{salt: salt}(manager);
        assertEq(address(hook.poolManager()), address(manager));
    }

    function test_firstSwapOpenVolumesEventAndZeroHookDeltas() public {
        int24 beforeTick = tickOf(id);
        vm.recordLogs();
        BalanceDelta delta = swap(true, -1 ether);
        Vm.Log[] memory logs = vm.getRecordedLogs();
        OHLCCandleHook.CandleData memory c = getCandle(10);
        assertEq(c.open, beforeTick);
        assertEq(c.high, beforeTick);
        assertEq(c.low, tickOf(id));
        assertEq(c.close, tickOf(id));
        assertEq(c.volumeEth, abs128(delta.amount0()));
        assertEq(c.volumeToken, abs128(delta.amount1()));
        assertEq(c.swaps, 1);
        assertEq(hook.lastTick(id), c.close);
        uint256 found;
        for (uint256 i; i < logs.length; ++i) {
            if (logs[i].emitter != address(hook)) continue;
            ++found;
            assertEq(
                logs[i].topics[0], keccak256("Candle(bytes32,uint256,int24,int24,int24,int24,uint128,uint128,uint128)")
            );
            assertEq(logs[i].topics[1], PoolId.unwrap(id));
            assertEq(uint256(logs[i].topics[2]), 10);
            assertEq(logs[i].data, abi.encode(c));
        }
        assertEq(found, 1);
        assertEq(TransientStateLibrary.currencyDelta(manager, address(hook), key.currency0), 0);
        assertEq(TransientStateLibrary.currencyDelta(manager, address(hook), key.currency1), 0);
        assertEq(TransientStateLibrary.getNonzeroDeltaCount(manager), 0);
        assertEq(address(hook).balance, 0);
        assertEq(token.balanceOf(address(hook)), 0);
    }

    function test_exactInputAndOutputBothDirectionsAndSeveralSwaps() public {
        uint128 ethVolume;
        uint128 tokenVolume;
        int24 high;
        int24 low;
        for (uint256 i; i < 4; ++i) {
            BalanceDelta d = swap(i % 2 == 0, i < 2 ? -int256(1 ether) : int256(1 ether));
            int24 tick = tickOf(id);
            if (tick > high) high = tick;
            if (tick < low) low = tick;
            ethVolume += abs128(d.amount0());
            tokenVolume += abs128(d.amount1());
            if (i < 2) assertEq(i % 2 == 0 ? d.amount0() : d.amount1(), -int128(1 ether));
            else assertEq(i % 2 == 0 ? d.amount1() : d.amount0(), int128(1 ether));
        }
        OHLCCandleHook.CandleData memory c = getCandle(10);
        assertEq(c.open, 0);
        assertEq(c.high, high);
        assertEq(c.low, low);
        assertEq(c.close, tickOf(id));
        assertEq(c.swaps, 4);
        assertEq(c.volumeEth, ethVolume);
        assertEq(c.volumeToken, tokenVolume);
    }

    function test_exactBucketBoundaryAndGapsOpenAtPreviousClose() public {
        vm.warp(3_299);
        swap(true, -1 ether);
        int24 prior = tickOf(id);
        vm.warp(3_300);
        swap(false, -1 ether);
        assertEq(getCandle(11).open, prior);
        assertEq(getCandle(10).swaps, 1);
        prior = tickOf(id);
        vm.warp(300 * 100_000);
        swap(true, -1 ether);
        assertEq(getCandle(100_000).open, prior);
        assertEq(getCandle(12).swaps, 0);
        assertEq(getCandle(99_999).swaps, 0);
    }

    function test_liquidityAddsAndRemovalDoNotChangeCandlesOrPrice() public {
        assertEq(hook.lastTick(id), 0);
        assertEq(getCandle(10).swaps, 0);
        swap(true, -1 ether);
        bytes32 beforeCandle = keccak256(abi.encode(getCandle(10)));
        int24 beforeTick = tickOf(id);
        vm.warp(3_300);
        liquidityRouter.modifyLiquidity{value: 1e24}(
            key, ModifyLiquidityParams(-600, 600, 1e20, bytes32(uint256(1))), ""
        );
        liquidityRouter.modifyLiquidity(key, ModifyLiquidityParams(-600, 600, -1e20, bytes32(uint256(1))), "");
        assertEq(tickOf(id), beforeTick);
        assertEq(hook.lastTick(id), beforeTick);
        assertEq(keccak256(abi.encode(getCandle(10))), beforeCandle);
        assertEq(getCandle(11).swaps, 0);
        swap(false, -1 ether);
        assertEq(getCandle(11).open, beforeTick);
    }

    function test_dustInAndOutBothDirections() public {
        for (uint256 i; i < 4; ++i) {
            BalanceDelta d = swap(i % 2 == 0, i < 2 ? -int256(1) : int256(1));
            assertLe(abs128(d.amount0()), 4);
            assertLe(abs128(d.amount1()), 4);
        }
        assertEq(getCandle(10).swaps, 4);
        assertEq(hook.lastTick(id), tickOf(id));
    }

    function test_nonNativePoolHasNoHookStateOrEvents() public {
        MockERC20 other = new MockERC20("Other", "OTHER", 1e27);
        other.approve(address(router), type(uint256).max);
        other.approve(address(liquidityRouter), type(uint256).max);
        (address a, address b) =
            address(other) < address(token) ? (address(other), address(token)) : (address(token), address(other));
        PoolKey memory otherKey = PoolKey(Currency.wrap(a), Currency.wrap(b), 3000, 60, IHooks(address(hook)));
        vm.recordLogs();
        vm.record();
        manager.initialize(otherKey, Q96 * 2);
        liquidityRouter.modifyLiquidity(otherKey, ModifyLiquidityParams(-600, 30_000, 1e20, 0), "");
        swapOn(otherKey, true, -1 ether);
        swapOn(otherKey, false, 1 ether);
        (, bytes32[] memory writes) = vm.accesses(address(hook));
        assertEq(writes.length, 0);
        Vm.Log[] memory logs = vm.getRecordedLogs();
        for (uint256 i; i < logs.length; ++i) {
            assertTrue(logs[i].emitter != address(hook));
        }
        assertEq(hook.lastTick(otherKey.toId()), 0);
        assertEq(hook.getCandles(otherKey.toId(), 10, 1)[0].swaps, 0);
    }

    function test_poolIsolation() public {
        PoolKey memory second = key;
        second.fee = 500;
        manager.initialize(second, Q96 * 2);
        liquidityRouter.modifyLiquidity{value: 1e24}(second, ModifyLiquidityParams(-600, 30_000, 1e20, 0), "");
        int24 initial = tickOf(second.toId());
        swap(true, -1 ether);
        assertEq(hook.lastTick(second.toId()), initial);
        swapOn(second, true, -1 ether);
        assertEq(hook.getCandles(second.toId(), 10, 1)[0].open, initial);
        assertEq(getCandle(10).swaps, 1);
    }

    function test_viewBoundsMissingBucketsAndUint256Boundary() public {
        swap(true, -1 ether);
        assertEq(hook.getCandles(id, 10, 0).length, 0);
        assertEq(hook.getCandles(id, 10, 289).length, 288);
        assertEq(hook.getCandles(id, 10, type(uint256).max).length, 288);
        assertEq(hook.getCandles(id, type(uint256).max, 288).length, 1);
        assertEq(hook.getCandles(id, type(uint256).max - 1, 288).length, 2);
        OHLCCandleHook.CandleData[] memory page = hook.getCandles(id, 9, 3);
        assertEq(page[0].swaps, 0);
        assertEq(page[1].swaps, 1);
        assertEq(page[2].swaps, 0);
    }

    function test_allCallbacksRefuseNonManager() public {
        ModifyLiquidityParams memory lp = ModifyLiquidityParams(-60, 60, 1, 0);
        SwapParams memory sp = SwapParams(true, -1, Q96 / 2);
        bytes[10] memory calls = [
            abi.encodeCall(IHooks.beforeInitialize, (address(this), key, Q96)),
            abi.encodeCall(IHooks.afterInitialize, (address(this), key, Q96, 0)),
            abi.encodeCall(IHooks.beforeAddLiquidity, (address(this), key, lp, "")),
            abi.encodeCall(
                IHooks.afterAddLiquidity, (address(this), key, lp, BalanceDelta.wrap(0), BalanceDelta.wrap(0), "")
            ),
            abi.encodeCall(IHooks.beforeRemoveLiquidity, (address(this), key, lp, "")),
            abi.encodeCall(
                IHooks.afterRemoveLiquidity, (address(this), key, lp, BalanceDelta.wrap(0), BalanceDelta.wrap(0), "")
            ),
            abi.encodeCall(IHooks.beforeSwap, (address(this), key, sp, "")),
            abi.encodeCall(IHooks.afterSwap, (address(this), key, sp, BalanceDelta.wrap(0), "")),
            abi.encodeCall(IHooks.beforeDonate, (address(this), key, 0, 0, "")),
            abi.encodeCall(IHooks.afterDonate, (address(this), key, 0, 0, ""))
        ];
        for (uint256 i; i < calls.length; ++i) {
            (bool ok, bytes memory errorData) = address(hook).call(calls[i]);
            assertFalse(ok);
            assertEq(errorData, abi.encodeWithSelector(PoolManagerHook.NotPoolManager.selector));
        }
    }

    function testFuzz_swapSizes(bool direction, bool exactIn, uint96 rawAmount) public {
        int256 amount = int256(bound(rawAmount, 1, 1e21));
        int24 beforeTick = tickOf(id);
        BalanceDelta d = swap(direction, exactIn ? -amount : amount);
        OHLCCandleHook.CandleData memory c = getCandle(10);
        assertEq(c.open, beforeTick);
        assertEq(c.close, tickOf(id));
        assertGe(c.high, c.open);
        assertGe(c.high, c.close);
        assertLe(c.low, c.open);
        assertLe(c.low, c.close);
        assertEq(c.volumeEth, abs128(d.amount0()));
        assertEq(c.volumeToken, abs128(d.amount1()));
        assertEq(c.swaps, 1);
    }

    function test_runtimeHasNoEscapeHatch() public view {
        bytes memory code = address(hook).code;
        assertLe(code.length, 24_576);
        for (uint256 i; i < code.length; ++i) {
            uint8 op = uint8(code[i]);
            if (op >= 0x60 && op <= 0x7f) {
                i += op - 0x5f;
                continue;
            }
            assertTrue(op != 0xf4 && op != 0xff && op != 0xf2);
        }
    }
}
