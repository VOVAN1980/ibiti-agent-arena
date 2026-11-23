// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.24;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {ArenaArt} from "./ArenaArt.sol";
import {ArenaRanking} from "./ArenaRanking.sol";

/// @title ArenaCertificate: one season of the IBITI Agent Arena tournament ring — its official
///        ranking, its close, and the soulbound certificates of its first ten places.
/// @notice The ranking and the close are ArenaRanking's. At the close each of the first PLACES agents
///         also gets a certificate of its place (1: gold, 2: silver, 3: bronze, 4-10: the place),
///         drawn on-chain by ArenaArt. Transfers, burns and approvals always revert.
contract ArenaCertificate is ArenaRanking, ERC721 {
    ArenaArt public immutable art;
    /// @notice The test version of this arena deployment, shown on every certificate.
    string public testVersion;

    error Soulbound();

    /// @param arena_ the arena whose season this is: only it reports results, and the season's end and
    ///        judge are read from it
    constructor(string memory name_, string memory symbol_, address arena_, ArenaArt art_, string memory testVersion_, uint16 season_)
        ArenaRanking(arena_, season_)
        ERC721(name_, symbol_)
    {
        art = art_;
        testVersion = testVersion_;
    }

    function tokenIdOf(address agent) public pure returns (uint256) {
        return uint256(uint160(agent));
    }

    function tokenURI(uint256 tokenId) public view override returns (string memory) {
        address agent = _requireOwned(tokenId);
        Result storage r = resultOf[agent];
        return art.tokenURI(season, placeOf[agent], r.name, r.points, r.timeUsed, r.at, testVersion);
    }

    /// @dev A place's certificate, minted at the close.
    function _award(address agent) internal override {
        _mint(agent, tokenIdOf(agent));
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
