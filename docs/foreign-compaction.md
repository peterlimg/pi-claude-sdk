# Compaction after switching providers

Pi can summarize a chat with the selected non-SDK model even when an earlier Claude SDK turn has no completed checkpoint.

```text
SDK handoff validation succeeds -> normal summary + validated SDK receipt
SDK validation fails
  -> SDK still selected: block
  -> another provider selected: validate Pi tool call/result pairs
      -> incomplete: block without changing history
      -> complete: Pi summarizes with the selected model
          -> failure or Stop: leave history unchanged
          -> success: save summary + null SDK receipt
              -> non-SDK continuation works
              -> SDK continuation stays blocked, including after restart
```

A summary is not approval to resume an interrupted SDK conversation. The null receipt uses the existing fail-closed compaction state. Pi's saved compaction also blocks SDK if the process stops before the receipt is appended. Original messages, error records and tool results remain in the audit history.

Only the foreign fallback waives the SDK checkpoint requirement. It does not waive missing or mismatched tool results. Returning to Claude SDK after this fallback requires a new session; automatic SDK recovery from the summary is deliberately unsupported.

Run `npm run verify:compaction -- --self-test` for the bounded TLA+ model and real-Pi replay, including guard-removal negative controls. See [.agents/skills/verify-foreign-compaction/SKILL.md](../.agents/skills/verify-foreign-compaction/SKILL.md) for assumptions, source mapping and exclusions.
