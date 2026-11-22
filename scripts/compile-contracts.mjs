import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');

function loadSolc() {
  const requireFromRoot = createRequire(import.meta.url);
  const candidates = [
    'solc',
    '/Users/mac/Documents/GitHub/Web3-Raffle/node_modules/solc/index.js',
  ];
  for (const candidate of candidates) {
    try {
      return requireFromRoot(candidate);
    } catch {
      // try next
    }
  }
  throw new Error('solc compiler module not found. Run `npm install --save-dev solc`.');
}

const solc = loadSolc();
const contractPath = path.join(rootDir, 'contracts', 'OnaCertificate.sol');
const source = fs.readFileSync(contractPath, 'utf8');

const input = {
  language: 'Solidity',
  sources: {
    'OnaCertificate.sol': { content: source },
  },
  settings: {
    optimizer: { enabled: true, runs: 200 },
    evmVersion: 'paris',
    outputSelection: {
      '*': {
        '*': ['abi', 'evm.bytecode.object', 'evm.deployedBytecode.object', 'evm.methodIdentifiers'],
      },
    },
  },
};

const compiled = JSON.parse(solc.compile(JSON.stringify(input)));

if (compiled.errors) {
  const fatal = compiled.errors.filter((e) => e.severity === 'error');
  for (const msg of compiled.errors) {
    console.log(`[solc ${msg.severity}] ${msg.formattedMessage.trim()}`);
  }
  if (fatal.length > 0) {
    process.exit(1);
  }
}

const target = compiled.contracts['OnaCertificate.sol']['OnaCertificate'];
const outDir = path.join(rootDir, 'contracts', 'abi');
fs.mkdirSync(outDir, { recursive: true });

const artifact = {
  contractName: 'OnaCertificate',
  compilerVersion: solc.version(),
  standards: ['ERC-165', 'ERC-721', 'ERC-721Metadata', 'ERC-2981'],
  supportedChains: [
    { name: 'Base Mainnet', chainId: 8453 },
    { name: 'Base Sepolia', chainId: 84532 },
    { name: 'Celo Mainnet (MiniPay)', chainId: 42220 },
    { name: 'Celo Alfajores', chainId: 44787 },
  ],
  abi: target.abi,
  methodIdentifiers: target.evm.methodIdentifiers,
  bytecode: `0x${target.evm.bytecode.object}`,
  deployedBytecodeSize: target.evm.deployedBytecode.object.length / 2,
};

const outPath = path.join(outDir, 'OnaCertificate.json');
fs.writeFileSync(outPath, JSON.stringify(artifact, null, 2) + '\n');
console.log(
  `Compiled OnaCertificate.sol successfully with solc ${solc.version()} -> contracts/abi/OnaCertificate.json (${artifact.deployedBytecodeSize} bytes runtime bytecode)`
);
