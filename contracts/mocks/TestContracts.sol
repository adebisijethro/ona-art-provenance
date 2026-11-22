// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "../OnaCertificate.sol";

/// @notice Standard 6-decimal USDC / 18-decimal cUSD Mock ERC-20
contract MockERC20 {
    string public name;
    string public symbol;
    uint8 public decimals;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    constructor(string memory _name, string memory _symbol, uint8 _decimals) {
        name = _name;
        symbol = _symbol;
        decimals = _decimals;
    }

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        return true;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        require(balanceOf[msg.sender] >= amount, "balance");
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        require(balanceOf[from] >= amount, "balance");
        require(allowance[from][msg.sender] >= amount, "allowance");
        allowance[from][msg.sender] -= amount;
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        return true;
    }
}

/// @notice Legacy USDT-style ERC-20 that returns NO boolean data on transfer/transferFrom
contract MockNonStandardERC20 {
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
    }

    function approve(address spender, uint256 amount) external {
        allowance[msg.sender][spender] = amount;
    }

    function transfer(address to, uint256 amount) external {
        require(balanceOf[msg.sender] >= amount, "balance");
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
    }

    function transferFrom(address from, address to, uint256 amount) external {
        require(balanceOf[from] >= amount, "balance");
        require(allowance[from][msg.sender] >= amount, "allowance");
        allowance[from][msg.sender] -= amount;
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
    }
}

/// @notice Malicious contract attempting reentrancy during ETH payout callback
contract MaliciousReentrantParticipant {
    OnaCertificate public target;
    uint256 public attackTokenId;
    bool public attemptReentry;
    bool public reentryBlockedAsExpected;

    constructor(OnaCertificate _target) {
        target = _target;
    }

    function armAttack(uint256 tokenId) external {
        attackTokenId = tokenId;
        attemptReentry = true;
    }

    function listPiece(uint256 tokenId, uint256 price) external {
        target.listForResale(tokenId, address(0), price);
    }

    receive() external payable {
        if (attemptReentry) {
            attemptReentry = false;
            try target.settleSecondaryResale{value: msg.value}(
                attackTokenId,
                address(this),
                false,
                0,
                0,
                ""
            ) {
                reentryBlockedAsExpected = false;
            } catch {
                reentryBlockedAsExpected = true;
            }
        }
    }
}

/// @notice Compliant ERC-721 safeTransferFrom receiver
contract MockERC721Receiver is IERC721Receiver {
    uint256 public lastReceivedTokenId;

    function onERC721Received(
        address,
        address,
        uint256 tokenId,
        bytes calldata
    ) external override returns (bytes4) {
        lastReceivedTokenId = tokenId;
        return IERC721Receiver.onERC721Received.selector;
    }
}

/// @notice Non-compliant contract without valid selector to verify safeTransferFrom revert
contract RejectingERC721Receiver is IERC721Receiver {
    function onERC721Received(
        address,
        address,
        uint256,
        bytes calldata
    ) external pure override returns (bytes4) {
        return 0xdeadbeef;
    }
}
