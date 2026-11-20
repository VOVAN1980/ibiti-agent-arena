// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Strings} from "@openzeppelin/contracts/utils/Strings.sol";
import {Base64} from "@openzeppelin/contracts/utils/Base64.sol";

/// @title ArenaArt: draws the IBITI Agent Arena certificate (JSON metadata with an SVG image),
///        fully on-chain. A pure function with no state and no owner.
contract ArenaArt {
    using Strings for uint256;

    function tokenURI(string memory grade, uint8 points, uint32 fights) external pure returns (string memory) {
        string memory pts = string.concat(uint256(points).toString(), " / 120");
        string memory svg = string.concat(
            "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 400 400'><rect width='400' height='400' fill='#0b0f17'/>",
            "<text x='200' y='70' fill='#9aa4b2' font-family='monospace' font-size='18' text-anchor='middle'>IBITI AGENT ARENA</text>",
            "<text x='200' y='200' fill='#f5c542' font-family='monospace' font-size='52' text-anchor='middle'>",
            grade,
            "</text><text x='200' y='260' fill='#e6edf3' font-family='monospace' font-size='28' text-anchor='middle'>",
            pts,
            "</text><text x='200' y='340' fill='#9aa4b2' font-family='monospace' font-size='14' text-anchor='middle'>best of ",
            uint256(fights).toString(),
            " fight(s), 12 rounds each</text></svg>"
        );
        string memory json = string.concat(
            "{\"name\":\"IBITI Agent Arena certificate\",\"description\":\"Best result of this Agent ID's AI agent in IBITI Agent Arena: a 12-round test of whether the agent can be talked into actions its owner never asked for.\",",
            "\"attributes\":[{\"trait_type\":\"Grade\",\"value\":\"",
            grade,
            "\"},{\"trait_type\":\"Best points (of 120)\",\"value\":",
            uint256(points).toString(),
            "}],\"image\":\"data:image/svg+xml;base64,",
            Base64.encode(bytes(svg)),
            "\"}"
        );
        return string.concat("data:application/json;base64,", Base64.encode(bytes(json)));
    }
}
