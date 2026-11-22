import {
  computeRawCidV1,
  createNfcSunTap,
  verifyNfcSunTap,
  deriveCustodialVaultAddress,
  calculateResaleSplit,
} from './ona-protocol.mjs';

/**
 * Ona Provenance Plugin for SolanaAgentKit v2 (`@solana-agent-kit` plugin contract),
 * Vercel AI SDK, Claude Agent SDK, and Model Context Protocol (MCP).
 *
 * Usage with SolanaAgentKit v2 (note: KeypairWallet requires BOTH keypair AND rpcUrl):
 *   const wallet = new KeypairWallet(keypair, rpcUrl);
 *   const agent = new SolanaAgentKit(wallet, rpcUrl, config).use(OnaProvenancePlugin);
 */
export const OnaProvenancePlugin = {
  name: 'ona-provenance',

  methods: {
    verifyArtworkNfcTap({ tagUid, tagSecretHex, counter, sunMac, lastVerifiedCounter = 0 }) {
      return verifyNfcSunTap({
        tagUid,
        tagSecretHex,
        counter,
        sunMac,
        lastVerifiedCounter,
      });
    },

    generateArtworkCidV1(artworkMetadata) {
      return computeRawCidV1(artworkMetadata);
    },

    quoteSecondaryResale({ salePrice, royaltyBps = 1000, protocolFeeBps = 500 }) {
      return calculateResaleSplit({ salePrice, royaltyBps, protocolFeeBps });
    },

    prepareCustodialCheckoutIntent({
      buyerEmail,
      artistAddress,
      pieceTitle,
      primaryPriceUsd,
      royaltyBps = 1000,
      tagUid,
      tagSecretHex,
      ecosystem = 'solana',
    }) {
      const custodialVault = deriveCustodialVaultAddress(buyerEmail, `ona-${ecosystem}-v1`);
      const genesisTap = createNfcSunTap({ tagUid, tagSecretHex, counter: 1 });
      const cidBundle = computeRawCidV1({
        pieceTitle,
        artistAddress,
        royaltyBps,
        tagUid: genesisTap.tagUid,
        tagHardwareHash: genesisTap.tagHardwareHash,
        ecosystem,
      });

      return {
        ecosystem,
        custodialVault,
        royaltyBps,
        primaryPriceUsd,
        tagHardwareHash: genesisTap.tagHardwareHash,
        ipfsProvenanceCid: cidBundle.cid,
        ipfsUri: `ipfs://${cidBundle.cid}`,
        gasSponsorship:
          ecosystem === 'solana'
            ? 'Kora Paymaster (@solana/kora) + Solana Keychain KMS'
            : 'ERC-4337 Smart Account / Custodial Relayer',
      };
    },
  },

  actions: [
    {
      name: 'ONA_VERIFY_ARTWORK_NFC_TAP',
      similes: [
        'verify physical art nfc tag',
        'check ntag 424 dna authenticity',
        'confirm physical art delivery',
      ],
      description:
        'Cryptographically verifies an NXP NTAG 424 DNA Secure Unique NFC (SUN) tap MAC and monotonic counter, rejecting replayed QR/URL copies.',
      examples: [
        [
          {
            input: {
              tagUid: '04A28F19C36B80',
              counter: 15,
              sunMac: 'A1B2C3D4E5F60718',
              lastVerifiedCounter: 14,
            },
            output: {
              valid: true,
              nextStoredCounter: 15,
              reason: 'Verified authentic NTAG 424 DNA tap #15',
            },
            explanation: 'Validates fresh physical NFC tap #15 above stored counter #14.',
          },
        ],
      ],
      handler: async (_agent, input) => OnaProvenancePlugin.methods.verifyArtworkNfcTap(input),
    },
    {
      name: 'ONA_QUOTE_RESALE_ROYALTIES',
      similes: ['calculate artist resale royalty', 'split secondary art sale'],
      description:
        'Calculates exact enforced secondary resale payout splits between the original artist (ERC-2981 / Metaplex Core / Anchor), selling collector, and Ona protocol.',
      examples: [
        [
          {
            input: { salePrice: 4800, royaltyBps: 1200, protocolFeeBps: 500 },
            output: { artistRoyalty: 576, sellerProceeds: 3984, protocolFee: 240 },
            explanation: 'Splits a $4,800 secondary sale with a 12% artist royalty and 5% fee.',
          },
        ],
      ],
      handler: async (_agent, input) => OnaProvenancePlugin.methods.quoteSecondaryResale(input),
    },
    {
      name: 'ONA_PREPARE_CUSTODIAL_CHECKOUT',
      similes: ['mint art certificate by card', 'prepare walletless art purchase'],
      description:
        'Derives a collector custodial vault from email, computes a deterministic Filecoin/IPFS CIDv1 provenance bundle, and prepares a Kora/EVM gasless escrow mint intent.',
      examples: [],
      handler: async (_agent, input) =>
        OnaProvenancePlugin.methods.prepareCustodialCheckoutIntent(input),
    },
  ],

  initialize() {},
};

export default OnaProvenancePlugin;
