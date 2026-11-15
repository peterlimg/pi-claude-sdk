---
name: verify-foreign-compaction
description: Verify cross-provider compaction after SDK failures, tool-result completeness, SDK resume fencing, cancellation and restart publication gaps.
---

# Verify foreign-model compaction

Run from the pi-claude-sdk repository root:

```sh
npm run verify:compaction
npm run verify:compaction -- --self-test
```

TLC 1.7.4 is pinned by SHA-256 in verification/tlc.mjs. It uses Java 11+ from JAVA, PATH or mise Temurin 21. The first run downloads the pinned jar unless TLA2TOOLS names it. Node and the repository's installed dependencies are required. PI_SDK_TEST_PI can select an installed Pi CLI; otherwise the replay uses the local dependency's CLI.

The runner prints a private evidence directory with TLC logs, configs, replay logs and result.json. Exit zero means every check passed. Inspect failures rather than weakening an invariant.

## Promises

| Property | Promise | Harm if broken |
| --- | --- | --- |
| ForeignCanCompact | Complete Pi tool history can be summarized by another provider even without an SDK checkpoint. | A failed SDK turn traps a usable conversation at its context limit. |
| MissingResultsBlock | Foreign-only compaction does not discard unresolved tool calls. | A summary can hide unknown effects and encourage repeating work. |
| SDKNeedsReceipt | A saved summary without validated SDK handoff cannot open an SDK request. | Summarization silently approves interrupted SDK work. |
| FailurePreservesState | Failed or cancelled summarization changes no saved history or SDK receipt. | A failed attempt damages an otherwise recoverable conversation. |

Read every model result with **/statechart**, using scratch copies of verification/compaction/ForeignCompaction.tla, .cfg and .view.mjs. Review shortest counterexamples in the reader's words. The chart hides model switching during summarization and unchanged-state steps; the captured compaction plan does not change with the selected model.

## Source map and synchronization

The reviewed source commit and exact source hashes are in verification/compaction/coverage.json. The runner rejects source drift. Advance that record only after reviewing the changed functions, updating the model and replay, and running the negative controls.

- index.ts session_before_compact: normal SDK validation first, then foreign-only validation; no durable writes during preparation.
- bridge.ts validateForeignCompaction/historyContent: all visible calls must have matching results. SDK checkpoint approval and Pi transcript completeness are separate.
- index.ts session_compact: the foreign plan writes the existing null SDK compaction receipt and discards old in-memory checkpoint/recovery state.
- index.ts readBranch/loadBranch/restore: a saved Pi compaction without its matching receipt also blocks SDK after restart.
- bridge.ts streamSimple: invalid compaction state fails before opening an external SDK query.
- Pi AgentSession.compact: summary runs between the preparation hook and appendCompaction; cancellation/failure appends no compaction; session_compact runs after the Pi entry is saved.

Preparation and receipt publication are synchronous extension handlers. Pi's summary append and extension receipt append are separate persistence steps. Restart is allowed between them; the model must not merge them into one atomic operation.

## Real-code checks and negative controls

test/foreign-compaction.mjs uses actual Pi RPC, default compaction, the provider bridge, MCP and a counted tool. Only the external SDK and foreign model outputs are replayed. It executes a tool, emits an SDK rate-limit failure, switches model, compacts, restarts, attempts SDK continuation, continues with the foreign model and compacts again. It also covers missing checkpoints/results, summary error/Stop and a saved-summary/missing-receipt restart.

Self-test makes four isolated source copies, never edits production files, and removes one guard per copy. Each matching TLC invariant and E2E must fail: foreign admission, missing-result rejection, SDK receipt gate, and no premature receipt. The unmodified model and full focused replay must pass afterwards. This is sensitivity evidence, not proof against every mutation.

Also run the existing manual, compact-away, receipt-gap and null-config modes in test/compaction-context.mjs when these boundaries change. Valid SDK handoffs must continue working.

## Bounds and exclusions

The model starts after SDK handoff validation has failed. It explores one compaction, two provider selections, complete/missing results, summary failure or Stop, one process restart and SDK request attempts. Healthy SDK handoffs have additional history guards and are covered by the existing E2E, not this model. Repeated compaction is exercised by E2E, not the model. Disk writes are assumed to preserve complete JSONL entries; power loss, partial writes, arbitrary concurrent extensions, automatic overflow repair, borrowed children, branch navigation and multiple compactions in flight are not modeled.

The model abstracts transcript validation as complete/missing and valid/invalid booleans. It does not prove the parser, arbitrary tool effects, model summary accuracy or absence of later model-chosen duplicate work. E2E checks specific tool identities, unchanged audit records and no replay. It does not call paid models or prove physical Safari behavior.

A null receipt intentionally prevents Claude SDK use in this compacted chat; non-SDK models remain usable. Missing tool results still require explicit investigation/recovery. Never synthesize successful tool outcomes or bypass SDK validation to make the check pass.

Use /maintain-formal-verification-skill after covered code changes without rechecking this model.
