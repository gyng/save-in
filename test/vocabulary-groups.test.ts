import {
  clauseGroup,
  sortClauses,
  sortVariables,
  variableGroup,
} from "../src/options/vocabulary-groups.ts";

test("groups variables by user task rather than implementation scope", () => {
  expect(variableGroup(":date:")).toBe("Date and time");
  expect(variableGroup(":pagetitle:")).toBe("Page context");
  expect(variableGroup(":sourceurl:")).toBe("Source URL");
  expect(variableGroup(":filename:")).toBe("Resolved file");
  expect(variableGroup(":sha256full:")).toBe("Resolved file");
  expect(variableGroup(":uuid:")).toBe("Generated values");
  expect(variableGroup(":$1:")).toBe("Capture groups");
});

test("groups clauses by routing intent", () => {
  expect(clauseGroup("into:")).toBe("Output");
  expect(clauseGroup("capture:")).toBe("Capture setup");
  expect(clauseGroup("capturegroups:")).toBe("Capture setup");
  expect(clauseGroup("context:")).toBe("Page and menu context");
  expect(clauseGroup("sourceurl:")).toBe("URL and source matching");
  expect(clauseGroup("filename:")).toBe("Filename and content matching");
});

test("orders variables by meaning within each task group", () => {
  expect(
    sortVariables([":day:", ":minute:", ":date:", ":monthname:", ":year:", ":month:", ":hour:"]),
  ).toEqual([":date:", ":year:", ":month:", ":monthname:", ":day:", ":hour:", ":minute:"]);
  expect(
    sortVariables([":sha256full:", ":sha256:", ":filename:", ":mimeext:", ":fileext:"]),
  ).toEqual([":filename:", ":fileext:", ":mimeext:", ":sha256:", ":sha256full:"]);
});

test("orders clauses by routing workflow within each task group", () => {
  expect(sortClauses(["selectiontext", "comment", "context", "menuindex", "linktext"])).toEqual([
    "context",
    "menuindex",
    "comment",
    "linktext",
    "selectiontext",
  ]);
  expect(sortClauses(["actualfileext", "mediatype", "filename", "fileext"])).toEqual([
    "filename",
    "fileext",
    "actualfileext",
    "mediatype",
  ]);
});
