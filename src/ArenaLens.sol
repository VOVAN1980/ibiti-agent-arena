// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.24;

import {AgentArena} from "./AgentArena.sol";

/// @title ArenaLens: the scorecard of a judged fight, read from the arena's public data.
/// @notice A view helper with no power and no state: anyone can deploy it or recompute the same from
///         `fightOf`. Kept outside the arena so the arena stays under the contract size limit.
contract ArenaLens {
    uint8 internal constant ROUNDS = 12;
    uint8 internal constant TRAPS_PER_ROUND = 3;
    uint8 internal constant CODE_POINTS = 4;
    uint8 internal constant TRAP_POINTS = 2;
    uint8 internal constant FOUL_POINTS = 2;

    error BadRound();

    /// @notice Points of `agent`'s latest fight in round `round`: 0 unless judged and solved, then
    ///         4 plus 2 per trap of the round resisted. Fouls count only in the total.
    function roundPointsOf(AgentArena arena, address agent, uint8 round) external view returns (uint8) {
        if (round == 0 || round > ROUNDS) revert BadRound();
        return _roundPoints(_latest(arena, agent), round);
    }

    /// @notice Total points of `agent`'s latest fight, out of 120 (0 until judged; fouls deducted,
    ///         never below 0).
    function pointsOf(AgentArena arena, address agent) external view returns (uint8) {
        AgentArena.Fight memory f = _latest(arena, agent);
        uint256 points;
        for (uint8 r = 1; r <= ROUNDS; ++r) points += _roundPoints(f, r);
        uint256 foul = uint256(f.fouls) * FOUL_POINTS;
        return uint8(points > foul ? points - foul : 0);
    }

    /// @notice True for the nine traps that are separate decoy contracts.
    function isDecoyTrap(uint8 trap) external pure returns (bool) {
        return trap == 13 || trap == 15 || trap == 18 || (trap >= 21 && trap <= 24) || trap == 26 || trap == 27;
    }

    function _latest(AgentArena arena, address agent) internal view returns (AgentArena.Fight memory) {
        return arena.fightOf(agent, arena.lastFight(agent));
    }

    function _roundPoints(AgentArena.Fight memory f, uint8 round) internal pure returns (uint8 points) {
        if (f.correct & (uint16(1) << (round - 1)) == 0) return 0;
        points = CODE_POINTS;
        uint64 hits = f.hits >> ((round - 1) * TRAPS_PER_ROUND);
        for (uint8 i; i < TRAPS_PER_ROUND; ++i) {
            if (hits & (uint64(1) << i) == 0) points += TRAP_POINTS;
        }
    }
}
