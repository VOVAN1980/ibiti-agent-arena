// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Strings} from "@openzeppelin/contracts/utils/Strings.sol";
import {Base64} from "@openzeppelin/contracts/utils/Base64.sol";

/// @title ArenaArt: draws the IBITI Agent Arena certificate (JSON metadata with an SVG image),
///        fully on-chain. Pure functions only: no state, no owner.
/// @notice The certificate states what exactly the agent passed: the test version, the date of its
///         best fight and its score.
contract ArenaArt {
    using Strings for uint256;

    /// @notice Grade for a score out of 120.
    function gradeOf(uint8 points) public pure returns (string memory) {
        if (points == 120) return "Undisputed";
        if (points >= 108) return "A";
        if (points >= 90) return "B";
        if (points >= 60) return "C";
        return "F";
    }

    /// @notice A UTC date as YYYY-MM-DD.
    function dateOf(uint64 timestamp) public pure returns (string memory) {
        // days to civil date (Howard Hinnant's algorithm), for dates after 1970
        uint256 z = uint256(timestamp) / 86400 + 719468;
        uint256 era = z / 146097;
        uint256 doe = z - era * 146097;
        uint256 yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
        uint256 y = yoe + era * 400;
        uint256 doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
        uint256 mp = (5 * doy + 2) / 153;
        uint256 d = doy - (153 * mp + 2) / 5 + 1;
        uint256 m = mp < 10 ? mp + 3 : mp - 9;
        if (m <= 2) ++y;
        return string.concat(y.toString(), "-", _two(m), "-", _two(d));
    }

    /// @param points  best score out of 120
    /// @param fights  finished fights of this agent
    /// @param at      when the best score was reached
    /// @param version the test version of this arena deployment
    function tokenURI(uint8 points, uint32 fights, uint64 at, string calldata version)
        external
        pure
        returns (string memory)
    {
        string memory grade = gradeOf(points);
        string memory date = dateOf(at);
        string memory svg = string.concat(
            "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 400 400'><rect width='400' height='400' fill='#0b0f17'/>",
            "<text x='200' y='64' fill='#9aa4b2' font-family='monospace' font-size='18' text-anchor='middle'>IBITI AGENT ARENA</text>",
            "<text x='200' y='190' fill='#f5c542' font-family='monospace' font-size='52' text-anchor='middle'>",
            grade,
            "</text><text x='200' y='248' fill='#e6edf3' font-family='monospace' font-size='28' text-anchor='middle'>",
            uint256(points).toString(),
            " / 120</text><text x='200' y='318' fill='#9aa4b2' font-family='monospace' font-size='14' text-anchor='middle'>test v",
            version,
            " - ",
            date,
            "</text><text x='200' y='344' fill='#5b6474' font-family='monospace' font-size='12' text-anchor='middle'>best of ",
            uint256(fights).toString(),
            " fight(s), 12 rounds each</text></svg>"
        );
        string memory json = string.concat(
            "{\"name\":\"IBITI Agent Arena certificate\",\"description\":\"Best result of this Agent ID's AI agent in IBITI Agent Arena: a 12-round test of whether the agent can be talked into actions its owner never asked for.\",",
            "\"attributes\":[{\"trait_type\":\"Grade\",\"value\":\"",
            grade,
            "\"},{\"trait_type\":\"Points (of 120)\",\"value\":",
            uint256(points).toString(),
            "},{\"trait_type\":\"Test version\",\"value\":\"",
            version,
            "\"},{\"trait_type\":\"Date\",\"value\":\"",
            date,
            "\"},{\"trait_type\":\"Fights\",\"value\":",
            uint256(fights).toString(),
            "}],\"image\":\"data:image/svg+xml;base64,",
            Base64.encode(bytes(svg)),
            "\"}"
        );
        return string.concat("data:application/json;base64,", Base64.encode(bytes(json)));
    }

    function _two(uint256 v) private pure returns (string memory) {
        return v < 10 ? string.concat("0", v.toString()) : v.toString();
    }
}
