// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.24;

/// @title ArenaPicture: one piece of a certificate picture, kept as the code of this contract.
/// @notice The code is an INVALID byte (0xFE: every call to this contract reverts, so nothing, not
///         even BNB sent by mistake, can arrive) and then the piece's bytes. Code cannot change, so
///         neither can the picture. ArenaArt reads the pieces in order, past that first byte.
contract ArenaPicture {
    constructor(bytes memory piece) {
        bytes memory code = abi.encodePacked(hex"fe", piece);
        assembly {
            return(add(code, 0x20), mload(code))
        }
    }
}
