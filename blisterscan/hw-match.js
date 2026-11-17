/* BlisterScan – dopasowanie nazw Hot Wheels (OCR / wpisane / z wyszukiwarki) */
(function (root) {
  "use strict";
  function norm(s) {
    return String(s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase()
      .replace(/[’‘`´]/g, "'").replace(/[^A-Z0-9' ]+/g, " ").replace(/\s+/g, " ").trim();
  }
  function key(s) { return norm(s).replace(/[^A-Z0-9]/g, ""); }
  // typowe pomyłki OCR: 1/I/L, 0/O/D/Q, 5/S, 8/B, 2/Z, 6/G
  var FOLD = { "1": "I", "L": "I", "0": "O", "D": "O", "Q": "O", "5": "S", "8": "B", "2": "Z", "6": "G" };
  function fold(k) { return k.replace(/[1L0DQ5826]/g, function (c) { return FOLD[c]; }); }
  function lev(a, b) {
    var m = a.length, n = b.length;
    if (!m) return n; if (!n) return m;
    var prev = new Array(n + 1), cur = new Array(n + 1), i, j;
    for (j = 0; j <= n; j++) prev[j] = j;
    for (i = 1; i <= m; i++) {
      cur[0] = i;
      var ca = a.charCodeAt(i - 1);
      for (j = 1; j <= n; j++) {
        var c = ca === b.charCodeAt(j - 1) ? 0 : 1;
        var v = prev[j - 1] + c, d = prev[j] + 1, ins = cur[j - 1] + 1;
        cur[j] = v < d ? (v < ins ? v : ins) : (d < ins ? d : ins);
      }
      var t = prev; prev = cur; cur = t;
    }
    return prev[n];
  }
  function sim(a, b) { if (!a || !b) return 0; return 1 - lev(a, b) / Math.max(a.length, b.length); }

  var GENERIC = { HOTWHEELS: 1, HOTWHEEL: 1, MATTEL: 1, HW: 1 };
  function prepare(db) {
    if (db.__ready) return db;
    db.cars.forEach(function (c) {
      c.k = key(c.n); c.f = fold(c.k);
      c.words = norm(c.n).split(" ").length;
    });
    db.byCode = {};
    db.cars.forEach(function (c) { (c.t || []).forEach(function (t) { db.byCode[t] = c; }); });
    db.thSet = {}; (db.thc || []).forEach(function (t) { db.thSet[t] = 1; });
    db.sthSet = {}; (db.sthc || []).forEach(function (t) { db.sthSet[t] = 1; });
    db.__ready = true;
    return db;
  }

  // Tekst z OCR / tytułu -> najlepsze dopasowania [{car, score, raw}]
  function matchText(text, db, opts) {
    opts = opts || {};
    prepare(db);
    var min = opts.min || 0.78;
    var best = {};
    // kody modeli (np. HTC28) – pewne trafienie
    var codes = String(text || "").toUpperCase().match(/\b[A-Z]{3}\d{2}\b/g) || [];
    codes.forEach(function (cd) { var c = db.byCode[cd]; if (c) best[c.n] = { car: c, score: 1.01, raw: cd, code: cd }; });
    var lines = String(text || "").split(/\n|\s{3,}|[|]/);
    lines.forEach(function (line) {
      var toks = norm(line).split(" ").filter(function (t) { return t; });
      for (var i = 0; i < toks.length; i++) {
        var w = "";
        for (var len = 1; len <= 6 && i + len <= toks.length; len++) {
          w += toks[i + len - 1].replace(/'/g, "");
          if (w.length < 4 || GENERIC[w]) continue;
          var fw = fold(w);
          for (var ci = 0; ci < db.cars.length; ci++) {
            var c = db.cars[ci];
            var L = c.f.length;
            if (Math.abs(L - fw.length) > Math.max(2, L * 0.25)) continue;
            if (fw.charCodeAt(0) !== c.f.charCodeAt(0) && fw.charCodeAt(1) !== c.f.charCodeAt(1)) continue;
            var s = fw === c.f ? 1 : sim(fw, c.f);
            if (L < 6 && s < 1) continue;
            if (L < 9 && s < 0.85) continue;
            if (s >= min && (!best[c.n] || best[c.n].score < s)) best[c.n] = { car: c, score: s, raw: toks.slice(i, i + len).join(" ") };
          }
        }
      }
    });
    var out = Object.keys(best).map(function (k) { return best[k]; });
    // dłuższa nazwa przy tym samym wyniku wygrywa (np. "Volkswagen T2 Pickup" > "Volkswagen")
    out.sort(function (a, b) { return (b.score - a.score) || (b.car.k.length - a.car.k.length); });
    // usuń krótsze nazwy zawarte w lepszym trafieniu
    var res = [];
    out.forEach(function (o) {
      if (res.some(function (r) { return r.car.k.indexOf(o.car.k) !== -1 && r.score >= o.score - 0.05; })) return;
      res.push(o);
    });
    return res.slice(0, opts.limit || 5);
  }

  // Wpisywanie / autouzupełnianie
  function search(q, db, limit) {
    prepare(db);
    var qn = norm(q).replace(/\bVW\b/g, "VOLKSWAGEN").replace(/\bCHEVY\b/g, "CHEV").replace(/'/g, "");
    var qt = qn.split(" ").filter(function (x) { return x; });
    var k = key(q); if (!k) return [];
    var up = k.toUpperCase();
    if (/^[A-Z]{3}\d{2}$/.test(up) && db.byCode[up]) return [{ car: db.byCode[up], score: 2, code: up }];
    var fq = fold(k), res = [];
    db.cars.forEach(function (c) {
      var s;
      if (c.k === k) s = 1.5;
      else if (c.k.indexOf(k) === 0) s = 1.3;
      else if (c.k.indexOf(k) !== -1) s = 1.1;
      else if (qt.length > 1 && qt.every(function (x) { return norm(c.n).replace(/'/g, "").split(" ").some(function (w) { return w.indexOf(x) === 0; }); })) s = 1.05;
      else {
        // podobieństwo do początku nazwy o tej samej długości
        s = Math.max(sim(fq, c.f.slice(0, fq.length)) - 0.15, sim(fq, c.f));
      }
      if (s >= 0.7) res.push({ car: c, score: s });
    });
    res.sort(function (a, b) { return (b.score - a.score) || (a.car.k.length - b.car.k.length); });
    return res.slice(0, limit || 6);
  }

  // Czy tytuł oferty pasuje do modelu
  var SYN = { VW: "VOLKSWAGEN", CHEVY: "CHEVROLET", MERC: "MERCEDES" };
  function offerMatches(title, name) {
    var t = " " + norm(title).replace(/\b(VW|CHEVY)\b/g, function (m) { return m + " " + SYN[m]; }) + " ";
    var tk = key(title);
    var toks = norm(name).replace(/'/g, "").split(" ").filter(function (x) { return x.length >= 2 || /\d/.test(x); });
    if (!toks.length) return false;
    var hit = 0;
    toks.forEach(function (x) { if (t.indexOf(" " + x + " ") !== -1 || t.replace(/'/g, "").indexOf(" " + x + " ") !== -1 || (x.length >= 5 && tk.indexOf(x) !== -1)) hit++; });
    return hit / toks.length >= (toks.length <= 2 ? 1 : 0.75);
  }

  root.HWMatch = { norm: norm, key: key, fold: fold, sim: sim, prepare: prepare, matchText: matchText, search: search, offerMatches: offerMatches };
  if (typeof module !== "undefined" && module.exports) module.exports = root.HWMatch;
})(typeof window !== "undefined" ? window : globalThis);
