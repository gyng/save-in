export const MAX_ROUTING_REGEX_CHARACTERS = 1_024;

type RegexGroupState = {
  hasAlternation: boolean;
  hasQuantifier: boolean;
  start: number;
};

const lastGroup = (groups: RegexGroupState[]): RegexGroupState =>
  Reflect.get(groups, groups.length - 1) as RegexGroupState;

const repeatingQuantifierAt = (source: string, index: number): boolean => {
  const token = source[index];
  if (token === "*" || token === "+") return true;
  if (token !== "{") return false;
  const end = source.indexOf("}", index + 1);
  if (end < 0) return false;
  const bounds = source.slice(index + 1, end).split(",");
  if (bounds.length === 1) return Number(bounds[0]) > 1;
  const maximum = bounds[1];
  return maximum === "" || Number(maximum) > 1;
};

const trailingDelimiterIsExcluded = (body: string): boolean => {
  const tail = /(?:\[\^([^\]]*)\]|\\([dws]))(?:[+*]|\{[^}]+\})(\\.|[^\\()[\]{}?+*|^$])$/.exec(body);
  if (!tail) return false;
  const rawDelimiter = tail[3];
  if (!rawDelimiter) return false;
  const delimiter = rawDelimiter.startsWith("\\") ? rawDelimiter.slice(1) : rawDelimiter;
  if (delimiter.length !== 1 || /[dDsSwWbB]/.test(rawDelimiter.slice(1))) return false;
  const excluded = tail[1];
  if (excluded !== undefined) {
    return excluded.includes(delimiter) || excluded.includes(`\\${delimiter}`);
  }
  const shorthand = tail[2];
  if (shorthand === "d") return !/\d/.test(delimiter);
  if (shorthand === "w") return !/[A-Za-z0-9_]/.test(delimiter);
  return !/\s/.test(delimiter);
};

// Conservative, linear structural check for the patterns most likely to
// backtrack catastrophically on long URLs or filenames. Local authoring uses
// this as a warning; untrusted external validation treats it as a hard gate.
export const isSafeRoutingRegex = (regex: RegExp | string): boolean => {
  if (typeof regex === "string") return true;
  const { source } = regex;
  if (source.length > MAX_ROUTING_REGEX_CHARACTERS) return false;

  const groups: RegexGroupState[] = [{ hasAlternation: false, hasQuantifier: false, start: -1 }];
  let inCharacterClass = false;
  for (let index = 0; index < source.length; index += 1) {
    const token = source.charAt(index);
    if (token === "\\") {
      const escaped = source[index + 1];
      if (
        !inCharacterClass &&
        escaped &&
        (/[1-9]/.test(escaped) || (escaped === "k" && source[index + 2] === "<"))
      ) {
        return false;
      }
      index += 1;
      continue;
    }
    if (token === "[") {
      inCharacterClass = true;
      continue;
    }
    if (token === "]" && inCharacterClass) {
      inCharacterClass = false;
      continue;
    }
    if (inCharacterClass) continue;

    if (token === "(") {
      groups.push({ hasAlternation: false, hasQuantifier: false, start: index });
      continue;
    }
    if (token === ")" && groups.length > 1) {
      const group = lastGroup(groups);
      groups.pop();
      const repeated = repeatingQuantifierAt(source, index + 1);
      if (
        repeated &&
        (group.hasAlternation ||
          (group.hasQuantifier &&
            !trailingDelimiterIsExcluded(source.slice(group.start + 1, index))))
      ) {
        return false;
      }
      const parent = lastGroup(groups);
      parent.hasAlternation ||= group.hasAlternation;
      parent.hasQuantifier ||= group.hasQuantifier || repeated;
      continue;
    }
    const current = lastGroup(groups);
    if (token === "|") {
      current.hasAlternation = true;
      continue;
    }
    if (
      token === "*" ||
      token === "+" ||
      (token === "?" && source[index - 1] !== "(" && !/[+*?}]/.test(source[index - 1] ?? "")) ||
      token === "{"
    ) {
      current.hasQuantifier = true;
    }
  }
  return true;
};
