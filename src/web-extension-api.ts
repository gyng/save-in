type WebExtensionApi = typeof globalThis.browser;

// Every shipped entry runs in a WebExtension host, where one namespace exists.
// Keeping the fallback expression unguarded preserves standalone detection while
// preventing false optionality from leaking through every host API call.
export const webExtensionApi = (globalThis.browser ?? globalThis.chrome) as WebExtensionApi;
