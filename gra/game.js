(() => {
  "use strict";

  const scoreEl = document.getElementById("score");
  const levelLabel = document.getElementById("levelLabel");
  const axesLeftEl = document.getElementById("axesLeft");
  const toastEl = document.getElementById("toast");
  const overlay = document.getElementById("overlay");
  const overlayTitle = document.getElementById("overlayTitle");
  const overlayText = document.getElementById("overlayText");
  const startBtn = document.getElementById("startBtn");

  const W = 1280;
  const H = 720;
  const GROUND = H * 0.78;
  const SLING = { x: 190, y: GROUND - 110 };
  const MAX_PULL = 160;

  const LEVELS = [
    {
      name: "Polana",
      bg: "bg",
      axes: 5,
      mushrooms: [
        { x: 620, y: GROUND - 50 },
        { x: 780, y: GROUND - 50 },
      ],
      targets: [{ x: 980, y: GROUND - 70 }],
    },
    {
      name: "Pagórek",
      bg: "bgAlt",
      axes: 5,
      mushrooms: [
        { x: 700, y: GROUND - 50 },
        { x: 850, y: GROUND - 110 },
        { x: 980, y: GROUND - 50 },
      ],
      targets: [{ x: 1140, y: GROUND - 70 }],
    },
    {
      name: "Zmierzch",
      bg: "bgNight",
      axes: 6,
      mushrooms: [
        { x: 680, y: GROUND - 50 },
        { x: 820, y: GROUND - 50 },
        { x: 940, y: GROUND - 120 },
        { x: 1040, y: GROUND - 50 },
      ],
      targets: [
        { x: 1160, y: GROUND - 70 },
        { x: 1000, y: GROUND - 210 },
      ],
    },
    {
      name: "Finał",
      bg: "bg",
      axes: 6,
      mushrooms: [
        { x: 660, y: GROUND - 50 },
        { x: 780, y: GROUND - 50 },
        { x: 880, y: GROUND - 110 },
        { x: 980, y: GROUND - 50 },
        { x: 1080, y: GROUND - 140 },
      ],
      targets: [{ x: 1200, y: GROUND - 70 }],
    },
  ];

  let score = 0;
  let levelIndex = 0;
  let axesLeft = 5;
  let gameScene = null;

  function hud() {
    scoreEl.textContent = String(score);
    levelLabel.textContent = `${levelIndex + 1}/${LEVELS.length}`;
    axesLeftEl.textContent = `🪓 ${axesLeft}`;
  }

  function toast(msg, ms = 2800) {
    toastEl.textContent = msg || "";
    toastEl.classList.toggle("hidden", !msg);
    clearTimeout(toast._t);
    if (msg) toast._t = setTimeout(() => toast(""), ms);
  }

  function showOverlay(title, text, btn, onClick) {
    overlayTitle.textContent = title;
    overlayText.textContent = text;
    startBtn.textContent = btn;
    overlay.classList.remove("hidden");
    startBtn.onclick = (e) => {
      e.preventDefault();
      overlay.classList.add("hidden");
      onClick();
    };
  }

  /** Rysuje siekierę do tekstury Phaser — BEZ białego tła */
  function makeAxeTexture(scene) {
    const g = scene.make.graphics({ x: 0, y: 0, add: false });
    // trzonek
    g.fillStyle(0x6b3f1a, 1);
    g.fillRoundedRect(4, 28, 70, 14, 4);
    g.fillStyle(0x9a6230, 1);
    g.fillRect(6, 29, 66, 5);
    // oplot
    g.fillStyle(0x2a1810, 1);
    g.fillRoundedRect(4, 25, 24, 20, 3);
    // tuleja
    g.fillStyle(0x4a5160, 1);
    g.fillRect(68, 24, 14, 22);
    g.fillStyle(0x7a8494, 1);
    g.fillRect(70, 26, 4, 18);
    // głownia
    g.fillStyle(0x2f3642, 1);
    g.beginPath();
    g.moveTo(78, 8);
    g.lineTo(118, 22);
    g.lineTo(128, 35);
    g.lineTo(118, 48);
    g.lineTo(78, 62);
    g.lineTo(90, 35);
    g.closePath();
    g.fillPath();
    g.fillStyle(0x556070, 1);
    g.beginPath();
    g.moveTo(86, 18);
    g.lineTo(112, 28);
    g.lineTo(118, 35);
    g.lineTo(112, 42);
    g.lineTo(86, 52);
    g.lineTo(94, 35);
    g.closePath();
    g.fillPath();
    // złota krawędź
    g.lineStyle(3, 0xe8b020, 1);
    g.beginPath();
    g.moveTo(118, 22);
    g.lineTo(128, 35);
    g.lineTo(118, 48);
    g.strokePath();
    // nit
    g.fillStyle(0xc9a227, 1);
    g.fillCircle(86, 35, 4);
    g.fillStyle(0xf0d56a, 1);
    g.fillCircle(86, 35, 1.8);

    g.generateTexture("axe", 140, 70);
    g.destroy();
  }

  class MainScene extends Phaser.Scene {
    constructor() {
      super("main");
    }

    preload() {
      this.load.image("bg", "assets/bg.jpg");
      this.load.image("bgAlt", "assets/bg-alt.jpg");
      this.load.image("bgNight", "assets/bg-night.jpg");
      this.load.image("hero", "assets/hero.png");
      this.load.image("mushroom", "assets/mushroom.png");
      this.load.image("target", "assets/target.png");
    }

    create() {
      gameScene = this;
      makeAxeTexture(this);

      this.bg = this.add.image(W / 2, H / 2, "bg").setDisplaySize(W, H);
      // trawa / ziemia
      this.add.rectangle(W / 2, (GROUND + H) / 2, W, H - GROUND, 0x3d6b2e, 0.85);

      this.hero = this.add.image(SLING.x - 90, GROUND - 55, "hero").setDisplaySize(140, 118);
      // pień
      this.add.rectangle(SLING.x - 20, GROUND - 18, 70, 28, 0x8b5a32);
      // proca
      this.slingGfx = this.add.graphics();
      this.drawSling(SLING.x, SLING.y);

      this.mushrooms = this.physics.add.staticGroup();
      this.targets = this.physics.add.staticGroup();

      this.axe = this.physics.add.image(SLING.x, SLING.y, "axe");
      this.axe.setDisplaySize(110, 55);
      this.axe.body.setSize(50, 36);
      this.axe.body.setOffset(55, 16);
      this.axe.body.allowGravity = false;
      this.axe.setCollideWorldBounds(false);
      this.axe.setDepth(10);

      this.dragLine = this.add.graphics().setDepth(9);
      this.dots = this.add.graphics().setDepth(8);
      this.hint = this.add
        .text(SLING.x, SLING.y - 55, "⬅ ciągnij", {
          fontFamily: "Fredoka, sans-serif",
          fontSize: "18px",
          color: "#fff4dc",
          stroke: "#1f140c",
          strokeThickness: 4,
        })
        .setOrigin(0.5)
        .setDepth(11);

      this.levelTag = this.add
        .text(24, 18, "", {
          fontFamily: "Fredoka, sans-serif",
          fontSize: "16px",
          color: "#fff4dc",
          backgroundColor: "#1f140c88",
          padding: { x: 10, y: 6 },
        })
        .setDepth(20);

      this.mode = "idle"; // idle | aim | fly | wait
      this.pull = { dx: 0, dy: 0 };
      this.waitTimer = 0;

      this.input.on("pointerdown", this.onDown, this);
      this.input.on("pointermove", this.onMove, this);
      this.input.on("pointerup", this.onUp, this);
      this.input.on("pointerupoutside", this.onUp, this);

      this.physics.add.overlap(this.axe, this.mushrooms, this.hitMushroom, null, this);
      this.physics.add.overlap(this.axe, this.targets, this.hitTarget, null, this);

      this.playing = false;
      window.__scene = this;
      // NIE pauzujemy sceny — fizyka musi tykać ciągle
    }

    startLevel(resetScore) {
      if (resetScore) {
        score = 0;
        levelIndex = 0;
      }
      const L = LEVELS[levelIndex];
      axesLeft = L.axes;
      hud();

      this.bg.setTexture(L.bg).setDisplaySize(W, H);
      this.levelTag.setText(L.name);

      this.mushrooms.clear(true, true);
      this.targets.clear(true, true);

      L.mushrooms.forEach((m) => {
        const spr = this.mushrooms.create(m.x, m.y, "mushroom");
        spr.setDisplaySize(120, 130);
        spr.body.setSize(90, 100);
        spr.refreshBody();
        spr.setData("alive", true);
      });
      L.targets.forEach((t) => {
        const spr = this.targets.create(t.x, t.y, "target");
        spr.setDisplaySize(130, 170);
        spr.body.setSize(90, 120);
        spr.refreshBody();
        spr.setData("hit", false);
      });

      this.resetAxe();
      this.mode = "idle";
      this.playing = true;
      toast("Ciągnij siekierę w LEWO, potem puść");
    }

    resetAxe() {
      this.axe.setPosition(SLING.x, SLING.y);
      this.axe.setRotation(-0.35);
      this.axe.setAngularVelocity(0);
      this.axe.body.setVelocity(0, 0);
      this.axe.body.allowGravity = false;
      this.axe.setVisible(true);
      this.axe.setActive(true);
      this.hint.setVisible(true);
      this.dragLine.clear();
      this.dots.clear();
      this.drawSling(SLING.x, SLING.y);
    }

    drawSling(ax, ay) {
      const g = this.slingGfx;
      g.clear();
      g.lineStyle(10, 0x5a3318, 1);
      g.lineBetween(SLING.x - 22, GROUND - 8, SLING.x - 28, GROUND - 125);
      g.lineBetween(SLING.x + 18, GROUND - 8, SLING.x + 24, GROUND - 125);
      g.lineStyle(6, 0x8a5a2b, 1);
      g.lineBetween(SLING.x - 22, GROUND - 8, SLING.x - 28, GROUND - 125);
      g.lineBetween(SLING.x + 18, GROUND - 8, SLING.x + 24, GROUND - 125);
      if (this.mode === "aim" || this.mode === "idle") {
        g.lineStyle(4, 0x4a2818, 0.9);
        g.lineBetween(SLING.x - 28, GROUND - 125, ax, ay);
        g.lineBetween(SLING.x + 24, GROUND - 125, ax, ay);
      }
    }

    onDown(pointer) {
      if (!this.playing || this.mode !== "idle") return;
      if (pointer.x > W * 0.55) return;
      this.mode = "aim";
      this.hint.setVisible(false);
      toast("Puść, żeby rzucić!");
      this.onMove(pointer);
    }

    onMove(pointer) {
      if (this.mode !== "aim") return;
      let dx = pointer.x - SLING.x;
      let dy = pointer.y - SLING.y;
      // wymuś lewo
      if (dx > -10) dx = -10 - Math.abs(dy) * 0.1;
      const len = Math.hypot(dx, dy) || 1;
      const cap = Math.min(len, MAX_PULL);
      dx = (dx / len) * cap;
      dy = (dy / len) * cap;
      if (dy < -110) dy = -110;
      if (dy > 100) dy = 100;
      this.pull.dx = dx;
      this.pull.dy = dy;

      const ax = SLING.x + dx;
      const ay = SLING.y + dy;
      this.axe.setPosition(ax, ay);
      this.axe.setRotation(Math.atan2(-dy, -dx) - 0.1);
      this.drawSling(ax, ay);
      this.drawTrajectory(dx, dy);
    }

    drawTrajectory(dx, dy) {
      const pull = Math.min(Math.hypot(dx, dy) / MAX_PULL, 1);
      const power = 720 + pull * 780;
      let vx = Math.max(480, (-dx / MAX_PULL) * power);
      let vy = (-dy / MAX_PULL) * power;
      // lekki łuk, nie rakieta w kosmos
      vy = Math.min(vy, -80) - pull * 90;
      if (vy < -420) vy = -420;

      this.dots.clear();
      let x = SLING.x + dx;
      let y = SLING.y + dy;
      const g = 820;
      for (let i = 0; i < 32; i++) {
        vy += g * 0.04;
        x += vx * 0.04;
        y += vy * 0.04;
        if (y > GROUND) break;
        this.dots.fillStyle(0xfff4dc, 0.3 + pull * 0.5);
        this.dots.fillCircle(x, y, i % 2 ? 2.5 : 4);
      }
    }

    onUp() {
      if (!this.playing || this.mode !== "aim") return;
      const pull = Math.min(Math.hypot(this.pull.dx, this.pull.dy) / MAX_PULL, 1);
      if (pull < 0.08) {
        this.resetAxe();
        this.mode = "idle";
        toast("Ciągnij mocniej w lewo");
        return;
      }

      const power = 720 + pull * 780;
      let vx = Math.max(480, (-this.pull.dx / MAX_PULL) * power);
      let vy = (-this.pull.dy / MAX_PULL) * power;
      vy = Math.min(vy, -80) - pull * 90;
      if (vy < -420) vy = -420;

      this.mode = "fly";
      this.dragLine.clear();
      this.dots.clear();
      this.drawSling(SLING.x, SLING.y);
      this.hint.setVisible(false);

      this.physics.world.gravity.y = 820;
      this.axe.body.allowGravity = true;
      this.axe.body.setVelocity(vx, vy);
      this.axe.setAngularVelocity(300 + pull * 240);

      axesLeft -= 1;
      hud();
      toast("");
    }

    hitMushroom(axe, mush) {
      if (this.mode !== "fly") return;
      if (!mush.getData("alive")) return;
      mush.setData("alive", false);
      mush.disableBody(true, true);
      score += 100;
      hud();
      this.tweens.add({
        targets: mush,
        scale: 0,
        alpha: 0,
        duration: 200,
      });
      this.burst(mush.x, mush.y, 0xe85a4f);
      this.floatText(mush.x, mush.y - 40, "+100");
      // lekko spowolnij siekierę
      axe.body.velocity.x *= 0.65;
      axe.body.velocity.y *= 0.55;
    }

    hitTarget(axe, tg) {
      if (this.mode !== "fly") return;
      if (tg.getData("hit")) return;
      tg.setData("hit", true);
      score += 150;
      hud();
      this.burst(tg.x, tg.y - 40, 0xf0b429);
      this.floatText(tg.x, tg.y - 80, "+150");
      // zielony check
      const ok = this.add
        .circle(tg.x, tg.y - 50, 22, 0x2f8f4e)
        .setDepth(12);
      this.add
        .text(tg.x, tg.y - 50, "✓", {
          fontSize: "22px",
          color: "#fff4dc",
        })
        .setOrigin(0.5)
        .setDepth(13);
      // odbicie
      axe.body.velocity.x *= -0.2;
      axe.body.velocity.y = -Math.abs(axe.body.velocity.y) * 0.3 - 60;
    }

    burst(x, y, color) {
      for (let i = 0; i < 12; i++) {
        const p = this.add.circle(x, y, 3 + Math.random() * 4, color).setDepth(15);
        this.tweens.add({
          targets: p,
          x: x + (Math.random() - 0.5) * 120,
          y: y + (Math.random() - 0.5) * 120,
          alpha: 0,
          duration: 400 + Math.random() * 300,
          onComplete: () => p.destroy(),
        });
      }
    }

    floatText(x, y, msg) {
      const t = this.add
        .text(x, y, msg, {
          fontFamily: "Fredoka, sans-serif",
          fontSize: "26px",
          color: "#fff4dc",
          stroke: "#1f140c",
          strokeThickness: 5,
        })
        .setOrigin(0.5)
        .setDepth(16);
      this.tweens.add({
        targets: t,
        y: y - 50,
        alpha: 0,
        duration: 900,
        onComplete: () => t.destroy(),
      });
    }

    allMushroomsDown() {
      return this.mushrooms.countActive(true) === 0;
    }

    endThrow() {
      if (this.mode !== "fly") return;
      this.mode = "wait";
      this.waitTimer = 0.35;
      this.axe.body.setVelocity(0, 0);
      this.axe.setAngularVelocity(0);
      this.axe.body.allowGravity = false;
    }

    afterThrow() {
      if (this.allMushroomsDown()) {
        this.playing = false;
        if (levelIndex >= LEVELS.length - 1) {
          showOverlay("Wygrana!", `Wynik: ${score} pkt`, "Od nowa", () => {
            this.startLevel(true);
          });
        } else {
          showOverlay(`Poziom ${levelIndex + 1} ✓`, `„${LEVELS[levelIndex].name}” — ${score} pkt`, "Dalej", () => {
            levelIndex += 1;
            this.startLevel(false);
          });
        }
        return;
      }
      if (axesLeft <= 0) {
        this.playing = false;
        showOverlay("Koniec siekier", `Wynik: ${score}`, "Ponów", () => {
          this.startLevel(false);
        });
        return;
      }
      this.resetAxe();
      this.mode = "idle";
      toast("Znowu: ciągnij i puść");
    }

    update(_, dtMs) {
      if (!this.playing) return;
      const dt = Math.min(dtMs / 1000, 0.05);

      if (this.mode === "idle") {
        this.hint.setAlpha(0.65 + 0.35 * Math.sin(this.time.now / 280));
      }

      if (this.mode === "wait") {
        this.waitTimer -= dt;
        if (this.waitTimer <= 0) this.afterThrow();
        return;
      }

      if (this.mode !== "fly") return;

      // ziemia
      if (this.axe.y > GROUND - 18) {
        this.axe.y = GROUND - 18;
        this.burst(this.axe.x, this.axe.y, 0xc4a574);
        this.endThrow();
        return;
      }
      if (this.axe.x > W + 80 || this.axe.x < -100 || this.axe.y < -100) {
        this.endThrow();
      }
    }
  }

  const config = {
    type: Phaser.AUTO,
    parent: "game",
    width: W,
    height: H,
    backgroundColor: "#1a2a12",
    physics: {
      default: "arcade",
      arcade: {
        gravity: { y: 0 },
        debug: false,
      },
    },
    scale: {
      mode: Phaser.Scale.FIT,
      autoCenter: Phaser.Scale.CENTER_BOTH,
    },
    scene: MainScene,
  };

  const game = new Phaser.Game(config);

  // poczekaj na scenę, potem podłącz Start
  const boot = setInterval(() => {
    if (!gameScene) return;
    clearInterval(boot);
    showOverlay(
      "SiekieroLas",
      "Silnik Phaser 3 + fizyka Arcade. Przeciągnij siekierę w LEWO i puść — zniszcz grzybki!",
      "Start",
      () => gameScene.startLevel(true)
    );
  }, 50);
})();
