import { createSourceRuleDraft } from "../../src/automation/source-rule-draft.ts";
import { parseRoutingRuleAst } from "../../src/routing/rule-syntax.ts";
import { automaticRoutingRuleIssues } from "../../src/automation/automatic-routing.ts";

describe("source rule drafts", () => {
  test("creates a disabled eligible automatic rule scoped to both sites", () => {
    const draft = createSourceRuleDraft(
      "https://gallery.example.co.uk/post/1",
      "https://media.cdn.example.net/images/cat.jpg",
      "image",
    );

    expect(draft).toContain("context: ^auto$");
    expect(draft).toContain("pagerootdomain: ^example\\.co\\.uk$");
    expect(draft).toContain("sourcerootdomain: ^example\\.net$");
    expect(draft).toContain("sourcekind: ^image$");
    expect(draft).toContain("disabled: true");
    expect(parseRoutingRuleAst(draft || "").issues).toEqual([]);
    expect(automaticRoutingRuleIssues(draft || "")).toEqual([]);
  });

  test("refuses non-web page or source URLs", () => {
    expect(createSourceRuleDraft("about:blank", "https://cdn.test/a.jpg", "image")).toBeNull();
    expect(
      createSourceRuleDraft("https://page.test", "data:image/png;base64,a", "image"),
    ).toBeNull();
  });

  test("contains malformed URLs at the draft boundary", () => {
    expect(createSourceRuleDraft("not a URL", "https://cdn.test/a.jpg", "image")).toBeNull();
    expect(createSourceRuleDraft("https://page.test", "https://[invalid", "image")).toBeNull();
  });
});
