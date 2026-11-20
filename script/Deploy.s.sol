// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "forge-std/Script.sol";
import {AgentArena, ArenaDecoy} from "../src/AgentArena.sol";
import {ArenaArt} from "../src/ArenaArt.sol";
import {MockAgentId} from "./MockAgentId.sol";

/// @notice Deploys IBITI Agent Arena and seals it.
///
/// Environment:
///   AGENT_ID_REGISTRY  the Agent ID registry; leave unset on test networks to deploy MockAgentId
///   FIGHT_DURATION     seconds (default 7200)
///   COOLDOWN           seconds (default 3600)
///   ROUND_TIME         seconds per round (default 60)
///   CODEBOOK           path to codes.json (default ./codebook/codes.json, gitignored)
///   OUT                where to write the addresses (default ./deployments/<chainid>.json)
contract Deploy is Script {
    uint8[9] internal DECOY_TRAPS = [13, 15, 18, 21, 22, 23, 24, 26, 27];

    function run() external {
        address registry = vm.envOr("AGENT_ID_REGISTRY", address(0));
        uint64 duration = uint64(vm.envOr("FIGHT_DURATION", uint256(7200)));
        uint64 cooldown = uint64(vm.envOr("COOLDOWN", uint256(3600)));
        uint64 roundTime = uint64(vm.envOr("ROUND_TIME", uint256(60)));
        string memory codebook = vm.readFile(vm.envOr("CODEBOOK", string("./codebook/codes.json")));

        vm.startBroadcast();
        if (registry == address(0)) {
            require(block.chainid != 56, "mainnet needs the real Agent ID registry");
            registry = address(new MockAgentId());
        }
        ArenaArt art = new ArenaArt();
        AgentArena arena = new AgentArena(registry, duration, cooldown, roundTime, art);
        address[9] memory decoys;
        for (uint256 i; i < 9; ++i) {
            decoys[i] = address(new ArenaDecoy(arena));
            arena.setDecoy(decoys[i], DECOY_TRAPS[i]);
        }
        for (uint8 r = 1; r <= 12; ++r) {
            string[] memory codes = vm.parseJsonStringArray(codebook, string.concat(".codes[", vm.toString(uint256(r - 1)), "]"));
            require(codes.length == 64, "64 codes per round");
            bytes32[] memory h = new bytes32[](64);
            for (uint256 v; v < 64; ++v) h[v] = keccak256(bytes(codes[v]));
            arena.setCodeHashes(r, 0, h);
        }
        arena.seal();
        vm.stopBroadcast();

        string memory o = "deployment";
        vm.serializeAddress(o, "registry", registry);
        vm.serializeAddress(o, "art", address(art));
        vm.serializeAddress(o, "certificate", address(arena.certificate()));
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
