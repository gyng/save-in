const MAX_ROUTING_REGEX_CHARACTERS = 1_024;

type RegexGroupState = {
  hasAlternation: boolean;
  hasQuantifier: boolean;
  start: number;
};

const repeatingQuantifierAt = (source: string, index: number): boolean => {
  const token = source[index];
  if (token === "*" || token === "+") return true;
  if (token !== "{") return false;
  // RegExp#source escapes a literal brace; an unescaped brace here is a
  // compiled quantifier and therefore always has its closing delimiter.
  const end = source.indexOf("}", index + 1);
  const bounds = source.slice(index + 1, end).split(",");
  if (bounds.length === 1) return Number(bounds[0]) > 1;
  const maximum = bounds[1];
  return maximum === "" || Number(maximum) > 1;
};

const trailingDelimiterIsExcluded = (body: string): boolean => {
  const tail = /(?:\[\^([^\]]*)\]|\\([dws]))(?:[+*]|\{[^}]+\})(\\.|[^\\()[\]{}?+*|^$])$/.exec(body);
  // The final group is mandatory whenever the expression matches, so it is only
  // absent when the match itself is: read it through the same guard rather than
  // asserting it separately.
  const rawDelimiter = tail?.[3];
  if (!tail || rawDelimiter === undefined) return false;
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

  // The scanned group is held live rather than read back off the stack, so the
  // root group cannot be popped and every read is a defined value by
  // construction. An unbalanced ")" leaves `parents` empty and is ignored.
  let current: RegexGroupState = { hasAlternation: false, hasQuantifier: false, start: -1 };
  const parents: RegexGroupState[] = [];
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
      parents.push(current);
      current = { hasAlternation: false, hasQuantifier: false, start: index };
      continue;
    }
    // A valid RegExp source cannot close a group it never opened, so an empty
    // stack yields undefined and the token falls through to the checks below
    // untouched — the same handling the old length guard gave it.
    const parent = token === ")" ? parents.pop() : undefined;
    if (parent) {
      const group = current;
      current = parent;
      const repeated = repeatingQuantifierAt(source, index + 1);
      if (
        repeated &&
        (group.hasAlternation ||
          (group.hasQuantifier &&
            !trailingDelimiterIsExcluded(source.slice(group.start + 1, index))))
      ) {
        return false;
      }
      parent.hasAlternation ||= group.hasAlternation;
      parent.hasQuantifier ||= group.hasQuantifier || repeated;
      continue;
    }
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
