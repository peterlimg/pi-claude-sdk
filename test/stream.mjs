// E2E: real Pi RPC, provider, MCP and tool effects; only the external SDK peer is replayed.
// Regressions: normalized SDK tool input closed the session; an output-limit stop failed the turn;
// the default output cap is 128k while checkpoints fingerprinted with the old 16k default still resume;
// a stalled API stream failed with a non-retryable error instead of Pi retrying the turn.
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { getCurrentSystemPrompt, getCurrentTools } from '@earendil-works/pi-ai';
import { RpcWorker } from './rpc.mjs';

const evidence = mkdtempSync(join(tmpdir(), 'pi-sdk-stream-e2e-')), project = join(evidence, 'project');
for (const path of [project, join(evidence, 'agent'), join(evidence, 'claude')]) mkdirSync(path);
Object.assign(process.env, { PI_CODING_AGENT_DIR: join(evidence, 'agent'), CLAUDE_CONFIG_DIR: join(evidence, 'claude'),
  PI_OFFLINE: '1', PI_TELEMETRY: '0', PI_RECOVERY_EVENTS: join(evidence, 'events.jsonl'), PI_RECOVERY_MARKER: 'STREAM_FIXTURE' });
const cli = process.env.PI_SDK_TEST_PI || fileURLToPath(new URL('./bundle/cli.js', import.meta.resolve('@earendil-works/pi-coding-agent')));
const records = () => existsSync(process.env.PI_RECOVERY_EVENTS) ? readFileSync(process.env.PI_RECOVERY_EVENTS, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse) : [];
const entries = () => readFileSync(process.env.PI_RECOVERY_SESSION, 'utf8').trim().split('\n').map(JSON.parse);
const assistants = () => entries().flatMap(entry => entry.message?.role === 'assistant' ? [entry.message] : []);
let worker, settled = false;
async function start(file) {
  process.env.PI_RECOVERY_SESSION = file;
  if (!existsSync(file)) writeFileSync(file, JSON.stringify({ type: 'session', version: 3, id: randomUUID(), timestamp: new Date().toISOString(), cwd: project }) + '\n');
  worker = new RpcWorker(file, project, { bin: process.execPath, prefix: [cli, '-ne', '-ns', '-np', '-nc', '--no-mcp', '--tools', 'probe',
    '-e', fileURLToPath(new URL('./fixtures/recovery.ts', import.meta.url)), '--model', 'claude-sdk/claude-haiku-5-5', '--thinking', 'medium'] });
  worker.on('event', event => { if (event.type === 'agent_settled') settled = true; });
  await worker.request('get_state');
}
async function send(message) {
  settled = false;
  await worker.request('prompt', { message });
  for (const deadline = Date.now() + 12000; !settled; await delay(20)) if (Date.now() > deadline) throw new Error(message + ' did not settle.');
  return assistants().at(-1);
}
async function stop() { await worker.close(); worker = undefined; }
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
  'stream-stall': (messages, effects, results, rows) => stalled(messages, effects, results, rows, []),
  'stream-stall-after-tool': (messages, effects, results, rows) => stalled(messages, effects, results, rows, ['before-stall']),
};
// A stalled stream fails retryably with its reported usage; Pi's default retry rebuilds the context and finishes the turn.
function stalled(messages, effects, results, rows, before) {
  const failed = messages.findIndex(message => message.stopReason === 'error');
  assert.deepEqual(messages.map(message => message.stopReason), [...before.map(() => 'toolUse'), 'error', 'toolUse', 'stop'], JSON.stringify(messages.map(message => message.errorMessage ?? message.stopReason)));
  assert.match(messages[failed].errorMessage, /stopped mid-stream/);
  assert.deepEqual([messages[failed].usage.input, messages[failed].usage.output, messages[failed].usage.cacheRead], [7, 3, 900], 'The stalled attempt keeps its reported usage.');
  assert.deepEqual(effects, [...before, 'after-stall'], 'No call from the stalled response may run.');
  assert.deepEqual(results, [{ type: 'result', label: 'after-stall', error: false }]);
  assert.deepEqual(rows.filter(row => row.type === 'stall-handler'), [{ type: 'stall-handler', error: true }]);
}
const selected = name => process.argv.length < 3 || process.argv.includes(name);
console.log('Evidence: ' + evidence);
try {
  for (const [request, check] of Object.entries(cases).filter(([name]) => selected(name))) {
    const offset = records().length;
    await start(join(evidence, request + '.jsonl'));
    await send(request);
    const rows = records().slice(offset);
    check(assistants(), rows.filter(row => row.type === 'execution').map(row => row.label), rows.filter(row => row.type === 'result'), rows);
    // A stalled stream closes its native session; the retry starts one rebuilt from Pi history.
    assert.equal(rows.filter(row => row.type === 'query').length, request.startsWith('stream-stall') ? 2 : 1, 'The native SDK session must stay open.');
    console.log('pass ' + request);
    await stop();
  }
  if (selected('output-cap')) {
    const file = join(evidence, 'output-cap.jsonl'), queries = () => records().filter(row => row.type === 'query');
    await start(file);
    assert.equal((await send('first')).stopReason, 'stop');
    assert.equal(queries().at(-1).outputCap, '128000', 'New sessions default to the model output cap.');
    assert.equal(queries().at(-1).resumed, false);
    await stop();
    // Rewrite the checkpoint with the fingerprint a pre-128k bridge saved: the same inputs with the 16k default cap.
    const rows = entries(), messages = rows.map(row => row.message).filter(Boolean);
    const checkpoint = rows.findLast(row => row.customType === 'claude-sdk-checkpoint');
    checkpoint.data.configuration = createHash('sha256').update(JSON.stringify({ cwd: project, sessionId: rows[0].id,
      systemPrompt: getCurrentSystemPrompt(messages), tools: getCurrentTools(messages), maxTokens: 16000,
      sdkSystemPrompt: queries().at(-1).sdkSystemPrompt })).digest('hex');
    writeFileSync(file, rows.map(row => JSON.stringify(row)).join('\n') + '\n');
    await start(file);
    const resumed = await send('second');
    assert.equal(resumed.stopReason, 'stop', resumed.errorMessage);
    assert.equal(queries().at(-1).resumed, true, 'An old 16k-fingerprint checkpoint must resume its native session.');
    assert.equal(queries().at(-1).outputCap, '128000');
    console.log('pass output-cap');
    await stop();
  }
} finally {
  if (worker) writeFileSync(join(evidence, 'rpc-stderr.log'), worker.stderr);
  await worker?.close();
}
