import baseConfig from "./vitest.config.mjs";

export default {
  ...baseConfig,
  test: {
    ...baseConfig.test,
    exclude: ["test/integration/**"],
  },
};
