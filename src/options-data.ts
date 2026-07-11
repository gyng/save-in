// Loosely typed until the SaveInOptions type is derived from OPTION_KEYS in
// the TS-native pass (docs/ARCH-CYCLES.md #62).
export const options: Record<string, any> = {};

export const setOption = (name: string, value: any) => {
  if (typeof value !== "undefined") {
    options[name] = value;
  }
};
