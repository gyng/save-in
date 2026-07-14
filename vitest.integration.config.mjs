import baseConfig from "./vitest.config.mjs";

export default {
  ...baseConfig,
  test: {
    ...baseConfig.test,
    include: ["test/integration/**/*.test.ts"],
  },
};
