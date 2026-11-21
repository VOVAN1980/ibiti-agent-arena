// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "forge-std/Script.sol";
import {AgentArena, ArenaDecoy} from "../src/AgentArena.sol";
import {ArenaArt} from "../src/ArenaArt.sol";
import {MockAgentId} from "./MockAgentId.sol";

/// @notice Deploys IBITI Agent Arena and seals it.
///
/// Environment:
///   JUDGE              the judge's address (the key that scores finished fights)
///   SECRET_COMMIT      keccak256 of the season secret (pages/tools/make-secret.mjs prints it)
///   SEASON_END         unix time after which no fight starts; publish the secret only after it
///                      (plus FIGHT_DURATION, so every fight has ended)
///   AGENT_ID_REGISTRY  the Agent ID registry; leave unset on test networks to deploy MockAgentId.
///                      On BNB Smart Chain (56) it must be the SPACE ID Agent ID contract.
///   FIGHT_DURATION     seconds (default 7200)
///   COOLDOWN           seconds (default 3600)
///   ROUND_TIME         seconds per round (default 60)
///   OUT                where to write the addresses (default ./deployments/<chainid>.json)
contract Deploy is Script {
    uint8[9] internal DECOY_TRAPS = [13, 15, 18, 21, 22, 23, 24, 26, 27];
    /// @notice SPACE ID "Agent ID" on BNB Smart Chain (an Agentic Wallet with an Agent ID holds one).
    address internal constant AGENT_ID_BSC = 0x60B9262456dE011F7d15a54CdD8c48bAaa8B022F;

    function run() external {
        address judge = vm.envAddress("JUDGE");
        bytes32 secretCommit = vm.envBytes32("SECRET_COMMIT");
        uint64 seasonEnd = uint64(vm.envUint("SEASON_END"));
        require(seasonEnd > block.timestamp, "SEASON_END must be in the future");
        address registry = vm.envOr("AGENT_ID_REGISTRY", address(0));
        uint64 duration = uint64(vm.envOr("FIGHT_DURATION", uint256(7200)));
        uint64 cooldown = uint64(vm.envOr("COOLDOWN", uint256(3600)));
        uint64 roundTime = uint64(vm.envOr("ROUND_TIME", uint256(60)));
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
        ArenaArt art = new ArenaArt();
        AgentArena arena = new AgentArena(registry, duration, cooldown, roundTime, art, judge, secretCommit, seasonEnd);
        address[9] memory decoys;
        for (uint256 i; i < 9; ++i) {
            decoys[i] = address(new ArenaDecoy(arena));
            arena.setDecoy(decoys[i], DECOY_TRAPS[i]);
        }
        arena.seal();
        vm.stopBroadcast();

        string memory o = "deployment";
        vm.serializeAddress(o, "registry", registry);
        vm.serializeAddress(o, "art", address(art));
        vm.serializeAddress(o, "certificate", address(arena.certificate()));
        vm.serializeAddress(o, "judge", judge);
        vm.serializeBytes32(o, "secretCommit", secretCommit);
        string memory d = "decoys";
        for (uint256 i; i < 8; ++i) vm.serializeAddress(d, vm.toString(uint256(DECOY_TRAPS[i])), decoys[i]);
        string memory decoyJson = vm.serializeAddress(d, vm.toString(uint256(DECOY_TRAPS[8])), decoys[8]);
        vm.serializeString(o, "decoys", decoyJson);
        vm.serializeUint(o, "chainId", block.chainid);
        string memory json = vm.serializeAddress(o, "arena", address(arena));
        string memory out = vm.envOr("OUT", string.concat("./deployments/", vm.toString(block.chainid), ".json"));
        vm.writeJson(json, out);
        console.log("AgentArena", address(arena));
    }
}
