# Architecture

```text
Pi session and instructions
  -> claude-sdk provider
    -> official Claude Agent SDK
      -> tool proposal through MCP
    <- Pi assistant tool-call event
  -> Pi schema validation, permissions and execution
    -> matching tool result to the waiting MCP handler
    <- Claude response and usage
```

`index.ts` registers the provider, local-login check and Pi lifecycle hooks. `bridge.ts` translates the message stream and owns the current native SDK query. Neither imports Pi Remote. An optional `PI_REMOTE_WORKER=1` status notification lets Pi Remote observe checkpoint settlement; ordinary Pi sessions do not need it.

## Execution and instructions

SDK built-in tools, implicit MCP servers, hooks, memory, project-settings discovery and native automatic/idle compaction are disabled. Only the current Pi tool schemas are advertised. MCP handlers wait for matching Pi results and do not execute tools themselves. Pi remains responsible for validation and authorization, including denial and cancellation.

Prompt projection uses the official `claude_code` preset. Only proven generated identity boilerplate and default documentation routing stay in Pi's canonical record rather than the SDK-facing prompt. Operator/project instructions, skills, explicit documentation, custom prompts and appended rules stay intact. Inherited whole-prompt overrides require exact canonical-base provenance before generated sections can be omitted. Unknown rewrites fail closed.

## History and native contexts

Pi owns the audit history. The native SDK context is separate and may be replaced only through a validated transition. Configuration fingerprints bind the canonical and projected prompts, tool schemas, working directory, Pi owner, explicit environment and output limit.

Completed turns save provider-owned checkpoint entries. Pi-owned compaction and independent clone/fork/tree transitions bind their source, destination and configuration through receipts before the next native checkpoint. Historical calls are imported as labeled data, never executable calls. History selection does not reverse filesystem effects.

Failed requests and recorded Stop boundaries can start a fresh native context when Pi has matching tool results. Pi's existing retry budget and backoff handle transient failures; each attempt replaces a closed bridge rather than using it again. Transport exceptions are classified without exposing their original messages. Usage/entitlement rejections pause without automatic retries and do not prevent a later message from continuing in the same Pi conversation.

Context reconstruction imports history as data, never executable calls, resets the native usage baseline, and validates the saved prefix and configuration before starting the SDK. Missing new tool results still require explicit, checkpoint-bound `/sdk-recover` confirmation. Previously approved unknown effects remain unknown. Native context replacement does not prove a command was rolled back or authorize replaying it. Changes to the repository name do not change the `claude-sdk` provider ID or checkpoint entry formats.

Pi persists checkpoints in saved sessions. Saved SDK chats also have native Claude Code transcripts, normally under `~/.claude/projects/`, subject to Claude Code's retention. Ephemeral requests disable SDK persistence. Deleting a Pi session does not delete its native SDK transcript.

## Children and guarded configurations

Fresh borrowed foreground children use independent ephemeral bridges, not parent native memory. Default-placement append-mode delegates can project a proven exact Pi base plus an unchanged suffix. These are different routes.

Borrowed foreground children do not save child-owned durable SDK checkpoints. Loading child hooks in an experiment can save a checkpoint, but changed foreground/background instructions still block retained continuation. Forced-foreground append-mode delegates also lack child-owned prompt-projection provenance. Do not globally enable child hooks or drop instructions to bypass either guard.

General instruction/environment/output-limit changes, unknown SDK work, corrupt receipts and incomplete tool histories stay guarded. Child-local lifecycle, broader nested/custom roles and full provider parity need separate evidence. Keep current limitations in the [canonical tracker](https://github.com/peterlimg/pi-remote/blob/main/docs/provider-gaps.md), not a second list in this repository.

## Authentication and usage

Authentication discovery calls `claude auth status --json` and requires a logged-in first-party Claude account. The SDK uses that official local login. API keys and alternative cloud-routing variables are rejected; no credentials are copied into Pi. Request entitlement errors are not permission to change billing or use a different authentication route.

Token and nominal cost estimates are not a subscription balance or proof of the amount charged. Native-context replacement resets only the new native usage baseline, not Pi's previously recorded totals.
