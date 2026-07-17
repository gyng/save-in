import { parsePathLineAst } from "../config/path-lines.ts";
import { Path } from "../routing/path.ts";
import { SPECIAL_DIRS } from "../shared/constants.ts";
import { MENU_IDS } from "./menu-ids.ts";

export {
  DIRECTORY_LINE_GRAMMAR,
  parsePathLineAst,
  validatePathLineSyntax,
} from "../config/path-lines.ts";
export type {
  DirectoryLineNode,
  DirectoryMetadataNode,
  ParsedDirectoryAst,
} from "../config/path-lines.ts";

export type MenuMeta = Record<string, string>;
export type ParsedPath = {
  raw: string;
  comment: string;
  depth: number;
  meta: MenuMeta;
  parsedDir: string;
  validation: {
    valid: boolean;
    message?: string | undefined;
    error?: string | undefined;
    sourceRange?: { start: number; end: number } | undefined;
  };
};
// A per-menu-item, opt-in post-save action on the tab the save came from:
// "close" removes it, "return" re-activates it. Never a default — only an item
// whose (tab: …) metadata requests it acts, so an ordinary save never disturbs
// the source tab.
export type TabAction = "close" | "return";

export const parseTabAction = (value: string | undefined): TabAction | undefined => {
  switch (value?.trim().toLowerCase()) {
    case "close":
      return "close";
    case "return":
    case "focus":
    case "activate":
      return "return";
    default:
      return undefined;
  }
};

export type MenuTreeItem =
  | { kind: "separator"; sourceIndex: number; id: string; parentId: string }
  | {
      kind: "path";
      sourceIndex: number;
      id: string;
      title: string;
      number: number;
      accessKeyOverride?: string | undefined;
      prompt?: boolean | undefined;
      tabAction?: TabAction | undefined;
      parsedDir: string;
      comment: string;
      menuIndex: string;
      parentId: string;
      raw: string;
    };
export type MenuTreeError = {
  sourceIndex: number;
  message: string;
  error: string;
  sourceRange?: { start: number; end: number } | undefined;
  parentId?: string | undefined;
};
export type MenuTree = { items: MenuTreeItem[]; errors: MenuTreeError[] };
export type MenuTreeEntry = MenuTreeItem | MenuTreeError;

export const getMenuTreeEntries = ({ items, errors }: MenuTree): MenuTreeEntry[] =>
  [...items, ...errors].sort((left, right) => left.sourceIndex - right.sourceIndex);

const normalizeMenuTreeItems = (items: MenuTreeItem[]): MenuTreeItem[] => {
  const siblingsByParent = new Map<string, MenuTreeItem[]>();
  items.forEach((item) => {
    const siblings = siblingsByParent.get(item.parentId) ?? [];
    siblings.push(item);
    siblingsByParent.set(item.parentId, siblings);
  });

  const keptSeparators = new Set<string>();
  siblingsByParent.forEach((siblings) => {
    let hasPathBefore = false;
    siblings.forEach((item, index) => {
      if (item.kind === "path") {
        hasPathBefore = true;
        return;
      }
      const hasPathAfter = siblings.slice(index + 1).some((sibling) => sibling.kind === "path");
      if (hasPathBefore && hasPathAfter) {
        keptSeparators.add(item.id);
        hasPathBefore = false;
      }
    });
  });

  return items.filter((item) => item.kind === "path" || keptSeparators.has(item.id));
};

export const parsePath = (dir: string): ParsedPath => {
  const { ast, issues } = parsePathLineAst(dir);
  const { depth } = ast;
  const parsedDir = ast.path.value;
  const comment = ast.comment?.value ?? "";
  const meta = Object.fromEntries(ast.metadata.map((entry) => [entry.key, entry.value]));
  const validation = issues.length ? { valid: false } : new Path(parsedDir).validate();
  return {
    raw: dir,
    comment,
    depth,
    meta,
    parsedDir,
    validation:
      validation.sourceRange === undefined
        ? validation
        : {
            ...validation,
            sourceRange: {
              start: ast.path.span.start.offset + validation.sourceRange.start,
              end: ast.path.span.start.offset + validation.sourceRange.end,
            },
          },
  };
};

// Occupies a disabled item's place in the nesting stack. Never a real menu id:
// nothing that could reach it as a parent survives the disabled check.
const DISABLED_SLOT = "";

export const buildTree = (pathsArray: string[]): MenuTree => {
  const items: MenuTreeItem[] = [];
  const errors: MenuTreeError[] = [];
  const menuItemCounter = [0];
  let pathsNestingStack: string[] = [];
  let disabledDepth: number | null = null;

  pathsArray.forEach((dir, index) => {
    const parsed = parsePath(dir);
    const { comment, depth, meta, validation, parsedDir } = parsed;
    // Manual/imported configurations may skip a nesting level. The rendered
    // tree has always attached such an item to the deepest available parent;
    // use that effective depth for numbering too, so the menuindex value
    // matches the visible position instead of containing empty components.
    const effectiveDepth = depth === 0 ? 0 : Math.min(depth, pathsNestingStack.length);
    if (disabledDepth !== null && effectiveDepth > disabledDepth) return;
    disabledDepth = null;
    if (meta.disabled?.toLowerCase() === "true") {
      disabledDepth = effectiveDepth;
      // Hold the slot this item would have filled. A descendant that skipped a
      // level is only nested under it because the rendered item occupies that
      // slot; vacating it would collapse the descendant to this same depth and
      // let it survive the check above — rendering a destination inside the
      // subtree the user disabled. Nothing reads the placeholder as a parent:
      // anything deep enough to reach it is suppressed first.
      pathsNestingStack = pathsNestingStack.slice(0, effectiveDepth);
      pathsNestingStack[effectiveDepth] = DISABLED_SLOT;
      return;
    }
    if (dir === SPECIAL_DIRS.SEPARATOR) {
      pathsNestingStack = [];
      items.push({
        kind: "separator",
        sourceIndex: index,
        id: `save-in-separator-path-${index}`,
        parentId: MENU_IDS.ROOT,
      });
      return;
    }
    const parentId =
      effectiveDepth === 0 ? MENU_IDS.ROOT : (pathsNestingStack[effectiveDepth - 1] as string);
    if (!validation.valid) {
      pathsNestingStack = pathsNestingStack.slice(0, effectiveDepth);
      errors.push({
        sourceIndex: index,
        message: validation.message || "Invalid path",
        error: validation.error || dir,
        ...(validation.sourceRange ? { sourceRange: validation.sourceRange } : {}),
        parentId,
      });
      return;
    }

    if (parsedDir === SPECIAL_DIRS.SEPARATOR) {
      pathsNestingStack = pathsNestingStack.slice(0, effectiveDepth);
      items.push({
        kind: "separator",
        sourceIndex: index,
        id: `save-in-separator-path-${index}`,
        parentId,
      });
      return;
    }

    const title = meta.alias || parsedDir;
    menuItemCounter.splice(effectiveDepth + 1);
    const number = (menuItemCounter[effectiveDepth] || 0) + 1;
    menuItemCounter[effectiveDepth] = number;
    const id = `save-in-${index}`;
    if (effectiveDepth === 0) pathsNestingStack = [id];
    else pathsNestingStack[effectiveDepth] = id;
    pathsNestingStack = pathsNestingStack.slice(0, effectiveDepth + 1);
    items.push({
      kind: "path",
      sourceIndex: index,
      id,
      title,
      number,
      accessKeyOverride: meta.key,
      ...(meta.dialog?.toLowerCase() === "true" ? { prompt: true } : {}),
      ...(parseTabAction(meta.tab) ? { tabAction: parseTabAction(meta.tab) } : {}),
      parsedDir,
      comment: `${index}${comment.replaceAll("-", "_")}`,
      menuIndex: menuItemCounter.join("."),
      parentId,
      raw: dir,
    });
  });
  return { items: normalizeMenuTreeItems(items), errors };
};
