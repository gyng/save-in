import {
  clauseGroup,
  compareClauses,
  compareVariables,
  isLazyVariable,
  sortClauses,
  sortVariables,
  variableExample,
  variableGroup,
} from "../../src/options/core/vocabulary-groups.ts";

test("groups variables by user task rather than implementation scope", () => {
  expect(variableGroup(":date:")).toBe("Date and time");
  expect(variableGroup(":isoyear:")).toBe("Date and time");
  expect(variableGroup(":pagetitle:")).toBe("Page context");
  expect(variableGroup(":menupath:")).toBe("Page context");
  expect(variableGroup(":linktitle:")).toBe("Page context");
  expect(variableGroup(":sourceurl:")).toBe("Source URL");
  expect(variableGroup(":filename:")).toBe("Resolved file");
  expect(variableGroup(":sha256full:")).toBe("Resolved file");
  expect(variableGroup(":uuid:")).toBe("Generated values");
  expect(variableGroup(":$1:")).toBe("Capture groups");
});

test("groups clauses by routing intent", () => {
  expect(clauseGroup("into:")).toBe("Output");
  expect(clauseGroup("exclude:")).toBe("Output");
  expect(clauseGroup("after:")).toBe("Output");
  expect(clauseGroup("capture:")).toBe("Capture setup");
  expect(clauseGroup("capturegroups:")).toBe("Capture setup");
  expect(clauseGroup("context:")).toBe("Page and menu context");
  expect(clauseGroup("linkdownload:")).toBe("Page and menu context");
  expect(clauseGroup("sourceurl:")).toBe("URL and source matching");
  expect(clauseGroup("filename:")).toBe("Filename and content matching");
});

test("orders variables by meaning within each task group", () => {
  expect(
    sortVariables([
      ":day:",
      ":minute:",
      ":date:",
      ":monthname:",
      ":isoyear:",
      ":year:",
      ":month:",
      ":hour:",
    ]),
  ).toEqual([
    ":date:",
    ":year:",
    ":isoyear:",
    ":month:",
    ":monthname:",
    ":day:",
    ":hour:",
    ":minute:",
  ]);
  expect(
    sortVariables([":sha256full:", ":sha256:", ":filename:", ":mimeext:", ":fileext:"]),
  ).toEqual([":filename:", ":fileext:", ":mimeext:", ":sha256:", ":sha256full:"]);
});

test("orders clauses by routing workflow within each task group", () => {
  expect(
    sortClauses([
      "selectiontext",
      "comment",
      "context",
      "menuindex",
      "linkdownload",
      "linktitle",
      "linktext",
    ]),
  ).toEqual([
    "context",
    "menuindex",
    "comment",
    "linktext",
    "linktitle",
    "linkdownload",
    "selectiontext",
  ]);
  expect(
    sortClauses([
      "actualfileext",
      "sourcekind",
      "mediatype",
      "filename",
      "finalfilename",
      "fileext",
    ]),
  ).toEqual(["sourcekind", "filename", "finalfilename", "fileext", "actualfileext", "mediatype"]);
});

test("orders task groups, unknown terms, and numbered captures deterministically", () => {
  expect(compareVariables(":date:", ":filename:")).toBeLessThan(0);
  expect(compareVariables(":$10:", ":$2:")).toBeGreaterThan(0);
  expect(compareVariables(":custom-z:", ":custom-a:")).toBeGreaterThan(0);
  expect(compareClauses("into:", "sourceurl:")).toBeLessThan(0);
  expect(compareClauses("custom-z:", "custom-a:")).toBeGreaterThan(0);
});

test.each([
  [":date:", "2026-07-12"],
  [":year:", "2026"],
  [":isoyear:", "2026"],
  [":month:", "07"],
  [":day:", "07"],
  [":hour:", "09"],
  [":minute:", "09"],
  [":second:", "09"],
  [":counter:", "42"],
  [":fileext:", "jpg"],
  [":mimeext:", "jpg"],
  [":filename:", "photo.jpg"],
  [":pagedomain:", "example.com"],
  [":tld:", "com"],
  [":sourceurl:", "https://example.com/file.jpg"],
  [":pagetitle:", "Example page"],
  [":pagetitleslug:", "example-page"],
  [":pagetitlesnake:", "example_page"],
  [":mime:", "image/jpeg"],
  [":contenttype:", "image/jpeg"],
  [":sha256:", "ba7816bf8f01"],
  [":sha256full:", "ba7816bf…"],
  [":$1:", "captured-text"],
  [":uuid:", "f47ac10b-…"],
  [":selectiontext:", "example"],
  [":menupath:", "example"],
])("provides a representative example for %s", (variable, expected) => {
  expect(variableExample(variable)).toBe(expected);
});

test("identifies variables that require downloaded metadata or content", () => {
  for (const variable of [
    ":mime:",
    ":contenttype:",
    ":mimeext:",
    ":finalurl:",
    ":redirecturl:",
    ":sha256:",
    ":sha256full:",
  ]) {
    expect(isLazyVariable(variable)).toBe(true);
  }
  expect(isLazyVariable(":filename:")).toBe(false);
});
