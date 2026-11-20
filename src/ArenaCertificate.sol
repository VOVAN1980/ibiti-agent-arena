// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {ArenaArt} from "./ArenaArt.sol";

interface IArenaResults {
    function best(address agent) external view returns (uint8 points, uint64 tournament, uint64 at);
    function fightsOf(address agent) external view returns (uint32);
}

/// @title ArenaCertificate: the soulbound IBITI Agent Arena certificate of an Agent ID holder.
/// @notice There is one token per agent, minted by the arena after its first settled tournament.
///         It shows the agent's best grade, and the art is drawn on-chain by ArenaArt.
///         Transfers, burns and approvals always revert. Only the arena can mint.
contract ArenaCertificate is ERC721 {
    address public immutable arena;
    ArenaArt public immutable art;

    error Soulbound();
    error NotArena();

    constructor(string memory name_, string memory symbol_, ArenaArt art_) ERC721(name_, symbol_) {
        arena = msg.sender;
        art = art_;
    }

    function tokenIdOf(address agent) public pure returns (uint256) {
        return uint256(uint160(agent));
    }

    /// @notice Mint the agent's certificate unless it already has one. Arena only.
    function mintOnce(address agent) external {
        if (msg.sender != arena) revert NotArena();
        uint256 id = tokenIdOf(agent);
        if (_ownerOf(id) == address(0)) _mint(agent, id);
    }

    function tokenURI(uint256 tokenId) public view override returns (string memory) {
        address agent = _requireOwned(tokenId);
        IArenaResults r = IArenaResults(arena);
        (uint8 points,,) = r.best(agent);
        return art.tokenURI(points, r.fightsOf(agent));
    }

    /// @dev Soulbound: only minting is allowed; transfers and burns revert.
    function _update(address to, uint256 tokenId, address auth) internal override returns (address) {
        if (_ownerOf(tokenId) != address(0)) revert Soulbound();
        return super._update(to, tokenId, auth);
    }

    function approve(address, uint256) public pure override {
        revert Soulbound();
    }

    function setApprovalForAll(address, bool) public pure override {
        revert Soulbound();
    }
}
