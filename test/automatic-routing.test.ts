import {
  automaticRoutingRuleIssues,
  matchAutomaticRoutingRule,
} from "../src/automation/automatic-routing.ts";
import { parseRulesCollecting } from "../src/routing/rule-parser.ts";
import { isAutomaticRuleClauses } from "../src/routing/automatic-rule.ts";

const candidate = {
  pageUrl: "https://gallery.example.test/post/42",
  sourceUrl: "https://cdn.example.test/original/cat.JPG?token=1",
  sourceKind: "image" as const,
};

describe("automatic page-source routing", () => {
  test("selects the first guarded context:auto rule and ignores ordinary routes", () => {
    const parsed = parseRulesCollecting(`
filename: .*
into: ordinary/:filename:

context: ^auto$
pageurl: ^https://gallery\\.example\\.test/
sourcekind: ^image$
sourceurl/i: \\.(?:jpe?g|png)(?:[?#].*)?$
into: automatic/:pagedomain:/
`);

    expect(parsed.errors.filter((error) => !error.warning)).toEqual([]);
    expect(matchAutomaticRoutingRule(parsed.rules, candidate)?.destination).toBe(
      "automatic/:pagedomain:/",
    );
  });

  test("does not opt broad or non-automatic context rules into unattended downloads", () => {
    for (const context of [".*", "^media$", "^(?:page|media)$"]) {
      const parsed = parseRulesCollecting(`
context: ${context}
pageurl: example
sourcekind: image
into: unsafe/
`);
      expect(matchAutomaticRoutingRule(parsed.rules, candidate)).toBeNull();
    }
  });

  test("rejects malformed automatic-context expressions without throwing", () => {
    expect(isAutomaticRuleClauses([{ name: "context", value: "auto[" }])).toBe(false);
    expect(isAutomaticRuleClauses([{ name: "context", value: "^auto$", flags: "i" }])).toBe(true);
  });

  test.each([
    ["page guard", "context: ^auto$\nsourcekind: image\ninto: files/", "page"],
    ["source guard", "context: ^auto$\npageurl: example\ninto: files/", "source"],
  ])("requires an explicit %s", (_label, source, issue) => {
    expect(automaticRoutingRuleIssues(source)).toContain(issue);
    expect(parseRulesCollecting(source).errors).toHaveLength(1);
  });
});
