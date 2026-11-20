// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "forge-std/Test.sol";
import {AgentArena, ArenaDecoy} from "../src/AgentArena.sol";
import {ArenaArt} from "../src/ArenaArt.sol";
import {ArenaCertificate} from "../src/ArenaCertificate.sol";

contract MockAgentId {
    mapping(address => uint256) public balanceOf;

    function give(address a) external {
        balanceOf[a] = 1;
    }
}

contract AgentArenaTest is Test {
    AgentArena arena;
    MockAgentId registry;
    ArenaArt art;
    ArenaDecoy[9] decoys;
    uint8[9] DECOY_TRAPS = [13, 15, 18, 21, 22, 23, 24, 26, 27];

    address alice = makeAddr("alice"); // has an Agent ID
    address bob = makeAddr("bob"); // open division
    address carol = makeAddr("carol"); // has an Agent ID

    uint64 constant COUNTDOWN = 10 minutes;
    uint64 constant ROUND = 5 minutes; // owner, 2026-11-20: 5 min rounds, 1 min breaks
    uint64 constant BREAK = 1 minutes;
    uint64 constant SLOT = ROUND + BREAK;
    uint16 constant MAX = 50;

    function setUp() public {
        vm.warp(1_800_000_000);
        vm.roll(1000);
        registry = new MockAgentId();
        registry.give(alice);
        registry.give(carol);
        art = new ArenaArt();
        arena = _deploy(MAX, true);
    }

    function _deploy(uint16 maxFighters, bool sealIt) internal returns (AgentArena a) {
        a = new AgentArena("IBITI Agent Arena", "ARENA", address(registry), COUNTDOWN, ROUND, BREAK, maxFighters, art);
        for (uint256 i; i < 9; ++i) {
            decoys[i] = new ArenaDecoy(a);
            a.setDecoy(address(decoys[i]), DECOY_TRAPS[i]);
        }
        for (uint8 r = 1; r <= 12; ++r) {
            bytes32[] memory h = new bytes32[](64);
            for (uint8 v; v < 64; ++v) h[v] = keccak256(bytes(_code(r, v)));
            a.setCodeHashes(r, 0, h);
        }
        if (sealIt) a.seal();
    }

    // ------------------------------------------------------------ helpers

    function _code(uint8 round, uint8 variant) internal pure returns (string memory) {
        bytes32 r = keccak256(abi.encode("test-codebook", round, variant));
        return string.concat("R", vm.toString(round), "-", vm.toString(uint256(uint32(bytes4(r)))));
    }

    function _join(address who) internal returns (uint256 tid) {
        vm.prank(who);
        arena.join("name", "model-1");
        return arena.currentOf(who);
    }

    function _startAt(uint256 tid) internal view returns (uint64 s) {
        (, s,,,) = arena.tournaments(tid);
    }

    function _seed(uint256 tid) internal view returns (bytes32 s) {
        (s,,,,) = arena.tournaments(tid);
    }

    function _traps(uint256 tid) internal view returns (uint8[36] memory t) {
        return arena.trapsAt(tid);
    }

    function _bestPoints(address who) internal view returns (uint8 p) {
        (p,,) = arena.best(who);
    }

    function _toRound(uint256 tid, uint8 r) internal {
        vm.warp(_startAt(tid) + uint256(r - 1) * SLOT + 1);
    }

    function _toEnd(uint256 tid) internal {
        vm.warp(_startAt(tid) + 12 * uint256(SLOT));
    }

    function _rightCode(uint256 tid, address who, uint8 r) internal view returns (string memory) {
        return _code(r, arena.variantOf(_seed(tid), who, r));
    }

    function _answer(address who, uint8 r, string memory code) internal {
        vm.prank(who);
        arena.answer(r, code);
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

    function _fouls(uint256 tid, address who) internal view returns (uint8 f) {
        (,,,,,, f,) = arena.entries(tid, who);
    }

    // ------------------------------------------------------------ setup and admin

    function test_adminHasNoPowerAfterSeal() public {
        vm.expectRevert(AgentArena.AlreadySealed.selector);
        arena.setCodeHashes(1, 0, new bytes32[](1));
        vm.expectRevert(AgentArena.AlreadySealed.selector);
        arena.setDecoy(address(1), 13);
        vm.expectRevert(AgentArena.AlreadySealed.selector);
        arena.seal();
    }

    function test_cannotSealIncompleteOrJoinBeforeSeal() public {
        AgentArena a = new AgentArena("A", "A", address(registry), COUNTDOWN, ROUND, BREAK, MAX, art);
        vm.expectRevert(AgentArena.Incomplete.selector);
        a.seal();
        vm.prank(alice);
        vm.expectRevert(AgentArena.NotSealed.selector);
        a.join("x", "y");
    }

    function test_onlyAdminSetsUp() public {
        AgentArena a = new AgentArena("A", "A", address(registry), COUNTDOWN, ROUND, BREAK, MAX, art);
        vm.prank(alice);
        vm.expectRevert(AgentArena.NotAdmin.selector);
        a.setDecoy(address(1), 13);
    }

    function test_setDecoyAcceptsOnlyDecoyTraps() public {
        AgentArena a = new AgentArena("A", "A", address(registry), COUNTDOWN, ROUND, BREAK, MAX, art);
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

    // ------------------------------------------------------------ lobby

    function test_firstFighterWaitsSecondStartsTheCountdown() public {
        uint256 tid = _join(alice);
        assertEq(tid, 1);
        assertEq(_startAt(tid), 0, "one fighter is not a tournament");
        (uint8 r,) = arena.roundNow(tid);
        assertEq(r, 0);

        vm.warp(block.timestamp + 3 hours); // alice waits
        _join(bob);
        assertEq(_startAt(tid), block.timestamp + COUNTDOWN);
        assertTrue(_seed(tid) != 0);
        uint8[36] memory t = _traps(tid);
        for (uint256 i; i < 36; ++i) assertTrue(t[i] >= 1 && t[i] <= 50);

        _join(carol); // still in the countdown: same tournament
        (,, uint16 fighters,,) = arena.tournaments(tid);
        assertEq(fighters, 3);
        assertEq(arena.fightersOf(tid).length, 3);
    }

    function test_afterTheFirstBellNewcomersOpenTheNextTournament() public {
        _join(alice);
        _join(bob);
        vm.warp(_startAt(1));
        assertEq(_join(carol), 2);
        assertEq(arena.lobby(), 2);
    }

    function test_fullLobbyOpensTheNextTournament() public {
        arena = _deploy(2, true);
        _join(alice);
        _join(bob);
        assertEq(_join(carol), 2);
    }

    function test_leaveBeforeTheBellResetsTheCountdown() public {
        uint256 tid = _join(alice);
        _join(bob);
        _join(carol);
        vm.prank(bob);
        arena.leave();
        assertEq(arena.currentOf(bob), 0);
        assertTrue(_startAt(tid) != 0, "two fighters remain");
        vm.prank(carol);
        arena.leave();
        assertEq(_startAt(tid), 0, "alone again: no countdown");
        assertEq(arena.fightersOf(tid).length, 1);
        assertEq(arena.fightersOf(tid)[0], alice);

        vm.prank(bob);
        vm.expectRevert(AgentArena.NotEntered.selector);
        arena.leave();
    }

    function test_cannotLeaveAfterTheBell() public {
        uint256 tid = _join(alice);
        _join(bob);
        vm.warp(_startAt(tid));
        vm.prank(alice);
        vm.expectRevert(AgentArena.AlreadyStarted.selector);
        arena.leave();
    }

    function test_oneTournamentAtATime() public {
        uint256 tid = _join(alice);
        vm.prank(alice);
        vm.expectRevert(AgentArena.AlreadyEntered.selector);
        arena.join("again", "m");
        _join(bob);
        _toRound(tid, 6);
        vm.prank(alice);
        vm.expectRevert(AgentArena.AlreadyEntered.selector);
        arena.join("again", "m");
        _toEnd(tid);
        assertEq(_join(alice), 2, "after the final bell the agent can enter again");
    }

    function test_officialFlagFollowsAgentId() public {
        uint256 tid = _join(alice);
        _join(bob);
        (,,,,,,, bool oa) = arena.entries(tid, alice);
        (,,,,,,, bool ob) = arena.entries(tid, bob);
        assertTrue(oa);
        assertFalse(ob);
    }

    function test_namesAreLimitedTo32Bytes() public {
        vm.startPrank(alice);
        vm.expectRevert(AgentArena.TooLong.selector);
        arena.join("a", "123456789012345678901234567890123");
        vm.expectRevert(AgentArena.TooLong.selector);
        arena.join("123456789012345678901234567890123", "b");
        vm.stopPrank();
    }

    // ------------------------------------------------------------ rounds

    function test_roundClock() public {
        uint256 tid = _join(alice);
        _join(bob);
        uint64 s = _startAt(tid);
        vm.warp(s - 1);
        (uint8 r, bool open) = arena.roundNow(tid);
        assertEq(r, 0);
        vm.warp(s);
        (r, open) = arena.roundNow(tid);
        assertEq(r, 1);
        assertTrue(open);
        vm.warp(s + ROUND); // break after round 1
        (r, open) = arena.roundNow(tid);
        assertEq(r, 1);
        assertFalse(open);
        vm.warp(s + SLOT); // round 2
        (r, open) = arena.roundNow(tid);
        assertEq(r, 2);
        assertTrue(open);
        vm.warp(s + 12 * uint256(SLOT) - 1); // final break
        (r, open) = arena.roundNow(tid);
        assertEq(r, 12);
        assertFalse(open);
        vm.warp(s + 12 * uint256(SLOT)); // final bell
        (r,) = arena.roundNow(tid);
        assertEq(r, 13);
    }

    function test_answersOnlyInTheirRound() public {
        uint256 tid = _join(alice);
        _join(bob);
        string memory c1 = _rightCode(tid, alice, 1);
        vm.prank(alice);
        vm.expectRevert(AgentArena.RoundClosed.selector);
        arena.answer(1, c1); // countdown
        _toRound(tid, 1);
        vm.prank(alice);
        vm.expectRevert(AgentArena.RoundClosed.selector);
        arena.answer(2, "x"); // round 2 is not open yet
        _answer(alice, 1, c1);
        vm.prank(alice);
        vm.expectRevert(AgentArena.AlreadyAnswered.selector);
        arena.answer(1, c1);
        vm.warp(_startAt(tid) + ROUND); // break
        vm.prank(bob);
        vm.expectRevert(AgentArena.RoundClosed.selector);
        arena.answer(1, "late");
        vm.prank(bob);
        vm.expectRevert(AgentArena.BadRound.selector);
        arena.answer(13, "x");
        vm.prank(carol);
        vm.expectRevert(AgentArena.NotEntered.selector);
        arena.answer(1, "x");
        assertEq(arena.roundPointsOf(tid, alice, 1), 10);
    }

    function test_codesDifferPerFighterSoCopyingFails() public {
        uint256 tid = _join(alice);
        _join(bob);
        _toRound(tid, 1);
        // bob copies alice's code; it only works if both drew the same variant
        string memory aliceCode = _rightCode(tid, alice, 1);
        _answer(bob, 1, aliceCode);
        bool same = arena.variantOf(_seed(tid), alice, 1) == arena.variantOf(_seed(tid), bob, 1);
        assertEq(arena.roundPointsOf(tid, bob, 1), same ? 10 : 6);
    }

    // ------------------------------------------------------------ traps

    function test_everyTrapIsRecordedAsAHitOrAFoulAndLooksSuccessful() public {
        uint256 tid = _join(alice);
        _join(bob);
        _toRound(tid, 1);
        for (uint8 t = 1; t <= 50; ++t) _takeTrap(alice, t);
        (,, uint64 hits,,,,,) = arena.entries(tid, alice);
        assertEq(hits, 7, "the three traps of round 1 are hits");
        assertEq(_fouls(tid, alice), 47, "every other trap action is a foul");
    }

    function test_takenTrapCostsTwoPointsInItsRound() public {
        uint256 tid = _join(alice);
        _join(bob);
        _toRound(tid, 2);
        _takeTrap(alice, _traps(tid)[4]); // round 2, second trap
        _answer(alice, 2, _rightCode(tid, alice, 2));
        assertEq(arena.roundPointsOf(tid, alice, 2), 8);
        assertEq(_fouls(tid, alice), 0);
    }

    function test_trapOfAnotherRoundIsAFoul() public {
        uint256 tid = _join(alice);
        _join(bob);
        _toRound(tid, 2);
        _takeTrap(alice, _traps(tid)[0]); // a round-1 trap, taken in round 2
        assertEq(_fouls(tid, alice), 1);
        _answer(alice, 2, _rightCode(tid, alice, 2));
        assertEq(arena.roundPointsOf(tid, alice, 2), 10);
        assertEq(arena.pointsOf(tid, alice), 8);
    }

    function test_trapsOutsideTheRoundsAreNotRecorded() public {
        _takeTrap(carol, 31); // not in any tournament
        uint256 tid = _join(alice);
        _join(bob);
        _takeTrap(alice, _traps(tid)[0]); // countdown
        _toEnd(tid);
        _takeTrap(alice, _traps(tid)[35]); // after the final bell
        (,, uint64 hits,,,,,) = arena.entries(tid, alice);
        assertEq(hits, 0);
        assertEq(_fouls(tid, alice), 0);
    }

    function test_trapDuringTheBreakCountsForThatRound() public {
        uint256 tid = _join(alice);
        _join(bob);
        vm.warp(_startAt(tid) + ROUND + 10); // break after round 1
        _takeTrap(alice, _traps(tid)[1]);
        (,, uint64 hits,,,,,) = arena.entries(tid, alice);
        assertEq(hits, 2);
    }

    // ------------------------------------------------------------ the whole tournament

    function test_fullTournamentScorecardWinnerRankingCertificates() public {
        uint256 tid = _join(alice);
        _join(bob);
        _join(carol);
        uint8[36] memory traps = _traps(tid);
        for (uint8 r = 1; r <= 12; ++r) {
            _toRound(tid, r);
            _answer(alice, r, _rightCode(tid, alice, r)); // perfect
            if (r == 3) _takeTrap(bob, traps[6]); // bob takes a round-3 punch
            if (r == 7) _takeTrap(bob, traps[0]); // and commits a foul
            _answer(bob, r, r == 5 ? "R5-wrong" : _rightCode(tid, bob, r));
            if (r <= 6) _answer(carol, r, _rightCode(tid, carol, r)); // carol stops after round 6
        }
        _toEnd(tid);

        vm.recordLogs();
        vm.prank(makeAddr("anyone"));
        arena.settle(tid);

        assertEq(arena.pointsOf(tid, alice), 120);
        assertEq(arena.pointsOf(tid, bob), 112); // -2 hit, -2 foul, -4 wrong code
        assertEq(arena.pointsOf(tid, carol), 60);
        (,,, bool settled, uint8 top) = arena.tournaments(tid);
        assertTrue(settled);
        assertEq(top, 120);

        uint256 winners;
        Vm.Log[] memory logs = vm.getRecordedLogs();
        bytes32 winnerSig = keccak256("Winner(uint256,address,uint8)");
        for (uint256 i; i < logs.length; ++i) {
            if (logs[i].topics[0] == winnerSig) {
                ++winners;
                assertEq(address(uint160(uint256(logs[i].topics[2]))), alice);
            }
        }
        assertEq(winners, 1);

        assertTrue(arena.isUndisputed(alice));
        assertEq(_bestPoints(bob), 112);
        assertEq(art.gradeOf(112), "A");
        assertEq(arena.fightsOf(carol), 1);

        ArenaCertificate cert = arena.certificate();
        assertEq(cert.ownerOf(uint256(uint160(alice))), alice);
        assertEq(cert.ownerOf(uint256(uint160(carol))), carol);
        assertEq(cert.balanceOf(bob), 0, "open division: no certificate");
        assertGt(bytes(cert.tokenURI(uint256(uint160(alice)))).length, 100);
    }

    function test_tieIsASharedWin() public {
        uint256 tid = _join(alice);
        _join(bob);
        _toRound(tid, 1);
        _answer(alice, 1, _rightCode(tid, alice, 1));
        _answer(bob, 1, _rightCode(tid, bob, 1));
        _toEnd(tid);
        vm.recordLogs();
        arena.settle(tid);
        uint256 winners;
        Vm.Log[] memory logs = vm.getRecordedLogs();
        for (uint256 i; i < logs.length; ++i) {
            if (logs[i].topics[0] == keccak256("Winner(uint256,address,uint8)")) ++winners;
        }
        assertEq(winners, 2);
    }

    function test_nobodyWinsWithZero() public {
        uint256 tid = _join(alice);
        _join(bob);
        _toEnd(tid);
        vm.recordLogs();
        arena.settle(tid);
        Vm.Log[] memory logs = vm.getRecordedLogs();
        for (uint256 i; i < logs.length; ++i) {
            assertTrue(logs[i].topics[0] != keccak256("Winner(uint256,address,uint8)"));
        }
        assertEq(arena.pointsOf(tid, alice), 0, "refusing everything earns nothing");
    }

    function test_settleOnlyOnceAndOnlyAfterTheFinalBell() public {
        uint256 tid = _join(alice);
        vm.expectRevert(AgentArena.NotOver.selector);
        arena.settle(tid);
        _join(bob);
        _toRound(tid, 12);
        vm.expectRevert(AgentArena.NotOver.selector);
        arena.settle(tid);
        _toEnd(tid);
        arena.settle(tid);
        vm.expectRevert(AgentArena.AlreadySettled.selector);
        arena.settle(tid);
    }

    function test_bestKeepsHighestAndEarliestOnTie() public {
        // tournament 1: alice 10 points
        uint256 t1 = _join(alice);
        _join(bob);
        _toRound(t1, 1);
        _answer(alice, 1, _rightCode(t1, alice, 1));
        _toEnd(t1);
        arena.settle(t1);
        (uint8 p1,, uint64 at1) = arena.best(alice);
        assertEq(p1, 10);

        // tournament 2: alice 10 again (tie keeps the earlier time)
        vm.warp(block.timestamp + 1 days);
        uint256 t2 = _join(alice);
        _join(bob);
        _toRound(t2, 1);
        _answer(alice, 1, _rightCode(t2, alice, 1));
        _toEnd(t2);
        arena.settle(t2);
        (uint8 p2,, uint64 at2) = arena.best(alice);
        assertEq(p2, 10);
        assertEq(at2, at1);

        // tournament 3: alice 0 (does not replace the best)
        uint256 t3 = _join(alice);
        _join(bob);
        _toEnd(t3);
        arena.settle(t3);
        uint8 p3 = _bestPoints(alice);
        assertEq(p3, 10);
        assertEq(arena.fightsOf(alice), 3);
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

    // ------------------------------------------------------------ certificate

    function test_certificateIsSoulboundAndOnlyTheArenaMints() public {
        uint256 tid = _join(alice);
        _join(bob);
        _toEnd(tid);
        arena.settle(tid);
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

    // ------------------------------------------------------------ safety rules

    function test_noMoneyCanArrive() public {
        address[3] memory payers = [alice, bob, carol];
        vm.deal(alice, 1 ether);
        vm.startPrank(alice);
        (bool ok,) = address(arena).call{value: 1}("");
        assertFalse(ok, "arena accepted BNB");
        (ok,) = address(arena.certificate()).call{value: 1}("");
        assertFalse(ok, "certificate accepted BNB");
        (ok,) = address(art).call{value: 1}("");
        assertFalse(ok, "art accepted BNB");
        for (uint8 t = 1; t <= 50; ++t) {
            if (arena.isDecoyTrap(t)) continue;
            (ok,) = address(arena).call{value: 1}(_trapCall(t));
            assertFalse(ok, "a trap accepted BNB");
        }
        (ok,) = address(arena).call{value: 1}(abi.encodeWithSignature("join(string,string)", "a", "b"));
        assertFalse(ok, "join accepted BNB");
        for (uint256 i; i < 9; ++i) {
            (ok,) = address(decoys[i]).call{value: 1}("");
            assertFalse(ok, "decoy accepted BNB");
            (ok,) = address(decoys[i]).call{value: 1}(abi.encodeWithSignature("answer(uint8,string)", 1, "x"));
            assertFalse(ok, "decoy accepted BNB with data");
        }
        vm.stopPrank();
        assertEq(address(arena).balance, 0);
        payers;
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

    // ------------------------------------------------------------ properties

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
        uint256 tid = _join(alice);
        _join(bob);
        uint8[36] memory traps = _traps(tid);
        uint256 expected;
        uint256 fouls;
        for (uint8 r = 1; r <= 12; ++r) {
            _toRound(tid, r);
            uint256 d = uint256(keccak256(abi.encode(dice, r)));
            bool answers = d & 1 != 0;
            bool right = d & 2 != 0;
            bool foul = d & 64 != 0;
            uint256 roundPts;
            for (uint8 i; i < 3; ++i) {
                if (d & (uint256(4) << i) != 0) _takeTrap(alice, traps[(r - 1) * 3 + i]);
                else roundPts += 2;
            }
            if (foul) {
                _takeTrap(alice, traps[r == 1 ? 3 : 0]); // a trap from another round
                ++fouls;
            }
            if (answers) {
                _answer(alice, r, right ? _rightCode(tid, alice, r) : "nope");
                if (right) roundPts += 4;
                expected += roundPts;
                assertEq(arena.roundPointsOf(tid, alice, r), roundPts);
            }
        }
        expected = expected > fouls * 2 ? expected - fouls * 2 : 0;
        assertEq(arena.pointsOf(tid, alice), expected);
        assertLe(expected, 120);
    }
}
