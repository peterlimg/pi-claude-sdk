// E2E: real Pi retry policy, RPC, persistence, provider and MCP; only the SDK is replayed.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { RpcWorker } from './rpc.mjs';

const evidence = mkdtempSync(join(tmpdir(), 'pi-sdk-retry-e2e-'));
const cli = process.env.PI_SDK_TEST_PI || fileURLToPath(new URL('./bundle/cli.js', import.meta.resolve('@earendil-works/pi-coding-agent')));
const settings = join(homedir(), '.pi/agent/settings.json');
const settingsHash = () => existsSync(settings) ? createHash('sha256').update(readFileSync(settings)).digest('hex') : undefined;
const beforeSettings = settingsHash();
Object.assign(process.env, { PI_OFFLINE: '1', PI_TELEMETRY: '0', PI_RECOVERY_MARKER: 'RETRY_' + randomUUID() });
const records = () => existsSync(process.env.PI_RECOVERY_EVENTS) ? readFileSync(process.env.PI_RECOVERY_EVENTS, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse) : [];
const entries = () => readFileSync(process.env.PI_RECOVERY_SESSION, 'utf8').trim().split('\n').map(JSON.parse);
const last = () => entries().findLast(row => row.message?.role === 'assistant')?.message;
const queries = () => records().filter(row => row.type === 'query');
const effects = () => records().filter(row => row.type === 'execution').map(row => row.label);
const result = { fixture: 'real Pi RPC, retries, provider, MCP and tool effects; external SDK replay, no model calls',
  piVersion: execFileSync(process.execPath, [cli, '--version'], { encoding: 'utf8' }).trim(), cases: [], pass: false };
let worker, settled = 0, project, activeTools;
const retryEvents = [], dialogs = [];
async function start() {
  worker = new RpcWorker(process.env.PI_RECOVERY_SESSION, project, { bin: process.execPath, prefix: [cli, '-ne', '-ns', '-np', '-nc', '--no-mcp', '--tools', activeTools,
    '-e', fileURLToPath(new URL('./fixtures/recovery.ts', import.meta.url)), '--model', 'claude-sdk/claude-haiku-5-5', '--thinking', 'high'] });
  worker.on('event', event => {
    if (event.type === 'agent_settled') settled++;
    if (event.type === 'auto_retry_start') retryEvents.push(event);
    if (event.type === 'extension_ui_request' && event.method === 'confirm') dialogs.push(event);
  });
  await worker.request('get_state');
}
async function send(message) {
  const before = settled;
  await worker.request('prompt', { message });
  const deadline = Date.now() + 12000;
  while (settled === before) {
    assert.equal(dialogs.length, 0, 'Complete tool receipts must not require recovery confirmation');
    if (Date.now() > deadline) throw new Error('Turn did not settle');
    await delay(20);
  }
  return last();
}
console.log('Evidence: ' + evidence);
try {
  for (const mode of process.argv.slice(2).length ? process.argv.slice(2) : ['first', 'server', 'network', 'exhausted', 'usage', 'restart', 'old-guard', 'tool-update', 'tool-reorder', 'tool-update-missing-result', 'missing-result', 'changed-prefix']) {
    result.stage = mode; activeTools = mode === 'tool-reorder' ? 'probe,extra' : 'probe';
    const dir = join(evidence, mode); project = join(dir, 'project');
    for (const path of [project, join(dir, 'agent'), join(dir, 'claude'), join(project, '.pi')]) mkdirSync(path, { recursive: true });
    Object.assign(process.env, { PI_CODING_AGENT_DIR: join(dir, 'agent'), CLAUDE_CONFIG_DIR: join(dir, 'claude'),
      PI_RECOVERY_EVENTS: join(dir, 'events.jsonl'), PI_RECOVERY_SESSION: join(dir, 'session.jsonl'), PI_RECOVERY_RETRY_CASE: mode,
      PI_RECOVERY_RETRY_FAILURES: mode === 'exhausted' ? '3' : mode === 'usage' ? '2' : '1',
      PI_RECOVERY_DYNAMIC: mode.startsWith('tool-') ? '1' : '0',
      PI_RECOVERY_TOOL_CASE: mode === 'tool-reorder' ? 'reorder' : '', PI_RECOVERY_REORDER: '0' });
    writeFileSync(join(project, '.pi/settings.json'), JSON.stringify({ compaction: { enabled: false },
      retry: { enabled: ['first', 'server', 'network', 'exhausted'].includes(mode), maxRetries: 2, baseDelayMs: 5 } }));
    writeFileSync(process.env.PI_RECOVERY_SESSION, JSON.stringify({ type: 'session', version: 3, id: randomUUID(), timestamp: new Date().toISOString(), cwd: project }) + '\n');
    retryEvents.length = dialogs.length = 0;
    await start();
    const seeded = mode !== 'first', expectedEffects = [...seeded ? ['seed'] : [], 'retry-completed'];
    if (seeded) assert.equal((await send('seed')).stopReason, 'stop');
    let response = await send('sdk-fail');
    if (['first', 'server', 'network'].includes(mode)) {
      assert.equal(response.stopReason, 'stop', response.errorMessage);
      assert.deepEqual(retryEvents.map(event => event.attempt), [1]);
    } else {
      assert.equal(response.stopReason, 'error');
      assert.doesNotMatch(response.errorMessage, /SYNTHETIC_PRIVATE_DETAIL/);
      assert.deepEqual(retryEvents.map(event => event.attempt), mode === 'exhausted' ? [1, 2] : []);
      if (mode === 'usage') {
        assert.equal(queries().length, 1, 'Usage denial must not start an automatic retry loop');
        assert.equal((await send('sdk-fail')).stopReason, 'error');
        assert.equal(queries().length, 2, 'Another usage denial must still leave the conversation recoverable');
      }
      if (['restart', 'old-guard', 'tool-update', 'tool-reorder', 'tool-update-missing-result', 'missing-result', 'changed-prefix'].includes(mode)) {
        await worker.close(); worker = undefined;
        const rows = entries();
        if (mode === 'old-guard') {
          const append = message => rows.push({ type: 'message', id: randomUUID(), parentId: rows.at(-1).id, timestamp: new Date().toISOString(), message });
          append({ role: 'user', content: 'An earlier retry was rejected.', timestamp: Date.now() });
          const errorMessage = 'Cannot recover uncheckpointed SDK responses or interrupted SDK tools.';
          append({ ...last(), errorMessage, content: [{ type: 'text', text: errorMessage }] });
        }
        if (mode.endsWith('missing-result')) rows.splice(rows.findLastIndex(row => row.message?.role === 'toolResult'), 1);
        if (mode === 'changed-prefix') rows.find(row => row.message?.role === 'user').message.content[0].text = 'CHANGED';
        if (mode.startsWith('tool-')) { activeTools = 'probe,extra'; process.env.PI_RECOVERY_TOOL_CASE = 'reorder'; process.env.PI_RECOVERY_REORDER = '1'; }
        if (mode !== 'restart' && !['tool-update', 'tool-reorder'].includes(mode)) {
          let parentId = null;
          for (const row of rows) if (row.type !== 'session') { row.parentId = parentId; parentId = row.id; }
          writeFileSync(process.env.PI_RECOVERY_SESSION, rows.map(row => JSON.stringify(row)).join('\n') + '\n');
        }
        await start();
      }
      const count = queries().length;
      response = await send('sdk-fail');
      if (mode.endsWith('missing-result') || mode === 'changed-prefix') {
        assert.equal(response.stopReason, 'error');
        assert.equal(queries().length, count, 'Unsafe history must fail before SDK startup');
      } else assert.equal(response.stopReason, 'stop', response.errorMessage);
    }
    assert.deepEqual(effects(), expectedEffects, 'Completed tools must execute exactly once');
    assert.equal(dialogs.length, 0);
    if (response.stopReason === 'stop') {
      const latest = queries().at(-1);
      assert.equal(latest.resumed, false); assert.equal(latest.resumedAt, false);
      assert.notEqual(latest.session, queries()[0].session);
      assert.equal(response.usage.input, 100, 'Replacement contexts must reset their usage baseline');
      assert(records().some(row => row.type === 'prompt' && row.failed && row.marker === seeded && !row.unknown));
      const count = queries().length;
      assert.equal((await send('followup')).stopReason, 'stop');
      assert.equal(queries().length, count, 'The recovered native query must support ordinary follow-ups');
      await worker.close(); worker = undefined; await start();
      assert.equal((await send('followup after restart')).stopReason, 'stop');
      assert.equal(queries().at(-1).resumed, true);
      assert.equal(queries().at(-1).session, latest.session);
      assert.deepEqual(effects(), expectedEffects);
    }
    result.cases.push({ mode, pass: true, retries: retryEvents.length, noToolReplay: true, blocked: response.stopReason === 'error' });
    await worker.close(); worker = undefined;
  }
  result.pass = true;
} catch (error) { result.error = error.message; throw error; }
finally {
  if (worker) writeFileSync(join(evidence, 'rpc-stderr.log'), worker.stderr);
  await worker?.close(); result.personalSettingsUnchanged = settingsHash() === beforeSettings;
  writeFileSync(join(evidence, 'result.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify({ ...result, evidencePath: evidence }, null, 2));
}
