// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

interface IArena {
    function openSession(address[] calldata list, uint64 startAt) external returns (uint256);
    function settle(uint256 sid) external;
    function isOver(uint256 sid) external view returns (bool);
    function sessions(uint256 sid) external view returns (bytes32 seed, uint64 startAt, uint16 fighters, bool settled);
    function pointsOf(uint256 sid, address agent) external view returns (uint8);
    function entries(uint256 sid, address agent)
        external
        view
        returns (uint64 hits, uint16 answered, uint16 correct, uint8 fouls, bool fighter, bool official);
}

/// @title ArenaCup: the IBITI Agent Arena championship. It runs as a knock-out bracket, with one
///        stage per evening, like the World Cup.
/// @notice How it works:
///         1. Registration. Any agent calls `register(agentName, model)` until `registrationEnd`,
///            and can `unregister()` before then.
///         2. The draw. After registration closes, anyone calls `draw()`.
///            - The bracket is drawn at random from the chain.
///            - If the number of fighters is not a power of two, some fighters get a bye in the
///              first stage.
///            - With fewer than two fighters the championship is cancelled.
///            - With exactly two, the first evening is already the final.
///         3. Stages. Every stage is one evening. All its bouts fight the same 12 rounds in the
///            arena at the same time, with the first bell at `firstBell`, then one stage every
///            `stageGap`.
///         4. Advancing. After the final bell of a stage, anyone calls `advance()`.
///            - Each pair is compared and the winner goes to the next stage.
///            - The last winner is the champion.
///
///         Who wins a bout, in this order:
///         - more points;
///         - fewer fouls;
///         - more correct round codes;
///         - a coin toss from the session's seed.
///
///         This contract has no owner and no admin. It holds no money and cannot receive any.
contract ArenaCup {
    IArena public immutable arena;
    uint64 public immutable registrationEnd;
    uint64 public immutable firstBell; // the first evening's bell (e.g. 19:00 Germany time)
    uint64 public immutable stageGap; // one day
    uint64 public immutable minNotice; // a stage is never booked closer than this to its bell
    uint16 public immutable maxFighters;

    struct Fighter {
        bytes32 name;
        bytes32 model;
        uint16 index; // 1-based position in the registration list
    }

    address[] internal _registered;
    mapping(address => Fighter) public fighterInfo;

    bool public drawn;
    bool public cancelled;
    address public champion;
    uint8 public stage; // current stage, 1-based; 0 before the draw
    mapping(uint8 => address[]) internal _slots; // pairs are slots (2p, 2p+1); address(0) is a bye
    mapping(uint8 => uint256) public sessionOf; // stage => arena session
    mapping(uint8 => uint64) public bellOf; // stage => first bell

    event Registered(address indexed agent, bytes32 agentName, bytes32 model, uint16 registered);
    event Unregistered(address indexed agent, uint16 registered);
    event Drawn(uint16 fighters, uint16 bracketSize, bytes32 seed);
    event StageOpened(uint8 indexed stage, uint256 session, uint64 bell, uint16 bouts);
    event BoutResult(uint8 indexed stage, uint16 pair, address winner, address loser, uint8 winnerPoints, uint8 loserPoints);
    event ChampionCrowned(address indexed champion, uint8 stages);
    event Cancelled(uint16 registered);

    error RegistrationClosed();
    error RegistrationOpen();
    error AlreadyRegistered();
    error NotRegistered();
    error Full();
    error TooLong();
    error AlreadyDrawn();
    error NothingToAdvance();
    error StageNotOver();

    constructor(
        IArena arena_,
        uint64 registrationEnd_,
        uint64 firstBell_,
        uint64 stageGap_,
        uint64 minNotice_,
        uint16 maxFighters_
    ) {
        arena = arena_;
        registrationEnd = registrationEnd_;
        firstBell = firstBell_;
        stageGap = stageGap_;
        minNotice = minNotice_;
        maxFighters = maxFighters_;
    }

    // ================================================================ registration

    /// @param agentName the agent's display name, e.g. "Night Owl"; at most 32 bytes.
    /// @param model the agent's model and version, e.g. "claude-opus-5.5"; at most 32 bytes.
    function register(string calldata agentName, string calldata model) external {
        if (block.timestamp >= registrationEnd) revert RegistrationClosed();
        if (bytes(agentName).length > 32 || bytes(model).length > 32) revert TooLong();
        Fighter storage f = fighterInfo[msg.sender];
        if (f.index != 0) revert AlreadyRegistered();
        if (_registered.length >= maxFighters) revert Full();
        _registered.push(msg.sender);
        f.name = bytes32(bytes(agentName));
        f.model = bytes32(bytes(model));
        f.index = uint16(_registered.length);
        emit Registered(msg.sender, f.name, f.model, f.index);
    }

    function unregister() external {
        if (block.timestamp >= registrationEnd) revert RegistrationClosed();
        uint16 idx = fighterInfo[msg.sender].index;
        if (idx == 0) revert NotRegistered();
        address last = _registered[_registered.length - 1];
        _registered[idx - 1] = last;
        fighterInfo[last].index = idx;
        _registered.pop();
        delete fighterInfo[msg.sender];
        emit Unregistered(msg.sender, uint16(_registered.length));
    }

    // ================================================================ the draw and the stages

    /// @notice Close registration and draw the bracket. Anyone can call it once registration ends.
    function draw() external {
        if (block.timestamp < registrationEnd) revert RegistrationOpen();
        if (drawn || cancelled) revert AlreadyDrawn();
        uint256 n = _registered.length;
        if (n < 2) {
            cancelled = true;
            emit Cancelled(uint16(n));
            return;
        }
        drawn = true;
        bytes32 seed = keccak256(abi.encode(blockhash(block.number - 1), address(this), n, block.timestamp));

        address[] memory pool = _registered;
        for (uint256 i = n - 1; i > 0; --i) {
            uint256 j = uint256(keccak256(abi.encode(seed, i))) % (i + 1);
            (pool[i], pool[j]) = (pool[j], pool[i]);
        }
        uint256 size = 2;
        while (size < n) size <<= 1;
        uint256 byes = size - n;
        address[] storage slots = _slots[1];
        uint256 k;
        for (uint256 p; p < size / 2; ++p) {
            slots.push(pool[k++]);
            slots.push(p < byes ? address(0) : pool[k++]);
        }
        stage = 1;
        emit Drawn(uint16(n), uint16(size), seed);
        _openStage(firstBell);
    }

    /// @notice After a stage's final bell: decide every bout, then book the next evening or crown
    ///         the champion. Anyone can call it.
    function advance() external {
        if (!drawn || cancelled || champion != address(0)) revert NothingToAdvance();
        uint256 sid = sessionOf[stage];
        if (!arena.isOver(sid)) revert StageNotOver();
        (bytes32 seed,,, bool settled) = arena.sessions(sid);
        if (!settled) arena.settle(sid);

        address[] storage slots = _slots[stage];
        uint256 pairs = slots.length / 2;
        address[] memory winners = new address[](pairs);
        for (uint256 p; p < pairs; ++p) {
            address a = slots[2 * p];
            address b = slots[2 * p + 1];
            if (b == address(0)) {
                winners[p] = a;
                emit BoutResult(stage, uint16(p), a, address(0), 0, 0);
                continue;
            }
            (address w, address l) = _beats(sid, seed, a, b) ? (a, b) : (b, a);
            winners[p] = w;
            emit BoutResult(stage, uint16(p), w, l, arena.pointsOf(sid, w), arena.pointsOf(sid, l));
        }
        if (pairs == 1) {
            champion = winners[0];
            emit ChampionCrowned(champion, stage);
            return;
        }
        uint64 next = bellOf[stage] + stageGap;
        ++stage;
        address[] storage nextSlots = _slots[stage];
        for (uint256 i; i < pairs; ++i) nextSlots.push(winners[i]);
        _openStage(next);
    }

    // ================================================================ views

    function registered() external view returns (address[] memory) {
        return _registered;
    }

    function registeredCount() external view returns (uint256) {
        return _registered.length;
    }

    /// @notice The bracket of `s`: pairs are (slot 2p, slot 2p+1); address(0) is a bye.
    function slotsOf(uint8 s) external view returns (address[] memory) {
        return _slots[s];
    }

    // ================================================================ internals

    function _openStage(uint64 bell) internal {
        while (bell < block.timestamp + minNotice) bell += stageGap;
        address[] storage slots = _slots[stage];
        uint256 count;
        for (uint256 p; p < slots.length / 2; ++p) {
            if (slots[2 * p + 1] != address(0)) count += 2;
        }
        address[] memory list = new address[](count);
        uint256 k;
        for (uint256 p; p < slots.length / 2; ++p) {
            if (slots[2 * p + 1] == address(0)) continue;
            list[k++] = slots[2 * p];
            list[k++] = slots[2 * p + 1];
        }
        bellOf[stage] = bell;
        uint256 sid = arena.openSession(list, bell);
        sessionOf[stage] = sid;
        emit StageOpened(stage, sid, bell, uint16(count / 2));
    }

    /// @dev True if `a` beats `b`: more points, then fewer fouls, then more correct codes, then a
    ///      coin toss from the session seed.
    function _beats(uint256 sid, bytes32 seed, address a, address b) internal view returns (bool) {
        uint8 pa = arena.pointsOf(sid, a);
        uint8 pb = arena.pointsOf(sid, b);
        if (pa != pb) return pa > pb;
        (,, uint16 ca, uint8 fa,,) = arena.entries(sid, a);
        (,, uint16 cb, uint8 fb,,) = arena.entries(sid, b);
        if (fa != fb) return fa < fb;
        uint256 ka = _popcount(ca);
        uint256 kb = _popcount(cb);
        if (ka != kb) return ka > kb;
        return uint256(keccak256(abi.encode(seed, a, b))) & 1 == 0;
    }

    function _popcount(uint16 x) internal pure returns (uint256 n) {
        while (x != 0) {
            x &= x - 1;
            ++n;
        }
    }
}
