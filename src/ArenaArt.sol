// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Strings} from "@openzeppelin/contracts/utils/Strings.sol";
import {Base64} from "@openzeppelin/contracts/utils/Base64.sol";

/// @title ArenaArt: draws the IBITI Agent Arena season certificate (JSON metadata with an SVG image),
///        fully on-chain.
/// @notice The certificate states the season, the place, the agent's name and the result that earned
///         it: its best official score, the time its answers took, the date and the test version.
///         The picture is a metal card: gold, silver and bronze for places 1-3, graphite for places
///         4-10. The four cards are JPEGs kept on-chain in ArenaPicture contracts, set once at
///         deployment; this contract writes the words over them. No owner: nothing can be changed.
/// @dev    tokenURI is base64 JSON whose image is a base64 SVG whose picture is a base64 JPEG. Each JPEG
///         is kept already base64-encoded three times, and everything before it in each layer ends on a
///         whole base64 group (3 bytes), so the kept bytes go into tokenURI as they are. Reading a
///         certificate then costs about two million gas instead of sixty, well under the limit nodes
///         put on a read (50 million on BNB Chain).
contract ArenaArt {
    using Strings for uint256;

    /// @notice How many pictures there are: gold, silver, bronze and graphite.
    uint8 public constant PICTURES = 4;

    /// @notice The SVG up to its JPEG. 177 bytes: a whole number of base64 groups.
    string public constant SVG_HEAD =
        "<svg xmlns='http://www.w3.org/2000/svg' xmlns:xlink='http://www.w3.org/1999/xlink' viewBox='0 0 1536 1024'><image width='1536' height='1024'  xlink:href='data:image/jpeg;base64,";

    /// @dev For each picture, the ArenaPicture contracts that hold it, in order.
    address[][4] private _pieces;

    error NoPicture();

    /// @param pieces for each picture (0 gold, 1 silver, 2 bronze, 3 graphite), the ArenaPicture
    ///               contracts that hold its JPEG base64-encoded three times, in order
    constructor(address[][4] memory pieces) {
        for (uint256 i; i < PICTURES; ++i) {
            if (pieces[i].length == 0) revert NoPicture();
            uint256 total;
            for (uint256 j; j < pieces[i].length; ++j) {
                uint256 size = pieces[i][j].code.length;
                if (size < 2) revert NoPicture();
                total += size - 1;
            }
            // three whole layers of base64 over a JPEG whose length is a multiple of 27
            if (total % 64 != 0) revert NoPicture();
            _pieces[i] = pieces[i];
        }
    }

    /// @notice The contracts that hold a picture (0 gold, 1 silver, 2 bronze, 3 graphite), in order.
    function piecesOf(uint8 picture) external view returns (address[] memory) {
        return _pieces[picture];
    }

    /// @notice A picture (0 gold, 1 silver, 2 bronze, 3 graphite) as it is kept: its JPEG base64-encoded
    ///         three times. Decode it three times to get the JPEG (art/certificate/*.jpg in the source).
    function encodedPicture(uint8 picture) public view returns (bytes memory out) {
        address[] storage list = _pieces[picture];
        uint256 total;
        for (uint256 i; i < list.length; ++i) total += list[i].code.length - 1;
        out = new bytes(total);
        uint256 at;
        for (uint256 i; i < list.length; ++i) {
            address a = list[i];
            uint256 n = a.code.length - 1;
            assembly {
                extcodecopy(a, add(add(out, 0x20), at), 1, n)
            }
            at += n;
        }
    }

    /// @notice The picture of a place: 0 gold, 1 silver, 2 bronze, 3 graphite for places 4-10.
    function pictureFor(uint8 place) public pure returns (uint8) {
        return place >= 1 && place <= 3 ? place - 1 : 3;
    }

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
        view
        returns (string memory)
    {
        string memory who = safeName(name);
        // The JSON up to the image, then the image's SVG up to its JPEG. Spaces before "image" (JSON
        // allows them) make this end on a whole base64 group, as SVG_HEAD and the kept picture do.
        string memory head = _json(season, place, who, points, timeUsed, at, version);
        string memory svgHead = Base64.encode(bytes(SVG_HEAD));
        uint256 r = (bytes(head).length + 35 + bytes(svgHead).length) % 3; // 35: "image":"data:image/svg+xml;base64,
        string memory before = string.concat(head, r == 1 ? "  " : r == 2 ? " " : "", "\"image\":\"data:image/svg+xml;base64,", svgHead);
        string memory last = string.concat(Base64.encode(bytes(_svgTail(season, place, who, points, timeUsed))), "\"}");
        return string.concat(
            "data:application/json;base64,",
            Base64.encode(bytes(before)),
            string(encodedPicture(pictureFor(place))),
            Base64.encode(bytes(last))
        );
    }

    /// @dev The JSON up to its image: name, description and attributes.
    function _json(uint16 season, uint8 place, string memory who, uint8 points, uint32 timeUsed, uint64 at, string calldata version)
        private
        pure
        returns (string memory)
    {
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
            medalOf(place),
            "\"},{\"trait_type\":\"Agent\",\"value\":\"",
            who,
            "\"},{\"trait_type\":\"Points (of 120)\",\"value\":",
            uint256(points).toString()
        );
        return string.concat(
            json,
            "},{\"trait_type\":\"Time (seconds)\",\"value\":",
            uint256(timeUsed).toString(),
            "},{\"trait_type\":\"Test version\",\"value\":\"",
            version,
            "\"},{\"trait_type\":\"Date\",\"value\":\"",
            dateOf(at),
            "\"}],"
        );
    }

    /// @dev The SVG after its JPEG: the words over the card. "IBITI AGENT ARENA" at the top left, the
    ///      season at the top right, the agent's .ai name large in the middle, its place on the card's
    ///      plaque and its result below. The words are engraved: dark letters with a light edge below
    ///      on gold, silver and bronze; light letters with a dark shadow on graphite.
    function _svgTail(uint16 season, uint8 place, string memory who, uint8 points, uint32 timeUsed)
        private
        pure
        returns (string memory)
    {
        uint8 p = pictureFor(place);
        // the ink, the edge below it, how strong and how far down the edge is, the plaque's middle
        (string memory ink, string memory edge, string memory op, string memory dy, string memory plaqueX) = p == 0
            ? ("#3B2A05", "#FFF4C2", ".7", "2", "767")
            : p == 1
                ? ("#1C2735", "#FFFFFF", ".7", "2", "751")
                : p == 2 ? ("#3A1606", "#FFDCC2", ".7", "2", "765") : ("#ECEFF3", "#000000", ".85", "3", "766");
        string memory words = _words(season, place, who, points, timeUsed, plaqueX);
        return string.concat(
            "'/><g font-family='Palatino Linotype,Palatino,Book Antiqua,Times New Roman,serif' font-weight='700' font-size='40' letter-spacing='3'><g fill='",
            edge,
            "' opacity='",
            op,
            "' transform='translate(0 ",
            dy,
            ")'>",
            words,
            "</g><g fill='",
            ink,
            "'>",
            words,
            "</g></g></svg>"
        );
    }

    function _words(uint16 season, uint8 place, string memory who, uint8 points, uint32 timeUsed, string memory plaqueX)
        private
        pure
        returns (string memory)
    {
        string memory name = _aiName(who);
        uint256 len = bytes(name).length;
        string memory size = len <= 9 ? "132" : len <= 12 ? "120" : len <= 16 ? "96" : len <= 22 ? "72" : "54";
        return string.concat(
            "<text x='112' y='126'>IBITI</text><text x='112' y='174'>AGENT</text><text x='112' y='222'>ARENA</text>",
            "<text x='1424' y='126' text-anchor='end'>SEASON</text><text x='1424' y='222' text-anchor='end' font-size='92' letter-spacing='2'>",
            _two(season),
            "</text><text x='768' y='568' text-anchor='middle' letter-spacing='0' font-size='",
            size,
            "'>",
            name,
            "</text><text y='715' text-anchor='middle' font-size='58' letter-spacing='8' x='",
            plaqueX,
            "'>",
            _upper(placeName(place)),
            "</text><text x='768' y='845' text-anchor='middle' font-size='56' letter-spacing='2'>",
            uint256(points).toString(),
            unicode" / 120 · ",
            uint256(timeUsed).toString(),
            " s</text>"
        );
    }

    /// @dev The name as its Agent ID name: "orion" -> "orion.ai"; a name that ends in ".ai" stays as it is.
    function _aiName(string memory who) private pure returns (string memory) {
        bytes memory b = bytes(who);
        uint256 n = b.length;
        // the Agent ID check ignores case ("ORION.AI" is orion.ai), and so does this one
        if (n >= 3 && b[n - 3] == "." && (b[n - 2] | 0x20) == "a" && (b[n - 1] | 0x20) == "i") return who;
        return string.concat(who, ".ai");
    }

    /// @dev ASCII letters in capitals.
    function _upper(string memory s) private pure returns (string memory) {
        bytes memory b = bytes(s);
        for (uint256 i; i < b.length; ++i) if (b[i] >= "a" && b[i] <= "z") b[i] = bytes1(uint8(b[i]) - 32);
        return string(b);
    }

    function _two(uint256 v) private pure returns (string memory) {
        return v < 10 ? string.concat("0", v.toString()) : v.toString();
    }
}
