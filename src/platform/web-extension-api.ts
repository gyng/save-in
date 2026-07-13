// Every shipped entry runs in a WebExtension host, where one namespace exists.
// Firefox and Chrome projects bind SaveInWebExtensionApi to their own namespace,
// so this is only a runtime-selection cast; every consumer is checked once
// against each host's declarations.
export const webExtensionApi = (globalThis.browser ??
  globalThis.chrome) as unknown as SaveInWebExtensionApi;
