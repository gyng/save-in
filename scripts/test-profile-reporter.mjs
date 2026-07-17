import fs from "node:fs";

export default class TestProfileReporter {
  onTestRunEnd(testModules, unhandledErrors, reason) {
    const output = process.env.SAVE_IN_TEST_PROFILE_OUTPUT;
    if (!output) return;

    const files = testModules.map((testModule) => {
      const diagnostic = testModule.diagnostic();
      return {
        name: testModule.moduleId,
        state: testModule.state(),
        diagnostic,
        assertions: [...testModule.children.allTests()].map((testCase) => ({
          name: testCase.fullName,
          duration: testCase.diagnostic()?.duration ?? 0,
        })),
      };
    });

    fs.writeFileSync(
      output,
      JSON.stringify({
        success: reason === "passed",
        unhandledErrors: unhandledErrors.length,
        files,
      }),
    );
  }
}
