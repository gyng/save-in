import baseConfig from "./base.mjs";

export default {
  ...baseConfig,
  test: {
    ...baseConfig.test,
    include: ["test/integration/**/*.test.ts"],
  },
};
