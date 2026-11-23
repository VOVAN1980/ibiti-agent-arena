// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.24;

/// @notice Stand-in for the SPACE ID Agent ID registry on test networks, where the real one does not
///         exist. As in the real registry, the token number of a name is keccak256 of the name.
///         Anyone can give an address a test Agent ID name. Never used on mainnet.
contract MockAgentId {
    mapping(uint256 => address) public ownerOf;
    mapping(address => uint256) public balanceOf;

    function give(address a, string calldata name) external {
        ownerOf[uint256(keccak256(bytes(name)))] = a;
        ++balanceOf[a];
    }
}
