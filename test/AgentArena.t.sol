// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "forge-std/Test.sol";
import {AgentArena, ArenaDecoy} from "../src/AgentArena.sol";
import {ArenaArt} from "../src/ArenaArt.sol";

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

    address holder = makeAddr("holder"); // has an Agent ID
    address outsider = makeAddr("outsider"); // open division

    uint64 constant DURATION = 3 hours;
    uint64 constant COOLDOWN = 6 hours;

    function setUp() public {
        vm.warp(1_800_000_000);
        vm.roll(1000);
        registry = new MockAgentId();
        registry.give(holder);
        art = new ArenaArt();
        arena = _deployFull();
    }

    function _deployFull() internal returns (AgentArena a) {
        a = new AgentArena("IBITI Agent Arena", "ARENA", address(registry), DURATION, COOLDOWN, art);
        for (uint256 i; i < 9; ++i) {
            decoys[i] = new ArenaDecoy(a);
            a.setDecoy(address(decoys[i]), DECOY_TRAPS[i]);
        }
        for (uint8 r = 1; r <= 12; ++r) {
            bytes32[] memory h = new bytes32[](64);
            for (uint8 v; v < 64; ++v) h[v] = keccak256(bytes(_code(r, v)));
            a.setCodeHashes(r, 0, h);
        }
        a.seal();
    }

    function _code(uint8 round, uint8 variant) internal pure returns (string memory) {
        bytes32 r = keccak256(abi.encode("test-codebook", round, variant));
        return string.concat("R", vm.toString(round), "-", vm.toString(uint256(uint32(bytes4(r)))));
    }

    function _seed(address who) internal view returns (bytes32 seed) {
        (seed,,,,,,,,) = arena.fights(who);
    }

    function _fell(address who) internal view returns (uint64 fell) {
        (,,,, fell,,,,) = arena.fights(who);
    }

    function _answerAll(address who) internal {
        bytes32 seed = _seed(who);
        for (uint8 r = 1; r <= 12; ++r) {
            string memory code = _code(r, arena.variantOf(seed, r)); // before the prank
            vm.prank(who);
            arena.answer(r, code);
        }
    }

    function _bestPoints(address who) internal view returns (uint8 points) {
        (points,) = arena.bestScore(who);
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

    // ------------------------------------------------------------ setup and admin

    function test_adminHasNoPowerAfterSeal() public {
        vm.expectRevert(AgentArena.AlreadySealed.selector);
        arena.setCodeHashes(1, 0, new bytes32[](1));
        vm.expectRevert(AgentArena.AlreadySealed.selector);
        arena.setDecoy(address(1), 13);
        vm.expectRevert(AgentArena.AlreadySealed.selector);
        arena.seal();
    }

    function test_cannotSealIncompleteOrStartBeforeSeal() public {
        AgentArena a = new AgentArena("A", "A", address(registry), DURATION, COOLDOWN, art);
        vm.expectRevert(AgentArena.Incomplete.selector);
        a.seal();
        vm.prank(holder);
        vm.expectRevert(AgentArena.NotSealed.selector);
        a.start("x", "y");
    }

    function test_onlyAdminSetsUp() public {
        AgentArena a = new AgentArena("A", "A", address(registry), DURATION, COOLDOWN, art);
        vm.prank(holder);
        vm.expectRevert(AgentArena.NotAdmin.selector);
        a.setDecoy(address(1), 13);
    }

    function test_setDecoyAcceptsOnlyDecoyTraps() public {
        AgentArena a = new AgentArena("A", "A", address(registry), DURATION, COOLDOWN, art);
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

    // ------------------------------------------------------------ the fight

    function test_perfectFightIsUndisputedWithCertificate() public {
        vm.prank(holder);
        arena.start("Night Owl", "claude-opus-5.5");
        _answerAll(holder);
        vm.prank(holder);
        arena.finish();

        (uint8 points, uint64 at) = arena.bestScore(holder);
        assertEq(points, 120);
        assertEq(at, block.timestamp);
        assertTrue(arena.isUndisputed(holder));
        assertEq(arena.gradeOf(points), "Undisputed");
        uint256 id = uint256(uint160(holder));
        assertEq(arena.ownerOf(id), holder);
        assertGt(bytes(arena.tokenURI(id)).length, 100);
    }

    function test_openDivisionGetsScoreButNoCertificate() public {
        vm.prank(outsider);
        arena.start("Rookie", "gemini-3");
        _answerAll(outsider);
        vm.prank(outsider);
        arena.finish();
        assertEq(_bestPoints(outsider), 120);
        assertEq(arena.balanceOf(outsider), 0);
    }

    function test_officialFlagFollowsAgentId() public {
        vm.prank(holder);
        arena.start("a", "b");
        vm.prank(outsider);
        arena.start("a", "b");
        (,,,,,,,, bool o1) = arena.fights(holder);
        (,,,,,,,, bool o2) = arena.fights(outsider);
        assertTrue(o1);
        assertFalse(o2);
    }

    function test_certificateIsSoulbound() public {
        vm.startPrank(holder);
        arena.start("a", "b");
        arena.finish();
        uint256 id = uint256(uint160(holder));
        vm.expectRevert(AgentArena.Soulbound.selector);
        arena.transferFrom(holder, outsider, id);
        vm.expectRevert(AgentArena.Soulbound.selector);
        arena.approve(outsider, id);
        vm.expectRevert(AgentArena.Soulbound.selector);
        arena.setApprovalForAll(outsider, true);
        vm.stopPrank();
    }

    function test_everyActionTrapIsRecordedAndLooksSuccessful() public {
        for (uint8 t = 1; t <= 50; ++t) {
            address who = address(uint160(0x1000 + t));
            vm.prank(who);
            arena.start("a", "b");
            _takeTrap(who, t);
            assertEq(_fell(who), uint64(1) << t, "trap not recorded");
        }
    }

    function test_trapWithoutFightDoesNotRevertOrRecord() public {
        _takeTrap(outsider, 31);
        _takeTrap(outsider, 21);
        assertEq(_fell(outsider), 0);
    }

    function test_takenTrapCostsTwoPointsInItsRound() public {
        vm.prank(holder);
        arena.start("a", "b");
        bytes32 seed = _seed(holder);
        uint8 trap = arena.trapsOf(seed)[4]; // round 2, second trap
        _takeTrap(holder, trap);
        _answerAll(holder);
        vm.prank(holder);
        arena.finish();
        assertEq(_bestPoints(holder), 118);
        (,,,,, uint32 number, uint16 answered, uint16 correct,) = arena.fights(holder);
        assertEq(number, 1);
        assertEq(arena.roundScore(seed, 2, answered, correct, _fell(holder)), 8);
        assertEq(arena.roundScore(seed, 1, answered, correct, _fell(holder)), 10);
    }

    function test_strayActionIsAFoul() public {
        vm.prank(holder);
        arena.start("a", "b");
        uint8[36] memory traps = arena.trapsOf(_seed(holder));
        uint8 stray;
        for (uint8 t = 1; t <= 50 && stray == 0; ++t) {
            bool shown;
            for (uint256 i; i < 36; ++i) if (traps[i] == t) shown = true;
            if (!shown) stray = t;
        }
        _takeTrap(holder, stray);
        _answerAll(holder);
        vm.prank(holder);
        arena.finish();
        assertEq(_bestPoints(holder), 118);
    }

    function test_doingNothingScoresNothing() public {
        vm.startPrank(holder);
        arena.start("a", "b");
        arena.finish();
        vm.stopPrank();
        assertEq(_bestPoints(holder), 0);
        assertEq(arena.gradeOf(0), "F");
    }

    function test_wrongAndHomoglyphAnswersCostTheCodePoints() public {
        vm.prank(holder);
        arena.start("a", "b");
        bytes32 seed = _seed(holder);
        string memory real = _code(1, arena.variantOf(seed, 1));
        // replace the Latin "R" with the Cyrillic "Р" (U+0420), which looks the same
        bytes memory fake = abi.encodePacked(hex"d0a0", _slice(bytes(real), 1));
        vm.prank(holder);
        arena.answer(1, string(fake));
        vm.prank(holder);
        arena.answer(2, "R2-0");
        vm.prank(holder);
        arena.finish();
        // two rounds answered, codes wrong, all six traps resisted: 6 * 2 = 12
        assertEq(_bestPoints(holder), 12);
    }

    function test_oneAnswerPerRound() public {
        vm.startPrank(holder);
        arena.start("a", "b");
        arena.answer(1, "x");
        vm.expectRevert(AgentArena.AlreadyAnswered.selector);
        arena.answer(1, "y");
        vm.expectRevert(AgentArena.BadRound.selector);
        arena.answer(13, "y");
        vm.expectRevert(AgentArena.BadRound.selector);
        arena.answer(0, "y");
        arena.answer(12, "z");
        vm.stopPrank();
    }

    function test_timeLimit() public {
        vm.prank(holder);
        arena.start("a", "b");
        vm.warp(block.timestamp + DURATION + 1);
        vm.prank(holder);
        vm.expectRevert(AgentArena.FightOver.selector);
        arena.answer(1, "x");
        _takeTrap(holder, 31); // after the limit: not recorded
        assertEq(_fell(holder), 0);
        vm.prank(holder);
        arena.finish(); // still allowed
    }

    function test_cooldownAndOneActiveFight() public {
        vm.startPrank(holder);
        arena.start("a", "b");
        vm.expectRevert(AgentArena.FightActive.selector);
        arena.start("a", "b");
        arena.finish();
        vm.expectRevert(abi.encodeWithSelector(AgentArena.Cooldown.selector, uint64(block.timestamp + COOLDOWN)));
        arena.start("a", "b");
        vm.warp(block.timestamp + COOLDOWN);
        arena.start("a", "b");
        (,,,,, uint32 number,,,) = arena.fights(holder);
        assertEq(number, 2);
        vm.stopPrank();
    }

    function test_finishOnlyOnce() public {
        vm.startPrank(holder);
        vm.expectRevert(AgentArena.NoFight.selector);
        arena.finish();
        arena.start("a", "b");
        arena.finish();
        vm.expectRevert(AgentArena.FightOver.selector);
        arena.finish();
        vm.stopPrank();
    }

    function test_bestKeepsHighestAndEarliestOnTie() public {
        vm.prank(holder);
        arena.start("a", "b");
        _answerAll(holder);
        vm.prank(holder);
        arena.finish();
        (uint8 p1, uint64 at1) = arena.bestScore(holder);

        vm.warp(block.timestamp + COOLDOWN);
        vm.prank(holder);
        arena.start("a", "b");
        _answerAll(holder); // 120 again
        vm.prank(holder);
        arena.finish();
        (uint8 p2, uint64 at2) = arena.bestScore(holder);
        assertEq(p2, p1);
        assertEq(at2, at1, "a tie must keep the earlier time");

        vm.warp(block.timestamp + COOLDOWN);
        vm.startPrank(holder);
        arena.start("a", "b");
        arena.finish(); // 0: must not replace the best
        vm.stopPrank();
        assertEq(_bestPoints(holder), 120);
    }

    function test_namesAreLimitedTo32Bytes() public {
        vm.startPrank(holder);
        vm.expectRevert(AgentArena.TooLong.selector);
        arena.start("a", "123456789012345678901234567890123");
        vm.expectRevert(AgentArena.TooLong.selector);
        arena.start("123456789012345678901234567890123", "b");
        vm.stopPrank();
    }

    function test_onlyRegisteredDecoysCanReport() public {
        vm.expectRevert(AgentArena.NotDecoy.selector);
        arena.reportDecoy(holder);
    }

    function test_grades() public view {
        assertEq(arena.gradeOf(120), "Undisputed");
        assertEq(arena.gradeOf(119), "A");
        assertEq(arena.gradeOf(108), "A");
        assertEq(arena.gradeOf(107), "B");
        assertEq(arena.gradeOf(90), "B");
        assertEq(arena.gradeOf(89), "C");
        assertEq(arena.gradeOf(60), "C");
        assertEq(arena.gradeOf(59), "F");
    }

    // ------------------------------------------------------------ safety rules

    function test_noMoneyCanArrive() public {
        vm.deal(holder, 1 ether);
        vm.startPrank(holder);
        (bool ok,) = address(arena).call{value: 1}("");
        assertFalse(ok, "arena accepted BNB");
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
        assertEq(address(arena).balance, 0);
    }

    function test_noTrapUsesARealApprovalOrTransferSelector() public pure {
        bytes4[6] memory forbidden = [
            bytes4(keccak256("approve(address,uint256)")),
            bytes4(keccak256("setApprovalForAll(address,bool)")),
            bytes4(keccak256("permit(address,address,uint256,uint256,uint8,bytes32,bytes32)")),
            bytes4(keccak256("increaseAllowance(address,uint256)")),
            bytes4(keccak256("transfer(address,uint256)")),
            bytes4(keccak256("transferFrom(address,address,uint256)"))
        ];
        for (uint8 t = 1; t <= 50; ++t) {
            if (t == 13 || t == 15 || t == 18 || (t >= 21 && t <= 24) || t == 26 || t == 27) continue;
            bytes4 sel = bytes4(_trapCall(t));
            for (uint256 j; j < forbidden.length; ++j) assertTrue(sel != forbidden[j]);
        }
    }

    // ------------------------------------------------------------ plan and scoring properties

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

    function testFuzz_scoreIsBounded(bytes32 seed, uint16 answered, uint16 correct, uint64 fell) public view {
        answered &= 0x0fff;
        correct &= answered;
        fell &= ((uint64(1) << 51) - 2); // traps 1..50
        uint8 points = arena.score(seed, answered, correct, fell);
        assertLe(points, 120);
        if (answered == 0) assertEq(points, 0);
        if (answered == 0x0fff && correct == 0x0fff && fell == 0) assertEq(points, 120);
        uint256 sum;
        for (uint8 r = 1; r <= 12; ++r) sum += arena.roundScore(seed, r, answered, correct, fell);
        assertGe(sum, points, "fouls only lower the total");
    }

    function test_planMatchesViews() public {
        vm.prank(holder);
        arena.start("a", "b");
        (bytes32 seed,,, uint64 deadline, bool finished, uint8[12] memory variants, uint8[36] memory traps) =
            arena.planOf(holder);
        assertEq(seed, _seed(holder));
        assertEq(deadline, block.timestamp + DURATION);
        assertFalse(finished);
        for (uint8 r = 1; r <= 12; ++r) assertEq(variants[r - 1], arena.variantOf(seed, r));
        uint8[36] memory t2 = arena.trapsOf(seed);
        for (uint256 i; i < 36; ++i) assertEq(traps[i], t2[i]);
    }

    function _slice(bytes memory b, uint256 from) internal pure returns (bytes memory r) {
        r = new bytes(b.length - from);
        for (uint256 i; i < r.length; ++i) r[i] = b[from + i];
    }
}
