// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "forge-std/Script.sol";
import {AgentArena} from "../src/AgentArena.sol";
import {ArenaArt} from "../src/ArenaArt.sol";
import {ArenaCertificate} from "../src/ArenaCertificate.sol";
import {ArenaSeasons} from "../src/ArenaSeasons.sol";

/// @notice Schedules the next season of an arena (run by the seasons' admin): a certificate contract
///         for it, then its dates, judge and secret. While the last season scheduled has not started,
///         this schedules that one again instead (same number, a new certificate contract). A season
///         that has started never changes.
///
/// Environment:
///   ARENA          the arena
///   ART            its ArenaArt (the certificate pictures)
///   JUDGE          the season's judge
///   SECRET_COMMIT  keccak256 of the season's secret (pages/tools/make-secret.mjs prints it)
///   SEASON_START   unix time the season opens: at or after the end of the season before
///   SEASON_END     unix time after which no fight of the season starts
contract ScheduleSeason is Script {
    function run() external {
        AgentArena arena = AgentArena(vm.envAddress("ARENA"));
        ArenaArt art = ArenaArt(vm.envAddress("ART"));
        address judge = vm.envAddress("JUDGE");
        bytes32 secretCommit = vm.envBytes32("SECRET_COMMIT");
        uint64 start = uint64(vm.envUint("SEASON_START"));
        uint64 end = uint64(vm.envUint("SEASON_END"));
        ArenaSeasons book = arena.seasonBook();
        uint16 n = book.seasonCount();
        // the last season scheduled has not started yet: it is scheduled again under its own number
        if (n == 0 || book.get(n).start <= block.timestamp) ++n;

        vm.startBroadcast();
        ArenaCertificate certificate = new ArenaCertificate("IBITI Agent Arena", "ARENA", address(arena), art, arena.TEST_VERSION(), n);
        book.schedule(start, end, judge, secretCommit, address(certificate));
        vm.stopBroadcast();
        console.log("season", n);
        console.log("certificate", address(certificate));
    }
}
