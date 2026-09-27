// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {HookFixture} from "./support/HookFixture.sol";
import {IHooks} from "v4-core/src/interfaces/IHooks.sol";
import {PoolKey} from "v4-core/src/types/PoolKey.sol";
import {SwapParams} from "v4-core/src/types/PoolOperation.sol";
import {BalanceDelta, toBalanceDelta} from "v4-core/src/types/BalanceDelta.sol";
import {OHLCCandleHook} from "../src/OHLCCandleHook.sol";
import {Vm} from "forge-std/Vm.sol";

/// @dev Nested measurement excludes intrinsic transaction gas even when Foundry isolation is enabled.
contract CallbackMeter {
    Vm private constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));

    function measure(OHLCCandleHook hook, address manager, PoolKey memory key) external returns (uint256 used) {
        SwapParams memory params = SwapParams(true, -1 ether, 39614081257132168796771975168);
        BalanceDelta delta = toBalanceDelta(-1 ether, 1 ether);
        vm.prank(manager);
        uint256 beforeGas = gasleft();
        (bytes4 selector, int128 adjustment) = hook.afterSwap(address(this), key, params, delta, "");
        used = beforeGas - gasleft();
        require(selector == IHooks.afterSwap.selector && adjustment == 0);
    }
}

contract CandleGasTest is HookFixture {
    function testGas_firstSwapColdFreshSlotsBelowCeiling() public {
        coolCallbackSlots(10, 0);
        uint256 gasUsed = measureCallback();
        emit log_named_uint("first bucket / cold callback gas (includes CALL)", gasUsed);
        assertLt(gasUsed, 100_000);
    }

    function testGas_existingBucketAndTwoStorageWrites() public {
        swap(true, -1 ether);
        // Record the actual PoolManager callback, not only a synthetic call.
        vm.record();
        swap(false, -1 ether);
        (, bytes32[] memory writes) = vm.accesses(address(hook));
        assertEq(writes.length, 2, "existing candle rewrites only its two packed slots");
        coolCallbackSlots(10, 10);
        uint256 gasUsed = measureCallback();
        emit log_named_uint("existing bucket / cold callback gas (includes CALL)", gasUsed);
        assertLt(gasUsed, 30_000);
    }

    function testGas_rolloverColdFreshCandleBelowCeiling() public {
        swap(true, -1 ether);
        vm.warp(3_300);
        coolCallbackSlots(11, 10);
        uint256 gasUsed = measureCallback();
        emit log_named_uint("rollover / cold callback gas (includes CALL)", gasUsed);
        assertLt(gasUsed, 100_000);
    }

    function measureCallback() private returns (uint256 used) {
        CallbackMeter meter = new CallbackMeter();
        used = meter.measure(hook, address(manager), key);
    }

    function coolCallbackSlots(uint256 bucket, uint256 previousBucket) private {
        bytes32 inner = keccak256(abi.encode(id, uint256(0)));
        uint256 slot = uint256(keccak256(abi.encode(bucket, inner)));
        uint256 previous = uint256(keccak256(abi.encode(previousBucket, inner)));
        vm.coolSlot(address(hook), bytes32(slot));
        vm.coolSlot(address(hook), bytes32(slot + 1));
        vm.coolSlot(address(hook), bytes32(previous));
        vm.coolSlot(address(hook), bytes32(previous + 1));
        vm.coolSlot(address(hook), keccak256(abi.encode(id, uint256(1))));
        vm.coolSlot(address(hook), keccak256(abi.encode(id, uint256(2))));
        vm.coolSlot(address(manager), keccak256(abi.encode(id, uint256(6))));
        vm.cool(address(manager));
        vm.cool(address(hook));
    }
}
