// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {LaunchFactory} from "./support/LaunchFactory.sol";
import {PrepareDeployment} from "../script/PrepareDeployment.s.sol";
import {CNDL} from "../src/CNDL.sol";
import {OHLCCandleHook} from "../src/OHLCCandleHook.sol";
import {PoolManager} from "v4-core/src/PoolManager.sol";
import {IPoolManager} from "v4-core/src/interfaces/IPoolManager.sol";
import {PoolSwapTest} from "v4-core/src/test/PoolSwapTest.sol";
import {PoolKey} from "v4-core/src/types/PoolKey.sol";
import {PoolId} from "v4-core/src/types/PoolId.sol";
import {SwapParams} from "v4-core/src/types/PoolOperation.sol";
import {BalanceDelta} from "v4-core/src/types/BalanceDelta.sol";
import {TickMath} from "v4-core/src/libraries/TickMath.sol";
import {FullMath} from "v4-core/src/libraries/FullMath.sol";
import {StateLibrary} from "v4-core/src/libraries/StateLibrary.sol";
import {TransientStateLibrary} from "v4-core/src/libraries/TransientStateLibrary.sol";

contract LaunchRehearsalTest is Test {
    using StateLibrary for IPoolManager;

    // Explicit rehearsal proposal: the input workflow contains no numeric manifest price.
    uint160 constant INITIAL_SQRT_PRICE_X96 = 79228162514264337593543950336000;
    int24 constant LOWER = -887220;
    int24 constant UPPER = 138120;
    uint256 constant SEED_TOKENS = 900_000_000 ether;

    IPoolManager manager;
    CNDL token;
    OHLCCandleHook hook;
    PoolKey key;
    PoolId id;

    function test_factoryLaunchAndFirstBuyIntoEthlessPool() public {
        vm.warp(3_001);
        vm.deal(address(this), 100 ether);
        manager = IPoolManager(address(new PoolManager(address(this))));
        LaunchFactory factory = new LaunchFactory(manager);
        PrepareDeployment preparation = new PrepareDeployment();
        (bytes32 salt, address predicted) = preparation.find(address(factory), manager, 0, 200_000);
        uint128 liquidity = uint128(
            FullMath.mulDiv(
                SEED_TOKENS, 1 << 96, TickMath.getSqrtPriceAtTick(UPPER) - TickMath.getSqrtPriceAtTick(LOWER)
            )
        );
        (token, hook, key) = factory.launch(salt, INITIAL_SQRT_PRICE_X96, LOWER, UPPER, liquidity);
        id = key.toId();
        assertEq(address(hook), predicted);
        assertEq(factory.supplyReceived(), 1_000_000_000 ether);
        assertEq(address(manager).balance, 0, "one-sided factory seed starts with zero ETH");
        assertLe(token.balanceOf(address(manager)), SEED_TOKENS);
        assertApproxEqAbs(token.balanceOf(address(manager)), SEED_TOKENS, 1000);
        assertEq(token.balanceOf(address(this)) + token.balanceOf(address(manager)), token.totalSupply());
        (uint160 price, int24 initialTick,,) = manager.getSlot0(id);
        assertEq(price, INITIAL_SQRT_PRICE_X96);
        assertEq(hook.lastTick(id), initialTick);
        assertEq(hook.getCandles(id, 10, 1)[0].swaps, 0);

        PoolSwapTest router = new PoolSwapTest(manager);
        token.approve(address(router), type(uint256).max);
        uint256 tokensBefore = token.balanceOf(address(this));
        BalanceDelta buy = router.swap{value: 1 ether}(
            key, SwapParams(true, -1 ether, TickMath.MIN_SQRT_PRICE + 1), PoolSwapTest.TestSettings(false, false), ""
        );
        assertEq(buy.amount0(), -1 ether);
        assertGt(buy.amount1(), 0);
        assertEq(token.balanceOf(address(this)), tokensBefore + uint128(buy.amount1()));
        assertEq(address(manager).balance, 1 ether);
        OHLCCandleHook.CandleData memory first = hook.getCandles(id, 10, 1)[0];
        assertEq(first.open, initialTick, "opening tick precedes the empty-range crossing");
        assertLt(first.close, UPPER);
        assertEq(first.volumeEth, 1 ether);
        assertEq(first.volumeToken, uint128(buy.amount1()));

        BalanceDelta sell = router.swap(
            key,
            SwapParams(false, -int256(uint256(uint128(buy.amount1())) / 2), TickMath.MAX_SQRT_PRICE - 1),
            PoolSwapTest.TestSettings(false, false),
            ""
        );
        assertGt(sell.amount0(), 0);
        assertLt(sell.amount1(), 0);
        assertEq(hook.getCandles(id, 10, 1)[0].swaps, 2);
        assertEq(TransientStateLibrary.getNonzeroDeltaCount(manager), 0);
        assertEq(token.balanceOf(address(hook)), 0);
        assertEq(address(hook).balance, 0);
        assertEq(manager.balanceOf(address(hook), 0), 0);
        assertEq(manager.balanceOf(address(hook), uint256(uint160(address(token)))), 0);
    }

    receive() external payable {}
}
