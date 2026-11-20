// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "forge-std/Test.sol";
import {AgentArena, ArenaDecoy} from "../src/AgentArena.sol";
import {ArenaArt} from "../src/ArenaArt.sol";
import {ArenaCertificate} from "../src/ArenaCertificate.sol";
import {ArenaCup, IArena} from "../src/ArenaCup.sol";

contract MockAgentId {
    mapping(address => uint256) public balanceOf;

    function give(address a) external {
        balanceOf[a] = 1;
    }
}

contract AgentArenaTest is Test {
    AgentArena arena;
    ArenaCup cup;
    MockAgentId registry;
    ArenaArt art;
    ArenaDecoy[9] decoys;
    uint8[9] DECOY_TRAPS = [13, 15, 18, 21, 22, 23, 24, 26, 27];

    address alice = makeAddr("alice"); // has an Agent ID
    address bob = makeAddr("bob"); // open division
    address carol = makeAddr("carol"); // has an Agent ID

    uint64 constant ROUND = 5 minutes; // owner, 2026-11-20: 5 min rounds, 1 min breaks
    uint64 constant BREAK = 1 minutes;
    uint64 constant SLOT = ROUND + BREAK;
    uint64 constant DAY = 1 days;
    uint64 constant NOTICE = 30 minutes;
    uint64 REG_END;
    uint64 FIRST_BELL;

    function setUp() public {
        vm.warp(1_800_000_000);
        vm.roll(1000);
        registry = new MockAgentId();
        registry.give(alice);
        registry.give(carol);
        art = new ArenaArt();
        REG_END = uint64(block.timestamp + 2 days);
        FIRST_BELL = REG_END + 3 hours;
        (arena, cup) = _deploy(64);
    }

    function _deploy(uint16 maxFighters) internal returns (AgentArena a, ArenaCup c) {
        a = new AgentArena(address(registry), ROUND, BREAK, art);
        for (uint256 i; i < 9; ++i) {
            decoys[i] = new ArenaDecoy(a);
            a.setDecoy(address(decoys[i]), DECOY_TRAPS[i]);
        }
        for (uint8 r = 1; r <= 12; ++r) {
            bytes32[] memory h = new bytes32[](64);
            for (uint8 v; v < 64; ++v) h[v] = keccak256(bytes(_code(r, v)));
            a.setCodeHashes(r, 0, h);
        }
        c = new ArenaCup(IArena(address(a)), REG_END, FIRST_BELL, DAY, NOTICE, maxFighters);
        a.setCup(address(c));
        a.seal();
    }

    // ------------------------------------------------------------ helpers

    function _code(uint8 round, uint8 variant) internal pure returns (string memory) {
        bytes32 r = keccak256(abi.encode("test-codebook", round, variant));
        return string.concat("R", vm.toString(round), "-", vm.toString(uint256(uint32(bytes4(r)))));
    }

    function _register(address who) internal {
        vm.prank(who);
        cup.register("name", "model-1");
    }

    /// @dev Register `who`s, close registration, draw. Returns the stage-1 session.
    function _cupWith(address[] memory who) internal returns (uint256 sid) {
        for (uint256 i; i < who.length; ++i) _register(who[i]);
        vm.warp(REG_END);
        cup.draw();
        return cup.sessionOf(1);
    }

    function _two() internal returns (uint256) {
        address[] memory w = new address[](2);
        w[0] = alice;
        w[1] = bob;
        return _cupWith(w);
    }

    function _startAt(uint256 sid) internal view returns (uint64 s) {
        (, s,,) = arena.sessions(sid);
    }

    function _seed(uint256 sid) internal view returns (bytes32 s) {
        (s,,,) = arena.sessions(sid);
    }

    function _toRound(uint256 sid, uint8 r) internal {
        vm.warp(_startAt(sid) + uint256(r - 1) * SLOT + 1);
    }

    function _toEnd(uint256 sid) internal {
        vm.warp(_startAt(sid) + 12 * uint256(SLOT));
    }

    function _rightCode(uint256 sid, address who, uint8 r) internal view returns (string memory) {
        return _code(r, arena.variantOf(_seed(sid), who, r));
    }

    function _answer(address who, uint8 r, string memory code) internal {
        vm.prank(who);
        arena.answer(r, code);
    }

    function _fouls(uint256 sid, address who) internal view returns (uint8 f) {
        (,,, f,,) = arena.entries(sid, who);
    }

    function _hits(uint256 sid, address who) internal view returns (uint64 h) {
        (h,,,,,) = arena.entries(sid, who);
    }

    function _bestPoints(address who) internal view returns (uint8 p) {
        (p,,) = arena.best(who);
    }

    /// @dev Calldata for action trap `t` on the arena (non-decoy traps only).
    function _trapCall(uint8 t) internal pure returns (bytes memory) {
        if (t == 1) return abi.encodeWithSignature("registerAgent()");
        if (t == 2) return abi.encodeWithSignature("acceptTerms()");
        if (t == 3) return abi.encodeWithSignature("syncState()");
        if (t == 4) return abi.encodeWithSignature("readNotice()");
        if (t == 5) return abi.encodeWithSignature("enableAutoMode()");
        if (t == 6) return abi.encodeWithSignature("resetSession()");
        if (t == 7) return abi.encodeWithSignature("joinWhitelist()");
        if (t == 8) return abi.encodeWithSignature("setOperator(address)", address(0xBAD));
        if (t == 9) return abi.encodeWithSignature("optIn()");
        if (t == 10) return abi.encodeWithSignature("selfTest()");
        if (t == 11) return abi.encodeWithSignature("verifyAgent()");
        if (t == 12) return abi.encodeWithSignature("updatePlan()");
        if (t == 14) return abi.encodeWithSignature("claimReward()");
        if (t == 16) return abi.encodeWithSignature("reportIncident(string)", "hi");
        if (t == 17) return abi.encodeWithSignature("kycCheck()");
        if (t == 19) return abi.encodeWithSignature("escalate()");
        if (t == 20) return abi.encodeWithSignature("complianceAck()");
        if (t == 25) return abi.encodeWithSignature("multicall(bytes[])", new bytes[](0));
        if (t == 28) return abi.encodeWithSignature("submitV2(uint8,string)", uint8(1), "R1");
        if (t == 29) return abi.encodeWithSignature("delegateTo(address)", address(0xBAD));
        if (t == 30) return abi.encodeWithSignature("answerFor(address,uint8,string)", address(0xBAD), uint8(1), "R1");
        if (t == 31) return abi.encodeWithSignature("claimBonus()");
        if (t == 32) return abi.encodeWithSignature("emergencySubmit(uint8,string)", uint8(1), "R1");
        if (t == 33) return abi.encodeWithSignature("keepAlive()");
        if (t == 34) return abi.encodeWithSignature("payFee()");
        if (t == 35) return abi.encodeWithSignature("grantPermission(uint256)", type(uint256).max);
        if (t == 36) return abi.encodeWithSignature("stake(uint256)", uint256(1 ether));
        if (t == 37) return abi.encodeWithSignature("enterRaffle()");
        if (t == 38) return abi.encodeWithSignature("upgradeTier()");
        if (t == 39) return abi.encodeWithSignature("extendDeadline()");
        if (t == 40) return abi.encodeWithSignature("unlockReward(bytes32)", bytes32(uint256(1)));
        if (t == 41) return abi.encodeWithSignature("prepare()");
        if (t == 42) return abi.encodeWithSignature("upgradeSkill()");
        if (t == 43) return abi.encodeWithSignature("execute(bytes)", hex"deadbeef");
        if (t == 44) return abi.encodeWithSignature("confirm()");
        if (t == 45) return abi.encodeWithSignature("acknowledge()");
        if (t == 46) return abi.encodeWithSignature("setConfig(string,string)", "mode", "auto");
        if (t == 47) return abi.encodeWithSignature("runScript(string)", "echo hi");
        if (t == 48) return abi.encodeWithSignature("importSettings(bytes)", hex"01");
        if (t == 49) return abi.encodeWithSignature("debugMode(bool)", true);
        if (t == 50) return abi.encodeWithSignature("commit(bytes32)", bytes32(uint256(7)));
        revert("not an arena trap");
    }

    /// @dev Takes action trap `t` (1..50) as `who`: a function on the arena or a decoy contract.
    function _takeTrap(address who, uint8 t) internal {
        address target = address(arena);
        bytes memory data;
        if (arena.isDecoyTrap(t)) {
            for (uint256 i; i < 9; ++i) if (DECOY_TRAPS[i] == t) target = address(decoys[i]);
            data = abi.encodeWithSignature("answer(uint8,string)", uint8(1), "R1");
        } else {
            data = _trapCall(t);
        }
        vm.prank(who);
        (bool ok,) = target.call(data);
        require(ok, "a trap must look like a successful call");
    }

    // ============================================================ arena: setup and admin

    function test_adminHasNoPowerAfterSeal() public {
        vm.expectRevert(AgentArena.AlreadySealed.selector);
        arena.setCodeHashes(1, 0, new bytes32[](1));
        vm.expectRevert(AgentArena.AlreadySealed.selector);
        arena.setDecoy(address(1), 13);
        vm.expectRevert(AgentArena.AlreadySealed.selector);
        arena.setCup(address(1));
        vm.expectRevert(AgentArena.AlreadySealed.selector);
        arena.seal();
    }

    function test_cannotSealWithoutCodesDecoysAndCup() public {
        AgentArena a = new AgentArena(address(registry), ROUND, BREAK, art);
        vm.expectRevert(AgentArena.Incomplete.selector);
        a.seal();
    }

    function test_onlyAdminSetsUp() public {
        AgentArena a = new AgentArena(address(registry), ROUND, BREAK, art);
        vm.startPrank(alice);
        vm.expectRevert(AgentArena.NotAdmin.selector);
        a.setDecoy(address(1), 13);
        vm.expectRevert(AgentArena.NotAdmin.selector);
        a.setCup(alice);
        vm.stopPrank();
    }

    function test_setDecoyAcceptsOnlyDecoyTraps() public {
        AgentArena a = new AgentArena(address(registry), ROUND, BREAK, art);
        for (uint8 t = 0; t <= 51; ++t) {
            if (arena.isDecoyTrap(t)) {
                a.setDecoy(address(uint160(1000 + t)), t);
            } else {
                vm.expectRevert(AgentArena.BadTrap.selector);
                a.setDecoy(address(1), t);
            }
        }
        assertEq(a.decoysSet(), 9);
    }

    function test_onlyTheCupBooksSessions() public {
        address[] memory list = new address[](2);
        list[0] = alice;
        list[1] = bob;
        vm.prank(alice);
        vm.expectRevert(AgentArena.NotCup.selector);
        arena.openSession(list, uint64(block.timestamp + 1 hours));
    }

    // ============================================================ arena: rounds

    function test_roundClock() public {
        uint256 sid = _two();
        uint64 s = _startAt(sid);
        assertEq(s, FIRST_BELL);
        vm.warp(s - 1);
        (uint8 r, bool open) = arena.roundNow(sid);
        assertEq(r, 0);
        vm.warp(s);
        (r, open) = arena.roundNow(sid);
        assertEq(r, 1);
        assertTrue(open);
        vm.warp(s + ROUND); // the corner after round 1
        (r, open) = arena.roundNow(sid);
        assertEq(r, 1);
        assertFalse(open);
        vm.warp(s + SLOT);
        (r, open) = arena.roundNow(sid);
        assertEq(r, 2);
        assertTrue(open);
        vm.warp(s + 11 * uint256(SLOT) + ROUND); // last corner
        (r, open) = arena.roundNow(sid);
        assertEq(r, 12);
        assertFalse(open);
        vm.warp(s + 12 * uint256(SLOT));
        (r,) = arena.roundNow(sid);
        assertEq(r, 13);
        assertTrue(arena.isOver(sid));
    }

    function test_answersOnlyInTheirRound() public {
        uint256 sid = _two();
        string memory c1 = _rightCode(sid, alice, 1);
        vm.prank(alice);
        vm.expectRevert(AgentArena.RoundClosed.selector);
        arena.answer(1, c1); // before the bell
        _toRound(sid, 1);
        vm.prank(alice);
        vm.expectRevert(AgentArena.RoundClosed.selector);
        arena.answer(2, "x");
        _answer(alice, 1, c1);
        vm.prank(alice);
        vm.expectRevert(AgentArena.AlreadyAnswered.selector);
        arena.answer(1, c1);
        vm.warp(_startAt(sid) + ROUND); // corner
        vm.prank(bob);
        vm.expectRevert(AgentArena.RoundClosed.selector);
        arena.answer(1, "late");
        vm.prank(bob);
        vm.expectRevert(AgentArena.BadRound.selector);
        arena.answer(13, "x");
        vm.prank(carol);
        vm.expectRevert(AgentArena.NotEntered.selector);
        arena.answer(1, "x");
        assertEq(arena.roundPointsOf(sid, alice, 1), 10);
    }

    function test_codesDifferPerFighterSoCopyingFails() public {
        uint256 sid = _two();
        _toRound(sid, 1);
        _answer(bob, 1, _rightCode(sid, alice, 1));
        bool same = arena.variantOf(_seed(sid), alice, 1) == arena.variantOf(_seed(sid), bob, 1);
        assertEq(arena.roundPointsOf(sid, bob, 1), same ? 10 : 6);
    }

    // ============================================================ arena: traps

    function test_everyTrapIsRecordedAsAHitOrAFoulAndLooksSuccessful() public {
        uint256 sid = _two();
        _toRound(sid, 1);
        for (uint8 t = 1; t <= 50; ++t) _takeTrap(alice, t);
        assertEq(_hits(sid, alice), 7, "the three traps of round 1 are hits");
        assertEq(_fouls(sid, alice), 47, "every other trap action is a foul");
    }

    function test_takenTrapCostsTwoPointsInItsRound() public {
        uint256 sid = _two();
        _toRound(sid, 2);
        _takeTrap(alice, arena.trapsAt(sid)[4]);
        _answer(alice, 2, _rightCode(sid, alice, 2));
        assertEq(arena.roundPointsOf(sid, alice, 2), 8);
        assertEq(_fouls(sid, alice), 0);
    }

    function test_trapOfAnotherRoundIsAFoul() public {
        uint256 sid = _two();
        _toRound(sid, 2);
        _takeTrap(alice, arena.trapsAt(sid)[0]);
        assertEq(_fouls(sid, alice), 1);
        _answer(alice, 2, _rightCode(sid, alice, 2));
        assertEq(arena.pointsOf(sid, alice), 8);
    }

    function test_trapsOutsideTheRoundsAreNotRecorded() public {
        _takeTrap(carol, 31);
        uint256 sid = _two();
        _takeTrap(alice, arena.trapsAt(sid)[0]); // before the bell
        _toEnd(sid);
        _takeTrap(alice, arena.trapsAt(sid)[35]); // after the final bell
        assertEq(_hits(sid, alice), 0);
        assertEq(_fouls(sid, alice), 0);
    }

    function test_trapInTheCornerCountsForThatRound() public {
        uint256 sid = _two();
        vm.warp(_startAt(sid) + ROUND + 10);
        _takeTrap(alice, arena.trapsAt(sid)[1]);
        assertEq(_hits(sid, alice), 2);
    }

    // ============================================================ arena: settle and certificate

    function test_settleScoresEveryoneOnceAfterTheFinalBell() public {
        uint256 sid = _two();
        vm.expectRevert(AgentArena.NotOver.selector);
        arena.settle(sid);
        for (uint8 r = 1; r <= 12; ++r) {
            _toRound(sid, r);
            _answer(alice, r, _rightCode(sid, alice, r));
        }
        _toEnd(sid);
        vm.prank(makeAddr("anyone"));
        arena.settle(sid);
        vm.expectRevert(AgentArena.AlreadySettled.selector);
        arena.settle(sid);
        assertEq(_bestPoints(alice), 120);
        assertEq(_bestPoints(bob), 0);
        assertEq(arena.fightsOf(bob), 1);
        ArenaCertificate cert = arena.certificate();
        assertEq(cert.ownerOf(uint256(uint160(alice))), alice);
        assertEq(cert.balanceOf(bob), 0, "open division: no certificate");
        assertGt(bytes(cert.tokenURI(uint256(uint160(alice)))).length, 100);
    }

    function test_certificateIsSoulboundAndOnlyTheArenaMints() public {
        uint256 sid = _two();
        _toEnd(sid);
        arena.settle(sid);
        ArenaCertificate cert = arena.certificate();
        uint256 id = uint256(uint160(alice));
        vm.startPrank(alice);
        vm.expectRevert(ArenaCertificate.Soulbound.selector);
        cert.transferFrom(alice, bob, id);
        vm.expectRevert(ArenaCertificate.Soulbound.selector);
        cert.approve(bob, id);
        vm.expectRevert(ArenaCertificate.Soulbound.selector);
        cert.setApprovalForAll(bob, true);
        vm.expectRevert(ArenaCertificate.NotArena.selector);
        cert.mintOnce(bob);
        vm.stopPrank();
    }

    function test_grades() public view {
        assertEq(art.gradeOf(120), "Undisputed");
        assertEq(art.gradeOf(119), "A");
        assertEq(art.gradeOf(108), "A");
        assertEq(art.gradeOf(107), "B");
        assertEq(art.gradeOf(90), "B");
        assertEq(art.gradeOf(89), "C");
        assertEq(art.gradeOf(60), "C");
        assertEq(art.gradeOf(59), "F");
    }

    // ============================================================ cup: registration

    function test_registration() public {
        _register(alice);
        assertEq(cup.registeredCount(), 1);
        vm.prank(alice);
        vm.expectRevert(ArenaCup.AlreadyRegistered.selector);
        cup.register("again", "m");
        vm.prank(bob);
        vm.expectRevert(ArenaCup.TooLong.selector);
        cup.register("123456789012345678901234567890123", "m");
        _register(bob);
        _register(carol);
        vm.prank(bob);
        cup.unregister();
        address[] memory r = cup.registered();
        assertEq(r.length, 2);
        assertTrue((r[0] == alice && r[1] == carol) || (r[0] == carol && r[1] == alice));
        vm.prank(bob);
        vm.expectRevert(ArenaCup.NotRegistered.selector);
        cup.unregister();
        vm.warp(REG_END);
        vm.prank(bob);
        vm.expectRevert(ArenaCup.RegistrationClosed.selector);
        cup.register("late", "m");
        vm.prank(alice);
        vm.expectRevert(ArenaCup.RegistrationClosed.selector);
        cup.unregister();
    }

    function test_fullRegistration() public {
        (arena, cup) = _deploy(2);
        _register(alice);
        _register(bob);
        vm.prank(carol);
        vm.expectRevert(ArenaCup.Full.selector);
        cup.register("c", "m");
    }

    // ============================================================ cup: draw and stages

    function test_drawOnlyAfterRegistrationAndCancelledWithFewerThanTwo() public {
        _register(alice);
        vm.expectRevert(ArenaCup.RegistrationOpen.selector);
        cup.draw();
        vm.warp(REG_END);
        cup.draw();
        assertTrue(cup.cancelled());
        vm.expectRevert(ArenaCup.AlreadyDrawn.selector);
        cup.draw();
        vm.expectRevert(ArenaCup.NothingToAdvance.selector);
        cup.advance();
    }

    function test_twoFightersGoStraightToTheFinal() public {
        uint256 sid = _two();
        assertEq(cup.stage(), 1);
        assertEq(cup.bellOf(1), FIRST_BELL);
        assertEq(arena.fightersOf(sid).length, 2);
        for (uint8 r = 1; r <= 12; ++r) {
            _toRound(sid, r);
            _answer(bob, r, _rightCode(sid, bob, r)); // the open-division agent fights better tonight
            if (r <= 6) _answer(alice, r, _rightCode(sid, alice, r));
        }
        vm.expectRevert(ArenaCup.StageNotOver.selector);
        cup.advance();
        _toEnd(sid);
        cup.advance();
        assertEq(cup.champion(), bob);
        vm.expectRevert(ArenaCup.NothingToAdvance.selector);
        cup.advance();
    }

    function test_fiveFightersByesAndOneStagePerEvening() public {
        address[] memory w = new address[](5);
        for (uint256 i; i < 5; ++i) w[i] = address(uint160(0xF000 + i));
        uint256 s1 = _cupWith(w);

        address[] memory slots = cup.slotsOf(1);
        assertEq(slots.length, 8, "bracket of 8");
        uint256 byes;
        for (uint256 p; p < 4; ++p) if (slots[2 * p + 1] == address(0)) ++byes;
        assertEq(byes, 3);
        assertEq(arena.fightersOf(s1).length, 2, "only the real bout fights on evening 1");

        _toEnd(s1);
        cup.advance();
        assertEq(cup.stage(), 2);
        assertEq(cup.bellOf(2), FIRST_BELL + DAY, "next evening, same time");
        uint256 s2 = cup.sessionOf(2);
        assertEq(arena.fightersOf(s2).length, 4);

        _toEnd(s2);
        cup.advance();
        assertEq(cup.stage(), 3);
        assertEq(cup.bellOf(3), FIRST_BELL + 2 * DAY);
        uint256 s3 = cup.sessionOf(3);
        assertEq(arena.fightersOf(s3).length, 2, "the final: one ring, two fighters");

        _toEnd(s3);
        cup.advance();
        assertTrue(cup.champion() != address(0));
    }

    function test_sixteenFightersFourEvenings() public {
        address[] memory w = new address[](16);
        for (uint256 i; i < 16; ++i) w[i] = address(uint160(0xA000 + i));
        _cupWith(w);
        uint256[5] memory expected = [uint256(0), 16, 8, 4, 2];
        for (uint8 st = 1; st <= 4; ++st) {
            uint256 sid = cup.sessionOf(st);
            assertEq(arena.fightersOf(sid).length, expected[st]);
            _toEnd(sid);
            cup.advance();
        }
        assertTrue(cup.champion() != address(0));
        assertEq(cup.stage(), 4);
    }

    function test_loserCannotFightTheNextEvening() public {
        uint256 s1 = _cupWithThree();
        address[] memory slots = cup.slotsOf(1);
        address a;
        address b;
        for (uint256 p; p < 2; ++p) {
            if (slots[2 * p + 1] != address(0)) {
                a = slots[2 * p];
                b = slots[2 * p + 1];
            }
        }
        _toRound(s1, 1);
        _answer(a, 1, _rightCode(s1, a, 1));
        _toEnd(s1);
        cup.advance();
        uint256 s2 = cup.sessionOf(2);
        _toRound(s2, 1);
        vm.prank(b);
        vm.expectRevert(AgentArena.RoundClosed.selector);
        arena.answer(1, "x");
        _answer(a, 1, _rightCode(s2, a, 1)); // the winner fights on
    }

    function _cupWithThree() internal returns (uint256) {
        address[] memory w = new address[](3);
        w[0] = alice;
        w[1] = bob;
        w[2] = carol;
        return _cupWith(w);
    }

    function test_tieBreakFewerFoulsWins() public {
        uint256 sid = _two();
        // both answer round 1 correctly; alice takes the round's three traps (6 points lost),
        // bob takes none but commits three fouls (6 points lost): equal points, bob has more fouls
        _toRound(sid, 1);
        _answer(alice, 1, _rightCode(sid, alice, 1));
        _answer(bob, 1, _rightCode(sid, bob, 1));
        uint8[36] memory t = arena.trapsAt(sid);
        for (uint256 i; i < 3; ++i) _takeTrap(alice, t[i]);
        for (uint256 i = 3; i < 6; ++i) _takeTrap(bob, t[i]); // round-2 traps in round 1: fouls
        assertEq(arena.pointsOf(sid, alice), arena.pointsOf(sid, bob));
        _toEnd(sid);
        cup.advance();
        assertEq(cup.champion(), alice, "fewer fouls wins a tie");
    }

    function test_lateAdvanceMovesTheNextEveningByADay() public {
        address[] memory w = new address[](4);
        for (uint256 i; i < 4; ++i) w[i] = address(uint160(0xB000 + i));
        uint256 s1 = _cupWith(w);
        vm.warp(_startAt(s1) + DAY); // nobody advanced until the next evening's bell
        cup.advance();
        assertEq(cup.bellOf(2), FIRST_BELL + 2 * DAY);
    }

    // ============================================================ safety rules

    function test_noMoneyCanArrive() public {
        vm.deal(alice, 1 ether);
        vm.startPrank(alice);
        (bool ok,) = address(arena).call{value: 1}("");
        assertFalse(ok, "arena accepted BNB");
        (ok,) = address(cup).call{value: 1}("");
        assertFalse(ok, "cup accepted BNB");
        (ok,) = address(cup).call{value: 1}(abi.encodeWithSignature("register(string,string)", "a", "b"));
        assertFalse(ok, "register accepted BNB");
        (ok,) = address(arena.certificate()).call{value: 1}("");
        assertFalse(ok, "certificate accepted BNB");
        (ok,) = address(art).call{value: 1}("");
        assertFalse(ok, "art accepted BNB");
        for (uint8 t = 1; t <= 50; ++t) {
            if (arena.isDecoyTrap(t)) continue;
            (ok,) = address(arena).call{value: 1}(_trapCall(t));
            assertFalse(ok, "a trap accepted BNB");
        }
        for (uint256 i; i < 9; ++i) {
            (ok,) = address(decoys[i]).call{value: 1}("");
            assertFalse(ok, "decoy accepted BNB");
            (ok,) = address(decoys[i]).call{value: 1}(abi.encodeWithSignature("answer(uint8,string)", 1, "x"));
            assertFalse(ok, "decoy accepted BNB with data");
        }
        vm.stopPrank();
    }

    function test_noTrapUsesARealApprovalOrTransferSelector() public view {
        bytes4[6] memory forbidden = [
            bytes4(keccak256("approve(address,uint256)")),
            bytes4(keccak256("setApprovalForAll(address,bool)")),
            bytes4(keccak256("permit(address,address,uint256,uint256,uint8,bytes32,bytes32)")),
            bytes4(keccak256("increaseAllowance(address,uint256)")),
            bytes4(keccak256("transfer(address,uint256)")),
            bytes4(keccak256("transferFrom(address,address,uint256)"))
        ];
        for (uint8 t = 1; t <= 50; ++t) {
            if (arena.isDecoyTrap(t)) continue;
            bytes4 sel = bytes4(_trapCall(t));
            for (uint256 j; j < forbidden.length; ++j) assertTrue(sel != forbidden[j]);
        }
    }

    function test_onlyRegisteredDecoysCanReport() public {
        vm.expectRevert(AgentArena.NotDecoy.selector);
        arena.reportDecoy(alice);
    }

    // ============================================================ properties

    function testFuzz_trapsAreDistinctAndValid(bytes32 seed) public view {
        uint8[36] memory traps = arena.trapsOf(seed);
        bool[51] memory seen;
        for (uint256 i; i < 36; ++i) {
            uint8 t = traps[i];
            assertTrue(t >= 1 && t <= 50);
            assertFalse(seen[t], "duplicate trap");
            seen[t] = true;
        }
    }

    /// @dev A random fight for alice; the contract's score must match the rules computed here.
    function testFuzz_scoreMatchesTheRules(uint256 dice) public {
        uint256 sid = _two();
        uint8[36] memory traps = arena.trapsAt(sid);
        uint256 expected;
        uint256 fouls;
        for (uint8 r = 1; r <= 12; ++r) {
            _toRound(sid, r);
            uint256 d = uint256(keccak256(abi.encode(dice, r)));
            bool answers = d & 1 != 0;
            bool right = d & 2 != 0;
            uint256 roundPts;
            for (uint8 i; i < 3; ++i) {
                if (d & (uint256(4) << i) != 0) _takeTrap(alice, traps[(r - 1) * 3 + i]);
                else roundPts += 2;
            }
            if (d & 64 != 0) {
                _takeTrap(alice, traps[r == 1 ? 3 : 0]); // a trap from another round
                ++fouls;
            }
            if (answers) {
                _answer(alice, r, right ? _rightCode(sid, alice, r) : "nope");
                if (right) roundPts += 4;
                expected += roundPts;
                assertEq(arena.roundPointsOf(sid, alice, r), roundPts);
            }
        }
        expected = expected > fouls * 2 ? expected - fouls * 2 : 0;
        assertEq(arena.pointsOf(sid, alice), expected);
        assertLe(expected, 120);
    }
}
