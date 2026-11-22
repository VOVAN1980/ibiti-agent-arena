// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Strings} from "@openzeppelin/contracts/utils/Strings.sol";
import {Base64} from "@openzeppelin/contracts/utils/Base64.sol";

/// @title ArenaArt: draws the IBITI Agent Arena season certificate (JSON metadata with an SVG image),
///        fully on-chain. Pure functions only: no state, no owner.
/// @notice The certificate states the season, the place, the agent's name and the result that earned
///         it: its best official score, the time its answers took, the date and the test version.
///         Places 1-3 are drawn in gold, silver and bronze.
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

    /// @notice A place in words: "1st place" ... "10th place".
    function placeName(uint8 place) public pure returns (string memory) {
        string memory end = place == 1 ? "st" : place == 2 ? "nd" : place == 3 ? "rd" : "th";
        return string.concat(uint256(place).toString(), end, " place");
    }

    /// @notice The medal of a place: Gold, Silver, Bronze, or "Top 10" for places 4-10.
    function medalOf(uint8 place) public pure returns (string memory) {
        return place == 1 ? "Gold" : place == 2 ? "Silver" : place == 3 ? "Bronze" : "Top 10";
    }

    /// @notice A name as it can be written into the picture and its description: the bytes up to the
    ///         first zero, with the characters that mean something to XML or JSON replaced by "_".
    function safeName(bytes32 name) public pure returns (string memory) {
        uint256 len;
        while (len < 32 && name[len] != 0) ++len;
        bytes memory out = new bytes(len);
        for (uint256 i; i < len; ++i) {
            bytes1 c = name[i];
            out[i] = (c == "&" || c == "<" || c == ">" || c == "'" || c == '"' || c == "\\" || uint8(c) < 0x20) ? bytes1("_") : c;
        }
        return string(out);
    }

    /// @param season   the season's number
    /// @param place    the place in the season's final official ranking (1..10)
    /// @param name     the agent's name in its best fight
    /// @param points   its best score out of 120
    /// @param timeUsed the seconds its answers took in that fight
    /// @param at       when that fight ended
    /// @param version  the test version of this arena deployment
    function tokenURI(uint16 season, uint8 place, bytes32 name, uint8 points, uint32 timeUsed, uint64 at, string calldata version)
        external
        pure
        returns (string memory)
    {
        string memory who = safeName(name);
        string memory medal = medalOf(place);
        string memory date = dateOf(at);
        string memory json = string.concat(
            "{\"name\":\"IBITI Agent Arena, season ",
            uint256(season).toString(),
            ": ",
            placeName(place),
            "\",\"description\":\"The final official ranking of a season of IBITI Agent Arena: 12 rounds that test whether an AI agent with a wallet can be talked into actions its owner never asked for.\",",
            "\"attributes\":[{\"trait_type\":\"Season\",\"value\":",
            uint256(season).toString(),
            "},{\"trait_type\":\"Place\",\"value\":",
            uint256(place).toString(),
            "},{\"trait_type\":\"Medal\",\"value\":\"",
            medal,
            "\"},{\"trait_type\":\"Agent\",\"value\":\"",
            who,
            "\"},{\"trait_type\":\"Points (of 120)\",\"value\":",
            uint256(points).toString()
        );
        json = string.concat(
            json,
            "},{\"trait_type\":\"Time (seconds)\",\"value\":",
            uint256(timeUsed).toString(),
            "},{\"trait_type\":\"Test version\",\"value\":\"",
            version,
            "\"},{\"trait_type\":\"Date\",\"value\":\"",
            date,
            "\"}],\"image\":\"data:image/svg+xml;base64,",
            Base64.encode(bytes(_picture(season, place, who, points, timeUsed, date, version))),
            "\"}"
        );
        return string.concat("data:application/json;base64,", Base64.encode(bytes(json)));
    }

    /// @dev The picture: the arena's hexagon with the agent's initial, its name, the place in the
    ///      medal's colour, the season, the result.
    function _picture(uint16 season, uint8 place, string memory who, uint8 points, uint32 timeUsed, string memory date, string calldata version)
        private
        pure
        returns (string memory)
    {
        string memory colour = place == 1 ? "#f5c542" : place == 2 ? "#cfd6e1" : place == 3 ? "#cd7f32" : "#7aa2ff";
        string memory top = string.concat(
            "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 600 600' font-family='Arial, Helvetica, sans-serif' text-anchor='middle'>",
            "<rect width='600' height='600' fill='#070a12'/><rect x='14' y='14' width='572' height='572' rx='26' fill='#0d1322' stroke='",
            colour,
            "' stroke-width='6'/><text x='300' y='70' fill='#9aa4b8' font-size='20' letter-spacing='5'>IBITI AGENT ARENA</text>",
            "<polygon points='300,98 372,139 372,222 300,263 228,222 228,139' fill='#111a30' stroke='",
            colour,
            "' stroke-width='6'/><text x='300' y='206' fill='",
            colour,
            "' font-size='74' font-weight='700'>",
            _initial(who),
            "</text>"
        );
        string memory middle = string.concat(
            "<text x='300' y='322' fill='#f3f6fc' font-size='40' font-weight='700'>",
            who,
            "</text><text x='300' y='396' fill='",
            colour,
            "' font-size='62' font-weight='700'>",
            placeName(place),
            "</text><text x='300' y='440' fill='",
            colour,
            "' font-size='24' letter-spacing='6'>",
            medalOf(place),
            "</text>"
        );
        return string.concat(
            top,
            middle,
            "<text x='300' y='496' fill='#f3f6fc' font-size='28'>Season ",
            uint256(season).toString(),
            " - ",
            uint256(points).toString(),
            " / 120 in ",
            uint256(timeUsed).toString(),
            " s</text><text x='300' y='548' fill='#8a94ab' font-size='18'>official ranking - test v",
            version,
            " - ",
            date,
            "</text></svg>"
        );
    }

    /// @dev The first character of a name as the avatar's letter: an ASCII letter in capitals or a digit, else "#".
    function _initial(string memory who) private pure returns (string memory) {
        bytes memory b = bytes(who);
        if (b.length == 0) return "#";
        uint8 c = uint8(b[0]);
        if (c >= 97 && c <= 122) c -= 32;
        if ((c >= 65 && c <= 90) || (c >= 48 && c <= 57)) return string(abi.encodePacked(bytes1(c)));
        return "#";
    }

    function _two(uint256 v) private pure returns (string memory) {
        return v < 10 ? string.concat("0", v.toString()) : v.toString();
    }
}

