// node test-engine.js file.jsonl ...: engine vs real bash (eval "set -- LINE") on generated quoting-only command lines (oracle.py).
const S = require('./engine.js'), fs = require('fs');
let n = 0, agree = 0, okBash = 0, skipped = 0, skippedExp = 0, mism = [];
for (const f of process.argv.slice(2)) for (const l of fs.readFileSync(f, 'utf8').split('\n').filter(Boolean)) {
  const r = JSON.parse(l); n++;
  const a = S.analyse(r.s);
  if (a.status === 'ok' && a.hasOperators) { skipped++; continue; }
  if (a.status === 'ok' && a.argv === null && !a.hasOperators && a.words.some(w => w.parts.some(p => p.kind === 'exp'))) { skippedExp++; continue; }
  let eng;
  if (a.status === 'empty') eng = { ok: true, argv: [] };
  else if (a.status === 'error') eng = { ok: false };
  else eng = { ok: true, argv: a.argv };
  if (r.ok) okBash++;
  const same = eng.ok === r.ok && (!r.ok || JSON.stringify(eng.argv) === JSON.stringify(r.argv));
  if (same) agree++; else mism.push({ s: r.s, bash: r.ok ? r.argv : 'error', engine: eng.ok ? eng.argv : 'error' });
}
console.log(JSON.stringify({ lines: n, skippedBecauseOperators: skipped, skippedBecauseExpansion: skippedExp, bashAccepted: okBash, bashRejected: n - okBash, agree: agree, mismatches: mism.length }));
mism.slice(0, +process.env.SHOW || 0).forEach(m => console.log(JSON.stringify(m)));
process.exit(mism.length ? 1 : 0);
