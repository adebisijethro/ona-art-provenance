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

/// @title OnaCertificate (v0.4 — Multi-Chain & AI-Agent Hardened Release)
/// @author Jethro Adebisi (BlockPrint / Ona Protocol)
/// @notice Open-source physical-to-digital art provenance certificate (ERC-721 + ERC-2981) with:
///         - Time-bounded EIP-191 ECDSA Secure Unique NFC (NTAG 424 DNA SUN) signature verification
///         - Primary sale delivery escrow gate (blocks transfer/resale while delivery escrow is pending)
///         - Strict self-custody sovereignty (relayer/admin locked out once exported or direct-minted)
///         - Artist beneficiary wallet rotation (`updateArtistBeneficiary`) & two-step admin rotation
///         - Atomic secondary resale settlement enforcing ERC-2981 royalties (native + SafeERC20)
contract OnaCertificate is IERC165 {
    // -------------------------------------------------------------------------
    // Errors
    // -------------------------------------------------------------------------
    error Unauthorized();
    error ReentrancyBlocked();
    error InvalidAddress();
    error InvalidEdition();
    error InvalidRoyaltyBps();
    error InvalidProtocolFeeBps();
    error NonexistentToken();
    error TagAlreadyBound();
    error NoPhysicalTagBound();
    error InvalidNFCCounter();
    error InvalidNFCSignature();
    error SignatureExpired();
    error DeliveryEscrowPending();
    error AlreadySelfCustodied();
    error NotListedForResale();
    error SelfPurchaseDisallowed();
    error InsufficientPayment();
    error UnexpectedNativeValue();
    error TransferFailed();

    // -------------------------------------------------------------------------
    // Constants
    // -------------------------------------------------------------------------
    uint96 public constant MAX_ROYALTY_BPS = 2500; // 25.00% ceiling
    uint96 public constant MAX_PROTOCOL_FEE_BPS = 800; // 8.00% ceiling
    uint96 public constant BPS_DENOMINATOR = 10_000;
    uint256 private constant SECP256K1N_HALF =
        0x7FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF5D576E7357A4501DDFE92F46681B20A0;

    // -------------------------------------------------------------------------
    // Structs
    // -------------------------------------------------------------------------
    struct MintParams {
        address artist;
        address buyerRecipient;
        uint96 royaltyBps;
        bytes32 tagHardwareHash;
        uint16 editionIndex;
        uint16 editionTotal;
        bool isCustodialVault;
        string ipfsProvenanceCID;
        address escrowToken;
        uint256 escrowAmount;
        uint256 recordedPrimaryPrice;
    }

    struct ArtworkRecord {
        address artist;
        uint96 royaltyBps;
        bytes32 tagHardwareHash;
        uint32 lastTapCounter;
        uint16 editionIndex;
        uint16 editionTotal;
        bool physicalVerified;
        bool custodialHeld;
        string ipfsProvenanceCID;
    }

    struct PrimaryEscrow {
        address paymentToken;
        uint256 amount;
        bool released;
    }

    struct ResaleListing {
        address seller;
        address paymentToken;
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
        string eventKind;
    }

    // -------------------------------------------------------------------------
    // State
    // -------------------------------------------------------------------------
    string public name = "Ona Art Provenance Certificate";
    string public symbol = "ONA-COA";

    address public admin;
    address public pendingAdmin;
    address public custodialRelayer;
    address public nfcSunVerifier;
    address public protocolTreasury;
    uint96 public protocolFeeBps = 500; // 5.00% default marketplace fee
    uint256 public totalSupply;

    uint256 private _reentrancyLock = 1;

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

    event ResaleListed(
        uint256 indexed tokenId,
        address indexed seller,
        address indexed paymentToken,
        uint256 askPrice
    );

    event ResaleCancelled(uint256 indexed tokenId, address indexed seller);

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

    event ArtistBeneficiaryUpdated(
        uint256 indexed tokenId,
        address indexed previousArtist,
        address indexed newArtist
    );

    event AdminTransferInitiated(address indexed currentAdmin, address indexed pendingAdmin);
    event AdminTransferCompleted(address indexed previousAdmin, address indexed newAdmin);

    event ProtocolConfigUpdated(
        address indexed custodialRelayer,
        address indexed nfcSunVerifier,
        address indexed protocolTreasury,
        uint96 protocolFeeBps
    );

    // -------------------------------------------------------------------------
    // Constructor & Modifiers
    // -------------------------------------------------------------------------
    constructor(
        address _custodialRelayer,
        address _nfcSunVerifier,
        address _protocolTreasury
    ) {
        if (
            _custodialRelayer == address(0) ||
            _nfcSunVerifier == address(0) ||
            _protocolTreasury == address(0)
        ) {
            revert InvalidAddress();
        }
        admin = msg.sender;
        custodialRelayer = _custodialRelayer;
        nfcSunVerifier = _nfcSunVerifier;
        protocolTreasury = _protocolTreasury;
    }

    modifier nonReentrant() {
        if (_reentrancyLock != 1) revert ReentrancyBlocked();
        _reentrancyLock = 2;
        _;
        _reentrancyLock = 1;
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
    // Core ERC-721 Read Functions
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

    /// @notice Computes the time-bounded inner digest signed by `nfcSunVerifier` (EIP-191)
    function computeNfcTapDigest(
        uint256 tokenId,
        bytes32 tagHardwareHash,
        uint32 tapCounter,
        address actor,
        uint64 signatureDeadline
    ) public view returns (bytes32) {
        return
            keccak256(
                abi.encode(
                    block.chainid,
                    address(this),
                    tokenId,
                    tagHardwareHash,
                    tapCounter,
                    actor,
                    signatureDeadline
                )
            );
    }

    // -------------------------------------------------------------------------
    // 1. Primary Sale Minting + Optional Delivery Escrow
    // -------------------------------------------------------------------------
    function mintCertificate(MintParams calldata p)
        external
        payable
        nonReentrant
        onlyRelayerOrAdmin
        returns (uint256 tokenId)
    {
        if (p.artist == address(0) || p.buyerRecipient == address(0)) revert InvalidAddress();
        if (p.royaltyBps > MAX_ROYALTY_BPS) revert InvalidRoyaltyBps();
        if (p.tagHardwareHash != bytes32(0) && tagHashToTokenId[p.tagHardwareHash] != 0) {
            revert TagAlreadyBound();
        }

        uint16 edIndex = p.editionIndex == 0 ? 1 : p.editionIndex;
        uint16 edTotal = p.editionTotal == 0 ? 1 : p.editionTotal;
        if (edIndex > edTotal) revert InvalidEdition();

        uint256 refund = 0;
        if (p.escrowAmount == 0) {
            if (msg.value != 0) revert UnexpectedNativeValue();
        } else if (p.escrowToken == address(0)) {
            if (msg.value < p.escrowAmount) revert InsufficientPayment();
            refund = msg.value - p.escrowAmount;
        } else {
            if (msg.value != 0) revert UnexpectedNativeValue();
        }

        unchecked {
            tokenId = ++totalSupply;
        }

        _owners[tokenId] = p.buyerRecipient;
        _balances[p.buyerRecipient] += 1;

        artworks[tokenId] = ArtworkRecord({
            artist: p.artist,
            royaltyBps: p.royaltyBps,
            tagHardwareHash: p.tagHardwareHash,
            lastTapCounter: 0,
            editionIndex: edIndex,
            editionTotal: edTotal,
            physicalVerified: false,
            custodialHeld: p.isCustodialVault,
            ipfsProvenanceCID: p.ipfsProvenanceCID
        });

        if (p.tagHardwareHash != bytes32(0)) {
            tagHashToTokenId[p.tagHardwareHash] = tokenId;
        }

        if (p.escrowAmount > 0) {
            escrows[tokenId] = PrimaryEscrow({
                paymentToken: p.escrowToken,
                amount: p.escrowAmount,
                released: false
            });
        }

        _provenanceHistory[tokenId].push(
            ProvenanceCheckpoint({
                from: p.artist,
                to: p.buyerRecipient,
                paymentToken: p.escrowToken,
                salePrice: p.recordedPrimaryPrice,
                artistRoyaltyPaid: 0,
                nfcTapCounter: 0,
                timestamp: uint64(block.timestamp),
                eventKind: "MINT"
            })
        );

        emit Transfer(address(0), p.buyerRecipient, tokenId);
        emit CertificateMinted(
            tokenId,
            p.artist,
            p.buyerRecipient,
            p.tagHardwareHash,
            p.royaltyBps,
            p.ipfsProvenanceCID
        );

        if (p.escrowAmount > 0 && p.escrowToken != address(0)) {
            _safeTransferFrom(p.escrowToken, msg.sender, address(this), p.escrowAmount);
        }
        if (refund > 0) {
            _payout(address(0), msg.sender, refund);
        }
    }

    // -------------------------------------------------------------------------
    // 2. Physical NFC Tag Tap Verification & Primary Escrow Release
    // -------------------------------------------------------------------------
    function confirmPhysicalDelivery(
        uint256 tokenId,
        uint32 tapCounter,
        uint64 signatureDeadline,
        bytes calldata sunSignature
    ) external nonReentrant {
        if (block.timestamp > signatureDeadline) revert SignatureExpired();

        address currentOwner = ownerOf(tokenId);
        ArtworkRecord storage art = artworks[tokenId];

        bool authorizedCaller = (msg.sender == currentOwner) ||
            (msg.sender == custodialRelayer && art.custodialHeld);
        if (!authorizedCaller) revert Unauthorized();

        if (art.tagHardwareHash == bytes32(0)) revert NoPhysicalTagBound();
        if (tapCounter <= art.lastTapCounter) revert InvalidNFCCounter();

        _verifyNfcSunSignature(
            tokenId,
            art.tagHardwareHash,
            tapCounter,
            currentOwner,
            signatureDeadline,
            sunSignature
        );

        art.lastTapCounter = tapCounter;
        art.physicalVerified = true;

        uint256 payoutReleased = 0;
        PrimaryEscrow storage esc = escrows[tokenId];
        address payoutToken = esc.paymentToken;
        if (esc.amount > 0 && !esc.released) {
            esc.released = true;
            payoutReleased = esc.amount;
        }

        _provenanceHistory[tokenId].push(
            ProvenanceCheckpoint({
                from: art.artist,
                to: currentOwner,
                paymentToken: payoutToken,
                salePrice: payoutReleased,
                artistRoyaltyPaid: 0,
                nfcTapCounter: tapCounter,
                timestamp: uint64(block.timestamp),
                eventKind: "NFC_DELIVERY_CONFIRMED"
            })
        );

        emit PhysicalDeliveryConfirmed(tokenId, currentOwner, art.artist, tapCounter, payoutReleased);

        if (payoutReleased > 0) {
            _payout(payoutToken, art.artist, payoutReleased);
        }
    }

    // -------------------------------------------------------------------------
    // 3. Secondary Market Listing, Cancellation & Enforced Royalty Settlement
    // -------------------------------------------------------------------------
    function listForResale(
        uint256 tokenId,
        address paymentToken,
        uint256 askPrice
    ) external {
        _requireEscrowSettled(tokenId);
        address owner = ownerOf(tokenId);
        ArtworkRecord storage art = artworks[tokenId];

        bool authorizedCaller = _isApprovedOrOwner(msg.sender, tokenId) ||
            (msg.sender == custodialRelayer && art.custodialHeld);
        if (!authorizedCaller) revert Unauthorized();
        if (askPrice == 0) revert InsufficientPayment();

        resaleListings[tokenId] = ResaleListing({
            seller: owner,
            paymentToken: paymentToken,
            askPrice: askPrice,
            active: true
        });

        emit ResaleListed(tokenId, owner, paymentToken, askPrice);
    }

    function cancelResaleListing(uint256 tokenId) external {
        address owner = ownerOf(tokenId);
        ArtworkRecord storage art = artworks[tokenId];

        bool authorizedCaller = _isApprovedOrOwner(msg.sender, tokenId) ||
            (msg.sender == custodialRelayer && art.custodialHeld);
        if (!authorizedCaller) revert Unauthorized();
        if (!resaleListings[tokenId].active) revert NotListedForResale();

        delete resaleListings[tokenId];
        emit ResaleCancelled(tokenId, owner);
    }

    function settleSecondaryResale(
        uint256 tokenId,
        address newCollector,
        bool newCollectorIsCustodial,
        uint32 nfcTapCounter,
        uint64 signatureDeadline,
        bytes calldata sunSignature
    ) external payable nonReentrant {
        ResaleListing memory listing = resaleListings[tokenId];
        if (!listing.active) revert NotListedForResale();
        if (ownerOf(tokenId) != listing.seller) revert NotListedForResale();
        if (newCollector == address(0)) revert InvalidAddress();
        if (newCollector == listing.seller) revert SelfPurchaseDisallowed();
        if (newCollectorIsCustodial && msg.sender != custodialRelayer && msg.sender != admin) {
            revert Unauthorized();
        }

        uint256 gross = listing.askPrice;
        uint256 refund = 0;
        if (listing.paymentToken == address(0)) {
            if (msg.value < gross) revert InsufficientPayment();
            refund = msg.value - gross;
        } else {
            if (msg.value != 0) revert UnexpectedNativeValue();
        }

        ArtworkRecord storage art = artworks[tokenId];
        if (nfcTapCounter > 0) {
            if (block.timestamp > signatureDeadline) revert SignatureExpired();
            if (art.tagHardwareHash == bytes32(0)) revert NoPhysicalTagBound();
            if (nfcTapCounter <= art.lastTapCounter) revert InvalidNFCCounter();
            _verifyNfcSunSignature(
                tokenId,
                art.tagHardwareHash,
                nfcTapCounter,
                newCollector,
                signatureDeadline,
                sunSignature
            );
            art.lastTapCounter = nfcTapCounter;
        }

        (, uint256 artistRoyalty) = royaltyInfo(tokenId, gross);
        uint256 feeAmount = (gross * protocolFeeBps) / BPS_DENOMINATOR;
        uint256 sellerNet = gross - artistRoyalty - feeAmount;

        delete resaleListings[tokenId];
        art.custodialHeld = newCollectorIsCustodial;
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

        if (listing.paymentToken == address(0)) {
            _payout(address(0), art.artist, artistRoyalty);
            _payout(address(0), protocolTreasury, feeAmount);
            _payout(address(0), listing.seller, sellerNet);
            if (refund > 0) {
                _payout(address(0), msg.sender, refund);
            }
        } else {
            if (artistRoyalty > 0) {
                _safeTransferFrom(listing.paymentToken, msg.sender, art.artist, artistRoyalty);
            }
            if (feeAmount > 0) {
                _safeTransferFrom(listing.paymentToken, msg.sender, protocolTreasury, feeAmount);
            }
            if (sellerNet > 0) {
                _safeTransferFrom(listing.paymentToken, msg.sender, listing.seller, sellerNet);
            }
        }
    }

    // -------------------------------------------------------------------------
    // 4. Self-Custody Export & Artist Royalty Beneficiary Rotation
    // -------------------------------------------------------------------------
    function exportToSelfCustody(uint256 tokenId, address externalWallet) external onlyRelayerOrAdmin {
        if (externalWallet == address(0)) revert InvalidAddress();
        _requireEscrowSettled(tokenId);

        address vault = ownerOf(tokenId);
        ArtworkRecord storage art = artworks[tokenId];
        if (!art.custodialHeld) revert AlreadySelfCustodied();

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

    /// @notice Allows ONLY the original artist to rotate their ERC-2981 royalty payout address
    function updateArtistBeneficiary(uint256 tokenId, address newArtist) external {
        if (_owners[tokenId] == address(0)) revert NonexistentToken();
        if (newArtist == address(0)) revert InvalidAddress();
        ArtworkRecord storage art = artworks[tokenId];
        if (msg.sender != art.artist) revert Unauthorized();

        address previous = art.artist;
        art.artist = newArtist;
        emit ArtistBeneficiaryUpdated(tokenId, previous, newArtist);
    }

    // -------------------------------------------------------------------------
    // Standard ERC-721 Transfers & Approvals
    // -------------------------------------------------------------------------
    function approve(address to, uint256 tokenId) external {
        address owner = ownerOf(tokenId);
        if (to == owner) revert InvalidAddress();
        if (msg.sender != owner && !_operatorApprovals[owner][msg.sender]) revert Unauthorized();
        _tokenApprovals[tokenId] = to;
        emit Approval(owner, to, tokenId);
    }

    function getApproved(uint256 tokenId) public view returns (address) {
        if (_owners[tokenId] == address(0)) revert NonexistentToken();
        return _tokenApprovals[tokenId];
    }

    function setApprovalForAll(address operator, bool approved) external {
        if (operator == address(0) || operator == msg.sender) revert InvalidAddress();
        _operatorApprovals[msg.sender][operator] = approved;
        emit ApprovalForAll(msg.sender, operator, approved);
    }

    function isApprovedForAll(address owner, address operator) public view returns (bool) {
        return _operatorApprovals[owner][operator];
    }

    function transferFrom(address from, address to, uint256 tokenId) public {
        _requireEscrowSettled(tokenId);
        if (!_isApprovedOrOwner(msg.sender, tokenId)) revert Unauthorized();
        artworks[tokenId].custodialHeld = false;
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

    // -------------------------------------------------------------------------
    // Two-Step Admin & Protocol Configuration
    // -------------------------------------------------------------------------
    function transferAdmin(address _pendingAdmin) external onlyAdmin {
        if (_pendingAdmin == address(0)) revert InvalidAddress();
        pendingAdmin = _pendingAdmin;
        emit AdminTransferInitiated(admin, _pendingAdmin);
    }

    function acceptAdmin() external {
        if (msg.sender != pendingAdmin) revert Unauthorized();
        address prev = admin;
        admin = pendingAdmin;
        pendingAdmin = address(0);
        emit AdminTransferCompleted(prev, admin);
    }

    function updateProvenanceCID(uint256 tokenId, string calldata newCid) external onlyRelayerOrAdmin {
        if (_owners[tokenId] == address(0)) revert NonexistentToken();
        artworks[tokenId].ipfsProvenanceCID = newCid;
    }

    function setProtocolConfig(
        address _custodialRelayer,
        address _nfcSunVerifier,
        address _protocolTreasury,
        uint96 _protocolFeeBps
    ) external onlyAdmin {
        if (
            _custodialRelayer == address(0) ||
            _nfcSunVerifier == address(0) ||
            _protocolTreasury == address(0)
        ) {
            revert InvalidAddress();
        }
        if (_protocolFeeBps > MAX_PROTOCOL_FEE_BPS) revert InvalidProtocolFeeBps();

        custodialRelayer = _custodialRelayer;
        nfcSunVerifier = _nfcSunVerifier;
        protocolTreasury = _protocolTreasury;
        protocolFeeBps = _protocolFeeBps;

        emit ProtocolConfigUpdated(
            _custodialRelayer,
            _nfcSunVerifier,
            _protocolTreasury,
            _protocolFeeBps
        );
    }

    // -------------------------------------------------------------------------
    // Internal Cryptographic & SafeERC20 Helpers
    // -------------------------------------------------------------------------
    function _requireEscrowSettled(uint256 tokenId) internal view {
        PrimaryEscrow storage esc = escrows[tokenId];
        if (esc.amount > 0 && !esc.released) revert DeliveryEscrowPending();
    }

    function _verifyNfcSunSignature(
        uint256 tokenId,
        bytes32 tagHardwareHash,
        uint32 tapCounter,
        address actor,
        uint64 signatureDeadline,
        bytes calldata sig
    ) internal view {
        if (sig.length != 65) revert InvalidNFCSignature();
        bytes32 digest = computeNfcTapDigest(
            tokenId,
            tagHardwareHash,
            tapCounter,
            actor,
            signatureDeadline
        );
        bytes32 ethSignedHash = keccak256(
            abi.encodePacked("\x19Ethereum Signed Message:\n32", digest)
        );

        bytes32 r;
        bytes32 s;
        uint8 v;
        assembly {
            r := calldataload(sig.offset)
            s := calldataload(add(sig.offset, 32))
            v := byte(0, calldataload(add(sig.offset, 64)))
        }
        if (v < 27) v += 27;
        if (v != 27 && v != 28) revert InvalidNFCSignature();
        if (uint256(s) > SECP256K1N_HALF) revert InvalidNFCSignature();

        address recovered = ecrecover(ethSignedHash, v, r, s);
        if (recovered == address(0) || recovered != nfcSunVerifier) {
            revert InvalidNFCSignature();
        }
    }

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
            _safeTransfer(token, recipient, amount);
        }
    }

    function _safeTransfer(address token, address to, uint256 amount) internal {
        (bool ok, bytes memory data) = token.call(
            abi.encodeWithSelector(0xa9059cbb, to, amount)
        );
        if (!ok || (data.length > 0 && !abi.decode(data, (bool)))) {
            revert TransferFailed();
        }
    }

    function _safeTransferFrom(address token, address from, address to, uint256 amount) internal {
        (bool ok, bytes memory data) = token.call(
            abi.encodeWithSelector(0x23b872dd, from, to, amount)
        );
        if (!ok || (data.length > 0 && !abi.decode(data, (bool)))) {
            revert TransferFailed();
        }
    }
}
