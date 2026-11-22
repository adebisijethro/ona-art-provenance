import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');

const NETWORKS = {
  'base-sepolia': {
    name: 'Base Sepolia',
    chainId: 84532,
    rpc: process.env.BASE_SEPOLIA_RPC || 'https://sepolia.base.org',
    explorer: 'https://sepolia.basescan.org',
  },
  'celo-sepolia': {
    name: 'Celo Sepolia',
    chainId: 11142220,
    rpc: process.env.CELO_SEPOLIA_RPC || 'https://forno.celo-sepolia.celo-testnet.org',
    explorer: 'https://celo-sepolia.blockscout.com',
  },
};

const targetNet = process.argv[2] || 'base-sepolia';
const cfg = NETWORKS[targetNet];
if (!cfg) {
  console.error(`Unknown network "${targetNet}". Choose: ${Object.keys(NETWORKS).join(', ')}`);
  process.exit(1);
}

const pk = process.env.DEPLOYER_PRIVATE_KEY;
if (!pk) {
  console.error(
    `Set DEPLOYER_PRIVATE_KEY=0x... funded with ~0.0005 testnet ETH/CELO on ${cfg.name} (${cfg.chainId}) to broadcast deployment.`
  );
  process.exit(1);
}

const fallbackPkg = '/Users/mac/Documents/GitHub/Web3-Raffle/package.json';
const req = createRequire(fs.existsSync(fallbackPkg) ? fallbackPkg : import.meta.url);
const ethers = await import(pathToFileURL(req.resolve('ethers')).href);

const artifact = JSON.parse(
  fs.readFileSync(path.join(rootDir, 'contracts', 'abi', 'OnaCertificate.json'), 'utf8')
);

const provider = new ethers.JsonRpcProvider(cfg.rpc, cfg.chainId);
const wallet = new ethers.Wallet(pk, provider);
const balance = await provider.getBalance(wallet.address);
console.log(`Deploying OnaCertificate v0.3 to ${cfg.name} from ${wallet.address} (Balance: ${ethers.formatEther(balance)})...`);

const relayer = process.env.CUSTODIAL_RELAYER || wallet.address;
const verifier = process.env.NFC_SUN_VERIFIER || wallet.address;
const treasury = process.env.PROTOCOL_TREASURY || '0x8fbaad22547309635064a160c4c12e0670e6235b';

const factory = new ethers.ContractFactory(artifact.abi, artifact.bytecode, wallet);
const contract = await factory.deploy(relayer, verifier, treasury);
const deployTx = contract.deploymentTransaction();
console.log(`Broadcast tx: ${cfg.explorer}/tx/${deployTx.hash}`);
await contract.waitForDeployment();
const address = await contract.getAddress();
console.log(`✓ Deployed OnaCertificate v0.3 at ${cfg.explorer}/address/${address}`);

const outDir = path.join(rootDir, 'deployments');
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(
  path.join(outDir, `${targetNet}.json`),
  JSON.stringify(
    {
      network: cfg.name,
      chainId: cfg.chainId,
      contractAddress: address,
      deploymentTxHash: deployTx.hash,
      deployer: wallet.address,
      custodialRelayer: relayer,
      nfcSunVerifier: verifier,
      protocolTreasury: treasury,
      deployedAt: new Date().toISOString(),
    },
    null,
    2
  ) + '\n'
);
