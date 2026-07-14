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
export type MenuTreeItem =
  | { kind: "separator"; sourceIndex: number; id: string; parentId: string }
  | {
      kind: "path";
      sourceIndex: number;
      id: string;
      title: string;
      number: number;
      accessKeyOverride?: string | undefined;
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

export const buildTree = (pathsArray: string[]): MenuTree => {
  const items: MenuTreeItem[] = [];
  const errors: MenuTreeError[] = [];
  const menuItemCounter = [0];
  let pathsNestingStack: string[] = [];
  let disabledDepth: number | null = null;

  pathsArray.forEach((dir, index) => {
    const parsed = parsePath(dir);
    const { comment, depth, meta, validation, parsedDir } = parsed;
    if (disabledDepth !== null && depth > disabledDepth) return;
    disabledDepth = null;
    if (meta.disabled?.toLowerCase() === "true") {
      disabledDepth = depth;
      pathsNestingStack = pathsNestingStack.slice(0, depth);
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
    // Manual/imported configurations may skip a nesting level. The rendered
    // tree has always attached such an item to the deepest available parent;
    // use that effective depth for numbering too, so the menuindex value
    // matches the visible position instead of containing empty components.
    const effectiveDepth = depth === 0 ? 0 : Math.min(depth, pathsNestingStack.length);
    const parentId = effectiveDepth === 0 ? MENU_IDS.ROOT : pathsNestingStack[effectiveDepth - 1]!;
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
      parsedDir,
      comment: `${index}${comment.replaceAll("-", "_")}`,
      menuIndex: menuItemCounter.join("."),
      parentId,
      raw: dir,
    });
  });
  return { items: normalizeMenuTreeItems(items), errors };
};
