# ShellWhy

Shows how bash splits one command line into words and removes quotes, before any expansion.

Open `app.html` (GitHub Pages). Everything runs client side.

## Testing
`oracle.py <seed> <n> <out>` generates quoting-only lines (plain text, single, double, backslash, `$'...'`, unterminated cases) and has real bash 5.1.16 split them with `eval "set -- LINE"` (LC_ALL=C.UTF-8, globbing off). `test-engine.js` compares `engine.js` with that output.

- Debugging seeds: 226,000 lines (seeds 2-13 and others), 0 mismatches after fixes.
- Fresh seeds after the last engine change: 14, 15, 16, 17, 19, 20 (120,000 lines), 0 mismatches. Seed 18 crashed the oracle harness (record count mismatch) and was not used.
- Total 346,000 lines, 0 mismatches. Lines with operators, newlines or `$` expansions were skipped by the comparison (under 0.3% of lines).

## Limits
- Operators, comments, variables, `$(...)`, backticks, globs, braces and tilde are detected and shown, not evaluated.
- The bash manual could not be fetched. POSIX 2.2 Quoting was read. The `$'...'` rules come from testing bash 5.1.16, not from a document.
