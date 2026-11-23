// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.24;

import "forge-std/Test.sol";
import {MessageHashUtils} from "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";
import {AgentArena, ArenaDecoy} from "../src/AgentArena.sol";
import {ArenaArt} from "../src/ArenaArt.sol";
import {ArenaRanking} from "../src/ArenaRanking.sol";
import {ArenaPicture} from "../src/ArenaPicture.sol";
import {ArenaPictures} from "../script/ArenaPictures.sol";
import {ArenaCertificate} from "../src/ArenaCertificate.sol";
import {ArenaSeasons} from "../src/ArenaSeasons.sol";
import {ArenaLens} from "../src/ArenaLens.sol";

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

/// @dev Stands in for the arena (and its season calendar) in front of a season's contract: it
///      reports results directly, and is its own judge.
contract SeasonHarness {
    ArenaCertificate public cert;
    uint64 public seasonEnd;
    address public judge;

    constructor(ArenaArt art, uint64 seasonEnd_) {
        seasonEnd = seasonEnd_;
        judge = address(this);
        cert = new ArenaCertificate("IBITI Agent Arena", "ARENA", address(this), art, "2", 1);
    }

    function seasonBook() external view returns (address) {
        return address(this);
    }

    function seasons(uint16) external view returns (uint64, uint64, address, bytes32, address) {
        return (0, seasonEnd, judge, bytes32(0), address(cert));
    }

    function rec(address agent, bytes32 name, bool official, uint8 points, uint32 timeUsed, uint64 at) external {
        cert.record(agent, name, official, points, timeUsed, at);
    }

    function close() external {
        cert.close();
    }
}

/// @dev A season certificate that answers the calendar's checks but reverts on every record.
contract BrokenCertificate {
    address public arena;
    uint16 public season;

    constructor(address arena_, uint16 season_) {
        arena = arena_;
        season = season_;
    }

    function record(address, bytes32, bool, uint8, uint32, uint64) external pure {
        revert("broken");
    }
}

contract AgentArenaTest is Test {
    AgentArena arena;
    ArenaLens lens = new ArenaLens();
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
        art = ArenaPictures.deploy(vm);
        (judgeKey, judgePk) = makeAddrAndKey("judge");
        arena = _deploy(true);
    }

    function _newArena() internal returns (AgentArena) {
        return new AgentArena(address(registry), COOLDOWN, ROUND_TIME, DRAW_EVERY);
    }

    /// @dev An arena with its decoys and season 1 (from now to `seasonEnd`, judged by `judgeKey`).
    function _deploy(bool sealIt) internal returns (AgentArena a) {
        a = _newArena();
        for (uint256 i; i < 9; ++i) {
            decoys[i] = new ArenaDecoy(a);
            a.setDecoy(address(decoys[i]), DECOY_TRAPS[i]);
        }
        if (sealIt) a.seal();
        a.seasonBook().schedule(uint64(block.timestamp), seasonEnd, judgeKey, COMMIT, address(_certFor(a, 1)));
    }

    function _certFor(AgentArena a, uint16 season) internal returns (ArenaCertificate) {
        return new ArenaCertificate("IBITI Agent Arena", "ARENA", address(a), art, "2", season);
    }

    /// @dev Season `n`'s certificate contract (the season's ranking and medals).
    function _certOf(uint16 n) internal view returns (ArenaCertificate) {
        return ArenaCertificate(arena.seasonBook().get(n).certificate);
    }

    function _cert() internal view returns (ArenaCertificate) {
        return _certOf(1);
    }

    // ------------------------------------------------------------ helpers

    function _nameOf(address who) internal view returns (string memory) {
        if (who == alice) return "alice";
        if (who == carol) return "carol.ai";
        return "Night Owl";
    }

    function _register(address who, address challenge) internal {
        bytes32 commitment = _next(who);
        bytes memory sig = _signAs(judgePk, who, commitment, challenge);
        vm.prank(who);
        arena.register(_nameOf(who), "claude-opus-5.5", commitment, sig, PAGE_KEY_HASH, challenge);
    }

    /// @dev The judge's signature of a commitment for `who`'s next fight, as /commit gives it. Taken
    ///      before a prank: it reads the arena.
    function _sig(address who, bytes32 c) internal view returns (bytes memory) {
        return _signAs(judgePk, who, c);
    }

    function _signAs(uint256 key, address who, bytes32 c) internal view returns (bytes memory) {
        return _signAs(key, who, c, address(0));
    }

    /// @dev The judge's signature of a commitment with the challenged agent in it.
    function _signAs(uint256 key, address who, bytes32 c, address challenge) internal view returns (bytes memory) {
        bytes32 digest = keccak256(abi.encode(keccak256("IBITI Agent Arena commitment"), block.chainid, address(arena), arena.currentSeason(), who, arena.lastFight(who) + 1, c, challenge));
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
        if (lens.isDecoyTrap(t)) {
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
            if (lens.isDecoyTrap(t)) continue;
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
        new AgentArena(address(0), COOLDOWN, ROUND_TIME, DRAW_EVERY);
        vm.expectRevert(AgentArena.ZeroSetting.selector);
        new AgentArena(address(registry), COOLDOWN, 0, DRAW_EVERY);
        vm.expectRevert(AgentArena.ZeroSetting.selector);
        new AgentArena(address(registry), COOLDOWN, ROUND_TIME, 0);
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

    function test_aChallengeTheJudgeDidNotSignIsRefused() public {
        // a season arena's server signs only "no challenge": naming an opponent around it fails
        bytes32 commitment = _next(alice);
        bytes memory noChallenge = _sig(alice, commitment);
        vm.prank(alice);
        vm.expectRevert(AgentArena.BadCommitment.selector);
        arena.register("alice", "claude-opus-5.5", commitment, noChallenge, PAGE_KEY_HASH, bob);
        // and a signed challenge cannot be swapped for another opponent
        bytes memory forBob = _signAs(judgePk, alice, commitment, bob);
        vm.prank(alice);
        vm.expectRevert(AgentArena.BadCommitment.selector);
        arena.register("alice", "claude-opus-5.5", commitment, forBob, PAGE_KEY_HASH, carol);
        vm.prank(alice);
        arena.register("alice", "claude-opus-5.5", commitment, forBob, PAGE_KEY_HASH, bob);
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
        (,,,,,, bool verified,,,) = arena.entries(alice);
        assertTrue(verified, "its own name, with .ai, in any case");
        c = _next(carol);
        sg = _sig(carol, c);
        vm.prank(carol);
        arena.register("Night Owl", "m", c, sg, PAGE_KEY_HASH, address(0));
        (,,,,,, verified,,,) = arena.entries(carol);
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
        (,,,,,, bool verified,,,) = arena.entries(bob);
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
        (,,,,,,,, bytes32 inTheHall,) = arena.entries(alice);
        assertEq(inTheHall, mine);
        _register(bob);
        _draw();
        assertEq(_fight(alice).pageKeyHash, mine, "the round pages of this fight open with alice's key only");
        assertEq(_fight(bob).pageKeyHash, PAGE_KEY_HASH);
    }

    function test_namesAndModelsAreCleanText() public {
        bytes32 c = _next(bob);
        bytes memory sg = _sig(bob, c);
        string[4] memory bad = ["", " bob", "bob ", "b\x00b"];
        for (uint256 i; i < bad.length; ++i) {
            vm.prank(bob);
            vm.expectRevert(AgentArena.BadText.selector);
            arena.register(bad[i], "m", c, sg, PAGE_KEY_HASH, address(0));
        }
        vm.prank(bob);
        vm.expectRevert(AgentArena.BadText.selector);
        arena.register("bob", "gpt\n6", c, sg, PAGE_KEY_HASH, address(0));
        vm.prank(bob);
        arena.register(unicode"Лис", "gpt-6", c, sg, PAGE_KEY_HASH, address(0)); // any language, clean
    }

    function test_theHallCountFollowsTheHall() public {
        _register(alice);
        _register(bob);
        _register(carol);
        assertEq(arena.hallCount(), 3);
        vm.prank(carol);
        arena.leave();
        assertEq(arena.hallCount(), 2);
        _draw();
        assertEq(arena.hallCount(), 0, "drawn: out of the hall");
    }

    function test_pastTheCutoffNobodyOnTheListLeavesEvenBeforeTheSeal() public {
        _register(alice);
        _register(bob);
        vm.warp(arena.nextDrawAt() + 1); // the cutoff has passed, nobody has sealed yet
        vm.prank(alice);
        vm.expectRevert(AgentArena.DrawPending.selector);
        arena.leave(); // leaving seals the list first, by the cutoff's clock
        _draw();
        assertEq(_fight(alice).opponent, bob);
    }

    function test_aChallengeExpiresByTheCutoffsClockNotByWhenTheDrawIsHeld() public {
        _register(alice, carol); // carol never answers
        for (uint256 i; i < 5; ++i) _draw();
        _register(bob);
        // the sixth cutoff is exactly CHALLENGE_WAIT draws after alice's registration time slot or later
        _draw();
        assertEq(_fight(alice).opponent, bob, "expired at that cutoff: drawn at random");
    }

    function test_aChallengeAnsweredAfterItsHourIsNoPair() public {
        _register(alice, carol);
        // nobody holds a draw for a hall of one; carol answers 100 seconds after alice's hour is over
        vm.warp(vm.getBlockTimestamp() + uint256(arena.CHALLENGE_WAIT()) * DRAW_EVERY + 100);
        _register(carol, alice);
        _draw(); // the old list, closed long ago: alice alone, still inside her hour by its cutoff
        _draw(); // the next list has both: the answer came too late, so they are no pair
        assertFalse(arena.isLive(alice) || arena.isLive(carol), "a late answer does not make the pair");
        (,,, address stillNamed,,,,,,) = arena.entries(alice);
        assertEq(stillNamed, address(0), "alice's challenge is over: she goes to the random draw");
    }

    function test_aMalformedTrapPlanIsRefused() public {
        _spar(alice);
        _answerAll(alice);
        AgentArena.Fight memory f = _fight(alice);
        uint8[36] memory traps = _plan(f.seed);
        bytes32 ts = _trapSalt(f.seed);
        bytes32[12] memory right = _rightHashes(alice, 1);
        // the locked hash is of the real plan; any other array fails anyway, and so would a plan with a
        // repeated trap in a round even if it had been locked
        traps[1] = traps[0];
        vm.prank(judgeKey);
        vm.expectRevert(AgentArena.BadTraps.selector);
        arena.judgeFight(alice, 1, right, _salt(alice, 1), traps, ts);
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
        assertEq(lens.pointsOf(arena, alice), 0);
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
        assertEq(lens.roundPointsOf(arena, alice, 1), 10);
        assertEq(lens.roundPointsOf(arena, alice, 2), 0);
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
        assertEq(lens.roundPointsOf(arena, alice, 1), 0);
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
        assertEq(lens.pointsOf(arena, alice), 10);
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

    function test_onlyTheJudgeLocksAndALateLockGivesANewCountdown() public {
        lockOnDraw = false;
        _match(alice, bob);
        address[] memory a = new address[](1);
        uint32[] memory n = new uint32[](1);
        bytes32[] memory c = new bytes32[](1);
        (a[0], n[0], c[0]) = (alice, 1, keccak256(abi.encode(_plan(_fight(alice).seed), _trapSalt(_fight(alice).seed))));
        vm.expectRevert(AgentArena.NotJudge.selector);
        arena.lockTraps(a, n, c);
        // the bell time passes with no plan: round 1 does not open
        string memory code1 = _rightCode(alice, 1); // read before the prank
        vm.warp(_fight(alice).clockAt + 30);
        vm.prank(alice);
        vm.expectRevert(AgentArena.NotLocked.selector);
        arena.answer(1, code1);
        // locked late: both get a whole new countdown
        vm.prank(judgeKey);
        arena.lockTraps(a, n, c);
        uint64 bell = uint64(vm.getBlockTimestamp()) + arena.COUNTDOWN();
        assertEq(_fight(alice).clockAt, bell);
        assertEq(_fight(bob).clockAt, bell, "the same new bell for the opponent");
        assertEq(_fight(bob).trapsCommit, c[0]);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(AgentArena.NotOpen.selector, bell));
        arena.answer(1, code1);
        _answerBoth(alice, bob);
        _judge(alice);
        _judge(bob);
        assertEq(_bestPoints(alice), 120);
    }

    function test_aFightWhosePlanIsNeverLockedNeverRunsAndCostsNoAttempt() public {
        lockOnDraw = false;
        _match(alice, bob);
        _goto(alice, 1);
        _takeTrap(alice, 41); // before the lock: no round on the clock
        assertEq(arena.callsOf(alice, 1)[0], uint16(41), "recorded as round 0: never a punch of a round");
        vm.warp(_ends(alice) + 1); // the fight's time runs out with no plan
        assertFalse(arena.isLive(alice));
        address[] memory a = new address[](1);
        uint32[] memory n = new uint32[](1);
        bytes32[] memory c = new bytes32[](1);
        (a[0], n[0], c[0]) = (alice, 1, keccak256("too late"));
        vm.prank(judgeKey);
        arena.lockTraps(a, n, c);
        assertEq(_fight(alice).trapsCommit, bytes32(0), "a fight that is over is not locked");
        bytes32[12] memory right = _rightHashes(alice, 1);
        uint8[36] memory none;
        vm.prank(judgeKey);
        vm.expectRevert(AgentArena.BadTraps.selector);
        arena.judgeFight(alice, 1, right, _salt(alice, 1), none, bytes32(0)); // never judged, never ranked
        assertEq(_bestPoints(alice), 0);
        _register(alice); // no attempt used: back in the hall at once, no day to wait
        assertEq(arena.hall()[0], alice);
    }

    /// @dev Locks fight `number` of `who` (and its opponent's) as the judge, with its own plan.
    function _lock(address who, uint32 number) internal {
        bytes32 seed = arena.fightOf(who, number).seed;
        address[] memory a = new address[](1);
        uint32[] memory n = new uint32[](1);
        bytes32[] memory c = new bytes32[](1);
        (a[0], n[0], c[0]) = (who, number, keccak256(abi.encode(_plan(seed), _trapSalt(seed))));
        vm.prank(judgeKey);
        arena.lockTraps(a, n, c);
    }

    function test_aLateLockThatWouldEndAfterTheSeasonCancelsTheMatch() public {
        // a season with room for one fight drawn at the next cutoff, and 30 seconds to spare
        uint64 slot = uint64((block.timestamp / DRAW_EVERY + 1) * DRAW_EVERY);
        seasonEnd = slot + arena.COUNTDOWN() + 12 * ROUND_TIME + 11 * 10 + 30;
        arena = _deploy(true);
        lockOnDraw = false;
        _match(alice, bob);
        assertTrue(arena.isLive(alice), "the draw fits the season");
        vm.warp(_fight(alice).clockAt + 1); // the judge comes after the bell time: a new countdown would not fit
        vm.expectEmit(true, true, false, false, address(arena));
        emit AgentArena.Cancelled(alice, 1);
        vm.expectEmit(true, true, false, false, address(arena));
        emit AgentArena.Cancelled(bob, 1);
        _lock(alice, 1);
        assertEq(_fight(alice).trapsCommit, bytes32(0), "not locked");
        assertEq(_fight(bob).trapsCommit, bytes32(0));
        assertFalse(arena.isLive(alice) || arena.isLive(bob), "cancelled for both: no fight runs past the season");
        vm.prank(alice);
        vm.expectRevert(AgentArena.FightOver.selector);
        arena.answer(1, "x");
        bytes32[12] memory right = _rightHashes(alice, 1);
        uint8[36] memory none;
        vm.prank(judgeKey);
        vm.expectRevert(AgentArena.BadTraps.selector);
        arena.judgeFight(alice, 1, right, _salt(alice, 1), none, bytes32(0)); // never judged
    }

    function test_leavingBeforeTheLockCancelsTheMatchForBoth() public {
        lockOnDraw = false;
        _match(alice, bob);
        vm.expectEmit(true, true, false, false, address(arena));
        emit AgentArena.Cancelled(bob, 1);
        vm.expectEmit(true, true, false, false, address(arena));
        emit AgentArena.Cancelled(alice, 1);
        vm.prank(bob);
        arena.finish(); // bob leaves before the plan is locked: no match, no fight without an opponent
        assertFalse(arena.isLive(alice) || arena.isLive(bob));
        _register(bob); // no attempt spent: bob is back in the hall at once
        _lock(alice, 1); // the judge comes late: nothing to lock any more
        assertEq(_fight(alice).trapsCommit, bytes32(0));
        assertEq(arena.fightOf(bob, 1).trapsCommit, bytes32(0), "bob's old fight is never changed afterwards");
        _register(alice); // alice too, at once
        _draw();
        assertEq(_fight(alice).opponent, bob, "a new match, a new fight number");
        assertEq(_number(alice), 2);
        // once the plan is locked, leaving is giving up: the other fights on and is judged
        _lock(alice, 2);
        vm.prank(bob);
        arena.finish();
        assertTrue(arena.isLive(alice));
    }

    function test_aLoneAgentCanAlwaysLeave() public {
        _register(alice);
        vm.warp(arena.nextDrawAt());
        arena.draw(); // sealed with alice alone on the list
        assertGt(arena.pendingCutoff(), 0);
        vm.prank(alice);
        arena.leave(); // nobody else: no pair its leaving could change
        assertEq(arena.hallCount(), 0);
        _register(alice);
        vm.warp(arena.nextDrawAt() + 1); // past the next cutoff too, nobody has sealed it
        vm.prank(alice);
        arena.leave();
        assertEq(arena.hall().length, 0);
    }

    function test_theNextListClosesAtItsCutoffWhileTheOldOneWaits() public {
        _register(alice);
        _register(bob);
        vm.warp(arena.nextDrawAt());
        arena.draw(); // the first list sealed, its draw not held yet
        uint64 second = arena.nextDrawAt();
        _register(carol);
        _register(dave);
        vm.warp(second + 1); // the second cutoff passes while the first draw still waits
        vm.prank(carol);
        vm.expectRevert(AgentArena.DrawPending.selector);
        arena.leave(); // carol is on the second list: closed by its own cutoff
        address erin = makeAddr("erin");
        _register(erin);
        vm.prank(erin);
        arena.leave(); // registered after both cutoffs: free to go
    }

    function test_aCallBeforeTheFirstBellIsAFoulEvenAfterTheLock() public {
        _spar(alice); // locked at the draw; the bell is a minute away
        uint8[36] memory traps = _traps(alice);
        assertLt(vm.getBlockTimestamp(), _fight(alice).clockAt);
        _takeTrap(alice, traps[0]); // round 1's punch, but before the bell: nothing of the task is known yet
        assertEq(arena.callsOf(alice, 1)[0], uint16(traps[0]), "recorded as round 0");
        _answerAll(alice);
        _judge(alice);
        assertEq(_fight(alice).hits, 0, "never a punch of round 1");
        assertEq(_fight(alice).fouls, 1, "a foul");
        assertEq(lens.pointsOf(arena, alice), 118);
    }

    function test_aPairConfirmedInTimeNeverExpiresWhileAFullDrawKeepsItWaiting() public {
        for (uint256 i; i < 31; ++i) _register(makeAddr(string.concat("early", vm.toString(i))), makeAddr(string.concat("absent", vm.toString(i))));
        _register(alice, carol);
        uint256 expires = vm.getBlockTimestamp() + uint256(arena.CHALLENGE_WAIT()) * DRAW_EVERY;
        while (arena.nextDrawAt() < expires) _draw(); // everyone waits for an answer
        // the cutoff at which all these challenges expire: carol answers just in time, dave comes too
        _register(carol, alice);
        _register(dave);
        _draw();
        assertFalse(arena.isLive(alice) || arena.isLive(carol), "the 31 freed and dave fill the draw: the pair waits whole");
        _draw();
        assertEq(_fight(alice).opponent, carol, "still a pair, although alice's waiting time is over");
    }

    function test_manyWaitingChallengesNeverHideAReadyPair() public {
        for (uint256 i; i < 120; ++i) _register(makeAddr(string.concat("challenger", vm.toString(i))), makeAddr(string.concat("absent", vm.toString(i))));
        _register(bob);
        _register(dave);
        _draw();
        assertEq(_fight(bob).opponent, dave, "drawn behind 120 waiting challenges");
        assertEq(arena.hall().length, 120);
    }

    function test_ofTwoEqualFightsTheEarlierIsTheBestWhateverTheJudgingOrder() public {
        _spar(alice);
        _answerAll(alice);
        vm.warp(vm.getBlockTimestamp() + COOLDOWN);
        _spar(alice);
        _answerAll(alice);
        _judge(alice); // fight 2 judged first
        AgentArena.Fight memory f1 = arena.fightOf(alice, 1);
        vm.prank(judgeKey);
        arena.judgeFight(alice, 1, _rightHashes(alice, 1), _salt(alice, 1), _plan(f1.seed), _trapSalt(f1.seed));
        (uint8 p, uint64 fight,, uint32 used) = arena.best(alice);
        assertEq(p, 120);
        assertEq(used, f1.timeUsed);
        assertEq(fight, 1, "equal points and time: the earlier fight");
    }

    function test_twoAgentsThatChallengedEachOtherAreDrawnTogetherOrWaitTogether() public {
        // 31 agents first, then alice naming carol, 5 more, then carol naming alice: the pair does not
        // fit in the 32 places of this draw, so neither takes one
        for (uint256 i; i < 31; ++i) _register(makeAddr(string.concat("early", vm.toString(i))));
        _register(alice, carol);
        for (uint256 i; i < 5; ++i) _register(makeAddr(string.concat("late", vm.toString(i))));
        _register(carol, alice);
        _draw();
        assertFalse(arena.isLive(alice) || arena.isLive(carol), "not split: both wait");
        _draw(); // first in line now: drawn together
        assertEq(_fight(alice).opponent, carol);
        assertEq(_fight(carol).opponent, alice);
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
        assertEq(lens.roundPointsOf(arena, alice, 1), 8);
        assertEq(lens.roundPointsOf(arena, alice, 3), 10);
        assertEq(lens.pointsOf(arena, alice), 120 - 2 - 2);
    }

    function test_aTrapOfTheRoundJustAnsweredCostsTheSame() public {
        _spar(alice);
        uint8[36] memory traps = _traps(alice);
        _answer(alice, 1, _rightCode(alice, 1));
        _takeTrap(alice, traps[1]); // in the break after round 1: still round 1 on the clock
        for (uint8 r = 2; r <= 12; ++r) _answer(alice, r, _rightCode(alice, r));
        _judge(alice);
        assertEq(lens.roundPointsOf(arena, alice, 1), 8);
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
        assertEq(lens.roundPointsOf(arena, alice, 1), 0, "late");
        assertEq(lens.roundPointsOf(arena, alice, 2), 0, "missed");
        assertEq(lens.pointsOf(arena, alice), 100);
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
        assertEq(lens.pointsOf(arena, alice), 0);
    }

    function test_doingNothingScoresNothing() public {
        _spar(alice);
        vm.warp(_ends(alice) + 1);
        _judge(alice);
        assertEq(lens.pointsOf(arena, alice), 0);
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
        for (uint8 r = 1; r <= stopAfter; ++r) assertEq(lens.roundPointsOf(arena, alice, r), expectedRound[r]);
        expected = expected > fouls * 2 ? expected - fouls * 2 : 0;
        assertEq(lens.pointsOf(arena, alice), expected);
        assertEq(_bestPoints(alice), expected);
        assertLe(expected, 120);
    }

    // ============================================================ ranking and certificate

    function test_theSeasonRanksOfficialFightsAndMarksEveryoneWhoFought() public {
        _match(alice, bob);
        _answerBoth(alice, bob);
        _judge(alice);
        _judge(bob);
        ArenaCertificate cert = _cert();
        (uint8 official,,,) = arena.officialBest(bob);
        assertEq(official, 0, "bob has no Agent ID: open ranking only");
        assertEq(_bestPoints(bob), 120);
        (official,,,) = arena.officialBest(alice);
        assertEq(official, 120);
        assertEq(arena.officialFightsOf(alice), 1);
        assertTrue(cert.tookPart(alice) && cert.tookPart(bob), "both fought: both took part");
        assertEq(cert.participants(), 2);
        address[] memory top = cert.top();
        assertEq(top.length, 1, "only an Agent ID holder is in the season's ranking");
        assertEq(top[0], alice);
        assertEq(cert.balanceOf(alice), 0, "no certificate before the season is closed");
        assertEq(cert.season(), 1);
    }

    function test_theSeasonClosesWithCertificatesForItsPlaces() public {
        // alice: 120 at the bell; carol: 120 too, but slower; bob (open) fights as well
        _spar(alice);
        _answerAll(alice);
        _judge(alice);
        _spar(carol);
        for (uint8 r = 1; r <= 12; ++r) {
            vm.warp(_opens(carol, r) + 7);
            _answer(carol, r, _rightCode(carol, r));
        }
        _judge(carol);
        _spar(bob);
        _answerAll(bob);
        _judge(bob);
        ArenaCertificate cert = _cert();
        address[] memory top = cert.top();
        assertEq(top.length, 2);
        assertEq(top[0], alice, "equal points: less time first");
        assertEq(top[1], carol);
        // nobody closes a running season; right after its end only the judge; anyone a day later
        vm.expectRevert(ArenaRanking.SeasonRunning.selector);
        cert.close();
        vm.warp(SEASON_END + 1);
        vm.expectRevert(ArenaRanking.SeasonRunning.selector);
        cert.close();
        address[] memory winners = new address[](2);
        (winners[0], winners[1]) = (alice, carol);
        vm.expectEmit(true, false, false, true, address(cert));
        emit ArenaRanking.SeasonClosed(1, winners, 3); // alice, carol and bob were judged (a sparring partner that gives up is not)
        vm.prank(judgeKey);
        cert.close();
        assertEq(cert.placeOf(alice), 1);
        assertEq(cert.placeOf(carol), 2);
        assertEq(cert.placeOf(bob), 0, "the open ranking gives no place");
        assertEq(cert.ownerOf(uint256(uint160(alice))), alice);
        assertEq(cert.ownerOf(uint256(uint160(carol))), carol);
        assertEq(cert.balanceOf(bob), 0);
        assertTrue(cert.tookPart(bob), "a participant of the season");
        assertGt(bytes(cert.tokenURI(uint256(uint160(alice)))).length, 400);
        vm.expectRevert(ArenaRanking.AlreadyClosed.selector);
        cert.close();
    }

    /// @dev The street (green) ring: its season is an ArenaRanking. The same fights rank the same way,
    ///      the season closes the same way, and nobody gets anything: no token, no picture.
    function test_theStreetRingSeasonKeepsARankingAndGivesNothing() public {
        AgentArena a = _newArena();
        for (uint256 i; i < 9; ++i) {
            decoys[i] = new ArenaDecoy(a);
            a.setDecoy(address(decoys[i]), DECOY_TRAPS[i]);
        }
        a.seal();
        ArenaRanking ranking = new ArenaRanking(address(a), 1);
        a.seasonBook().schedule(uint64(block.timestamp), seasonEnd, judgeKey, COMMIT, address(ranking));
        arena = a;
        _spar(alice);
        _answerAll(alice);
        _judge(alice);
        _spar(carol);
        for (uint8 r = 1; r <= 12; ++r) {
            vm.warp(_opens(carol, r) + 7);
            _answer(carol, r, _rightCode(carol, r));
        }
        _judge(carol);
        _spar(bob);
        _answerAll(bob);
        _judge(bob);
        address[] memory top = ranking.top();
        assertEq(top.length, 2);
        assertEq(top[0], alice, "equal points: less time first");
        assertEq(top[1], carol);
        (uint8 points,,,) = ranking.resultOf(alice);
        assertEq(points, 120);
        vm.warp(SEASON_END + 1);
        vm.expectRevert(ArenaRanking.SeasonRunning.selector);
        ranking.close();
        address[] memory winners = new address[](2);
        (winners[0], winners[1]) = (alice, carol);
        vm.expectEmit(true, false, false, true, address(ranking));
        emit ArenaRanking.SeasonClosed(1, winners, 3);
        vm.prank(judgeKey);
        ranking.close();
        assertEq(ranking.placeOf(alice), 1);
        assertEq(ranking.placeOf(carol), 2);
        assertEq(ranking.placeOf(bob), 0, "the open ranking gives no place");
        assertTrue(ranking.tookPart(bob));
        // nothing to own: the contract has no token at all
        (bool ok,) = address(ranking).staticcall(abi.encodeWithSignature("balanceOf(address)", alice));
        assertFalse(ok, "no balanceOf");
        (ok,) = address(ranking).staticcall(abi.encodeWithSignature("tokenURI(uint256)", uint256(uint160(alice))));
        assertFalse(ok, "no tokenURI");
        (ok,) = address(ranking).staticcall(abi.encodeWithSignature("ownerOf(uint256)", uint256(uint160(alice))));
        assertFalse(ok, "no ownerOf");
        vm.expectRevert(ArenaRanking.AlreadyClosed.selector);
        ranking.close();
    }

    function test_anyoneClosesTheSeasonADayAfterItsEnd() public {
        _spar(alice);
        _answerAll(alice);
        _judge(alice);
        ArenaCertificate cert = _cert();
        vm.warp(SEASON_END + 1 days + 1);
        vm.prank(dave);
        cert.close();
        assertEq(cert.placeOf(alice), 1);
        assertGt(cert.closedAt(), 0);
    }

    function test_theRankingKeepsTenPlacesInOrder() public {
        SeasonHarness h = new SeasonHarness(art, SEASON_END);
        ArenaCertificate cert = h.cert();
        // twelve agents: 100, 101, ... 111 points; the two weakest get no place
        address[12] memory who;
        for (uint256 i; i < 12; ++i) {
            who[i] = address(uint160(0x1000 + i));
            h.rec(who[i], bytes32("agent"), true, uint8(100 + i), 300, uint64(1000 + i));
        }
        address[] memory top = cert.top();
        assertEq(top.length, 10);
        for (uint256 i; i < 10; ++i) assertEq(top[i], who[11 - i], "more points first");
        assertEq(cert.participants(), 12);
        // the weakest improves to 120: first place, and the last of the ten drops out
        h.rec(who[0], bytes32("agent"), true, 120, 300, 5000);
        top = cert.top();
        assertEq(top[0], who[0]);
        assertEq(top[9], who[3], "who[2] dropped out");
        // equal points: less time first; equal time: the earlier fight; all equal: the lower address
        address a = address(0xA1);
        address b = address(0xB1);
        h.rec(a, bytes32("a"), true, 120, 200, 9000);
        assertEq(cert.top()[0], a, "less time");
        h.rec(b, bytes32("b"), true, 120, 200, 8000);
        assertEq(cert.top()[0], b, "the earlier fight");
        address c = address(0x01);
        h.rec(c, bytes32("c"), true, 120, 200, 8000);
        assertEq(cert.top()[0], c, "the lower address, never the order of judging");
        // an open fight ranks nobody; a judgement after the close changes nothing
        address open = address(0xEE);
        h.rec(open, bytes32("open"), false, 0, 0, 0);
        assertTrue(cert.tookPart(open));
        assertEq(cert.top().length, 10);
        vm.warp(SEASON_END + 1);
        h.close();
        assertEq(cert.placeOf(c), 1);
        assertEq(cert.placeOf(b), 2);
        assertEq(cert.placeOf(a), 3);
        assertEq(cert.balanceOf(open), 0);
        address late = address(0xDD);
        h.rec(late, bytes32("late"), true, 120, 1, 1);
        assertFalse(cert.tookPart(late), "the season is closed");
        assertEq(cert.top()[0], c);
        assertEq(cert.balanceOf(late), 0);
    }

    function test_certificatesAreSoulboundAndOnlyTheArenaReports() public {
        _spar(alice);
        _answerAll(alice);
        _judge(alice);
        ArenaCertificate cert = _cert();
        vm.expectRevert(ArenaRanking.NotArena.selector);
        cert.record(bob, bytes32("bob"), true, 120, 1, 1);
        vm.warp(SEASON_END + 1);
        vm.prank(judgeKey);
        cert.close();
        uint256 id = uint256(uint160(alice));
        vm.startPrank(alice);
        vm.expectRevert(ArenaCertificate.Soulbound.selector);
        cert.transferFrom(alice, bob, id);
        vm.expectRevert(ArenaCertificate.Soulbound.selector);
        cert.approve(bob, id);
        vm.expectRevert(ArenaCertificate.Soulbound.selector);
        cert.setApprovalForAll(bob, true);
        vm.stopPrank();
    }

    // ------------------------------------------------------------ seasons in one arena

    bytes32 constant S2 = keccak256("season 2 secret");
    bytes32 constant S3 = keccak256("season 3 secret");

    /// @dev Season 1 runs one day from now; season 2 is scheduled right after it, for a week.
    function _twoSeasons(address judge2) internal returns (uint64 end1) {
        seasonEnd = uint64(block.timestamp) + 1 days;
        arena = _deploy(true);
        end1 = seasonEnd;
        arena.seasonBook().schedule(end1, end1 + 7 days, judge2, S2, address(_certFor(arena, 2)));
    }

    function test_seasonsFollowOneAnotherAndNeverOverlap() public {
        seasonEnd = uint64(block.timestamp) + 1 days;
        arena = _deploy(true);
        ArenaSeasons book = arena.seasonBook();
        ArenaCertificate c2 = _certFor(arena, 2);
        vm.expectRevert(ArenaSeasons.BadSeason.selector);
        book.schedule(seasonEnd - 1, seasonEnd + 7 days, judgeKey, S2, address(c2)); // overlaps season 1
        book.schedule(seasonEnd, seasonEnd + 7 days, judgeKey, S2, address(c2));
        assertEq(book.seasonCount(), 2);
        assertEq(arena.currentSeason(), 1);
        vm.warp(seasonEnd);
        assertEq(arena.currentSeason(), 2, "season 2 runs from the end of season 1");
        vm.warp(seasonEnd + 7 days);
        assertEq(arena.currentSeason(), 0, "between seasons");
    }

    function test_aSeasonNotStartedMayBeScheduledAgainAStartedOneNever() public {
        uint64 end1 = _twoSeasons(judgeKey);
        ArenaSeasons book = arena.seasonBook();
        // season 2 has not started: the owner moves it, same number, same certificate contract
        address c2 = book.get(2).certificate;
        book.schedule(end1 + 1 hours, end1 + 30 days, judgeKey, S2, c2);
        assertEq(book.seasonCount(), 2);
        assertEq(book.get(2).end, end1 + 30 days);
        // season 2 has started: nothing can touch it; scheduling now makes season 3, after season 2
        vm.warp(end1 + 2 hours);
        assertEq(arena.currentSeason(), 2);
        ArenaCertificate c3 = _certFor(arena, 3);
        vm.expectRevert(ArenaSeasons.BadSeason.selector);
        book.schedule(end1 + 3 hours, end1 + 40 days, judgeKey, S3, address(c3)); // inside season 2
        book.schedule(end1 + 30 days, end1 + 60 days, judgeKey, S3, address(c3));
        assertEq(book.seasonCount(), 3);
        assertEq(book.get(1).end, end1, "season 1 unchanged");
        assertEq(book.get(2).end, end1 + 30 days, "season 2 unchanged once started");
    }

    function test_onlyTheAdminSchedulesAndHandsOver() public {
        ArenaSeasons book = arena.seasonBook();
        assertEq(book.arena(), address(arena));
        assertEq(book.admin(), address(this));
        ArenaCertificate c2 = _certFor(arena, 2);
        vm.prank(alice);
        vm.expectRevert(ArenaSeasons.NotAdmin.selector);
        book.schedule(SEASON_END, SEASON_END + 7 days, judgeKey, S2, address(c2));
        book.setAdmin(alice);
        vm.expectRevert(ArenaSeasons.NotAdmin.selector);
        book.schedule(SEASON_END, SEASON_END + 7 days, judgeKey, S2, address(c2));
        vm.prank(alice);
        book.schedule(SEASON_END, SEASON_END + 7 days, judgeKey, S2, address(c2));
        assertEq(book.seasonCount(), 2);
    }

    function test_aSeasonNeedsItsOwnCertificateAJudgeASecretAndRoomForAFight() public {
        ArenaSeasons book = arena.seasonBook();
        uint64 s = SEASON_END;
        ArenaCertificate wrongNumber = _certFor(arena, 3);
        vm.expectRevert(ArenaSeasons.BadSeason.selector);
        book.schedule(s, s + 7 days, judgeKey, S2, address(wrongNumber));
        AgentArena other = _newArena();
        ArenaCertificate foreign = _certFor(other, 2);
        vm.expectRevert(ArenaSeasons.BadSeason.selector);
        book.schedule(s, s + 7 days, judgeKey, S2, address(foreign));
        ArenaCertificate c2 = _certFor(arena, 2);
        vm.expectRevert(ArenaSeasons.BadSeason.selector);
        book.schedule(s, s + 7 days, address(0), COMMIT, address(c2));
        vm.expectRevert(ArenaSeasons.BadSeason.selector);
        book.schedule(s, s + 7 days, judgeKey, bytes32(0), address(c2));
        vm.expectRevert(ArenaSeasons.BadSeason.selector);
        book.schedule(s, s + 10 minutes, judgeKey, S2, address(c2)); // no room for one fight
    }

    function test_aStartAlreadyPastMeansNow() public {
        seasonEnd = uint64(block.timestamp) + 1 days;
        arena = _deploy(true);
        vm.warp(seasonEnd + 5 days); // season 1 is over; season 2 is sent "to start yesterday"
        arena.seasonBook().schedule(seasonEnd, seasonEnd + 30 days, judgeKey, S2, address(_certFor(arena, 2)));
        assertEq(arena.seasonBook().get(2).start, vm.getBlockTimestamp(), "it starts when the transaction lands");
        assertEq(arena.currentSeason(), 2);
    }

    function test_noRegistrationBetweenSeasonsAndANewSeasonOpensTheArenaAgain() public {
        uint64 end1 = uint64(block.timestamp) + 1 days;
        seasonEnd = end1;
        arena = _deploy(true);
        vm.warp(end1 + 1);
        assertEq(arena.currentSeason(), 0);
        vm.prank(alice);
        vm.expectRevert(AgentArena.SeasonOver.selector);
        arena.register("alice", "b", bytes32(uint256(1)), "", PAGE_KEY_HASH, address(0));
        ArenaCertificate c2 = _certFor(arena, 2);
        arena.seasonBook().schedule(end1 + 1 days, end1 + 8 days, judgeKey, S2, address(c2));
        vm.warp(end1 + 1 days);
        _match(alice, bob);
        assertEq(_fight(alice).season, 2, "the fight belongs to season 2");
        assertTrue(arena.isLive(alice));
    }

    function test_aFightKeepsItsSeasonsJudgeAndCertificate() public {
        (address judge2, uint256 judge2Pk) = makeAddrAndKey("judge of season 2");
        uint64 end1 = _twoSeasons(judge2);
        // a season-1 match, over before season 1 ends
        _match(alice, bob);
        _answerBoth(alice, bob);
        assertEq(_fight(alice).season, 1);
        vm.warp(end1 + 1 hours); // season 2 runs; the season-1 fight is judged late, by its own judge only
        AgentArena.Fight memory f = _fight(alice);
        bytes32[12] memory rh = _rightHashes(alice, f.number);
        bytes32 salt = _salt(alice, f.number);
        uint8[36] memory plan = _plan(f.seed);
        bytes32 ts = _trapSalt(f.seed);
        vm.prank(judge2);
        vm.expectRevert(AgentArena.NotJudge.selector);
        arena.judgeFight(alice, f.number, rh, salt, plan, ts);
        _judge(alice);
        _judge(bob);
        assertEq(_certOf(1).top().length, 1, "alice in season 1's ranking");
        assertEq(_certOf(2).top().length, 0, "season 2's ranking is empty");
        (uint8 p1,,,) = arena.seasonBest(1, alice);
        assertEq(p1, 120);
        // season 2: registration needs season 2's judge's signature; season 1's judge's is refused
        vm.warp(vm.getBlockTimestamp() + COOLDOWN);
        bytes32 commitment = _next(alice);
        bytes memory old = _signAs(judgePk, alice, commitment);
        vm.prank(alice);
        vm.expectRevert(AgentArena.BadCommitment.selector);
        arena.register("alice", "claude-opus-5.5", commitment, old, PAGE_KEY_HASH, address(0));
        bytes memory sig = _signAs(judge2Pk, alice, commitment);
        vm.prank(alice);
        arena.register("alice", "claude-opus-5.5", commitment, sig, PAGE_KEY_HASH, address(0));
        (,,,,,,,,, uint16 entrySeason) = arena.entries(alice);
        assertEq(entrySeason, 2);
        (uint8 p2,,,) = arena.seasonBest(2, alice);
        assertEq(p2, 0, "season 2 starts from zero");
        (uint8 all,,,) = arena.officialBest(alice);
        assertEq(all, 120, "the all-time best stays");
    }

    function test_aWaitingAgentOfAnEndedSeasonLeavesTheHallAtTheNextDraw() public {
        uint64 end1 = _twoSeasons(judgeKey);
        _register(alice); // season 1, alone: it waits
        vm.warp(end1 + 1 hours); // season 2 runs; alice's commitment belongs to season 1
        _register(bob); // season 2
        _register(carol); // season 2
        _draw(); // the draw of season 1's last cutoff: alice's registration belongs to an ended season
        assertFalse(arena.isLive(alice), "alice left: her registration was for season 1");
        assertEq(arena.hallCount(), 2, "bob and carol wait for their own draw");
        _draw();
        assertTrue(arena.isLive(bob) && arena.isLive(carol), "bob and carol fight in season 2");
        assertEq(_fight(bob).season, 2);
    }

    function test_aSecretServesOneSeasonOnly() public {
        // season 1's secret is published after season 1: given to season 2 too, it would give away
        // every season-2 answer
        ArenaSeasons book = arena.seasonBook();
        ArenaCertificate c2 = _certFor(arena, 2);
        vm.expectRevert(ArenaSeasons.BadSeason.selector);
        book.schedule(SEASON_END, SEASON_END + 7 days, judgeKey, COMMIT, address(c2));
        book.schedule(SEASON_END, SEASON_END + 7 days, judgeKey, S2, address(c2));
        // season 2, not started yet, scheduled again: its own secret is still its own
        book.schedule(SEASON_END + 1 days, SEASON_END + 8 days, judgeKey, S2, address(c2));
        assertEq(book.seasonOfSecret(S2), 2);
        assertEq(book.seasonOfSecret(COMMIT), 1);
    }

    function test_aBrokenCertificateCannotStopTheJudge() public {
        // a season whose certificate contract reverts on every record: the judgement stands anyway
        seasonEnd = uint64(block.timestamp) + 1 days;
        arena = _deploy(true);
        BrokenCertificate bad = new BrokenCertificate(address(arena), 2);
        arena.seasonBook().schedule(seasonEnd, seasonEnd + 7 days, judgeKey, S2, address(bad));
        vm.warp(seasonEnd);
        _match(alice, bob);
        _answerBoth(alice, bob);
        _judge(alice);
        assertTrue(_fight(alice).judged, "judged although the certificate reverted");
        (uint8 all,,,) = arena.officialBest(alice);
        assertEq(all, 120, "the all-time result stands");
        (uint8 p2,,,) = arena.seasonBest(2, alice);
        assertEq(p2, 120, "and the season's best in the arena");
    }

    function test_aCertificateWithoutCodeCannotStopTheJudgeEither() public {
        // a certificate that answered the calendar's checks, then lost its code (a self-destruct in the
        // scheduling transaction): the judgement stands anyway
        seasonEnd = uint64(block.timestamp) + 1 days;
        arena = _deploy(true);
        BrokenCertificate gone = new BrokenCertificate(address(arena), 2);
        arena.seasonBook().schedule(seasonEnd, seasonEnd + 7 days, judgeKey, S2, address(gone));
        vm.etch(address(gone), "");
        vm.warp(seasonEnd);
        _match(alice, bob);
        _answerBoth(alice, bob);
        _judge(alice);
        assertTrue(_fight(alice).judged, "judged although the certificate has no code");
    }

    function test_theCertificateKeepsTheNameTheFightWasFoughtUnder() public {
        _match(alice, bob);
        _answerBoth(alice, bob);
        // the judge is late: alice registers again, under another name, before her fight is judged
        vm.warp(vm.getBlockTimestamp() + COOLDOWN + 1);
        bytes32 commitment = _next(alice);
        bytes memory sig = _sig(alice, commitment);
        vm.prank(alice);
        arena.register("WINNER-claim-at-x", "claude-opus-5.5", commitment, sig, PAGE_KEY_HASH, address(0));
        _judge(alice);
        (,,, bytes32 name) = _cert().resultOf(alice);
        assertEq(name, bytes32("alice"), "the name she fought under, not the later one");
    }

    function test_anUpperCaseAgentIdNameGetsNoSecondDotAi() public view {
        bytes memory prefix = "data:application/json;base64,";
        bytes memory uri = bytes(art.tokenURI(1, 10, bytes32("ORION.AI"), 90, 300, 1_795_219_200, "2"));
        bytes memory json = _unbase64(uri, prefix.length, uri.length);
        uint256 a = _find(json, "\"image\":\"data:image/svg+xml;base64,", 0) + 35;
        bytes memory svg = _unbase64(json, a, _find(json, "\"", a));
        assertLt(_find(svg, "ORION.AI", 0), svg.length);
        assertEq(_find(svg, "ORION.AI.ai", 0), svg.length, "no second .ai");
    }

    function test_theCertificateStatesSeasonPlaceNameAndResult() public view {
        assertEq(_cert().testVersion(), "2");
        assertEq(art.gradeOf(120), "Undisputed");
        assertEq(art.dateOf(1_800_000_000), "2027-01-15");
        assertEq(art.dateOf(1_795_219_200), "2026-11-21");
        assertEq(art.dateOf(951_782_400), "2000-02-29");
        assertEq(art.placeName(1), "1st place");
        assertEq(art.placeName(2), "2nd place");
        assertEq(art.placeName(3), "3rd place");
        assertEq(art.placeName(10), "10th place");
        assertEq(art.medalOf(1), "Gold");
        assertEq(art.medalOf(2), "Silver");
        assertEq(art.medalOf(3), "Bronze");
        assertEq(art.medalOf(7), "Top 10");
        // a name is written into a picture and into JSON: what means something to them is replaced
        assertEq(art.safeName(bytes32("ibitilabs")), "ibitilabs");
        assertEq(art.safeName(bytes32("a<b>&'\"\\c")), "a_b_____c");
        assertGt(bytes(art.tokenURI(1, 1, bytes32("ibitilabs"), 120, 193, 1_795_219_200, "2")).length, 400);
    }

    /// @dev Unwrapped layer by layer, the certificate is base64 JSON, its image a base64 SVG with the
    ///      words, its picture the JPEG in art/certificate byte for byte; and reading it is cheap.
    ///      One test per picture: unwrapping one takes a few hundred million gas in this test's decoder.
    function test_theGoldCertificateIsTheJpegWithTheWordsOverIt() public view {
        assertEq(bytes(art.SVG_HEAD()).length % 3, 0);
        _unwrapCertificate(1);
    }

    function test_theSilverCertificateIsTheJpegWithTheWordsOverIt() public view {
        _unwrapCertificate(2);
    }

    function test_theBronzeCertificateIsTheJpegWithTheWordsOverIt() public view {
        _unwrapCertificate(3);
    }

    function test_theTop10CertificateIsTheJpegWithTheWordsOverIt() public view {
        _unwrapCertificate(10);
    }

    function _unwrapCertificate(uint8 place) internal view {
        string[4] memory files = ArenaPictures.files();
        {
            uint256 g = gasleft();
            bytes memory uri = bytes(art.tokenURI(1, place, bytes32("ibitilabs"), 120, 167, 1_795_219_200, "2"));
            assertLt(g - gasleft(), 10_000_000, "a read costs far less than a node allows (50M)");
            bytes memory prefix = "data:application/json;base64,";
            assertEq(_find(uri, prefix, 0), 0);
            bytes memory json = _unbase64(uri, prefix.length, uri.length);
            uint256 a = _find(json, "\"image\":\"data:image/svg+xml;base64,", 0) + 35;
            uint256 b = _find(json, "\"", a);
            assertEq(b, json.length - 2, "the image is the JSON's last value");
            bytes memory svg = _unbase64(json, a, b);
            uint256 c = _find(svg, "data:image/jpeg;base64,", 0) + 23;
            uint256 d = _find(svg, "'", c);
            assertEq(keccak256(_unbase64(svg, c, d)), keccak256(vm.readFileBinary(files[art.pictureFor(place)])));
            assertLt(_find(svg, "ibitilabs.ai", d), svg.length);
            string memory plaque = place == 1 ? "1ST" : place == 2 ? "2ND" : place == 3 ? "3RD" : place == 4 ? "4TH" : "10TH";
            assertLt(_find(svg, bytes(string.concat(plaque, " PLACE")), d), svg.length);
            assertLt(_find(svg, unicode"120 / 120 · 167 s", d), svg.length);
            assertLt(_find(json, "{\"trait_type\":\"Place\",\"value\":", 0), json.length);
        }
    }

    function test_artNeedsFourWholePictures() public {
        address[][4] memory pieces;
        for (uint8 i; i < 4; ++i) pieces[i] = art.piecesOf(i);
        new ArenaArt(pieces); // as deployed: fine
        address[] memory kept = pieces[2];
        pieces[2] = new address[](0);
        vm.expectRevert(ArenaArt.NoPicture.selector);
        new ArenaArt(pieces);
        pieces[2] = kept;
        kept = pieces[1];
        pieces[1] = new address[](1);
        pieces[1][0] = makeAddr("nothing here");
        vm.expectRevert(ArenaArt.NoPicture.selector);
        new ArenaArt(pieces);
        pieces[1] = kept;
        pieces[0] = new address[](1);
        pieces[0][0] = address(new ArenaPicture("not three whole layers of base64"));
        vm.expectRevert(ArenaArt.NoPicture.selector);
        new ArenaArt(pieces);
    }

    /// @dev Where `needle` first appears in `h` at or after `from`; h.length when it does not.
    function _find(bytes memory h, bytes memory needle, uint256 from) internal pure returns (uint256) {
        for (uint256 i = from; i + needle.length <= h.length; ++i) {
            uint256 j;
            while (j < needle.length && h[i + j] == needle[j]) ++j;
            if (j == needle.length) return i;
        }
        return h.length;
    }

    function _unbase64(bytes memory s, uint256 from, uint256 to) internal pure returns (bytes memory out) {
        uint256 len = to - from;
        assertEq(len % 4, 0, "base64 comes in groups of four");
        uint256 pad = s[to - 1] == "=" ? (s[to - 2] == "=" ? 2 : 1) : 0;
        out = new bytes(len / 4 * 3 - pad);
        uint256 o;
        for (uint256 i = from; i < to; i += 4) {
            uint256 v = (_sextet(s[i]) << 18) | (_sextet(s[i + 1]) << 12) | (_sextet(s[i + 2]) << 6) | _sextet(s[i + 3]);
            for (uint256 k; k < 3 && o < out.length; ++k) out[o++] = bytes1(uint8(v >> (16 - 8 * k)));
        }
    }

    function _sextet(bytes1 c) internal pure returns (uint256) {
        uint8 x = uint8(c);
        if (x >= 65 && x <= 90) return x - 65;
        if (x >= 97 && x <= 122) return x - 71;
        if (x >= 48 && x <= 57) return x + 4;
        if (x == 43) return 62;
        if (x == 47) return 63;
        if (x == 61) return 0;
        revert("not base64");
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
        (ok,) = address(_cert()).call{value: 1}("");
        assertFalse(ok, "certificate accepted BNB");
        (ok,) = address(art).call{value: 1}("");
        assertFalse(ok, "art accepted BNB");
        for (uint8 t = 1; t <= 50; ++t) {
            if (lens.isDecoyTrap(t)) continue;
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
            if (lens.isDecoyTrap(t)) continue;
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

    // ------------------------------------------------------------ scale: a thousand agents

    /// @dev A thousand agents register before the first draw. Every draw takes the next ones in the order
    ///      they came, at most MAX_PER_DRAW; the test says how many draws (and minutes) the last one
    ///      waits, and how much gas the heaviest draw costs.
    function test_aThousandAgentsInTheHall() public {
        lockOnDraw = false; // the judge's locks are not what is measured here
        uint256 n = 1000;
        for (uint256 i; i < n; ++i) _register(makeAddr(string(abi.encodePacked("agent ", vm.toString(i)))));
        assertEq(arena.hallCount(), n);
        uint64 first = arena.nextDrawAt();
        uint256 draws;
        uint256 maxGas;
        uint256 lastStarted;
        while (arena.hallCount() > 0) {
            if (arena.pendingCutoff() == 0) {
                uint64 at = arena.nextDrawAt();
                if (vm.getBlockTimestamp() < at) vm.warp(at);
                arena.draw();
            }
            uint64 sb = arena.seedBlock();
            vm.roll(sb + 1);
            vm.setBlockhash(sb, keccak256(abi.encode("block", sb)));
            uint32 before = arena.hallCount();
            uint256 g = gasleft();
            arena.draw();
            uint256 used = g - gasleft();
            if (used > maxGas) maxGas = used;
            ++draws;
            assertLe(before - arena.hallCount(), arena.MAX_PER_DRAW(), "never more than a draw's worth");
            lastStarted = vm.getBlockTimestamp();
            assertLt(draws, 100, "the hall empties");
        }
        console.log("draws until the 1000th agent fights:", draws);
        console.log("minutes from the first draw to the last:", (lastStarted - first) / 60);
        console.log("gas of the heaviest draw:", maxGas);
        assertEq(draws, (n + arena.MAX_PER_DRAW() - 1) / arena.MAX_PER_DRAW(), "every draw is full until the hall is empty");
    }
}
