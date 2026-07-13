export const BACKGROUND_E2E_BRIDGE = "__SAVE_IN_E2E__";

export const installBackgroundE2EBridge = <T extends object>(
  host: typeof globalThis,
  bridge: T,
): void => {
  Object.defineProperty(host, BACKGROUND_E2E_BRIDGE, {
    configurable: true,
    enumerable: false,
    value: Object.freeze(bridge),
  });
};
