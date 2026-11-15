// Real Pi RPC, default summarizer and SDK extension; only the external providers are replayed.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { RpcWorker } from './rpc.mjs';

const evidence = mkdtempSync(join(tmpdir(), 'pi-sdk-foreign-compaction-')), project = join(evidence, 'project');
for (const path of [project, join(project, '.pi'), join(evidence, 'agent'), join(evidence, 'claude')]) mkdirSync(path);
Object.assign(process.env, { PI_CODING_AGENT_DIR: join(evidence, 'agent'), CLAUDE_CONFIG_DIR: join(evidence, 'claude'),
  PI_OFFLINE: '1', PI_TELEMETRY: '0', PI_RECOVERY_EVENTS: join(evidence, 'events.jsonl'), PI_RECOVERY_MARKER: 'PI_COMPACTION_' + randomUUID() });
writeFileSync(join(project, 'AGENTS.md'), 'Preserve recorded tool outcomes. Never repeat historical effects.');
writeFileSync(join(project, '.pi/settings.json'), JSON.stringify({ compaction: { enabled: false, keepRecentTokens: 0 }, retry: { enabled: false } }));
const cli = process.env.PI_SDK_TEST_PI || fileURLToPath(new URL('./bundle/cli.js', import.meta.resolve('@earendil-works/pi-coding-agent')));
const entries = () => readFileSync(process.env.PI_RECOVERY_SESSION, 'utf8').trim().split('\n').map(JSON.parse);
const save = rows => {
  let parentId = null;
  writeFileSync(process.env.PI_RECOVERY_SESSION, rows.map(row => {
    if (row.type !== 'session') { row = { ...row, parentId }; parentId = row.id; }
    return JSON.stringify(row);
  }).join('\n') + '\n');
};
const records = () => existsSync(process.env.PI_RECOVERY_EVENTS) ? readFileSync(process.env.PI_RECOVERY_EVENTS, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse) : [];
const last = () => entries().findLast(row => row.message?.role === 'assistant')?.message;
let worker, settled = 0;
async function until(check, label) {
  const end = Date.now() + 12000;
  while (!check()) { if (Date.now() > end) throw new Error('Timed out: ' + label); await delay(20); }
}
async function start() {
  worker = new RpcWorker(process.env.PI_RECOVERY_SESSION, project, { bin: process.execPath, prefix: [cli, '--approve', '-ne', '-ns', '-np', '--no-mcp', '--tools', 'probe',
    '-e', fileURLToPath(new URL('./fixtures/recovery.ts', import.meta.url))] });
  worker.on('event', event => { if (event.type === 'agent_settled') settled++; });
  await worker.request('get_state');
}
const select = provider => worker.request('set_model', { provider, modelId: provider === 'claude-sdk' ? 'claude-haiku-5-5' : 'plain' });
async function send(message, expected = 'stop') {
  const before = settled; await worker.request('prompt', { message }); await until(() => settled > before, 'turn settlement');
  assert.equal(last().stopReason, expected, last().errorMessage || `Expected ${expected}, received ${last().stopReason}`); return last();
}
const compact = () => worker.request('compact', { customInstructions: 'Preserve the marker and recorded tool results, including errors. Never repeat completed work.' });
const result = { cases: [], pass: false };
console.log('Evidence: ' + evidence);
try {
  for (const mode of process.argv.slice(2).length ? process.argv.slice(2) : ['foreign-rate-limit', 'foreign-no-checkpoint', 'foreign-missing-result', 'foreign-receipt-gap', 'foreign-error', 'foreign-stop', 'sdk-rate-limit']) {
    result.stage = mode; process.env.PI_RECOVERY_COMPACTION = mode;
    process.env.PI_RECOVERY_SESSION = join(evidence, mode + '.jsonl');
    save([{ type: 'session', version: 3, id: randomUUID(), timestamp: new Date().toISOString(), cwd: project }]);
    const offset = records().length, current = () => records().slice(offset), queries = () => current().filter(row => row.type === 'query').length;
    await start(); await select('claude-sdk'); await send('seed');
    await send('compaction-rate-limit', 'error');
    assert.match(last().errorMessage, /rate_limit/);
    const checkpoint = entries().findLast(row => row.customType === 'claude-sdk-checkpoint');
    assert(checkpoint); assert(entries().indexOf(checkpoint) < entries().findLastIndex(row => row.message?.stopReason === 'error'));
    if (['foreign-no-checkpoint', 'foreign-missing-result'].includes(mode)) {
      await worker.close(); worker = undefined;
      const rows = entries();
      save(mode === 'foreign-no-checkpoint' ? rows.filter(row => row.customType !== 'claude-sdk-checkpoint')
        : rows.filter(row => row.id !== rows.findLast(entry => entry.message?.role === 'toolResult').id));
      await start();
    }
    if (mode !== 'sdk-rate-limit') await select('recovery-control');
    const before = readFileSync(process.env.PI_RECOVERY_SESSION, 'utf8'), count = queries();
    if (['foreign-missing-result', 'sdk-rate-limit'].includes(mode)) {
      await assert.rejects(compact(), /cancelled/i);
      assert.equal(readFileSync(process.env.PI_RECOVERY_SESSION, 'utf8'), before);
      assert.equal(queries(), count);
      assert(!current().some(row => row.type === 'control-compaction'));
      result.cases.push({ mode, pass: true, blockedBeforeSummary: true });
    } else if (['foreign-error', 'foreign-stop'].includes(mode)) {
      if (mode === 'foreign-error') await assert.rejects(compact(), /summary failure/i);
      else {
        const pending = compact().then(() => undefined, error => error);
        await until(() => current().some(row => row.type === 'control-compaction'), 'foreign summarizer started');
        await worker.request('abort'); assert(await pending instanceof Error);
      }
      assert.equal(readFileSync(process.env.PI_RECOVERY_SESSION, 'utf8'), before, 'Failed summary must not invalidate prior state');
      assert.equal(queries(), count);
      await worker.close(); worker = undefined; await start();
      // The pre-existing SDK retry path still works when no compaction was committed.
      await select('claude-sdk'); await send('recall without replay');
      assert.deepEqual(current().filter(row => row.type === 'execution').map(row => row.label), ['seed', 'before-rate-limit']);
      result.cases.push({ mode, pass: true, originalStatePreserved: true });
    } else {
      await compact();
      assert(readFileSync(process.env.PI_RECOVERY_SESSION, 'utf8').startsWith(before), 'Original audit must remain unchanged');
      assert.equal(queries(), count, 'Foreign summary must not call SDK');
      assert(current().some(row => row.type === 'control-compaction' && row.marker));
      const summary = entries().findLast(row => row.type === 'compaction');
      assert(summary?.summary.includes(process.env.PI_RECOVERY_MARKER));
      const receipt = entries().findLast(row => row.customType === 'claude-sdk-compaction');
      assert.equal(receipt?.data.entryId, summary.id); assert.equal(receipt.data.state, null, 'SDK resume must be fenced');
      await select('claude-sdk');
      assert.match((await send('recall before restart', 'error')).errorMessage, /Invalid SDK compaction checkpoint/);
      assert.equal(queries(), count, 'The live process must also refuse unvalidated SDK continuation');
      await select('recovery-control');
      await worker.close(); worker = undefined;
      // Emulate a process loss after Pi saved the summary but before the receipt write.
      if (mode === 'foreign-receipt-gap') save(entries().slice(0, entries().findIndex(row => row.id === receipt.id)));
      await start();
      for (let attempt = 0; attempt < 2; attempt++) {
        await select('claude-sdk');
        assert.match((await send('recall without replay', 'error')).errorMessage, /Invalid SDK compaction checkpoint/);
        assert.equal(queries(), count, 'No SDK query may open from a foreign-only summary');
        await select('recovery-control'); await send('continue with the selected model');
        await compact(); // A blocked SDK resume must not poison later foreign compaction.
        await worker.close(); worker = undefined; await start();
      }
      assert.deepEqual(current().filter(row => row.type === 'execution').map(row => row.label), ['seed', 'before-rate-limit', 'foreign', 'foreign']);
      result.cases.push({ mode, pass: true, auditPreserved: true, noReplay: true, foreignContinuation: true, sdkBlockedAfterRestart: true });
    }
    await worker.close(); worker = undefined;
  }
  result.pass = true;
} catch (error) { result.error = error.message; throw error; }
finally {
  if (worker) writeFileSync(join(evidence, 'rpc-stderr.log'), worker.stderr);
  await worker?.close(); writeFileSync(join(evidence, 'result.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify({ ...result, evidence }, null, 2));
}
