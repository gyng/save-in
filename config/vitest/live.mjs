import baseConfig from "./base.mjs";

// On-demand only: hits third-party CDNs to verify the built-in site-rewrite
// templates still resolve against live URLs. Kept out of `npm test`, `test:all`,
// and coverage (see the `test/live/**` excludes in base.mjs and unit.mjs).
export default {
  ...baseConfig,
  test: {
    ...baseConfig.test,
    include: ["test/live/**/*.test.ts"],
    exclude: [],
    coverage: { ...baseConfig.test?.coverage, enabled: false },
  },
};
