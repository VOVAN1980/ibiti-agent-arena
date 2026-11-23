// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.24;

import {Vm} from "forge-std/Vm.sol";
import {Base64} from "@openzeppelin/contracts/utils/Base64.sol";
import {ArenaArt} from "../src/ArenaArt.sol";
import {ArenaPicture} from "../src/ArenaPicture.sol";

/// @notice Puts the four certificate pictures (art/certificate/*.jpg) on-chain and deploys ArenaArt over
///         them. Each JPEG is base64-encoded three times (the form it takes inside tokenURI, see
///         ArenaArt) and cut into pieces that fit a contract's code: at most 24,576 bytes (EIP-170),
///         one of them the leading zero.
library ArenaPictures {
    uint256 internal constant PIECE = 24_575;

    /// @notice The pictures, in ArenaArt's order: gold, silver, bronze, graphite.
    function files() internal pure returns (string[4] memory) {
        return [
            "art/certificate/gold.jpg",
            "art/certificate/silver.jpg",
            "art/certificate/bronze.jpg",
            "art/certificate/graphite.jpg"
        ];
    }

    /// @notice A JPEG as ArenaArt keeps it.
    function encode(bytes memory jpeg) internal pure returns (bytes memory) {
        require(jpeg.length % 27 == 0, "a picture's length must be a multiple of 27 (see art/certificate/shrink.py)");
        return bytes(Base64.encode(bytes(Base64.encode(bytes(Base64.encode(jpeg))))));
    }

    function deploy(Vm vm) internal returns (ArenaArt art) {
        string[4] memory f = files();
        bytes[4] memory kept;
        address[][4] memory pieces;
        for (uint256 i; i < 4; ++i) {
            bytes memory data = encode(vm.readFileBinary(f[i]));
            kept[i] = data;
            uint256 n = (data.length + PIECE - 1) / PIECE;
            pieces[i] = new address[](n);
            for (uint256 k; k < n; ++k) {
                uint256 from = k * PIECE;
                uint256 to = from + PIECE < data.length ? from + PIECE : data.length;
                pieces[i][k] = address(new ArenaPicture(_slice(data, from, to)));
            }
        }
        art = new ArenaArt(pieces);
        // what the chain gives back is what was put there, byte for byte
        for (uint8 i; i < 4; ++i) require(keccak256(art.encodedPicture(i)) == keccak256(kept[i]), "picture differs from its file");
    }

    function _slice(bytes memory b, uint256 from, uint256 to) private pure returns (bytes memory out) {
        out = new bytes(to - from);
        assembly {
            mcopy(add(out, 0x20), add(add(b, 0x20), from), sub(to, from))
        }
    }
}
