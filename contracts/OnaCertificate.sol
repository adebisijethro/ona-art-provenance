// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title IERC165 — Standard Interface Detection
interface IERC165 {
    function supportsInterface(bytes4 interfaceId) external view returns (bool);
}

/// @title IERC721Receiver — Safe Transfer Receiver Hook
interface IERC721Receiver {
    function onERC721Received(
        address operator,
        address from,
        uint256 tokenId,
        bytes calldata data
    ) external returns (bytes4);
}

/// @title IERC20Minimal — Minimal ERC-20 interface for USDC (Base) and cUSD (Celo MiniPay)
interface IERC20Minimal {
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
}

/// @title OnaCertificate — Physical Art Provenance, NTAG 424 DNA NFC Binding & Enforced ERC-2981 Royalties
/// @author Jethro Adebisi (BlockPrint / Ona Protocol)
/// @notice Pairs physical fine artworks carrying tamper-evident NFC tags with ERC-721 authenticity
///         certificates, IPFS/Filecoin CIDv1 archival pointers, custodial-to-self-custody export,
///         delivery escrow release on NFC tap, and automatic artist resale royalties.
contract OnaCertificate is IERC165 {
    // -------------------------------------------------------------------------
    // Errors
    // -------------------------------------------------------------------------
    error Unauthorized();
    error InvalidAddress();
    error InvalidRoyaltyBps();
    error NonexistentToken();
    error TagAlreadyBound();
    error InvalidNFCCounter();
    error InvalidNFCDigest();
    error EscrowNotFunded();
    error EscrowAlreadyReleased();
    error NotListedForResale();
    error InsufficientPayment();
    error TransferFailed();

    // -------------------------------------------------------------------------
    // Constants
    // -------------------------------------------------------------------------
    uint96 public constant MAX_ROYALTY_BPS = 2500; // 25.00% ceiling
    uint96 public constant MAX_PROTOCOL_FEE_BPS = 800; // 8.00% ceiling
    uint96 public constant BPS_DENOMINATOR = 10_000;

    // -------------------------------------------------------------------------
    // Structs
    // -------------------------------------------------------------------------
    struct ArtworkRecord {
        address artist;              // Original creator & perpetual royalty beneficiary
        uint96 royaltyBps;           // ERC-2981 resale royalty in basis points (e.g., 1000 = 10%)
        bytes32 tagHardwareHash;     // keccak256(nfcTagUID, tagPublicKeySalt)
        uint32 lastTapCounter;       // Monotonic NTAG 424 DNA SUN tap counter (replay protection)
        uint16 editionIndex;         // e.g., 1 of 1, or 2 of 5
        uint16 editionTotal;
        bool physicalVerified;       // Flipped true when collector taps physical NFC tag on delivery
        bool custodialHeld;          // True while held in email-bound custodial vault before export
        string ipfsProvenanceCID;    // Immutable Filecoin/IPFS CIDv1 multihash (bafkrei...)
    }

    struct PrimaryEscrow {
        address paymentToken;        // address(0) for native ETH/CELO, or USDC / cUSD ERC-20 address
        uint256 amount;              // Net escrowed funds awaiting physical NFC tap confirmation
        bool released;
    }

    struct ResaleListing {
        address seller;
        address paymentToken;        // address(0) for native, or USDC / cUSD ERC-20
        uint256 askPrice;
        bool active;
    }

    struct ProvenanceCheckpoint {
        address from;
        address to;
        address paymentToken;
        uint256 salePrice;
        uint256 artistRoyaltyPaid;
        uint32 nfcTapCounter;
        uint64 timestamp;
        string eventKind;            // "MINT", "NFC_DELIVERY_CONFIRMED", "SECONDARY_RESALE", "SELF_CUSTODY_EXPORT"
    }

    // -------------------------------------------------------------------------
    // State
    // -------------------------------------------------------------------------
    string public name = "Ona Art Provenance Certificate";
    string public symbol = "ONA-COA";

    address public admin;
    address public custodialRelayer;
    address public protocolTreasury;
    uint96 public protocolFeeBps = 500; // 5.00% default marketplace fee
    uint256 public totalSupply;

    mapping(uint256 => address) private _owners;
    mapping(address => uint256) private _balances;
    mapping(uint256 => address) private _tokenApprovals;
    mapping(address => mapping(address => bool)) private _operatorApprovals;

    mapping(uint256 => ArtworkRecord) public artworks;
    mapping(bytes32 => uint256) public tagHashToTokenId;
    mapping(uint256 => PrimaryEscrow) public escrows;
    mapping(uint256 => ResaleListing) public resaleListings;
    mapping(uint256 => ProvenanceCheckpoint[]) private _provenanceHistory;

    // -------------------------------------------------------------------------
    // Events
    // -------------------------------------------------------------------------
    event Transfer(address indexed from, address indexed to, uint256 indexed tokenId);
    event Approval(address indexed owner, address indexed approved, uint256 indexed tokenId);
    event ApprovalForAll(address indexed owner, address indexed operator, bool approved);

    event CertificateMinted(
        uint256 indexed tokenId,
        address indexed artist,
        address indexed buyerVault,
        bytes32 tagHardwareHash,
        uint96 royaltyBps,
        string ipfsProvenanceCID
    );

    event PhysicalDeliveryConfirmed(
        uint256 indexed tokenId,
        address indexed collector,
        address indexed artist,
        uint32 nfcTapCounter,
        uint256 escrowReleased
    );

    event SecondaryResaleSettled(
        uint256 indexed tokenId,
        address indexed seller,
        address indexed buyer,
        uint256 salePrice,
        uint256 artistRoyaltyPaid,
        uint256 protocolFeePaid
    );

    event SelfCustodyExported(
        uint256 indexed tokenId,
        address indexed custodialVault,
        address indexed externalWallet
    );

    // -------------------------------------------------------------------------
    // Constructor & Modifiers
    // -------------------------------------------------------------------------
    constructor(address _custodialRelayer, address _protocolTreasury) {
        if (_custodialRelayer == address(0) || _protocolTreasury == address(0)) revert InvalidAddress();
        admin = msg.sender;
        custodialRelayer = _custodialRelayer;
        protocolTreasury = _protocolTreasury;
    }

    modifier onlyAdmin() {
        if (msg.sender != admin) revert Unauthorized();
        _;
    }

    modifier onlyRelayerOrAdmin() {
        if (msg.sender != custodialRelayer && msg.sender != admin) revert Unauthorized();
        _;
    }

    // -------------------------------------------------------------------------
    // ERC-165 & ERC-2981 Royalty Standard
    // -------------------------------------------------------------------------
    function supportsInterface(bytes4 interfaceId) external pure override returns (bool) {
        return
            interfaceId == 0x01ffc9a7 || // IERC165
            interfaceId == 0x80ac58cd || // IERC721
            interfaceId == 0x5b5e139f || // IERC721Metadata
            interfaceId == 0x2a55205a;   // IERC2981
    }

    /// @notice ERC-2981 standard royalty lookup honoured by compliant marketplaces and Ona's resale engine
    function royaltyInfo(uint256 tokenId, uint256 salePrice)
        public
        view
        returns (address receiver, uint256 royaltyAmount)
    {
        if (_owners[tokenId] == address(0)) revert NonexistentToken();
        ArtworkRecord storage art = artworks[tokenId];
        receiver = art.artist;
        royaltyAmount = (salePrice * art.royaltyBps) / BPS_DENOMINATOR;
    }

    // -------------------------------------------------------------------------
    // CoreERC-721 Read Functions
    // -------------------------------------------------------------------------
    function balanceOf(address owner) public view returns (uint256) {
        if (owner == address(0)) revert InvalidAddress();
        return _balances[owner];
    }

    function ownerOf(uint256 tokenId) public view returns (address) {
        address owner = _owners[tokenId];
        if (owner == address(0)) revert NonexistentToken();
        return owner;
    }

    function tokenURI(uint256 tokenId) public view returns (string memory) {
        if (_owners[tokenId] == address(0)) revert NonexistentToken();
        return string(abi.encodePacked("ipfs://", artworks[tokenId].ipfsProvenanceCID));
    }

    function getProvenanceHistory(uint256 tokenId) external view returns (ProvenanceCheckpoint[] memory) {
        if (_owners[tokenId] == address(0)) revert NonexistentToken();
        return _provenanceHistory[tokenId];
    }

    // -------------------------------------------------------------------------
    // 1. Primary Sale Minting + Optional Delivery Escrow (Fiat Relayer or Direct On-Chain)
    // -------------------------------------------------------------------------
    function mintCertificate(
        address artist,
        address buyerRecipient,
        uint96 royaltyBps,
        bytes32 tagHardwareHash,
        uint16 editionIndex,
        uint16 editionTotal,
        bool isCustodialVault,
        string calldata ipfsProvenanceCID,
        address escrowToken,
        uint256 escrowAmount,
        uint256 recordedPrimaryPrice
    ) external payable onlyRelayerOrAdmin returns (uint256 tokenId) {
        if (artist == address(0) || buyerRecipient == address(0)) revert InvalidAddress();
        if (royaltyBps > MAX_ROYALTY_BPS) revert InvalidRoyaltyBps();
        if (tagHardwareHash != bytes32(0) && tagHashToTokenId[tagHardwareHash] != 0) {
            revert TagAlreadyBound();
        }

        unchecked {
            tokenId = ++totalSupply;
        }

        _owners[tokenId] = buyerRecipient;
        _balances[buyerRecipient] += 1;

        artworks[tokenId] = ArtworkRecord({
            artist: artist,
            royaltyBps: royaltyBps,
            tagHardwareHash: tagHardwareHash,
            lastTapCounter: 0,
            editionIndex: editionIndex == 0 ? 1 : editionIndex,
            editionTotal: editionTotal == 0 ? 1 : editionTotal,
            physicalVerified: false,
            custodialHeld: isCustodialVault,
            ipfsProvenanceCID: ipfsProvenanceCID
        });

        if (tagHardwareHash != bytes32(0)) {
            tagHashToTokenId[tagHardwareHash] = tokenId;
        }

        if (escrowAmount > 0) {
            if (escrowToken == address(0)) {
                if (msg.value < escrowAmount) revert InsufficientPayment();
            } else {
                bool ok = IERC20Minimal(escrowToken).transferFrom(msg.sender, address(this), escrowAmount);
                if (!ok) revert TransferFailed();
            }
            escrows[tokenId] = PrimaryEscrow({
                paymentToken: escrowToken,
                amount: escrowAmount,
                released: false
            });
        }

        _provenanceHistory[tokenId].push(
            ProvenanceCheckpoint({
                from: artist,
                to: buyerRecipient,
                paymentToken: escrowToken,
                salePrice: recordedPrimaryPrice,
                artistRoyaltyPaid: 0,
                nfcTapCounter: 0,
                timestamp: uint64(block.timestamp),
                eventKind: "MINT"
            })
        );

        emit Transfer(address(0), buyerRecipient, tokenId);
        emit CertificateMinted(
            tokenId,
            artist,
            buyerRecipient,
            tagHardwareHash,
            royaltyBps,
            ipfsProvenanceCID
        );
    }

    // -------------------------------------------------------------------------
    // 2. Physical NFC Tag Tap Verification & Primary Escrow Release
    // -------------------------------------------------------------------------
    /// @notice Verifies monotonic NTAG 424 DNA tap counter + hardware binding and releases artist escrow
    function confirmPhysicalDelivery(
        uint256 tokenId,
        bytes32 rawTagSecretPreimage,
        uint32 tapCounter
    ) external {
        address currentOwner = ownerOf(tokenId);
        if (msg.sender != currentOwner && msg.sender != custodialRelayer) revert Unauthorized();

        ArtworkRecord storage art = artworks[tokenId];
        if (tapCounter <= art.lastTapCounter) revert InvalidNFCCounter();
        if (keccak256(abi.encodePacked(rawTagSecretPreimage)) != art.tagHardwareHash) {
            revert InvalidNFCDigest();
        }

        art.lastTapCounter = tapCounter;
        art.physicalVerified = true;

        uint256 payoutReleased = 0;
        PrimaryEscrow storage esc = escrows[tokenId];
        if (esc.amount > 0 && !esc.released) {
            esc.released = true;
            payoutReleased = esc.amount;
            _payout(esc.paymentToken, art.artist, payoutReleased);
        }

        _provenanceHistory[tokenId].push(
            ProvenanceCheckpoint({
                from: art.artist,
                to: currentOwner,
                paymentToken: esc.paymentToken,
                salePrice: payoutReleased,
                artistRoyaltyPaid: 0,
                nfcTapCounter: tapCounter,
                timestamp: uint64(block.timestamp),
                eventKind: "NFC_DELIVERY_CONFIRMED"
            })
        );

        emit PhysicalDeliveryConfirmed(tokenId, currentOwner, art.artist, tapCounter, payoutReleased);
    }

    // -------------------------------------------------------------------------
    // 3. Secondary Market Listing & Enforced Artist Royalty Settlement
    // -------------------------------------------------------------------------
    function listForResale(
        uint256 tokenId,
        address paymentToken,
        uint256 askPrice
    ) external {
        address owner = ownerOf(tokenId);
        if (msg.sender != owner && msg.sender != custodialRelayer) revert Unauthorized();
        if (askPrice == 0) revert InsufficientPayment();

        resaleListings[tokenId] = ResaleListing({
            seller: owner,
            paymentToken: paymentToken,
            askPrice: askPrice,
            active: true
        });
    }

    function settleSecondaryResale(
        uint256 tokenId,
        address newCollector,
        uint32 nfcTapCounter
    ) external payable {
        ResaleListing memory listing = resaleListings[tokenId];
        if (!listing.active) revert NotListedForResale();
        if (newCollector == address(0)) revert InvalidAddress();

        ArtworkRecord storage art = artworks[tokenId];
        if (nfcTapCounter > 0) {
            if (nfcTapCounter <= art.lastTapCounter) revert InvalidNFCCounter();
            art.lastTapCounter = nfcTapCounter;
        }

        delete resaleListings[tokenId];

        uint256 gross = listing.askPrice;
        (, uint256 artistRoyalty) = royaltyInfo(tokenId, gross);
        uint256 feeAmount = (gross * protocolFeeBps) / BPS_DENOMINATOR;
        uint256 sellerNet = gross - artistRoyalty - feeAmount;

        if (listing.paymentToken == address(0)) {
            if (msg.value < gross) revert InsufficientPayment();
            _payout(address(0), art.artist, artistRoyalty);
            _payout(address(0), protocolTreasury, feeAmount);
            _payout(address(0), listing.seller, sellerNet);
        } else {
            if (!IERC20Minimal(listing.paymentToken).transferFrom(msg.sender, art.artist, artistRoyalty)) {
                revert TransferFailed();
            }
            if (!IERC20Minimal(listing.paymentToken).transferFrom(msg.sender, protocolTreasury, feeAmount)) {
                revert TransferFailed();
            }
            if (!IERC20Minimal(listing.paymentToken).transferFrom(msg.sender, listing.seller, sellerNet)) {
                revert TransferFailed();
            }
        }

        _transfer(listing.seller, newCollector, tokenId);

        _provenanceHistory[tokenId].push(
            ProvenanceCheckpoint({
                from: listing.seller,
                to: newCollector,
                paymentToken: listing.paymentToken,
                salePrice: gross,
                artistRoyaltyPaid: artistRoyalty,
                nfcTapCounter: art.lastTapCounter,
                timestamp: uint64(block.timestamp),
                eventKind: "SECONDARY_RESALE"
            })
        );

        emit SecondaryResaleSettled(
            tokenId,
            listing.seller,
            newCollector,
            gross,
            artistRoyalty,
            feeAmount
        );
    }

    // -------------------------------------------------------------------------
    // 4. Self-Custody Wallet Export (Email Vault -> Collector's External Wallet)
    // -------------------------------------------------------------------------
    function exportToSelfCustody(uint256 tokenId, address externalWallet) external onlyRelayerOrAdmin {
        if (externalWallet == address(0)) revert InvalidAddress();
        address vault = ownerOf(tokenId);
        ArtworkRecord storage art = artworks[tokenId];
        art.custodialHeld = false;

        _transfer(vault, externalWallet, tokenId);

        _provenanceHistory[tokenId].push(
            ProvenanceCheckpoint({
                from: vault,
                to: externalWallet,
                paymentToken: address(0),
                salePrice: 0,
                artistRoyaltyPaid: 0,
                nfcTapCounter: art.lastTapCounter,
                timestamp: uint64(block.timestamp),
                eventKind: "SELF_CUSTODY_EXPORT"
            })
        );

        emit SelfCustodyExported(tokenId, vault, externalWallet);
    }

    // -------------------------------------------------------------------------
    // Standard ERC-721 Transfers & Approvals
    // -------------------------------------------------------------------------
    function approve(address to, uint256 tokenId) external {
        address owner = ownerOf(tokenId);
        if (msg.sender != owner && !_operatorApprovals[owner][msg.sender]) revert Unauthorized();
        _tokenApprovals[tokenId] = to;
        emit Approval(owner, to, tokenId);
    }

    function getApproved(uint256 tokenId) public view returns (address) {
        if (_owners[tokenId] == address(0)) revert NonexistentToken();
        return _tokenApprovals[tokenId];
    }

    function setApprovalForAll(address operator, bool approved) external {
        _operatorApprovals[msg.sender][operator] = approved;
        emit ApprovalForAll(msg.sender, operator, approved);
    }

    function isApprovedForAll(address owner, address operator) public view returns (bool) {
        return _operatorApprovals[owner][operator];
    }

    function transferFrom(address from, address to, uint256 tokenId) public {
        if (!_isApprovedOrOwner(msg.sender, tokenId)) revert Unauthorized();
        _transfer(from, to, tokenId);
    }

    function safeTransferFrom(address from, address to, uint256 tokenId) external {
        safeTransferFrom(from, to, tokenId, "");
    }

    function safeTransferFrom(address from, address to, uint256 tokenId, bytes memory data) public {
        transferFrom(from, to, tokenId);
        if (to.code.length > 0) {
            bytes4 retval = IERC721Receiver(to).onERC721Received(msg.sender, from, tokenId, data);
            if (retval != IERC721Receiver.onERC721Received.selector) revert TransferFailed();
        }
    }

    function updateProvenanceCID(uint256 tokenId, string calldata newCid) external onlyRelayerOrAdmin {
        if (_owners[tokenId] == address(0)) revert NonexistentToken();
        artworks[tokenId].ipfsProvenanceCID = newCid;
    }

    // -------------------------------------------------------------------------
    // Internal Helpers
    // -------------------------------------------------------------------------
    function _isApprovedOrOwner(address spender, uint256 tokenId) internal view returns (bool) {
        address owner = ownerOf(tokenId);
        return (spender == owner || _tokenApprovals[tokenId] == spender || _operatorApprovals[owner][spender]);
    }

    function _transfer(address from, address to, uint256 tokenId) internal {
        if (ownerOf(tokenId) != from) revert Unauthorized();
        if (to == address(0)) revert InvalidAddress();

        delete _tokenApprovals[tokenId];
        delete resaleListings[tokenId];

        unchecked {
            _balances[from] -= 1;
            _balances[to] += 1;
        }
        _owners[tokenId] = to;

        emit Transfer(from, to, tokenId);
    }

    function _payout(address token, address recipient, uint256 amount) internal {
        if (amount == 0) return;
        if (token == address(0)) {
            (bool ok, ) = payable(recipient).call{value: amount}("");
            if (!ok) revert TransferFailed();
        } else {
            if (!IERC20Minimal(token).transfer(recipient, amount)) revert TransferFailed();
        }
    }
}
