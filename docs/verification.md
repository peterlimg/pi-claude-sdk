# Verification and source provenance

## Source boundary

The adapter was exported from [Pi Remote at `607f786dd5da2dd247401c18fc99146cab3a9ad8`](https://github.com/peterlimg/pi-remote/tree/607f786dd5da2dd247401c18fc99146cab3a9ad8/experiments/claude-sdk-provider), on October 19, 2026. `index.ts` and `bridge.ts` are byte-for-byte copies, including the `claude-sdk` provider ID, checkpoint formats, permissions, prompt/configuration guards and pinned SDK 0.3.296 dependency.

| File | SHA-256 at export |
| --- | --- |
| `index.ts` | `8db9a0f586c6602a16ad9fe16745525a1862a10a296401bf1ce9278f851ae1cb` |
| `bridge.ts` | `f3c937a8b393ce9515878a807dda9d89d87479a0057edd43636b3cb483fd2101` |

At export, the ten credential-free E2E drivers and their SDK replay fixture came from the same snapshot, with unchanged assertions and imports resolved within this repository. Subsequent failure-recovery changes extend that snapshot as described below. `test/rpc.mjs` is a small, bounded LF-only transport for owned fixture processes, including raw extension dialogs and explicit process-crash checks. It does not import Pi Remote. It is not a replacement for a production RPC client. `test/discovery.mjs` separately loads the actual package and enumerates its registered models and commands without inference. A read-only fixture inspects Pi's public registered catalog; the RPC available-model list is credential-filtered and must stay empty for SDK models in this logged-out test.

Only adapter source, synthetic test source, dependency metadata and documentation were exported. No native transcripts, personal settings, credentials, browser evidence, raw sessions or Pi Remote server code are included. The existing local installation is not switched by this export.

Pi Remote retains its original snapshot for current installations and integration tests. Historical source links stay pinned to their original commits. Avoid changing both runtime copies independently; migration of Pi Remote's installed provider is a separate, verified operation.

## Credential-free checks

```sh
npm ci --ignore-scripts
npm run check
npm run test:discovery
npm run test:prompt
npm run test:recovery
npm run test:retry
# Or select cases rather than rerunning every scenario:
npm run test:tree -- selected-history receipt-gap
```

These tests use actual Pi RPC, persistence, the adapter, MCP and tool execution. Only the external SDK peer is replayed. Scratch resources and workers belong to the test. No live Claude request or authentication workaround is involved. Test artifacts are written to temporary directories, not this repository.

`npm test` runs all exported E2Es. CI runs them on Pi 1.2.0 and 1.3.0 with Node 24. This describes the configured checks, not an observed CI result. Local validation should target the affected behavior rather than routinely running the entire suite.

## Failure-recovery contract

`test/retry.mjs` drives actual Pi retries, persisted messages, checkpoints, worker restarts and MCP tool effects. The replay SDK injects a server error or dropped connection after a tool completes. Cases cover bounded automatic retries, exhausted retries followed by a new message, repeated usage denials followed by restored access, older guard errors, worker restarts, tool changes or order-only generated-guidance changes during recovery, and refusals for missing results or an edited checkpoint prefix. A missing result stays blocked even when tools also change. The order-only case reproduces a second tool handoff discarding an already-validated failure-recovery handoff; recovery now consumes that tool change when rebuilding the native context. Every successful recovery checks that the completed tool ran once, the new context has its own usage baseline, and its checkpoint survives reopening. Original unknown-error assertions in the Stop, notices and recovery journeys now expect a fresh context when receipts are complete; their missing-result guards remain.

These are credential-free replay checks, not evidence of upstream availability, billing reset times, physical-phone behavior or exactly-once execution by a model. Recorded tools are imported as data and their IDs remain protected against reuse. Incomplete or altered history still fails before another SDK request.

## Export validation

Local checks passed on Pi 1.2.0 and 1.3.0. The new RPC driver ran without Pi Remote's worker flag or server code. Strict TypeScript and JavaScript syntax checks passed.

| Check | Cases run on each Pi version |
| --- | --- |
| Actual package discovery | Registered catalog, extension commands, failed RPC response, no SDK inference |
| Recovery | Complete existing recovery journey, including dialogs, owned-worker crash/restart, images, history/configuration negatives and normal permissions |
| Prompt projection | All 10 inherited-prompt cases |
| Malformed arguments | `local`, `early`, `missing` |
| Stop | `first`, `restart`, `missing-result` |
| Tool handoff | `first`, `reorder`, `permission`, `validation`, `missing-result` |
| Notices | `live`, `restart`, `unknown-error` |
| Compaction | `manual`, `checkpoint-gap`, `receipt-gap` |
| Clone | `independent`, `checkpoint-gap`, `missing-result` |
| Fork | `selected-history`, `queued`, `split-batch` |
| Tree | `selected-history`, `summary`, `receipt-gap` |

That is 36 enumerated cases plus discovery and the recovery journey on each version, not the entire suite or live-model acceptance. The initial discovery assertion incorrectly treated the credential-filtered available list as the registered catalog. It was corrected to observe the public registered catalog without adding fake credentials; the runtime was not changed.

A clean Pi 1.3 project also installed `git:github.com/peterlimg/pi-claude-sdk@v0.1.0` through the normal Pi package command. The installed package autoloaded all three models and both commands with runtime dependencies only, no bundled Pi host peers and no SDK inference. Anonymous downloads of the tagged runtime matched the source hashes. Existing personal settings and the original workspace/installed provider files remained unchanged.

## Live behavior and remaining limits

Shared real-provider, phone and host checks stay in Pi Remote. Exporting the code does not rerun those journeys or establish full provider parity. See the [shared acceptance contract](https://github.com/peterlimg/pi-remote/blob/607f786dd5da2dd247401c18fc99146cab3a9ad8/docs/provider-parity.md).

Historical reviewed evidence distinguishes focused passes, failed diagnostics and skipped rows:

- [Inherited delegate prompts](https://github.com/peterlimg/pi-remote/blob/607f786dd5da2dd247401c18fc99146cab3a9ad8/experiments/claude-sdk-provider/verification-inherited.json)
- [Retained-worker investigation](https://github.com/peterlimg/pi-remote/blob/607f786dd5da2dd247401c18fc99146cab3a9ad8/experiments/claude-sdk-provider/verification-worker-continuation.json)
- [Compaction](https://github.com/peterlimg/pi-remote/blob/607f786dd5da2dd247401c18fc99146cab3a9ad8/experiments/claude-sdk-provider/verification-compaction-context.json), [clone](https://github.com/peterlimg/pi-remote/blob/607f786dd5da2dd247401c18fc99146cab3a9ad8/experiments/claude-sdk-provider/verification-clone.json), [fork](https://github.com/peterlimg/pi-remote/blob/607f786dd5da2dd247401c18fc99146cab3a9ad8/experiments/claude-sdk-provider/verification-fork.json) and [tree](https://github.com/peterlimg/pi-remote/blob/607f786dd5da2dd247401c18fc99146cab3a9ad8/experiments/claude-sdk-provider/verification-tree.json)

The [canonical gap tracker](https://github.com/peterlimg/pi-remote/blob/main/docs/provider-gaps.md) remains in Pi Remote. Keep its SDK-3 retained-worker and SDK-6 forced-foreground limitations explicit. Native SDK automatic/idle compaction stays disabled. Broader combinations, physical Safari, stress and complete live-model parity are not established by this export.
