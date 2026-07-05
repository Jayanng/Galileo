// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title GalileoProfileNFT
 * @notice Soulbound (non-transferable) ERC-721 profile NFT for Galileo agents.
 *         One NFT per user — minted on first wallet creation. Only the operator
 *         (contract owner) can mint. Transfers are permanently disabled.
 *
 *         Implements the minimal IERC721Metadata + IERC721Enumerable surface
 *         without OpenZeppelin dependencies — deployable with ethers directly.
 */
contract GalileoProfileNFT {
    // ─── ERC-721 events ──────────────────────────────────────────────────
    event Transfer(address indexed from, address indexed to, uint256 indexed tokenId);
    event MetadataUpdate(uint256 indexed tokenId);

    // ─── Ownable ─────────────────────────────────────────────────────────
    address public owner;
    modifier onlyOwner() { require(msg.sender == owner, "only owner"); _; }

    // ─── ERC-721 storage ─────────────────────────────────────────────────
    string public name = "Galileo Agent Profile";
    string public symbol = "GALPRO";

    // tokenId → owner
    mapping(uint256 => address) private _owners;
    // owner → token count
    mapping(address => uint256) private _balances;
    // tokenId → tokenURI
    mapping(uint256 => string) private _tokenURIs;
    // user address → tokenId (only one per address — soulbound)
    mapping(address => uint256) private _profileToken;

    uint256 private _nextTokenId = 1;

    // ─── Constructor ─────────────────────────────────────────────────────
    constructor() {
        owner = msg.sender;
    }

    // ─── Must-have ERC-721 read ──────────────────────────────────────────
    function balanceOf(address user) external view returns (uint256) {
        return _balances[user];
    }

    function ownerOf(uint256 tokenId) external view returns (address) {
        address addr = _owners[tokenId];
        require(addr != address(0), "nonexistent token");
        return addr;
    }

    function tokenURI(uint256 tokenId) external view returns (string memory) {
        require(_owners[tokenId] != address(0), "nonexistent token");
        return _tokenURIs[tokenId];
    }

    function totalSupply() external view returns (uint256) {
        return _nextTokenId - 1;
    }

    // ─── Soulbound: transfer, approve, setApprovalForAll all revert ───────
    // No approve/setApprovalForAll storage — caller receives a revert from
    // the fallback or from the default no-op. We explicitly revert on
    // transferFrom / safeTransferFrom.
    function transferFrom(address, address, uint256) external pure {
        revert("soulbound -- non-transferable");
    }
    function safeTransferFrom(address, address, uint256) external pure {
        revert("soulbound -- non-transferable");
    }
    function safeTransferFrom(address, address, uint256, bytes calldata) external pure {
        revert("soulbound -- non-transferable");
    }

    // ─── Profile mint (operator only) ────────────────────────────────────
    /**
     * @notice Mint ONE profile NFT to `to`. Reverts if `to` already has one.
     * @param to       Recipient address (must not already own a profile NFT).
     * @param uri      Metadata URI (ipfs://, https://, or 0G storage URL).
     * @return tokenId The newly minted token ID.
     */
    function mint(address to, string calldata uri) external onlyOwner returns (uint256) {
        require(to != address(0), "zero address");
        require(_profileToken[to] == 0, "already has a profile");
        uint256 tokenId = _nextTokenId++;
        _owners[tokenId] = to;
        _balances[to]++;
        _tokenURIs[tokenId] = uri;
        _profileToken[to] = tokenId;
        emit Transfer(address(0), to, tokenId);
        return tokenId;
    }

    /**
     * @notice Update the tokenURI for an existing profile NFT (operator only).
     *         Emits MetadataUpdate so indexers pick up the change.
     */
    function setTokenURI(uint256 tokenId, string calldata uri) external onlyOwner {
        require(_owners[tokenId] != address(0), "nonexistent token");
        _tokenURIs[tokenId] = uri;
        emit MetadataUpdate(tokenId);
    }

    // ─── Profile lookup ──────────────────────────────────────────────────
    /**
     * @notice Get the token ID for a user address (0 if none).
     */
    function profileOf(address user) external view returns (uint256) {
        return _profileToken[user];
    }

    /**
     * @notice Check whether an address already has a profile NFT.
     */
    function hasProfile(address user) external view returns (bool) {
        return _profileToken[user] != 0;
    }

    // ─── Owner transfer ───────────────────────────────────────────────────
    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "zero address");
        owner = newOwner;
    }
}
