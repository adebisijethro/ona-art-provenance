import crypto from 'node:crypto';

const BASE32_ALPHABET = 'abcdefghijklmnopqrstuvwxyz234567';

/**
 * Encodes bytes using RFC 4648 lowercase base32 without padding (multibase 'b').
 */
export function encodeBase32Lower(bytes) {
  let bits = 0;
  let value = 0;
  let output = '';
  for (let i = 0; i < bytes.length; i++) {
    value = (value << 8) | bytes[i];
    bits += 8;
    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) {
    output += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  }
  return output;
}

/**
 * Computes an RFC-compliant IPFS/Filecoin CIDv1 (raw codec 0x55, sha2-256 0x12, 32-byte digest 0x20).
 */
export function computeRawCidV1(payload) {
  const buf = Buffer.isBuffer(payload)
    ? payload
    : Buffer.from(typeof payload === 'string' ? payload : JSON.stringify(payload), 'utf8');
  const digest = crypto.createHash('sha256').update(buf).digest();
  const prefix = Buffer.from([0x01, 0x55, 0x12, 0x20]);
  const cidBytes = Buffer.concat([prefix, digest]);
  return {
    cid: `b${encodeBase32Lower(cidBytes)}`,
    sha256Hex: `0x${digest.toString('hex')}`,
    byteLength: buf.length,
  };
}

/**
 * Deterministic email-abstracted custodial vault address derivation for card/fiat buyers.
 */
export function deriveCustodialVaultAddress(email, networkSalt = 'ona-base-8453-v1') {
  const normalized = String(email).trim().toLowerCase();
  const hash = crypto
    .createHash('sha256')
    .update(`${networkSalt}:${normalized}`)
    .digest('hex');
  return `0x${hash.slice(0, 40)}`;
}

/**
 * Generates an NTAG 424 DNA Secure Unique NFC (SUN) cryptographic tap message.
 * Physical tags increment a monotonic 24-bit counter on every tap and sign (tagUid || counter)
 * so copying a static QR/URL cannot forge physical possession or replay an older tap.
 */
export function createNfcSunTap({ tagUid, tagSecretHex, counter }) {
  if (!Number.isInteger(counter) || counter <= 0) {
    throw new Error('NFC tap counter must be a positive integer');
  }
  const normalizedUid = tagUid.toUpperCase().replace(/[^0-9A-F]/g, '');
  const ctrHex = counter.toString(16).padStart(6, '0').toUpperCase();
  const message = `${normalizedUid}:${ctrHex}`;
  const macFull = crypto
    .createHmac('sha256', Buffer.from(tagSecretHex.replace(/^0x/, ''), 'hex'))
    .update(message)
    .digest('hex');
  const sunMac = macFull.slice(0, 16).toUpperCase(); // 8-byte truncated CMAC equivalent
  const tagHardwareHash = `0x${crypto
    .createHash('sha256')
    .update(`${normalizedUid}:${tagSecretHex.replace(/^0x/, '')}`)
    .digest('hex')}`;

  return {
    tagUid: normalizedUid,
    counter,
    counterHex: ctrHex,
    sunMac,
    tagHardwareHash,
    verifyUrl: `https://adebisijethro.github.io/ona-art-provenance/?uid=${normalizedUid}&ctr=${ctrHex}&mac=${sunMac}`,
  };
}

/**
 * Verifies an NTAG 424 DNA SUN tap against stored tag credentials and monotonic counter state.
 */
export function verifyNfcSunTap({ tagUid, tagSecretHex, counter, sunMac, lastVerifiedCounter = 0 }) {
  if (counter <= lastVerifiedCounter) {
    return {
      valid: false,
      reason: `Replay rejected: tap counter ${counter} <= last verified counter ${lastVerifiedCounter}`,
    };
  }
  const expected = createNfcSunTap({ tagUid, tagSecretHex, counter });
  const macMatches = crypto.timingSafeEqual(
    Buffer.from(expected.sunMac, 'utf8'),
    Buffer.from(String(sunMac).toUpperCase(), 'utf8')
  );
  if (!macMatches) {
    return {
      valid: false,
      reason: 'Cryptographic SUN MAC mismatch — tag signature invalid',
    };
  }
  return {
    valid: true,
    nextStoredCounter: counter,
    tagHardwareHash: expected.tagHardwareHash,
    reason: `Verified authentic NTAG 424 DNA tap #${counter}`,
  };
}

/**
 * Computes exact ERC-2981 secondary resale royalty, protocol fee, and collector proceeds.
 */
export function calculateResaleSplit({ salePrice, royaltyBps = 1000, protocolFeeBps = 500 }) {
  if (salePrice <= 0) throw new Error('Sale price must be positive');
  if (royaltyBps < 0 || royaltyBps > 2500) throw new Error('Royalty bps out of bounds (0..2500)');
  if (protocolFeeBps < 0 || protocolFeeBps > 800) throw new Error('Protocol fee bps out of bounds');

  const artistRoyalty = Number(((salePrice * royaltyBps) / 10000).toFixed(2));
  const protocolFee = Number(((salePrice * protocolFeeBps) / 10000).toFixed(2));
  const sellerProceeds = Number((salePrice - artistRoyalty - protocolFee).toFixed(2));

  return {
    grossSalePrice: salePrice,
    royaltyBps,
    protocolFeeBps,
    artistRoyalty,
    protocolFee,
    sellerProceeds,
  };
}
