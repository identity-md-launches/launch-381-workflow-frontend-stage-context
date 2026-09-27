// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {CNDL} from "../../src/CNDL.sol";
import {OHLCCandleHook} from "../../src/OHLCCandleHook.sol";
import {IPoolManager} from "v4-core/src/interfaces/IPoolManager.sol";
import {IUnlockCallback} from "v4-core/src/interfaces/callback/IUnlockCallback.sol";
import {IHooks} from "v4-core/src/interfaces/IHooks.sol";
import {Currency} from "v4-core/src/types/Currency.sol";
import {PoolKey} from "v4-core/src/types/PoolKey.sol";
import {ModifyLiquidityParams} from "v4-core/src/types/PoolOperation.sol";
import {BalanceDelta} from "v4-core/src/types/BalanceDelta.sol";

/// @dev Test-only model of the specified factory sequence, not a production factory implementation.
contract LaunchFactory is IUnlockCallback {
    IPoolManager public immutable manager;
    uint256 public supplyReceived;
    int128 public tokenSeeded;

    constructor(IPoolManager manager_) {
        manager = manager_;
    }

    function launch(bytes32 salt, uint160 price, int24 lower, int24 upper, uint128 liquidity)
        external
        returns (CNDL token, OHLCCandleHook hook, PoolKey memory key)
    {
        token = new CNDL();
        supplyReceived = token.balanceOf(address(this));
        require(supplyReceived == token.totalSupply(), "supply must belong to factory");
        hook = new OHLCCandleHook{salt: salt}(manager);
        key = PoolKey(Currency.wrap(address(0)), Currency.wrap(address(token)), 3000, 60, IHooks(address(hook)));
        manager.initialize(key, price);
        manager.unlock(abi.encode(key, ModifyLiquidityParams(lower, upper, int256(uint256(liquidity)), 0)));
        require(token.transfer(msg.sender, token.balanceOf(address(this))));
    }

    function unlockCallback(bytes calldata data) external returns (bytes memory) {
        require(msg.sender == address(manager));
        (PoolKey memory key, ModifyLiquidityParams memory params) = abi.decode(data, (PoolKey, ModifyLiquidityParams));
        (BalanceDelta delta,) = manager.modifyLiquidity(key, params, "");
        require(delta.amount0() == 0, "seed must use zero ETH");
        require(delta.amount1() < 0, "seed must deposit CNDL");
        tokenSeeded = -delta.amount1();
        manager.sync(key.currency1);
        require(CNDL(Currency.unwrap(key.currency1)).transfer(address(manager), uint128(tokenSeeded)));
        manager.settle();
        return "";
    }
}
