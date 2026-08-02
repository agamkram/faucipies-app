(function () {
  "use strict";

  const state = {
    pies: [],
    selected: null,
    lastThrown: null,
    strength: 0,
    dragging: false,
    flying: false,
    impactHold: false,
    hasSplat: false,
    dripping: false,
  };

  /**
   * Wet cloth plop on impact only.
   * Web Audio: unlock with silent context.resume() (never plays the splat on pie select).
   * Each hit is a fresh BufferSource so we don't get late/double/missing HTMLAudio races.
   */
  const SPLAT_SRC = "assets/sfx/splat.mp3?v=4";
  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  let audioCtx = null;
  let splatBuffer = null;
  let splatLoadPromise = null;
  let audioUnlocked = false;

  function ensureAudioCtx() {
    if (!AudioCtx) return null;
    if (!audioCtx) audioCtx = new AudioCtx();
    return audioCtx;
  }

  function loadSplatBuffer() {
    const ctx = ensureAudioCtx();
    if (!ctx) return Promise.resolve(null);
    if (splatBuffer) return Promise.resolve(splatBuffer);
    if (splatLoadPromise) return splatLoadPromise;
    splatLoadPromise = fetch(SPLAT_SRC)
      .then((r) => {
        if (!r.ok) throw new Error("splat fetch failed");
        return r.arrayBuffer();
      })
      .then((ab) => {
        // Promise form is standard; copy buffer so decode can take ownership safely
        return ctx.decodeAudioData(ab.slice(0));
      })
      .then((buf) => {
        splatBuffer = buf;
        return buf;
      })
      .catch(() => {
        splatLoadPromise = null;
        return null;
      });
    return splatLoadPromise;
  }

  /** iOS/Safari: resume context on a user gesture — no audible sound. */
  function unlockAudio() {
    if (audioUnlocked) return;
    const ctx = ensureAudioCtx();
    if (!ctx) {
      audioUnlocked = true;
      return;
    }
    audioUnlocked = true;
    const resume = ctx.state === "suspended" ? ctx.resume() : Promise.resolve();
    Promise.resolve(resume)
      .then(() => loadSplatBuffer())
      .catch(() => {
        audioUnlocked = false;
      });
  }

  function playSplat(strength) {
    const ctx = ensureAudioCtx();
    const s = typeof strength === "number" ? strength : 0.7;
    const vol = Math.min(1, 0.45 + s * 0.55);

    function startFromBuffer(buf) {
      if (!ctx || !buf) return false;
      try {
        if (ctx.state === "suspended") ctx.resume();
        const src = ctx.createBufferSource();
        src.buffer = buf;
        const gain = ctx.createGain();
        gain.gain.value = vol;
        src.connect(gain);
        gain.connect(ctx.destination);
        src.start(0);
        return true;
      } catch (_) {
        return false;
      }
    }

    if (splatBuffer) {
      startFromBuffer(splatBuffer);
      return;
    }
    // Buffer still loading (first throw right after unlock) — play when ready
    loadSplatBuffer().then((buf) => {
      if (buf) startFromBuffer(buf);
    });
  }

  const els = {
    tray: document.getElementById("pie-tray"),
    figure: document.getElementById("figure"),
    figureMotion: document.getElementById("figure-motion"),
    figureWrap: document.getElementById("figure-wrap"),
    head: document.getElementById("head"),
    creamReveal: document.getElementById("story-sheet"),
    creamContent: null,
    creamLabel: document.getElementById("story-label"),
    creamBlurb: document.getElementById("story-blurb"),
    storySheet: document.getElementById("story-sheet"),
    storyLabel: document.getElementById("story-label"),
    storyBlurb: document.getElementById("story-blurb"),
    faceSplat: document.getElementById("face-splat"),
    pieSplat: document.getElementById("pie-splat"),
    creamFlecks: document.getElementById("cream-flecks"),
    creamFlecksBg: document.getElementById("cream-flecks-bg"),
    comicBurst: document.getElementById("comic-burst"),
    comicBurstText: document.getElementById("comic-burst-text"),
    splatBurst: document.getElementById("splat-burst"),
    strengthTrack: document.getElementById("strength-track"),
    strengthFill: document.getElementById("strength-fill"),
    strengthThumb: document.getElementById("strength-thumb"),
    thrower: document.getElementById("thrower"),
    arm: document.getElementById("arm"),
    handPie: document.getElementById("hand-pie"),
    handPieLabel: document.getElementById("hand-pie-label"),
    flyingPie: document.getElementById("flying-pie"),
    pieFlip: document.getElementById("pie-flip"),
    flyPieLabel: document.getElementById("fly-pie-label"),
    hint: document.getElementById("hint"),
    stage: document.querySelector(".stage"),
  };

  function clamp(n, a, b) {
    return Math.max(a, Math.min(b, n));
  }

  function labelWords(label) {
    return String(label).trim().split(/\s+/).filter(Boolean);
  }

  /** Pack pie-disc copy into 1–2 centered lines (keeps long titles readable). */
  function labelDisplayLines(label) {
    const words = labelWords(label);
    if (words.length <= 2) return words;
    if (words.length === 3) return [words[0], words.slice(1).join(" ")];
    const mid = Math.ceil(words.length / 2);
    return [words.slice(0, mid).join(" "), words.slice(mid).join(" ")];
  }

  function setPieLabel(el, label) {
    if (!el) return;
    el.replaceChildren();
    labelDisplayLines(label).forEach((line) => {
      const span = document.createElement("span");
      span.className = "pie-label-line";
      span.textContent = line;
      el.appendChild(span);
    });
  }

  function setHandEmpty() {
    els.handPie.hidden = true;
    els.handPie.style.visibility = "";
    els.thrower.classList.remove("has-pie");
    els.strengthTrack.classList.add("is-disabled");
    state.selected = null;
    updateArmPose(0);
  }

  function setHandPie(pie) {
    setPieLabel(els.handPieLabel, pie.label);
    els.handPie.hidden = false;
    els.thrower.classList.add("has-pie");
    els.strengthTrack.classList.remove("is-disabled");
  }

  function setStrength(v, { fromUser = false } = {}) {
    state.strength = clamp(v, 0, 1);
    const pct = state.strength * 100;
    // Thumb stays fully on-track: center travels from 14px to (100% - 14px)
    const thumbX = `calc(14px + ${state.strength} * (100% - 28px))`;
    els.strengthFill.style.width = thumbX;
    els.strengthThumb.style.left = thumbX;
    els.strengthTrack.setAttribute("aria-valuenow", String(Math.round(pct)));
    if (!state.flying && state.selected) {
      updateArmPose(state.strength);
    }
    if (fromUser && state.selected) {
      els.hint.textContent =
        state.strength < 0.33
          ? "Soft toss — release to lob it."
          : state.strength < 0.7
            ? "Building speed — release when ready."
            : "Hard throw — cream will fly.";
    }
  }

  function updateArmPose(strength) {
    const wind = strength;
    const rot = -8 - wind * 52;
    const pieScale = 1 - wind * 0.08;
    els.arm.style.transform = `rotate(${rot}deg)`;
    els.handPie.style.transform = `rotate(${-wind * 18}deg) scale(${pieScale})`;
    els.thrower.style.transform = `translateX(${wind * 10}px)`;
  }

  function setIdle(on) {
    // Keep the same animation running; pause instead of re-adding (avoids restart flash)
    els.figure.classList.add("is-idle");
    els.figure.classList.toggle("is-paused", !on);
  }

  function playHitReact() {
    const motion = els.figureMotion;
    if (!motion) return;
    motion.classList.remove("is-hit");
    // Force reflow so a back-to-back hit can replay without fighting idle
    void motion.offsetWidth;
    motion.classList.add("is-hit");
    window.setTimeout(() => motion.classList.remove("is-hit"), 420);
  }

  /** Clock hours → radians (0 at 3 o'clock, CCW). 12→-π/2, 6→π/2. */
  function clockToRad(hour) {
    return (hour / 12) * Math.PI * 2 - Math.PI / 2;
  }

  /** Prefer 4:30–7:30 (gravity sag); thinner cream elsewhere around the rim. */
  function splatAngle() {
    if (Math.random() < 0.62) {
      const h = 4.5 + Math.random() * 3; // 4:30 … 7:30
      return clockToRad(h);
    }
    // Sparse elsewhere — avoid a cloud; leave gaps
    const h = Math.random() < 0.5 ? Math.random() * 4.5 : 7.5 + Math.random() * 4.5;
    return clockToRad(h % 12);
  }

  /**
   * Irregular cream around the tin rim — circumferential, gravity-biased low.
   * No flying cloud burst.
   */
  function spawnRimSplat({ strength, pieRadiusPx, cx, cy }) {
    const layer = els.pieSplat;
    const host = els.head;
    if (!layer || !host) return;
    layer.innerHTML = "";
    layer.hidden = false;
    host.appendChild(layer);
    layer.style.left = cx + "px";
    layer.style.top = cy + "px";

    const count = Math.round(11 + strength * 6);
    const frag = document.createDocumentFragment();
    const rim = pieRadiusPx * 0.92;

    for (let i = 0; i < count; i++) {
      const ang = splatAngle();
      // Bottom arc sits a little farther out and hangs slightly
      const hour = ((ang + Math.PI / 2) / (Math.PI * 2)) * 12;
      const hNorm = ((hour % 12) + 12) % 12;
      const inGravity = hNorm >= 4.5 && hNorm <= 7.5;
      const reach =
        rim * (0.88 + Math.random() * 0.22) * (inGravity ? 1.07 + strength * 0.05 : 0.92);
      const dx = Math.cos(ang) * reach;
      const dy = Math.sin(ang) * reach;
      const base = 5 + strength * 4.5 + Math.random() * 6;
      const w = inGravity ? base * (1.05 + Math.random() * 0.32) : base * (0.75 + Math.random() * 0.28);
      const h = inGravity ? w * (1.05 + Math.random() * 0.48) : w * (0.72 + Math.random() * 0.32);

      const glob = document.createElement("span");
      glob.className = "splat-glob" + (inGravity ? " is-heavy" : "");
      glob.style.setProperty("--x", dx.toFixed(1) + "px");
      glob.style.setProperty("--y", dy.toFixed(1) + "px");
      glob.style.setProperty("--s", w.toFixed(1) + "px");
      glob.style.setProperty("--h", h.toFixed(1) + "px");
      glob.style.setProperty(
        "--r",
        `${40 + Math.random() * 35}% ${45 + Math.random() * 35}% ${40 + Math.random() * 40}% ${50 + Math.random() * 30}% / ${45 + Math.random() * 30}% ${40 + Math.random() * 35}% ${50 + Math.random() * 25}% ${40 + Math.random() * 30}%`
      );
      glob.style.setProperty("--delay", `${Math.round(18 + Math.random() * 90)}ms`);
      glob.style.setProperty("--spin", `${((Math.random() - 0.5) * 40).toFixed(1)}deg`);
      frag.appendChild(glob);
    }

    // Short gravity drips under the tin (6 o'clock bias)
    for (let d = 0; d < 2 + (strength > 0.55 ? 1 : 0); d++) {
      const drip = document.createElement("span");
      drip.className = "splat-drip";
      const ang = clockToRad(5.2 + Math.random() * 1.6);
      const reach = rim * (0.95 + Math.random() * 0.12);
      drip.style.setProperty("--x", (Math.cos(ang) * reach).toFixed(1) + "px");
      drip.style.setProperty("--y", (Math.sin(ang) * reach).toFixed(1) + "px");
      drip.style.setProperty("--len", `${9 + strength * 9 + Math.random() * 7}px`);
      drip.style.setProperty("--dw", `${3.4 + Math.random() * 2.8}px`);
      drip.style.setProperty("--delay", `${90 + d * 40}ms`);
      frag.appendChild(drip);
    }

    layer.appendChild(frag);
  }

  function clearPieSplat() {
    const layer = els.pieSplat;
    if (layer) {
      layer.innerHTML = "";
      layer.hidden = true;
      layer.style.left = "";
      layer.style.top = "";
    }
    clearCreamFlecks();
  }

  function clearCreamFlecks() {
    if (els.creamFlecks) els.creamFlecks.innerHTML = "";
    if (els.creamFlecksBg) els.creamFlecksBg.innerHTML = "";
    // Flecks pinned onto the subject
    if (els.head) {
      els.head.querySelectorAll(".cream-fleck").forEach((n) => n.remove());
    }
    hideComicBurst();
  }

  const COMIC_WORDS = ["Blam!", "Splat!", "Pow!", "Wham!", "Boom!"];

  function hideComicBurst() {
    const burst = els.comicBurst;
    if (!burst) return;
    burst.hidden = true;
    burst.classList.remove("is-left", "is-right", "is-pop");
  }

  function showComicBurst() {
    const burst = els.comicBurst;
    const text = els.comicBurstText;
    if (!burst || !text) return;
    const word = COMIC_WORDS[Math.floor(Math.random() * COMIC_WORDS.length)];
    const side = Math.random() < 0.5 ? "left" : "right";
    text.textContent = word;
    burst.classList.remove("is-left", "is-right", "is-pop");
    burst.classList.add(side === "left" ? "is-left" : "is-right");
    burst.hidden = false;
    void burst.offsetWidth;
    burst.classList.add("is-pop");
  }

  /**
   * Flying cream fragments (separate from rim deposit).
   * - Face: stuck on him, bobs
   * - Torso: low-falling flecks land on chest (visible above story sheet)
   * - Near bg: static under cutout for bob hide/reveal
   * - Far bg: localized upper splash only
   */
  function spawnFlyingFlecks({ strength, originX, originY }) {
    const flyLayer = els.creamFlecks;
    if (!flyLayer || !els.stage) return;
    flyLayer.innerHTML = "";

    const stageW = els.stage.clientWidth;
    const stageH = els.stage.clientHeight;
    const maxSettleY = stageH * 0.5;
    const minSettleY = stageH * 0.05;
    // Below this → redirect onto torso instead of vanishing under the story sheet
    const lowCutoff = stageH * 0.42;

    const count = Math.round(6 + strength * 6); // 6–12
    const onFaceCount = Math.max(2, Math.round(count * 0.25));
    const torsoCount = Math.max(2, Math.round(count * 0.3));
    const nearBgCount = Math.max(2, Math.round(count * 0.25));
    const face = stageFacePoint();

    for (let i = 0; i < count; i++) {
      let kind = "far";
      if (i < onFaceCount) kind = "him";
      else if (i < onFaceCount + torsoCount) kind = "torso";
      else if (i < onFaceCount + torsoCount + nearBgCount) kind = "near";

      const fleck = document.createElement("span");
      fleck.className = "cream-fleck";
      const size = 4.5 + strength * 4 + Math.random() * 5.5;
      const hh = size * (0.55 + Math.random() * 0.75);
      fleck.style.setProperty("--s", size.toFixed(1) + "px");
      fleck.style.setProperty("--h", hh.toFixed(1) + "px");
      fleck.style.setProperty(
        "--r",
        `${18 + Math.random() * 55}% ${20 + Math.random() * 55}% ${15 + Math.random() * 60}% ${22 + Math.random() * 50}% / ${12 + Math.random() * 58}% ${25 + Math.random() * 50}% ${18 + Math.random() * 55}% ${20 + Math.random() * 52}%`
      );
      fleck.style.setProperty("--skew", `${((Math.random() - 0.5) * 18).toFixed(1)}deg`);
      const spin0 = (Math.random() - 0.5) * 50;
      const spin1 = spin0 + (Math.random() - 0.5) * 140;

      let targetX;
      let targetY;
      if (kind === "him") {
        targetX = face.x + (Math.random() - 0.5) * face.w * 0.16;
        targetY = face.y + face.h * (0.05 + Math.random() * 0.12);
      } else if (kind === "torso") {
        targetX = face.x + (Math.random() - 0.5) * face.w * 0.32;
        targetY = face.y + face.h * (0.3 + Math.random() * 0.22);
      } else if (kind === "near") {
        const ang = -0.2 * Math.PI + Math.random() * 1.4 * Math.PI;
        const dist = face.w * (0.18 + Math.random() * 0.2);
        targetX = face.x + Math.cos(ang) * dist;
        targetY = face.y + Math.sin(ang) * dist * 0.75 + face.h * 0.06;
      } else {
        const side = Math.random() < 0.5 ? -1 : 1;
        targetX = originX + side * (28 + Math.random() * 48 + strength * 22);
        targetY = minSettleY + Math.random() * (lowCutoff - minSettleY) * 0.85;
      }

      const xPad = stageW * 0.18;
      targetX = clamp(targetX, xPad, stageW - xPad);
      targetY = clamp(targetY, minSettleY, maxSettleY);

      if (kind !== "him" && kind !== "torso" && targetY > lowCutoff) {
        kind = "torso";
        targetX = face.x + (Math.random() - 0.5) * face.w * 0.3;
        targetY = face.y + face.h * (0.32 + Math.random() * 0.2);
        targetX = clamp(targetX, xPad, stageW - xPad);
        targetY = clamp(targetY, minSettleY, maxSettleY);
      }

      const dur = 0.3 + Math.random() * 0.22 + strength * 0.06;
      const peakLift =
        10 +
        Math.random() * 24 +
        (kind === "him" ? 6 : kind === "torso" ? 10 : kind === "near" ? 14 : 18);
      const t0 = performance.now();
      let liveKind = kind;

      fleck.style.left = originX + "px";
      fleck.style.top = originY + "px";
      fleck.style.transform = `rotate(${spin0}deg) skewX(var(--skew, 0deg)) scale(0.55)`;
      flyLayer.appendChild(fleck);

      function tick(now) {
        const u = clamp((now - t0) / (dur * 1000), 0, 1);
        const ease = u < 0.5 ? 2 * u * u : 1 - Math.pow(-2 * u + 2, 2) / 2;
        let x = originX + (targetX - originX) * ease;
        const arc = Math.sin(Math.PI * u) * peakLift;
        let y = originY + (targetY - originY) * ease - arc;

        if (liveKind !== "him" && liveKind !== "torso" && y > lowCutoff && u > 0.35) {
          liveKind = "torso";
          targetX = face.x + (Math.random() - 0.5) * face.w * 0.28;
          targetY = face.y + face.h * (0.34 + Math.random() * 0.18);
          targetX = clamp(targetX, xPad, stageW - xPad);
          x = originX + (targetX - originX) * ease;
          y = originY + (targetY - originY) * ease - arc * 0.5;
        }

        y = Math.min(y, maxSettleY);
        const spin = spin0 + (spin1 - spin0) * u;
        const sc = 0.55 + 0.45 * Math.min(1, u * 1.35);
        fleck.style.left = x + "px";
        fleck.style.top = y + "px";
        fleck.style.transform = `rotate(${spin}deg) skewX(var(--skew, 0deg)) scale(${sc})`;
        if (u < 1) {
          requestAnimationFrame(tick);
        } else {
          settleFleck(fleck, targetX, Math.min(targetY, maxSettleY), spin, {
            kind: liveKind,
          });
        }
      }
      requestAnimationFrame(tick);
    }
  }

  function settleFleck(fleck, stageX, stageY, spin, { kind = "far" } = {}) {
    if (!fleck.isConnected) return;
    const stageRect = els.stage.getBoundingClientRect();
    const maxSettleY = stageRect.height * 0.5;
    const lowCutoff = stageRect.height * 0.42;
    stageY = Math.min(stageY, maxSettleY);

    if (kind !== "him" && kind !== "torso" && stageY > lowCutoff) {
      kind = "torso";
    }

    const screenX = stageRect.left + stageX;
    const screenY = stageRect.top + stageY;

    fleck.classList.add("is-settled");
    fleck.style.transform = `translate(-50%, -50%) rotate(${spin}deg) skewX(var(--skew, 0deg)) scale(1)`;

    if ((kind === "him" || kind === "torso") && els.head) {
      const hostR = els.head.getBoundingClientRect();
      let lx = screenX - hostR.left;
      let ly = screenY - hostR.top;
      if (kind === "him") {
        ly = clamp(ly, hostR.height * 0.04, hostR.height * 0.2);
        lx = clamp(lx, hostR.width * 0.34, hostR.width * 0.66);
      } else {
        ly = clamp(ly, hostR.height * 0.28, hostR.height * 0.48);
        lx = clamp(lx, hostR.width * 0.26, hostR.width * 0.74);
      }
      els.head.appendChild(fleck);
      fleck.style.left = lx + "px";
      fleck.style.top = ly + "px";
      fleck.classList.add("is-on-figure");
      if (kind === "torso") fleck.classList.add("is-on-torso");
    } else if (els.creamFlecksBg) {
      els.creamFlecksBg.appendChild(fleck);
      fleck.style.left = stageX + "px";
      fleck.style.top = Math.min(stageY, lowCutoff) + "px";
      fleck.classList.add("is-on-bg");
      if (kind === "near") fleck.classList.add("is-near");
    }
  }

  function showReveal(pie) {
    const sheet = els.storySheet || els.creamReveal;
    const labelEl = els.storyLabel || els.creamLabel;
    const blurbEl = els.storyBlurb || els.creamBlurb;
    labelEl.textContent = pie.label;
    blurbEl.textContent = pie.blurb;
    sheet.classList.remove("is-out", "is-visible");
    sheet.hidden = false;
    void sheet.offsetWidth;
    sheet.classList.add("is-visible");
    state.hasSplat = true;
    state.lastThrown = pie;
  }

  function hideStorySheet(immediate = true) {
    const sheet = els.storySheet || els.creamReveal;
    if (!sheet) return;
    if (immediate) {
      sheet.hidden = true;
      sheet.classList.remove("is-visible", "is-out");
      return;
    }
    if (sheet.hidden) return;
    sheet.classList.remove("is-visible");
    sheet.classList.add("is-out");
    window.setTimeout(() => {
      sheet.hidden = true;
      sheet.classList.remove("is-out");
    }, 280);
  }

  function clearSplatImmediate() {
    hideStorySheet();
    els.faceSplat.classList.remove("is-on", "is-dripping");
    els.faceSplat.style.transform = "";
    if (els.splatBurst) els.splatBurst.innerHTML = "";
    clearPieSplat();
    const fly = els.flyingPie;
    if (fly) {
      unpinLandedPie(fly);
      fly.hidden = true;
      fly.classList.remove("is-splatting", "is-landed");
      fly.style.left = "";
      fly.style.top = "";
      fly.style.width = "";
      fly.style.transform = "";
      fly.style.removeProperty("--impact-rot");
      fly.style.removeProperty("--arrive-scale");
      if (els.pieFlip) els.pieFlip.style.transform = "";
    }
    state.hasSplat = false;
    state.dripping = false;
  }

  function viewportKind() {
    const minSide = Math.min(window.innerWidth || 0, window.innerHeight || 0);
    const wide = document.documentElement.clientWidth >= 768;
    if (minSide >= 600 || wide) return "tablet";
    if (document.documentElement.classList.contains("pwa-standalone")) return "pwa";
    return "phone";
  }

  function faceAnchor() {
    const faceImg = els.head?.querySelector?.(".face") || els.head;
    const r = faceImg.getBoundingClientRect();
    // Optical face hit point in the subject PNG (eyes / bridge of nose)
    const kind = viewportKind();
    let fx = 0.45;
    let fy = 0.11;
    if (kind === "pwa") {
      // Phone PWA sits a hair low/right vs Safari
      fx = 0.435;
      fy = 0.085;
    } else if (kind === "tablet") {
      // iPad Safari: tall phone-frame — aim up/left and larger land size
      fx = 0.43;
      fy = 0.08;
    }
    return {
      img: faceImg,
      rect: r,
      fx,
      fy,
      localX: () => {
        const hostR = els.head.getBoundingClientRect();
        return r.left - hostR.left + r.width * fx;
      },
      localY: () => {
        const hostR = els.head.getBoundingClientRect();
        return r.top - hostR.top + r.height * fy;
      },
    };
  }

  function stageFacePoint() {
    const stage = els.stage.getBoundingClientRect();
    const a = faceAnchor();
    const r = a.rect;
    return {
      x: r.left + r.width * a.fx - stage.left,
      y: r.top + r.height * a.fy - stage.top,
      w: r.width,
      h: r.height,
    };
  }

  /** Park flying pie on the subject so it rocks with idle/hit motion. */
  function pinLandedPie(fly, { size, endScale, impactRot }) {
    const host = els.head;
    if (!host || !fly) return;
    const a = faceAnchor();
    const cx = a.localX();
    const cy = a.localY();
    host.appendChild(fly);
    fly.classList.add("is-landed");
    fly.classList.remove("is-splatting");
    fly.style.left = cx + "px";
    fly.style.top = cy + "px";
    fly.style.width = size + "px";
    fly.style.transform = `translate(-50%, -50%) rotate(${impactRot}deg) scale(${endScale})`;
    fly.style.setProperty("--arrive-scale", String(endScale));
    fly.style.setProperty("--impact-rot", `${impactRot}deg`);
    if (els.pieFlip) els.pieFlip.style.transform = "rotateX(180deg)";
  }

  function unpinLandedPie(fly) {
    if (!fly || !els.stage) return;
    if (fly.parentElement !== els.stage) {
      els.stage.appendChild(fly);
    }
  }

  function dripClear() {
    return new Promise((resolve) => {
      if (!state.hasSplat) {
        resolve();
        return;
      }
      // Mechanics mode: just clear the landed pie, no cream drip
      clearSplatImmediate();
      resolve();
    });
  }

  /** Move thrown pie chip to the end of the tray so it cycles back later. */
  function recyclePieToEnd(pieId) {
    const chip = els.tray.querySelector(`.pie-chip[data-id="${pieId}"]`);
    if (!chip) return;
    chip.classList.remove("is-selected");
    els.tray.appendChild(chip);
    const idx = state.pies.findIndex((p) => p.id === pieId);
    if (idx >= 0) {
      const [pie] = state.pies.splice(idx, 1);
      state.pies.push(pie);
    }
  }

  function stagePoint(el, { yBias = 0.5 } = {}) {
    const stage = els.stage.getBoundingClientRect();
    const r = el.getBoundingClientRect();
    return {
      x: r.left + r.width / 2 - stage.left,
      y: r.top + r.height * yBias - stage.top,
      w: r.width,
      h: r.height,
    };
  }

  function flyPie(pie, strength) {
    return new Promise((resolve) => {
      state.flying = true;
      // Keep idle rock running — pausing mid-cycle snaps the body on resume
      setIdle(true);
      els.strengthTrack.classList.add("is-disabled");

      // Measure while still visible, then clear the hand (avoids ? pie flash / layout pop)
      const start = stagePoint(els.handPie);
      const end0 = stageFacePoint();
      els.handPie.hidden = true;
      els.thrower.classList.remove("has-pie");

      const fly = els.flyingPie;
      unpinLandedPie(fly);
      clearPieSplat();
      const size = Math.max(start.w, 56);
      // Landed pie covers the face area — shrink from hand size down to this
      const kind = viewportKind();
      const landFrac = kind === "tablet" ? 0.38 : 0.24;
      const maxScale = kind === "tablet" ? 0.82 : 0.5;
      const landSize = Math.max(kind === "tablet" ? 64 : 40, end0.w * landFrac);
      const startScale = 1;
      const endScale = clamp(landSize / size, 0.18, maxScale);

      setPieLabel(els.flyPieLabel, pie.label);
      fly.hidden = false;
      fly.classList.remove("is-splatting", "is-landed");
      fly.style.width = size + "px";
      fly.style.left = start.x - size / 2 + "px";
      fly.style.top = start.y - size / 2 + "px";
      fly.style.transform = "rotate(0deg) scale(1)";
      fly.style.setProperty("--arrive-scale", String(endScale));
      if (els.pieFlip) els.pieFlip.style.transform = "rotateX(0deg)";

      const duration = 700 - strength * 420;
      const peakY = Math.min(start.y, end0.y) - (40 + (1 - strength) * 70);
      const t0 = performance.now();

      function frame(now) {
        const t = clamp((now - t0) / duration, 0, 1);
        const ease = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
        // Home toward the live face so travel tracks the ongoing rock
        const end = stageFacePoint();
        const x = start.x + (end.x - start.x) * ease;
        const y =
          (1 - ease) * (1 - ease) * start.y +
          2 * (1 - ease) * ease * peakY +
          ease * ease * end.y;
        const spin = ease * (140 + strength * 180);
        // Shrink with travel — hand size → face size, never grows
        const scale = startScale + (endScale - startScale) * ease;
        const flip = ease * 180;
        fly.style.left = x - size / 2 + "px";
        fly.style.top = y - size / 2 + "px";
        fly.style.transform = `rotate(${spin}deg) scale(${scale})`;
        if (els.pieFlip) els.pieFlip.style.transform = `rotateX(${flip}deg)`;

        if (t < 1) {
          requestAnimationFrame(frame);
        } else {
          const impactRot = 140 + strength * 180;
          fly.style.setProperty("--impact-rot", `${impactRot}deg`);
          fly.style.setProperty("--arrive-scale", String(endScale));
          if (els.pieFlip) els.pieFlip.style.transform = "rotateX(180deg)";
          // Pin to face before hit react so it rocks with the figure
          pinLandedPie(fly, { size, endScale, impactRot });
          const a = faceAnchor();
          spawnRimSplat({
            strength,
            pieRadiusPx: (size * endScale) / 2,
            cx: a.localX(),
            cy: a.localY(),
          });
          // Separate flying cream fragments (strength-scaled, sparse)
          const facePt = stageFacePoint();
          spawnFlyingFlecks({
            strength,
            originX: facePt.x,
            originY: facePt.y,
          });
          showComicBurst();
          fly.classList.add("is-splatting");
          playSplat(strength);
          playHitReact();
          els.hint.textContent = "Hit.";
          state.flying = false;
          state.impactHold = true;
          state.hasSplat = true;
          state.lastThrown = pie;

          window.setTimeout(() => {
            fly.classList.remove("is-splatting");
            fly.classList.add("is-landed");
            fly.style.transform = `translate(-50%, -50%) rotate(${impactRot}deg) scale(${endScale})`;
            if (els.pieFlip) els.pieFlip.style.transform = "rotateX(180deg)";
            recyclePieToEnd(pie.id);
            state.selected = null;
            setHandEmpty();
            setStrength(0);
            state.impactHold = false;
            setIdle(true);
            // Beat 2: story sheet after the splat reads
            showReveal(pie);
            els.hint.textContent = "Read the story, then pick another pie.";
            resolve();
          }, 720);
        }
      }
      requestAnimationFrame(frame);
    });
  }

  async function launch() {
    if (!state.selected || state.flying || state.dripping || state.impactHold) return;
    // Must slide at least a little from the left; farther = harder
    if (state.strength < 0.06) {
      els.hint.textContent = "Slide right a little for soft, farther for hard.";
      setStrength(0);
      return;
    }
    const strength = clamp(state.strength, 0.08, 1);
    const pie = state.selected;
    await flyPie(pie, strength);
  }

  async function selectPie(pie, chipEl) {
    if (state.flying) return;
    // If a drip is already running, remember this pick and apply when it finishes
    if (state.dripping) {
      state.pendingPie = { pie, chipEl };
      return;
    }
    if (state.hasSplat) {
      state.pendingPie = { pie, chipEl };
      await dripClear();
      const pending = state.pendingPie || { pie, chipEl };
      state.pendingPie = null;
      pie = pending.pie;
      chipEl = pending.chipEl;
    }
    state.selected = pie;
    els.tray.querySelectorAll(".pie-chip").forEach((c) => {
      c.classList.toggle("is-selected", c.dataset.id === pie.id);
    });
    if (chipEl) chipEl.classList.add("is-selected");
    setHandPie(pie);
    setStrength(0);
    updateArmPose(0);
    els.hint.textContent = "Slide right a little for soft, farther for hard — then release.";
    setIdle(true);
  }

  function renderTray() {
    els.tray.innerHTML = "";
    state.pies.forEach((pie) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "pie-chip";
      btn.dataset.id = pie.id;
      btn.setAttribute("role", "option");
      btn.setAttribute("aria-label", pie.label);
      btn.innerHTML =
        '<div class="pie-disc"><img class="pie-img" src="assets/pie.png?v=subject5" alt="" draggable="false" /><span class="pie-label-text"></span></div>';
      setPieLabel(btn.querySelector(".pie-label-text"), pie.label);
      btn.addEventListener("click", () => selectPie(pie, btn));
      els.tray.appendChild(btn);
    });
  }

  function strengthFromPointer(clientX) {
    const r = els.strengthTrack.getBoundingClientRect();
    return clamp((clientX - r.left) / r.width, 0, 1);
  }

  function bindStrength() {
    const track = els.strengthTrack;

    const onDown = (e) => {
      if (state.flying || !state.selected || state.dripping || state.hasSplat) return;
      state.dragging = true;
      track.setPointerCapture?.(e.pointerId);
      setStrength(strengthFromPointer(e.clientX), { fromUser: true });
      e.preventDefault();
    };

    const onMove = (e) => {
      if (!state.dragging) return;
      setStrength(strengthFromPointer(e.clientX), { fromUser: true });
      e.preventDefault();
    };

    const onUp = async (e) => {
      if (!state.dragging) return;
      state.dragging = false;
      try {
        track.releasePointerCapture?.(e.pointerId);
      } catch (_) {}
      await launch();
    };

    track.addEventListener("pointerdown", onDown);
    track.addEventListener("pointermove", onMove);
    track.addEventListener("pointerup", onUp);
    track.addEventListener("pointercancel", onUp);

    track.addEventListener("keydown", (e) => {
      if (!state.selected || state.flying || state.hasSplat) return;
      if (e.key === "ArrowRight" || e.key === "ArrowUp") {
        setStrength(state.strength + 0.08, { fromUser: true });
        e.preventDefault();
      } else if (e.key === "ArrowLeft" || e.key === "ArrowDown") {
        setStrength(state.strength - 0.08, { fromUser: true });
        e.preventDefault();
      } else if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        launch();
      }
    });
  }

  function waitFrames(n) {
    return new Promise((resolve) => {
      let left = n;
      function tick() {
        left -= 1;
        if (left <= 0) resolve();
        else requestAnimationFrame(tick);
      }
      requestAnimationFrame(tick);
    });
  }

  function lockAppToVisibleWidth() {
    const app = document.getElementById("app");
    const stage = document.getElementById("fit-stage");
    if (!app || !stage) return;

    const layoutW = document.documentElement.clientWidth;
    if (layoutW > 767) {
      app.style.width = "";
      app.style.maxWidth = "";
      app.style.height = "";
      app.style.marginLeft = "";
      stage.style.left = "";
      stage.style.top = "";
      stage.style.width = "";
      stage.style.height = "";
      stage.style.right = "";
      stage.style.bottom = "";
      return;
    }

    // Horizontal only — Safari 100vw left-clip. Vertical PWA fill is --pwa-fill-h.
    const vv = window.visualViewport;
    const width = Math.round(vv ? vv.width : layoutW);
    const left = Math.round(vv ? vv.offsetLeft : 0);

    stage.style.left = left + "px";
    stage.style.right = "auto";
    stage.style.width = width + "px";
    if (!document.documentElement.classList.contains("pwa-standalone")) {
      stage.style.top = "";
      stage.style.bottom = "";
      stage.style.height = "";
      app.style.height = "";
    }

    app.style.width = width + "px";
    app.style.maxWidth = "none";
    app.style.marginLeft = "0";
    app.style.boxSizing = "border-box";
  }

  function pwaFillHeightPx() {
    const iw = window.innerWidth || 0;
    const ih = window.innerHeight || 0;
    const sw = window.screen.width || 0;
    const sh = window.screen.height || 0;
    const screenMax = Math.max(sw, sh);
    const screenMin = Math.min(sw, sh);
    return ih >= iw ? Math.max(ih, screenMax) : Math.max(ih, screenMin);
  }

  function pwaExtraBottomPx() {
    const iw = window.innerWidth || 0;
    const ih = window.innerHeight || 0;
    const sw = window.screen.width || 0;
    const sh = window.screen.height || 0;
    const screenMax = Math.max(sw, sh);
    if (Math.min(iw, ih) < 600) return 0;
    if (screenMax >= ih - 10) return 0;
    const probe = document.createElement("div");
    probe.style.cssText =
      "position:fixed;visibility:hidden;pointer-events:none;padding-bottom:env(safe-area-inset-bottom,0px)";
    document.body.appendChild(probe);
    const insetB = parseFloat(getComputedStyle(probe).paddingBottom) || 0;
    probe.remove();
    return Math.max(insetB, 20);
  }

  function syncPwaFillHeight() {
    const root = document.documentElement;
    if (!root.classList.contains("pwa-standalone")) {
      root.style.removeProperty("--pwa-fill-h");
      root.style.removeProperty("--pwa-extra-b");
      root.style.removeProperty("--pwa-shortfall");
      return;
    }
    const ih = window.innerHeight || 0;
    const fillH = pwaFillHeightPx();
    const extra = pwaExtraBottomPx();
    const total = fillH + extra;
    const shortfall = Math.max(0, total - ih);
    root.style.setProperty("--pwa-fill-h", fillH + "px");
    root.style.setProperty("--pwa-extra-b", extra + "px");
    root.style.setProperty("--pwa-shortfall", shortfall + "px");
  }

  async function boot() {
    // Hide thrower pie before any async work / paint settles
    setHandEmpty();
    setIdle(false);

    const appEl = document.getElementById("app");
    const fit = window.FitToScreen.create({
      stage: "fit-stage",
      app: "app",
      phoneMaxWidth: 767,
      wideAppWidth: 420,
      capScaleAtOne: true,
      // Phone-first: fluid layout, no visualViewport box dance (that caused low→up jump)
      useScaleForLayout: () => false,
      useVisualViewport: false,
      onFit: () => {
        syncPwaFillHeight();
        lockAppToVisibleWidth();
      },
    });
    fit.bindViewportListeners();
    await fit.bootLayout();
    syncPwaFillHeight();
    lockAppToVisibleWidth();
    const onViewport = () => {
      syncPwaFillHeight();
      lockAppToVisibleWidth();
    };
    window.addEventListener("resize", onViewport, { passive: true });
    window.addEventListener("orientationchange", () => {
      setTimeout(onViewport, 50);
      setTimeout(onViewport, 300);
    });
    window.visualViewport?.addEventListener("resize", onViewport, {
      passive: true,
    });
    window.visualViewport?.addEventListener("scroll", lockAppToVisibleWidth, {
      passive: true,
    });
    window.addEventListener("pageshow", onViewport);
    setTimeout(onViewport, 100);
    setTimeout(onViewport, 400);

    const res = await fetch("data/pies.json", { cache: "no-store" });
    state.pies = await res.json();
    renderTray();
    bindStrength();
    // Unlock audio on first interaction (iOS A2HS / Safari)
    const unlockOnce = () => {
      unlockAudio();
      document.removeEventListener("pointerdown", unlockOnce, true);
    };
    document.addEventListener("pointerdown", unlockOnce, true);
    setStrength(0);
    updateArmPose(0);
    setIdle(true);
    els.hint.textContent = "Pick a pie from the tray to begin.";

    // Wait for subject image so layout doesn’t pop
    const face = els.head?.querySelector("img.face");
    if (face && !face.complete) {
      await Promise.race([
        new Promise((r) => face.addEventListener("load", r, { once: true })),
        new Promise((r) => face.addEventListener("error", r, { once: true })),
        new Promise((r) => setTimeout(r, 1200)),
      ]);
    }
    if (face?.decode) {
      try {
        await face.decode();
      } catch (_) {}
    }

    await waitFrames(2);
    syncPwaFillHeight();
    lockAppToVisibleWidth();
    appEl.classList.add("is-ready");
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
