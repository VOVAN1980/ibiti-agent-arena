// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.24;

/// @title ArenaPicture: one piece of a certificate picture, kept as the code of this contract.
/// @notice The code is a zero byte (STOP: a call to this contract does nothing) and then the piece's
///         bytes. Code cannot change, so neither can the picture. ArenaArt reads the pieces in order.
contract ArenaPicture {
    constructor(bytes memory piece) {
        bytes memory code = abi.encodePacked(hex"00", piece);
        assembly {
            return(add(code, 0x20), mload(code))
        }
    }
}
