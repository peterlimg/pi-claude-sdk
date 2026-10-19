// E2E: load the actual package in isolated Pi RPC without an SDK query or credentials.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { RpcWorker } from './rpc.mjs';

const scratch = mkdtempSync(join(tmpdir(), 'pi-sdk-discovery-'));
for (const directory of ['agent', 'claude', 'project']) mkdirSync(join(scratch, directory));
Object.assign(process.env, { PI_CODING_AGENT_DIR: join(scratch, 'agent'), CLAUDE_CONFIG_DIR: join(scratch, 'claude'), PI_OFFLINE: '1', PI_TELEMETRY: '0' });
const session = join(scratch, 'session.jsonl'), project = join(scratch, 'project');
writeFileSync(session, JSON.stringify({ type: 'session', version: 3, id: randomUUID(), timestamp: new Date().toISOString(), cwd: project }) + '\n');
const cli = process.env.PI_SDK_TEST_PI || fileURLToPath(new URL('./bundle/cli.js', import.meta.resolve('@earendil-works/pi-coding-agent')));
const worker = new RpcWorker(session, project, { bin: process.execPath, prefix: [cli, '-ne', '-ns', '-np', '-nc', '--no-mcp',
  '-e', process.env.PI_SDK_TEST_PACKAGE || fileURLToPath(new URL('..', import.meta.url)),
  '-e', fileURLToPath(new URL('./fixtures/discovery.ts', import.meta.url))] });
try {
  const { entries } = await worker.request('get_entries');
  assert.deepEqual(entries.find(entry => entry.customType === 'sdk-package-models')?.data,
    ['claude-haiku-5-5', 'claude-opus-5-5', 'claude-sonnet-5-5'], worker.stderr);
  const { models } = await worker.request('get_available_models');
  assert.equal(models.filter(model => model.provider === 'claude-sdk').length, 0, 'Registration must not require fake credentials.');
  const { commands } = await worker.request('get_commands');
  for (const name of ['sdk-recover', 'claude-usage']) assert(commands.some(command => command.name === name && command.source === 'extension'));
  await assert.rejects(worker.request('set_model', { provider: 'claude-sdk', modelId: 'does-not-exist' }), /not found/i);
  assert.equal((await worker.request('get_state')).isStreaming, false);
  console.log('Package discovery passed: three SDK models, both commands, RPC rejection and no inference.');
} finally { await worker.close(); }
