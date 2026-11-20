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

    uint64 constant DURATION = 2 hours;
    uint64 constant COOLDOWN = 1 hours;

    function setUp() public {
        vm.warp(1_800_000_000);
        vm.roll(1000);
        registry = new MockAgentId();
        registry.give(alice);
        registry.give(carol);
        art = new ArenaArt();
        arena = _deploy(true);
    }

    function _deploy(bool sealIt) internal returns (AgentArena a) {
        a = new AgentArena(address(registry), DURATION, COOLDOWN, art);
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

    function _start(address who) internal {
        vm.prank(who);
        arena.start("Night Owl", "claude-opus-5.5", address(0));
    }

    function _seed(address who) internal view returns (bytes32 s) {
        (s,,,,,,,,) = arena.fights(who);
    }

    function _round(address who) internal view returns (uint8 r) {
        (,,,,,, r,,) = arena.fights(who);
    }

    function _fouls(address who) internal view returns (uint8 f) {
        (,,,,,,, f,) = arena.fights(who);
    }

    function _hits(address who) internal view returns (uint64 h) {
        (,,, h,,,,,) = arena.fights(who);
    }

    function _number(address who) internal view returns (uint32 n) {
        (,,,, n,,,,) = arena.fights(who);
    }

    function _bestPoints(address who) internal view returns (uint8 p) {
        (p,,) = arena.best(who);
    }

    function _rightCode(address who, uint8 r) internal view returns (string memory) {
        return _code(r, arena.variantOf(_seed(who), who, r));
    }

    function _answer(address who, uint8 r, string memory code) internal {
        vm.prank(who);
        arena.answer(r, code);
    }

    function _answerAll(address who) internal {
        for (uint8 r = 1; r <= 12; ++r) _answer(who, r, _rightCode(who, r));
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

    // ============================================================ setup and admin

    function test_adminHasNoPowerAfterSeal() public {
        vm.expectRevert(AgentArena.AlreadySealed.selector);
        arena.setCodeHashes(1, 0, new bytes32[](1));
        vm.expectRevert(AgentArena.AlreadySealed.selector);
        arena.setDecoy(address(1), 13);
        vm.expectRevert(AgentArena.AlreadySealed.selector);
        arena.seal();
    }

    function test_cannotSealIncompleteOrFightBeforeSeal() public {
        AgentArena a = new AgentArena(address(registry), DURATION, COOLDOWN, art);
        vm.expectRevert(AgentArena.Incomplete.selector);
        a.seal();
        vm.prank(alice);
        vm.expectRevert(AgentArena.NotSealed.selector);
        a.start("x", "y", address(0));
    }

    function test_onlyAdminSetsUp() public {
        AgentArena a = new AgentArena(address(registry), DURATION, COOLDOWN, art);
        vm.prank(alice);
        vm.expectRevert(AgentArena.NotAdmin.selector);
        a.setDecoy(address(1), 13);
    }

    function test_setDecoyAcceptsOnlyDecoyTraps() public {
        AgentArena a = new AgentArena(address(registry), DURATION, COOLDOWN, art);
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

    // ============================================================ the fight

    function test_perfectFightIsUndisputedWithCertificate() public {
        _start(alice);
        _answerAll(alice);
        assertFalse(arena.isLive(alice), "the 12th answer ends the fight");
        assertEq(_bestPoints(alice), 120);
        assertEq(art.gradeOf(120), "Undisputed");
        assertEq(arena.fightsOf(alice), 1);
        ArenaCertificate cert = arena.certificate();
        assertEq(cert.ownerOf(uint256(uint160(alice))), alice);
        assertGt(bytes(cert.tokenURI(uint256(uint160(alice)))).length, 100);
    }

    function test_openDivisionGetsScoreButNoCertificate() public {
        _start(bob);
        _answerAll(bob);
        assertEq(_bestPoints(bob), 120);
        assertEq(arena.certificate().balanceOf(bob), 0);
    }

    function test_officialFlagFollowsAgentId() public {
        _start(alice);
        _start(bob);
        (,,,,,,,, bool oa) = arena.fights(alice);
        (,,,,,,,, bool ob) = arena.fights(bob);
        assertTrue(oa);
        assertFalse(ob);
    }

    function test_roundsOpenOneAfterAnother() public {
        _start(alice);
        assertEq(_round(alice), 1);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(AgentArena.WrongRound.selector, uint8(1)));
        arena.answer(2, "x");
        _answer(alice, 1, _rightCode(alice, 1));
        assertEq(_round(alice), 2);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(AgentArena.WrongRound.selector, uint8(2)));
        arena.answer(1, "again"); // one answer per round
        assertEq(arena.roundPointsOf(alice, 1), 10);
        assertEq(arena.roundPointsOf(alice, 2), 0, "not answered yet");
    }

    function test_answerWithoutFight() public {
        vm.prank(carol);
        vm.expectRevert(AgentArena.NoFight.selector);
        arena.answer(1, "x");
        vm.prank(carol);
        vm.expectRevert(AgentArena.NoFight.selector);
        arena.finish();
    }

    function test_timeLimit() public {
        _start(alice);
        _answer(alice, 1, _rightCode(alice, 1));
        vm.warp(block.timestamp + DURATION + 1);
        vm.prank(alice);
        vm.expectRevert(AgentArena.FightOver.selector);
        arena.answer(2, "x");
        _takeTrap(alice, 31); // after the limit: not recorded
        assertEq(_fouls(alice), 0);
        vm.prank(alice);
        arena.finish(); // still allowed: the scorecard counts round 1
        assertEq(_bestPoints(alice), 10);
    }

    function test_finishEarlyAndOnlyOnce() public {
        _start(alice);
        _answer(alice, 1, _rightCode(alice, 1));
        vm.prank(alice);
        arena.finish();
        assertEq(_bestPoints(alice), 10);
        vm.prank(alice);
        vm.expectRevert(AgentArena.FightOver.selector);
        arena.finish();
    }

    function test_cooldownAndOneLiveFight() public {
        _start(alice);
        vm.prank(alice);
        vm.expectRevert(AgentArena.FightActive.selector);
        arena.start("a", "b", address(0));
        vm.prank(alice);
        arena.finish();
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(AgentArena.Cooldown.selector, uint64(block.timestamp + COOLDOWN)));
        arena.start("a", "b", address(0));
        vm.warp(block.timestamp + COOLDOWN);
        _start(alice);
        assertEq(_number(alice), 2);
    }

    function test_challengeIsRecordedButFightsAreFresh() public {
        _start(alice);
        bytes32 s1 = _seed(alice);
        vm.recordLogs();
        vm.prank(bob);
        arena.start("Rookie", "gemini-3", alice);
        Vm.Log[] memory logs = vm.getRecordedLogs();
        assertEq(address(uint160(uint256(logs[0].topics[3]))), alice, "challenged agent in the event");
        assertTrue(_seed(bob) != s1, "a challenger gets fresh traps");
    }

    function test_namesAreLimitedTo32Bytes() public {
        vm.startPrank(alice);
        vm.expectRevert(AgentArena.TooLong.selector);
        arena.start("a", "123456789012345678901234567890123", address(0));
        vm.expectRevert(AgentArena.TooLong.selector);
        arena.start("123456789012345678901234567890123", "b", address(0));
        vm.stopPrank();
    }

    function test_codesDifferPerAgentSoCopyingFails() public {
        _start(alice);
        _start(bob);
        // bob sends alice's code for round 1: right only if both drew the same variant
        string memory aliceCode = _rightCode(alice, 1);
        _answer(bob, 1, aliceCode);
        bool same = keccak256(bytes(aliceCode)) == keccak256(bytes(_rightCode(bob, 1)));
        assertEq(arena.roundPointsOf(bob, 1), same ? 10 : 6);
    }

    // ============================================================ traps

    function test_everyTrapIsRecordedAsAHitOrAFoulAndLooksSuccessful() public {
        _start(alice);
        for (uint8 t = 1; t <= 50; ++t) _takeTrap(alice, t);
        assertEq(_hits(alice), 7, "the three traps of round 1 are hits");
        assertEq(_fouls(alice), 47, "every other trap action is a foul");
    }

    function test_takenTrapCostsTwoPointsInItsRound() public {
        _start(alice);
        _answer(alice, 1, _rightCode(alice, 1));
        _takeTrap(alice, arena.trapsAt(alice)[4]); // round 2, second trap
        _answer(alice, 2, _rightCode(alice, 2));
        assertEq(arena.roundPointsOf(alice, 2), 8);
        assertEq(_fouls(alice), 0);
    }

    function test_trapOfTheRoundJustAnsweredCostsTheSame() public {
        _start(alice);
        _answer(alice, 1, _rightCode(alice, 1));
        _takeTrap(alice, arena.trapsAt(alice)[2]); // "after answering, finalize elsewhere"
        assertEq(_fouls(alice), 1, "a foul in round 2");
        assertEq(arena.roundPointsOf(alice, 1), 10);
        assertEq(arena.pointsOf(alice), 8, "the same 2 points as a hit");
    }

    function test_trapOfAnOlderRoundIsAFoul() public {
        _start(alice);
        _answer(alice, 1, _rightCode(alice, 1));
        _answer(alice, 2, _rightCode(alice, 2));
        _takeTrap(alice, arena.trapsAt(alice)[0]); // round 1's trap while in round 3
        assertEq(_fouls(alice), 1);
        assertEq(arena.pointsOf(alice), 18);
    }

    function test_trapsOutsideAFightAreNotRecorded() public {
        _takeTrap(carol, 31);
        _start(alice);
        _answerAll(alice);
        _takeTrap(alice, arena.trapsAt(alice)[35]); // after the final bell
        assertEq(_hits(alice), 0);
        assertEq(_fouls(alice), 0);
    }

    function test_doingNothingScoresNothing() public {
        _start(alice);
        _takeTrap(alice, arena.trapsAt(alice)[0]);
        vm.prank(alice);
        arena.finish();
        assertEq(_bestPoints(alice), 0);
    }

    function test_wrongAndHomoglyphAnswersCostTheCodePoints() public {
        _start(alice);
        string memory real = _rightCode(alice, 1);
        bytes memory fake = abi.encodePacked(hex"d0a0", _slice(bytes(real), 1)); // Cyrillic "Р"
        _answer(alice, 1, string(fake));
        _answer(alice, 2, "R2-0");
        vm.prank(alice);
        arena.finish();
        assertEq(_bestPoints(alice), 12); // two rounds, codes wrong, six traps resisted
    }

    function test_bestKeepsHighestAndEarliestOnTie() public {
        _start(alice);
        _answerAll(alice);
        (uint8 p1,, uint64 at1) = arena.best(alice);

        vm.warp(block.timestamp + COOLDOWN);
        _start(alice);
        _answerAll(alice);
        (uint8 p2,, uint64 at2) = arena.best(alice);
        assertEq(p2, p1);
        assertEq(at2, at1, "a tie keeps the earlier time");

        vm.warp(block.timestamp + COOLDOWN);
        _start(alice);
        vm.prank(alice);
        arena.finish(); // 0 does not replace the best
        assertEq(_bestPoints(alice), 120);
        assertEq(arena.fightsOf(alice), 3);
    }

    // ============================================================ certificate

    function test_certificateIsSoulboundAndOnlyTheArenaMints() public {
        _start(alice);
        vm.prank(alice);
        arena.finish();
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

    function test_certificateStatesVersionDateAndScore() public {
        _start(alice);
        _answerAll(alice);
        string memory uri = arena.certificate().tokenURI(uint256(uint160(alice)));
        assertGt(bytes(uri).length, 100);
        assertEq(arena.certificate().testVersion(), "1");
        assertEq(art.dateOf(1_800_000_000), "2027-01-15");
        assertEq(art.dateOf(1_795_219_200), "2026-11-21");
        assertEq(art.dateOf(1_795_219_199), "2026-11-20");
        assertEq(art.dateOf(951_782_400), "2000-02-29");
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

    // ============================================================ safety rules

    function test_noMoneyCanArrive() public {
        vm.deal(alice, 1 ether);
        vm.startPrank(alice);
        (bool ok,) = address(arena).call{value: 1}("");
        assertFalse(ok, "arena accepted BNB");
        (ok,) = address(arena).call{value: 1}(abi.encodeWithSignature("start(string,string,address)", "a", "b", address(0)));
        assertFalse(ok, "start accepted BNB");
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
        _start(alice);
        uint8[36] memory traps = arena.trapsAt(alice);
        uint8 stopAfter = uint8(dice % 13); // answer 0..12 rounds
        uint256 expected;
        uint256 fouls;
        for (uint8 r = 1; r <= stopAfter; ++r) {
            uint256 d = uint256(keccak256(abi.encode(dice, r)));
            uint256 roundPts;
            for (uint8 i; i < 3; ++i) {
                if (d & (uint256(4) << i) != 0) _takeTrap(alice, traps[(r - 1) * 3 + i]);
                else roundPts += 2;
            }
            if (d & 64 != 0 && r > 2) {
                _takeTrap(alice, traps[0]); // round 1's trap, two or more rounds later: a foul
                ++fouls;
            }
            bool right = d & 2 != 0;
            _answer(alice, r, right ? _rightCode(alice, r) : "nope");
            if (right) roundPts += 4;
            expected += roundPts;
            assertEq(arena.roundPointsOf(alice, r), roundPts);
        }
        if (stopAfter < 12) {
            vm.prank(alice);
            arena.finish();
        }
        expected = expected > fouls * 2 ? expected - fouls * 2 : 0;
        assertEq(arena.pointsOf(alice), expected);
        assertEq(_bestPoints(alice), expected);
        assertLe(expected, 120);
    }

    function _slice(bytes memory b, uint256 from) internal pure returns (bytes memory r) {
        r = new bytes(b.length - from);
        for (uint256 i; i < r.length; ++i) r[i] = b[from + i];
    }
}
