import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  computeRawCidV1,
  createNfcSunTap,
  verifyNfcSunTap,
  deriveCustodialVaultAddress,
  calculateResaleSplit,
} from '../sdk/ona-protocol.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');

console.log('=== Ona Protocol Verification Suite ===');

// 1. Verify compiled Solidity contract ABI & selectors
const abiPath = path.join(rootDir, 'contracts', 'abi', 'OnaCertificate.json');
assert.ok(fs.existsSync(abiPath), 'Compiled ABI artifact must exist at contracts/abi/OnaCertificate.json');
const artifact = JSON.parse(fs.readFileSync(abiPath, 'utf8'));
assert.ok(
  /^0x60[0-9a-f]{2}604052/i.test(artifact.bytecode) && artifact.deployedBytecodeSize > 5000,
  'Contract bytecode must be valid EVM hex'
);
assert.equal(
  artifact.methodIdentifiers['royaltyInfo(uint256,uint256)'],
  '2a55205a',
  'ERC-2981 royaltyInfo selector must match 0x2a55205a'
);
assert.equal(
  artifact.methodIdentifiers['ownerOf(uint256)'],
  '6352211e',
  'ERC-721 ownerOf selector must match 0x6352211e'
);
assert.ok(
  artifact.methodIdentifiers['confirmPhysicalDelivery(uint256,uint32,bytes)'],
  'EIP-191 ECDSA NFC physical delivery escrow confirmation method must exist'
);
assert.ok(
  artifact.methodIdentifiers['settleSecondaryResale(uint256,address,bool,uint32,bytes)'],
  'Enforced secondary resale settlement method must exist'
);
assert.ok(
  artifact.methodIdentifiers['cancelResaleListing(uint256)'],
  'Resale listing cancellation method must exist'
);
console.log('✓ [1/5] Solidity ERC-721 + ERC-2981 + NFC Escrow contract ABI & selectors verified');

// 2. Verify deterministic CIDv1 multihash computation
const cidA = computeRawCidV1('{"piece":"harmattan"}');
const cidB = computeRawCidV1('{"piece":"harmattan"}');
assert.equal(cidA.cid, cidB.cid, 'CIDv1 must be deterministic');
assert.ok(cidA.cid.startsWith('bafkrei'), `CIDv1 (${cidA.cid}) must have raw sha2-256 bafkrei prefix`);
console.log(`✓ [2/5] Filecoin/IPFS CIDv1 multihash verified (${cidA.cid})`);

// 3. Verify NTAG 424 DNA SUN rolling counter & replay attack rejection
const secret = '0x91d3f4a80217bc63e45f9100a28c7711d04f88e2c91a3b7451f088cc34e190a1';
const tap15 = createNfcSunTap({ tagUid: '04A28F19C36B80', tagSecretHex: secret, counter: 15 });
const checkFresh = verifyNfcSunTap({
  tagUid: tap15.tagUid,
  tagSecretHex: secret,
  counter: 15,
  sunMac: tap15.sunMac,
  lastVerifiedCounter: 14,
});
assert.equal(checkFresh.valid, true, 'Fresh NFC tap #15 should verify cleanly');

const checkReplay = verifyNfcSunTap({
  tagUid: tap15.tagUid,
  tagSecretHex: secret,
  counter: 15,
  sunMac: tap15.sunMac,
  lastVerifiedCounter: 15,
});
assert.equal(checkReplay.valid, false, 'Replayed NFC tap #15 must be rejected');

const checkTampered = verifyNfcSunTap({
  tagUid: tap15.tagUid,
  tagSecretHex: secret,
  counter: 16,
  sunMac: 'DEADBEEF00112233',
  lastVerifiedCounter: 15,
});
assert.equal(checkTampered.valid, false, 'Forged NFC MAC must be rejected');
console.log('✓ [3/5] NTAG 424 DNA cryptographic SUN tap & replay protection verified');

// 4. Verify ERC-2981 secondary resale royalty split math
const split = calculateResaleSplit({ salePrice: 4800, royaltyBps: 1000, protocolFeeBps: 500 });
assert.equal(split.artistRoyalty, 480);
assert.equal(split.protocolFee, 240);
assert.equal(split.sellerProceeds, 4080);
assert.equal(split.artistRoyalty + split.protocolFee + split.sellerProceeds, 4800);
console.log('✓ [4/5] ERC-2981 secondary resale split verified ($4,800 -> $480 artist / $4,080 seller / $240 fee)');

// 5. Verify generated provenance metadata bundles & custodial vault derivation
const vault = deriveCustodialVaultAddress('Collector.London@gallery.example');
assert.equal(vault.length, 42, 'Derived custodial vault must be 20-byte hex address');
const regPath = path.join(rootDir, 'metadata', 'provenance_registry.json');
assert.ok(fs.existsSync(regPath), 'metadata/provenance_registry.json must exist');
const reg = JSON.parse(fs.readFileSync(regPath, 'utf8'));
assert.equal(reg.pieces.length, 3, 'Registry must contain 3 verified pilot artwork bundles');
console.log(`✓ [5/5] Provenance registry verified (${reg.pieces.length} pieces, Registry CID: ${reg.registryCidV1})`);

console.log('ALL ONA PROTOCOL CHECKS PASSED.');
