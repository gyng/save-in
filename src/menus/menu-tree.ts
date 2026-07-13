import { SPECIAL_DIRS } from "../shared/constants.ts";
import { Path } from "../routing/path.ts";

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
  | { kind: "separator"; parentId: string }
  | {
      kind: "path";
      id: string;
      title: string;
      number: number;
      accessKeyOverride?: string | undefined;
      parsedDir: string;
      comment: string;
      menuIndex: string;
      depth: number;
      parentId: string;
      raw: string;
    };
export type MenuTreeError = {
  message: string;
  error: string;
  parentId?: string | undefined;
};
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
      return key ? Object.assign(acc, { [key]: values.slice(1).join(" ") }) : acc;
    }, {});
};

export const parsePath = (dir: string): ParsedPath => {
  const tokens = dir.split("//").map((token) => token.trim());
  const [head = "", commentToken = ""] = tokens;
  const depthMatch = head.match(/^(>+)?(.+)/);
  const depth = (depthMatch?.[1] || "").length;
  const parsedDir = (depthMatch?.[2] || "").trim();
  const comment = commentToken.trim();
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
          ? pathsNestingStack[pathsNestingStack.length - 1] || ROOT_ID
          : pathsNestingStack[depth - 1] || ROOT_ID;
    if (!validation.valid) {
      errors.push({ message: validation.message || "Invalid path", error: dir, parentId });
      return;
    }

    const title = meta.alias || parsedDir;
    menuItemCounter.splice(depth + 1);
    const number = (menuItemCounter[depth] || 0) + 1;
    menuItemCounter[depth] = number;
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
      number,
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
