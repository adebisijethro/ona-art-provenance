# Ona: Physical Art Provenance & NFC Certificate Engine

[![License: MIT](https://img.shields.io/badge/License-MIT-9c3b24.svg)](LICENSE)
[![Karma GAP](https://img.shields.io/badge/Karma_GAP-Verified_On--Chain-1b4d3e)](https://gap.karmahq.xyz/project/ona-physical-art-provenance-nfc-certificate-engine)
[![Standards](https://img.shields.io/badge/Standards-ERC--721_%7C_ERC--2981_%7C_NTAG_424_DNA-181512)](contracts/SPECIFICATION.md)

**Live Interactive Prototype & Verifier:** [https://adebisijethro.github.io/ona-art-provenance/](https://adebisijethro.github.io/ona-art-provenance/)  
**Karma GAP Project Profile (Base Mainnet `8453`):** [gap.karmahq.xyz/project/ona-physical-art-provenance-nfc-certificate-engine](https://gap.karmahq.xyz/project/ona-physical-art-provenance-nfc-certificate-engine)  
**Author:** Jethro Adebisi ([Portfolio](https://jethrotheuxpert.vercel.app/) · [BlockPrint](https://blockprint.team))

---

## Overview

**Ona** is an open-source physical-to-digital art provenance protocol and walletless checkout engine built for emerging African and global fine artists:

1. **Walletless Card & Mobile Stablecoin Checkout:** Collectors pay by card/bank transfer (**Paystack NGN**, **Stripe USD**) or mobile stablecoins (**Celo MiniPay `cUSD`**, **Base `USDC`**) without seed phrases. Email-onboarded buyers receive deterministic custodial vaults exportable to self-custody at any time (`exportToSelfCustody`).
2. **Tamper-Evident NTAG 424 DNA NFC Authentication & Escrow Release:** Physical canvases and sculptures carry NXP NTAG 424 DNA tags operating in Secure Unique NFC (`SUN`) rolling-counter mode. Primary sale funds stay locked in `OnaCertificate.sol` until the collector taps the physical NFC tag upon delivery (`confirmPhysicalDelivery`), defeating static QR/URL replay attacks.
3. **Enforced ERC-2981 Artist Resale Royalties:** Secondary market sales settled through `settleSecondaryResale()` split proceeds atomically in a single transaction—routing `5%–25%` creator royalties directly to the original artist while transferring the certificate and recording an immutable provenance checkpoint.
4. **Content-Addressed Filecoin / IPFS Archival:** Every artwork master plate, physical specification, and provenance checkpoint is hashed into an RFC-compliant **CIDv1 (`bafkrei...`)** SHA-256 multihash (`metadata/provenance_registry.json`).

---

## Repository Structure

| Path | Description |
| :--- | :--- |
| [`contracts/OnaCertificate.sol`](contracts/OnaCertificate.sol) | Production Solidity (`^0.8.20`) smart contract implementing `ERC-721`, `ERC-2981`, NTAG 424 DNA monotonic counter replay protection, delivery escrow release, and enforced secondary resale splits. |
| [`contracts/abi/OnaCertificate.json`](contracts/abi/OnaCertificate.json) | Compiled ABI, EVM bytecode (`12,665 bytes` runtime), and ERC-165/721/2981 method selectors (`solc 0.8.26`). |
| [`contracts/SPECIFICATION.md`](contracts/SPECIFICATION.md) | Milestone 1 technical specification: end-to-end sequence flows, NTAG 424 DNA SUN cryptographic model, and multi-chain standard mapping (Base, Celo, Filecoin, Tezos, Cardano, Flow). |
| [`sdk/ona-protocol.mjs`](sdk/ona-protocol.mjs) | Zero-dependency ES module SDK for RFC 4648 CIDv1 computation, NTAG 424 DNA SUN tap signing/verification, email custodial vault derivation, and ERC-2981 split calculation. |
| [`metadata/`](metadata/) | Generated pilot exhibition provenance bundles (`ona_piece_001.json` – `ona_piece_003.json`) and master [`provenance_registry.json`](metadata/provenance_registry.json). |
| [`index.html`](index.html) / [`app.js`](app.js) / [`styles.css`](styles.css) | Interactive web workbench: Walletless Card / MiniPay / Base checkout, live NFC tap & replay-attack verifier, secondary resale royalty split simulator, and in-browser CIDv1 studio registration. |
| [`scripts/verify-pipeline.mjs`](scripts/verify-pipeline.mjs) | Automated verification test suite covering ABI selectors, CIDv1 determinism, NFC replay rejection, and royalty distribution math. |

---

## Quick Start & Verification

Requires **Node.js 20+** (zero runtime npm dependencies required to run the SDK and test suite):

```bash
# 1. Regenerate deterministic IPFS/Filecoin CIDv1 provenance bundles
npm run bundle:ipfs

# 2. Run the 5-stage protocol & cryptographic verification suite
npm test
```

Expected output:

```text
=== Ona Protocol Verification Suite ===
✓ [1/5] Solidity ERC-721 + ERC-2981 + NFC Escrow contract ABI & selectors verified
✓ [2/5] Filecoin/IPFS CIDv1 multihash verified (bafkreiay62em5a6dsut7qvmcsgrb6cvjpwl7byza5g2wbowgnhchjluw7m)
✓ [3/5] NTAG 424 DNA cryptographic SUN tap & replay protection verified
✓ [4/5] ERC-2981 secondary resale split verified ($4,800 -> $480 artist / $4,080 seller / $240 fee)
✓ [5/5] Provenance registry verified (3 pieces, Registry CID: ...)
ALL ONA PROTOCOL CHECKS PASSED.
```

---

## Ecosystem Tracks & Karma GAP Milestones

* **Milestone 1 — UX Architecture & Open NFC Contract Spec:** Delivered in [`contracts/SPECIFICATION.md`](contracts/SPECIFICATION.md), [`contracts/OnaCertificate.sol`](contracts/OnaCertificate.sol), and [`DESIGN.md`](DESIGN.md).
* **Milestone 2 — Testnet Prototype, Card/MiniPay Checkout & NFC Pairing:** Delivered in the live interactive application ([`index.html`](index.html) / [`app.js`](app.js)), [`sdk/ona-protocol.mjs`](sdk/ona-protocol.mjs), and [`metadata/provenance_registry.json`](metadata/provenance_registry.json).
* **Milestone 3 — Mainnet Launch & 20-Artist West African Gallery Cohort:** Upcoming mainnet exhibition onboarding painters, sculptors, and printmakers across Lagos and Accra with physical NTAG 424 DNA tamper seals.

## License

MIT © 2026 Jethro Adebisi & BlockPrint Contributors.
