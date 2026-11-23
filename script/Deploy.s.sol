// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.24;

import "forge-std/Script.sol";
import {AgentArena, ArenaDecoy} from "../src/AgentArena.sol";
import {ArenaArt} from "../src/ArenaArt.sol";
import {ArenaCertificate} from "../src/ArenaCertificate.sol";
import {ArenaRanking} from "../src/ArenaRanking.sol";
import {ArenaPictures} from "./ArenaPictures.sol";
import {MockAgentId} from "./MockAgentId.sol";

/// @notice Deploys IBITI Agent Arena once: the arena (with its season calendar), its decoys, the seal,
///         and season 1. Later seasons are scheduled on the same arena with ScheduleSeason.s.sol: the
///         agents, fights and all-time ranking stay in this arena for good.
///
/// Environment:
///   JUDGE              season 1's judge (the key that signs, locks and scores its fights)
///   SECRET_COMMIT      keccak256 of season 1's secret (pages/tools/make-secret.mjs prints it)
///   SEASON_START       unix time season 1 opens (default: now)
///   SEASON_END         unix time after which no fight of season 1 starts; publish its secret only
///                      after it (plus about 15 minutes, so every fight has ended)
///   AGENT_ID_REGISTRY  the Agent ID registry; leave unset on test networks to deploy MockAgentId.
///                      On BNB Smart Chain (56) it must be the SPACE ID Agent ID contract.
///   COOLDOWN           seconds between two fights of an agent (default 86400: one fight a day)
///   ART                an ArenaArt already on this chain, to reuse its pictures (unset: deploy them)
///   RANKING_ONLY       true for the street (green) ring: season 1 keeps a ranking and gives no award
///                      (ArenaRanking; no pictures are deployed). A later season can give certificates
///                      with pictures of its own (ScheduleSeason.s.sol) on the same arena.
///   ROUND_TIME         seconds per round (default 60)
///   DRAW_EVERY         seconds between two draws (default 600: every ten minutes)
///   OUT                where to write the addresses (default ./deployments/<chainid>.json)
/// The deployer is the admin: it registers the decoys and schedules the seasons.
contract Deploy is Script {
    uint8[9] internal DECOY_TRAPS = [13, 15, 18, 21, 22, 23, 24, 26, 27];
    /// @notice SPACE ID "Agent ID" on BNB Smart Chain (an Agentic Wallet with an Agent ID holds one).
    address internal constant AGENT_ID_BSC = 0x60B9262456dE011F7d15a54CdD8c48bAaa8B022F;

    function run() external {
        address judge = vm.envAddress("JUDGE");
        bytes32 secretCommit = vm.envBytes32("SECRET_COMMIT");
        uint64 seasonStart = uint64(vm.envOr("SEASON_START", block.timestamp));
        uint64 seasonEnd = uint64(vm.envUint("SEASON_END"));
        require(seasonStart >= block.timestamp && seasonEnd > seasonStart, "SEASON_START must be now or later, SEASON_END after it");
        address registry = vm.envOr("AGENT_ID_REGISTRY", address(0));
        uint64 cooldown = uint64(vm.envOr("COOLDOWN", uint256(86400)));
        uint64 roundTime = uint64(vm.envOr("ROUND_TIME", uint256(60)));
        uint64 drawEvery = uint64(vm.envOr("DRAW_EVERY", uint256(600)));
        require(judge != address(0) && secretCommit != bytes32(0), "JUDGE and SECRET_COMMIT are required");
        if (block.chainid == 56) {
            require(registry == AGENT_ID_BSC, "on BNB Smart Chain the registry must be the SPACE ID Agent ID contract");
            require(registry.code.length > 0, "the Agent ID registry has no code");
        }

        vm.startBroadcast();
        if (registry == address(0)) {
            require(block.chainid != 56, "mainnet needs the real Agent ID registry");
            registry = address(new MockAgentId());
        }
        // the street ring keeps a ranking only: no award, so no pictures. The tournament ring's pictures
        // are stored once: an arena reuses the ArenaArt already on this chain (ART), and nothing about
        // it can change
        // on mainnet the choice is stated by name: a forgotten RANKING_ONLY must not buy pictures and
        // awards for the street ring
        if (block.chainid == 56) require(vm.envExists("RANKING_ONLY"), "set RANKING_ONLY: true (street ring) or false (tournament ring)");
        bool rankingOnly = vm.envOr("RANKING_ONLY", false);
        address artAt = vm.envOr("ART", address(0));
        require(!rankingOnly || artAt == address(0), "RANKING_ONLY takes no ART");
        if (artAt != address(0)) require(artAt.code.length > 0, "ART has no code on this chain");
        ArenaArt art = rankingOnly ? ArenaArt(address(0)) : artAt != address(0) ? ArenaArt(artAt) : ArenaPictures.deploy(vm);
        AgentArena arena = new AgentArena(registry, cooldown, roundTime, drawEvery);
        address[9] memory decoys;
        for (uint256 i; i < 9; ++i) {
            decoys[i] = address(new ArenaDecoy(arena));
            arena.setDecoy(decoys[i], DECOY_TRAPS[i]);
        }
        arena.seal();
        ArenaRanking certificate = rankingOnly
            ? new ArenaRanking(address(arena), 1)
            : new ArenaCertificate("IBITI Agent Arena", "ARENA", address(arena), art, arena.TEST_VERSION(), 1);
        arena.seasonBook().schedule(seasonStart, seasonEnd, judge, secretCommit, address(certificate));
        vm.stopBroadcast();

        string memory o = "deployment";
        vm.serializeAddress(o, "registry", registry);
        vm.serializeAddress(o, "art", address(art));
        vm.serializeAddress(o, "seasonBook", address(arena.seasonBook()));
        vm.serializeAddress(o, "certificate", address(certificate));
        vm.serializeAddress(o, "judge", judge);
        vm.serializeBytes32(o, "secretCommit", secretCommit);
        string memory d = "decoys";
        for (uint256 i; i < 8; ++i) vm.serializeAddress(d, vm.toString(uint256(DECOY_TRAPS[i])), decoys[i]);
        string memory decoyJson = vm.serializeAddress(d, vm.toString(uint256(DECOY_TRAPS[8])), decoys[8]);
        vm.serializeString(o, "decoys", decoyJson);
        vm.serializeUint(o, "chainId", block.chainid);
        vm.serializeUint(o, "season", 1);
        vm.serializeUint(o, "seasonStart", seasonStart);
        vm.serializeUint(o, "seasonEnd", seasonEnd);
        // the arena's first block: the judge and the site read its events from here, not from block 0
        vm.serializeUint(o, "block", block.number);
        string memory json = vm.serializeAddress(o, "arena", address(arena));
        string memory out = vm.envOr("OUT", string.concat("./deployments/", vm.toString(block.chainid), ".json"));
        vm.writeJson(json, out);
        console.log("AgentArena", address(arena));
    }
}
