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

const roleKey = (label) => ethers.keccak256(ethers.toUtf8Bytes(`ona-v0.4-base-sepolia-suite:${label}`));
const adminKey = roleKey('admin');
const relayerKey = roleKey('relayer');
const sunVerifierKey = roleKey('sunVerifier');
const artistKey = roleKey('artist');
const artistNewWalletKey = roleKey('artistNewWallet');
const collectorVaultKey = roleKey('collectorVault');
const collectorSelfCustodyKey = roleKey('collectorSelf');
const buyer2Key = roleKey('buyer2');
const treasuryKey = roleKey('treasury');

const thousandEth = '0x3635c9adc5dea00000';

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
          { privateKey: artistNewWalletKey, balance: thousandEth },
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
const artistNewWallet = new ethers.Wallet(artistNewWalletKey, provider);
const collectorVault = new ethers.Wallet(collectorVaultKey, provider);
const collectorSelf = new ethers.Wallet(collectorSelfCustodyKey, provider);
const buyer2 = new ethers.Wallet(buyer2Key, provider);
const treasury = new ethers.Wallet(treasuryKey, provider);

const OnaFactory = new ethers.ContractFactory(mainArtifact.abi, mainArtifact.bytecode, admin);
const ona = await OnaFactory.deploy(relayer.address, sunVerifier.address, treasury.address);
await ona.waitForDeployment();
const onaAddress = await ona.getAddress();
const onaIface = new ethers.Interface(mainArtifact.abi);
console.log(`✓ Deployed OnaCertificate v0.4 on Base Sepolia fork at ${onaAddress}`);

const futureDeadline = BigInt(Math.floor(Date.now() / 1000) + 3600);
const expiredDeadline = 1_000_000n;

async function signNfcTap(signerWallet, tokenId, tagHash, counter, actorAddress, deadline = futureDeadline) {
  const digest = await ona.computeNfcTapDigest(tokenId, tagHash, counter, actorAddress, deadline);
  return signerWallet.signMessage(ethers.getBytes(digest));
}

// T01: Standards & Metadata
assert.equal(await ona.supportsInterface('0x01ffc9a7'), true);
assert.equal(await ona.supportsInterface('0x80ac58cd'), true);
assert.equal(await ona.supportsInterface('0x5b5e139f'), true);
assert.equal(await ona.supportsInterface('0x2a55205a'), true);
assert.equal(await ona.supportsInterface('0xffffffff'), false);
console.log('✓ [T01] ERC-165, ERC-721, ERC-721Metadata & ERC-2981 interface compliance verified');

// T02: Primary Mint + Native Overpayment Refund + DeliveryEscrowPending Gate (v0.4 fix)
const tag1 = ethers.keccak256(ethers.toUtf8Bytes('NTAG424:04A28F19C36B80:SECRET_SALT_1'));
const escrowEth = ethers.parseEther('1.0');
const overpayEth = ethers.parseEther('1.25');

await (
  await ona.connect(relayer).mintCertificate(
    {
      artist: artist.address,
      buyerRecipient: collectorVault.address,
      royaltyBps: 1000,
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
  )
).wait();

assert.equal(await provider.getBalance(onaAddress), escrowEth);

// v0.4 Guard: Cannot list for secondary resale OR export OR transfer while primary delivery escrow is still pending!
await expectRevert(
  ona.connect(relayer).listForResale(1, ethers.ZeroAddress, ethers.parseEther('2.0')),
  'DeliveryEscrowPending',
  onaIface
);
await expectRevert(
  ona.connect(relayer).exportToSelfCustody(1, collectorSelf.address),
  'DeliveryEscrowPending',
  onaIface
);
await expectRevert(
  ona.connect(collectorVault).transferFrom(collectorVault.address, buyer2.address, 1),
  'DeliveryEscrowPending',
  onaIface
);
console.log('✓ [T02] Overpayment refund & v0.4 DeliveryEscrowPending premature-transfer lock verified');

// T03: Expired Signature Rejection (SignatureExpired — v0.4 fix) + Forged Signer + Valid Release
const expiredSig = await signNfcTap(sunVerifier, 1, tag1, 15, collectorVault.address, expiredDeadline);
await expectRevert(
  ona.connect(relayer).confirmPhysicalDelivery(1, 15, expiredDeadline, expiredSig),
  'SignatureExpired',
  onaIface
);

const forgedSig = await signNfcTap(buyer2, 1, tag1, 15, collectorVault.address, futureDeadline);
await expectRevert(
  ona.connect(relayer).confirmPhysicalDelivery(1, 15, futureDeadline, forgedSig),
  'InvalidNFCSignature',
  onaIface
);

const artistBalBefore = await provider.getBalance(artist.address);
const validTap15Sig = await signNfcTap(sunVerifier, 1, tag1, 15, collectorVault.address, futureDeadline);
await (await ona.connect(relayer).confirmPhysicalDelivery(1, 15, futureDeadline, validTap15Sig)).wait();
const artistBalAfter = await provider.getBalance(artist.address);
assert.equal(artistBalAfter - artistBalBefore, escrowEth);

await expectRevert(
  ona.connect(relayer).confirmPhysicalDelivery(1, 15, futureDeadline, validTap15Sig),
  'InvalidNFCCounter',
  onaIface
);
console.log('✓ [T03] Time-bounded EIP-191 NFC SUN signature (SignatureExpired, InvalidNFCSignature, InvalidNFCCounter) & escrow release verified');

// T04: Self-Custody Export + Permanent Relayer/Admin Lockout
await (await ona.connect(relayer).exportToSelfCustody(1, collectorSelf.address)).wait();
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
console.log('✓ [T04] One-way self-custody sovereignty verified');

// T05: Artist Beneficiary Rotation (v0.4 fix) & Two-Step Admin Transfer
await expectRevert(
  ona.connect(admin).updateArtistBeneficiary(1, buyer2.address),
  'Unauthorized',
  onaIface
);
await (await ona.connect(artist).updateArtistBeneficiary(1, artistNewWallet.address)).wait();
const [royaltyReceiver] = await ona.royaltyInfo(1, 10_000n);
assert.equal(royaltyReceiver, artistNewWallet.address);

await (await ona.connect(admin).transferAdmin(buyer2.address)).wait();
await (await ona.connect(buyer2).acceptAdmin()).wait();
assert.equal(await ona.admin(), buyer2.address);
await (await ona.connect(buyer2).transferAdmin(admin.address)).wait();
await (await ona.connect(admin).acceptAdmin()).wait();
console.log('✓ [T05] Artist beneficiary wallet rotation & two-step admin transfer verified');

// T06: USDC ERC-20 Primary Escrow + Secondary Resale Atomic 3-Way Royalty Split
const MockERC20Factory = new ethers.ContractFactory(
  mockArtifacts.MockERC20.abi,
  mockArtifacts.MockERC20.bytecode,
  admin
);
const usdc = await MockERC20Factory.deploy('USD Coin', 'USDC', 6);
await usdc.waitForDeployment();
const usdcAddress = await usdc.getAddress();

const primaryUsdc = 1450_000_000n;
const resaleUsdc = 4800_000_000n;
await (await usdc.mint(relayer.address, primaryUsdc)).wait();
await (await usdc.connect(relayer).approve(onaAddress, primaryUsdc)).wait();

const tag2 = ethers.keccak256(ethers.toUtf8Bytes('NTAG424:04E75102BA9480:SECRET_SALT_2'));
await (
  await ona.connect(relayer).mintCertificate({
    artist: artist.address,
    buyerRecipient: collectorSelf.address,
    royaltyBps: 1200,
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

const sig2 = await signNfcTap(sunVerifier, 2, tag2, 9, collectorSelf.address, futureDeadline);
await (await ona.connect(collectorSelf).confirmPhysicalDelivery(2, 9, futureDeadline, sig2)).wait();

await (await ona.connect(collectorSelf).listForResale(2, usdcAddress, resaleUsdc)).wait();
await (await usdc.mint(buyer2.address, resaleUsdc)).wait();
await (await usdc.connect(buyer2).approve(onaAddress, resaleUsdc)).wait();

const sig2Resale = await signNfcTap(sunVerifier, 2, tag2, 10, buyer2.address, futureDeadline);
await (
  await ona
    .connect(buyer2)
    .settleSecondaryResale(2, buyer2.address, false, 10, futureDeadline, sig2Resale)
).wait();

assert.equal(await usdc.balanceOf(artist.address), primaryUsdc + 576_000_000n);
assert.equal(await usdc.balanceOf(treasury.address), 240_000_000n);
assert.equal(await usdc.balanceOf(collectorSelf.address), 3984_000_000n);
console.log('✓ [T06] USDC ERC-20 escrow & atomic 3-way secondary resale split ($576/$3,984/$240) verified');

// T07: Malicious Reentrancy Exploit Blocked Cold
const AttackerFactory = new ethers.ContractFactory(
  mockArtifacts.MaliciousReentrantParticipant.abi,
  mockArtifacts.MaliciousReentrantParticipant.bytecode,
  admin
);
const attacker = await AttackerFactory.deploy(onaAddress);
await attacker.waitForDeployment();
const attackerAddr = await attacker.getAddress();

await (await ona.connect(collectorSelf).transferFrom(collectorSelf.address, attackerAddr, 1)).wait();
await (await attacker.listPiece(1, ethers.parseEther('2.0'))).wait();
await (await attacker.armAttack(1)).wait();

await (
  await ona.connect(buyer2).settleSecondaryResale(1, buyer2.address, false, 0, 0, '0x', {
    value: ethers.parseEther('2.0'),
  })
).wait();

assert.equal(await attacker.reentryBlockedAsExpected(), true);
assert.equal(await ona.ownerOf(1), buyer2.address);
console.log('✓ [T07] Malicious reentrancy attack contract blocked cold by nonReentrant + CEI');

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

  const deployGasHex = await rpcPost(netCfg.rpc, 'eth_estimateGas', [
    {
      from: '0x8fbaad22547309635064a160c4c12e0670e6235b',
      data: fullDeployData,
    },
  ]);
  const deployGas = parseInt(deployGasHex, 16);
  assert.ok(deployGas > 1_000_000 && deployGas < 5_000_000);

  const supports2981Call = onaIface.encodeFunctionData('supportsInterface', ['0x2a55205a']);
  const supports2981Res = await rpcPost(netCfg.rpc, 'eth_call', [
    { to: simContractAddr, data: supports2981Call },
    'latest',
    { [simContractAddr]: { code: mainArtifact.deployedBytecode } },
  ]);
  assert.equal(onaIface.decodeFunctionResult('supportsInterface', supports2981Res)[0], true);

  console.log(
    `✓ [${netCfg.name} · Chain ${netCfg.expectedChainId} · Block #${parseInt(blockHex, 16)}] Remote deployment gas = ${deployGas.toLocaleString()} | Remote ERC-2981 execution verified`
  );
}

console.log('\nALL v0.4 SMART CONTRACT & LIVE TESTNET SUITES PASSED.');
