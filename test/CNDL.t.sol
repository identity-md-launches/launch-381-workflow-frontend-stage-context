// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {CNDL} from "../src/CNDL.sol";
import {IERC20Errors} from "@openzeppelin/contracts/interfaces/draft-IERC6093.sol";

contract CNDLTest is Test {
    CNDL token;
    address constant ALICE = address(0xa11ce);
    address constant BOB = address(0xb0b);
    uint256 constant SUPPLY = 1_000_000_000 ether;

    function setUp() public {
        token = new CNDL();
    }

    function test_metadataAndWholeSupplyToDeployer() public view {
        assertEq(token.name(), "Candles");
        assertEq(token.symbol(), "CNDL");
        assertEq(token.decimals(), 18);
        assertEq(token.totalSupply(), SUPPLY);
        assertEq(token.balanceOf(address(this)), SUPPLY);
    }

    function testFuzz_exactTransfersConserveSupply(uint256 raw) public {
        uint256 amount = bound(raw, 0, SUPPLY);
        assertTrue(token.transfer(ALICE, amount));
        assertEq(token.balanceOf(ALICE), amount);
        assertEq(token.balanceOf(address(this)), SUPPLY - amount);
        vm.prank(ALICE);
        token.transfer(ALICE, amount);
        assertEq(token.balanceOf(ALICE), amount);
        assertEq(token.totalSupply(), SUPPLY);
    }

    function test_allowanceSpentAndInfiniteAllowancePreserved() public {
        token.approve(ALICE, 10 ether);
        vm.prank(ALICE);
        assertTrue(token.transferFrom(address(this), BOB, 4 ether));
        assertEq(token.allowance(address(this), ALICE), 6 ether);
        assertEq(token.balanceOf(BOB), 4 ether);
        token.approve(ALICE, type(uint256).max);
        vm.prank(ALICE);
        token.transferFrom(address(this), BOB, 4 ether);
        assertEq(token.allowance(address(this), ALICE), type(uint256).max);
        token.approve(ALICE, 0);
        vm.prank(ALICE);
        vm.expectRevert(abi.encodeWithSelector(IERC20Errors.ERC20InsufficientAllowance.selector, ALICE, 0, 1));
        token.transferFrom(address(this), BOB, 1);
    }

    function test_invalidTransfersRevertWithoutChangingSupply() public {
        vm.expectRevert(abi.encodeWithSelector(IERC20Errors.ERC20InvalidReceiver.selector, address(0)));
        token.transfer(address(0), 1);
        vm.prank(ALICE);
        vm.expectRevert(abi.encodeWithSelector(IERC20Errors.ERC20InsufficientBalance.selector, ALICE, 0, 1));
        token.transfer(BOB, 1);
        vm.expectRevert(abi.encodeWithSelector(IERC20Errors.ERC20InvalidSpender.selector, address(0)));
        token.approve(address(0), 1);
        assertEq(token.totalSupply(), SUPPLY);
    }

    function test_noMintOrAdministrationEvenForDeployer() public {
        string[12] memory signatures = [
            "mint(address,uint256)",
            "mint(uint256)",
            "mint()",
            "issue(uint256)",
            "setOwner(address)",
            "transferOwnership(address)",
            "upgradeTo(address)",
            "initialize(address)",
            "unpause()",
            "setMinter(address)",
            "burn(uint256)",
            "owner()"
        ];
        for (uint256 i; i < signatures.length; ++i) {
            bytes memory callData = abi.encodeWithSignature(signatures[i], ALICE, SUPPLY);
            (bool ok,) = address(token).call(callData);
            assertFalse(ok);
            vm.prank(ALICE);
            (ok,) = address(token).call(callData);
            assertFalse(ok);
        }
        assertEq(token.balanceOf(address(this)), SUPPLY);
        assertEq(token.totalSupply(), SUPPLY);
    }

    function test_runtimeHasNoEscapeHatch() public view {
        bytes memory code = address(token).code;
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
