import { SPECIAL_DIRS } from "../shared/constants.ts";
import { Path } from "../routing/path.ts";
import { parsePathLine } from "../config/path-lines.ts";
import { MENU_IDS } from "./menu-ids.ts";

export type MenuMeta = Record<string, string>;
export type ParsedPath = {
  raw: string;
  comment: string;
  depth: number;
  meta: MenuMeta;
  parsedDir: string;
  validation: { valid: boolean; message?: string | undefined };
};
export type MenuTreeItem =
  | { kind: "separator"; id: string; parentId: string }
  | {
      kind: "path";
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
  message: string;
  error: string;
  parentId?: string | undefined;
};
export type MenuTree = { items: MenuTreeItem[]; errors: MenuTreeError[] };

export const parseMeta = (comment: string): MenuMeta => {
  const matches = comment.match(/\(.+?:.+?\)+/g);
  if (!matches) return {};
  return matches.reduce<MenuMeta>((acc, pair) => {
    const value = pair.replace(/(^\(|\)$)/g, "");
    const separatorIndex = value.indexOf(":");
    const key = value.slice(0, separatorIndex).trim();
    return key ? Object.assign(acc, { [key]: value.slice(separatorIndex + 1).trim() }) : acc;
  }, {});
};

export const parsePath = (dir: string): ParsedPath => {
  const { depth, body: parsedDir, comment } = parsePathLine(dir);
  return {
    raw: dir,
    comment,
    depth,
    meta: parseMeta(comment),
    parsedDir,
    validation: new Path(parsedDir).validate(),
  };
};

export const buildTree = (pathsArray: string[]): MenuTree => {
  const items: MenuTreeItem[] = [];
  const errors: MenuTreeError[] = [];
  const menuItemCounter = [0];
  let pathsNestingStack: string[] = [];

  pathsArray.forEach((dir, index) => {
    if (dir === SPECIAL_DIRS.SEPARATOR) {
      items.push({
        kind: "separator",
        id: `save-in-separator-path-${index}`,
        parentId: MENU_IDS.ROOT,
      });
      return;
    }
    const { comment, depth, meta, validation, parsedDir } = parsePath(dir);
    // Manual/imported configurations may skip a nesting level. The rendered
    // tree has always attached such an item to the deepest available parent;
    // use that effective depth for numbering too, so the menuindex value
    // matches the visible position instead of containing empty components.
    const effectiveDepth = depth === 0 ? 0 : Math.min(depth, pathsNestingStack.length);
    const parentId =
      effectiveDepth === 0 ? MENU_IDS.ROOT : pathsNestingStack[effectiveDepth - 1] || MENU_IDS.ROOT;
    if (!validation.valid) {
      errors.push({ message: validation.message || "Invalid path", error: dir, parentId });
      return;
    }

    const title = meta.alias || parsedDir;
    menuItemCounter.splice(effectiveDepth + 1);
    const number = (menuItemCounter[effectiveDepth] || 0) + 1;
    menuItemCounter[effectiveDepth] = number;
    const id = `save-in-${index}`;
    if (parsedDir === SPECIAL_DIRS.SEPARATOR) {
      items.push({ kind: "separator", id: `save-in-separator-path-${index}`, parentId });
      return;
    }
    if (effectiveDepth === 0) pathsNestingStack = [id];
    else pathsNestingStack[effectiveDepth] = id;
    pathsNestingStack = pathsNestingStack.slice(0, effectiveDepth + 1);
    items.push({
      kind: "path",
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
  return { items, errors };
};
