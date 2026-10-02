"use strict";
(() => {
  const panel = document.getElementById("celebration");
  const canvas = document.getElementById("fireworks");
  const ctx = canvas.getContext("2d");
  const rain = document.getElementById("circus-rain");
  const reduced = matchMedia("(prefers-reduced-motion: reduce)");
  const colors = ["#c49b94", "#abb4a0", "#c8b684", "#a7a1b5", "#9bb4b7"];
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
    cancelAnimationFrame(raf); raf = 0; panel.hidden = true;
    particles = []; rockets = []; rain.replaceChildren();
    window.removeEventListener("resize", resize);
  }
  function start() {
    stop(); panel.hidden = false; resize();
    window.addEventListener("resize", resize);
    ctx.clearRect(0,0,width,height);
    for (let i = 0; i < 32; i++) {
      const el = document.createElement("span");
      const kind = ["balloon", "balloon", "hat", "ticket", "star", "ball"][i % 6];
      el.className = `circus-piece ${kind}`;
      el.textContent = { hat: "♠", ticket: "ADMIT ONE", star: "✦", ball: "" }[kind] || "";
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
