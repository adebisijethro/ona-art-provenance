import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  computeRawCidV1,
  createNfcSunTap,
  deriveCustodialVaultAddress,
  calculateResaleSplit,
} from '../sdk/ona-protocol.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const metadataDir = path.join(rootDir, 'metadata');
fs.mkdirSync(metadataDir, { recursive: true });

const PILOT_PIECES = [
  {
    pieceId: 'ona_piece_001',
    tokenId: 1,
    name: 'Harmattan Over Third Mainland',
    artist: {
      name: 'Adaeze Nwosu',
      studio: 'Yaba, Lagos, Nigeria',
      wallet: '0x4B91C87f2E0A19d3448b7E21c0A9175E83D04a11',
    },
    medium: 'Natural indigo pigment, burnt sienna & cold-wax impasto on Belgian linen',
    dimensionsCm: '120 × 90 cm',
    year: 2026,
    edition: { index: 1, total: 1 },
    royaltyBps: 1000,
    primaryPriceUsd: 950,
    primaryPriceNgn: 1520000,
    image: 'assets/artworks/harmattan-linen.jpg',
    nfcTag: {
      chipModel: 'NXP NTAG 424 DNA TamperTag',
      tagUid: '04A28F19C36B80',
      secretSeed: '0x91d3f4a80217bc63e45f9100a28c7711d04f88e2c91a3b7451f088cc34e190a1',
      initialTapCounter: 14,
    },
    initialCollectorEmail: 'collector.london@gallery.example',
    resaleExampleUsd: 3400,
  },
  {
    pieceId: 'ona_piece_002',
    tokenId: 2,
    name: ' Nok Terracotta Meridian II',
    artist: {
      name: 'Tunde Ogunlesi',
      studio: 'Abeokuta & Victoria Island, Nigeria',
      wallet: '0x7C22E04198F51b9302E091A6d4C889F1203B7E29',
    },
    medium: 'Kiln-fired red Ogun clay, cast brass inlay & carved iroko mount',
    dimensionsCm: '78 × 62 × 9 cm',
    year: 2026,
    edition: { index: 1, total: 3 },
    royaltyBps: 1200,
    primaryPriceUsd: 1450,
    primaryPriceNgn: 2320000,
    image: 'assets/artworks/terracotta-meridian.jpg',
    nfcTag: {
      chipModel: 'NXP NTAG 424 DNA TamperTag',
      tagUid: '04E75102BA9480',
      secretSeed: '0x44f82e1099c4a7b8231105f6e892a14c703199bc65120fa39981ed4021bc5572',
      initialTapCounter: 9,
    },
    initialCollectorEmail: 'curator.zurich@kunst.example',
    resaleExampleUsd: 4800,
  },
  {
    pieceId: 'ona_piece_003',
    tokenId: 3,
    name: 'Marina Dusk Monoprint (Study IV)',
    artist: {
      name: 'Kofi Boateng',
      studio: 'Osu, Accra, Ghana',
      wallet: '0x9E04D2183A76c50B11F80429D3a6E7128C405F63',
    },
    medium: 'Archival copperplate etching & hand-pulled carbon ink on 310gsm cotton rag',
    dimensionsCm: '85 × 65 cm',
    year: 2026,
    edition: { index: 2, total: 5 },
    royaltyBps: 1000,
    primaryPriceUsd: 620,
    primaryPriceNgn: 992000,
    image: 'assets/artworks/marina-monoprint.jpg',
    nfcTag: {
      chipModel: 'NXP NTAG 424 DNA TamperTag',
      tagUid: '0419C4887D2E80',
      secretSeed: '0x7a12b88904c3e6712209fa8b451c90e3771829ab550c12df8934012aa6c8310f',
      initialTapCounter: 21,
    },
    initialCollectorEmail: 'minipay.buyer@lagos.example',
    resaleExampleUsd: 1950,
  },
];

const registryItems = [];

for (const p of PILOT_PIECES) {
  const nameTrimmed = p.name.trim();
  const tap = createNfcSunTap({
    tagUid: p.nfcTag.tagUid,
    tagSecretHex: p.nfcTag.secretSeed,
    counter: p.nfcTag.initialTapCounter,
  });
  const custodialVault = deriveCustodialVaultAddress(p.initialCollectorEmail);
  const resaleProjection = calculateResaleSplit({
    salePrice: p.resaleExampleUsd,
    royaltyBps: p.royaltyBps,
    protocolFeeBps: 500,
  });

  const metadataDoc = {
    schema: 'https://ona.blockprint.team/schemas/provenance-certificate-v1.json',
    name: `${nameTrimmed} — Ona Certificate #${p.tokenId}`,
    description: `Tamper-evident physical-to-digital certificate of authenticity for "${nameTrimmed}" (${p.year}) by ${p.artist.name}. Enforces ${(p.royaltyBps / 100).toFixed(1)}% ERC-2981 secondary resale royalties across Base L2 and Celo MiniPay.`,
    image: p.image,
    external_url: tap.verifyUrl,
    attributes: [
      { trait_type: 'Artist', value: p.artist.name },
      { trait_type: 'Origin Studio', value: p.artist.studio },
      { trait_type: 'Medium', value: p.medium },
      { trait_type: 'Dimensions', value: p.dimensionsCm },
      { trait_type: 'Edition', value: `${p.edition.index} of ${p.edition.total}` },
      { trait_type: 'ERC-2981 Creator Royalty', value: `${(p.royaltyBps / 100).toFixed(1)}%` },
      { trait_type: 'NFC Hardware Chip', value: p.nfcTag.chipModel },
      { trait_type: 'NFC Tag UID', value: tap.tagUid },
    ],
    provenance: {
      tokenId: p.tokenId,
      chainsSupported: ['eip155:8453 (Base)', 'eip155:42220 (Celo MiniPay)'],
      artistRoyaltyReceiver: p.artist.wallet,
      royaltyBps: p.royaltyBps,
      custodialBuyerVault: custodialVault,
      tagHardwareHash: tap.tagHardwareHash,
      lastVerifiedTapCounter: tap.counter,
      primarySalePricing: {
        usdStripe: p.primaryPriceUsd,
        ngnPaystack: p.primaryPriceNgn,
        usdcBase: p.primaryPriceUsd,
        cusdMiniPay: p.primaryPriceUsd,
      },
      secondaryResaleSimulation: resaleProjection,
      checkpoints: [
        {
          event: 'ARTIST_STUDIO_REGISTRATION',
          actor: p.artist.wallet,
          timestamp: '2026-11-18T10:00:00Z',
        },
        {
          event: 'CARD_CUSTODIAL_MINT_AND_ESCROW',
          actor: custodialVault,
          amountUsd: p.primaryPriceUsd,
          timestamp: '2026-11-20T14:30:00Z',
        },
        {
          event: 'NFC_DELIVERY_TAP_VERIFIED',
          actor: custodialVault,
          nfcCounter: tap.counter,
          sunMac: tap.sunMac,
          timestamp: '2026-11-22T11:15:00Z',
        },
      ],
    },
  };

  const serialized = JSON.stringify(metadataDoc, null, 2);
  const cidResult = computeRawCidV1(serialized);
  const finalDoc = {
    ...metadataDoc,
    archival: {
      network: 'Filecoin / IPFS Content-Addressed Bundle',
      cidV1: cidResult.cid,
      ipfsUri: `ipfs://${cidResult.cid}`,
      sha256Digest: cidResult.sha256Hex,
      byteLength: cidResult.byteLength,
    },
  };

  const piecePath = path.join(metadataDir, `${p.pieceId}.json`);
  fs.writeFileSync(piecePath, JSON.stringify(finalDoc, null, 2) + '\n');

  registryItems.push({
    pieceId: p.pieceId,
    tokenId: p.tokenId,
    title: nameTrimmed,
    artist: p.artist.name,
    studio: p.artist.studio,
    edition: `${p.edition.index}/${p.edition.total}`,
    royaltyBps: p.royaltyBps,
    primaryPriceUsd: p.primaryPriceUsd,
    nfcTagUid: tap.tagUid,
    tagHardwareHash: tap.tagHardwareHash,
    cidV1: cidResult.cid,
    ipfsUri: `ipfs://${cidResult.cid}`,
    metadataFile: `metadata/${p.pieceId}.json`,
  });
}

const registryDoc = {
  protocol: 'Ona: Physical Art Provenance & NFC Certificate Engine',
  version: '0.2.0',
  generatedAt: '2026-11-22T16:00:00Z',
  standards: ['ERC-721', 'ERC-2981', 'NTAG-424-DNA-SUN', 'IPFS-CIDv1-SHA256'],
  ecosystems: ['Base (8453)', 'Celo / MiniPay (42220)', 'Filecoin / IPFS'],
  pieces: registryItems,
};

const registrySerialized = JSON.stringify(registryDoc, null, 2);
const registryCid = computeRawCidV1(registrySerialized);
registryDoc.registryCidV1 = registryCid.cid;

fs.writeFileSync(
  path.join(metadataDir, 'provenance_registry.json'),
  JSON.stringify(registryDoc, null, 2) + '\n'
);

console.log(
  `Generated ${registryItems.length} verifiable IPFS/Filecoin provenance bundles -> metadata/provenance_registry.json (Registry CIDv1: ${registryCid.cid})`
);
