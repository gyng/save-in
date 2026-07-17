import { isEligibleAutomaticRoutingRule } from "../../src/automation/automatic-routing.ts";
import { parseRulesCollecting } from "../../src/routing/rule-parser.ts";
import { traceRules } from "../../src/routing/router.ts";

const candidate = {
  pageUrl: "https://gallery.example.test/post/42",
  sourceUrl: "https://cdn.example.test/original/cat.JPG?token=1",
  sourceKind: "image" as const,
};

test("automatic traces use runtime eligibility while preserving source indexes", async () => {
  const parsed = parseRulesCollecting(`
sourceurl/i: jpg
into: ordinary/

context: ^auto$
pageurl: gallery
sourceurl/i: jpg
into: automatic/
`);
  const trace = await traceRules(
    parsed.rules,
    {
      context: "AUTO",
      mediaType: candidate.sourceKind,
      pageUrl: candidate.pageUrl,
      sourceKind: candidate.sourceKind,
      sourceUrl: candidate.sourceUrl,
      url: candidate.sourceUrl,
    },
    isEligibleAutomaticRoutingRule,
  );

  expect(trace.selectedRule).toBe(2);
  expect(trace.destination).toBe("automatic/");
  expect(trace.rules.map(({ matched }) => matched)).toEqual([false, true]);
});

test("ordinary catch-all routes do not shadow automatic rules", () => {
  const parsed = parseRulesCollecting(`
filename: .*
into: ordinary/

context: ^auto$
pageurl: gallery
sourcekind: image
into: automatic/
`);

  expect(parsed.errors.filter(({ warning }) => warning)).toEqual([]);
});
