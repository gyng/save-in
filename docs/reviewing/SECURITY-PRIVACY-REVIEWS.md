# Security and privacy reviews

Use this guide when reviewing Save In or a similar client-side WebExtension. It
captures the review method and lessons from the July 2026 security and privacy
scan. The goal is to find concrete trust-boundary failures without inflating
ordinary client-extension behavior into server-style vulnerabilities.

## Start with the extension's actual authority

Save In is client software with broad permissions because it discovers page
resources and starts browser downloads. Broad host access, readable local
storage, and user-directed network requests are not findings by themselves.
Report a problem only when the extension adds authority, crosses a boundary the
user would not expect, or handles untrusted data unsafely.

Use these principals and boundaries:

| Principal | Treat as untrusted for | Important qualification |
| --- | --- | --- |
| Web page | DOM data, URLs, response metadata, filenames, and synthetic events | A page must not turn content-script access into a privileged action without the configured real gesture or rule |
| Unapproved extension | External messages and resource use | Another installed extension already has meaningful local authority; rate its behavior by what Save In newly enables |
| Approved integration | Requested downloads and supplied metadata | Approval is capability-specific, not blanket access to private tabs or configuration |
| WebMCP agent | Tool inputs, prompt-injected instructions, and returned data | Deliberate full access is an accepted trust decision when accurately disclosed, not automatically a vulnerability |
| Remote origin | Bodies, redirects, latency, size, and server filenames | Distinguish intended download traffic from credential, private-data, or local-network amplification |
| Local profile or OS observer | Extension storage, browser downloads, clipboard, and notifications | A profile compromise is normally out of scope, but OS surfaces can violate a stated private-browsing promise |
| Imported configuration | Rules, regular expressions, automation, and endpoints | Preserve compatibility while preventing persistent resource exhaustion or silent disclosure |

Assume the browser, OS kernel, signed extension package, and update channel are
trusted unless the task expands the threat model. Supply-chain checks still
cover runtime dependencies, remote code, build provenance, and release contents.

## Review workflow

1. Record the exact snapshot. Note uncommitted files and whether they changed
   during the review. Never attribute existing changes to the review.
2. Map execution contexts: page, isolated content script, options page,
   background event page or service worker, offscreen document, and external
   extension callers.
3. Inventory permissions and externally reachable messages. For every message,
   identify which browser-authenticated sender fields are available and which
   handlers are internal-only.
4. Trace sensitive data from its untrusted source to privileged sinks:
   downloads, `fetch`, DNR rules, clipboard text, notifications, storage,
   configuration mutation, and agent tools.
5. Check privacy separately across extension storage, browser-owned download
   history, OS notifications, clipboard, logs, and remote endpoints. "Not saved
   by Save In" does not mean "not visible anywhere on the device."
6. Read tests to learn intended contracts, then reproduce at the cheapest
   durable boundary. Use browser tests for browser-owned isolation, private
   windows, real input trust, and MV3 lifecycle behavior.
7. Report confirmed, conditional, and accepted-risk items separately. Do not
   present a static hypothesis about browser behavior as a confirmed exploit.
8. For every proposed fix, state its compatibility, usability, privacy, and
   testing consequences. Also state the consequence of accepting the risk.

## High-value review areas

### Page and content-script boundary

- Treat all DOM attributes, current URLs, resource timing entries, and response
  metadata as attacker-controlled.
- Privileged gestures must rely on browser-trusted events. A page-generated DOM
  event has `isTrusted === false`.
- Verify third-party gesture integrations before changing input handling. Save
  In's supported Foxy Gestures and Gesturefy paths use cross-extension runtime
  messages; they do not depend on page-generated click-to-save events. A custom
  script that dispatches fake DOM events is not the same compatibility contract.
- Content scripts can outlive extension reloads, so security checks must retain
  the existing invalidated-context and service-worker retry behavior.

### Native and command-line hand-offs

- Never convert page-controlled text into executable shell commands unless the
  target shell and complete argument-quoting rules are explicit.
- There is no universal quoting syntax for POSIX shells, PowerShell, and Windows
  cmd. Prefer copying a raw URL or value and let the receiving application own
  invocation.
- A copy button creates a trust signal. User copy-and-paste is not a sufficient
  defense when the product advertises the copied text as a ready command.

### Messaging and integrations

- Check the browser-authenticated `sender.id` before resolving tabs or starting
  downloads for an external caller.
- Treat approval as a named capability. Ask whether active-tab lookup, private
  context, history, configuration, or response data exceed the visible grant.
- Rate-limit only where Save In adds meaningful amplification. An unapproved
  installed extension causing minor local notification churn is hardening work,
  not equivalent to a web-origin remote attack.
- Put size and shape limits before parsing, regex evaluation, persistence, or
  other expensive synchronous work.

### Routing and regular expressions

- JavaScript regex execution is synchronous and cannot be timed out in the same
  realm. A request-rate limit does not bound one pathological evaluation.
- Heuristic safe-regex filters need adversarial tests beyond nested quantified
  groups: ambiguous alternation, long optional prefixes, backreferences, and
  overlapping character classes.
- Apply new restrictions first at untrusted boundaries when tightening the
  stored routing language would break established profiles or imports.

### Downloads, paths, and network access

- Confirm every server-controlled filename passes through the common filename
  and path sanitizers before reaching `downloads.download`.
- Test separators, leading dots, reserved device names, invisible characters,
  byte limits, and absolute or parent paths.
- Review credential inclusion, redirects, local-network reachability, response
  size, timeout, and whether a hostile page can cause the request without a real
  gesture or eligible automation rule.
- DNR rules must stay exact, extension-initiated, serialized when sharing rule
  state, and removed in `finally` and cold-start recovery.

### Private browsing and persistence

- Carry a private marker to every storage, history, retry, webhook, diagnostic,
  and notification boundary.
- Distinguish runtime memory from persisted local or session storage.
- Check browser-owned and OS-owned surfaces separately. A generic private
  notification may preserve useful status without exposing a URL or filename.
- Test spanning-incognito behavior in both browsers before claiming that one
  extension can relay private tab data to another.

### Agent and automation tools

- Inventory tool read scope, mutation scope, download capability, registration
  lifetime, and sensitive returned fields.
- Tool annotations are hints to a host, not extension-enforced authorization.
- If the product deliberately offers full access, describe the complete trust
  decision and residual prompt-injection risk. Do not relabel intended full
  access as a bypass merely because a more restrictive design is possible.

## Finding quality bar

Each finding should contain:

- A short title naming the failed boundary, not just the dangerous primitive.
- Severity and confidence: confirmed, conditional, or accepted residual risk.
- Exact source and sink with clickable file and line references.
- Preconditions, including default-off settings, prior approval, user gesture,
  private-mode access, or another installed extension.
- A harmless reproduction using an invalid domain or disposable browser profile.
- Concrete impact limited to what the demonstrated path enables.
- The implications of fixing: compatibility, UX, migration, browser support,
  performance, and tests.
- The implications of not fixing: affected users, likelihood, blast radius, and
  available mitigations.
- A disposition: fix before release, fix soon, browser-verify, document and
  accept, or backlog hardening.

Do not assign severity from a keyword such as "regex," "all_urls," "secret," or
"private" alone. Calibrate it from reachability and added authority:

| Typical level | Extension-focused meaning |
| --- | --- |
| High | A hostile web page or remote origin can plausibly reach local code execution, credential theft, or equivalent impact through an advertised workflow |
| Medium | A page, approved integration, or unapproved extension crosses a meaningful browser boundary or can reliably deny service with realistic prerequisites |
| Low | Local nuisance, defense in depth, or behavior requiring an already-powerful malicious extension without substantial authority amplification |
| Accepted risk | Behavior matches an explicit product capability and is accurately disclosed; record residual consequences without calling it a bypass |

## Reproduction safety

- Use `example.invalid`, harmless commands such as `id`, small regex sizes, and
  disposable browser profiles.
- Never provide an unbounded request loop or a regex size likely to freeze the
  user's normal profile.
- For a command-injection proof, inspect the generated text first and replace
  the real downloader with a harmless printer.
- Say when a reproduction was not executed. Browser-private and cross-extension
  behavior should remain conditional until verified in Chrome and Firefox.

## Lessons from the 2026 review

- The most important finding was not a broad permission. It was a hostile page
  URL converted into a trusted-looking yt-dlp shell command. The durable fix is
  to copy only the URL, avoiding shell-specific quoting entirely.
- Synthetic click-to-save events crossed a real page-to-extension boundary.
  Requiring trusted events does not break the documented Foxy Gestures API,
  because that integration uses browser-authenticated extension messaging.
- Several other observations were useful but lower priority in a client
  extension: notification churn from an installed extension, OS notification
  privacy, and conditional spanning-incognito behavior. Report them with their
  prerequisites instead of presenting all findings at the same urgency.
- WebMCP full configuration access was an explicit product choice. The review's
  job is to make that trust model legible and identify its residual risk, not to
  reintroduce consent or redaction after the product decision is clear.

## Completion checklist

Before handing off a review or security fix:

- Confirm the final worktree and preserve unrelated user changes.
- Re-run focused regression tests, lint and i18n policy for changed UI copy,
  typecheck, and the browser suites in proportion to the boundary changed.
- Verify both Firefox event-page and Chrome service-worker behavior for shared
  background changes.
- Re-read privacy and integration documentation when behavior or disclosure
  changes.
- Report tests that were not run and any findings that remain conditional.
