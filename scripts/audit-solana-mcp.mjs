import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const rustPath = path.join(rootDir, 'programs', 'ona_provenance', 'src', 'lib.rs');
const code = fs.readFileSync(rustPath, 'utf8');

console.log('=== Solana Developer MCP (mcp.solana.com) Anchor Program Security Audit ===');

const res = await fetch('https://mcp.solana.com/mcp', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    Accept: 'application/json, text/event-stream',
  },
  body: JSON.stringify({
    jsonrpc: '2.0',
    id: 1,
    method: 'tools/call',
    params: {
      name: 'program_autofixer',
      arguments: {
        code,
        filename: 'programs/ona_provenance/src/lib.rs',
        framework: 'anchor',
      },
    },
  }),
});

assert.equal(res.status, 200, 'mcp.solana.com/mcp HTTP status must be 200');
const raw = await res.text();
const dataLine = raw.split('\n').find((l) => l.startsWith('data: '));
assert.ok(dataLine, 'MCP response must include SSE data payload');
const payload = JSON.parse(dataLine.slice(6));
const reportText = payload?.result?.content?.[0]?.text || '{}';
const report = JSON.parse(reportText);

console.log('Framework detected:', report.framework_detected);
console.log('Issues found:', report.issues.length);
console.log('require_another_tool_call_after_fixing:', report.require_another_tool_call_after_fixing);

if (report.issues.length > 0) {
  console.error('Issues reported:', JSON.stringify(report.issues, null, 2));
}

assert.equal(report.framework_detected, 'anchor');
assert.equal(report.issues.length, 0, 'Anchor program must have 0 security issues');
assert.equal(report.require_another_tool_call_after_fixing, false);

console.log('✓ Solana Anchor program passed mcp.solana.com program_autofixer with 0 issues!');
