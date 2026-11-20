// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/// @notice Stand-in for the SPACE ID Agent ID registry on test networks, where the real one does not
///         exist. Anyone can give an address a test "Agent ID". Never used on mainnet.
contract MockAgentId {
    mapping(address => uint256) public balanceOf;

    function give(address a) external {
        balanceOf[a] = 1;
    }
}
