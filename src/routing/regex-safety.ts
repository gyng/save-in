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

// A wildcard reports the characters it can never consume.
type Wildcard = (character: string) => boolean;
type AlternationFrame = { start: Wildcard[]; ends: Wildcard[][] };

const CONTROL_ESCAPES: Record<string, string> = { n: "\n", r: "\r", t: "\t", f: "\f", v: "\v" };
// Applied only where the scan already found the token they describe, so they
// always match it.
const ESCAPE_REGEX =
  /^\\(?:[pP]\{[^}]*\}|u\{([0-9a-fA-F]+)\}|u([0-9a-fA-F]{4})|x([0-9a-fA-F]{2})|c([A-Za-z])|k<[^>]*>|\d+|([^]))/;
const GROUP_PREFIX_REGEX = /\((?:\?(?::|=|!|<=|<!|<[^>]*>))?/y;
const QUANTIFIER_REGEX = /^(?:([*+?])|\{(\d+)(,(\d*))?\})\??/;
const ANCHORED_START_REGEX =
  /^(?:\^|(?:[^\\[\](){}.*+?^$|]|\\(?:[^A-Za-z0-9]|[nrtfv]|u[0-9a-fA-F]{4}|x[0-9a-fA-F]{2}))(?![*?]|\{0[,}]))/;

const readQuantifier = (source: string, index: number) => {
  const match = QUANTIFIER_REGEX.exec(source.slice(index));
  if (!match) return { min: 1, unbounded: false, end: index };
  const [text, symbol, minimum, comma, maximum] = match;
  return {
    min: symbol === "*" || symbol === "?" ? 0 : symbol === "+" ? 1 : Number(minimum),
    unbounded: symbol === "*" || symbol === "+" || (comma !== undefined && maximum === ""),
    end: index + text.length,
  };
};

const longestChain = (chains: Wildcard[][]): Wildcard[] =>
  chains.reduce((longest, chain) => (chain.length > longest.length ? chain : longest));

type Atom = { length: number; literal?: string; wildcard?: Wildcard };

const decodeEscape = (
  length: number,
  braced: string | undefined,
  unicode: string | undefined,
  hex: string | undefined,
  control: string | undefined,
  other: string | undefined,
): Atom => {
  if (braced !== undefined) return { length, literal: String.fromCodePoint(parseInt(braced, 16)) };
  const code = unicode ?? hex;
  if (code !== undefined) return { length, literal: String.fromCharCode(parseInt(code, 16)) };
  if (control !== undefined)
    return { length, literal: String.fromCharCode(control.charCodeAt(0) % 32) };
  if (other === "S") return { length, wildcard: (character) => /\s/.test(character) };
  if (other === "D") return { length, wildcard: (character) => /\d/.test(character) };
  if (other === "W") return { length, wildcard: (character) => /\w/.test(character) };
  const controlEscape = other === undefined ? undefined : CONTROL_ESCAPES[other];
  if (controlEscape !== undefined) return { length, literal: controlEscape };
  if (other !== undefined && !/[A-Za-z0-9]/.test(other)) return { length, literal: other };
  return { length };
};

const escapedAtom = (source: string, index: number): Atom => {
  // A replacer receives the match without the nullable result exec returns.
  let atom: Atom = { length: 1 };
  source
    .slice(index)
    .replace(
      ESCAPE_REGEX,
      (
        text: string,
        braced: string | undefined,
        unicode: string | undefined,
        hex: string | undefined,
        control: string | undefined,
        other: string | undefined,
      ) => {
        atom = decodeEscape(text.length, braced, unicode, hex, control, other);
        return text;
      },
    );
  return atom;
};

// Unbounded wildcards that can each go on consuming what the previous one
// could compound: failing `.*\/.*x` tries every split of the input between
// them, so k such wildcards cost O(n^k) from one start position, and an
// unanchored search tries O(n) start positions. A required literal that a
// pending wildcard excludes (the `/` in `[^/]*\/[^/]*`) ends that wildcard's
// reach. Returns the resulting polynomial degree, conservatively approximated.
const backtrackingDegree = ({ source, flags }: RegExp): number => {
  const classFlags = flags.replace(/[gy]/g, "");
  const anyCharacter = new RegExp(".", classFlags);
  const dot: Wildcard = (character) => !anyCharacter.test(character);
  let frame: AlternationFrame = { start: [], ends: [] };
  const parents: AlternationFrame[] = [];
  let chain: Wildcard[] = [];
  let longest = 0;
  let topLevelAlternation = false;
  let index = 0;
  while (index < source.length) {
    const token = source.charAt(index);
    if (token === "(") {
      parents.push(frame);
      frame = { start: chain, ends: [] };
      GROUP_PREFIX_REGEX.lastIndex = index;
      GROUP_PREFIX_REGEX.test(source);
      index = GROUP_PREFIX_REGEX.lastIndex;
      continue;
    }
    if (token === "|") {
      topLevelAlternation ||= parents.length === 0;
      frame.ends.push(chain);
      chain = frame.start;
      index += 1;
      continue;
    }
    // A valid RegExp source closes only groups it opened; see the loop below.
    const parent = token === ")" ? parents.pop() : undefined;
    if (parent) {
      const closed = frame;
      frame = parent;
      chain = longestChain([...closed.ends, chain]);
      const quantifier = readQuantifier(source, index + 1);
      if (quantifier.min === 0) chain = longestChain([closed.start, chain]);
      index = quantifier.end;
      continue;
    }
    if (token === "^" || token === "$") {
      index += 1;
      continue;
    }
    let atom: Atom = {
      length: 1,
      literal: token,
    };
    if (token === "\\") {
      atom = escapedAtom(source, index);
    } else if (token === "[") {
      let end = index + 1;
      while (source.charAt(end) !== "]") end += source.charAt(end) === "\\" ? 2 : 1;
      atom = { length: end + 1 - index };
      if (source.charAt(index + 1) === "^") {
        // A negated class excludes exactly what the same class un-negated matches.
        const excluded = new RegExp(`[${source.slice(index + 2, end)}]`, classFlags);
        atom.wildcard = (character) => excluded.test(character);
      }
    } else if (token === ".") {
      atom = { length: 1, wildcard: dot };
    }
    const quantifier = readQuantifier(source, index + atom.length);
    const { literal, wildcard } = atom;
    if (wildcard && quantifier.unbounded) {
      chain = [...chain, wildcard];
      longest = Math.max(longest, chain.length);
    } else if (literal !== undefined && quantifier.min > 0) {
      chain = chain.filter((pending) => !pending(literal));
    }
    index = quantifier.end;
  }
  const anchored = !topLevelAlternation && ANCHORED_START_REGEX.test(source);
  return longest + (anchored ? 0 : 1);
};

// Conservative, linear structural check for the patterns most likely to
// backtrack catastrophically on long URLs or filenames. Rule parsing reports a
// failure only as a warning, so stored and imported rules keep loading and
// running; matchers bound the input they test instead, which keeps a
// degree-two pattern cheap but not a degree-three one. External VALIDATE
// traces refuse to run a pattern their own stricter isSafeExternalRegex rejects.
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
  return backtrackingDegree(regex) < 3;
};
