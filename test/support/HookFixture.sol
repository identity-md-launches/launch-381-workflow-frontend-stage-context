// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {CNDL} from "../../src/CNDL.sol";
import {OHLCCandleHook} from "../../src/OHLCCandleHook.sol";
import {PrepareDeployment} from "../../script/PrepareDeployment.s.sol";
import {PoolManager} from "v4-core/src/PoolManager.sol";
import {IPoolManager} from "v4-core/src/interfaces/IPoolManager.sol";
import {IHooks} from "v4-core/src/interfaces/IHooks.sol";
import {PoolKey} from "v4-core/src/types/PoolKey.sol";
import {PoolId} from "v4-core/src/types/PoolId.sol";
import {Currency} from "v4-core/src/types/Currency.sol";
import {SwapParams, ModifyLiquidityParams} from "v4-core/src/types/PoolOperation.sol";
import {BalanceDelta} from "v4-core/src/types/BalanceDelta.sol";
import {StateLibrary} from "v4-core/src/libraries/StateLibrary.sol";
import {TickMath} from "v4-core/src/libraries/TickMath.sol";
import {PoolSwapTest} from "v4-core/src/test/PoolSwapTest.sol";
import {PoolModifyLiquidityTest} from "v4-core/src/test/PoolModifyLiquidityTest.sol";

abstract contract HookFixture is Test {
    using StateLibrary for IPoolManager;

    IPoolManager manager;
    CNDL token;
    OHLCCandleHook hook;
    PrepareDeployment preparation;
    PoolSwapTest router;
    PoolModifyLiquidityTest liquidityRouter;
    PoolKey key;
    PoolId id;
    uint160 constant Q96 = 79228162514264337593543950336;

    function setUp() public virtual {
        vm.warp(3_001);
        vm.deal(address(this), 1e32);
        manager = IPoolManager(address(new PoolManager(address(this))));
        token = new CNDL();
        preparation = new PrepareDeployment();
        (bytes32 salt, address predicted) = preparation.find(address(this), manager, 0, 200_000);
        hook = new OHLCCandleHook{salt: salt}(manager);
        assertEq(address(hook), predicted);
        router = new PoolSwapTest(manager);
        liquidityRouter = new PoolModifyLiquidityTest(manager);
        token.approve(address(router), type(uint256).max);
        token.approve(address(liquidityRouter), type(uint256).max);
        key = PoolKey(Currency.wrap(address(0)), Currency.wrap(address(token)), 3000, 60, IHooks(address(hook)));
        id = key.toId();
        manager.initialize(key, Q96);
        liquidityRouter.modifyLiquidity{value: 1e24}(key, ModifyLiquidityParams(-600, 600, 1e24, 0), "");
    }

    function swap(bool zeroForOne, int256 amount) internal returns (BalanceDelta) {
        return swapOn(key, zeroForOne, amount);
    }

    function swapOn(PoolKey memory poolKey, bool zeroForOne, int256 amount) internal returns (BalanceDelta) {
        return router.swap{value: poolKey.currency0.isAddressZero() && zeroForOne ? 1e24 : 0}(
            poolKey,
            SwapParams(zeroForOne, amount, zeroForOne ? TickMath.MIN_SQRT_PRICE + 1 : TickMath.MAX_SQRT_PRICE - 1),
            PoolSwapTest.TestSettings(false, false),
            ""
        );
    }

    function tickOf(PoolId poolId) internal view returns (int24 tick) {
        (, tick,,) = manager.getSlot0(poolId);
    }

    function getCandle(uint256 bucket) internal view returns (OHLCCandleHook.CandleData memory) {
        return hook.getCandles(id, bucket, 1)[0];
    }

    function abs128(int128 n) internal pure returns (uint128) {
        return uint128(uint256(n < 0 ? -int256(n) : int256(n)));
    }

    receive() external payable {}
}
