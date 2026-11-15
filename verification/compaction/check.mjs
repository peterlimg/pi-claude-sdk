import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { javaBinary, toolsJar, version } from '../tlc.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const evidence = mkdtempSync(join(tmpdir(), 'pi-foreign-compaction-formal-'));
const read = path => readFileSync(join(root, path), 'utf8');
const sha = value => createHash('sha256').update(value).digest('hex');
const coverage = JSON.parse(read('verification/compaction/coverage.json'));
const variants = [
  { property: 'ForeignCanCompact', constant: 'AllowForeign', file: 'index.ts', mode: 'foreign-rate-limit',
    from: 'if (ctx.model?.provider && ctx.model.provider !== providerId) {', to: 'if (false) {' },
  { property: 'MissingResultsBlock', constant: 'CheckResults', file: 'bridge.ts', mode: 'foreign-missing-result',
    from: "{ handoff: 'compaction', trustedPrefix: history.length, completedPrefix: 0 }",
    to: "{ handoff: 'compaction', trustedPrefix: history.length, completedPrefix: history.length }" },
  { property: 'SDKNeedsReceipt', constant: 'FenceSDK', file: 'bridge.ts', mode: 'foreign-rate-limit',
    from: "        if (state.compaction !== undefined && !compacted) fail('Invalid SDK compaction checkpoint.');",
    to: '        // Negative control: accept an unvalidated compaction.' },
  { property: 'FailurePreservesState', constant: 'PreserveOnFailure', file: 'index.ts', mode: 'foreign-error',
    from: "          compacting = 'foreign';",
    to: "          pi.appendEntry('claude-sdk-compaction', { entryId: 'premature', state: null });\n          compacting = 'foreign';" },
];
const result = { tlc: version, sourceCommit: coverage.sourceCommit, cases: [], pass: false, evidence };
console.log('Evidence: ' + evidence);
function run(bin, args, cwd, label, timeout = 180000) {
  const output = spawnSync(bin, args, { cwd, encoding: 'utf8', timeout, maxBuffer: 16 * 1024 * 1024 });
  writeFileSync(join(evidence, label + '.log'), (output.stdout || '') + (output.stderr || ''));
  if (output.error || output.signal) throw output.error || new Error(label + ' terminated by ' + output.signal);
  return { status: output.status, text: (output.stdout || '') + (output.stderr || '') };
}
function unchanged() {
  for (const [path, hash] of Object.entries(coverage.sha256)) assert.equal(sha(read(path)), hash, 'Source drift: review model and E2E before updating coverage for ' + path);
}
function replaceOnce(source, from, to) {
  assert.equal(source.split(from).length, 2, 'Mutation must match exactly once: ' + from);
  return source.replace(from, to);
}
try {
  unchanged();
  assert.equal(run('git', ['cat-file', '-t', coverage.sourceCommit], root, 'source-commit').text.trim(), 'commit');
  const jar = await toolsJar(), java = javaBinary();
  function model(label, variant) {
    const dir = join(evidence, label); mkdirSync(dir);
    writeFileSync(join(dir, 'ForeignCompaction.tla'), read('verification/compaction/ForeignCompaction.tla'));
    let config = read('verification/compaction/ForeignCompaction.cfg');
    if (variant) config = replaceOnce(config, variant.constant + ' = TRUE', variant.constant + ' = FALSE');
    writeFileSync(join(dir, 'ForeignCompaction.cfg'), config);
    const output = run(java, ['-XX:+UseParallelGC', '-Xmx512m', '-cp', jar, 'tlc2.TLC', '-workers', '1', '-fp', '0', '-config', 'ForeignCompaction.cfg', 'ForeignCompaction.tla'], dir, label);
    if (variant) assert.match(output.text, new RegExp('Invariant ' + variant.property + ' is violated'), label);
    else { assert.equal(output.status, 0, output.text); assert.match(output.text, /Model checking completed. No error has been found/); }
    return output.text.match(/\d+ states generated, \d+ distinct states found[^\n]*/)?.[0];
  }
  const states = model('normal');
  const replay = run(process.execPath, ['test/foreign-compaction.mjs'], root, 'normal-replay');
  assert.equal(replay.status, 0, replay.text);
  result.cases.push({ mode: 'normal', pass: true, states });
  if (process.argv.includes('--self-test')) {
    for (const variant of variants) {
      model('broken-' + variant.property, variant);
      const copy = join(evidence, 'runtime-' + variant.property); mkdirSync(copy);
      for (const path of ['index.ts', 'bridge.ts', 'package.json', 'test/rpc.mjs', 'test/foreign-compaction.mjs', 'test/fixtures/recovery.ts']) {
        mkdirSync(dirname(join(copy, path)), { recursive: true }); cpSync(join(root, path), join(copy, path));
      }
      symlinkSync(resolve(root, 'node_modules'), join(copy, 'node_modules'), 'dir');
      writeFileSync(join(copy, variant.file), replaceOnce(read(variant.file), variant.from, variant.to));
      const broken = run(process.execPath, ['test/foreign-compaction.mjs', variant.mode], copy, 'broken-replay-' + variant.property);
      assert.notEqual(broken.status, 0, 'E2E missed ' + variant.property);
      assert.match(broken.text, /AssertionError|Compaction cancelled/, 'Failure must be the targeted assertion, not a setup error');
      result.cases.push({ property: variant.property, modelCaughtMutation: true, runtimeCaughtMutation: true });
    }
    unchanged();
    model('restored');
    const restored = run(process.execPath, ['test/foreign-compaction.mjs'], root, 'restored-replay');
    assert.equal(restored.status, 0, restored.text);
    result.restored = true;
  }
  unchanged(); result.pass = true;
} catch (error) { result.error = error.message; process.exitCode = 1; }
finally { writeFileSync(join(evidence, 'result.json'), JSON.stringify(result, null, 2)); console.log(JSON.stringify(result, null, 2)); }
