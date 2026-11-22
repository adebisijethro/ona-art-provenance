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
const mainContractSource = fs.readFileSync(
  path.join(rootDir, 'contracts', 'OnaCertificate.sol'),
  'utf8'
);
const testMocksSource = fs
  .readFileSync(path.join(rootDir, 'contracts', 'mocks', 'TestContracts.sol'), 'utf8')
  .replace('import "../OnaCertificate.sol";', 'import "OnaCertificate.sol";');

const input = {
  language: 'Solidity',
  sources: {
    'OnaCertificate.sol': { content: mainContractSource },
    'TestContracts.sol': { content: testMocksSource },
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

const outDir = path.join(rootDir, 'contracts', 'abi');
fs.mkdirSync(outDir, { recursive: true });

const target = compiled.contracts['OnaCertificate.sol']['OnaCertificate'];
const artifact = {
  contractName: 'OnaCertificate',
  version: '0.3.0',
  compilerVersion: solc.version(),
  standards: ['ERC-165', 'ERC-721', 'ERC-721Metadata', 'ERC-2981', 'EIP-191-NFC-SUN'],
  supportedChains: [
    { name: 'Base Mainnet', chainId: 8453 },
    { name: 'Base Sepolia', chainId: 84532 },
    { name: 'Celo Mainnet (MiniPay)', chainId: 42220 },
    { name: 'Celo Sepolia', chainId: 11142220 },
  ],
  abi: target.abi,
  methodIdentifiers: target.evm.methodIdentifiers,
  bytecode: `0x${target.evm.bytecode.object}`,
  deployedBytecode: `0x${target.evm.deployedBytecode.object}`,
  deployedBytecodeSize: target.evm.deployedBytecode.object.length / 2,
};

fs.writeFileSync(
  path.join(outDir, 'OnaCertificate.json'),
  JSON.stringify(artifact, null, 2) + '\n'
);

const mockNames = [
  'MockERC20',
  'MockNonStandardERC20',
  'MaliciousReentrantParticipant',
  'MockERC721Receiver',
  'RejectingERC721Receiver',
];
const mocksOut = {};
for (const name of mockNames) {
  const c = compiled.contracts['TestContracts.sol'][name];
  mocksOut[name] = {
    abi: c.abi,
    bytecode: `0x${c.evm.bytecode.object}`,
  };
}
fs.writeFileSync(
  path.join(outDir, 'TestContracts.json'),
  JSON.stringify(mocksOut, null, 2) + '\n'
);

console.log(
  `Compiled OnaCertificate.sol v0.3 + 5 test harnesses cleanly with solc ${solc.version()} (${artifact.deployedBytecodeSize} bytes runtime bytecode, 0 errors)`
);
