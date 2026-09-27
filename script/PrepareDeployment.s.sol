// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {OHLCCandleHook} from "../src/OHLCCandleHook.sol";
import {IPoolManager} from "v4-core/src/interfaces/IPoolManager.sol";
import {HookFlags} from "../src/HookFlags.sol";

/// @notice Offline preparation only: no environment reads, broadcasts or wallet handling.
contract PrepareDeployment {
    address public constant SEPOLIA_POOL_MANAGER = 0xE03A1074c86CFeDd5C142C4F04F1a1536e203543;
    uint160 public constant FLAGS = 0x1040;

    error SaltNotFound();

    function creationCode(IPoolManager manager) public pure returns (bytes memory) {
        return abi.encodePacked(type(OHLCCandleHook).creationCode, abi.encode(manager));
    }

    /// @param deployer The address actually executing CREATE2 (normally the launch factory).
    /// @param manager Use SEPOLIA_POOL_MANAGER for the launch; a real local manager for rehearsal.
    /// @param start First salt candidate. May resume a previous bounded search.
    /// @param attempts Maximum candidates to test; must fit below uint256.max - start.
    function find(address deployer, IPoolManager manager, uint256 start, uint256 attempts)
        external
        pure
        returns (bytes32 salt, address predicted)
    {
        bytes32 codeHash = keccak256(creationCode(manager));
        uint256 end = start + attempts;
        for (uint256 i = start; i < end; ++i) {
            predicted =
                address(uint160(uint256(keccak256(abi.encodePacked(bytes1(0xff), deployer, bytes32(i), codeHash)))));
            if (HookFlags.matches(predicted, FLAGS)) return (bytes32(i), predicted);
        }
        revert SaltNotFound();
    }
}
