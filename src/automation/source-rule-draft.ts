import { toRootDomain } from "../shared/domain.ts";
import { AUTOMATIC_CONTEXT_PATTERN } from "../routing/automatic-rule.ts";
import type { PageSourceKind } from "../shared/page-source.ts";

const escapeRegex = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export const createSourceRuleDraft = (
  pageUrl: string,
  sourceUrl: string,
  sourceKind: PageSourceKind,
): string | null => {
  try {
    const page = new URL(pageUrl);
    const source = new URL(sourceUrl);
    if (!["http:", "https:"].includes(page.protocol)) return null;
    if (!["http:", "https:"].includes(source.protocol)) return null;
    const pageDomain = toRootDomain(page.hostname);
    const sourceDomain = toRootDomain(source.hostname);
    return [
      `// Suggested automatic ${sourceKind} rule for ${pageDomain}`,
      `context: ${AUTOMATIC_CONTEXT_PATTERN}`,
      `pagerootdomain: ^${escapeRegex(pageDomain)}$`,
      `sourcerootdomain: ^${escapeRegex(sourceDomain)}$`,
      `sourcekind: ^${escapeRegex(sourceKind)}$`,
      "into: Page Sources/:pagerootdomain:/",
      "disabled: true",
    ].join("\n");
  } catch {
    return null;
  }
};
