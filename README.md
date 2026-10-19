# pi-claude-sdk

A [Pi](https://github.com/earendil-works/pi) provider using the official [Claude Agent SDK](https://www.npmjs.com/package/@anthropic-ai/claude-agent-sdk). Claude proposes tool calls; Pi validates, authorizes and executes them.

Works in Pi's terminal interface and hosts such as [Pi Remote](https://github.com/peterlimg/pi-remote). Pi Remote is not a runtime dependency.

## Install

Requires Node 22.19+, a compatible Pi installation, and the official Claude Code CLI signed in with a first-party Claude account. The adapter uses the SDK and local Claude login, not a copied subscription token or a fake API key. Account and workspace entitlement restrictions still apply.

```sh
pi install git:github.com/peterlimg/pi-claude-sdk@v0.1.0
```

Start a fresh Pi session and select one of these models through `/model`:

```text
claude-sdk/claude-haiku-5-5
claude-sdk/claude-sonnet-5-5
claude-sdk/claude-opus-5-5
```

Installation does not change your default model. If you already load the Pi Remote experiment or another extension registering `claude-sdk`, remove that package declaration before loading this one. Do not load both copies in the same session. Restarting a worker does not approve mismatched history or configuration.

Pi's model catalog must contain the corresponding model metadata. The SDK dependency is pinned; changing its version requires rechecking tool IDs, prompt handling and saved-session behavior.

To remove the package:

```sh
pi remove git:github.com/peterlimg/pi-claude-sdk@v0.1.0
```

## Controls and safety

Use Pi's normal tools, permissions, effort selector and history controls. `/claude-usage` displays account limits when available. `/sdk-recover` requests interactive confirmation before rebuilding a native context from a valid saved Pi checkpoint; it never replays historical tools or invents missing results.

The provider is experimental. Read the [canonical gap tracker](https://github.com/peterlimg/pi-remote/blob/main/docs/provider-gaps.md) before using it for important work. The [architecture notes](docs/architecture.md) explain context ownership, persistence and the boundaries that stay guarded.

For an illustrated explanation, see [Claude thinks. Pi does the work.](https://claude-sdk-in-pi.vercel.app/)

## Development

```sh
npm ci --ignore-scripts
npm run check
npm run test:discovery
npm run test:prompt
```

`npm test` runs the credential-free replay E2Es. They start actual isolated Pi processes and use real persistence, MCP and tool execution, replacing only the external SDK peer. They do not establish live-model parity. Run a focused case with, for example, `npm run test:tree -- selected-history`.

Development dependencies pin Pi 1.2.0. Set `PI_SDK_TEST_PI` to a compatible Pi CLI file to exercise another installed version. See [verification and source provenance](docs/verification.md) for the extraction boundary and historical evidence. Phone/host integration tests remain in Pi Remote.

## License

No code license has been granted. Public visibility is not a reuse license. `private: true` prevents accidental npm publication; Pi can install this Git repository directly.
