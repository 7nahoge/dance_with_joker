// Node.js standard library only. Runs production game.js in a deterministic DOM/audio mock.
const fs = require("node:fs");
const vm = require("node:vm");
const assert = require("node:assert/strict");
async function verify(root = require("node:path").resolve(__dirname, "..")) {
  const elements = new Map();
  class Element {
    constructor() {
      this.handlers = {};
      this.hidden = false;
      this.value = "35";
      this.style = {};
      this.dataset = {};
      this.children = [];
      this.clientHeight = 400;
      this.offsetHeight = 72;
      this.tagName = "BUTTON";
      this.classList = { add() {}, remove() {}, toggle() {} };
    }
    addEventListener(k, fn) {
      (this.handlers[k] ||= []).push(fn);
    }
    async fire(k, data = {}) {
      for (const fn of this.handlers[k] || [])
        await fn({ preventDefault() {}, target: this, ...data });
    }
    append(el) {
      this.children.push(el);
    }
    replaceChildren() {
      this.children = [];
    }
    remove() {}
    setAttribute() {}
    focus() {}
    setPointerCapture() {}
    play() {
      return Promise.resolve();
    }
    pause() {}
    showModal() {
      this.open = true;
    }
    close() {
      this.open = false;
    }
  }
  const get = (id) => {
    if (!elements.has(id)) elements.set(id, new Element());
    return elements.get(id);
  };
  const pads = [new Element(), new Element()];
  pads.forEach((p, i) => (p.dataset.lane = String(i)));
  const document = new Element();
  document.hidden = false;
  document.body = new Element();
  document.getElementById = get;
  document.createElement = () => new Element();
  document.querySelectorAll = (s) => (s === "[data-lane]" ? pads : []);
  const param = () => ({
    setValueAtTime() {},
    linearRampToValueAtTime() {},
    exponentialRampToValueAtTime() {},
    setTargetAtTime() {},
  });
  let audio,
    raf,
    active = new Set(),
    sources = [],
    fetchCount = 0,
    failFetch = false,
    failDecode = false;
  class Audio {
    constructor() {
      audio = this;
      this.currentTime = 0;
      this.state = "suspended";
      this.destination = {};
    }
    async resume() {
      this.state = "running";
    }
    async suspend() {
      this.state = "suspended";
    }
    createGain() {
      return { gain: param(), connect() {}, disconnect() {} };
    }
    createOscillator() {
      const o = {
        frequency: {},
        connect() {},
        disconnect() {},
        start() {
          active.add(o);
        },
        stop(at) {
          if (at === undefined) active.delete(o);
        },
      };
      return o;
    }
    async decodeAudioData() {
      if (failDecode) throw new Error("decode failure");
      return { duration: 68.1 };
    }
    createBufferSource() {
      const s = {
        playbackRate: { value: 1 },
        connect() {},
        disconnect() {},
        start(at, offset) {
          this.startedAt = at;
          this.offset = offset;
          active.add(s);
        },
        stop(at) {
          this.stoppedAt = at;
          if (at === undefined) active.delete(s);
        },
      };
      sources.push(s);
      return s;
    }
  }
  const window = new Element();
  let celebrating = false;
  window.JokerCelebration = {
    start() { celebrating = true; },
    stop() { celebrating = false; },
  };
  window.AudioContext = Audio;
  window.location = { protocol: "http:" };
  const context = vm.createContext({
    document,
    window,
    fetch: async (url) => {
      assert.equal(url, "assets/joker_music_s.wav?v=waltz24-file-as-is240");
      fetchCount++;
      return { ok: !failFetch, arrayBuffer: async () => new ArrayBuffer(8) };
    },
    requestAnimationFrame: (fn) => {
      raf = fn;
      return 1;
    },
    cancelAnimationFrame: () => {
      raf = null;
    },
  });
  vm.runInContext(fs.readFileSync(root + "/js/music-chart.js", "utf8"), context);
  const scoreData = window.WALTZ_SCORE,
    chart = scoreData.notes,
    playbackRate = 1,
    lead = 0.12 + 6 * (scoreData.beat / playbackRate);
  const wav = fs.readFileSync(root + "/assets/joker_music.wav");
  assert.equal(wav.readUInt32LE(40) / wav.readUInt32LE(28), scoreData.duration);
  assert.equal(scoreData.duration, 68.1);
  assert.equal(scoreData.bpm, 150);
  assert.equal(scoreData.overlap, 0);
  assert.equal(scoreData.cycle, 9.6);
  assert.equal(chart.length, 226);
  const phraseCounts = Array.from(
    { length: 7 },
    (_, i) =>
      chart.filter((n) => n.time >= i * scoreData.cycle && n.time < (i + 1) * scoreData.cycle)
        .length,
  );

  assert.deepEqual(phraseCounts, [32, 34, 36, 38, 28, 28, 30]);
  assert.equal(chart.filter((n) => n.kind === "offbeat").length, 81);
  const offbeatCounts = Array.from(
    { length: 7 },
    (_, i) =>
      chart.filter(
        (n) =>
          n.kind === "offbeat" &&
          n.time >= i * scoreData.cycle &&
          n.time < (i + 1) * scoreData.cycle,
      ).length,
  );
  assert.deepEqual(offbeatCounts, [8, 10, 12, 14, 11, 12, 14]);
  for (let phrase = 4; phrase < 7; phrase++) {
    const times = chart
      .filter((n) => n.time >= phrase * scoreData.cycle && n.time < (phrase + 1) * scoreData.cycle)
      .map((n) => n.time);
    for (let i = 4; i < times.length; i += 4)
      assert(
        times[i] - times[i - 1] >= 0.59999,
        "Late phrases must include a rest after every four cards",
      );
  }
  assert.equal(scoreData.tailExtension, 0.6);
  // Both sides of each loop boundary reach zero, avoiding abrupt sample jumps.
  const rate = wav.readUInt32LE(24),
    channels = wav.readUInt16LE(22);
  // Preserve the original melody, including the closing notes removed by the
  // former duplicated-bar arrangement. Only its final decay receives reverb.
  const sourceWav = fs.readFileSync(root + "/source/joker_movie.wav");
  let sourcePcm;
  for (let offset = 12; offset + 8 <= sourceWav.length; ) {
    const size = sourceWav.readUInt32LE(offset + 4);
    if (sourceWav.toString("ascii", offset, offset + 4) === "data")
      sourcePcm = sourceWav.subarray(offset + 8, offset + 8 + size);
    offset += 8 + size + (size % 2);
  }
  assert(sourcePcm);
  const trimFrames = Math.round(0.11 * rate);
  let reference = Math.round(0.5 * rate);
  while (Math.abs(sourcePcm.readInt16LE((reference + trimFrames) * channels * 2)) < 8000)
    reference++;
  const sourceValue = sourcePcm.readInt16LE((reference + trimFrames) * channels * 2);
  const scale = wav.readInt16LE(44 + reference * channels * 2) / sourceValue;
  for (let phrase = 0; phrase < 7; phrase++) {
    const start = Math.round(phrase * scoreData.cycle * rate);
    for (let f = Math.round(0.01 * rate); f < Math.round(8.64 * rate); f += 137) {
      for (let c = 0; c < channels; c++) {
        const original = sourcePcm.readInt16LE(((f + trimFrames) * channels + c) * 2);
        const generated = wav.readInt16LE(44 + ((start + f) * channels + c) * 2);
        assert(Math.abs(generated - original * scale) < 3, "Original melody must remain unchanged");
      }
    }
    let decayEnergy = 0;
    for (let f = Math.round(9.05 * rate); f < Math.round(9.55 * rate); f += 37) {
      decayEnergy += wav.readInt16LE(44 + (start + f) * channels * 2) ** 2;
    }
    assert(decayEnergy > 0, "Each eight-bar phrase must contain added ending decay");
  }
  for (let phrase = 1; phrase < 7; phrase++) {
    const frame = Math.round(phrase * scoreData.cycle * rate);
    for (let c = 0; c < channels; c++) {
      assert.equal(wav.readInt16LE(44 + ((frame - 1) * channels + c) * 2), 0);
      assert.equal(wav.readInt16LE(44 + (frame * channels + c) * 2), 0);
    }
  }
  const tailStart = Math.round(67.2 * rate);
  let tailEnergy = 0;
  for (let f = tailStart; f < tailStart + Math.round(0.1 * rate); f++) {
    tailEnergy += wav.readInt16LE(44 + f * channels * 2) ** 2;
  }
  assert(tailEnergy > 0, "The ending must contain audible decay");
  for (let c = 0; c < channels; c++)
    assert.equal(wav.readInt16LE(wav.length - channels * 2 + c * 2), 0);
  for (let i = 0; i < chart.length; i++) {
    const n = chart[i];
    assert([0, 1].includes(n.lane));
    assert(n.time >= 0 && n.time < scoreData.duration - 0.15);
    if (i > 1)
      assert(
        !(n.lane === chart[i - 1].lane && n.lane === chart[i - 2].lane),
        "No three same-lane hits in a row",
      );
    if (i) assert(n.time - chart[i - 1].time >= 0.169);
    const localTime = n.time - Math.floor(n.time / scoreData.cycle) * scoreData.cycle;
    const pulse = (localTime - scoreData.beatOrigin) / scoreData.beat;
    assert(["beat", "offbeat"].includes(n.kind));
    assert(
      Math.abs(
        pulse -
          Math.round(pulse - (n.kind === "offbeat" ? 0.5 : 0)) -
          (n.kind === "offbeat" ? 0.5 : 0),
      ) < 0.00001,
      "Every card must follow the beat or its halfway offbeat",
    );
    assert(localTime < scoreData.cycle, "Keep notes inside the complete waltz bars");
    assert.equal(
      Math.round(scoreData.cycle / scoreData.beat),
      24,
      "Loop must preserve the 3/4 beat grid",
    );
    const previousSameLane = chart
      .slice(0, i)
      .reverse()
      .find((other) => other.lane === n.lane);
    if (previousSameLane)
      assert(
        (n.time - previousSameLane.time) / playbackRate > 0.32,
        "Same-lane windows must not overlap",
      );
  }
  assert(
    chart.some((n, i) => i > 0 && n.lane === chart[i - 1].lane),
    "Include same-lane doubles",
  );
  assert(
    chart.some((n, i) => i > 0 && n.time - chart[i - 1].time < 0.3),
    "Include melody subdivisions",
  );
  assert(
    chart.some(
      (n) =>
        !scoreData.sourceBeats.some(
          (t) =>
            Math.abs(n.time - (Math.floor(n.time / scoreData.cycle) * scoreData.cycle + t)) < 0.08,
        ),
    ),
    "Chart must not be a beat-only grid",
  );
  const playDuration = scoreData.duration / playbackRate;

  let beats = 0;
  let runChart = chart.filter(n => n.kind === "beat" && beats++ % 3 !== 2);
  vm.runInContext(fs.readFileSync(root + "/js/game.js", "utf8"), context);
  const tick = (t) => {
    if (audio.state === "running") audio.currentTime = t;
    const fn = raf;
    raf = null;
    if (fn) fn();
  };
  const press = (lane, repeat = false) =>
    document.fire("keydown", { code: lane ? "KeyJ" : "KeyF", repeat });
  window.location.protocol = "file:";
  await get("start").fire("click");
  assert.equal(get("error").hidden, false);
  assert.equal(active.size, 0);
  window.location.protocol = "http:";
  failFetch = true;
  await get("start").fire("click");
  assert.equal(get("error").hidden, false);
  assert.equal(active.size, 0);
  failFetch = false;
  failDecode = true;
  await get("start").fire("click");
  assert.equal(get("error").hidden, false);
  assert.equal(active.size, 0);
  failDecode = false;
  await get("start").fire("click");
  const voices = active.size;
  assert.equal(voices, 7);
  assert.equal(get("play").hidden, false);
  assert.equal(get("error").hidden, true);
  assert.equal(sources[0].playbackRate.value, playbackRate);
  assert.equal(sources[0].loop, false);
  assert.equal(sources[0].startedAt, lead);
  assert.equal(sources[0].offset, 0);
  assert.equal(sources[0].stoppedAt, lead + playDuration);
  tick(lead + runChart[0].time / playbackRate);
  await press(0);
  assert.equal(get("score").textContent, "0100");
  await press(0);
  await press(1);
  assert.equal(get("score").textContent, "0100");
  tick(lead + runChart[1].time / playbackRate + 0.1);
  await press(1, true);
  assert.equal(get("score").textContent, "0100");
  await press(1);
  assert.equal(get("score").textContent, "0160");
  tick(lead + runChart[2].time / playbackRate + 0.17);
  assert.equal(get("combo").textContent, 0);
  await get("pause").fire("click");
  const stoppedAt = audio.currentTime;
  tick(25);
  assert.equal(audio.currentTime, stoppedAt);
  await press(1);
  assert.equal(get("score").textContent, "0160");
  await get("resume").fire("click");
  assert.equal(audio.currentTime, stoppedAt);
  assert.equal(active.size, voices);
  assert.equal(sources.length, 1);
  tick(lead + playDuration - 1);
  assert.equal(get("play").hidden, false);
  assert.equal(get("result").hidden, true);
  tick(lead + playDuration - 0.001);
  assert.equal(get("play").hidden, false);
  tick(lead + playDuration + 0.01);
  assert.equal(get("result").hidden, false);
  assert.equal(get("result-perfect").textContent, 1);
  assert.equal(get("result-good").textContent, 1);
  assert.equal(get("result-miss").textContent, runChart.length - 2);
  assert.equal(active.size, 0);
  await get("retry").fire("click");
  assert.equal(active.size, voices);
  assert.equal(get("score").textContent, "0000");
  assert.equal(sources.length, 2);
  assert.equal(sources[1].offset, 0);
  assert.equal(fetchCount, 3);
  document.hidden = true;
  await document.fire("visibilitychange");
  assert.equal(audio.state, "suspended");
  document.hidden = false;
  await get("resume").fire("click");
  await get("quit").fire("click");
  assert.equal(active.size, 0);
  await get("joker").fire("error");
  await get("movie").fire("error");
  assert.equal(get("placeholder").hidden, false);
  await get("start").fire("click");
  const start = audio.currentTime + lead;
  for (const n of runChart) {
    tick(start + n.time / playbackRate);
    await pads[n.lane].fire("pointerdown", { button: 0, pointerId: 1 });
    await pads[n.lane].fire("click", { detail: 1 });
    await press(n.lane, true);
  }
  tick(start + playDuration + 0.01);
  assert.equal(get("result-score").textContent, runChart.length * 100);
  assert.equal(get("result-combo").textContent, runChart.length);
  assert.equal(get("result-perfect").textContent, runChart.length);
  assert.equal(get("result-miss").textContent, 0);
  assert(get("result-status").textContent.includes("合格"));
  await get("retry").fire("click");
  assert(get("level-info").textContent.includes("LEVEL 2"));
  tick(audio.currentTime + lead + playDuration + 0.01);
  assert(get("result-status").textContent.includes("再挑戦"));
  await get("retry").fire("click");
  assert(get("level-info").textContent.includes("LEVEL 2"));
  await get("pause").fire("click");
  await get("quit").fire("click");
  await get("start").fire("click");
  // Inclusive timing boundaries and just-outside input rejection.
  const boundaryStart = audio.currentTime + lead;
  tick(boundaryStart + runChart[0].time / playbackRate - 0.161);
  await press(0);
  assert.equal(get("score").textContent, "0000");
  tick(boundaryStart + runChart[0].time / playbackRate - 0.16);
  await press(0);
  assert.equal(get("score").textContent, "0060");
  tick(boundaryStart + runChart[1].time / playbackRate + 0.08);
  await press(1);
  assert.equal(get("score").textContent, "0160");
  tick(boundaryStart + runChart[2].time / playbackRate + 0.16);
  await press(runChart[2].lane);
  assert.equal(get("score").textContent, "0220");
  await get("pause").fire("click");
  await get("quit").fire("click");
  assert.equal(active.size, 0);
  assert.equal(raf, null);
  // Complete every level, then ensure the finale cannot advance to level 11.
  await get("start").fire("click");
  for (let level = 1; level <= 10; level++) {
    assert(get("level-info").textContent.includes(`LEVEL ${level} `));
    const levelStart = audio.currentTime + lead;
    let beats = 0, offbeats = 0;
    const levelChart = scoreData.notes.filter(n => n.time / playbackRate < playDuration - 0.17 &&
      (n.kind === "beat" ? level > 1 || beats++ % 3 !== 2 :
        level >= 4 || (level === 3 && offbeats++ % 2 === 0)));
    for (const n of levelChart) {
      tick(levelStart + n.time / playbackRate);
      await press(n.lane);
    }
    tick(levelStart + playDuration + 0.01);
    assert.equal(celebrating, level === 10);
    if (level < 10) await get("retry").fire("click");
  }
  assert.equal(get("retry").hidden, true);
  assert(get("result-status").textContent.includes("ALL CLEAR"));
  await get("retry").fire("click");
  assert.equal(celebrating, true);
  assert(get("level-info").textContent.includes("LEVEL 10 "));
  await get("finale-back").fire("click");
  assert.equal(celebrating, false);
  assert.equal(get("retry").hidden, false);
  await get("start").fire("click");
  assert(get("level-info").textContent.includes("LEVEL 1 "));
  await get("quit").fire("click");
  return `PASS: ${runChart.length} beat/offbeat notes, ${scoreData.bpm * playbackRate} BPM, no overlap; WAV loading/cache/scheduling; failure recovery; pause/resume; retry; full run; judgement boundaries; duplicate input; held key; hidden tab; cleanup; missing images/video; ${runChart.length * 100}-point perfect run.`;
}
module.exports = verify;
if (require.main === module)
  verify()
    .then(console.log)
    .catch((e) => {
      console.error(e);
      process.exitCode = 1;
    });
