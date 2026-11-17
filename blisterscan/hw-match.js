/* BlisterScan v4 – dopasowanie Hot Wheels: kod modelu (tył blistra), nazwa (przód), seria + numer */
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
    db.codeList = Object.keys(db.byCode);
    db.series = {};
    db.cars.forEach(function (c) {
      (c.sx || []).forEach(function (x) {
        var m = /^(.*?)\s+(\d{1,2})\/(\d{1,2})$/.exec(x); if (!m) return;
        var sk = key(m[1]); if (!sk) return;
        var e = db.series[sk] || (db.series[sk] = { name: m[1], k: sk, f: fold(sk), items: [] });
        e.items.push({ car: c, n: +m[2], of: +m[3] });
      });
    });
    db.seriesList = Object.keys(db.series).map(function (k) { return db.series[k]; });
    db.thSet = {}; (db.thc || []).forEach(function (t) { db.thSet[t] = 1; });
    db.sthSet = {}; (db.sthc || []).forEach(function (t) { db.sthSet[t] = 1; });
    db.__ready = true;
    return db;
  }


  // ---------- kod modelu z tyłu blistra: HTB68-N7C5 (liczy się pierwsze 5 znaków) ----------
  var TO_LET = { "0": "OD", "1": "IL", "5": "S", "8": "B", "6": "G", "2": "Z", "4": "A", "7": "T" };
  var TO_DIG = { "O": "0", "D": "0", "Q": "0", "I": "1", "L": "1", "S": "5", "B": "8", "G": "6", "Z": "2", "A": "4", "T": "7", "E": "3" };
  function codeVariants(tok) {
    // zwraca [{code, subs}] – warianty z typowymi pomyłkami OCR; litery na pozycjach 0-2, cyfry na 3-4
    var out = [{ s: "", n: 0 }], i, j;
    for (i = 0; i < 5; i++) {
      var ch = tok.charAt(i), opts = [[ch, 0]];
      if (i < 3) { if (TO_LET[ch]) TO_LET[ch].split("").forEach(function (c) { opts.push([c, 1]); }); }
      else if (TO_DIG[ch]) opts.push([TO_DIG[ch], 1]);
      var next = [];
      out.forEach(function (o) { opts.forEach(function (p) { if (o.n + p[1] <= 3) next.push({ s: o.s + p[0], n: o.n + p[1] }); }); });
      out = next;
    }
    return out;
  }
  function ham(a, b, max) { var d = 0; for (var i = 0; i < a.length; i++) if (a.charAt(i) !== b.charAt(i) && ++d > max) return d; return d; }
  // [{car, code, score, raw, sure}] – najlepsze pierwsze
  function extractCodes(text, db) {
    prepare(db);
    var up = String(text || "").toUpperCase().replace(/[’‘`´]/g, "'");
    var found = {};
    function add(code, score, raw, sure) {
      var c = db.byCode[code]; if (!c) return;
      if (!found[code] || found[code].score < score) found[code] = { car: c, code: code, score: score, raw: raw, sure: !!sure };
    }
    var re = /(?:^|[^A-Z0-9])([A-Z0-9]{5})(?:\s?[-–—_.:]\s?([A-Z0-9]{3,5}))?(?=$|[^A-Z0-9])/g, m, toks = [];
    while ((m = re.exec(up))) { toks.push({ t: m[1], suf: m[2] || "" }); re.lastIndex = m.index + m[0].length - 1; }
    // sklejone "HTB 68" -> HTB68
    var re2 = /(?:^|[^A-Z0-9])([A-Z0-9]{3})\s([A-Z0-9]{2})(?:\s?[-–—_.:]\s?([A-Z0-9]{3,5}))?(?=$|[^A-Z0-9])/g;
    while ((m = re2.exec(up))) toks.push({ t: m[1] + m[2], suf: m[3] || "", joined: true });
    toks.forEach(function (tk) {
      var bonus = tk.suf ? 0.04 : 0;
      if (!/^[A-Z0-9]{3}[0-9OQDILSBGZAET]{2}$/.test(tk.t)) return;
      var hit = false;
      codeVariants(tk.t).forEach(function (v) {
        if (db.byCode[v.s]) { add(v.s, 1.01 - v.n * 0.03 + bonus - (tk.joined ? 0.02 : 0), tk.t + (tk.suf ? "-" + tk.suf : ""), v.n === 0); hit = true; }
      });
      if (!hit && /^[A-Z0-9]{3}[0-9OQDILSBGZAET]{2}$/.test(tk.t) && (tk.suf || /^[HJG][A-Z0-9]{2}\d{2}$/.test(tk.t))) {
        // jeden błędny znak (np. T↔I, H↔N): przyjmij tylko, gdy dokładnie jeden kod pasuje
        var near = [];
        for (var i = 0; i < db.codeList.length; i++) if (ham(tk.t, db.codeList[i], 1) <= 1) near.push(db.codeList[i]);
        if (near.length === 1) add(near[0], 0.8 + bonus, tk.t, false);
      }
    });
    return Object.keys(found).map(function (k) { return found[k]; }).sort(function (a, b) { return b.score - a.score; });
  }

  // ---------- seria + numer, np. "HW MODIFIED 6/10" ----------
  function matchSeries(text, db) {
    prepare(db);
    var up = String(text || "").toUpperCase(), out = [], seen = {};
    var re = /([0-9OIlSB]{1,2})\s*[\/|\\]\s*([0-9OIlSB]{1,2})/g, m;
    function dg(x) { return +x.replace(/[OQD]/g, "0").replace(/[Il]/g, "1").replace(/S/g, "5").replace(/B/g, "8"); }
    var nums = [];
    while ((m = re.exec(up))) {
      var a = dg(m[1]), b = dg(m[2]);
      if ((b === 5 || b === 10) && a >= 1 && a <= b) nums.push({ n: a, of: b, at: m.index });
    }
    if (!nums.length) return [];
    var nt = norm(up).replace(/'/g, "").split(" ").filter(function (x) { return x; });
    db.seriesList.forEach(function (se) {
      var words = se.k.length >= 6 ? [se.f] : [];
      var best = 0;
      for (var i = 0; i < nt.length; i++) {
        var w = "";
        for (var len = 1; len <= 4 && i + len <= nt.length; len++) {
          w += nt[i + len - 1]; if (w.length < 5) continue;
          var sc = sim(fold(w), se.f); if (sc > best) best = sc;
        }
      }
      if (best < 0.82) return;
      se.items.forEach(function (it) {
        nums.forEach(function (nm) {
          if (it.n === nm.n && it.of === nm.of && !seen[it.car.n]) { seen[it.car.n] = 1; out.push({ car: it.car, score: 0.6 + best * 0.1, raw: se.name + " " + nm.n + "/" + nm.of, via: "seria" }); }
        });
      });
    });
    return out;
  }

  // Tekst z OCR / tytułu -> najlepsze dopasowania [{car, score, raw}]
  function matchText(text, db, opts) {
    opts = opts || {};
    prepare(db);
    var min = opts.min || 0.78;
    var best = {};
    // kod modelu (tył blistra) – najpewniejszy sygnał
    extractCodes(text, db).forEach(function (cd) { best[cd.car.n] = { car: cd.car, score: cd.score, raw: cd.raw, code: cd.code, via: "kod", sure: cd.sure }; });
    var lines = String(text || "").split(/\n|\s{3,}|[|]/);
    lines.forEach(function (line) {
      var toks = norm(line).split(" ").filter(function (t) { return t; });
      for (var i = 0; i < toks.length; i++) {
        var w = "";
        for (var len = 1; len <= 6 && i + len <= toks.length; len++) {
          w += toks[i + len - 1].replace(/'/g, "");
          if (w.length < 4 || GENERIC[w]) continue;
          var fw = fold(w);
          if (sim(fw, fold("HOTWHEELS")) >= 0.7 || sim(fw, fold("MATTEL")) >= 0.8) continue; // nadruk "Hot Wheels" to nie model
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
    res.forEach(function (r) { if (!r.via) r.via = "nazwa"; });
    // seria + numer: dodatkowy sygnał (wzmacnia zgodne nazwy, ratuje gdy brak kodu i nazwy)
    var ser = matchSeries(text, db);
    if (ser.length) {
      res.forEach(function (r) { if (ser.some(function (x) { return x.car.n === r.car.n; })) { r.score = Math.min(1.02, r.score + 0.03); r.seriesOk = true; } });
      if (!res.length && ser.length <= 3) ser.forEach(function (x) { res.push(x); });
      res.sort(function (a, b) { return (b.score - a.score) || (b.car.k.length - a.car.k.length); });
    }
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

  root.HWMatch = { extractCodes: extractCodes, matchSeries: matchSeries, norm: norm, key: key, fold: fold, sim: sim, prepare: prepare, matchText: matchText, search: search, offerMatches: offerMatches };
  if (typeof module !== "undefined" && module.exports) module.exports = root.HWMatch;
})(typeof window !== "undefined" ? window : globalThis);
