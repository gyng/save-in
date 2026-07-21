# Coverage policy

The unit and integration suite enforces 100% statements, branches, functions,
and lines across the complete `src/` tree. `scripts/check-coverage-policy.js`
also fixes the source coverage-ignore ceiling at zero, so an ignored body
cannot make those percentages appear complete.

Do not add `v8 ignore` markers to production source. Exercise real error and
fallback behavior through the cheapest durable boundary. When a branch is
provably unreachable, express that invariant in its type or structure instead
of retaining dead defensive code. Composition scaffolds should reuse an
existing or native function rather than manufacture an uncallable placeholder
body.

Browser-owned operations still need an injectable port so tests can verify the
extension's sequencing and response. If the default implementation merely
delegates to a native function, bind that function directly; this leaves no
extension-owned body to exclude. Browser e2e remains responsible for verifying
the browser-owned effect.

Changing the zero ceiling requires an explicit policy decision and an update to
this contract. It must never be done merely to satisfy a coverage threshold.
