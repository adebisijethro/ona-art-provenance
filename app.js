const BASE32_ALPHABET = 'abcdefghijklmnopqrstuvwxyz234567';

function encodeBase32Lower(bytes) {
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

function bytesToHex(bytes) {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

function hexToBytes(hex) {
  const clean = hex.replace(/^0x/i, '');
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

async function sha256Bytes(text) {
  const data = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return new Uint8Array(digest);
}

async function computeCidV1Browser(text) {
  const digest = await sha256Bytes(text);
  const full = new Uint8Array(4 + digest.length);
  full.set([0x01, 0x55, 0x12, 0x20], 0);
  full.set(digest, 4);
  return `b${encodeBase32Lower(full)}`;
}

async function deriveVaultBrowser(email) {
  const clean = String(email || '').trim().toLowerCase();
  const digest = await sha256Bytes(`ona-base-8453-v1:${clean}`);
  return `0x${bytesToHex(digest).slice(0, 40)}`;
}

async function computeSunMacBrowser(tagUid, secretHex, counter) {
  const ctrHex = counter.toString(16).padStart(6, '0').toUpperCase();
  const keyBytes = hexToBytes(secretHex);
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    keyBytes,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const msg = new TextEncoder().encode(`${tagUid}:${ctrHex}`);
  const sig = await crypto.subtle.sign('HMAC', cryptoKey, msg);
  return bytesToHex(new Uint8Array(sig)).slice(0, 16).toUpperCase();
}

const INITIAL_CATALOGUE = [
  {
    id: 'ona_piece_001',
    tokenId: 1,
    title: 'Harmattan Over Third Mainland',
    artist: 'Adaeze Nwosu',
    studio: 'Yaba, Lagos, Nigeria',
    year: 2026,
    medium: 'Natural indigo pigment, burnt sienna & cold-wax impasto on Belgian linen',
    dimensions: '120 × 90 cm',
    edition: '1 of 1',
    royaltyBps: 1000,
    priceUsd: 950,
    priceNgn: 1520000,
    resaleDefaultUsd: 3400,
    image: 'assets/artworks/harmattan-linen.jpg',
    jsonFile: 'metadata/ona_piece_001.json',
    tagUid: '04A28F19C36B80',
    secretHex: '0x91d3f4a80217bc63e45f9100a28c7711d04f88e2c91a3b7451f088cc34e190a1',
    tagHardwareHash: '0x71bc83c02b92cf4881a143e88a234f2c115b79f022b64e8c9d112203f540a812',
    lastCounter: 14,
    escrowReleased: true,
    custodialHeld: true,
    holderLabel: '0x8e41…d29c (Custodial Email Vault)',
    cidV1: 'bafkreibu6x2v7z4w3l9n8p5q2m6k7j4h2g9f5d3s2a8q7w6e5r4t3y2u1i',
    checkpoints: [
      {
        kind: 'NFC_DELIVERY_CONFIRMED',
        when: '2026-11-22 11:15 UTC',
        summary: 'Collector tapped NTAG 424 DNA seal (#14) — physical delivery confirmed & $950 primary escrow released to Adaeze Nwosu.',
      },
      {
        kind: 'MINT',
        when: '2026-11-20 14:30 UTC',
        summary: 'Paid via Paystack Card ($950) — ERC-721 + ERC-2981 (10.0%) minted to email-abstracted custodial vault.',
      },
    ],
  },
  {
    id: 'ona_piece_002',
    tokenId: 2,
    title: 'Nok Terracotta Meridian II',
    artist: 'Tunde Ogunlesi',
    studio: 'Abeokuta & Victoria Island, Nigeria',
    year: 2026,
    medium: 'Kiln-fired red Ogun clay, cast brass inlay & carved iroko mount',
    dimensions: '78 × 62 × 9 cm',
    edition: '1 of 3',
    royaltyBps: 1200,
    priceUsd: 1450,
    priceNgn: 2320000,
    resaleDefaultUsd: 4800,
    image: 'assets/artworks/terracotta-meridian.jpg',
    jsonFile: 'metadata/ona_piece_002.json',
    tagUid: '04E75102BA9480',
    secretHex: '0x44f82e1099c4a7b8231105f6e892a14c703199bc65120fa39981ed4021bc5572',
    tagHardwareHash: '0x29c8104fa2e941c7712b8e04d302a8915c674f2189b03c1145e2908fa32c19b4',
    lastCounter: 9,
    escrowReleased: true,
    custodialHeld: true,
    holderLabel: '0x4c19…a782 (Custodial Email Vault)',
    cidV1: 'bafkreic5d2m8n4v7b9x3z6l8k2j5h7g4f6d9s3a2p8o7i6u5y4t3r2e1w9',
    checkpoints: [
      {
        kind: 'NFC_DELIVERY_CONFIRMED',
        when: '2026-11-21 16:40 UTC',
        summary: 'Collector tapped NTAG 424 DNA seal (#9) — $1,450 primary escrow released to Tunde Ogunlesi.',
      },
      {
        kind: 'MINT',
        when: '2026-11-19 09:20 UTC',
        summary: 'Paid via Stripe Card ($1,450) — ERC-721 + ERC-2981 (12.0%) minted to collector custodial vault.',
      },
    ],
  },
  {
    id: 'ona_piece_003',
    tokenId: 3,
    title: 'Marina Dusk Monoprint (Study IV)',
    artist: 'Kofi Boateng',
    studio: 'Osu, Accra, Ghana',
    year: 2026,
    medium: 'Archival copperplate etching & hand-pulled carbon ink on 310gsm cotton rag',
    dimensions: '85 × 65 cm',
    edition: '2 of 5',
    royaltyBps: 1000,
    priceUsd: 620,
    priceNgn: 992000,
    resaleDefaultUsd: 1950,
    image: 'assets/artworks/marina-monoprint.jpg',
    jsonFile: 'metadata/ona_piece_003.json',
    tagUid: '0419C4887D2E80',
    secretHex: '0x7a12b88904c3e6712209fa8b451c90e3771829ab550c12df8934012aa6c8310f',
    tagHardwareHash: '0x94d201c78e1102a5b69923f4e18c037281b4a902d71638c5f01189e4b2c7305e',
    lastCounter: 21,
    escrowReleased: true,
    custodialHeld: false,
    holderLabel: '0x6a92…31f8 (Celo MiniPay Wallet)',
    cidV1: 'bafkreid8n4m2b7v5c3x9z2l6k8j4h3g7f2d5s8a4p6o9i3u7y2t5r8e3w6',
    checkpoints: [
      {
        kind: 'NFC_DELIVERY_CONFIRMED',
        when: '2026-11-22 08:50 UTC',
        summary: 'MiniPay collector tapped NTAG 424 DNA seal (#21) — 620 cUSD escrow settled to Kofi Boateng.',
      },
      {
        kind: 'MINT',
        when: '2026-11-20 18:05 UTC',
        summary: 'Paid via Celo MiniPay (620 cUSD) — ERC-721 + ERC-2981 (10.0%) minted on-chain.',
      },
    ],
  },
];

let catalogue = structuredClone(INITIAL_CATALOGUE);
let activePieceId = catalogue[0].id;
let activeRail = 'card';

function formatMoney(n) {
  return `$${Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function shortHex(h) {
  if (!h || h.length < 16) return h;
  return `${h.slice(0, 10)}…${h.slice(-6)}`;
}

function getActivePiece() {
  return catalogue.find((p) => p.id === activePieceId) || catalogue[0];
}

async function hydrateRegistryCids() {
  try {
    const res = await fetch('metadata/provenance_registry.json');
    if (!res.ok) return;
    const reg = await res.json();
    for (const item of reg.pieces || []) {
      const target = catalogue.find((c) => c.id === item.pieceId);
      if (target) {
        target.cidV1 = item.cidV1;
        target.tagHardwareHash = item.tagHardwareHash;
      }
    }
  } catch {
    // static local fallback already populated
  }
}

function renderCatalogueRail() {
  const rail = document.getElementById('catalogue-rail');
  rail.innerHTML = '';

  for (const piece of catalogue) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'artwork-selector';
    btn.setAttribute('aria-pressed', String(piece.id === activePieceId));
    btn.innerHTML = `
      <div class="selector-thumb">
        <img src="${piece.image}" alt="${piece.title} by ${piece.artist}" loading="lazy" />
      </div>
      <p class="selector-title">${piece.title}</p>
      <p class="selector-sub">${piece.artist} · ${piece.studio}</p>
      <div class="selector-foot">
        <span class="mono">${formatMoney(piece.priceUsd)}</span>
        <span class="mono">${(piece.royaltyBps / 100).toFixed(1)}% Royalty</span>
      </div>
    `;
    btn.addEventListener('click', () => {
      activePieceId = piece.id;
      hideBanners();
      renderAll();
    });
    rail.appendChild(btn);
  }
}

function hideBanners() {
  for (const id of ['checkout-feedback', 'nfc-feedback', 'resale-feedback', 'export-feedback']) {
    const el = document.getElementById(id);
    if (el) el.hidden = true;
  }
}

function showBanner(id, message, kind = 'ok') {
  const el = document.getElementById(id);
  if (!el) return;
  el.className = `feedback-banner ${kind}`;
  el.textContent = message;
  el.hidden = false;
}

async function renderActivePieceDetails() {
  const p = getActivePiece();

  // Hero sync
  document.getElementById('hero-artwork-img').src = p.image;
  document.getElementById('hero-artwork-img').alt = `${p.title} by ${p.artist}`;
  document.getElementById('hero-artwork-title').textContent = p.title;
  document.getElementById('hero-artwork-sub').textContent = `${p.artist} · ${p.studio} · ${(p.royaltyBps / 100).toFixed(1)}% Resale Royalty`;
  const heroBadge = document.getElementById('hero-artwork-badge');
  heroBadge.className = `status-pill ${p.escrowReleased ? 'verified' : 'escrow'}`;
  heroBadge.textContent = p.escrowReleased ? `NFC Verified (#${p.lastCounter})` : 'Escrow Awaiting NFC Tap';

  // Detail card
  document.getElementById('detail-title').textContent = p.title;
  document.getElementById('detail-artist-line').textContent = `${p.artist} — ${p.studio} (${p.year})`;
  document.getElementById('detail-medium').textContent = p.medium;
  document.getElementById('detail-dimensions').textContent = `${p.dimensions} · Edition ${p.edition}`;
  document.getElementById('detail-royalty').textContent = `${(p.royaltyBps / 100).toFixed(1)}% (${p.royaltyBps} bps)`;
  document.getElementById('detail-uid').textContent = p.tagUid;
  document.getElementById('detail-holder').textContent = p.holderLabel;
  document.getElementById('detail-cid').textContent = p.cidV1;

  const jsonLink = document.getElementById('detail-json-link');
  if (p.jsonFile) {
    jsonLink.href = p.jsonFile;
    jsonLink.hidden = false;
  } else {
    jsonLink.hidden = true;
  }

  // Checkout rail summary
  renderCheckoutPricing(p);

  // NFC telemetry
  document.getElementById('nfc-piece-name').textContent = p.title;
  document.getElementById('tel-uid').textContent = p.tagUid;
  document.getElementById('tel-hash').textContent = shortHex(p.tagHardwareHash);
  const ctrHex = p.lastCounter.toString(16).padStart(6, '0').toUpperCase();
  document.getElementById('tel-counter').textContent = `#${p.lastCounter} (0x${ctrHex})`;
  const mac = await computeSunMacBrowser(p.tagUid, p.secretHex, Math.max(1, p.lastCounter));
  document.getElementById('tel-mac').textContent = mac;
  document.getElementById('tel-escrow').textContent = p.escrowReleased
    ? 'Verified & Escrow Released to Artist'
    : 'Primary Sale Locked in Contract Escrow';

  // Provenance timeline
  const timeline = document.getElementById('provenance-timeline');
  timeline.innerHTML = '';
  for (const cp of p.checkpoints) {
    const li = document.createElement('li');
    li.className = 'provenance-item';
    li.innerHTML = `
      <div class="provenance-item-top">
        <span class="mono">${cp.kind}</span>
        <span class="mono" style="color: var(--ink-muted)">${cp.when}</span>
      </div>
      <p class="provenance-item-detail">${cp.summary}</p>
    `;
    timeline.appendChild(li);
  }

  // Resale simulator defaults
  document.getElementById('resale-piece-title').textContent = p.title;
  document.getElementById('resale-primary-ref').textContent = formatMoney(p.priceUsd);
  const resaleInput = document.getElementById('resale-price-input');
  if (resaleInput.dataset.boundPiece !== p.id) {
    resaleInput.value = String(p.resaleDefaultUsd);
    resaleInput.dataset.boundPiece = p.id;
  }
  renderResaleBreakdown();
}

function renderCheckoutPricing(piece) {
  const labelEl = document.getElementById('checkout-rail-label');
  const amtEl = document.getElementById('checkout-amount-display');
  if (activeRail === 'card') {
    labelEl.textContent = 'Card / Bank (Paystack NGN · Stripe USD)';
    amtEl.textContent = `${formatMoney(piece.priceUsd)} / ₦${piece.priceNgn.toLocaleString('en-US')}`;
  } else if (activeRail === 'minipay') {
    labelEl.textContent = 'Celo MiniPay Mobile Instant Settlement';
    amtEl.textContent = `${piece.priceUsd.toLocaleString('en-US')}.00 cUSD`;
  } else {
    labelEl.textContent = 'Base L2 Smart Wallet / USDC Escrow';
    amtEl.textContent = `${piece.priceUsd.toLocaleString('en-US')}.00 USDC`;
  }
}

function renderResaleBreakdown() {
  const p = getActivePiece();
  const rawPrice = Math.max(50, Number(document.getElementById('resale-price-input').value || 0));
  const royaltyPct = p.royaltyBps / 100;
  const feePct = 5.0;
  const sellerPct = Math.max(0, 100 - royaltyPct - feePct);

  const artistAmt = (rawPrice * p.royaltyBps) / 10000;
  const feeAmt = (rawPrice * 500) / 10000;
  const sellerAmt = rawPrice - artistAmt - feeAmt;

  document.getElementById('bar-artist').style.width = `${royaltyPct}%`;
  document.getElementById('bar-seller').style.width = `${sellerPct}%`;
  document.getElementById('bar-fee').style.width = `${feePct}%`;

  document.getElementById('label-artist-bps').textContent = `${p.artist} (${royaltyPct.toFixed(1)}%)`;
  document.getElementById('val-artist-royalty').textContent = formatMoney(artistAmt);
  document.getElementById('val-seller-net').textContent = formatMoney(sellerAmt);
  document.getElementById('val-protocol-fee').textContent = formatMoney(feeAmt);
}

async function updateVaultPreview() {
  const email = document.getElementById('buyer-email').value;
  const vault = await deriveVaultBrowser(email);
  document.getElementById('derived-vault-preview').textContent = vault;
}

async function renderAll() {
  renderCatalogueRail();
  await renderActivePieceDetails();
  await updateVaultPreview();
}

function wireInteractions() {
  // Payment rail switcher
  document.querySelectorAll('.rail-tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      activeRail = tab.dataset.rail;
      document.querySelectorAll('.rail-tab').forEach((t) => {
        t.setAttribute('aria-selected', String(t === tab));
      });
      renderCheckoutPricing(getActivePiece());
    });
  });

  // Live email custodial vault preview
  document.getElementById('buyer-email').addEventListener('input', updateVaultPreview);

  // Primary checkout & escrow mint
  document.getElementById('checkout-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = document.getElementById('buyer-email').value.trim();
    if (!email || !email.includes('@')) {
      showBanner('checkout-feedback', 'Enter a valid collector email address to provision a custodial certificate vault.', 'err');
      return;
    }
    const p = getActivePiece();
    const vault = await deriveVaultBrowser(email);
    const railName =
      activeRail === 'card'
        ? 'Paystack/Stripe Card'
        : activeRail === 'minipay'
          ? 'Celo MiniPay (cUSD)'
          : 'Base L2 (USDC)';

    p.escrowReleased = false;
    p.custodialHeld = true;
    p.holderLabel = `${vault.slice(0, 6)}…${vault.slice(-4)} (${email})`;
    const now = new Date().toISOString().slice(0, 16).replace('T', ' ') + ' UTC';
    p.checkpoints.unshift({
      kind: 'MINT_AND_ESCROW_LOCKED',
      when: now,
      summary: `Paid ${formatMoney(p.priceUsd)} via ${railName} — Certificate minted to ${vault.slice(0, 10)}…; primary funds held in escrow awaiting physical NFC tap.`,
    });

    await renderAll();
    showBanner(
      'checkout-feedback',
      `Minted Certificate #${p.tokenId} to custodial vault ${vault.slice(0, 10)}… via ${railName}. Tap the physical NFC seal below to confirm delivery and release ${formatMoney(p.priceUsd)} to ${p.artist}.`,
      'ok'
    );
  });

  // Export custodial vault to external wallet
  document.getElementById('export-wallet-btn').addEventListener('click', async () => {
    const p = getActivePiece();
    const external = '0x8fbaad22547309635064a160c4c12e0670e6235b';
    p.custodialHeld = false;
    p.holderLabel = `${external.slice(0, 6)}…${external.slice(-4)} (Self-Custody Exported)`;
    const now = new Date().toISOString().slice(0, 16).replace('T', ' ') + ' UTC';
    p.checkpoints.unshift({
      kind: 'SELF_CUSTODY_EXPORT',
      when: now,
      summary: `Certificate #${p.tokenId} exported from email custodial vault to self-custody wallet ${external.slice(0, 12)}… with full provenance preserved.`,
    });
    await renderAll();
    showBanner(
      'export-feedback',
      `Exported Certificate #${p.tokenId} to external self-custody wallet ${external.slice(0, 10)}…${external.slice(-6)} via exportToSelfCustody().`,
      'ok'
    );
  });

  // Simulate genuine NTAG 424 DNA physical tap (+1 monotonic counter)
  document.getElementById('simulate-tap-btn').addEventListener('click', async () => {
    const p = getActivePiece();
    p.lastCounter += 1;
    const mac = await computeSunMacBrowser(p.tagUid, p.secretHex, p.lastCounter);
    const wasEscrowed = !p.escrowReleased;
    p.escrowReleased = true;

    const now = new Date().toISOString().slice(0, 16).replace('T', ' ') + ' UTC';
    p.checkpoints.unshift({
      kind: wasEscrowed ? 'NFC_DELIVERY_CONFIRMED' : 'NFC_AUTHENTICITY_TAP',
      when: now,
      summary: wasEscrowed
        ? `Physical NTAG 424 DNA tap #${p.lastCounter} verified (SUN MAC ${mac}) — delivery confirmed & ${formatMoney(p.priceUsd)} escrow released to ${p.artist}.`
        : `Physical NTAG 424 DNA tap #${p.lastCounter} verified (SUN MAC ${mac}) — authentic original confirmed.`,
    });

    await renderAll();
    showBanner(
      'nfc-feedback',
      wasEscrowed
        ? `Authentic NTAG 424 DNA tap #${p.lastCounter} (MAC ${mac}) verified! Primary escrow (${formatMoney(p.priceUsd)}) released to ${p.artist}.`
        : `Authentic NTAG 424 DNA tap #${p.lastCounter} (MAC ${mac}) verified against on-chain hardware hash.`,
      'ok'
    );
  });

  // Simulate copied URL replay attack (same counter <= lastTapCounter)
  document.getElementById('simulate-replay-btn').addEventListener('click', async () => {
    const p = getActivePiece();
    const staleCounter = p.lastCounter;
    const staleMac = await computeSunMacBrowser(p.tagUid, p.secretHex, staleCounter);
    showBanner(
      'nfc-feedback',
      `REPLAY BLOCKED — OnaCertificate.confirmPhysicalDelivery() reverted with InvalidNFCCounter(): submitted counter #${staleCounter} (MAC ${staleMac}) <= stored on-chain counter #${p.lastCounter}. Static QR/URL copies cannot impersonate the physical artwork.`,
      'err'
    );
  });

  // Secondary resale live input & execution
  document.getElementById('resale-price-input').addEventListener('input', renderResaleBreakdown);

  document.getElementById('execute-resale-btn').addEventListener('click', async () => {
    const p = getActivePiece();
    const gross = Math.max(50, Number(document.getElementById('resale-price-input').value || 0));
    const buyerRaw = document.getElementById('resale-buyer-input').value.trim() || 'collector.secondary@gallery.example';
    const buyerAddr = buyerRaw.startsWith('0x') && buyerRaw.length === 42
      ? buyerRaw
      : await deriveVaultBrowser(buyerRaw);

    const artistRoyalty = (gross * p.royaltyBps) / 10000;
    const fee = (gross * 500) / 10000;
    const sellerNet = gross - artistRoyalty - fee;

    p.lastCounter += 1;
    p.holderLabel = `${buyerAddr.slice(0, 6)}…${buyerAddr.slice(-4)} (${buyerRaw.slice(0, 22)})`;
    const now = new Date().toISOString().slice(0, 16).replace('T', ' ') + ' UTC';
    p.checkpoints.unshift({
      kind: 'SECONDARY_RESALE_SETTLED',
      when: now,
      summary: `Resold for ${formatMoney(gross)} — ${formatMoney(artistRoyalty)} (${(p.royaltyBps / 100).toFixed(1)}% ERC-2981) paid automatically to ${p.artist}; ${formatMoney(sellerNet)} to seller.`,
    });

    await renderAll();
    showBanner(
      'resale-feedback',
      `settleSecondaryResale() executed: ${formatMoney(artistRoyalty)} routed directly to ${p.artist}, ${formatMoney(sellerNet)} to seller, Certificate #${p.tokenId} transferred to ${buyerAddr.slice(0, 10)}….`,
      'ok'
    );
  });

  // Artist studio registration + browser CIDv1 calculation
  document.getElementById('studio-mint-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const title = document.getElementById('studio-title').value.trim();
    const artistFull = document.getElementById('studio-artist').value.trim();
    const medium = document.getElementById('studio-medium').value.trim();
    const dimensions = document.getElementById('studio-dimensions').value.trim();
    const priceUsd = Math.max(50, Number(document.getElementById('studio-price').value || 500));
    const royaltyPct = Math.min(25, Math.max(2, Number(document.getElementById('studio-royalty').value || 10)));
    const royaltyBps = Math.round(royaltyPct * 100);

    const [artistName, studioLoc] = artistFull.includes('·')
      ? artistFull.split('·').map((s) => s.trim())
      : [artistFull, 'Lagos, Nigeria'];

    const nextTokenId = catalogue.length + 1;
    const randBytes = crypto.getRandomValues(new Uint8Array(7));
    const tagUid = bytesToHex(randBytes).toUpperCase();
    const secretHex = `0x${bytesToHex(crypto.getRandomValues(new Uint8Array(32)))}`;
    const tagHashBytes = await sha256Bytes(`${tagUid}:${secretHex}`);
    const tagHardwareHash = `0x${bytesToHex(tagHashBytes)}`;

    const bundlePayload = JSON.stringify({
      tokenId: nextTokenId,
      title,
      artist: artistName,
      studio: studioLoc,
      medium,
      dimensions,
      royaltyBps,
      tagUid,
      tagHardwareHash,
    });
    const cidV1 = await computeCidV1Browser(bundlePayload);

    const newPiece = {
      id: `ona_piece_00${nextTokenId}`,
      tokenId: nextTokenId,
      title,
      artist: artistName,
      studio: studioLoc,
      year: 2026,
      medium,
      dimensions,
      edition: '1 of 1',
      royaltyBps,
      priceUsd,
      priceNgn: Math.round(priceUsd * 1600),
      resaleDefaultUsd: Math.round(priceUsd * 3.2),
      image: 'assets/artworks/terracotta-meridian.jpg',
      jsonFile: '',
      tagUid,
      secretHex,
      tagHardwareHash,
      lastCounter: 1,
      escrowReleased: false,
      custodialHeld: true,
      holderLabel: 'Artist Studio Custody (Listed)',
      cidV1,
      checkpoints: [
        {
          kind: 'ARTIST_STUDIO_MINT_READY',
          when: new Date().toISOString().slice(0, 16).replace('T', ' ') + ' UTC',
          summary: `Registered by ${artistName} (${royaltyPct.toFixed(1)}% ERC-2981 royalty) — NTAG 424 DNA UID ${tagUid} bound & pinned to ipfs://${cidV1.slice(0, 18)}….`,
        },
      ],
    };

    catalogue.push(newPiece);
    activePieceId = newPiece.id;
    await renderAll();

    showBanner(
      'studio-feedback',
      `Registered "${title}" (#${nextTokenId}) with Filecoin CIDv1 ${cidV1} and NTAG 424 DNA UID ${tagUid}. Selected in the exhibition workbench above.`,
      'ok'
    );
  });
}

async function handleQueryParamTap() {
  const params = new URLSearchParams(window.location.search);
  const uid = params.get('uid');
  const ctrHex = params.get('ctr');
  const mac = params.get('mac');
  if (!uid || !ctrHex || !mac) return;

  const target = catalogue.find((c) => c.tagUid.toUpperCase() === uid.toUpperCase());
  if (!target) return;
  activePieceId = target.id;
  await renderAll();

  const parsedCounter = parseInt(ctrHex, 16);
  const expectedMac = await computeSunMacBrowser(target.tagUid, target.secretHex, parsedCounter);
  if (parsedCounter > target.lastCounter && expectedMac === mac.toUpperCase()) {
    target.lastCounter = parsedCounter;
    target.escrowReleased = true;
    await renderAll();
    showBanner('nfc-feedback', `URL NFC tap #${parsedCounter} verified for ${target.title}.`, 'ok');
  } else {
    showBanner(
      'nfc-feedback',
      `URL NFC check: counter #${parsedCounter} already consumed or MAC mismatch (last verified #${target.lastCounter}).`,
      'err'
    );
  }
}

await hydrateRegistryCids();
wireInteractions();
await renderAll();
await handleQueryParamTap();
