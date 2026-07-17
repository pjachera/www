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

  const W = canvas.width;
  const H = canvas.height;
  const GROUND_Y = H * 0.82;
  const ORIGIN = { x: 170, y: GROUND_Y - 70 };
  const MAX_PULL = 140;
  const GRAVITY = 1650;
  const AIR = 0.998;

  const imgs = {};
  const ASSETS = {
    bg: "assets/bg.png",
    bgAlt: "assets/bg-alt.png",
    bgNight: "assets/bg-night.png",
    trees: "assets/trees.png",
    bushes: "assets/bushes.png",
    castle: "assets/castle.png",
    hero: "assets/hero.png",
    axe: "assets/axe.png",
    target: "assets/target.png",
    mushroom: "assets/mushroom.png",
  };

  const LEVELS = [
    {
      name: "Polana grzybków",
      bg: "bg",
      axes: 3,
      mushrooms: [
        { x: 880, y: GROUND_Y - 55, r: 48 },
        { x: 1020, y: GROUND_Y - 55, r: 48 },
      ],
      targets: [{ x: 1140, y: GROUND_Y - 95, r: 70 }],
    },
    {
      name: "Wieża w lesie",
      bg: "bgAlt",
      axes: 3,
      mushrooms: [
        { x: 820, y: GROUND_Y - 55, r: 48 },
        { x: 940, y: GROUND_Y - 120, r: 44 },
        { x: 1060, y: GROUND_Y - 55, r: 48 },
      ],
      targets: [{ x: 1180, y: GROUND_Y - 110, r: 68 }],
    },
    {
      name: "Nocna tarcza",
      bg: "bgNight",
      axes: 4,
      mushrooms: [
        { x: 760, y: GROUND_Y - 55, r: 46 },
        { x: 900, y: GROUND_Y - 55, r: 46 },
        { x: 980, y: GROUND_Y - 150, r: 42 },
        { x: 1080, y: GROUND_Y - 55, r: 48 },
      ],
      targets: [
        { x: 1180, y: GROUND_Y - 100, r: 66 },
        { x: 1040, y: GROUND_Y - 250, r: 50 },
      ],
    },
    {
      name: "Królewski rzut",
      bg: "bg",
      axes: 4,
      mushrooms: [
        { x: 700, y: GROUND_Y - 55, r: 44 },
        { x: 820, y: GROUND_Y - 55, r: 44 },
        { x: 900, y: GROUND_Y - 130, r: 40 },
        { x: 1000, y: GROUND_Y - 55, r: 46 },
        { x: 1100, y: GROUND_Y - 160, r: 42 },
      ],
      targets: [{ x: 1200, y: GROUND_Y - 105, r: 64 }],
    },
  ];

  let state = "boot"; // boot | ready | aim | fly | settle | overlay
  let levelIndex = 0;
  let score = 0;
  let axesLeft = 3;
  let mushrooms = [];
  let targets = [];
  let particles = [];
  let floatTexts = [];
  let axe = null;
  let aim = { pulling: false, dx: 0, dy: 0 };
  let lastTs = 0;
  let shake = 0;
  let wind = [];
  let heroBob = 0;

  function loadImage(src) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = src;
    });
  }

  async function loadAll() {
    const entries = Object.entries(ASSETS);
    await Promise.all(
      entries.map(async ([key, src]) => {
        imgs[key] = await loadImage(src);
      })
    );
  }

  // --- Audio (procedural) ---
  let audioCtx = null;
  function ensureAudio() {
    if (!audioCtx) {
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }
    if (audioCtx.state === "suspended") audioCtx.resume();
  }

  function blip(freq, dur, type = "sine", gain = 0.08) {
    if (!audioCtx) return;
    const t = audioCtx.currentTime;
    const o = audioCtx.createOscillator();
    const g = audioCtx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(40, freq * 0.5), t + dur);
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g);
    g.connect(audioCtx.destination);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  function sfxThrow() {
    blip(180, 0.18, "triangle", 0.07);
    blip(90, 0.25, "sawtooth", 0.03);
  }
  function sfxHit() {
    blip(320, 0.12, "square", 0.06);
    blip(140, 0.2, "triangle", 0.05);
  }
  function sfxBull() {
    blip(440, 0.15, "sine", 0.07);
    blip(660, 0.22, "triangle", 0.05);
  }
  function sfxMiss() {
    blip(110, 0.3, "sine", 0.04);
  }
  function sfxWin() {
    [523, 659, 784].forEach((f, i) => {
      setTimeout(() => blip(f, 0.25, "triangle", 0.06), i * 120);
    });
  }

  function resetLevel() {
    const L = LEVELS[levelIndex];
    axesLeft = L.axes;
    mushrooms = L.mushrooms.map((m) => ({
      ...m,
      alive: true,
      wobble: Math.random() * Math.PI * 2,
      scale: 1,
    }));
    targets = L.targets.map((t) => ({
      ...t,
      hits: 0,
      maxHits: 1,
      pulse: 0,
    }));
    particles = [];
    floatTexts = [];
    axe = null;
    aim = { pulling: false, dx: 0, dy: 0 };
    updateHud();
    state = "ready";
  }

  function updateHud() {
    scoreEl.textContent = String(score);
    levelLabel.textContent = `Poziom ${levelIndex + 1}`;
    axesLeftEl.textContent = `🪓 ×${axesLeft}`;
  }

  function showOverlay(title, text, btnLabel) {
    overlayTitle.textContent = title;
    overlayText.textContent = text;
    startBtn.textContent = btnLabel;
    overlay.classList.remove("hidden");
    state = "overlay";
  }

  function hideOverlay() {
    overlay.classList.add("hidden");
  }

  function spawnAxeReady() {
    axe = {
      x: ORIGIN.x,
      y: ORIGIN.y,
      vx: 0,
      vy: 0,
      angle: -0.4,
      spin: 0,
      stuck: false,
      flying: false,
      radius: 28,
    };
  }

  function pointerPos(e) {
    const rect = canvas.getBoundingClientRect();
    const scaleX = W / rect.width;
    const scaleY = H / rect.height;
    const src = e.touches ? e.touches[0] || e.changedTouches[0] : e;
    return {
      x: (src.clientX - rect.left) * scaleX,
      y: (src.clientY - rect.top) * scaleY,
    };
  }

  function startPull(p) {
    if (state !== "ready" || !axe || axe.flying) return;
    const dx = p.x - ORIGIN.x;
    const dy = p.y - ORIGIN.y;
    if (Math.hypot(dx, dy) > 120) return;
    ensureAudio();
    aim.pulling = true;
    canvas.classList.add("dragging");
    state = "aim";
    updateAim(p);
  }

  function updateAim(p) {
    if (!aim.pulling || !axe) return;
    let dx = p.x - ORIGIN.x;
    let dy = p.y - ORIGIN.y;
    // pull mostly left / down-left
    const len = Math.hypot(dx, dy) || 1;
    const capped = Math.min(len, MAX_PULL);
    dx = (dx / len) * capped;
    dy = (dy / len) * capped;
    // bias: allow pull to the left side of origin
    if (dx > 40) dx = 40;
    aim.dx = dx;
    aim.dy = dy;
    axe.x = ORIGIN.x + dx;
    axe.y = ORIGIN.y + dy;
    axe.angle = Math.atan2(-dy, -dx) + Math.PI * 0.15;
  }

  function releaseThrow() {
    if (!aim.pulling || !axe) return;
    aim.pulling = false;
    canvas.classList.remove("dragging");
    const power = Math.min(Math.hypot(aim.dx, aim.dy) / MAX_PULL, 1);
    if (power < 0.12) {
      axe.x = ORIGIN.x;
      axe.y = ORIGIN.y;
      state = "ready";
      return;
    }
    // velocity opposite to pull (Angry Birds style)
    const speed = 980 + power * 1280;
    axe.vx = (-aim.dx / MAX_PULL) * speed;
    axe.vy = (-aim.dy / MAX_PULL) * speed;
    axe.spin = (axe.vx > 0 ? 1 : -1) * (10 + power * 14);
    axe.flying = true;
    axesLeft -= 1;
    updateHud();
    sfxThrow();
    state = "fly";
  }

  function burst(x, y, color, n = 14) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = 80 + Math.random() * 220;
      particles.push({
        x,
        y,
        vx: Math.cos(a) * s,
        vy: Math.sin(a) * s - 80,
        life: 0.5 + Math.random() * 0.5,
        age: 0,
        color,
        size: 3 + Math.random() * 5,
      });
    }
  }

  function floatScore(x, y, text) {
    floatTexts.push({ x, y, text, age: 0, life: 1.1 });
  }

  function hitMushroom(m) {
    m.alive = false;
    m.scale = 1.2;
    score += 100;
    shake = 8;
    burst(m.x, m.y - 20, "#e85a4f", 18);
    burst(m.x, m.y - 10, "#f4d35e", 10);
    floatScore(m.x, m.y - 60, "+100");
    sfxHit();
    updateHud();
  }

  function hitTarget(t, axeObj) {
    t.hits += 1;
    t.pulse = 1;
    const dist = Math.hypot(axeObj.x - t.x, axeObj.y - (t.y - 20));
    const ratio = dist / t.r;
    let pts = 50;
    let label = "+50";
    if (ratio < 0.22) {
      pts = 300;
      label = "BULLSEYE! +300";
      sfxBull();
    } else if (ratio < 0.45) {
      pts = 150;
      label = "+150";
      sfxHit();
    } else {
      sfxHit();
    }
    score += pts;
    shake = 10;
    burst(axeObj.x, axeObj.y, "#f4d35e", 20);
    floatScore(t.x, t.y - 80, label);
    axeObj.stuck = true;
    axeObj.flying = false;
    axeObj.vx = 0;
    axeObj.vy = 0;
    axeObj.spin = 0;
    updateHud();
  }

  function allCleared() {
    const shroomsDone = mushrooms.every((m) => !m.alive);
    const targetsDone = targets.every((t) => t.hits >= t.maxHits);
    return shroomsDone && targetsDone;
  }

  function afterThrowSettle() {
    if (allCleared()) {
      sfxWin();
      if (levelIndex >= LEVELS.length - 1) {
        showOverlay(
          "Wygrana!",
          `Wyczyściłeś cały las! Wynik: ${score} pkt.`,
          "Zagraj od nowa"
        );
        bindStart(() => {
          score = 0;
          levelIndex = 0;
          hideOverlay();
          resetLevel();
          spawnAxeReady();
        });
      } else {
        showOverlay(
          `Poziom ${levelIndex + 1} ukończony!`,
          `„${LEVELS[levelIndex].name}” zaliczony. Wynik: ${score}`,
          "Następny poziom"
        );
        bindStart(() => {
          levelIndex += 1;
          hideOverlay();
          resetLevel();
          spawnAxeReady();
        });
      }
      return;
    }
    if (axesLeft <= 0) {
      sfxMiss();
      showOverlay(
        "Koniec siekier",
        `Spróbuj jeszcze raz. Wynik: ${score}`,
        "Ponów poziom"
      );
      bindStart(() => {
        hideOverlay();
        resetLevel();
        spawnAxeReady();
      });
      return;
    }
    spawnAxeReady();
    state = "ready";
  }

  function update(dt) {
    heroBob += dt * 2.2;
    shake = Math.max(0, shake - dt * 30);

    for (const m of mushrooms) {
      if (m.alive) m.wobble += dt * 2.5;
      else m.scale = Math.max(0, m.scale - dt * 2.5);
    }
    for (const t of targets) {
      t.pulse = Math.max(0, t.pulse - dt * 2.5);
    }

    for (const p of particles) {
      p.age += dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vy += 600 * dt;
    }
    particles = particles.filter((p) => p.age < p.life);

    for (const f of floatTexts) {
      f.age += dt;
      f.y -= 40 * dt;
    }
    floatTexts = floatTexts.filter((f) => f.age < f.life);

    // ambient wind motes
    if (wind.length < 18 && Math.random() < 0.08) {
      wind.push({
        x: Math.random() * W,
        y: 80 + Math.random() * (GROUND_Y - 160),
        vx: 20 + Math.random() * 40,
        size: 1.5 + Math.random() * 2.5,
        a: 0.15 + Math.random() * 0.25,
      });
    }
    for (const w of wind) {
      w.x += w.vx * dt;
      w.y += Math.sin(w.x * 0.01) * 8 * dt;
    }
    wind = wind.filter((w) => w.x < W + 20);

    if (state !== "fly" || !axe || !axe.flying) return;

    axe.vx *= AIR;
    axe.vy += GRAVITY * dt;
    axe.x += axe.vx * dt;
    axe.y += axe.vy * dt;
    axe.angle += axe.spin * dt;

    // ground
    if (axe.y + axe.radius > GROUND_Y) {
      axe.y = GROUND_Y - axe.radius;
      axe.flying = false;
      axe.vx *= 0.3;
      axe.vy = 0;
      axe.spin *= 0.2;
      burst(axe.x, axe.y, "#c4a574", 8);
      sfxMiss();
      state = "settle";
      setTimeout(afterThrowSettle, 550);
      return;
    }

    // out of bounds
    if (axe.x > W + 80 || axe.x < -120 || axe.y < -120) {
      axe.flying = false;
      state = "settle";
      setTimeout(afterThrowSettle, 400);
      return;
    }

    // collisions — mushrooms
    for (const m of mushrooms) {
      if (!m.alive) continue;
      const dx = axe.x - m.x;
      const dy = axe.y - (m.y - 10);
      if (Math.hypot(dx, dy) < axe.radius + m.r * 0.7) {
        hitMushroom(m);
        axe.vx *= 0.55;
        axe.vy *= 0.4;
        axe.spin *= 0.6;
      }
    }

    // collisions — targets
    for (const t of targets) {
      if (t.hits >= t.maxHits) continue;
      const cx = t.x;
      const cy = t.y - 18;
      const dx = axe.x - cx;
      const dy = axe.y - cy;
      if (Math.hypot(dx, dy) < axe.radius + t.r * 0.72) {
        hitTarget(t, axe);
        state = "settle";
        setTimeout(afterThrowSettle, 700);
        return;
      }
    }
  }

  function drawBackground() {
    const L = LEVELS[levelIndex];
    const bg = imgs[L.bg] || imgs.bg;
    ctx.drawImage(bg, 0, 0, W, H);

    // soft vignette sky wash
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, "rgba(255,255,255,0.05)");
    g.addColorStop(0.55, "rgba(0,0,0,0)");
    g.addColorStop(1, "rgba(20,10,0,0.15)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);

    if (imgs.castle) {
      ctx.globalAlpha = 0.85;
      ctx.drawImage(imgs.castle, W - 420, GROUND_Y - 260, 320, 180);
      ctx.globalAlpha = 1;
    }
    if (imgs.trees) {
      ctx.drawImage(imgs.trees, -40, GROUND_Y - 280, 420, 236);
      ctx.drawImage(imgs.trees, 380, GROUND_Y - 250, 360, 200);
    }
    if (imgs.bushes) {
      ctx.drawImage(imgs.bushes, 40, GROUND_Y - 90, 260, 120);
      ctx.drawImage(imgs.bushes, W - 300, GROUND_Y - 85, 240, 110);
    }

    // ground strip
    ctx.fillStyle = "#3d6b2e";
    ctx.fillRect(0, GROUND_Y, W, H - GROUND_Y);
    ctx.fillStyle = "#5a8f3d";
    ctx.beginPath();
    ctx.moveTo(0, GROUND_Y);
    for (let x = 0; x <= W; x += 40) {
      ctx.lineTo(x, GROUND_Y - 6 - Math.sin(x * 0.03 + levelIndex) * 4);
    }
    ctx.lineTo(W, H);
    ctx.lineTo(0, H);
    ctx.closePath();
    ctx.fill();

    // dirt path
    ctx.fillStyle = "rgba(140, 100, 55, 0.45)";
    ctx.beginPath();
    ctx.moveTo(0, GROUND_Y + 10);
    ctx.quadraticCurveTo(W * 0.4, GROUND_Y + 30, W, GROUND_Y + 8);
    ctx.lineTo(W, GROUND_Y + 70);
    ctx.quadraticCurveTo(W * 0.4, GROUND_Y + 90, 0, GROUND_Y + 55);
    ctx.closePath();
    ctx.fill();
  }

  function drawWind() {
    for (const w of wind) {
      ctx.fillStyle = `rgba(255,255,255,${w.a})`;
      ctx.beginPath();
      ctx.arc(w.x, w.y, w.size, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  function drawHero() {
    const bob = Math.sin(heroBob) * 4;
    if (imgs.hero) {
      const hw = 150;
      const hh = 126;
      ctx.drawImage(imgs.hero, ORIGIN.x - 115, ORIGIN.y - hh + 30 + bob, hw, hh);
    }
    // stump platform
    ctx.fillStyle = "#6b4226";
    ctx.beginPath();
    ctx.ellipse(ORIGIN.x - 30, GROUND_Y - 8, 55, 16, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#8a5a32";
    ctx.fillRect(ORIGIN.x - 70, GROUND_Y - 40, 80, 34);
  }

  function drawAimGuide() {
    if (state !== "aim" || !axe) return;
    const power = Math.min(Math.hypot(aim.dx, aim.dy) / MAX_PULL, 1);
    // rubber band
    ctx.strokeStyle = "rgba(90, 50, 20, 0.75)";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(ORIGIN.x - 20, ORIGIN.y + 10);
    ctx.lineTo(axe.x, axe.y);
    ctx.lineTo(ORIGIN.x + 10, ORIGIN.y + 20);
    ctx.stroke();

    // trajectory dots
    let x = ORIGIN.x + aim.dx;
    let y = ORIGIN.y + aim.dy;
    const speed = 980 + power * 1280;
    let vx = (-aim.dx / MAX_PULL) * speed;
    let vy = (-aim.dy / MAX_PULL) * speed;
    ctx.fillStyle = `rgba(255, 246, 224, ${0.25 + power * 0.55})`;
    for (let i = 0; i < 18; i++) {
      vx *= AIR;
      vy += GRAVITY * 0.045;
      x += vx * 0.045;
      y += vy * 0.045;
      if (y > GROUND_Y) break;
      const r = 3 + (i % 3);
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    }

    // power ring
    ctx.strokeStyle = `rgba(232, 163, 23, ${0.35 + power * 0.5})`;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(ORIGIN.x, ORIGIN.y, 20 + power * 30, 0, Math.PI * 2);
    ctx.stroke();
  }

  function drawAxe() {
    if (!axe) return;
    ctx.save();
    ctx.translate(axe.x, axe.y);
    ctx.rotate(axe.angle);
    const size = 78;
    if (imgs.axe) {
      ctx.drawImage(imgs.axe, -size * 0.45, -size * 0.45, size, size);
    } else {
      ctx.fillStyle = "#8b5a2b";
      ctx.fillRect(-30, -4, 50, 8);
      ctx.fillStyle = "#c0c8d0";
      ctx.beginPath();
      ctx.moveTo(10, -18);
      ctx.lineTo(28, 0);
      ctx.lineTo(10, 18);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
  }

  function drawMushrooms() {
    for (const m of mushrooms) {
      if (m.scale <= 0.05) continue;
      ctx.save();
      ctx.translate(m.x, m.y);
      const wob = m.alive ? Math.sin(m.wobble) * 0.06 : 0;
      ctx.rotate(wob);
      ctx.scale(m.scale, m.scale);
      if (!m.alive) ctx.globalAlpha = Math.max(0, m.scale);
      const s = m.r * 2.4;
      if (imgs.mushroom) {
        ctx.drawImage(imgs.mushroom, -s / 2, -s * 0.85, s, s * 0.9);
      } else {
        ctx.fillStyle = "#8b5a2b";
        ctx.fillRect(-20, -10, 40, 30);
        ctx.fillStyle = "#d64545";
        ctx.beginPath();
        ctx.ellipse(0, -20, 28, 20, 0, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }
  }

  function drawTargets() {
    for (const t of targets) {
      ctx.save();
      ctx.translate(t.x, t.y);
      const pulse = 1 + t.pulse * 0.08;
      ctx.scale(pulse, pulse);
      if (t.hits >= t.maxHits) ctx.globalAlpha = 0.45;
      const s = t.r * 2.6;
      if (imgs.target) {
        ctx.drawImage(imgs.target, -s / 2, -s * 0.78, s, s);
      } else {
        ctx.fillStyle = "#c4a35a";
        ctx.beginPath();
        ctx.arc(0, -20, t.r, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = "#c23b2e";
        ctx.beginPath();
        ctx.arc(0, -20, t.r * 0.35, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }
  }

  function drawParticles() {
    for (const p of particles) {
      const a = 1 - p.age / p.life;
      ctx.fillStyle = p.color;
      ctx.globalAlpha = a;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size * a, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  function drawFloatTexts() {
    for (const f of floatTexts) {
      const a = 1 - f.age / f.life;
      ctx.globalAlpha = a;
      ctx.font = "700 28px Fredoka, sans-serif";
      ctx.fillStyle = "#fff6e0";
      ctx.strokeStyle = "rgba(42,26,14,0.7)";
      ctx.lineWidth = 4;
      ctx.textAlign = "center";
      ctx.strokeText(f.text, f.x, f.y);
      ctx.fillText(f.text, f.x, f.y);
    }
    ctx.globalAlpha = 1;
    ctx.textAlign = "left";
  }

  function draw() {
    ctx.save();
    if (shake > 0) {
      ctx.translate((Math.random() - 0.5) * shake, (Math.random() - 0.5) * shake);
    }
    drawBackground();
    drawWind();
    drawTargets();
    drawMushrooms();
    drawHero();
    drawAimGuide();
    drawAxe();
    drawParticles();
    drawFloatTexts();

    // level name ribbon
    ctx.font = "600 18px Fredoka, sans-serif";
    ctx.fillStyle = "rgba(42,26,14,0.55)";
    const name = LEVELS[levelIndex].name;
    const tw = ctx.measureText(name).width;
    ctx.fillRect(24, 18, tw + 24, 32);
    ctx.fillStyle = "#fff6e0";
    ctx.fillText(name, 36, 40);

    ctx.restore();
  }

  function loop(ts) {
    if (!lastTs) lastTs = ts;
    let dt = (ts - lastTs) / 1000;
    lastTs = ts;
    dt = Math.min(dt, 0.033);
    if (state !== "boot" && state !== "overlay") {
      update(dt);
    }
    if (state !== "boot") draw();
    requestAnimationFrame(loop);
  }

  // events
  canvas.addEventListener("mousedown", (e) => startPull(pointerPos(e)));
  window.addEventListener("mousemove", (e) => {
    if (aim.pulling) updateAim(pointerPos(e));
  });
  window.addEventListener("mouseup", () => {
    if (aim.pulling) releaseThrow();
  });
  canvas.addEventListener(
    "touchstart",
    (e) => {
      e.preventDefault();
      startPull(pointerPos(e));
    },
    { passive: false }
  );
  canvas.addEventListener(
    "touchmove",
    (e) => {
      e.preventDefault();
      if (aim.pulling) updateAim(pointerPos(e));
    },
    { passive: false }
  );
  canvas.addEventListener(
    "touchend",
    (e) => {
      e.preventDefault();
      if (aim.pulling) releaseThrow();
    },
    { passive: false }
  );

  function bindStart(handler) {
    startBtn.onclick = (e) => {
      e.preventDefault();
      ensureAudio();
      handler();
    };
  }

  // boot
  loadAll()
    .then(() => {
      state = "boot";
      draw();
      showOverlay(
        "SiekieroLas",
        "Przeciągnij siekierę w lewo (jak proca w Angry Birds) i puść. Traf grzybki i tarczę!",
        "Rzuć siekierą!"
      );
      bindStart(() => {
        score = 0;
        levelIndex = 0;
        hideOverlay();
        resetLevel();
        spawnAxeReady();
      });
      requestAnimationFrame(loop);
    })
    .catch((err) => {
      console.error(err);
      overlayTitle.textContent = "Błąd ładowania";
      overlayText.textContent = "Nie udało się wczytać grafik. Odśwież stronę.";
      startBtn.style.display = "none";
    });
})();
