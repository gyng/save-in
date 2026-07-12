import { SPECIAL_DIRS } from "../shared/constants.ts";
import { Path } from "../routing/path.ts";

export type MenuMeta = Record<string, string>;
export type ParsedPath = {
  raw: string;
  comment: string;
  depth: number;
  meta: MenuMeta;
  parsedDir: string;
  validation: { valid: boolean; message?: string };
};
export type MenuTreeItem =
  | { kind: "separator"; parentId: string }
  | {
      kind: "path";
      id: string;
      title: string;
      number: number;
      accessKeyOverride?: string;
      parsedDir: string;
      comment: string;
      menuIndex: string;
      depth: number;
      parentId: string;
      raw: string;
    };
export type MenuTreeError = { message: string; error: string; parentId?: string };
export type MenuTree = { items: MenuTreeItem[]; errors: MenuTreeError[] };

const ROOT_ID = "save-in-root";

export const parseMeta = (comment: string): MenuMeta => {
  const matches = comment.match(/\(.+?:.+?\)+/g);
  if (!matches) return {};
  return matches
    .map((pair) =>
      pair
        .replace(/(^\(|\)$)/g, "")
        .split(":")
        .map((value) => value.trim()),
    )
    .reduce<MenuMeta>((acc, values) => {
      const key = values[0];
      return Object.assign(acc, { [key]: values.slice(1).join(" ") });
    }, {});
};

export const parsePath = (dir: string): ParsedPath => {
  const tokens = dir.split("//").map((token) => token.trim());
  const depthMatch = tokens[0].match(/^(>+)?(.+)/)!;
  const depth = (depthMatch[1] || "").length;
  const parsedDir = depthMatch[2].trim();
  const comment = (tokens[1] || "").trim();
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
  let lastDepth = 0;

  pathsArray.forEach((dir, index) => {
    if (dir === SPECIAL_DIRS.SEPARATOR) {
      items.push({ kind: "separator", parentId: ROOT_ID });
      return;
    }
    const { comment, depth, meta, validation, parsedDir } = parsePath(dir);
    const parentId =
      depth === 0
        ? ROOT_ID
        : depth > pathsNestingStack.length
          ? pathsNestingStack[pathsNestingStack.length - 1]
          : pathsNestingStack[depth - 1];
    if (!validation.valid) {
      errors.push({ message: validation.message!, error: dir, parentId });
      return;
    }

    const title = meta.alias || parsedDir;
    menuItemCounter.splice(depth + 1);
    menuItemCounter[depth] = (menuItemCounter[depth] || 0) + 1;
    const id = `save-in-${index}`;
    if (parsedDir === SPECIAL_DIRS.SEPARATOR) {
      items.push({ kind: "separator", parentId });
      return;
    }
    if (depth === 0) pathsNestingStack = [id];
    else if (depth <= lastDepth) pathsNestingStack[depth] = id;
    else pathsNestingStack.push(id);
    lastDepth = depth;
    pathsNestingStack = pathsNestingStack.slice(0, depth + 1);
    items.push({
      kind: "path",
      id,
      title,
      number: menuItemCounter[depth],
      accessKeyOverride: meta.key,
      parsedDir,
      comment: `${index}${comment.replaceAll("-", "_")}`,
      menuIndex: menuItemCounter.join("."),
      depth,
      parentId,
      raw: dir,
    });
  });
  return { items, errors };
};
