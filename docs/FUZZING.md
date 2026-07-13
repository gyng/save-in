# Fuzzing

Run the bounded property suite with `npm run test:fuzz`. It spends ten seconds
across directory parsing and edits, routing syntax and semantics, filename
safety, and webhook URL policy. Set `FUZZ_TIME_MS` for a longer campaign.

Failures report `FUZZ_PROPERTY`, `FUZZ_SEED`, and `FUZZ_PATH`. Pass those values
back through `scripts/with-env.js` to replay the minimized counterexample.

## Campaign record

| Date | Property time | Result | Bugs |
| --- | ---: | --- | ---: |
| 2026-07-14 | 3,595.61 seconds | Passed | 0 new bugs |

The recorded hour consists of a 69.94-second clean warm-up and a 3,525.67-second
uninterrupted campaign with a 3,600,000 ms configured budget. All six property
groups completed without a counterexample, crash, or hang.

## Bugs found

### Same-offset source edits were reordered

The initial fuzzing setup found that adding nesting, a path, and a comment to an
empty directory line applied equal-position insertions in the wrong order. A
minimized edit could become a comment-only line and lose the path. Commit
`ec43794` applies equal-position edits in reverse application order and includes
regressions at the source-edit and directory-grammar boundaries.

No additional bugs were found in the one-hour campaign on 2026-07-14.
