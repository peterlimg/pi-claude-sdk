import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';

export default function (pi: ExtensionAPI) {
  pi.on('session_start', (_event, ctx) => {
    pi.appendEntry('sdk-package-models', ctx.modelRegistry.getAll().filter(model => model.provider === 'claude-sdk').map(model => model.id).sort());
  });
}
