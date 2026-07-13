export const installHostProperty = (
  target: object,
  property: PropertyKey,
  value: unknown,
): void => {
  if (!Reflect.set(target, property, value)) {
    throw new Error(`Unable to install WebExtension test property ${String(property)}`);
  }
};

export const browserTab = (overrides: Partial<browser.tabs.Tab> = {}): browser.tabs.Tab => ({
  index: 0,
  highlighted: false,
  active: true,
  pinned: false,
  incognito: false,
  ...overrides,
});
