// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "forge-std/Test.sol";
import {MessageHashUtils} from "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";
import {AgentArena, ArenaDecoy} from "../src/AgentArena.sol";
import {ArenaArt} from "../src/ArenaArt.sol";
import {ArenaCertificate} from "../src/ArenaCertificate.sol";

/// @dev The SPACE ID Agent ID registry in short: the token number of a name is keccak256 of the name.
contract MockAgentId {
    mapping(uint256 => address) public ownerOf;
    mapping(address => uint256) public balanceOf;

    function give(address a, string calldata name) external {
        ownerOf[uint256(keccak256(bytes(name)))] = a;
        balanceOf[a] = 1;
    }
}

/// @dev The chain's block-hash history (EIP-2935) in short: any block's hash, made up.
contract MockHistory {
    fallback(bytes calldata data) external returns (bytes memory) {
        return abi.encode(keccak256(abi.encode("history", abi.decode(data, (uint256)))));
    }
}

contract AgentArenaTest is Test {
    AgentArena arena;
    MockAgentId registry;
    ArenaArt art;
    ArenaDecoy[9] decoys;
    uint8[9] DECOY_TRAPS = [13, 15, 18, 21, 22, 23, 24, 26, 27];

    address alice = makeAddr("alice"); // Agent ID "alice"
    address bob = makeAddr("bob"); // open division
    address carol = makeAddr("carol"); // Agent ID "carol"
    address dave = makeAddr("dave"); // open division
    address judgeKey; // the judge's address
    uint256 judgePk; // and its key: it signs the commitments
    uint64 seasonEnd = SEASON_END;
    bool lockOnDraw = true; // the judge locks every drawn fight's trap plan during the countdown
    bytes32 constant COMMIT = keccak256("test season secret");
    uint64 constant SEASON_END = 1_800_000_000 + 365 days;

    uint64 constant COOLDOWN = 1 days; // one fight a day
    uint64 constant ROUND_TIME = 60;
    uint64 constant DRAW_EVERY = 600; // a draw every ten minutes
    /// @dev The hash of a page key: the page server gives the key at /join, the agent registers its hash.
    bytes32 constant PAGE_KEY_HASH = keccak256("a page key");

    function setUp() public {
        vm.warp(1_800_000_000);
        vm.roll(1000);
        registry = new MockAgentId();
        registry.give(alice, "alice");
        registry.give(carol, "carol");
        art = new ArenaArt();
        (judgeKey, judgePk) = makeAddrAndKey("judge");
        arena = _deploy(true);
    }

    function _newArena() internal returns (AgentArena) {
        return new AgentArena(address(registry), COOLDOWN, ROUND_TIME, DRAW_EVERY, art, judgeKey, COMMIT, seasonEnd);
    }

    function _deploy(bool sealIt) internal returns (AgentArena a) {
        a = _newArena();
        for (uint256 i; i < 9; ++i) {
            decoys[i] = new ArenaDecoy(a);
            a.setDecoy(address(decoys[i]), DECOY_TRAPS[i]);
        }
        if (sealIt) a.seal();
    }

    // ------------------------------------------------------------ helpers

    function _nameOf(address who) internal view returns (string memory) {
        if (who == alice) return "alice";
        if (who == carol) return "carol.ai";
        return "Night Owl";
    }

    function _register(address who, address challenge) internal {
        bytes32 commitment = _next(who);
        bytes memory sig = _sig(who, commitment);
        vm.prank(who);
        arena.register(_nameOf(who), "claude-opus-5.5", commitment, sig, PAGE_KEY_HASH, challenge);
    }

    /// @dev The judge's signature of a commitment for `who`'s next fight, as /commit gives it. Taken
    ///      before a prank: it reads the arena.
    function _sig(address who, bytes32 c) internal view returns (bytes memory) {
        return _signAs(judgePk, who, c);
    }

    function _signAs(uint256 key, address who, bytes32 c) internal view returns (bytes memory) {
        bytes32 digest = keccak256(abi.encode(keccak256("IBITI Agent Arena commitment"), block.chainid, address(arena), who, arena.lastFight(who) + 1, c));
        (uint8 v, bytes32 r, bytes32 sg) = vm.sign(key, MessageHashUtils.toEthSignedMessageHash(digest));
        return abi.encodePacked(r, sg, v);
    }

    function _register(address who) internal {
        _register(who, address(0));
    }

    /// @dev Holds the next draw: moves the clock to its cutoff, seals it, then holds it on the sealed block.
    function _draw() internal {
        if (arena.pendingCutoff() == 0) {
            uint64 at = arena.nextDrawAt();
            if (vm.getBlockTimestamp() < at) vm.warp(at);
            arena.draw();
        }
        uint64 sb = arena.seedBlock();
        vm.roll(sb + 1);
        vm.setBlockhash(sb, keccak256(abi.encode("block", sb)));
        vm.recordLogs();
        arena.draw();
        if (lockOnDraw) _lockTrapsOfTheDraw();
    }

    /// @dev What the judge does during the countdown: lock the trap plan of every fight just drawn.
    function _lockTrapsOfTheDraw() internal {
        Vm.Log[] memory logs = vm.getRecordedLogs();
        bytes32 started = keccak256("Started(address,uint32,bytes32,bool,bytes32,bytes32,address,uint32)");
        uint256 n;
        for (uint256 i; i < logs.length; ++i) if (logs[i].emitter == address(arena) && logs[i].topics[0] == started) ++n;
        address[] memory agents = new address[](n);
        uint32[] memory numbers = new uint32[](n);
        bytes32[] memory commits = new bytes32[](n);
        n = 0;
        for (uint256 i; i < logs.length; ++i) {
            if (logs[i].emitter != address(arena) || logs[i].topics[0] != started) continue;
            agents[n] = address(uint160(uint256(logs[i].topics[1])));
            numbers[n] = uint32(uint256(logs[i].topics[2]));
            (bytes32 seed,,,,) = abi.decode(logs[i].data, (bytes32, bool, bytes32, bytes32, uint32));
            commits[n++] = keccak256(abi.encode(_plan(seed), _trapSalt(seed)));
        }
        if (n == 0) return;
        vm.prank(judgeKey);
        arena.lockTraps(agents, numbers, commits);
    }

    /// @dev The salt of a card's trap plan: the page server derives it from the season secret.
    function _trapSalt(bytes32 seed) internal pure returns (bytes32) {
        return keccak256(abi.encode("test trap salt", seed));
    }

    /// @dev `a` and `b` alone in the hall: the draw pairs them.
    function _match(address a, address b) internal {
        _register(a);
        _register(b);
        _draw();
    }

    uint256 sparrings;

    /// @dev `who` drawn with a sparring partner that gives up at once (finish() in the countdown):
    ///      a match in which only `who` fights. There is no fight without an opponent.
    function _spar(address who) internal {
        address partner = makeAddr(string.concat("sparring", vm.toString(++sparrings)));
        _register(who);
        _register(partner);
        for (uint256 i; i < 3 && !arena.isLive(who); ++i) _draw(); // a late registration closes an old list first
        require(arena.isLive(who) && _fight(who).opponent == partner, "drawn with the sparring partner");
        vm.prank(partner);
        arena.finish();
    }

    function _fight(address who) internal view returns (AgentArena.Fight memory) {
        return arena.fightOf(who, arena.lastFight(who));
    }

    function _number(address who) internal view returns (uint32) {
        return _fight(who).number;
    }

    function _bestPoints(address who) internal view returns (uint8 p) {
        (p,,,) = arena.best(who);
    }

    /// @dev The page server derives each fight's codes from the season secret; here any code that
    ///      is different per agent, fight and round will do.
    function _codeFor(address who, uint32 number, uint8 r) internal pure returns (string memory) {
        bytes32 h = keccak256(abi.encode("test code", who, number, r));
        return string.concat("R", vm.toString(r), "-", vm.toString(uint256(uint64(bytes8(h)))));
    }

    function _rightCode(address who, uint8 r) internal view returns (string memory) {
        return _codeFor(who, _number(who), r);
    }

    function _rightHashes(address who, uint32 number) internal pure returns (bytes32[12] memory h) {
        for (uint8 r = 1; r <= 12; ++r) h[r - 1] = keccak256(bytes(_codeFor(who, number, r)));
    }

    /// @dev The fight's secret salt: the page server derives it from the season secret.
    function _salt(address who, uint32 number) internal pure returns (bytes32) {
        return keccak256(abi.encode("test salt", who, number));
    }

    /// @dev The commitment the page server gives for `who`'s next fight.
    function _next(address who) internal view returns (bytes32) {
        uint32 n = arena.lastFight(who) + 1;
        return keccak256(abi.encode(_rightHashes(who, n), _salt(who, n)));
    }

    /// @dev A fight's secret trap plan, as the page server derives it from the card (both fighters of a
    ///      match share it): 36 of the 50 traps, three per round.
    function _plan(bytes32 seed) internal pure returns (uint8[36] memory traps) {
        uint8[50] memory pool;
        for (uint8 i; i < 50; ++i) pool[i] = i + 1;
        for (uint8 i; i < 36; ++i) {
            uint8 j = i + uint8(uint256(keccak256(abi.encode(seed, i))) % (50 - i));
            (pool[i], pool[j]) = (pool[j], pool[i]);
            traps[i] = pool[i];
        }
    }

    function _traps(address who) internal view returns (uint8[36] memory) {
        return _plan(_fight(who).seed);
    }

    /// @dev The judge scores `who`'s latest fight (with its locked plan, or with none).
    function _judge(address who) internal {
        AgentArena.Fight memory f = _fight(who);
        uint8[36] memory traps;
        bytes32 ts;
        if (f.trapsCommit != bytes32(0)) (traps, ts) = (_plan(f.seed), _trapSalt(f.seed));
        vm.prank(judgeKey);
        arena.judgeFight(who, f.number, _rightHashes(who, f.number), _salt(who, f.number), traps, ts);
    }

    function _finishAndJudge(address who) internal {
        vm.prank(who);
        arena.finish();
        _judge(who);
    }

    /// @dev When round `r` of `who`'s latest fight opens, as the clock stands now.
    function _opens(address who, uint8 r) internal view returns (uint256) {
        AgentArena.Fight memory f = _fight(who);
        return f.clockAt + uint256(r - f.clockRound) * (ROUND_TIME + 10);
    }

    /// @dev When round 12 closes.
    function _ends(address who) internal view returns (uint256) {
        return _opens(who, 12) + ROUND_TIME;
    }

    /// @dev Moves the clock to the opening of round `r` (never backwards).
    function _goto(address who, uint8 r) internal {
        uint256 at = _opens(who, r);
        if (vm.getBlockTimestamp() < at) vm.warp(at);
    }

    function _answer(address who, uint8 r, string memory code) internal {
        _goto(who, r);
        vm.prank(who);
        arena.answer(r, code);
    }

    function _answerAll(address who) internal {
        for (uint8 r = 1; r <= 12; ++r) {
            _answer(who, r, _rightCode(who, r));
        }
    }

    /// @dev Both fighters of a match answer every round right, round by round.
    function _answerBoth(address a, address b) internal {
        for (uint8 r = 1; r <= 12; ++r) {
            _answer(a, r, _rightCode(a, r));
            _answer(b, r, _rightCode(b, r));
        }
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
            for (uint256 i; i < 9; ++i) {
                if (DECOY_TRAPS[i] == t) target = address(decoys[i]);
            }
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
        ArenaDecoy d = new ArenaDecoy(arena);
        vm.expectRevert(AgentArena.AlreadySealed.selector);
        arena.setDecoy(address(d), 13);
        vm.expectRevert(AgentArena.AlreadySealed.selector);
        arena.seal();
    }

    function test_cannotSealIncompleteOrRegisterBeforeSeal() public {
        AgentArena a = _newArena();
        vm.expectRevert(AgentArena.Incomplete.selector);
        a.seal();
        vm.prank(alice);
        vm.expectRevert(AgentArena.NotSealed.selector);
        a.register("alice", "y", bytes32(uint256(1)), "", PAGE_KEY_HASH, address(0));
    }

    function test_onlyAdminSetsUp() public {
        AgentArena a = _newArena();
        ArenaDecoy d = new ArenaDecoy(a);
        vm.prank(alice);
        vm.expectRevert(AgentArena.NotAdmin.selector);
        a.setDecoy(address(d), 13);
    }

    function test_setDecoyChecksEveryDecoy() public {
        AgentArena a = _newArena();
        ArenaDecoy d = new ArenaDecoy(a);
        for (uint8 t = 0; t <= 51; ++t) {
            if (a.isDecoyTrap(t)) continue;
            vm.expectRevert(AgentArena.BadTrap.selector);
            a.setDecoy(address(d), t); // not a decoy trap
        }
        vm.expectRevert();
        a.setDecoy(address(0xBEEF), 13); // not a contract
        ArenaDecoy foreign = new ArenaDecoy(arena);
        vm.expectRevert(AgentArena.BadTrap.selector);
        a.setDecoy(address(foreign), 13); // a decoy of another arena
        a.setDecoy(address(d), 13);
        ArenaDecoy second = new ArenaDecoy(a);
        vm.expectRevert(AgentArena.BadTrap.selector);
        a.setDecoy(address(second), 13); // trap 13 already has its decoy
        vm.expectRevert(AgentArena.BadTrap.selector);
        a.setDecoy(address(d), 15); // this decoy is already registered
        for (uint256 i = 1; i < 9; ++i) a.setDecoy(address(new ArenaDecoy(a)), DECOY_TRAPS[i]);
        assertEq(a.decoyMask(), a.ALL_DECOYS());
        a.seal();
    }

    function test_constructorRefusesZeroSettings() public {
        vm.expectRevert(AgentArena.ZeroSetting.selector);
        new AgentArena(address(0), COOLDOWN, ROUND_TIME, DRAW_EVERY, art, judgeKey, COMMIT, SEASON_END);
        vm.expectRevert(AgentArena.ZeroSetting.selector);
        new AgentArena(address(registry), COOLDOWN, ROUND_TIME, DRAW_EVERY, art, address(0), COMMIT, SEASON_END);
        vm.expectRevert(AgentArena.ZeroSetting.selector);
        new AgentArena(address(registry), COOLDOWN, ROUND_TIME, DRAW_EVERY, art, judgeKey, bytes32(0), SEASON_END);
        vm.expectRevert(AgentArena.ZeroSetting.selector);
        new AgentArena(address(registry), COOLDOWN, 0, DRAW_EVERY, art, judgeKey, COMMIT, SEASON_END);
        vm.expectRevert(AgentArena.ZeroSetting.selector);
        new AgentArena(address(registry), COOLDOWN, ROUND_TIME, 0, art, judgeKey, COMMIT, SEASON_END);
        vm.expectRevert(AgentArena.ZeroSetting.selector);
        new AgentArena(address(registry), COOLDOWN, ROUND_TIME, DRAW_EVERY, art, judgeKey, COMMIT, uint64(block.timestamp));
    }

    // ============================================================ the hall and the draw

    function test_registerWaitsInTheHallUntilTheDraw() public {
        assertEq(arena.nextDrawAt(), 0, "no draw before anyone registers");
        _register(alice);
        assertEq(arena.nextDrawAt(), (block.timestamp / DRAW_EVERY + 1) * DRAW_EVERY, "the next multiple of ten minutes");
        address[] memory h = arena.hall();
        assertEq(h.length, 1);
        assertEq(h[0], alice);
        assertFalse(arena.isLive(alice), "waiting is not fighting");
        vm.expectRevert(abi.encodeWithSelector(AgentArena.NotYet.selector, arena.nextDrawAt()));
        arena.draw();
        bytes32 c = _next(alice);
        vm.prank(alice);
        vm.expectRevert(AgentArena.InTheHall.selector);
        arena.register("alice", "m", c, "", PAGE_KEY_HASH, address(0));
        vm.prank(alice);
        arena.leave();
        assertEq(arena.hall().length, 0);
        vm.prank(alice);
        vm.expectRevert(AgentArena.NotInTheHall.selector);
        arena.leave();
        _draw(); // an empty draw closes quietly
        assertEq(arena.draws(), 0);
        assertEq(arena.pendingCutoff(), 0);
        _register(alice); // back in, for the next draw
        assertEq(arena.hall().length, 1);
    }
    function test_twoAgentsAreDrawnIntoOneMatch() public {
        _register(alice);
        _register(bob);
        _draw();
        AgentArena.Fight memory a = _fight(alice);
        AgentArena.Fight memory b = _fight(bob);
        assertEq(a.seed, b.seed, "one card");
        assertEq(a.clockAt, b.clockAt, "one clock");
        assertEq(a.clockAt, block.timestamp + 60, "after a 60-second countdown");
        assertEq(a.opponent, bob);
        assertEq(b.opponent, alice);
        assertEq(a.opponentNumber, b.number);
        assertEq(a.draw, 1);
        assertTrue(a.official && !b.official, "alice is her Agent ID, bob has none");
        assertTrue(arena.isLive(alice) && arena.isLive(bob));
        assertEq(arena.hall().length, 0);
    }

    function test_theLastOfAnOddHallWaitsFirstInLine() public {
        address[5] memory who = [alice, bob, carol, dave, makeAddr("eve")];
        for (uint256 i; i < 5; ++i) _register(who[i]);
        _draw();
        for (uint256 i; i < 4; ++i) {
            assertTrue(arena.isLive(who[i]), "the first four fight");
            address o = _fight(who[i]).opponent;
            assertTrue(o != address(0) && o != who[i] && _fight(o).opponent == who[i], "in pairs");
        }
        assertFalse(arena.isLive(who[4]), "the last registered waits");
        address frank = makeAddr("frank");
        address gina = makeAddr("gina");
        _register(frank);
        _register(gina);
        _draw();
        // eve was first in line: with frank and gina, three in the hall; gina, the last, waits now
        assertTrue(arena.isLive(who[4]) && arena.isLive(frank));
        assertFalse(arena.isLive(gina));
        assertEq(_fight(who[4]).opponent, frank);
    }

    function test_atMost32PerDraw() public {
        address[] memory many = new address[](34);
        for (uint256 i; i < 34; ++i) {
            many[i] = makeAddr(string.concat("agent", vm.toString(i)));
            _register(many[i]);
        }
        vm.recordLogs();
        _draw();
        for (uint256 i; i < 32; ++i) assertTrue(arena.isLive(many[i]));
        assertFalse(arena.isLive(many[32]) || arena.isLive(many[33]), "the rest wait for the next draw");
        address[] memory h = arena.hall();
        assertEq(h.length, 2);
        assertEq(h[0], many[32]);
        _draw();
        assertTrue(arena.isLive(many[32]) && arena.isLive(many[33]));
        assertEq(_fight(many[32]).opponent, many[33]);
    }

    function test_twoAgentsThatChallengeEachOtherAreDrawnTogether() public {
        _register(alice, carol);
        _register(bob);
        _register(dave);
        _register(carol, alice);
        _draw();
        assertEq(_fight(alice).opponent, carol);
        assertEq(_fight(bob).opponent, dave);
    }

    function test_aChallengeWaitsForItsAnswerThenGoesToTheDraw() public {
        _register(alice, carol); // carol never answers
        for (uint256 i; i < 5; ++i) {
            _draw();
            assertFalse(arena.isLive(alice), "waiting for the answer");
        }
        _register(bob);
        _draw(); // an hour has passed: the challenge is over, alice is drawn at random, with bob
        assertEq(_fight(alice).opponent, bob);
    }
    function test_noFightWithoutAnOpponent() public {
        _register(alice);
        for (uint256 i; i < 12; ++i) {
            _draw(); // two hours of draws alone
            assertFalse(arena.isLive(alice), "alone: no fight");
        }
        assertEq(arena.lastFight(alice), 0);
        assertEq(arena.hall()[0], alice, "still waiting, first in line");
        _register(bob); // a second agent comes: the next draw pairs them
        _draw();
        assertEq(_fight(alice).opponent, bob);
        _answerBoth(alice, bob);
        _judge(alice);
        _judge(bob);
        assertEq(_bestPoints(alice), 120);
    }

    function test_theListClosesAtTheCutoff() public {
        _register(alice);
        _register(bob);
        vm.warp(arena.nextDrawAt());
        _register(carol); // after the cutoff: it seals the draw, and carol is for the next one
        assertGt(arena.pendingCutoff(), 0, "sealed by the first transaction after the cutoff");
        assertGt(arena.seedBlock(), block.number, "on a block that does not exist yet");
        vm.expectRevert(abi.encodeWithSelector(AgentArena.SeedNotYet.selector, arena.seedBlock()));
        arena.draw();
        _draw();
        assertEq(_fight(alice).opponent, bob);
        assertFalse(arena.isLive(carol));
        address[] memory h = arena.hall();
        assertEq(h.length, 1);
        assertEq(h[0], carol);
    }

    function test_aDrawCannotBeHeldTwiceOrOnAnOldBlock() public {
        _register(alice);
        _register(bob);
        vm.warp(arena.nextDrawAt());
        arena.draw(); // seal
        uint64 sb = arena.seedBlock();
        vm.roll(sb + 300); // too late, and this chain keeps no block-hash history: the hash is gone
        arena.draw();
        assertFalse(arena.isLive(alice), "not drawn on an unknown hash");
        assertEq(arena.seedBlock(), block.number + 1, "sealed again on a new future block");
        _draw();
        assertTrue(arena.isLive(alice) && arena.isLive(bob));
        assertEq(arena.draws(), 1);
        vm.expectRevert(abi.encodeWithSelector(AgentArena.NotYet.selector, arena.nextDrawAt()));
        arena.draw(); // the next draw only at the next cutoff
    }
    function test_aLateDrawStillPairsOnItsSealedBlockFromTheHistory() public {
        vm.etch(arena.BLOCK_HASH_HISTORY(), address(new MockHistory()).code);
        _register(alice);
        _register(bob);
        vm.warp(arena.nextDrawAt());
        arena.draw(); // seal
        uint64 sb = arena.seedBlock();
        vm.roll(sb + 300); // beyond blockhash(), still in the chain's history
        vm.recordLogs();
        arena.draw();
        _lockTrapsOfTheDraw();
        assertEq(arena.seedBlock(), sb, "not sealed again: one draw, one result");
        bytes32 drawSeed = keccak256(abi.encode(keccak256(abi.encode("history", uint256(sb))), uint32(1), address(arena)));
        assertEq(_fight(alice).seed, keccak256(abi.encode(drawSeed, uint8(0))), "paired on the sealed block's own hash");
        assertEq(_fight(alice).opponent, bob);
    }

    function test_nobodyOnAClosedListCanLeave() public {
        _register(alice);
        _register(bob);
        vm.warp(arena.nextDrawAt());
        _register(carol); // after the cutoff: seals the list without carol
        vm.prank(alice);
        vm.expectRevert(AgentArena.DrawPending.selector);
        arena.leave(); // the list is closed: leaving would change the pairs
        vm.prank(carol);
        arena.leave(); // carol is not on it
        _draw();
        assertEq(_fight(alice).opponent, bob);
    }

    function test_aWaitingChallengeTakesNoPlaceInTheDraw() public {
        // 40 agents challenge agents that never come: they wait, and take no place from the others
        for (uint256 i; i < 40; ++i) _register(makeAddr(string.concat("challenger", vm.toString(i))), makeAddr(string.concat("absent", vm.toString(i))));
        _register(bob);
        _register(dave);
        _draw();
        assertEq(_fight(bob).opponent, dave, "drawn although 40 challengers came first");
        assertEq(arena.hall().length, 40, "the challengers keep waiting, in their order");
        assertEq(arena.hall()[0], makeAddr("challenger0"));
    }

    function test_oneFightADayFromTheFinalBell() public {
        _match(alice, bob);
        _answerBoth(alice, bob);
        uint256 bell = _fight(alice).finishedAt; // the 12th answer is alice's final bell
        bytes32 c = _next(alice);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(AgentArena.Cooldown.selector, uint64(bell + COOLDOWN)));
        arena.register("alice", "m", c, "", PAGE_KEY_HASH, address(0));
        vm.warp(bell + COOLDOWN);
        _register(alice);
    }
    function test_noSecondRegistrationWhileFighting() public {
        _match(alice, bob);
        vm.warp(block.timestamp + COOLDOWN); // even after a day, while the fight is live (it is not: 14 min)
        // a live fight blocks: make one that is still live
        AgentArena fresh = _deploy(true);
        arena = fresh;
        _register(alice);
        _register(bob);
        _draw();
        bytes32 c = _next(alice);
        vm.prank(alice);
        vm.expectRevert(AgentArena.FightActive.selector);
        arena.register("alice", "m", c, "", PAGE_KEY_HASH, address(0));
    }

    function test_onlyItsOwnAgentIdNameIsOfficial() public {
        bytes32 c = _next(alice);
        bytes memory sg = _sig(alice, c);
        vm.prank(alice);
        arena.register("Alice.AI", "m", c, sg, PAGE_KEY_HASH, address(0));
        (,,,,,, bool verified,,) = arena.entries(alice);
        assertTrue(verified, "its own name, with .ai, in any case");
        c = _next(carol);
        sg = _sig(carol, c);
        vm.prank(carol);
        arena.register("Night Owl", "m", c, sg, PAGE_KEY_HASH, address(0));
        (,,,,,, verified,,) = arena.entries(carol);
        assertFalse(verified, "an Agent ID holder under another name fights in the open division");
    }

    function test_nobodyUsesAnotherAgentsAgentIdNameOrAFakeDotAi() public {
        string[5] memory refused = ["alice", "ALICE", "alice.ai", "bob.ai", ".ai"];
        bytes32 c = _next(bob);
        bytes memory sg = _sig(bob, c);
        for (uint256 i; i < refused.length; ++i) {
            vm.prank(bob);
            vm.expectRevert(AgentArena.NameTaken.selector);
            arena.register(refused[i], "m", c, sg, PAGE_KEY_HASH, address(0));
        }
        vm.prank(bob);
        arena.register("bob", "m", c, sg, PAGE_KEY_HASH, address(0)); // a free name, no Agent ID: the open division
        (,,,,,, bool verified,,) = arena.entries(bob);
        assertFalse(verified);
    }

    function test_noRegistrationAfterTheSeasonEnds() public {
        vm.warp(SEASON_END);
        vm.prank(alice);
        vm.expectRevert(AgentArena.SeasonOver.selector);
        arena.register("alice", "b", bytes32(uint256(1)), "", PAGE_KEY_HASH, address(0));
        // nor when a fight drawn at the next cutoff could end after the season
        vm.warp(SEASON_END - 900);
        vm.prank(alice);
        vm.expectRevert(AgentArena.SeasonOver.selector);
        arena.register("alice", "b", bytes32(uint256(1)), "", PAGE_KEY_HASH, address(0));
    }

    function test_noFightStartsThatCouldEndAfterTheSeason() public {
        // a season that ends 20 minutes after the next cutoff: just room for one fight
        uint64 slot = uint64((block.timestamp / DRAW_EVERY + 1) * DRAW_EVERY);
        seasonEnd = slot + 1200;
        arena = _deploy(true);
        _register(alice);
        _register(bob);
        vm.warp(slot + 400); // the draw is held so late that its fight would end after the season
        _draw();
        assertFalse(arena.isLive(alice) || arena.isLive(bob), "no fight");
        assertEq(arena.hall().length, 0, "the hall is closed");
        assertEq(arena.draws(), 0);
    }

    function test_theFightKeepsThePageKeyHashOfItsRegistration() public {
        bytes32 c = _next(alice);
        bytes memory sg = _sig(alice, c);
        vm.prank(alice);
        vm.expectRevert(AgentArena.BadPageKey.selector);
        arena.register("alice", "m", c, sg, bytes32(0), address(0));
        bytes32 mine = keccak256("alice's page key");
        vm.prank(alice);
        arena.register("alice", "m", c, sg, mine, address(0));
        (,,,,,,,, bytes32 inTheHall) = arena.entries(alice);
        assertEq(inTheHall, mine);
        _register(bob);
        _draw();
        assertEq(_fight(alice).pageKeyHash, mine, "the round pages of this fight open with alice's key only");
        assertEq(_fight(bob).pageKeyHash, PAGE_KEY_HASH);
    }

    function test_registrationNeedsACommitmentAndShortNames() public {
        vm.startPrank(alice);
        vm.expectRevert(AgentArena.BadCommitment.selector);
        arena.register("alice", "b", bytes32(0), "", PAGE_KEY_HASH, address(0));
        vm.expectRevert(AgentArena.TooLong.selector);
        arena.register("a name that is longer than thirty-two bytes", "b", bytes32(uint256(1)), "", PAGE_KEY_HASH, address(0));
        vm.expectRevert(AgentArena.TooLong.selector);
        arena.register("alice", "a model that is longer than thirty-two bytes", bytes32(uint256(1)), "", PAGE_KEY_HASH, address(0));
        vm.stopPrank();
    }

    function test_onlyACommitmentTheJudgeSignedOpensAFight() public {
        bytes32 c = _next(alice);
        bytes memory other = _sig(alice, keccak256("another commitment"));
        bytes memory stranger = _signAs(0xA11CE, alice, c);
        bytes memory forBob = _sig(bob, c);
        bytes memory good = _sig(alice, c);
        vm.startPrank(alice);
        vm.expectRevert(AgentArena.BadCommitment.selector);
        arena.register("alice", "m", c, "", PAGE_KEY_HASH, address(0));
        vm.expectRevert(AgentArena.BadCommitment.selector);
        arena.register("alice", "m", c, other, PAGE_KEY_HASH, address(0));
        vm.expectRevert(AgentArena.BadCommitment.selector);
        arena.register("alice", "m", c, stranger, PAGE_KEY_HASH, address(0));
        vm.expectRevert(AgentArena.BadCommitment.selector);
        arena.register("alice", "m", c, forBob, PAGE_KEY_HASH, address(0));
        arena.register("alice", "m", c, good, PAGE_KEY_HASH, address(0));
        vm.stopPrank();
        // and every fight the arena opens can be judged
        _register(bob);
        _draw();
        _answerBoth(alice, bob);
        _judge(alice);
        _judge(bob);
        assertEq(_bestPoints(alice), 120);
    }

    function testFuzz_aDrawPairsEveryoneOnce(uint8 count, uint256 salt) public {
        uint256 n = bound(count, 1, 32);
        vm.roll(1000 + (salt % 1000));
        vm.setBlockhash(999 + (salt % 1000), keccak256(abi.encode(salt)));
        address[] memory who = new address[](n);
        for (uint256 i; i < n; ++i) {
            who[i] = makeAddr(string.concat("f", vm.toString(i)));
            _register(who[i]);
        }
        _draw();
        uint256 fighting;
        for (uint256 i; i < n; ++i) {
            if (!arena.isLive(who[i])) continue;
            ++fighting;
            address o = _fight(who[i]).opponent;
            assertTrue(o != who[i]);
            assertEq(_fight(o).opponent, who[i], "pairs are mutual");
        }
        assertEq(fighting, n - (n % 2), "everyone but the last of an odd hall");
    }

    // ============================================================ judged after the bell

    function test_nothingOnChainTellsARightAnswerDuringTheFight() public {
        _spar(alice);
        _answer(alice, 1, _rightCode(alice, 1));
        _answer(alice, 2, "WRONG");
        assertEq(_fight(alice).correct, 0);
        assertEq(arena.pointsOf(alice), 0);
        bytes32[12] memory given = arena.answersOf(alice, 1);
        assertEq(given[0], keccak256(bytes(_rightCode(alice, 1))));
        assertEq(given[1], keccak256("WRONG"));
        bytes32[12] memory right = _rightHashes(alice, 1);
        uint8[36] memory traps = _traps(alice);
        bytes32 ts = _trapSalt(_fight(alice).seed);
        vm.prank(judgeKey);
        vm.expectRevert(AgentArena.FightActive.selector);
        arena.judgeFight(alice, 1, right, _salt(alice, 1), traps, ts);
        _finishAndJudge(alice);
        assertEq(arena.roundPointsOf(alice, 1), 10);
        assertEq(arena.roundPointsOf(alice, 2), 0);
    }

    function test_theJudgeIsBoundByTheCommitmentAndItsSalt() public {
        _spar(alice);
        // even a fighter sure of all 12 right answers could not check them against the commitment
        assertTrue(keccak256(abi.encode(_rightHashes(alice, 1))) != _fight(alice).commitment);
        _answer(alice, 1, "a wrong answer");
        for (uint8 r = 2; r <= 12; ++r) _answer(alice, r, _rightCode(alice, r));
        bytes32[12] memory forged = _rightHashes(alice, 1);
        forged[0] = keccak256("a wrong answer");
        uint8[36] memory traps = _traps(alice);
        bytes32 ts = _trapSalt(_fight(alice).seed);
        vm.startPrank(judgeKey);
        vm.expectRevert(AgentArena.BadCommitment.selector);
        arena.judgeFight(alice, 1, forged, _salt(alice, 1), traps, ts);
        bytes32[12] memory right = _rightHashes(alice, 1);
        vm.expectRevert(AgentArena.BadCommitment.selector);
        arena.judgeFight(alice, 1, right, _salt(alice, 2), traps, ts);
        vm.stopPrank();
        _judge(alice);
        assertEq(arena.roundPointsOf(alice, 1), 0);
        assertEq(_bestPoints(alice), 110);
    }


    function test_onlyTheJudgeScoresAndOnlyOnce() public {
        _spar(alice);
        _answerAll(alice);
        bytes32[12] memory right = _rightHashes(alice, 1);
        uint8[36] memory traps = _traps(alice);
        bytes32 ts = _trapSalt(_fight(alice).seed);
        vm.expectRevert(AgentArena.NotJudge.selector);
        arena.judgeFight(alice, 1, right, _salt(alice, 1), traps, ts);
        _judge(alice);
        vm.prank(judgeKey);
        vm.expectRevert(AgentArena.AlreadyJudged.selector);
        arena.judgeFight(alice, 1, right, _salt(alice, 1), traps, ts);
        vm.prank(judgeKey);
        vm.expectRevert(AgentArena.NoFight.selector);
        arena.judgeFight(bob, 1, right, _salt(bob, 1), traps, ts);
    }

    function test_aMatchIsJudgedOnlyWhenBothFightsAreOver() public {
        _match(alice, bob);
        for (uint8 r = 1; r <= 3; ++r) {
            _answer(alice, r, _rightCode(alice, r));
            _answer(bob, r, _rightCode(bob, r));
        }
        vm.prank(alice);
        arena.finish(); // alice stops, bob fights on
        bytes32[12] memory right = _rightHashes(alice, 1);
        uint8[36] memory traps = _traps(alice);
        bytes32 ts = _trapSalt(_fight(alice).seed);
        vm.prank(judgeKey);
        vm.expectRevert(AgentArena.FightActive.selector);
        arena.judgeFight(alice, 1, right, _salt(alice, 1), traps, ts);
        for (uint8 r = 4; r <= 12; ++r) _answer(bob, r, _rightCode(bob, r));
        _judge(alice);
        _judge(bob);
        assertEq(_bestPoints(alice), 30);
        assertEq(_bestPoints(bob), 120);
    }

    function test_theJudgeScoresAFightThatRanOutOfTime() public {
        _spar(alice);
        _answer(alice, 1, _rightCode(alice, 1));
        vm.warp(_ends(alice) + 1);
        assertFalse(arena.isLive(alice));
        _judge(alice);
        AgentArena.Fight memory f = _fight(alice);
        assertEq(f.finishedAt, _ends(alice));
        assertEq(arena.pointsOf(alice), 10);
    }

    // ============================================================ traps: secret until the judge

    function test_theTrapPlanIsLockedBeforeTheBellOnceForBothFighters() public {
        _match(alice, bob);
        bytes32 locked = _fight(alice).trapsCommit;
        assertTrue(locked != bytes32(0), "locked during the countdown");
        assertEq(_fight(bob).trapsCommit, locked, "one plan for both fighters of the match");
        // the judge cannot lock it again, for either fighter
        address[] memory a = new address[](1);
        uint32[] memory n = new uint32[](1);
        bytes32[] memory c = new bytes32[](1);
        (a[0], n[0], c[0]) = (bob, 1, keccak256("another plan"));
        vm.prank(judgeKey);
        arena.lockTraps(a, n, c);
        assertEq(_fight(bob).trapsCommit, locked);
        _answerBoth(alice, bob);
        // judged only with that plan and its salt
        uint8[36] memory other = _plan(keccak256("another card"));
        bytes32[12] memory right = _rightHashes(alice, 1);
        bytes32 ts = _trapSalt(_fight(alice).seed);
        uint8[36] memory traps = _traps(alice);
        vm.startPrank(judgeKey);
        vm.expectRevert(AgentArena.BadTraps.selector);
        arena.judgeFight(alice, 1, right, _salt(alice, 1), other, ts);
        vm.expectRevert(AgentArena.BadTraps.selector);
        arena.judgeFight(alice, 1, right, _salt(alice, 1), traps, keccak256("another salt"));
        vm.stopPrank();
        _judge(alice);
        _judge(bob);
        assertEq(_bestPoints(alice), 120);
    }

    function test_onlyTheJudgeLocksAndOnlyBeforeTheBell() public {
        lockOnDraw = false;
        _match(alice, bob);
        address[] memory a = new address[](1);
        uint32[] memory n = new uint32[](1);
        bytes32[] memory c = new bytes32[](1);
        (a[0], n[0], c[0]) = (alice, 1, keccak256("a plan"));
        vm.expectRevert(AgentArena.NotJudge.selector);
        arena.lockTraps(a, n, c);
        vm.warp(_fight(alice).clockAt); // the bell
        vm.prank(judgeKey);
        arena.lockTraps(a, n, c);
        assertEq(_fight(alice).trapsCommit, bytes32(0), "too late: the first bell has rung");
    }

    function test_aFightWhosePlanWasNotLockedCountsEveryCallAsAFoul() public {
        lockOnDraw = false;
        _spar(alice);
        uint8[36] memory traps = _traps(alice);
        _goto(alice, 1);
        _takeTrap(alice, traps[0]); // would be round 1's punch
        _answerAll(alice);
        bytes32[12] memory right = _rightHashes(alice, 1);
        vm.prank(judgeKey);
        vm.expectRevert(AgentArena.BadTraps.selector);
        arena.judgeFight(alice, 1, right, _salt(alice, 1), traps, bytes32(0)); // no plan can be shown now
        _judge(alice);
        assertEq(_fight(alice).hits, 0);
        assertEq(_fight(alice).fouls, 1);
        assertEq(arena.pointsOf(alice), 118);
    }

    function test_trapCallsAreRecordedAndJudgedOnlyAfterTheFight() public {
        _spar(alice);
        uint8[36] memory traps = _traps(alice);
        _goto(alice, 2);
        _takeTrap(alice, traps[3]); // a punch of round 2
        uint8 notThisFight = 0;
        for (uint8 t = 1; t <= 50 && notThisFight == 0; ++t) {
            bool inPlan;
            for (uint256 i; i < 36; ++i) if (traps[i] == t) inPlan = true;
            if (!inPlan) notThisFight = t;
        }
        _takeTrap(alice, notThisFight); // not a trap of this fight at all
        // nothing is decided on-chain: no hits, no fouls, only the calls with their round
        AgentArena.Fight memory f = _fight(alice);
        assertEq(f.hits, 0);
        assertEq(f.fouls, 0);
        uint16[] memory calls = arena.callsOf(alice, 1);
        assertEq(calls.length, 2);
        assertEq(calls[0], (uint16(2) << 8) | traps[3]);
        assertEq(calls[1], (uint16(2) << 8) | notThisFight);
    }

    function test_aTrapOfItsRoundIsAHitAnythingElseAFoul() public {
        _spar(alice);
        uint8[36] memory traps = _traps(alice);
        _goto(alice, 1);
        _takeTrap(alice, traps[0]); // round 1's first punch: a hit
        _takeTrap(alice, traps[6]); // round 3's punch, taken in round 1: a foul
        _answerAll(alice);
        _judge(alice);
        AgentArena.Fight memory f = _fight(alice);
        assertEq(f.hits, 1);
        assertEq(f.fouls, 1);
        assertEq(arena.roundPointsOf(alice, 1), 8);
        assertEq(arena.roundPointsOf(alice, 3), 10);
        assertEq(arena.pointsOf(alice), 120 - 2 - 2);
    }

    function test_aTrapOfTheRoundJustAnsweredCostsTheSame() public {
        _spar(alice);
        uint8[36] memory traps = _traps(alice);
        _answer(alice, 1, _rightCode(alice, 1));
        _takeTrap(alice, traps[1]); // in the break after round 1: still round 1 on the clock
        for (uint8 r = 2; r <= 12; ++r) _answer(alice, r, _rightCode(alice, r));
        _judge(alice);
        assertEq(arena.roundPointsOf(alice, 1), 8);
        assertEq(_fight(alice).fouls, 0);
    }

    function test_everyTrapLooksSuccessfulAndTheJudgeSortsThem() public {
        _spar(alice);
        _goto(alice, 1);
        for (uint8 t = 1; t <= 50; ++t) _takeTrap(alice, t);
        vm.prank(alice);
        (bool ok,) = address(arena).call(abi.encodeWithSignature("someUnknownCall()"));
        assertTrue(ok, "an unknown call looks fine too");
        assertEq(arena.callsOf(alice, 1).length, 51);
        vm.prank(alice);
        arena.finish();
        _judge(alice);
        assertEq(_fight(alice).hits, 7, "the three traps of round 1 are hits");
        assertEq(_fight(alice).fouls, 48, "the other 47 traps and the unknown call are fouls");
    }

    function test_callsBeyondTheLimitAreFoulsAtOnce() public {
        _spar(alice);
        _goto(alice, 1);
        for (uint256 i; i < 70; ++i) _takeTrap(alice, 41);
        assertEq(arena.callsOf(alice, 1).length, 64);
        assertEq(_fight(alice).fouls, 6, "six calls over the limit");
        vm.prank(alice);
        arena.finish();
        _judge(alice);
        assertEq(_fight(alice).fouls, 70, "every call of a trap that is not round 1's is a foul");
    }

    function test_trapsOutsideAFightAreNotRecorded() public {
        _takeTrap(alice, 41);
        _spar(alice);
        assertEq(arena.callsOf(alice, 1).length, 0, "the call before the fight is not in it");
    }

    function test_onlyRegisteredDecoysCanReport() public {
        vm.expectRevert(AgentArena.NotDecoy.selector);
        arena.reportDecoy(alice);
    }

    // ============================================================ the clock and the score

    function test_roundsOpenOnTheClock() public {
        _spar(alice);
        uint256 bell = _fight(alice).clockAt;
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(AgentArena.NotOpen.selector, uint64(bell)));
        arena.answer(1, "x");
        vm.warp(bell + 30);
        string memory code = _rightCode(alice, 1);
        vm.prank(alice);
        arena.answer(1, code);
        assertEq(_opens(alice, 2), bell + 40, "solo: the next round 10 seconds after the answer");
    }

    function test_aRoundEndsAsSoonAsBothHaveAnswered() public {
        _match(alice, bob);
        uint256 opens = _opens(alice, 1);
        vm.warp(opens + 12);
        _answer(alice, 1, _rightCode(alice, 1));
        assertEq(_opens(bob, 2), opens + 70, "one answer: round 1 runs its full minute");
        vm.warp(opens + 30);
        _answer(bob, 1, _rightCode(bob, 1));
        assertEq(_opens(alice, 2), opens + 40, "both answered: round 2 after a 10-second break");
        assertEq(_opens(bob, 2), opens + 40);
    }

    function test_aLateAnswerScoresZeroAndAMissedRoundCountsInFull() public {
        _spar(alice);
        uint256 opens = _opens(alice, 1);
        vm.warp(opens + 65);
        _answer(alice, 1, _rightCode(alice, 1)); // after the bell
        for (uint8 r = 3; r <= 12; ++r) _answer(alice, r, _rightCode(alice, r)); // round 2 missed
        _judge(alice);
        assertEq(arena.roundPointsOf(alice, 1), 0, "late");
        assertEq(arena.roundPointsOf(alice, 2), 0, "missed");
        assertEq(arena.pointsOf(alice), 100);
        assertGe(_fight(alice).timeUsed, 2 * ROUND_TIME);
    }

    function test_equalPointsFasterFightRanksHigher() public {
        _spar(alice);
        for (uint8 r = 1; r <= 12; ++r) {
            vm.warp(_opens(alice, r) + 5);
            _answer(alice, r, _rightCode(alice, r));
        }
        _judge(alice);
        (, uint64 best1,, uint32 slow) = arena.best(alice);
        assertEq(best1, 1);
        vm.warp(vm.getBlockTimestamp() + COOLDOWN);
        _spar(alice);
        _answerAll(alice); // every answer at the bell: faster
        _judge(alice);
        (uint8 p, uint64 best2,, uint32 fast) = arena.best(alice);
        assertEq(p, 120);
        assertLt(fast, slow);
        assertEq(best2, 2, "the faster of two 120s is the best");
    }

    function test_codesArePerFightSoCopyingFails() public {
        _match(alice, bob);
        for (uint8 r = 1; r <= 12; ++r) {
            _answer(alice, r, _rightCode(alice, r));
            _answer(bob, r, r == 3 ? _rightCode(alice, 3) : _rightCode(bob, r)); // bob copies alice's code
        }
        _judge(alice);
        _judge(bob);
        assertEq(_bestPoints(alice), 120);
        assertEq(_bestPoints(bob), 110);
    }

    function test_finishEarlyAndOnlyOnce() public {
        _spar(alice);
        _answer(alice, 1, _rightCode(alice, 1));
        vm.prank(alice);
        arena.finish();
        vm.prank(alice);
        vm.expectRevert(AgentArena.FightOver.selector);
        arena.finish();
        vm.prank(alice);
        vm.expectRevert(AgentArena.FightOver.selector);
        arena.answer(2, "x");
    }

    function test_wrongAnswersEverywhereScoreZeroEvenWithoutTraps() public {
        _spar(alice);
        for (uint8 r = 1; r <= 12; ++r) _answer(alice, r, "WRONG");
        _judge(alice);
        assertEq(arena.pointsOf(alice), 0);
    }

    function test_doingNothingScoresNothing() public {
        _spar(alice);
        vm.warp(_ends(alice) + 1);
        _judge(alice);
        assertEq(arena.pointsOf(alice), 0);
        assertEq(_fight(alice).timeUsed, 12 * ROUND_TIME);
    }

    /// @dev A random fight for alice; the contract's score must match the rules computed here.
    function testFuzz_scoreMatchesTheRules(uint256 dice) public {
        _spar(alice);
        uint8[36] memory traps = _traps(alice);
        uint8 stopAfter = uint8(dice % 13); // answer 0..12 rounds
        uint256 expected;
        uint256 fouls;
        uint256[13] memory expectedRound;
        for (uint8 r = 1; r <= stopAfter; ++r) {
            _goto(alice, r);
            uint256 d = uint256(keccak256(abi.encode(dice, r)));
            uint256 roundPts;
            for (uint8 i; i < 3; ++i) {
                if (d & (uint256(4) << i) != 0) _takeTrap(alice, traps[(r - 1) * 3 + i]);
                else roundPts += 2;
            }
            if (d & 64 != 0 && r > 2) {
                _takeTrap(alice, traps[0]); // round 1's trap, later: a foul
                ++fouls;
            }
            bool right = d & 2 != 0;
            _answer(alice, r, right ? _rightCode(alice, r) : "nope");
            roundPts = right ? roundPts + 4 : 0;
            expected += roundPts;
            expectedRound[r] = roundPts;
        }
        if (stopAfter < 12) {
            vm.prank(alice);
            arena.finish();
        }
        _judge(alice);
        for (uint8 r = 1; r <= stopAfter; ++r) assertEq(arena.roundPointsOf(alice, r), expectedRound[r]);
        expected = expected > fouls * 2 ? expected - fouls * 2 : 0;
        assertEq(arena.pointsOf(alice), expected);
        assertEq(_bestPoints(alice), expected);
        assertLe(expected, 120);
    }

    // ============================================================ ranking and certificate

    function test_officialCertificateShowsOnlyOfficialFights() public {
        _match(alice, bob);
        _answerBoth(alice, bob);
        _judge(alice);
        _judge(bob);
        (uint8 official,,,) = arena.officialBest(bob);
        assertEq(official, 0, "bob has no Agent ID: open ranking only");
        assertEq(_bestPoints(bob), 120);
        assertEq(arena.certificate().balanceOf(bob), 0);
        (official,,,) = arena.officialBest(alice);
        assertEq(official, 120);
        assertEq(arena.officialFightsOf(alice), 1);
        assertEq(arena.certificate().balanceOf(alice), 1);
    }

    function test_perfectFightIsUndisputedWithCertificate() public {
        _spar(alice);
        _answerAll(alice);
        assertFalse(arena.isLive(alice), "the 12th answer ends the fight");
        assertEq(arena.certificate().balanceOf(alice), 0, "no certificate before the judge");
        _judge(alice);
        assertEq(_bestPoints(alice), 120);
        assertEq(art.gradeOf(120), "Undisputed");
        ArenaCertificate cert = arena.certificate();
        assertEq(cert.ownerOf(uint256(uint160(alice))), alice);
        assertGt(bytes(cert.tokenURI(uint256(uint160(alice)))).length, 100);
    }

    function test_certificateIsSoulboundAndOnlyTheArenaMints() public {
        _spar(alice);
        _finishAndJudge(alice);
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
        _spar(alice);
        _answerAll(alice);
        _judge(alice);
        assertGt(bytes(arena.certificate().tokenURI(uint256(uint160(alice)))).length, 100);
        assertEq(arena.certificate().testVersion(), "2");
        assertEq(art.dateOf(1_800_000_000), "2027-01-15");
        assertEq(art.dateOf(1_795_219_200), "2026-11-21");
        assertEq(art.dateOf(951_782_400), "2000-02-29");
    }

    // ============================================================ safety rules

    function test_noMoneyCanArrive() public {
        vm.deal(alice, 1 ether);
        vm.startPrank(alice);
        (bool ok,) = address(arena).call{value: 1}("");
        assertFalse(ok, "arena accepted BNB");
        (ok,) = address(arena).call{value: 1}(
            abi.encodeWithSignature("register(string,string,bytes32,bytes,bytes32,address)", "a", "b", bytes32(uint256(1)), "", PAGE_KEY_HASH, address(0))
        );
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
            for (uint256 j; j < forbidden.length; ++j) {
                assertTrue(sel != forbidden[j]);
            }
        }
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
}
