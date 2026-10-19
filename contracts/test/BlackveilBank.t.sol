// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {BlackveilBank, IERC20} from "../src/BlackveilBank.sol";

contract MockToken {
    string public symbol;
    uint8 public decimals;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    constructor(string memory s, uint8 d) {
        symbol = s;
        decimals = d;
    }

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        return true;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        allowance[from][msg.sender] -= amount;
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        return true;
    }
}

contract BlackveilBankTest is Test {
    BlackveilBank bank;
    MockToken usdg;
    MockToken veil;

    address ownerA = makeAddr("owner");
    address treasury = makeAddr("treasury");
    address gwen = makeAddr("gwen");
    address atlas = makeAddr("atlas");
    address bot = makeAddr("bot");
    address shop = makeAddr("shop");

    uint256 constant U = 1e6;

    function setUp() public {
        usdg = new MockToken("USDG", 6);
        veil = new MockToken("VEIL", 18);
        bank = new BlackveilBank(IERC20(address(usdg)), ownerA, treasury);
        for (uint256 i; i < 3; ++i) {
            address who = [gwen, atlas, shop][i];
            usdg.mint(who, 10_000 * U);
            vm.prank(who);
            usdg.approve(address(bank), type(uint256).max);
        }
    }

    function _held() internal view returns (uint256) {
        return usdg.balanceOf(address(bank));
    }

    // ───────── account ─────────

    function test_depositWithdraw() public {
        vm.prank(gwen);
        bank.deposit(500 * U);
        assertEq(bank.balanceOf(gwen), 500 * U);
        vm.prank(gwen);
        bank.withdraw(200 * U, atlas);
        assertEq(bank.balanceOf(gwen), 300 * U);
        assertEq(usdg.balanceOf(atlas), 10_200 * U);
        vm.prank(gwen);
        vm.expectRevert(BlackveilBank.InsufficientBalance.selector);
        bank.withdraw(301 * U, gwen);
    }

    function test_payFeeOnPayer() public {
        vm.startPrank(gwen);
        bank.deposit(1000 * U);
        bank.pay(atlas, 100 * U, bytes32("inv-1"), false, false);
        vm.stopPrank();
        assertEq(bank.balanceOf(atlas), 100 * U);
        assertEq(bank.balanceOf(gwen), 1000 * U - 100 * U - 100_000); // 0.10 % of 100 = 0.1 USDG
        assertEq(bank.feesAccrued(), 100_000);
        assertEq(_held(), bank.balanceOf(gwen) + bank.balanceOf(atlas) + bank.feesAccrued());
    }

    function test_feeCap() public view {
        assertEq(bank.feeFor(1999 * U), 1_999_000);
        assertEq(bank.feeFor(5000 * U), 2 * U);
        assertEq(bank.feeFor(1), 0);
    }

    function test_payFromWalletToWallet() public {
        uint256 before = usdg.balanceOf(gwen);
        vm.prank(gwen);
        bank.pay(shop, 50 * U, 0, true, true);
        assertEq(usdg.balanceOf(gwen), before - 50 * U - 50_000);
        assertEq(usdg.balanceOf(shop), 10_050 * U);
        assertEq(_held(), bank.feesAccrued());
    }

    function test_sweepFees() public {
        vm.prank(gwen);
        bank.pay(shop, 2000 * U, 0, true, false);
        bank.sweepFees();
        assertEq(usdg.balanceOf(treasury), 2 * U);
        assertEq(bank.feesAccrued(), 0);
    }

    // ───────── handles ─────────

    function test_handles() public {
        vm.prank(gwen);
        bank.setHandle("gwen-x");
        assertEq(bank.resolve("gwen-x"), gwen);
        vm.prank(atlas);
        vm.expectRevert(BlackveilBank.HandleTaken.selector);
        bank.setHandle("gwen-x");
        vm.prank(gwen);
        bank.setHandle("gwen-y");
        assertEq(bank.resolve("gwen-x"), address(0));
        assertEq(bank.handleOf(gwen), "gwen-y");
        vm.prank(atlas);
        bank.setHandle("gwen-x");
        assertEq(bank.resolve("gwen-x"), atlas);

        vm.prank(gwen);
        bank.deposit(10 * U);
        vm.prank(gwen);
        bank.payHandle("gwen-x", 1 * U, 0, false, false);
        assertEq(bank.balanceOf(atlas), 1 * U);
    }

    function test_badHandles() public {
        string[6] memory bad = ["ab", "Gwen", "-gwen", "gwen-", "gw en", "abcdefghijklmnopqrstu"];
        for (uint256 i; i < bad.length; ++i) {
            vm.prank(gwen);
            vm.expectRevert(BlackveilBank.BadHandle.selector);
            bank.setHandle(bad[i]);
        }
    }

    function test_shortHandleNeedsCharter() public {
        vm.prank(gwen);
        vm.expectRevert(BlackveilBank.CharterRequired.selector);
        bank.setHandle("gwn");
        vm.prank(gwen);
        vm.expectRevert(BlackveilBank.CharterRequired.selector);
        bank.setHandle("gwen");
        _charter(gwen);
        vm.prank(gwen);
        bank.setHandle("gwen");
        assertEq(bank.resolve("gwen"), gwen);
    }

    function _charter(address who) internal {
        if (address(bank.charterToken()) == address(0)) {
            vm.startPrank(ownerA);
            bank.setCharterToken(IERC20(address(veil)));
            bank.setCharterMin(1_000_000e18);
            vm.stopPrank();
        }
        veil.mint(who, 1_000_000e18);
    }

    // ───────── agents ─────────

    function _agentFor(address who, uint256 perPayment, uint256 perDay, uint256 review) internal returns (uint256 id) {
        vm.startPrank(who);
        bank.deposit(1000 * U);
        id = bank.createAgent(bot, perPayment, perDay, review, false);
        bank.fundAgent(id, 300 * U);
        vm.stopPrank();
    }

    function test_agentSettlesInsideMandate() public {
        uint256 id = _agentFor(gwen, 50 * U, 200 * U, 20 * U);
        vm.prank(bot);
        (BlackveilBank.Route r,) = bank.agentPay(id, shop, 15 * U, bytes32("inv-7"), false);
        assertEq(uint8(r), uint8(BlackveilBank.Route.Settles));
        assertEq(bank.balanceOf(shop), 15 * U);
        BlackveilBank.Agent memory a = bank.agent(id);
        assertEq(a.vault, 300 * U - 15 * U - 15_000);
        assertEq(a.spent, 15 * U);
    }

    function test_agentQueuesAboveReview() public {
        uint256 id = _agentFor(gwen, 50 * U, 200 * U, 20 * U);
        vm.prank(bot);
        (BlackveilBank.Route r, uint256 pid) = bank.agentPay(id, shop, 35 * U, 0, false);
        assertEq(uint8(r), uint8(BlackveilBank.Route.Queues));
        assertEq(bank.balanceOf(shop), 0);
        assertEq(bank.agent(id).vault, 300 * U - 35 * U - 35_000); // reserved

        vm.prank(atlas);
        vm.expectRevert(BlackveilBank.NotAgentOwner.selector);
        bank.approve(pid);

        vm.prank(gwen);
        bank.approve(pid);
        assertEq(bank.balanceOf(shop), 35 * U);
        vm.prank(gwen);
        vm.expectRevert(BlackveilBank.NotOpen.selector);
        bank.approve(pid);
    }

    function test_agentRejectRefundsVault() public {
        uint256 id = _agentFor(gwen, 50 * U, 200 * U, 20 * U);
        vm.prank(bot);
        (, uint256 pid) = bank.agentPay(id, shop, 30 * U, 0, false);
        vm.prank(gwen);
        bank.reject(pid);
        assertEq(bank.agent(id).vault, 300 * U);
    }

    function test_agentRefusals() public {
        uint256 id = _agentFor(gwen, 50 * U, 60 * U, 50 * U);
        BlackveilBank.Reason why;
        BlackveilBank.Route r;

        (r, why) = bank.routeFor(id, shop, 51 * U);
        assertEq(uint8(why), uint8(BlackveilBank.Reason.OverPerPayment));

        vm.prank(bot);
        bank.agentPay(id, shop, 40 * U, 0, false);
        (r, why) = bank.routeFor(id, shop, 30 * U);
        assertEq(uint8(why), uint8(BlackveilBank.Reason.OverDaily));

        // refusal is recorded and moves nothing
        uint256 vaultBefore = bank.agent(id).vault;
        vm.prank(bot);
        (r,) = bank.agentPay(id, shop, 30 * U, 0, false);
        assertEq(uint8(r), uint8(BlackveilBank.Route.Refuses));
        assertEq(bank.agent(id).vault, vaultBefore);

        // the window rolls over after 24 h
        vm.warp(block.timestamp + 1 days);
        (r,) = bank.routeFor(id, shop, 30 * U);
        assertEq(uint8(r), uint8(BlackveilBank.Route.Settles));

        vm.prank(gwen);
        bank.pauseAgent(id, true);
        (r, why) = bank.routeFor(id, shop, 1 * U);
        assertEq(uint8(why), uint8(BlackveilBank.Reason.Paused));

        vm.prank(gwen);
        bank.pauseAgent(id, false);
        vm.prank(gwen);
        bank.setMandate(id, 50 * U, 60 * U, 50 * U, true);
        (r, why) = bank.routeFor(id, shop, 1 * U);
        assertEq(uint8(why), uint8(BlackveilBank.Reason.NotAllowlisted));
        vm.prank(gwen);
        bank.setAllowed(id, shop, true);
        (r,) = bank.routeFor(id, shop, 1 * U);
        assertEq(uint8(r), uint8(BlackveilBank.Route.Settles));

        (r, why) = bank.routeFor(id, shop, 0);
        assertEq(uint8(why), uint8(BlackveilBank.Reason.ZeroAmount));
    }

    function test_agentCannotOverdrawVault() public {
        vm.startPrank(gwen);
        bank.deposit(100 * U);
        uint256 id = bank.createAgent(bot, 50 * U, 500 * U, 50 * U, false);
        bank.fundAgent(id, 20 * U);
        vm.stopPrank();
        (, BlackveilBank.Reason why) = bank.routeFor(id, shop, 20 * U); // + fee > vault
        assertEq(uint8(why), uint8(BlackveilBank.Reason.InsufficientVault));
    }

    function test_onlySignerSpends() public {
        uint256 id = _agentFor(gwen, 50 * U, 200 * U, 20 * U);
        vm.prank(gwen);
        vm.expectRevert(BlackveilBank.NotSigner.selector);
        bank.agentPay(id, shop, 1 * U, 0, false);

        address bot2 = makeAddr("bot2");
        vm.prank(bot);
        vm.expectRevert(BlackveilBank.NotAgentOwner.selector);
        bank.rotateSigner(id, bot2);
        vm.prank(bot);
        vm.expectRevert(BlackveilBank.NotAgentOwner.selector);
        bank.setMandate(id, 1e30, 1e30, 1e30, false);
        vm.prank(bot);
        vm.expectRevert(BlackveilBank.NotAgentOwner.selector);
        bank.defundAgent(id, 1);

        vm.prank(gwen);
        bank.rotateSigner(id, bot2);
        vm.prank(bot);
        vm.expectRevert(BlackveilBank.NotSigner.selector);
        bank.agentPay(id, shop, 1 * U, 0, false);
        vm.prank(bot2);
        bank.agentPay(id, shop, 1 * U, 0, false);
        assertEq(bank.balanceOf(shop), 1 * U);
    }

    function test_revokeReturnsVaultAndSlot() public {
        uint256 id = _agentFor(gwen, 50 * U, 200 * U, 20 * U);
        vm.prank(bot);
        (, uint256 pid) = bank.agentPay(id, shop, 30 * U, 0, false); // queued, reserved
        vm.prank(gwen);
        vm.expectRevert(BlackveilBank.NoSlot.selector);
        bank.createAgent(bot, 1, 1, 1, false);

        vm.prank(gwen);
        bank.revokeAgent(id);
        assertEq(bank.balanceOf(gwen), 700 * U + 300 * U - 30 * U - 30_000);
        (, BlackveilBank.Reason why) = bank.routeFor(id, shop, 1 * U);
        assertEq(uint8(why), uint8(BlackveilBank.Reason.Revoked));
        vm.prank(gwen);
        vm.expectRevert(BlackveilBank.AgentNotLive.selector);
        bank.fundAgent(id, 1 * U);

        vm.prank(gwen);
        bank.reject(pid);
        assertEq(bank.balanceOf(gwen), 1000 * U);

        vm.prank(gwen);
        bank.createAgent(bot, 1, 1, 1, false); // slot is free again
    }

    function test_charterSlots() public {
        vm.startPrank(gwen);
        bank.createAgent(bot, 1, 1, 1, false);
        vm.expectRevert(BlackveilBank.NoSlot.selector);
        bank.createAgent(bot, 1, 1, 1, false);
        vm.stopPrank();
        _charter(gwen);
        vm.startPrank(gwen);
        for (uint256 i = 1; i < 10; ++i) bank.createAgent(bot, 1, 1, 1, false);
        vm.expectRevert(BlackveilBank.NoSlot.selector);
        bank.createAgent(bot, 1, 1, 1, false);
        vm.stopPrank();
        assertEq(bank.agentsOf(gwen).length, 10);
    }

    // ───────── requests ─────────

    function test_requests() public {
        vm.prank(atlas);
        uint256 id = bank.createRequest(25 * U, uint64(block.timestamp + 1 hours), bytes32("dinner"));
        vm.prank(gwen);
        bank.payRequest(id, true);
        assertEq(bank.balanceOf(atlas), 25 * U);
        vm.prank(gwen);
        vm.expectRevert(BlackveilBank.NotOpen.selector);
        bank.payRequest(id, true);

        vm.prank(atlas);
        uint256 id2 = bank.createRequest(5 * U, uint64(block.timestamp + 1 hours), 0);
        vm.warp(block.timestamp + 2 hours);
        vm.prank(gwen);
        vm.expectRevert(BlackveilBank.Expired.selector);
        bank.payRequest(id2, true);

        vm.prank(atlas);
        uint256 id3 = bank.createRequest(5 * U, 0, 0);
        vm.prank(gwen);
        vm.expectRevert(BlackveilBank.NotOwner.selector);
        bank.cancelRequest(id3);
        vm.prank(atlas);
        bank.cancelRequest(id3);
        vm.prank(gwen);
        vm.expectRevert(BlackveilBank.NotOpen.selector);
        bank.payRequest(id3, true);
    }

    // ───────── owner ─────────

    function test_ownerPowersAreNarrow() public {
        vm.prank(gwen);
        vm.expectRevert(BlackveilBank.NotOwner.selector);
        bank.setFeeRecipient(gwen);
        vm.startPrank(ownerA);
        bank.setCharterToken(IERC20(address(veil)));
        vm.expectRevert(BlackveilBank.AlreadySet.selector);
        bank.setCharterToken(IERC20(address(usdg)));
        bank.transferOwnership(atlas);
        vm.expectRevert(BlackveilBank.NotOwner.selector);
        bank.setCharterMin(1);
        vm.stopPrank();
    }

    // ───────── accounting ─────────

    function testFuzz_heldEqualsLiabilities(uint96 a1, uint96 a2, uint96 a3) public {
        uint256 x = bound(a1, 1, 900 * U);
        uint256 y = bound(a2, 1, 40 * U);
        uint256 z = bound(a3, 1, 40 * U);
        uint256 id = _agentFor(gwen, 50 * U, 200 * U, 20 * U);
        vm.prank(gwen);
        bank.pay(atlas, x > 690 * U ? 690 * U : x, 0, false, false);
        uint256[2] memory pids;
        vm.prank(bot);
        (, pids[0]) = bank.agentPay(id, shop, y, 0, false);
        vm.prank(bot);
        (, pids[1]) = bank.agentPay(id, shop, z, 0, true);
        uint256 reserved;
        for (uint256 i; i < 2; ++i) {
            if (pids[i] == 0) continue;
            BlackveilBank.Pending memory p = bank.pending(pids[i]);
            reserved += p.amount + p.fee;
        }
        assertEq(
            _held(),
            bank.balanceOf(gwen) + bank.balanceOf(atlas) + bank.balanceOf(shop) + bank.agent(id).vault
                + bank.feesAccrued() + reserved
        );
        for (uint256 i; i < 2; ++i) {
            if (pids[i] == 0) continue;
            vm.prank(gwen);
            if (i == 0) bank.approve(pids[i]);
            else bank.reject(pids[i]);
        }
        assertEq(
            _held(),
            bank.balanceOf(gwen) + bank.balanceOf(atlas) + bank.balanceOf(shop) + bank.agent(id).vault + bank.feesAccrued()
        );
    }
}
