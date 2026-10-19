// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {BlackveilBank, IERC20} from "../src/BlackveilBank.sol";

interface IERC20Full is IERC20 {
    function approve(address, uint256) external returns (bool);
    function decimals() external view returns (uint8);
}

/// forge test --match-contract Fork --fork-url https://robinhood.drpc.org
/// Runs the whole account → agent → review flow against the real USDG on Robinhood Chain.
contract ForkTest is Test {
    IERC20Full constant USDG = IERC20Full(0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168);

    function test_fork_realUSDG() public {
        if (block.chainid != 4663) return; // only meaningful on a Robinhood Chain fork
        assertEq(USDG.decimals(), 6);
        address me = address(uint160(uint256(keccak256("blackveil.fork.me"))));
        address bot = address(uint160(uint256(keccak256("blackveil.fork.bot"))));
        address shop = address(uint160(uint256(keccak256("blackveil.fork.shop"))));
        BlackveilBank bank = new BlackveilBank(USDG, me, me);

        deal(address(USDG), me, 100e6);
        vm.startPrank(me);
        USDG.approve(address(bank), type(uint256).max);
        bank.setHandle("fork-test");
        bank.deposit(60e6);
        uint256 id = bank.createAgent(bot, 10e6, 25e6, 5e6, false);
        bank.fundAgent(id, 30e6);
        vm.stopPrank();

        vm.prank(bot);
        (BlackveilBank.Route r,) = bank.agentPay(id, shop, 4e6, bytes32("inv-1"), true);
        assertEq(uint8(r), uint8(BlackveilBank.Route.Settles));
        assertEq(USDG.balanceOf(shop), 4e6);

        vm.prank(bot);
        (r,) = bank.agentPay(id, shop, 11e6, 0, true);
        assertEq(uint8(r), uint8(BlackveilBank.Route.Refuses));

        vm.prank(bot);
        uint256 pid;
        (r, pid) = bank.agentPay(id, shop, 8e6, 0, true);
        assertEq(uint8(r), uint8(BlackveilBank.Route.Queues));
        vm.prank(me);
        bank.approve(pid);
        assertEq(USDG.balanceOf(shop), 12e6);

        vm.startPrank(me);
        bank.revokeAgent(id);
        bank.withdraw(bank.balanceOf(me), me);
        vm.stopPrank();
        bank.sweepFees();
        assertEq(USDG.balanceOf(address(bank)), 0);
        assertEq(USDG.balanceOf(me) + USDG.balanceOf(shop), 100e6);
    }
}
