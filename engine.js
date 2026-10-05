/* ShellWhy engine: how bash splits one command line into words and removes quotes (before any expansion). */
(function (root) {
  'use strict';
  var OPS = /^(&&|\|\||;;&|;;|;&|<<<|<<-|<<|>>|<&|>&|<>|>\||&>>|&>|\|&|[;&|<>()])/;
  function isBlank(c) { return c === ' ' || c === '\t'; }
  function hex(s) { return /^[0-9A-Fa-f]+$/.test(s); }

  function ansiC(src, i, fail) {
    /* src[i] is the char after $' ; returns {text, end, notes} */
    var bytes = [], notes = [], enc = new TextEncoder();
    function put(str) { var b = enc.encode(str); for (var q = 0; q < b.length; q++) bytes.push(b[q]); }
    function done() { var u = new Uint8Array(bytes); try { return new TextDecoder('utf-8', { fatal: true }).decode(u); } catch (e) { notes.push('invalid UTF-8 bytes'); return new TextDecoder('utf-8').decode(u); } }
    for (;;) {
      if (i >= src.length) return fail('Unterminated $\'...\' string', i);
      var c = src[i];
      if (c === "'") return { text: done(), end: i + 1, notes: notes };
      if (c !== '\\') { put(c); i++; continue; }
      var e = src[i + 1];
      if (e === undefined) return fail('Unterminated $\'...\' string', i);
      var simple = { a: '\x07', b: '\b', e: '\x1b', E: '\x1b', f: '\f', n: '\n', r: '\r', t: '\t', v: '\v', '\\': '\\', "'": "'", '"': '"', '?': '?' };
      if (simple[e] !== undefined) { put(simple[e]); i += 2; continue; }
      if (/[0-7]/.test(e)) { var o = /^[0-7]{1,3}/.exec(src.slice(i + 1))[0]; var v = parseInt(o, 8) & 255; if (v === 0) notes.push('\\0 ends the string in bash'); bytes.push(v); i += 1 + o.length; continue; }
      if (e === 'x') { var h = /^[0-9A-Fa-f]{1,2}/.exec(src.slice(i + 2)); if (h) { bytes.push(parseInt(h[0], 16)); i += 2 + h[0].length; continue; } put('\\x'); i += 2; continue; }
      if (e === 'u' || e === 'U') { var h2 = new RegExp('^[0-9A-Fa-f]{1,' + (e === 'u' ? 4 : 8) + '}').exec(src.slice(i + 2)); if (h2) { put(String.fromCodePoint(parseInt(h2[0], 16))); i += 2 + h2[0].length; continue; } put('\\' + e); i += 2; continue; }
      if (e === 'c' && src[i + 2] !== undefined) { bytes.push(src[i + 2].toUpperCase().charCodeAt(0) ^ 64); i += 3; continue; }
      put('\\' + e); i += 2;
    }
  }

  /* skip a $( ... ), ${ ... } or `...` construct, honouring nested quotes; returns end index or -1 */
  function skipExpansion(src, i) {
    var open = src[i + 1], close = open === '(' ? ')' : '}', depth = 0, j = i + 1;
    for (; j < src.length; j++) {
      var c = src[j];
      if (c === '\\') { j++; continue; }
      if (c === "'") { var q = src.indexOf("'", j + 1); if (q < 0) return -1; j = q; continue; }
      if (c === '"') { j++; while (j < src.length && src[j] !== '"') { if (src[j] === '\\') j++; j++; } continue; }
      if (c === open) depth++;
      else if (c === close) { depth--; if (depth === 0) return j + 1; }
    }
    return -1;
  }

  /* bash removes backslash-newline before parsing, except inside single quotes (and $'...') */
  function stripContinuations(src) {
    var out = '', i = 0, n = src.length, mode = 'n';
    while (i < n) {
      var c = src[i];
      if (mode === 'sq') { out += c; i++; if (c === "'") mode = 'n'; continue; }
      if (mode === 'an') { if (c === '\\' && i + 1 < n) { out += c + src[i + 1]; i += 2; continue; } out += c; i++; if (c === "'") mode = 'n'; continue; }
      if (c === '\\') { if (src[i + 1] === '\n') { i += 2; continue; } out += c + (src[i + 1] === undefined ? '' : src[i + 1]); i += 2; continue; }
      if (mode === 'dq') { out += c; i++; if (c === '"') mode = 'n'; continue; }
      if (c === '#' && (out === '' || ' \t\n;&|()<>'.indexOf(out[out.length - 1]) >= 0)) { var nl = src.indexOf('\n', i); if (nl < 0) nl = n; out += src.slice(i, nl); i = nl; continue; }
      if (c === "'") mode = 'sq'; else if (c === '"') mode = 'dq'; else if (c === '$' && src[i + 1] === "'") { out += "$'"; i += 2; mode = 'an'; continue; }
      out += c; i++;
    }
    return out;
  }
  function tokenize(src) {
    src = stripContinuations(src);
    var i = 0, n = src.length, tokens = [], word = null;
    var err = null;
    function fail(msg, pos) { err = { msg: msg, pos: pos }; return null; }
    function startWord() { if (!word) word = { start: i, parts: [], flags: [], value: '', computable: true }; return word; }
    function endWord() { if (word) { word.end = i; word.src = src.slice(word.start, i); tokens.push({ kind: 'word', word: word }); word = null; } }
    function add(kind, text, raw) { var w = startWord(); w.parts.push({ kind: kind, text: text, raw: raw }); if (w.computable) w.value += text; }
    function flag(f) { if (word.flags.indexOf(f) < 0) word.flags.push(f); }
    function expansion(raw, what, inDq) { var w = startWord(); w.parts.push({ kind: 'exp', text: raw, raw: raw }); w.computable = false; flag(what + (inDq ? ' (still happens inside double quotes)' : '')); }
    while (i < n) {
      var c = src[i];
      if (isBlank(c)) { endWord(); i++; continue; }
      if (c === '\n') { endWord(); tokens.push({ kind: 'newline', pos: i }); i++; continue; }
      if (c === '\\') {
        if (src[i + 1] === '\n') { i += 2; continue; }
        if (i + 1 >= n) { startWord(); add('bs', '\\', '\\'); flag('A trailing backslash with nothing after it: bash waits for more input'); i++; err = err || { msg: 'The line ends with a backslash, so bash would wait for another line', pos: i - 1, soft: true }; continue; }
        add('bs', src[i + 1], src.slice(i, i + 2)); i += 2; continue;
      }
      if (c === "'") { var q = src.indexOf("'", i + 1); if (q < 0) return fail('Unterminated single quote. Everything after it is inside the quote, and a single quote cannot be escaped inside single quotes', i) || { err: err, tokens: tokens }; add('sq', src.slice(i + 1, q), src.slice(i, q + 1)); i = q + 1; continue; }
      if (c === '"') {
        var j = i + 1, txt = '', closed = false, hasExp = false;
        startWord(); var partStart = word.parts.length;
        var seg = '';
        while (j < n) {
          var d = src[j];
          if (d === '"') { closed = true; break; }
          if (d === '\\') { var e = src[j + 1]; if (e === '\n') { j += 2; continue; } if (e === '$' || e === '`' || e === '"' || e === '\\') { seg += e; j += 2; continue; } seg += '\\'; j++; continue; }
          if (d === '$' && (src[j + 1] === '(' || src[j + 1] === '{')) { var end = skipExpansion(src, j); if (end < 0) return fail('Unterminated ' + (src[j + 1] === '(' ? '$(' : '${') + ' inside double quotes', j) || { err: err, tokens: tokens }; seg += ''; if (seg) { word.parts.push({ kind: 'dq', text: seg, raw: seg }); } seg = ''; expansion(src.slice(j, end), src[j + 1] === '(' ? (src[j + 2] === '(' ? 'arithmetic expansion' : 'command substitution') : 'parameter expansion', true); j = end; hasExp = true; continue; }
          if (d === '$' && /[A-Za-z_0-9@*#?$!-]/.test(src[j + 1] || '')) { var m = /^\$([A-Za-z_][A-Za-z0-9_]*|[0-9@*#?$!-])/.exec(src.slice(j)); if (m) { if (seg) word.parts.push({ kind: 'dq', text: seg, raw: seg }); seg = ''; expansion(m[0], 'variable ' + m[0], true); j += m[0].length; hasExp = true; continue; } }
          if (d === '`') { var b = src.indexOf('`', j + 1); if (b < 0) return fail('Unterminated backtick', j) || { err: err, tokens: tokens }; if (seg) word.parts.push({ kind: 'dq', text: seg, raw: seg }); seg = ''; expansion(src.slice(j, b + 1), 'command substitution', true); j = b + 1; hasExp = true; continue; }
          seg += d; j++;
        }
        if (!closed) return fail('Unterminated double quote. Everything after it is inside the quote', i) || { err: err, tokens: tokens };
        /* rebuild: the quoted run as one visual part list with raw text */
        var rawQ = src.slice(i, j + 1);
        if (seg || !hasExp) word.parts.push({ kind: 'dq', text: seg, raw: seg });
        word.parts[partStart].quoteRaw = rawQ;
        if (word.computable) { var vv = ''; for (var k = partStart; k < word.parts.length; k++) vv += word.parts[k].kind === 'dq' ? word.parts[k].text : ''; word.value += vv; }
        i = j + 1; continue;
      }
      if (c === '$' && src[i + 1] === "'") { var r = ansiC(src, i + 2, fail); if (!r) return { err: err, tokens: tokens }; var t = r.text; var z = t.indexOf('\0'); if (z >= 0) t = t.slice(0, z); add('ansi', t, src.slice(i, r.end)); i = r.end; continue; }
      if (c === '$' && src[i + 1] === '"') { startWord(); flag('$"..." is a translation quote; without a message catalog it behaves like "..."'); i++; continue; }
      if (c === '$' && (src[i + 1] === '(' || src[i + 1] === '{')) { var end2 = skipExpansion(src, i); if (end2 < 0) return fail('Unterminated ' + (src[i + 1] === '(' ? '$(' : '${'), i) || { err: err, tokens: tokens }; expansion(src.slice(i, end2), src[i + 1] === '(' ? (src[i + 2] === '(' ? 'arithmetic expansion' : 'command substitution') : 'parameter expansion', false); i = end2; continue; }
      if (c === '$') { var m2 = /^\$([A-Za-z_][A-Za-z0-9_]*|[0-9@*#?$!-])/.exec(src.slice(i)); if (m2) { expansion(m2[0], 'variable ' + m2[0], false); i += m2[0].length; continue; } add('lit', '$', '$'); i++; continue; }
      if (c === '`') { var b2 = src.indexOf('`', i + 1); if (b2 < 0) return fail('Unterminated backtick', i) || { err: err, tokens: tokens }; expansion(src.slice(i, b2 + 1), 'command substitution', false); i = b2 + 1; continue; }
      var om = OPS.exec(src.slice(i, i + 4));
      if (om) {
        endWord(); tokens.push({ kind: 'op', text: om[0], pos: i }); i += om[0].length; continue;
      }
      if (c === '#' && !word) { var nl = src.indexOf('\n', i); var stop = nl < 0 ? n : nl; tokens.push({ kind: 'comment', text: src.slice(i, stop), pos: i }); i = stop; continue; }
      /* ordinary character */
      var w2 = startWord();
      if (c === '~' && w2.parts.length === 0) { var tm = /^~[^\/ \t\n'"\\$`]*/.exec(src.slice(i)); add('lit', tm[0], tm[0]); w2.computable = false; flag('tilde expansion (~ at the start of a word becomes a home directory)'); i += tm[0].length; continue; }
      if (c === '*' || c === '?' || c === '[') { add('lit', c, c); flag('glob character ' + c + ' (the word may be replaced by matching file names)'); w2.glob = true; i++; continue; }
      if (c === '{') { var bm = /^\{[^{}\s]*(,|\.\.)[^{}\s]*\}/.exec(src.slice(i)); if (bm) { add('lit', bm[0], bm[0]); w2.computable = false; flag('brace expansion ' + bm[0] + ' (becomes several words)'); i += bm[0].length; continue; } }
      if (c === '!' && !w2.parts.length) flag('"!" can trigger history expansion in an interactive shell');
      add('lit', c, c); i++;
    }
    endWord();
    return { err: err && !err.soft ? err : null, softErr: err && err.soft ? err : null, tokens: tokens };
  }

  function analyse(src) {
    if (!src.trim()) return { status: 'empty' };
    var t = tokenize(src);
    if (t.err) return { status: 'error', error: t.err, tokens: t.tokens };
    var words = t.tokens.filter(function (x) { return x.kind === 'word'; }).map(function (x) { return x.word; });
    var hasOp = t.tokens.some(function (x) { return x.kind === 'op' || x.kind === 'newline'; });
    var argv = !hasOp && words.every(function (w) { return w.computable; }) ? words.map(function (w) { return w.value; }) : null;
    return { status: 'ok', tokens: t.tokens, words: words, argv: argv, hasOperators: hasOp, soft: t.softErr };
  }

  var api = { analyse: analyse, tokenize: tokenize };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.ShellWhy = api;
})(typeof window !== 'undefined' ? window : globalThis);
