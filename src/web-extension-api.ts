type WebExtensionApi = typeof globalThis.browser;

export const webExtensionApi: WebExtensionApi | undefined =
  globalThis.browser ?? (globalThis.chrome as unknown as WebExtensionApi);
