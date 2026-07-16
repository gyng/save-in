import baseConfig from "./base.mjs";

export default {
  ...baseConfig,
  test: {
    ...baseConfig.test,
    exclude: ["test/integration/**", "test/live/**"],
  },
};
