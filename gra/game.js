(() => {
  "use strict";

  const canvas = document.getElementById("game");
  const ctx = canvas.getContext("2d");
  const overlay = document.getElementById("overlay");
  const overlayTitle = document.getElementById("overlayTitle");
  const overlayText = document.getElementById("overlayText");
  const startBtn = document.getElementById("startBtn");
  const scoreEl = document.getElementById("score");
  const levelLabel = document.getElementById("levelLabel");
  const axesLeftEl = document.getElementById("axesLeft");
  const toastEl = document.getElementById("toast");
  const axeEl = document.getElementById("axeSprite");

  const W = canvas.width;
  const H = canvas.height;
  const GROUND = H * 0.78;

  // Proca (slingshot) — punkty zakotwiczenia
  const SLING = {
    baseX: 175,
    baseY: GROUND - 8,
    left: { x: 152, y: GROUND - 130 },
    right: { x: 198, y: GROUND - 130 },
    rest: { x: 185, y: GROUND - 108 },
  };

  const MAX_PULL = 160;
  const GRAVITY = 980;
  const DRAG = 0.9994;

  const imgs = {};
  const ASSETS = {
    bg: "assets/bg.jpg",
    bgAlt: "assets/bg-alt.jpg",
    bgNight: "assets/bg-night.jpg",
    hero: "assets/hero.png",
    target: "assets/target.png",
    mushroom: "assets/mushroom.png",
  };

  const LEVELS = [
    {
      name: "Polana",
      bg: "bg",
      axes: 5,
      mushrooms: [
        { x: 720, y: GROUND - 8, r: 56 },
        { x: 880, y: GROUND - 8, r: 56 },
      ],
      targets: [{ x: 1060, y: GROUND - 8, r: 66 }],
    },
    {
      name: "Pagórek",
      bg: "bgAlt",
      axes: 5,
      mushrooms: [
        { x: 720, y: GROUND - 8, r: 48 },
        { x: 860, y: GROUND - 55, r: 46 },
        { x: 980, y: GROUND - 8, r: 48 },
      ],
      targets: [{ x: 1140, y: GROUND - 8, r: 60 }],
    },
    {
      name: "Zmierzch",
      bg: "bgNight",
      axes: 6,
      mushrooms: [
        { x: 700, y: GROUND - 8, r: 46 },
        { x: 820, y: GROUND - 8, r: 46 },
        { x: 920, y: GROUND - 80, r: 44 },
        { x: 1040, y: GROUND - 8, r: 48 },
      ],
      targets: [
        { x: 1160, y: GROUND - 8, r: 58 },
        { x: 1000, y: GROUND - 190, r: 50 },
      ],
    },
    {
      name: "Finał",
      bg: "bg",
      axes: 6,
      mushrooms: [
        { x: 660, y: GROUND - 8, r: 44 },
        { x: 780, y: GROUND - 8, r: 44 },
        { x: 880, y: GROUND - 70, r: 42 },
        { x: 980, y: GROUND - 8, r: 46 },
        { x: 1080, y: GROUND - 95, r: 42 },
      ],
      targets: [{ x: 1190, y: GROUND - 8, r: 56 }],
    },
  ];

  let state = "boot";
  let levelIndex = 0;
  let score = 0;
  let axesLeft = 4;
  let mushrooms = [];
  let targets = [];
  let particles = [];
  let texts = [];
  let clouds = [];
  let axe = null;
  let aim = { on: false, dx: 0, dy: 0 };
  let lastTs = 0;
  let shake = 0;
  let t = 0;
  let toastTimer = 0;
  let settleTimer = 0;

  function loadImage(src) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error(src));
      img.src = src;
    });
  }

  async function loadAll() {
    await Promise.all(
      Object.entries(ASSETS).map(async ([k, src]) => {
        imgs[k] = await loadImage(src);
      })
    );
  }

  let audioCtx = null;
  function ensureAudio() {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === "suspended") audioCtx.resume();
  }
  function tone(freq, dur, type = "triangle", vol = 0.07) {
    if (!audioCtx) return;
    const now = audioCtx.currentTime;
    const o = audioCtx.createOscillator();
    const g = audioCtx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, now);
    o.frequency.exponentialRampToValueAtTime(Math.max(50, freq * 0.55), now + dur);
    g.gain.setValueAtTime(vol, now);
    g.gain.exponentialRampToValueAtTime(0.001, now + dur);
    o.connect(g);
    g.connect(audioCtx.destination);
    o.start(now);
    o.stop(now + dur + 0.02);
  }
  const sfx = {
    throw: () => { tone(170, 0.16, "triangle", 0.07); tone(80, 0.22, "sawtooth", 0.025); },
    hit: () => { tone(300, 0.12, "square", 0.05); tone(150, 0.18, "triangle", 0.04); },
    bull: () => { tone(520, 0.14); tone(740, 0.2); },
    miss: () => tone(100, 0.28, "sine", 0.035),
    win: () => [523, 659, 784].forEach((f, i) => setTimeout(() => tone(f, 0.22), i * 110)),
  };

  function toast(msg, sec = 3.2) {
    toastEl.textContent = msg;
    toastEl.classList.toggle("hidden", !msg);
    toastTimer = msg ? sec : 0;
  }

  function hud() {
    scoreEl.textContent = String(score);
    levelLabel.textContent = `${levelIndex + 1}/${LEVELS.length}`;
    axesLeftEl.textContent = `🪓 ${axesLeft}`;
  }

  function showOverlay(title, text, btn) {
    overlayTitle.textContent = title;
    overlayText.textContent = text;
    startBtn.textContent = btn;
    overlay.classList.remove("hidden");
    state = "overlay";
    toast("");
    syncAxeSprite();
  }
  function hideOverlay() {
    overlay.classList.add("hidden");
  }

  function bindStart(fn) {
    startBtn.onclick = (e) => {
      e.preventDefault();
      ensureAudio();
      fn();
    };
  }

  function resetLevel() {
    const L = LEVELS[levelIndex];
    axesLeft = L.axes;
    mushrooms = L.mushrooms.map((m) => ({ ...m, alive: true, wob: Math.random() * 6, scale: 1 }));
    targets = L.targets.map((t) => ({ ...t, hits: 0, pulse: 0 }));
    particles = [];
    texts = [];
    axe = null;
    aim = { on: false, dx: 0, dy: 0 };
    settleTimer = 0;
    hud();
    state = "ready";
    spawnAxe();
    toast("Ciągnij siekierę w LEWO, potem puść", 2.8);
  }

  function spawnAxe() {
    axe = {
      x: SLING.rest.x,
      y: SLING.rest.y,
      vx: 0,
      vy: 0,
      ang: -0.35,
      spin: 0,
      r: 34,
      flying: false,
      stuck: false,
    };
  }

  function pointer(e) {
    const rect = canvas.getBoundingClientRect();
    const src = e.touches ? e.touches[0] || e.changedTouches[0] : e;
    return {
      x: ((src.clientX - rect.left) / rect.width) * W,
      y: ((src.clientY - rect.top) / rect.height) * H,
    };
  }

  function nearSling(p) {
    // prawie cała lewa połowa — łatwo złapać
    return p.x < W * 0.55 && p.y > 80 && p.y < GROUND + 40;
  }

  function startAim(p) {
    if (state !== "ready" || !axe || axe.flying) return;
    if (!nearSling(p)) {
      // i tak pozwól zacząć od procy, jeśli klik w canvas
      if (p.x > W * 0.55) return;
    }
    ensureAudio();
    aim.on = true;
    canvas.classList.add("dragging");
    state = "aim";
    toast("Puść, żeby rzucić!");
    moveAim(p);
  }

  function moveAim(p) {
    if (!aim.on || !axe) return;
    let dx = p.x - SLING.rest.x;
    let dy = p.y - SLING.rest.y;
    // wymuś ciągnięcie w lewo (Angry Birds)
    if (dx > -8) dx = -8 - Math.abs(dy) * 0.15;
    const len = Math.hypot(dx, dy) || 1;
    const cap = Math.min(len, MAX_PULL);
    dx = (dx / len) * cap;
    dy = (dy / len) * cap;
    if (dy < -120) dy = -120;
    if (dy > 100) dy = 100;
    aim.dx = dx;
    aim.dy = dy;
    axe.x = SLING.rest.x + dx;
    axe.y = SLING.rest.y + dy;
    axe.ang = Math.atan2(-dy, -dx) - 0.15;
  }

  function release() {
    if (!aim.on || !axe) return;
    aim.on = false;
    canvas.classList.remove("dragging");
    const pull = Math.min(Math.hypot(aim.dx, aim.dy) / MAX_PULL, 1);
    if (pull < 0.08) {
      spawnAxe();
      state = "ready";
      toast("Ciągnij mocniej w lewo");
      return;
    }
    // prędkość zależna od siły ciągnięcia
    const power = 900 + pull * 900;
    // wektor przeciwny do ciągu
    let vx = (-aim.dx / MAX_PULL) * power;
    let vy = (-aim.dy / MAX_PULL) * power;
    // zawsze solidny lot w prawo + łuk (nawet przy ciągu w dół)
    vx = Math.max(420, vx);
    // mocny bias w górę — ciągniesz w dół jak w Angry Birds → leci w górę
    vy = Math.min(vy, -180) - pull * 160;
    // nie za stromo w niebo
    if (vy < -720) vy = -720;
    axe.vx = vx;
    axe.vy = vy;
    axe.spin = 10 + pull * 14;
    axe.flying = true;
    axesLeft -= 1;
    hud();
    sfx.throw();
    state = "fly";
    toast("");
  }

  function burst(x, y, color, n = 16) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = 90 + Math.random() * 240;
      particles.push({
        x, y,
        vx: Math.cos(a) * s,
        vy: Math.sin(a) * s - 60,
        life: 0.45 + Math.random() * 0.55,
        age: 0,
        color,
        size: 2.5 + Math.random() * 5,
      });
    }
  }

  function popText(x, y, text) {
    texts.push({ x, y, text, age: 0, life: 1.1 });
  }

  function hitShroom(m) {
    m.alive = false;
    m.scale = 1.25;
    score += 100;
    shake = 7;
    burst(m.x, m.y - 40, "#e85a4f", 18);
    burst(m.x, m.y - 30, "#f4d35e", 10);
    popText(m.x, m.y - 90, "+100");
    sfx.hit();
    hud();
  }

  function hitTarget(tg) {
    tg.hits = 1;
    tg.pulse = 1;
    const d = Math.hypot(axe.x - tg.x, axe.y - (tg.y - tg.r * 0.7));
    const ratio = d / tg.r;
    let pts = 75;
    let label = "+75";
    if (ratio < 0.28) { pts = 300; label = "BULLSEYE +300"; sfx.bull(); }
    else if (ratio < 0.55) { pts = 150; label = "+150"; sfx.hit(); }
    else sfx.hit();
    score += pts;
    shake = 9;
    burst(axe.x, axe.y, "#f0b429", 24);
    popText(tg.x, tg.y - tg.r - 40, label);
    // po trafieniu tarczy siekiera NIE blokuje poziomu — odbija się lekko
    axe.vx *= -0.15;
    axe.vy = -Math.abs(axe.vy) * 0.25 - 80;
    axe.spin *= 0.4;
    // nie kończ rzutu od razu — pozwól jeszcze zlecieć
    hud();
  }

  function cleared() {
    // jak Angry Birds: wyczyść przeciwników (grzybki); tarcza = bonus
    return mushrooms.every((m) => !m.alive);
  }

  function endThrow() {
    if (cleared()) {
      sfx.win();
      if (levelIndex >= LEVELS.length - 1) {
        showOverlay("Wygrana!", `Cały las oczyszczony! Wynik: ${score}`, "Od nowa");
        bindStart(() => { score = 0; levelIndex = 0; hideOverlay(); resetLevel(); });
      } else {
        showOverlay(`Poziom ${levelIndex + 1} ✓`, `„${LEVELS[levelIndex].name}” — ${score} pkt`, "Dalej");
        bindStart(() => { levelIndex += 1; hideOverlay(); resetLevel(); });
      }
      return;
    }
    if (axesLeft <= 0) {
      sfx.miss();
      showOverlay("Koniec siekier", `Wynik: ${score}. Spróbuj ponownie.`, "Ponów");
      bindStart(() => { hideOverlay(); resetLevel(); });
      return;
    }
    spawnAxe();
    state = "ready";
    toast("Znowu: ciągnij i puść", 2.4);
  }

  function update(dt) {
    t += dt;
    shake = Math.max(0, shake - dt * 28);
    if (toastTimer > 0) {
      toastTimer -= dt;
      if (toastTimer <= 0) toast("");
    }

    // clouds
    if (clouds.length < 5 && Math.random() < 0.01) {
      clouds.push({
        x: -80,
        y: 40 + Math.random() * 120,
        s: 0.5 + Math.random() * 0.7,
        v: 12 + Math.random() * 18,
      });
    }
    for (const c of clouds) c.x += c.v * dt;
    clouds = clouds.filter((c) => c.x < W + 120);

    for (const m of mushrooms) {
      if (m.alive) m.wob += dt * 2.2;
      else m.scale = Math.max(0, m.scale - dt * 2.4);
    }
    for (const tg of targets) tg.pulse = Math.max(0, tg.pulse - dt * 2.2);

    for (const p of particles) {
      p.age += dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vy += 650 * dt;
    }
    particles = particles.filter((p) => p.age < p.life);

    for (const tx of texts) {
      tx.age += dt;
      tx.y -= 48 * dt;
    }
    texts = texts.filter((tx) => tx.age < tx.life);

    if (settleTimer > 0) {
      settleTimer -= dt;
      if (settleTimer <= 0) endThrow();
      return;
    }

    if (state !== "fly" || !axe || !axe.flying) return;

    axe.vx *= DRAG;
    axe.vy += GRAVITY * dt;
    axe.x += axe.vx * dt;
    axe.y += axe.vy * dt;
    axe.ang += axe.spin * dt;

    if (axe.y + axe.r > GROUND) {
      axe.y = GROUND - axe.r;
      axe.flying = false;
      burst(axe.x, axe.y, "#c4a574", 8);
      sfx.miss();
      state = "settle";
      settleTimer = 0.55;
      return;
    }
    if (axe.x > W + 100 || axe.x < -120 || axe.y < -120) {
      axe.flying = false;
      state = "settle";
      settleTimer = 0.4;
      return;
    }

    for (const m of mushrooms) {
      if (!m.alive) continue;
      const cy = m.y - m.r * 0.85;
      if (Math.hypot(axe.x - m.x, axe.y - cy) < axe.r + m.r * 0.9) {
        hitShroom(m);
        axe.vx *= 0.5;
        axe.vy *= 0.35;
        axe.spin *= 0.5;
      }
    }

    for (const tg of targets) {
      if (tg.hits) continue;
      const cy = tg.y - tg.r * 0.85;
      if (Math.hypot(axe.x - tg.x, axe.y - cy) < axe.r + tg.r * 0.9) {
        hitTarget(tg);
        // tarcza = bonus; siekiera odbija się i leci dalej/w dół
      }
    }
  }

  function drawSling() {
    const L = SLING.left;
    const R = SLING.right;
    // słupki
    ctx.strokeStyle = "#5a3318";
    ctx.lineWidth = 10;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(SLING.baseX - 18, SLING.baseY);
    ctx.lineTo(L.x, L.y);
    ctx.moveTo(SLING.baseX + 18, SLING.baseY);
    ctx.lineTo(R.x, R.y);
    ctx.stroke();
    ctx.strokeStyle = "#8a5a2b";
    ctx.lineWidth = 6;
    ctx.stroke();

    // guma
    const ax = axe ? axe.x : SLING.rest.x;
    const ay = axe ? axe.y : SLING.rest.y;
    if (state === "aim" || state === "ready") {
      ctx.strokeStyle = "rgba(70, 30, 20, 0.85)";
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.moveTo(L.x, L.y);
      ctx.lineTo(ax, ay);
      ctx.lineTo(R.x, R.y);
      ctx.stroke();
      // woreczek
      ctx.fillStyle = "rgba(90, 45, 25, 0.9)";
      ctx.beginPath();
      ctx.arc(ax, ay, 10, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  function drawTrajectory() {
    if (state !== "aim" || !axe) return;
    const pull = Math.min(Math.hypot(aim.dx, aim.dy) / MAX_PULL, 1);
    let x = axe.x;
    let y = axe.y;
    const power = 900 + pull * 900;
    let vx = Math.max(420, (-aim.dx / MAX_PULL) * power);
    let vy = (-aim.dy / MAX_PULL) * power;
    vy = Math.min(vy, -180) - pull * 160;
    if (vy < -720) vy = -720;
    ctx.fillStyle = `rgba(255,244,220,${0.25 + pull * 0.55})`;
    for (let i = 0; i < 22; i++) {
      vx *= DRAG;
      vy += GRAVITY * 0.038;
      x += vx * 0.038;
      y += vy * 0.038;
      if (y > GROUND) break;
      ctx.beginPath();
      ctx.arc(x, y, i % 2 ? 2.5 : 4, 0, Math.PI * 2);
      ctx.fill();
    }
    // power arc
    ctx.strokeStyle = `rgba(240,180,41,${0.35 + pull * 0.5})`;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(SLING.rest.x, SLING.rest.y, 20 + pull * 40, 0, Math.PI * 2);
    ctx.stroke();
  }

  function drawReadyPulse() {
    if (state !== "ready" || !axe) return;
    const p = 0.5 + 0.5 * Math.sin(t * 3.4);
    ctx.strokeStyle = `rgba(240,180,41,${0.3 + p * 0.5})`;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(axe.x, axe.y, 28 + p * 8, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = `rgba(255,244,220,${0.65 + p * 0.3})`;
    ctx.font = "700 17px Fredoka,sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("⬅ ciągnij", axe.x - 4, axe.y - 42);
  }

  function drawBg() {
    const key = LEVELS[levelIndex].bg;
    const bg = imgs[key] || imgs.bg;
    ctx.drawImage(bg, 0, 0, W, H);

    // soft ground overlay for consistent collision line
    const g = ctx.createLinearGradient(0, GROUND - 30, 0, H);
    g.addColorStop(0, "rgba(60,110,45,0)");
    g.addColorStop(0.35, "rgba(60,110,45,0.55)");
    g.addColorStop(1, "rgba(40,80,30,0.9)");
    ctx.fillStyle = g;
    ctx.fillRect(0, GROUND - 30, W, H - (GROUND - 30));

    // grass edge
    ctx.strokeStyle = "rgba(90,150,60,0.8)";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(0, GROUND);
    for (let x = 0; x <= W; x += 24) {
      ctx.lineTo(x, GROUND - 2 - Math.sin(x * 0.04 + t) * 2);
    }
    ctx.stroke();

    for (const c of clouds) {
      ctx.globalAlpha = 0.35;
      ctx.fillStyle = "#fff";
      ctx.beginPath();
      ctx.ellipse(c.x, c.y, 50 * c.s, 22 * c.s, 0, 0, Math.PI * 2);
      ctx.ellipse(c.x + 30 * c.s, c.y + 4, 36 * c.s, 18 * c.s, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
    }
  }

  function drawHero() {
    // pień pod procą
    ctx.fillStyle = "#6b4226";
    ctx.beginPath();
    ctx.ellipse(SLING.baseX, GROUND - 2, 48, 12, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#8b5a32";
    ctx.fillRect(SLING.baseX - 36, GROUND - 28, 72, 28);

      if (imgs.hero) {
      const bob = Math.sin(t * 2) * 2;
      const hw = 138;
      const hh = 116;
      ctx.drawImage(imgs.hero, SLING.baseX - 168, GROUND - hh - 6 + bob, hw, hh);
    }
  }

  function syncAxeSprite() {
    if (!axeEl) return;
    if (!axe || state === "boot" || state === "overlay") {
      axeEl.classList.add("hidden");
      return;
    }
    axeEl.classList.remove("hidden");
    const px = (axe.x / W) * 100;
    const py = (axe.y / H) * 100;
    const deg = (axe.ang * 180) / Math.PI;
    axeEl.style.left = `${px}%`;
    axeEl.style.top = `${py}%`;
    axeEl.style.transform = `rotate(${deg}deg)`;
  }

  function drawAxe() {
    syncAxeSprite();
  }

  function drawMushrooms() {
    for (const m of mushrooms) {
      if (m.scale < 0.05) continue;
      ctx.save();
      ctx.translate(m.x, m.y);
      ctx.rotate(m.alive ? Math.sin(m.wob) * 0.05 : 0);
      ctx.scale(m.scale, m.scale);
      if (!m.alive) ctx.globalAlpha = m.scale;
      const s = m.r * 2.3;
      if (imgs.mushroom) ctx.drawImage(imgs.mushroom, -s / 2, -s, s, s);
      ctx.restore();
    }
  }

  function drawTargets() {
    for (const tg of targets) {
      ctx.save();
      ctx.translate(tg.x, tg.y);
      const sc = 1 + tg.pulse * 0.08;
      ctx.scale(sc, sc);
      const s = tg.r * 2.5;
      if (imgs.target) {
        ctx.globalAlpha = tg.hits ? 0.75 : 1;
        ctx.drawImage(imgs.target, -s / 2, -s, s, s);
      }
      if (tg.hits) {
        ctx.globalAlpha = 1;
        ctx.fillStyle = "#2f8f4e";
        ctx.beginPath();
        ctx.arc(0, -s * 0.55, 22, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = "#fff4dc";
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.moveTo(-9, -s * 0.55);
        ctx.lineTo(-2, -s * 0.45);
        ctx.lineTo(12, -s * 0.68);
        ctx.stroke();
      }
      ctx.restore();
    }
  }

  function drawFX() {
    for (const p of particles) {
      ctx.globalAlpha = 1 - p.age / p.life;
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    for (const tx of texts) {
      const a = 1 - tx.age / tx.life;
      ctx.globalAlpha = a;
      ctx.font = "700 28px Fredoka,sans-serif";
      ctx.textAlign = "center";
      ctx.lineWidth = 5;
      ctx.strokeStyle = "rgba(31,20,12,0.75)";
      ctx.fillStyle = "#fff4dc";
      ctx.strokeText(tx.text, tx.x, tx.y);
      ctx.fillText(tx.text, tx.x, tx.y);
    }
    ctx.globalAlpha = 1;
    ctx.textAlign = "left";
  }

  function draw() {
    ctx.save();
    if (shake > 0) {
      ctx.translate((Math.random() - 0.5) * shake, (Math.random() - 0.5) * shake);
    }
    drawBg();
    drawTargets();
    drawMushrooms();
    drawHero();
    drawSling();
    drawTrajectory();
    drawReadyPulse();
    drawAxe();
    drawFX();

    // level chip
    ctx.font = "700 16px Fredoka,sans-serif";
    const name = LEVELS[levelIndex].name;
    const tw = ctx.measureText(name).width;
    ctx.fillStyle = "rgba(31,20,12,0.5)";
    roundRect(18, 14, tw + 22, 28, 10);
    ctx.fill();
    ctx.fillStyle = "#fff4dc";
    ctx.fillText(name, 29, 34);
    ctx.restore();
  }

  function roundRect(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function loop(ts) {
    if (!lastTs) lastTs = ts;
    let dt = Math.min((ts - lastTs) / 1000, 0.033);
    lastTs = ts;
    if (state !== "boot" && state !== "overlay") update(dt);
    if (state !== "boot") draw();
    requestAnimationFrame(loop);
  }

  canvas.addEventListener("pointerdown", (e) => {
    canvas.setPointerCapture(e.pointerId);
    startAim(pointer(e));
  });
  canvas.addEventListener("pointermove", (e) => {
    if (aim.on) moveAim(pointer(e));
  });
  canvas.addEventListener("pointerup", (e) => {
    if (aim.on) release();
    try { canvas.releasePointerCapture(e.pointerId); } catch (_) {}
  });
  canvas.addEventListener("pointercancel", () => {
    if (aim.on) release();
  });
  // touch: nie scrolluj strony podczas gry
  canvas.addEventListener("touchstart", (e) => e.preventDefault(), { passive: false });
  canvas.addEventListener("touchmove", (e) => e.preventDefault(), { passive: false });

  loadAll()
    .then(() => {
      state = "boot";
      draw();
      showOverlay(
        "SiekieroLas",
        "Przeciągnij siekierę w LEWO i puść. Zniszcz grzybki! Tarcza = bonus.",
        "Start"
      );
      bindStart(() => {
        score = 0;
        levelIndex = 0;
        hideOverlay();
        resetLevel();
      });
      requestAnimationFrame(loop);
    })
    .catch((err) => {
      console.error(err);
      overlayTitle.textContent = "Błąd";
      overlayText.textContent = "Nie wczytano grafik. Odśwież stronę.";
      startBtn.style.display = "none";
    });
})();
