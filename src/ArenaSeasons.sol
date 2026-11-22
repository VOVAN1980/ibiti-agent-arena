// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

interface IArenaClock {
    function roundTime() external view returns (uint64);
}

interface ISeasonCertificate {
    function arena() external view returns (address);
    function season() external view returns (uint16);
}

/// @title ArenaSeasons: the season calendar of one IBITI Agent Arena.
/// @notice The arena makes this contract when it is deployed and asks it which season runs now. Each
///         season has its start and end, its judge, keccak256 of its secret, and its certificate
///         contract (the season's ranking and medals). Seasons follow one another and never overlap.
///         The admin schedules them:
///         - a new season starts at or after the end of the last one;
///         - while the last season scheduled has not started, it may be scheduled again (same number);
///         - a season that has started never changes: not its end, not its judge, not its secret.
///         The admin has no other power, here or in the arena.
contract ArenaSeasons {
    struct Season {
        uint64 start; // registration opens
        uint64 end; // no fight past it
        address judge; // signs, locks and scores the season's fights
        bytes32 secretCommit; // keccak256 of the season secret, published after the season
        address certificate; // the season's ranking and medal certificates
    }

    /// @notice The arena this calendar belongs to.
    address public immutable arena;
    /// @notice Schedules the seasons.
    address public admin;
    mapping(uint16 => Season) public seasons;
    /// @notice The last season scheduled (seasons are numbered from 1).
    uint16 public seasonCount;

    /// @notice A season is scheduled, or a season that has not started yet is scheduled again.
    event SeasonScheduled(uint16 indexed season, uint64 start, uint64 end, address judge, bytes32 secretCommit, address certificate);
    event AdminChanged(address admin);

    error NotAdmin();
    error BadSeason();

    /// @param admin_ who schedules the seasons; the arena that deploys this is its arena
    constructor(address admin_) {
        if (admin_ == address(0)) revert NotAdmin();
        arena = msg.sender;
        admin = admin_;
    }

    /// @notice Schedule the next season, or schedule again the last one while it has not started. A
    ///         start already past means now.
    /// @param certificate_ a certificate contract made for this arena and this season's number
    function schedule(uint64 start, uint64 end, address judge_, bytes32 secretCommit_, address certificate_) external {
        if (msg.sender != admin) revert NotAdmin();
        // a start already past (the transaction came later than planned) means: start now
        if (start < block.timestamp) start = uint64(block.timestamp);
        uint16 n = seasonCount;
        if (n == 0 || seasons[n].start <= block.timestamp) {
            if (n != 0 && start < seasons[n].end) revert BadSeason(); // seasons never overlap
            seasonCount = ++n;
        } else if (n > 1 && start < seasons[n - 1].end) {
            revert BadSeason(); // scheduled again: still after the one before
        }
        // the season holds at least one whole fight: a 60-second countdown, 12 rounds, 11 breaks
        uint64 fight = 60 + 12 * IArenaClock(arena).roundTime() + 11 * 10;
        if (end <= start + fight) revert BadSeason();
        if (judge_ == address(0) || secretCommit_ == bytes32(0)) revert BadSeason();
        if (ISeasonCertificate(certificate_).arena() != arena || ISeasonCertificate(certificate_).season() != n) revert BadSeason();
        seasons[n] = Season(start, end, judge_, secretCommit_, certificate_);
        emit SeasonScheduled(n, start, end, judge_, secretCommit_, certificate_);
    }

    /// @notice Hand the scheduling of seasons to another address.
    function setAdmin(address admin_) external {
        if (msg.sender != admin || admin_ == address(0)) revert NotAdmin();
        admin = admin_;
        emit AdminChanged(admin_);
    }

    /// @notice The season running now (0: none, before the first or between two).
    function current() public view returns (uint16 n) {
        n = seasonCount;
        if (n != 0 && block.timestamp < seasons[n].start) --n;
        if (n != 0 && block.timestamp >= seasons[n].end) n = 0;
    }

    /// @notice A season's settings (all zero for a season never scheduled).
    function get(uint16 n) external view returns (Season memory) {
        return seasons[n];
    }
}
