// E2E: real Pi RPC, provider, MCP and tool effects; only the external SDK peer is replayed.
// Regressions: normalized SDK tool input closed the session; an output-limit stop failed the turn.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { RpcWorker } from './rpc.mjs';

const evidence = mkdtempSync(join(tmpdir(), 'pi-sdk-stream-e2e-')), project = join(evidence, 'project');
for (const path of [project, join(evidence, 'agent'), join(evidence, 'claude')]) mkdirSync(path);
Object.assign(process.env, { PI_CODING_AGENT_DIR: join(evidence, 'agent'), CLAUDE_CONFIG_DIR: join(evidence, 'claude'),
  PI_OFFLINE: '1', PI_TELEMETRY: '0', PI_RECOVERY_EVENTS: join(evidence, 'events.jsonl'), PI_RECOVERY_MARKER: 'STREAM_FIXTURE' });
const cli = process.env.PI_SDK_TEST_PI || fileURLToPath(new URL('./bundle/cli.js', import.meta.resolve('@earendil-works/pi-coding-agent')));
const records = () => existsSync(process.env.PI_RECOVERY_EVENTS) ? readFileSync(process.env.PI_RECOVERY_EVENTS, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse) : [];
const assistants = () => readFileSync(process.env.PI_RECOVERY_SESSION, 'utf8').trim().split('\n').map(JSON.parse)
  .flatMap(entry => entry.message?.role === 'assistant' ? [entry.message] : []);
const cases = {
  'stream-normalized': (messages, effects, results) => {
    assert.deepEqual(messages.map(message => message.stopReason), ['toolUse', 'stop'], messages.at(-1).errorMessage);
    assert.deepEqual(effects, ['wire-first', 'wire-\\uFEFF'], 'Pi must execute the streamed wire input exactly once.');
    assert.deepEqual(results, [{ type: 'result', label: 'normalized', error: false }]);
  },
  'stream-max-tokens': (messages, effects, results) => {
    assert.deepEqual(messages.map(message => message.stopReason), ['toolUse', 'stop'], messages.at(-1).errorMessage);
    assert.deepEqual(messages[0].content.map(block => block.type), ['text', 'toolCall'], 'A cut tool call must not reach Pi.');
    assert.deepEqual(effects, ['complete']);
    assert.deepEqual(results, [{ type: 'result', label: 'complete', error: false }]);
  },
  'stream-max-tokens-text': (messages, effects) => {
    assert.deepEqual(messages.map(message => message.stopReason), ['length'], messages.at(-1).errorMessage);
    assert.deepEqual(messages[0].content, [{ type: 'text', text: 'PARTIAL' }]);
    assert.deepEqual(effects, []);
  },
};
let worker;
console.log('Evidence: ' + evidence);
try {
  for (const [request, check] of Object.entries(cases).filter(([name]) => process.argv.length < 3 || process.argv.includes(name))) {
    const file = join(evidence, request + '.jsonl');
    process.env.PI_RECOVERY_SESSION = file;
    writeFileSync(file, JSON.stringify({ type: 'session', version: 3, id: randomUUID(), timestamp: new Date().toISOString(), cwd: project }) + '\n');
    const offset = records().length;
    let settled = false;
    worker = new RpcWorker(file, project, { bin: process.execPath, prefix: [cli, '-ne', '-ns', '-np', '-nc', '--no-mcp', '--tools', 'probe',
      '-e', fileURLToPath(new URL('./fixtures/recovery.ts', import.meta.url)), '--model', 'claude-sdk/claude-haiku-5-5', '--thinking', 'medium'] });
    worker.on('event', event => { if (event.type === 'agent_settled') settled = true; });
    await worker.request('get_state');
    await worker.request('prompt', { message: request });
    for (const deadline = Date.now() + 12000; !settled; await delay(20)) if (Date.now() > deadline) throw new Error(request + ' did not settle.');
    const rows = records().slice(offset);
    check(assistants(), rows.filter(row => row.type === 'execution').map(row => row.label), rows.filter(row => row.type === 'result'));
    assert.equal(rows.filter(row => row.type === 'query').length, 1, 'The native SDK session must stay open.');
    console.log('pass ' + request);
    await worker.close(); worker = undefined;
  }
} finally {
  if (worker) writeFileSync(join(evidence, 'rpc-stderr.log'), worker.stderr);
  await worker?.close();
}
