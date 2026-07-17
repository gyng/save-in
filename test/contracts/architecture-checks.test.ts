import checks from "../../scripts/lib/architecture-checks.js";

const {
  callsIdentifier,
  domReferences,
  hasBrowserListenerRegistration,
  hasDynamicImport,
  hasGlobalNamespaceMutation,
  stripCommentsAndStrings,
} = checks;

describe("architecture listener registration scanner", () => {
  test("detects direct and optional-chain registrations", () => {
    expect(hasBrowserListenerRegistration("browser.tabs.onUpdated.addListener(fn)")).toBe(true);
    expect(hasBrowserListenerRegistration("browser.tabs?.onUpdated?.addListener(fn)")).toBe(true);
  });

  test("detects destructured and assigned aliases", () => {
    expect(
      hasBrowserListenerRegistration("const { addListener: subscribe } = event; subscribe(fn)"),
    ).toBe(true);
    expect(
      hasBrowserListenerRegistration("const subscribe = event.addListener; subscribe(fn)"),
    ).toBe(true);
  });

  test("does not confuse ordinary event handling with registration", () => {
    expect(hasBrowserListenerRegistration("element.addEventListener('click', fn)")).toBe(false);
    expect(hasBrowserListenerRegistration("event.removeListener(fn)")).toBe(false);
  });
});

describe("architecture module scanner", () => {
  test("detects dynamic imports without confusing type import declarations", () => {
    expect(hasDynamicImport('const module = await import("./feature.ts")')).toBe(true);
    expect(hasDynamicImport('import type { Feature } from "./feature.ts"')).toBe(false);
  });

  test("detects direct mutation of the global namespace", () => {
    expect(hasGlobalNamespaceMutation("Object.assign(globalThis, { Feature })")).toBe(true);
    expect(hasGlobalNamespaceMutation("globalThis.Feature = Feature")).toBe(true);
    expect(hasGlobalNamespaceMutation("Object.defineProperty(globalThis, 'Feature', {})")).toBe(
      true,
    );
    expect(hasGlobalNamespaceMutation("const host = globalThis.browser")).toBe(false);
    expect(hasGlobalNamespaceMutation("globalThis.browser === chrome")).toBe(false);
    expect(hasGlobalNamespaceMutation("window.Feature = Feature")).toBe(true);
    expect(hasGlobalNamespaceMutation("self.Feature = Feature")).toBe(true);
  });

  test("detects composition calls by identifier", () => {
    expect(callsIdentifier("configureRoutingPorts({ getMessage })", "configureRoutingPorts")).toBe(
      true,
    );
    expect(
      callsIdentifier(
        "const configureRoutingPorts = (ports) => Object.assign(target, ports)",
        "configureRoutingPorts",
      ),
    ).toBe(false);
  });
});

describe("architecture DOM-reference scanner", () => {
  test("detects DOM access and DOM element types", () => {
    expect(domReferences("const list = document.querySelector('#history')")).toEqual(["document"]);
    expect(domReferences("const save = () => localStorage.setItem(key, value)")).toEqual([
      "localStorage",
    ]);
    expect(domReferences("type Row = { input: HTMLInputElement }")).toEqual(["HTMLInputElement"]);
    expect(domReferences("const icon = (): SVGSVGElement => build()")).toEqual(["SVGSVGElement"]);
    expect(domReferences("globalThis.document.title = name")).toEqual(["globalThis.document"]);
  });

  test("ignores the word in comments, strings, and template text", () => {
    expect(domReferences("// options.ts keeps the DOM rendering; document. It does.")).toEqual([]);
    expect(domReferences("/* a document. and an HTMLElement in prose */")).toEqual([]);
    expect(domReferences('const category = "document"')).toEqual([]);
    expect(domReferences("const help = `image, document, and media are categories`")).toEqual([]);
  });

  test("sees DOM access inside a template substitution", () => {
    expect(domReferences("const title = `page: ${document.title}`")).toEqual(["document"]);
    expect(domReferences("const nested = `a ${`b ${window.name}`}`")).toEqual(["window"]);
  });

  test("does not treat a domain name that merely contains a DOM word as DOM", () => {
    expect(domReferences("const documentKind = entry.documentKind")).toEqual([]);
    expect(domReferences("const kind = source.document")).toEqual([]);
    expect(domReferences("type Node = { left: Node | null }")).toEqual([]);
  });

  test("a quote inside a regex literal does not swallow the code after it", () => {
    // Without regex-literal handling the `"` below opens a phantom string and
    // the document.body call after it goes unseen.
    const source = String.raw`const quoted = /["']/; const body = document.body;`;
    expect(domReferences(source)).toEqual(["document"]);
  });

  test("keeps code and drops literal text when stripping", () => {
    expect(stripCommentsAndStrings("const a = 1; // trailing")).toContain("const a = 1;");
    expect(stripCommentsAndStrings('const a = "text"; const b = 2;')).toContain("const b = 2;");
    expect(stripCommentsAndStrings('const a = "text";')).not.toContain("text");
    expect(stripCommentsAndStrings("const a = `x ${b} y`;")).toContain("b");
    expect(stripCommentsAndStrings("const a = `x ${b} y`;")).not.toContain("x");
  });
});
