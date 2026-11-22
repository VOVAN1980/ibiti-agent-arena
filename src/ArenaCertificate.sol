// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {ArenaArt} from "./ArenaArt.sol";

interface IArenaSeason {
    function seasonEnd() external view returns (uint64);
    function judge() external view returns (address);
}

/// @title ArenaCertificate: one season of IBITI Agent Arena — its official ranking, its close, and
///        the soulbound certificates of its first ten places.
/// @notice After every judged fight the arena reports the agent here. The contract keeps the season's
///         official ranking (agents fighting under their own Agent ID name) for its first PLACES
///         places, and marks everyone who fought a judged fight as a participant. When the season is
///         over it is closed once: the ranking is final from then on, and each of its first PLACES
///         agents gets a certificate of its place (1: gold, 2: silver, 3: bronze, 4-10: the place),
///         drawn on-chain by ArenaArt. Transfers, burns and approvals always revert.
contract ArenaCertificate is ERC721 {
    address public immutable arena;
    ArenaArt public immutable art;
    /// @notice The number of this season.
    uint16 public immutable season;
    /// @notice The test version of this arena deployment, shown on every certificate.
    string public testVersion;

    /// @notice Places that get a certificate.
    uint8 public constant PLACES = 10;
    /// @notice Anyone may close the season this long after its end (the judge may at once, when
    ///         every fight is judged).
    uint64 public constant CLOSE_AFTER = 1 days;

    /// @notice An agent's best official result of the season.
    struct Result {
        uint8 points;
        uint32 timeUsed;
        uint64 at; // when that fight ended
        bytes32 name; // the agent's name then
    }

    mapping(address => Result) public resultOf;
    /// @notice True for every agent with a judged fight in this season (official or open).
    mapping(address => bool) public tookPart;
    /// @notice How many agents took part.
    uint32 public participants;
    /// @notice An agent's place (1..PLACES) once the season is closed; 0 before, and for the rest.
    mapping(address => uint8) public placeOf;
    /// @notice When the season was closed (0: still open).
    uint64 public closedAt;

    address[10] internal _top; // the official ranking's first places, best first
    uint8 public ranked; // how many of them are taken

    event TookPart(address indexed agent);
    /// @notice The season is closed: its winners, first place first, and how many agents took part.
    event SeasonClosed(uint16 indexed season, address[] winners, uint32 participants);

    error Soulbound();
    error NotArena();
    error SeasonRunning();
    error AlreadyClosed();

    constructor(string memory name_, string memory symbol_, ArenaArt art_, string memory testVersion_, uint16 season_)
        ERC721(name_, symbol_)
    {
        arena = msg.sender;
        art = art_;
        testVersion = testVersion_;
        season = season_;
    }

    function tokenIdOf(address agent) public pure returns (uint256) {
        return uint256(uint160(agent));
    }

    /// @notice A judged fight of `agent`: it took part; if the fight was official, `points`, `timeUsed`
    ///         and `at` are its best official result so far (the arena keeps the best) and `name` its
    ///         name. After the close nothing changes any more. Arena only.
    function record(address agent, bytes32 name, bool official, uint8 points, uint32 timeUsed, uint64 at) external {
        if (msg.sender != arena) revert NotArena();
        if (closedAt != 0) return;
        if (!tookPart[agent]) {
            tookPart[agent] = true;
            ++participants;
            emit TookPart(agent);
        }
        if (!official) return;
        Result storage r = resultOf[agent];
        if (r.at == at && r.points == points && r.timeUsed == timeUsed) return; // its best has not changed
        resultOf[agent] = Result(points, timeUsed, at, name);
        // into the ranking, or up in it: a best result only ever gets better
        uint256 n = ranked;
        uint256 i;
        while (i < n && _top[i] != agent) ++i;
        if (i == n) {
            if (n < PLACES) {
                ranked = uint8(n + 1);
            } else {
                if (!_ahead(agent, _top[n - 1])) return; // not among the first PLACES
                i = n - 1; // takes the last place
            }
            _top[i] = agent;
        }
        for (; i > 0 && _ahead(agent, _top[i - 1]); --i) {
            _top[i] = _top[i - 1];
            _top[i - 1] = agent;
        }
    }

    /// @notice Close the season: the ranking is final and the first PLACES agents get their
    ///         certificates. After the season's end the judge may close it (once every fight is
    ///         judged); anyone may CLOSE_AFTER later. Once.
    function close() external {
        if (closedAt != 0) revert AlreadyClosed();
        uint64 end = IArenaSeason(arena).seasonEnd();
        if (block.timestamp <= end) revert SeasonRunning();
        if (msg.sender != IArenaSeason(arena).judge() && block.timestamp <= end + CLOSE_AFTER) revert SeasonRunning();
        closedAt = uint64(block.timestamp);
        uint256 n = ranked;
        address[] memory winners = new address[](n);
        for (uint256 i; i < n; ++i) {
            address a = _top[i];
            winners[i] = a;
            placeOf[a] = uint8(i + 1);
            _mint(a, tokenIdOf(a));
        }
        emit SeasonClosed(season, winners, participants);
    }

    /// @notice The official ranking's first places now, best first (final once the season is closed).
    function top() external view returns (address[] memory out) {
        uint256 n = ranked;
        out = new address[](n);
        for (uint256 i; i < n; ++i) out[i] = _top[i];
    }

    function tokenURI(uint256 tokenId) public view override returns (string memory) {
        address agent = _requireOwned(tokenId);
        Result storage r = resultOf[agent];
        return art.tokenURI(season, placeOf[agent], r.name, r.points, r.timeUsed, r.at, testVersion);
    }

    /// @dev The order of the ranking: more points, then less time, then the earlier fight, then the
    ///      lower address (never the order in which the judge came).
    function _ahead(address a, address b) internal view returns (bool) {
        Result storage x = resultOf[a];
        Result storage y = resultOf[b];
        if (x.points != y.points) return x.points > y.points;
        if (x.timeUsed != y.timeUsed) return x.timeUsed < y.timeUsed;
        if (x.at != y.at) return x.at < y.at;
        return a < b;
    }

    /// @dev Soulbound: only minting is allowed; transfers and burns revert.
    function _update(address to, uint256 tokenId, address auth) internal override returns (address) {
        if (_ownerOf(tokenId) != address(0)) revert Soulbound();
        return super._update(to, tokenId, auth);
    }

    function approve(address, uint256) public pure override {
        revert Soulbound();
    }

    function setApprovalForAll(address, bool) public pure override {
        revert Soulbound();
    }
}
