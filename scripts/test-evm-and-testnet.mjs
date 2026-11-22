import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');

async function loadEvmDeps() {
  const fallbackPkg = '/Users/mac/Documents/GitHub/Web3-Raffle/package.json';
  const req = createRequire(fs.existsSync(fallbackPkg) ? fallbackPkg : import.meta.url);
  const ethersPath = req.resolve('ethers');
  const ethers = await import(pathToFileURL(ethersPath).href);
  const { createProvider } = req('hardhat/internal/core/providers/construction');
  return { ethers, createProvider };
}

async function rpcPost(url, method, params) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });
  const json = await res.json();
  if (json.error) {
    throw new Error(`${method} on ${url} failed: ${JSON.stringify(json.error)}`);
  }
  return json.result;
}

async function expectRevert(promise, expectedCustomErrorName, iface) {
  let reverted = false;
  let revertReason = '';
  try {
    const tx = await promise;
    if (tx && typeof tx.wait === 'function') {
      await tx.wait();
    }
  } catch (err) {
    reverted = true;
    const rawData = err?.data || err?.info?.error?.data?.data || err?.error?.data || '';
    if (rawData && typeof rawData === 'string' && rawData.startsWith('0x') && iface) {
      try {
        const parsed = iface.parseError(rawData);
        revertReason = parsed ? parsed.name : rawData;
      } catch {
        revertReason = rawData;
      }
    } else {
      revertReason = err?.shortMessage || err?.message || String(err);
    }
  }
  assert.ok(reverted, `Expected transaction to revert with ${expectedCustomErrorName}, but it succeeded`);
  if (expectedCustomErrorName && revertReason && !revertReason.startsWith('0x')) {
    assert.ok(
      revertReason.includes(expectedCustomErrorName) || revertReason.includes('reverted'),
      `Expected ${expectedCustomErrorName}, got: ${revertReason}`
    );
  }
}

const { ethers, createProvider } = await loadEvmDeps();
const mainArtifact = JSON.parse(
  fs.readFileSync(path.join(rootDir, 'contracts', 'abi', 'OnaCertificate.json'), 'utf8')
);
const mockArtifacts = JSON.parse(
  fs.readFileSync(path.join(rootDir, 'contracts', 'abi', 'TestContracts.json'), 'utf8')
);

console.log('==================================================================');
console.log(' PART 1: HARDHAT EVM FORK OF LIVE BASE SEPOLIA TESTNET (ID 84532)');
console.log('==================================================================');

const BASE_SEPOLIA_RPC = 'https://sepolia.base.org';
const liveBaseBlockHex = await rpcPost(BASE_SEPOLIA_RPC, 'eth_blockNumber', []);
const liveBaseBlock = parseInt(liveBaseBlockHex, 16);
console.log(`Connected to live Base Sepolia RPC (${BASE_SEPOLIA_RPC}) at block #${liveBaseBlock}`);

// Fresh deterministic Ona test suite keys (nonce 0 on Base Sepolia, zero collision with public Anvil keys)
const roleKey = (label) => ethers.keccak256(ethers.toUtf8Bytes(`ona-v0.3-base-sepolia-suite:${label}`));
const adminKey = roleKey('admin');
const relayerKey = roleKey('relayer');
const sunVerifierKey = roleKey('sunVerifier');
const artistKey = roleKey('artist');
const collectorVaultKey = roleKey('collectorVault');
const collectorSelfCustodyKey = roleKey('collectorSelf');
const buyer2Key = roleKey('buyer2');
const treasuryKey = roleKey('treasury');

const thousandEth = '0x3635c9adc5dea00000'; // 1000 ETH

const rawProvider = await createProvider(
  {
    paths: { root: rootDir, cache: path.join(rootDir, '.cache') },
    networks: {
      hardhat: {
        chainId: 84532,
        hardfork: 'cancun',
        forking: {
          enabled: true,
          url: BASE_SEPOLIA_RPC,
          blockNumber: liveBaseBlock - 2,
        },
        accounts: [
          { privateKey: adminKey, balance: thousandEth },
          { privateKey: relayerKey, balance: thousandEth },
          { privateKey: sunVerifierKey, balance: thousandEth },
          { privateKey: artistKey, balance: thousandEth },
          { privateKey: collectorVaultKey, balance: thousandEth },
          { privateKey: collectorSelfCustodyKey, balance: thousandEth },
          { privateKey: buyer2Key, balance: thousandEth },
          { privateKey: treasuryKey, balance: thousandEth },
        ],
        chains: new Map(),
        mining: { auto: true, interval: 0, mempool: { order: 'fifo' } },
        minGasPrice: 0n,
        blockGasLimit: 30_000_000,
        allowUnlimitedContractSize: false,
        throwOnTransactionFailures: true,
        throwOnCallFailures: true,
        loggingEnabled: false,
        initialDate: new Date().toISOString(),
        allowBlocksWithSameTimestamp: true,
        coinbase: '0x0000000000000000000000000000000000000000',
      },
    },
  },
  'hardhat',
  undefined,
  []
);

const provider = new ethers.BrowserProvider(rawProvider, 84532, { cacheTimeout: -1 });
const admin = new ethers.Wallet(adminKey, provider);
const relayer = new ethers.Wallet(relayerKey, provider);
const sunVerifier = new ethers.Wallet(sunVerifierKey, provider);
const artist = new ethers.Wallet(artistKey, provider);
const collectorVault = new ethers.Wallet(collectorVaultKey, provider);
const collectorSelf = new ethers.Wallet(collectorSelfCustodyKey, provider);
const buyer2 = new ethers.Wallet(buyer2Key, provider);
const treasury = new ethers.Wallet(treasuryKey, provider);

const net = await provider.getNetwork();
assert.equal(net.chainId, 84532n, 'Forked chainId must match Base Sepolia (84532)');

// Deploy OnaCertificate v0.3
const OnaFactory = new ethers.ContractFactory(mainArtifact.abi, mainArtifact.bytecode, admin);
const ona = await OnaFactory.deploy(relayer.address, sunVerifier.address, treasury.address);
await ona.waitForDeployment();
const onaAddress = await ona.getAddress();
const onaIface = new ethers.Interface(mainArtifact.abi);
console.log(`✓ Deployed OnaCertificate v0.3 on Base Sepolia fork at ${onaAddress}`);

// Helper to sign EIP-191 NTAG 424 DNA SUN tap
async function signNfcTap(signerWallet, tokenId, tagHash, counter, actorAddress) {
  const digest = await ona.computeNfcTapDigest(tokenId, tagHash, counter, actorAddress);
  return signerWallet.signMessage(ethers.getBytes(digest));
}

// T01: Standards & Metadata
assert.equal(await ona.supportsInterface('0x01ffc9a7'), true, 'IERC165');
assert.equal(await ona.supportsInterface('0x80ac58cd'), true, 'IERC721');
assert.equal(await ona.supportsInterface('0x5b5e139f'), true, 'IERC721Metadata');
assert.equal(await ona.supportsInterface('0x2a55205a'), true, 'IERC2981');
assert.equal(await ona.supportsInterface('0xffffffff'), false, 'Invalid interface must return false');
assert.equal(await ona.name(), 'Ona Art Provenance Certificate');
assert.equal(await ona.symbol(), 'ONA-COA');
console.log('✓ [T01] ERC-165, ERC-721, ERC-721Metadata & ERC-2981 interface compliance verified');

// T02: Primary Mint with Native ETH Escrow + Automatic Overpayment Refund
const tag1 = ethers.keccak256(ethers.toUtf8Bytes('NTAG424:04A28F19C36B80:SECRET_SALT_1'));
const escrowEth = ethers.parseEther('1.0');
const overpayEth = ethers.parseEther('1.25'); // 0.25 ETH excess must be refunded!
const relayerBalBefore = await provider.getBalance(relayer.address);

const mintTx1 = await ona.connect(relayer).mintCertificate(
  {
    artist: artist.address,
    buyerRecipient: collectorVault.address,
    royaltyBps: 1000, // 10.0%
    tagHardwareHash: tag1,
    editionIndex: 1,
    editionTotal: 1,
    isCustodialVault: true,
    ipfsProvenanceCID: 'bafkreidcd6a2iukbmptj7p3ickueucq4xbixsp4lsqy3m67byapjv2mk6y',
    escrowToken: ethers.ZeroAddress,
    escrowAmount: escrowEth,
    recordedPrimaryPrice: escrowEth,
  },
  { value: overpayEth }
);
const mintRcpt1 = await mintTx1.wait();
const gasCost1 = mintRcpt1.gasUsed * mintRcpt1.gasPrice;
const relayerBalAfter = await provider.getBalance(relayer.address);

assert.equal(
  await provider.getBalance(onaAddress),
  escrowEth,
  'Contract must hold exact 1.0 ETH escrow (0.25 ETH overpayment refunded, zero trapped ETH)'
);
assert.equal(
  relayerBalBefore - relayerBalAfter - gasCost1,
  escrowEth,
  'Relayer net spend must equal exact 1.0 ETH escrow'
);
assert.equal(await ona.ownerOf(1), collectorVault.address);
assert.equal(
  await ona.tokenURI(1),
  'ipfs://bafkreidcd6a2iukbmptj7p3ickueucq4xbixsp4lsqy3m67byapjv2mk6y'
);
console.log('✓ [T02] Primary mint with native ETH escrow + automatic 0.25 ETH overpayment refund verified');

// T03: Validation Guards (Duplicate Tag, Edition Out-of-Bounds, Excessive Royalty, Unexpected ETH)
await expectRevert(
  ona.connect(relayer).mintCertificate({
    artist: artist.address,
    buyerRecipient: collectorVault.address,
    royaltyBps: 1000,
    tagHardwareHash: tag1, // duplicate!
    editionIndex: 1,
    editionTotal: 1,
    isCustodialVault: true,
    ipfsProvenanceCID: 'bafkreitest',
    escrowToken: ethers.ZeroAddress,
    escrowAmount: 0,
    recordedPrimaryPrice: 100,
  }),
  'TagAlreadyBound',
  onaIface
);
await expectRevert(
  ona.connect(relayer).mintCertificate({
    artist: artist.address,
    buyerRecipient: collectorVault.address,
    royaltyBps: 1000,
    tagHardwareHash: ethers.ZeroHash,
    editionIndex: 4, // > editionTotal 3!
    editionTotal: 3,
    isCustodialVault: true,
    ipfsProvenanceCID: 'bafkreitest',
    escrowToken: ethers.ZeroAddress,
    escrowAmount: 0,
    recordedPrimaryPrice: 100,
  }),
  'InvalidEdition',
  onaIface
);
await expectRevert(
  ona.connect(relayer).mintCertificate({
    artist: artist.address,
    buyerRecipient: collectorVault.address,
    royaltyBps: 3000, // > 2500 max!
    tagHardwareHash: ethers.ZeroHash,
    editionIndex: 1,
    editionTotal: 1,
    isCustodialVault: true,
    ipfsProvenanceCID: 'bafkreitest',
    escrowToken: ethers.ZeroAddress,
    escrowAmount: 0,
    recordedPrimaryPrice: 100,
  }),
  'InvalidRoyaltyBps',
  onaIface
);
await expectRevert(
  ona.connect(relayer).mintCertificate(
    {
      artist: artist.address,
      buyerRecipient: collectorVault.address,
      royaltyBps: 1000,
      tagHardwareHash: ethers.ZeroHash,
      editionIndex: 1,
      editionTotal: 1,
      isCustodialVault: true,
      ipfsProvenanceCID: 'bafkreitest',
      escrowToken: ethers.ZeroAddress,
      escrowAmount: 0,
      recordedPrimaryPrice: 100,
    },
    { value: 1n }
  ),
  'UnexpectedNativeValue',
  onaIface
);
console.log('✓ [T03] Guardrails verified (TagAlreadyBound, InvalidEdition, InvalidRoyaltyBps, UnexpectedNativeValue)');

// T04 & T05: EIP-191 ECDSA NFC SUN Signature Verification, Replay Block, Forged Signer Block & Escrow Release
const forgedSig = await signNfcTap(buyer2, 1, tag1, 15, collectorVault.address); // wrong signer!
await expectRevert(
  ona.connect(relayer).confirmPhysicalDelivery(1, 15, forgedSig),
  'InvalidNFCSignature',
  onaIface
);

const wrongActorSig = await signNfcTap(sunVerifier, 1, tag1, 15, buyer2.address); // wrong actor!
await expectRevert(
  ona.connect(relayer).confirmPhysicalDelivery(1, 15, wrongActorSig),
  'InvalidNFCSignature',
  onaIface
);

const artistBalBefore = await provider.getBalance(artist.address);
const validTap15Sig = await signNfcTap(sunVerifier, 1, tag1, 15, collectorVault.address);
await (await ona.connect(relayer).confirmPhysicalDelivery(1, 15, validTap15Sig)).wait();
const artistBalAfter = await provider.getBalance(artist.address);

assert.equal(artistBalAfter - artistBalBefore, escrowEth, 'Artist must receive 1.0 ETH escrow upon NFC tap');
const art1 = await ona.artworks(1);
assert.equal(art1.physicalVerified, true);
assert.equal(art1.lastTapCounter, 15n);

// Replay same counter #15 must revert!
await expectRevert(
  ona.connect(relayer).confirmPhysicalDelivery(1, 15, validTap15Sig),
  'InvalidNFCCounter',
  onaIface
);
console.log('✓ [T04-T05] EIP-191 NFC SUN signature verification, artist escrow release & replay/front-run blocks verified');

// T06: Strict Self-Custody Sovereignty Lockout (Critical Audit Fix #1)
await (await ona.connect(relayer).exportToSelfCustody(1, collectorSelf.address)).wait();
assert.equal(await ona.ownerOf(1), collectorSelf.address);
assert.equal((await ona.artworks(1)).custodialHeld, false);

// Now NEITHER relayer NOR admin may move, re-export, or list collectorSelf's NFT!
await expectRevert(
  ona.connect(relayer).exportToSelfCustody(1, buyer2.address),
  'AlreadySelfCustodied',
  onaIface
);
await expectRevert(
  ona.connect(admin).exportToSelfCustody(1, buyer2.address),
  'AlreadySelfCustodied',
  onaIface
);
await expectRevert(
  ona.connect(relayer).listForResale(1, ethers.ZeroAddress, ethers.parseEther('0.01')),
  'Unauthorized',
  onaIface
);
await expectRevert(
  ona.connect(admin).transferFrom(collectorSelf.address, buyer2.address, 1),
  'Unauthorized',
  onaIface
);
console.log('✓ [T06] Self-custody sovereignty verified (admin & relayer permanently locked out after export)');

// T07: USDC (ERC-20) Primary Escrow + Delivery Release + Secondary Resale Atomic 3-Way Royalty Split
const MockERC20Factory = new ethers.ContractFactory(
  mockArtifacts.MockERC20.abi,
  mockArtifacts.MockERC20.bytecode,
  admin
);
const usdc = await MockERC20Factory.deploy('USD Coin', 'USDC', 6);
await usdc.waitForDeployment();
const usdcAddress = await usdc.getAddress();

const primaryUsdc = 1450_000_000n; // $1,450.00 USDC
const resaleUsdc = 4800_000_000n;  // $4,800.00 USDC
await (await usdc.mint(relayer.address, primaryUsdc)).wait();
await (await usdc.connect(relayer).approve(onaAddress, primaryUsdc)).wait();

const tag2 = ethers.keccak256(ethers.toUtf8Bytes('NTAG424:04E75102BA9480:SECRET_SALT_2'));
await (
  await ona.connect(relayer).mintCertificate({
    artist: artist.address,
    buyerRecipient: collectorSelf.address,
    royaltyBps: 1200, // 12.0% royalty
    tagHardwareHash: tag2,
    editionIndex: 1,
    editionTotal: 3,
    isCustodialVault: false,
    ipfsProvenanceCID: 'bafkreipiece2',
    escrowToken: usdcAddress,
    escrowAmount: primaryUsdc,
    recordedPrimaryPrice: primaryUsdc,
  })
).wait();

const sigPiece2Delivery = await signNfcTap(sunVerifier, 2, tag2, 9, collectorSelf.address);
await (await ona.connect(collectorSelf).confirmPhysicalDelivery(2, 9, sigPiece2Delivery)).wait();
assert.equal(await usdc.balanceOf(artist.address), primaryUsdc, 'Artist received $1,450 USDC primary escrow');

// Collector lists Piece #2 for $4,800 USDC, tests cancel, then re-lists and settles secondary resale!
await (await ona.connect(collectorSelf).listForResale(2, usdcAddress, resaleUsdc)).wait();
await (await ona.connect(collectorSelf).cancelResaleListing(2)).wait();
assert.equal((await ona.resaleListings(2)).active, false, 'Listing cancelled cleanly');

await (await ona.connect(collectorSelf).listForResale(2, usdcAddress, resaleUsdc)).wait();
await (await usdc.mint(buyer2.address, resaleUsdc)).wait();
await (await usdc.connect(buyer2).approve(onaAddress, resaleUsdc)).wait();

// Self-purchase must be blocked
await expectRevert(
  ona.connect(buyer2).settleSecondaryResale(2, collectorSelf.address, false, 0, '0x'),
  'SelfPurchaseDisallowed',
  onaIface
);

const sigPiece2Resale = await signNfcTap(sunVerifier, 2, tag2, 10, buyer2.address);
await (await ona.connect(buyer2).settleSecondaryResale(2, buyer2.address, false, 10, sigPiece2Resale)).wait();

// Verify exact 3-way split of $4,800 USDC: 12% ($576) artist, 5% ($240) treasury, 83% ($3,984) seller
assert.equal(await usdc.balanceOf(artist.address), primaryUsdc + 576_000_000n);
assert.equal(await usdc.balanceOf(treasury.address), 240_000_000n);
assert.equal(await usdc.balanceOf(collectorSelf.address), 3984_000_000n);
assert.equal(await ona.ownerOf(2), buyer2.address);
const history2 = await ona.getProvenanceHistory(2);
assert.equal(history2.length, 3, 'Provenance history records MINT, NFC_DELIVERY_CONFIRMED, SECONDARY_RESALE');
console.log('✓ [T07] USDC ERC-20 escrow, cancelResaleListing & atomic 3-way secondary royalty split ($576/$3,984/$240) verified');

// T08: Legacy Non-Standard USDT-style ERC-20 (Zero-Return transfer/transferFrom)
const NonStdFactory = new ethers.ContractFactory(
  mockArtifacts.MockNonStandardERC20.abi,
  mockArtifacts.MockNonStandardERC20.bytecode,
  admin
);
const usdt = await NonStdFactory.deploy();
await usdt.waitForDeployment();
const usdtAddress = await usdt.getAddress();
await (await usdt.mint(relayer.address, 500_000_000n)).wait();
await (await usdt.connect(relayer).approve(onaAddress, 500_000_000n)).wait();

const tag3 = ethers.keccak256(ethers.toUtf8Bytes('NTAG424:TAG3'));
await (
  await ona.connect(relayer).mintCertificate({
    artist: artist.address,
    buyerRecipient: collectorSelf.address,
    royaltyBps: 1000,
    tagHardwareHash: tag3,
    editionIndex: 1,
    editionTotal: 1,
    isCustodialVault: false,
    ipfsProvenanceCID: 'bafkreipiece3',
    escrowToken: usdtAddress,
    escrowAmount: 500_000_000n,
    recordedPrimaryPrice: 500_000_000n,
  })
).wait();
const sig3 = await signNfcTap(sunVerifier, 3, tag3, 1, collectorSelf.address);
await (await ona.connect(collectorSelf).confirmPhysicalDelivery(3, 1, sig3)).wait();
assert.equal(await usdt.balanceOf(artist.address), 500_000_000n);
console.log('✓ [T08] SafeERC20 low-level call compatibility verified with non-standard USDT-style token');

// T09: Malicious Reentrancy Exploit Blocked During Native ETH Secondary Resale
const AttackerFactory = new ethers.ContractFactory(
  mockArtifacts.MaliciousReentrantParticipant.abi,
  mockArtifacts.MaliciousReentrantParticipant.bytecode,
  admin
);
const attacker = await AttackerFactory.deploy(onaAddress);
await attacker.waitForDeployment();
const attackerAddr = await attacker.getAddress();

// Collector transfers Token #1 to attacker contract, which lists it and tries to re-enter settleSecondaryResale in receive()
await (await ona.connect(collectorSelf).transferFrom(collectorSelf.address, attackerAddr, 1)).wait();
await (await attacker.listPiece(1, ethers.parseEther('2.0'))).wait();
await (await attacker.armAttack(1)).wait();

await (
  await ona.connect(buyer2).settleSecondaryResale(1, buyer2.address, false, 0, '0x', {
    value: ethers.parseEther('2.0'),
  })
).wait();

assert.equal(
  await attacker.reentryBlockedAsExpected(),
  true,
  'nonReentrant + CEI must block malicious callback reentrancy'
);
assert.equal(await ona.ownerOf(1), buyer2.address);
console.log('✓ [T09] Malicious reentrancy attack contract blocked cold by nonReentrant + CEI');

// T10: ERC-721 safeTransferFrom Receiver Checks
const GoodReceiverFactory = new ethers.ContractFactory(
  mockArtifacts.MockERC721Receiver.abi,
  mockArtifacts.MockERC721Receiver.bytecode,
  admin
);
const BadReceiverFactory = new ethers.ContractFactory(
  mockArtifacts.RejectingERC721Receiver.abi,
  mockArtifacts.RejectingERC721Receiver.bytecode,
  admin
);
const goodReceiver = await GoodReceiverFactory.deploy();
await goodReceiver.waitForDeployment();
const badReceiver = await BadReceiverFactory.deploy();
await badReceiver.waitForDeployment();

await expectRevert(
  ona.connect(buyer2)['safeTransferFrom(address,address,uint256)'](
    buyer2.address,
    await badReceiver.getAddress(),
    1
  ),
  'TransferFailed',
  onaIface
);

await (
  await ona
    .connect(buyer2)
    ['safeTransferFrom(address,address,uint256)'](buyer2.address, await goodReceiver.getAddress(), 1)
).wait();
assert.equal(await goodReceiver.lastReceivedTokenId(), 1n);
console.log('✓ [T10] ERC-721 safeTransferFrom receiver acceptance & rejection verified');

console.log('\n==================================================================');
console.log(' PART 2: LIVE REMOTE TESTNET RPC EXECUTION (BASE SEPOLIA + CELO)');
console.log('==================================================================');

const TESTNETS = [
  { name: 'Base Sepolia Testnet', rpc: 'https://sepolia.base.org', expectedChainId: 84532 },
  {
    name: 'Celo Sepolia Testnet',
    rpc: 'https://forno.celo-sepolia.celo-testnet.org',
    expectedChainId: 11142220,
  },
];

const constructorArgsEncoded = ethers.AbiCoder.defaultAbiCoder()
  .encode(
    ['address', 'address', 'address'],
    [relayer.address, sunVerifier.address, treasury.address]
  )
  .slice(2);
const fullDeployData = `${mainArtifact.bytecode}${constructorArgsEncoded}`;
const simContractAddr = '0x000000000000000000000000000000000000CAFE';

for (const netCfg of TESTNETS) {
  const chainHex = await rpcPost(netCfg.rpc, 'eth_chainId', []);
  const blockHex = await rpcPost(netCfg.rpc, 'eth_blockNumber', []);
  assert.equal(parseInt(chainHex, 16), netCfg.expectedChainId);

  // 1. Live remote eth_estimateGas for OnaCertificate deployment on the public testnet sequencer
  const deployGasHex = await rpcPost(netCfg.rpc, 'eth_estimateGas', [
    {
      from: '0x8fbaad22547309635064a160c4c12e0670e6235b',
      data: fullDeployData,
    },
  ]);
  const deployGas = parseInt(deployGasHex, 16);
  assert.ok(deployGas > 1_000_000 && deployGas < 5_000_000, 'Deployment gas within sane bounds');

  // 2. Live remote eth_call executing deployedBytecode directly on the remote testnet node via state override
  const supports2981Call = onaIface.encodeFunctionData('supportsInterface', ['0x2a55205a']);
  const supports2981Res = await rpcPost(netCfg.rpc, 'eth_call', [
    { to: simContractAddr, data: supports2981Call },
    'latest',
    { [simContractAddr]: { code: mainArtifact.deployedBytecode } },
  ]);
  assert.equal(
    onaIface.decodeFunctionResult('supportsInterface', supports2981Res)[0],
    true,
    `${netCfg.name} remote ERC-2981 check must return true`
  );

  const digestCall = onaIface.encodeFunctionData('computeNfcTapDigest', [
    1n,
    tag1,
    15,
    '0x8fbaad22547309635064a160c4c12e0670e6235b',
  ]);
  const digestRes = await rpcPost(netCfg.rpc, 'eth_call', [
    { to: simContractAddr, data: digestCall },
    'latest',
    { [simContractAddr]: { code: mainArtifact.deployedBytecode } },
  ]);
  const remoteDigest = onaIface.decodeFunctionResult('computeNfcTapDigest', digestRes)[0];
  assert.equal(remoteDigest.length, 66);

  console.log(
    `✓ [${netCfg.name} · Chain ${netCfg.expectedChainId} · Block #${parseInt(blockHex, 16)}] Remote deployment gas = ${deployGas.toLocaleString()} | Remote ERC-2981 & EIP-191 digest execution verified`
  );
}

console.log('\nALL SMART CONTRACT AUDIT & LIVE TESTNET FORK/RPC SUITES PASSED.');
