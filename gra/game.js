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
  const tipEl = document.getElementById("tip");

  const W = canvas.width;
  const H = canvas.height;
  const GROUND_Y = H * 0.82;
  const ORIGIN = { x: 190, y: GROUND_Y - 78 };
  const MAX_PULL = 150;
  const GRAVITY = 1650;
  const AIR = 0.998;
  const GRAB_R = 220; // łatwe chwycenie

  const imgs = {};
  const ASSETS = {
    bg: "assets/bg.png",
    bgAlt: "assets/bg-alt.png",
    bgNight: "assets/bg-night.png",
    hero: "assets/hero.png",
    axe: "assets/axe.png",
    target: "assets/target.png",
    mushroom: "assets/mushroom.png",
  };

  const LEVELS = [
    {
      name: "Polana grzybków",
      bg: "bg",
      axes: 4,
      mushrooms: [
        { x: 860, y: GROUND_Y - 55, r: 52 },
        { x: 1000, y: GROUND_Y - 55, r: 52 },
      ],
      targets: [{ x: 1140, y: GROUND_Y - 100, r: 74 }],
    },
    {
      name: "Wieża w lesie",
      bg: "bgAlt",
      axes: 4,
      mushrooms: [
        { x: 800, y: GROUND_Y - 55, r: 50 },
        { x: 920, y: GROUND_Y - 125, r: 46 },
        { x: 1040, y: GROUND_Y - 55, r: 50 },
      ],
      targets: [{ x: 1170, y: GROUND_Y - 110, r: 70 }],
    },
    {
      name: "Nocna tarcza",
      bg: "bgNight",
      axes: 5,
      mushrooms: [
        { x: 740, y: GROUND_Y - 55, r: 48 },
        { x: 880, y: GROUND_Y - 55, r: 48 },
        { x: 960, y: GROUND_Y - 150, r: 44 },
        { x: 1060, y: GROUND_Y - 55, r: 50 },
      ],
      targets: [
        { x: 1170, y: GROUND_Y - 105, r: 68 },
        { x: 1020, y: GROUND_Y - 250, r: 54 },
      ],
    },
    {
      name: "Królewski rzut",
      bg: "bg",
      axes: 5,
      mushrooms: [
        { x: 700, y: GROUND_Y - 55, r: 46 },
        { x: 820, y: GROUND_Y - 55, r: 46 },
        { x: 900, y: GROUND_Y - 130, r: 42 },
        { x: 1000, y: GROUND_Y - 55, r: 48 },
        { x: 1100, y: GROUND_Y - 160, r: 44 },
      ],
      targets: [{ x: 1190, y: GROUND_Y - 110, r: 66 }],
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
  let pulseT = 0;
  let tipTimer = 0;

  function loadImage(src) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error("Nie wczytano: " + src));
      img.src = src;
    });
  }

  async function loadAll() {
    await Promise.all(
      Object.entries(ASSETS).map(async ([key, src]) => {
        imgs[key] = await loadImage(src);
      })
    );
  }

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

  function setTip(text, ms = 4500) {
    if (!tipEl) return;
    tipEl.textContent = text;
    tipEl.classList.toggle("hidden", !text);
    tipTimer = text ? ms / 1000 : 0;
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
    setTip("Chwyć siekierę przy drwalu → przeciągnij w LEWO → puść");
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
    setTip("");
  }

  function hideOverlay() {
    overlay.classList.add("hidden");
  }

  function spawnAxeReady() {
    axe = {
      x: ORIGIN.x + 36,
      y: ORIGIN.y - 8,
      vx: 0,
      vy: 0,
      angle: -0.55,
      spin: 0,
      stuck: false,
      flying: false,
      radius: 30,
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

  function canGrab(p) {
    // lewa część ekranu albo blisko siekiery / originu
    if (p.x < W * 0.42 && p.y > H * 0.35 && p.y < GROUND_Y + 20) return true;
    if (!axe) return false;
    return Math.hypot(p.x - axe.x, p.y - axe.y) < GRAB_R;
  }

  function startPull(p) {
    if (state !== "ready" || !axe || axe.flying) return;
    if (!canGrab(p)) return;
    ensureAudio();
    aim.pulling = true;
    canvas.classList.add("dragging");
    state = "aim";
    setTip("Puść, żeby rzucić!");
    updateAim(p);
  }

  function updateAim(p) {
    if (!aim.pulling || !axe) return;
    let dx = p.x - ORIGIN.x;
    let dy = p.y - ORIGIN.y;
    const len = Math.hypot(dx, dy) || 1;
    const capped = Math.min(len, MAX_PULL);
    dx = (dx / len) * capped;
    dy = (dy / len) * capped;
    // preferuj ciągnięcie w lewo (jak proca)
    if (dx > 30) dx = 30;
    aim.dx = dx;
    aim.dy = dy;
    axe.x = ORIGIN.x + dx;
    axe.y = ORIGIN.y + dy;
    axe.angle = Math.atan2(-dy, -dx) + 0.2;
  }

  function releaseThrow() {
    if (!aim.pulling || !axe) return;
    aim.pulling = false;
    canvas.classList.remove("dragging");
    const power = Math.min(Math.hypot(aim.dx, aim.dy) / MAX_PULL, 1);
    if (power < 0.1) {
      spawnAxeReady();
      state = "ready";
      setTip("Ciągnij mocniej w lewo, potem puść");
      return;
    }
    const speed = 1050 + power * 1350;
    axe.vx = (-aim.dx / MAX_PULL) * speed;
    axe.vy = (-aim.dy / MAX_PULL) * speed;
    // zawsze leć w prawo, jeśli ciągnięto w lewo
    if (axe.vx < 120) axe.vx = 120 + power * 400;
    axe.spin = 12 + power * 16;
    axe.flying = true;
    axesLeft -= 1;
    updateHud();
    sfxThrow();
    state = "fly";
    setTip("");
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
    floatTexts.push({ x, y, text, age: 0, life: 1.15 });
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
    const ratio = dist / Math.max(1, t.r);
    let pts = 50;
    let label = "+50";
    if (ratio < 0.25) {
      pts = 300;
      label = "BULLSEYE! +300";
      sfxBull();
    } else if (ratio < 0.5) {
      pts = 150;
      label = "+150";
      sfxHit();
    } else {
      sfxHit();
    }
    score += pts;
    shake = 10;
    burst(axeObj.x, axeObj.y, "#f4d35e", 22);
    floatScore(t.x, t.y - 90, label);
    axeObj.stuck = true;
    axeObj.flying = false;
    axeObj.vx = 0;
    axeObj.vy = 0;
    axeObj.spin = 0;
    updateHud();
  }

  function allCleared() {
    return (
      mushrooms.every((m) => !m.alive) &&
      targets.every((t) => t.hits >= t.maxHits)
    );
  }

  function bindStart(handler) {
    startBtn.onclick = (e) => {
      e.preventDefault();
      ensureAudio();
      handler();
    };
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
    setTip("Znowu: przeciągnij siekierę w lewo i puść");
  }

  function update(dt) {
    heroBob += dt * 2.2;
    pulseT += dt;
    shake = Math.max(0, shake - dt * 30);

    if (tipTimer > 0) {
      tipTimer -= dt;
      if (tipTimer <= 0) setTip("");
    }

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
      f.y -= 45 * dt;
    }
    floatTexts = floatTexts.filter((f) => f.age < f.life);

    if (wind.length < 16 && Math.random() < 0.07) {
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

    if (axe.y + axe.radius > GROUND_Y) {
      axe.y = GROUND_Y - axe.radius;
      axe.flying = false;
      axe.vx *= 0.25;
      axe.vy = 0;
      axe.spin *= 0.15;
      burst(axe.x, axe.y, "#c4a574", 8);
      sfxMiss();
      state = "settle";
      setTimeout(afterThrowSettle, 500);
      return;
    }

    if (axe.x > W + 100 || axe.x < -140 || axe.y < -140) {
      axe.flying = false;
      state = "settle";
      setTimeout(afterThrowSettle, 350);
      return;
    }

    for (const m of mushrooms) {
      if (!m.alive) continue;
      const dx = axe.x - m.x;
      const dy = axe.y - (m.y - 10);
      if (Math.hypot(dx, dy) < axe.radius + m.r * 0.75) {
        hitMushroom(m);
        axe.vx *= 0.55;
        axe.vy *= 0.35;
        axe.spin *= 0.55;
      }
    }

    for (const t of targets) {
      if (t.hits >= t.maxHits) continue;
      const cx = t.x;
      const cy = t.y - 18;
      if (Math.hypot(axe.x - cx, axe.y - cy) < axe.radius + t.r * 0.78) {
        hitTarget(t, axe);
        state = "settle";
        setTimeout(afterThrowSettle, 650);
        return;
      }
    }
  }

  function drawBackground() {
    const L = LEVELS[levelIndex];
    const bg = imgs[L.bg] || imgs.bg;
    ctx.drawImage(bg, 0, 0, W, H);

    // ground
    ctx.fillStyle = "#3d6b2e";
    ctx.fillRect(0, GROUND_Y, W, H - GROUND_Y);
    ctx.fillStyle = "#5a8f3d";
    ctx.beginPath();
    ctx.moveTo(0, GROUND_Y);
    for (let x = 0; x <= W; x += 40) {
      ctx.lineTo(x, GROUND_Y - 5 - Math.sin(x * 0.03 + levelIndex) * 3);
    }
    ctx.lineTo(W, H);
    ctx.lineTo(0, H);
    ctx.closePath();
    ctx.fill();

    // soft path
    ctx.fillStyle = "rgba(140, 100, 55, 0.35)";
    ctx.beginPath();
    ctx.moveTo(0, GROUND_Y + 8);
    ctx.quadraticCurveTo(W * 0.45, GROUND_Y + 28, W, GROUND_Y + 6);
    ctx.lineTo(W, GROUND_Y + 58);
    ctx.quadraticCurveTo(W * 0.45, GROUND_Y + 78, 0, GROUND_Y + 48);
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
    const bob = Math.sin(heroBob) * 3;
    // platform
    ctx.fillStyle = "#6b4226";
    ctx.beginPath();
    ctx.ellipse(ORIGIN.x - 10, GROUND_Y - 6, 62, 14, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#8a5a32";
    ctx.fillRect(ORIGIN.x - 55, GROUND_Y - 36, 78, 32);

    if (imgs.hero) {
      const hw = 160;
      const hh = 135;
      ctx.drawImage(imgs.hero, ORIGIN.x - 125, ORIGIN.y - hh + 36 + bob, hw, hh);
    }
  }

  function drawAimGuide() {
    if (state !== "aim" || !axe) return;
    const power = Math.min(Math.hypot(aim.dx, aim.dy) / MAX_PULL, 1);

    ctx.strokeStyle = "rgba(90, 50, 20, 0.8)";
    ctx.lineWidth = 3.5;
    ctx.beginPath();
    ctx.moveTo(ORIGIN.x - 18, ORIGIN.y + 12);
    ctx.lineTo(axe.x, axe.y);
    ctx.lineTo(ORIGIN.x + 14, ORIGIN.y + 22);
    ctx.stroke();

    let x = ORIGIN.x + aim.dx;
    let y = ORIGIN.y + aim.dy;
    const speed = 1050 + power * 1350;
    let vx = (-aim.dx / MAX_PULL) * speed;
    let vy = (-aim.dy / MAX_PULL) * speed;
    if (vx < 120) vx = 120 + power * 400;
    ctx.fillStyle = `rgba(255, 246, 224, ${0.3 + power * 0.55})`;
    for (let i = 0; i < 20; i++) {
      vx *= AIR;
      vy += GRAVITY * 0.042;
      x += vx * 0.042;
      y += vy * 0.042;
      if (y > GROUND_Y) break;
      ctx.beginPath();
      ctx.arc(x, y, 3 + (i % 3), 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.strokeStyle = `rgba(232, 163, 23, ${0.4 + power * 0.5})`;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(ORIGIN.x, ORIGIN.y, 24 + power * 34, 0, Math.PI * 2);
    ctx.stroke();
  }

  function drawReadyHint() {
    if (state !== "ready" || !axe) return;
    const p = 0.5 + 0.5 * Math.sin(pulseT * 3.2);
    ctx.save();
    ctx.strokeStyle = `rgba(232, 163, 23, ${0.35 + p * 0.45})`;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(axe.x, axe.y, 34 + p * 10, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = `rgba(255, 246, 224, ${0.55 + p * 0.35})`;
    ctx.font = "700 18px Fredoka, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("⬅ ciągnij", axe.x - 10, axe.y - 48);
    ctx.restore();
  }

  function drawAxe() {
    if (!axe) return;
    ctx.save();
    ctx.translate(axe.x, axe.y);
    ctx.rotate(axe.angle);
    const size = 86;
    if (imgs.axe) {
      ctx.drawImage(imgs.axe, -size * 0.5, -size * 0.5, size, size);
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
      const s = m.r * 2.5;
      if (imgs.mushroom) {
        ctx.drawImage(imgs.mushroom, -s / 2, -s * 0.88, s, s * 0.92);
      }
      ctx.restore();
    }
  }

  function drawTargets() {
    for (const t of targets) {
      ctx.save();
      ctx.translate(t.x, t.y);
      const pulse = 1 + t.pulse * 0.1;
      ctx.scale(pulse, pulse);
      const done = t.hits >= t.maxHits;
      const s = t.r * 2.7;
      if (imgs.target) {
        ctx.globalAlpha = done ? 0.7 : 1;
        ctx.drawImage(imgs.target, -s / 2, -s * 0.78, s, s);
      }
      if (done) {
        ctx.globalAlpha = 1;
        ctx.fillStyle = "rgba(46, 140, 70, 0.92)";
        ctx.beginPath();
        ctx.arc(0, -28, 26, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = "#fff6e0";
        ctx.lineWidth = 5;
        ctx.beginPath();
        ctx.moveTo(-10, -28);
        ctx.lineTo(-2, -18);
        ctx.lineTo(14, -40);
        ctx.stroke();
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
      ctx.font = "700 30px Fredoka, sans-serif";
      ctx.fillStyle = "#fff6e0";
      ctx.strokeStyle = "rgba(42,26,14,0.75)";
      ctx.lineWidth = 5;
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
    drawReadyHint();
    drawAimGuide();
    drawAxe();
    drawParticles();
    drawFloatTexts();

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
    if (state !== "boot" && state !== "overlay") update(dt);
    if (state !== "boot") draw();
    requestAnimationFrame(loop);
  }

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

  loadAll()
    .then(() => {
      state = "boot";
      draw();
      showOverlay(
        "SiekieroLas",
        "Przeciągnij siekierę w LEWO (jak proca) i puść. Traf grzybki i tarczę!",
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
      overlayText.textContent =
        "Nie udało się wczytać grafik. Odśwież stronę. (" + err.message + ")";
      startBtn.style.display = "none";
    });
})();
