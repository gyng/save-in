import { clauseGroup, variableGroup } from "../src/options/vocabulary-groups.ts";

test("groups variables by user task rather than implementation scope", () => {
  expect(variableGroup(":date:")).toBe("Date and time");
  expect(variableGroup(":pagetitle:")).toBe("Page context");
  expect(variableGroup(":sourceurl:")).toBe("Source URL");
  expect(variableGroup(":filename:")).toBe("Resolved file");
  expect(variableGroup(":uuid:")).toBe("Generated values");
  expect(variableGroup(":$1:")).toBe("Capture groups");
});

test("groups clauses by routing intent", () => {
  expect(clauseGroup("into:")).toBe("Output");
  expect(clauseGroup("capture:")).toBe("Capture setup");
  expect(clauseGroup("context:")).toBe("Page and menu context");
  expect(clauseGroup("sourceurl:")).toBe("URL and source matching");
  expect(clauseGroup("filename:")).toBe("Filename and content matching");
});
