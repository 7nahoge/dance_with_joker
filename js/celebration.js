"use strict";
(() => {
  const panel = document.getElementById("celebration");
  const canvas = document.getElementById("fireworks");
  const ctx = canvas.getContext("2d");
  const rain = document.getElementById("circus-rain");
  const reduced = matchMedia("(prefers-reduced-motion: reduce)");
  const colors = ["#c49b94", "#abb4a0", "#c8b684", "#a7a1b5", "#9bb4b7"];
  let audioSources = [], audioCache = null;
  // Layered orchestral waltz for the finale, with no applause track.
  // Buffers share the game's master gain, including its volume/mute controls.
  function celebrationAudio(context, master) {
    if (!context || !master) return;
    if (!audioCache || audioCache.context !== context) {
      const rate = 22050, beat = 60 / 156, duration = 48 * beat;
      const music = context.createBuffer(2, Math.round(duration * rate), rate);
      const left = music.getChannelData(0), right = music.getChannelData(1);
      function note(midi, at, length, gain, pan = 0, voice = "brass") {
        const frequency = 440 * 2 ** ((midi - 69) / 12);
        for (let i = 0; i < Math.floor(length * rate); i++) {
          const t = i / rate, index = (Math.round(at * rate) + i) % music.length;
          const attack = voice === "strings" ? .09 : voice === "bell" ? .004 : .025;
          const release = voice === "strings" ? .18 : .08;
          const envelope = Math.min(t / attack, 1) * Math.min((length - t) / release, 1);
          const phase = 2 * Math.PI * frequency * t + .012 * Math.sin(2 * Math.PI * 5 * t);
          let tone;
          if (voice === "strings") {
            tone = .45 * Math.sin(phase) + .28 * Math.sin(phase * 1.003)
              + .18 * Math.sin(phase * .997) + .16 * Math.sin(phase * 2) + .08 * Math.sin(phase * 3);
          } else if (voice === "bell") {
            tone = (Math.sin(phase) + .35 * Math.sin(phase * 2) * Math.exp(-t * 5)
              + .15 * Math.sin(phase * 3) * Math.exp(-t * 8)) * Math.exp(-t * 3.5);
          } else {
            tone = Math.sin(phase) + .38 * Math.sin(phase * 2) + .18 * Math.sin(phase * 3)
              + .07 * Math.sin(phase * 4);
          }
          const value = tone * envelope * gain;
          left[index] += value * Math.sqrt((1 - pan) / 2);
          right[index] += value * Math.sqrt((1 + pan) / 2);
        }
      }
      const melody = [76,79,84,83,81,79,77,81,86,84,83,81,79,83,86,88,86,83,84,79,76,74,76,79,
        76,79,84,88,86,84,81,84,89,88,86,84,83,86,89,88,86,83,84,79,76,79,83,84];
      const chords = [[48,60,64,67],[53,60,65,69],[55,62,67,71],[48,60,64,67]];
      for (let b = 0; b < 48; b++) {
        const chord = chords[Math.floor(b / 6) % 4];
        const at = b * beat;
        note(melody[b], at, beat * .9, .19, .15);
        note(melody[b] - 12, at, beat * 1.1, .075, -.35, "strings");
        if (b % 3 === 0) {
          note(chord[0], at, beat * 1.35, .18, 0);
          chord.slice(1).forEach((m, i) =>
            note(m, at, beat * 3.3, .065, [-.65, .1, .65][i], "strings"));
          note(melody[b] + 12, at, beat * 2, .075, .55, "bell");
        } else chord.slice(1).forEach(m => note(m, at, beat * .65, .055, -.4));
        // Harp-like eighth-note arpeggios add sparkle between the waltz beats.
        for (let half = 0; half < 2; half++) {
          const pitch = chord[1 + (b * 2 + half) % 3] + 12;
          note(pitch, at + half * beat / 2, beat * 1.5, .045, half ? .7 : -.7, "bell");
        }
      }
      // Circular stereo reflections retain the decay across loop boundaries.
      const dryLeft = left.slice(), dryRight = right.slice();
      for (const [seconds, gain] of [[.061, .16], [.113, .12], [.179, .09], [.293, .06]]) {
        const delay = Math.round(seconds * rate);
        for (let i = 0; i < music.length; i++) {
          const from = (i - delay + music.length) % music.length;
          left[i] += dryRight[from] * gain;
          right[i] += dryLeft[from] * gain;
        }
      }
      let peak = 0;
      for (let i = 0; i < music.length; i++) peak = Math.max(peak, Math.abs(left[i]), Math.abs(right[i]));
      const level = peak > .85 ? .85 / peak : 1;
      for (let i = 0; i < music.length; i++) {
        // Short fades prevent clicks at the loop seam.
        const fade = Math.min(1, i / (rate * .005), (music.length - 1 - i) / (rate * .005));
        left[i] *= level * fade;
        right[i] *= level * fade;
      }
      audioCache = { context, music };
    }
    for (const buffer of [audioCache.music]) {
      const source = context.createBufferSource();
      source.buffer = buffer; source.loop = true; source.connect(master);
      source.onended = () => { source.disconnect(); audioSources = audioSources.filter(s => s !== source); };
      audioSources.push(source); source.start();
    }
  }
  let raf = 0, particles = [], rockets = [], width = 0, height = 0, last = 0, next = 0;
  function resize() {
    width = innerWidth; height = innerHeight;
    const ratio = Math.min(devicePixelRatio || 1, 2);
    canvas.width = width * ratio; canvas.height = height * ratio;
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  }
  function burst(x, y, hue) {
    for (let i = 0; i < 110; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 35 + Math.random() * 210;
      particles.push({ x, y, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed,
        life: 1.5 + Math.random() * 1.3, age: 0, hue });
    }
  }
  function frame(time) {
    const dt = Math.min((time - last) / 1000 || 0.016, 0.04); last = time;
    ctx.globalCompositeOperation = "source-over";
    ctx.fillStyle = "rgba(12,9,18,0.19)"; ctx.fillRect(0, 0, width, height);
    ctx.globalCompositeOperation = "lighter";
    if (time > next) {
      rockets.push({ x: width * (0.08 + Math.random() * 0.84), y: height,
        target: height * (0.1 + Math.random() * 0.35), hue: 25 + Math.random() * 330 });
      next = time + 650 + Math.random() * 550;
    }
    rockets = rockets.filter(r => {
      const old = r.y; r.y -= dt * 470;
      ctx.strokeStyle = "#ffe4b8"; ctx.lineWidth = 1.8;
      ctx.beginPath(); ctx.moveTo(r.x, old + 18); ctx.lineTo(r.x, r.y); ctx.stroke();
      if (r.y <= r.target) { burst(r.x, r.y, r.hue); return false; }
      return true;
    });
    particles = particles.filter(p => {
      p.age += dt; if (p.age >= p.life) return false;
      const x = p.x, y = p.y;
      p.vx *= Math.exp(-dt * 0.7); p.vy = p.vy * Math.exp(-dt * 0.5) + dt * 65;
      p.x += p.vx * dt; p.y += p.vy * dt;
      const alpha = (1 - p.age / p.life) * (0.7 + Math.random() * 0.3);
      ctx.strokeStyle = `hsla(${p.hue},85%,75%,${alpha})`;
      ctx.lineWidth = 1.3; ctx.beginPath(); ctx.moveTo(x,y); ctx.lineTo(p.x,p.y); ctx.stroke();
      ctx.fillStyle = `rgba(255,240,210,${alpha})`; ctx.fillRect(p.x,p.y,1.6,1.6);
      return true;
    });
    raf = requestAnimationFrame(frame);
  }
  function stop() {
    for (const source of audioSources) { source.stop(); source.disconnect(); }
    audioSources = [];
    cancelAnimationFrame(raf); raf = 0; panel.hidden = true;
    particles = []; rockets = []; rain.replaceChildren();
    window.removeEventListener("resize", resize);
  }
  function start(context, master) {
    stop(); panel.hidden = false; resize();
    celebrationAudio(context, master);
    window.addEventListener("resize", resize);
    ctx.clearRect(0,0,width,height);
    for (let i = 0; i < 42; i++) {
      const el = document.createElement("span");
      const kinds = ["balloon", "card", "hat", "ticket", "star", "ball", "carousel"];
      const kind = kinds[i % kinds.length];
      el.className = `circus-piece ${kind}`;
      el.textContent = { hat: "♠", ticket: "ADMIT ONE", star: "✦", ball: "" }[kind] || "";
      el.setAttribute("aria-hidden", "true");
      if (kind === "card") {
        const suits = ["♥", "♠", "♦", "♣"], suit = suits[Math.floor(i / kinds.length) % 4];
        el.textContent = `A${suit}`;
        el.style.setProperty("--suit-color", suit === "♥" || suit === "♦" ? "#a32940" : "#302736");
      }
      if (kind === "carousel") {
        const horse = document.createElement("span");
        horse.className = "carousel-horse"; horse.textContent = "♞"; el.append(horse);
      }
      el.style.setProperty("--color", colors[i % colors.length]);
      el.style.setProperty("--x", `${Math.random() * 100}%`);
      el.style.setProperty("--drift", `${Math.random() * 140 - 70}px`);
      el.style.setProperty("--turn", `${Math.random() * 240 - 120}deg`);
      el.style.setProperty("--duration", `${10 + Math.random() * 10}s`);
      el.style.setProperty("--delay", `${-Math.random() * 20}s`);
      rain.append(el);
    }
    if (!reduced.matches && ctx) { last = 0; next = 0; raf = requestAnimationFrame(frame); }
    document.getElementById("finale-back").focus({ preventScroll: true });
  }
  window.JokerCelebration = { start, stop };
})();
