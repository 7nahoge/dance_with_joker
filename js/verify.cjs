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
      this.playCount = 0;
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
      this.playCount = (this.playCount || 0) + 1;
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
    createBiquadFilter() { return {frequency: {}, gain: {}, Q: {}, connect() {}, disconnect() {}}; }
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
      return { duration: scoreData.duration };
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
  const scoreData = window.WALTZ_SCORE, playbackRate = 1,
    lead = 0.12 + 6 * scoreData.beat;
  const wav = fs.readFileSync(root + "/assets/joker_music_s.wav");
  let byteRate, dataSize;
  for (let offset = 12; offset + 8 <= wav.length;) {
    const size = wav.readUInt32LE(offset + 4);
    const id = wav.toString("ascii", offset, offset + 4);
    if (id === "fmt ") byteRate = wav.readUInt32LE(offset + 16);
    if (id === "data") dataSize = size;
    offset += 8 + size + size % 2;
  }
  assert(byteRate > 0 && dataSize > 0);
  assert.equal(scoreData.duration, dataSize / byteRate);
  const playDuration = scoreData.duration / playbackRate;

  vm.runInContext(fs.readFileSync(root + "/js/difficulty.js", "utf8"), context);
  let runChart = window.JokerDifficulty.chart(scoreData, 1);
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
  assert.equal(get("movie").hidden, true);
  assert.equal(get("movie").currentTime, 0);
  await get("pause").fire("click");
  await get("resume").fire("click");
  assert.equal(get("movie").hidden, true, "Resume during the count-in must keep the movie paused");
  tick(lead - 0.001);
  await press(0);
  assert.equal(get("judgement").textContent, "", "Count-in inputs must not count as empty hits");
  assert.equal(get("movie").hidden, true);
  assert.equal(get("movie").playCount, 0);
  tick(lead);
  assert.equal(get("movie").hidden, false, "Movie must start as soon as the six-beat count-in ends");
  assert.equal(get("movie").playCount, 1);
  tick(lead + runChart[0].time / playbackRate);
  await press(0);
  assert.equal(get("score").textContent, "0100");
  await press(0);
  assert.equal(get("score").textContent, "0040");
  assert.equal(get("combo").textContent, 0);
  assert.equal(get("judgement").textContent, "空打ち −60");
  await press(1);
  assert.equal(get("score").textContent, "0000");
  tick(lead + runChart[1].time / playbackRate + 0.10);
  await press(1, true);
  assert.equal(get("score").textContent, "0000");
  await press(1);
  assert.equal(get("score").textContent, "0060");
  tick(lead + runChart[2].time / playbackRate + 0.19);
  assert.equal(get("combo").textContent, 0);
  await get("pause").fire("click");
  const stoppedAt = audio.currentTime;
  tick(25);
  assert.equal(audio.currentTime, stoppedAt);
  await press(1);
  assert.equal(get("score").textContent, "0060");
  await get("resume").fire("click");
  assert.equal(audio.currentTime, stoppedAt);
  assert.equal(active.size, voices);
  assert.equal(sources.length, 1);
  assert.equal(get("movie").hidden, false);
  assert.equal(get("movie").playCount, 2);
  await get("pause").fire("click");
  await get("resume").fire("click");
  assert.equal(get("movie").playCount, 3);
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
  assert.equal(get("result-empty").textContent, 2);
  assert.equal(active.size, 0);
  await get("retry").fire("click");
  assert.equal(active.size, voices);
  assert.equal(get("score").textContent, "0000");
  assert.equal(sources.length, 2);
  assert.equal(get("movie").hidden, true);
  assert.equal(get("movie").currentTime, 0);
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
  tick(start + runChart.at(-1).time + 0.101);
  await press(0);
  await pads[1].fire("pointerdown", { button: 0, pointerId: 1 });
  assert.equal(get("score").textContent, String(runChart.length * 100).padStart(4, "0"));
  tick(start + playDuration + 0.01);
  assert.equal(get("result-score").textContent, runChart.length * 100);
  assert.equal(get("result-combo").textContent, runChart.length);
  assert.equal(get("result-perfect").textContent, runChart.length);
  assert.equal(get("result-miss").textContent, 0);
  assert.equal(get("result-empty").textContent, 0, "Empty count must reset and ignore track tail inputs");
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
  tick(boundaryStart + runChart[1].time / playbackRate - 0.101);
  await press(runChart[1].lane);
  assert.equal(get("score").textContent, "0000");
  tick(boundaryStart + runChart[1].time / playbackRate - 0.1);
  await press(runChart[1].lane);
  assert.equal(get("score").textContent, "0060");
  tick(boundaryStart + runChart[2].time / playbackRate + 0.05);
  await press(runChart[2].lane);
  assert.equal(get("score").textContent, "0160");
  tick(boundaryStart + runChart[3].time / playbackRate + 0.1);
  await press(runChart[3].lane);
  assert.equal(get("score").textContent, "0220");
  await get("pause").fire("click");
  await get("quit").fire("click");
  assert.equal(active.size, 0);
  assert.equal(raf, null);
  // Repeatedly pressing both lanes must not clear any level.
  for (let level = 1; level <= 10; level++) {
    const originalChart = window.JokerDifficulty.chart;
    const originalWindow = window.JokerDifficulty.judgementWindow;
    window.JokerDifficulty.chart = (score, ignoredLevel, duration) => originalChart(score, level, duration);
    window.JokerDifficulty.judgementWindow = () => originalWindow(level);
    await get("start").fire("click");
    const spamStart = audio.currentTime + lead;
    for (let step = 0; step * 0.02 < playDuration; step++) {
      tick(spamStart + step * 0.02);
      await pads[0].fire("pointerdown", { button: 0, pointerId: 1 });
      await pads[1].fire("pointerdown", { button: 0, pointerId: 2 });
    }
    tick(spamStart + playDuration + 0.01);
    assert(get("result-status").textContent.includes("再挑戦"), `Button spam must fail level ${level}`);
    assert(get("result-empty").textContent > 0);
    await get("back").fire("click");
    window.JokerDifficulty.chart = originalChart;
    window.JokerDifficulty.judgementWindow = originalWindow;
  }
  // Complete every level, then ensure the finale cannot advance to level 11.
  await get("start").fire("click");
  for (let level = 1; level <= 10; level++) {
    assert(get("level-info").textContent.includes(`LEVEL ${level} `));
    const levelStart = audio.currentTime + lead;
    const levelChart = window.JokerDifficulty.chart(scoreData, level);
    assert.equal(levelChart.length, [19,22,25,28,28,28,30,30,30,30][level - 1]);
    const laneTimes = [-Infinity, -Infinity];
    let closeRun = 1;
    const bursts = new Set();
    const completeRuns = new Set();
    for (let i = 1; i < levelChart.length; i++) {
      const gap = levelChart[i].time - levelChart[i - 1].time;
      assert(gap > 0, "Cards must remain in chronological order");
      if (gap <= scoreData.beat / 2 + 1e-8) closeRun++;
      else {
        completeRuns.add(closeRun);
        closeRun = 1;
      }
      bursts.add(closeRun);
      assert(closeRun <= 4, "Half-beat card runs must not exceed four cards");
    }
    assert(bursts.has(3) && bursts.has(4), "Each level must include occasional three- and four-card bursts");
    completeRuns.add(closeRun);
    if (level >= 4 && level <= 6)
      assert(completeRuns.has(2) && completeRuns.has(3), "Levels 4–6 must include distinct two- and three-card runs");
    for (const note of levelChart) {
      assert(note.time - laneTimes[note.lane] > 2 * window.JokerDifficulty.judgementWindow(level), "Judgement windows must not overlap");
      laneTimes[note.lane] = note.time;
    }
    assert(Math.abs(window.JokerDifficulty.judgementWindow(level) - (.1 - (level - 1) * .004)) < 1e-8);
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
