"use strict";
(() => {
  const $ = (id) => document.getElementById(id);
  const scoreData = window.WALTZ_SCORE;
  if (!scoreData) {
    $("error").hidden = false;
    $("error").textContent = "譜面を読み込めませんでした。ページを再読み込みしてください。";
    $("start").disabled = true;
    return;
  }
  const MAX_LEVEL = 10;
  // Preserve the track's original tempo and align the chart to its source beats.
  const PLAYBACK_RATE = 1;
  const BEAT = scoreData.beat / PLAYBACK_RATE,
    COUNT_IN = 6 * BEAT,
    APPROACH = 2;
  let DURATION = scoreData.duration / PLAYBACK_RATE;
  const MUSIC_URL = "assets/joker_music_s.wav?v=waltz24-file-as-is240";
  let musicBuffer = null;
  // Beat and offbeat timings follow complete 3/4 bars across each repeat.
  const chart = scoreData.notes.map((note) => ({ ...note, time: note.time / PLAYBACK_RATE }));
  // Keep consecutive cards in each lane separated, including on short screens.
  const lastLaneTime = [-Infinity, -Infinity];
  let MIN_LANE_INTERVAL = chart.reduce((minimum, note) => {
    const interval = note.time - lastLaneTime[note.lane];
    lastLaneTime[note.lane] = note.time;
    return Math.min(minimum, interval);
  }, Infinity);
  const game = {
    state: "title",
    level: 1,
    passed: false,
    context: null,
    master: null,
    voices: new Set(),
    notes: [],
    raf: 0,
    generation: 0,
    score: 0,
    combo: 0,
    maxCombo: 0,
    perfect: 0,
    good: 0,
    miss: 0,
    musicStart: 0,
    movieStarted: false,
    countStart: 0,
    endTime: 0,
    lastMiss: -Infinity,
    feedbackUntil: 0,
    busy: false,
    muted: false,
  };
  let imageOK = true,
    videoOK = true;
  function dialogue(text) {
    $("dialogue").textContent = `「${text}」`;
  }
  function assetStatus() {
    $("asset-status").textContent =
      !imageOK && !videoOK
        ? "画像・動画を読み込めないため仮表示中"
        : !videoOK
          ? "動画を読み込めないため画像を表示中"
          : !imageOK
            ? "画像を読み込めないためタイトルは仮表示"
            : "";
  }
  $("joker").addEventListener("error", () => {
    imageOK = false;
    $("joker").hidden = true;
    $("placeholder").hidden = false;
    assetStatus();
  });
  $("movie").addEventListener("error", () => {
    videoOK = false;
    showPortrait(false);
    assetStatus();
  });
  function showPortrait(movie) {
    const v = $("movie");
    v.hidden = !movie || !videoOK;
    $("joker").hidden = !imageOK || !v.hidden;
    $("placeholder").hidden = imageOK || !v.hidden;
    if (!v.hidden)
      v.play().catch(() => {
        videoOK = false;
        showPortrait(false);
        assetStatus();
      });
    else v.pause();
  }
  function screen(name) {
    for (const id of ["title", "play", "result"]) $(id).hidden = id !== name;
    document.body.classList.toggle("in-game", name === "play");
    document.body.classList.toggle("in-result", name === "result");
  }
  function volume() {
    if (game.master)
      game.master.gain.setTargetAtTime(
        game.muted ? 0 : (Number($("volume").value) / 100) * 0.32,
        game.context.currentTime,
        0.025,
      );
  }
  $("volume").addEventListener("input", volume);
  $("mute").addEventListener("click", () => {
    game.muted = !game.muted;
    $("mute").textContent = game.muted ? "♪ 消音" : "♪ 音あり";
    $("mute").setAttribute("aria-pressed", String(game.muted));
    volume();
  });
  function tone(midi, when, duration, level, type = "sine") {
    const ctx = game.context,
      oscillator = ctx.createOscillator(),
      gain = ctx.createGain();
    oscillator.type = type;
    oscillator.frequency.value = 440 * 2 ** ((midi - 69) / 12);
    gain.gain.setValueAtTime(0, when);
    gain.gain.linearRampToValueAtTime(level, when + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.0001, when + duration);
    oscillator.connect(gain);
    gain.connect(game.master);
    game.voices.add(oscillator);
    oscillator.onended = () => {
      oscillator.disconnect();
      gain.disconnect();
      game.voices.delete(oscillator);
    };
    oscillator.start(when);
    oscillator.stop(when + duration + 0.02);
  }
  async function loadMusic() {
    if (musicBuffer) return;
    if (window.location.protocol === "file:")
      throw new Error(
        "音楽の読み込みにはローカルHTTPサーバーが必要です。READMEの起動方法をご確認ください。",
      );
    const response = await fetch(MUSIC_URL);
    if (!response.ok) throw new Error("assets/joker_music_s.wav を読み込めませんでした。");
    try {
      musicBuffer = await game.context.decodeAudioData(await response.arrayBuffer());
    } catch {
      throw new Error(
        "音楽をデコードできませんでした。assets/joker_music_s.wav が正しく配信されているか確認してください。",
      );
    }
    if (!(musicBuffer.duration > 0)) {
      musicBuffer = null;
      throw new Error("音源の長さを取得できませんでした。");
    }
    // End the game at the decoded file's end, rather than a fixed time limit.
    DURATION = musicBuffer.duration / PLAYBACK_RATE;
  }
  function scheduleMusic() {
    for (let i = 0; i < 6; i++) tone(i % 3 === 0 ? 76 : 69, game.countStart + i * BEAT, 0.16, 0.12);
    const source = game.context.createBufferSource();
    source.buffer = musicBuffer;
    source.playbackRate.value = PLAYBACK_RATE;
    // The complete track contains every repeat; play through its end once.
    source.loop = false;
    source.connect(game.master);
    game.voices.add(source);
    source.onended = () => {
      source.disconnect();
      game.voices.delete(source);
    };
    source.start(game.musicStart, 0);
    source.stop(game.endTime);
  }
  function clearRun() {
    window.JokerCelebration.stop();
    game.generation++;
    cancelAnimationFrame(game.raf);
    game.raf = 0;
    for (const oscillator of game.voices) {
      try {
        oscillator.stop();
      } catch {}
      oscillator.disconnect();
    }
    game.voices.clear();
    $("cards").replaceChildren();
    document.querySelectorAll(".spark").forEach((n) => n.remove());
    document.querySelectorAll(".pressed").forEach((n) => n.classList.remove("pressed"));
    document.body.classList.remove("flourish");
    $("movie").pause();
    $("movie").currentTime = 0;
    game.movieStarted = false;
  }
  function stats() {
    $("score").textContent = String(game.score).padStart(4, "0");
    $("combo").textContent = game.combo;
  }
  async function start() {
    if (game.busy || (game.passed && game.level === MAX_LEVEL)) return;
    game.busy = true;
    $("start").disabled = $("retry").disabled = true;
    try {
      clearRun();
      game.state = "starting";
      if (!game.context) {
        const Audio = window.AudioContext || window.webkitAudioContext;
        if (!Audio) throw new Error("このブラウザーはWeb Audioに対応していません。");
        game.context = new Audio();
        game.master = game.context.createGain();
        game.master.connect(game.context.destination);
      }
      $("error").hidden = true;
      await game.context.resume();
      volume();
      $("start").textContent = $("retry").textContent = "音楽を読み込み中…";
      await loadMusic();
      for (const key of ["score", "combo", "maxCombo", "perfect", "good", "miss"]) game[key] = 0;
      game.lastMiss = -Infinity;
      game.feedbackUntil = 0;
      $("judgement").textContent = "";
      stats();
      game.countStart = game.context.currentTime + 0.12;
      game.musicStart = game.countStart + COUNT_IN;
      game.endTime = game.musicStart + DURATION;
      const laneCounts = [0, 0];
      if (game.passed) game.level = Math.min(MAX_LEVEL, game.level + 1);
      game.passed = false;
      let beats = 0, offbeats = 0;
      const runChart = chart.filter((n) => n.time < DURATION - 0.17 &&
        (n.kind === "beat" ? game.level > 1 || beats++ % 3 !== 2 :
          game.level >= 4 || (game.level === 3 && offbeats++ % 2 === 0)));
      lastLaneTime.fill(-Infinity);
      MIN_LANE_INTERVAL = runChart.reduce((minimum, note) => {
        const interval = note.time - lastLaneTime[note.lane];
        lastLaneTime[note.lane] = note.time;
        return Math.min(minimum, interval);
      }, Infinity);
      $("level-info").textContent = `LEVEL ${game.level} · ${runChart.length}枚 · 及第点 ${Math.ceil(runChart.length * 60)}点`;
      game.notes = runChart.map((n) => ({
        ...n,
        suit: (n.lane === 0 ? ["♠", "♣"] : ["♥", "♦"])[laneCounts[n.lane]++ % 2],
        at: game.musicStart + n.time,
        judged: false,
        element: null,
      }));
      scheduleMusic();
      game.state = "playing";
      screen("play");
      dialogue("さあ、私についてこられる？");
      showPortrait(game.movieStarted);
      frame();
      if (document.hidden) pause();
    } catch (error) {
      clearRun();
      game.state = "title";
      screen("title");
      $("error").hidden = false;
      $("error").textContent =
        "音声を開始できませんでした。もう一度お試しください。 " + error.message;
    } finally {
      game.busy = false;
      $("start").disabled = $("retry").disabled = false;
      $("start").textContent = "舞踏会をはじめる →";
      $("retry").textContent = game.passed ? `レベル ${game.level + 1} へ進む →` : `レベル ${game.level} に再挑戦 ↻`;
    }
  }
  function judge(note, kind, now) {
    if (note.judged) return;
    note.judged = true;
    note.element?.remove();
    game[kind]++;
    if (kind === "miss") {
      game.combo = 0;
      if (now - game.lastMiss >= 4) {
        dialogue("おっと。次は見せてくれる？");
        game.lastMiss = now;
      }
    } else {
      game.score += kind === "perfect" ? 100 : 60;
      game.combo++;
      game.maxCombo = Math.max(game.maxCombo, game.combo);
      if (game.combo === 10) dialogue("へえ。やるじゃんすけ。");
      const spark = document.createElement("div");
      spark.className = "spark " + kind;
      spark.dataset.expires = now + 0.5;
      spark.style.left = note.lane ? "75%" : "25%";
      $("field").append(spark);
      spark.addEventListener("animationend", () => spark.remove());
    }
    document.body.classList.toggle("flourish", game.combo >= 10);
    $("judgement").textContent = kind[0].toUpperCase() + kind.slice(1);
    game.feedbackUntil = now + 0.55;
    stats();
  }
  function input(lane) {
    if (game.state !== "playing" || game.context.state !== "running") return;
    const now = game.context.currentTime;
    const note = game.notes.find(
      (n) => n.lane === lane && !n.judged && Math.abs(n.at - now) <= judgementWindow() + 0.0000001,
    );
    if (note) judge(note, Math.abs(note.at - now) <= judgementWindow() / 2 + 0.0000001 ? "perfect" : "good", now);
  }
  function judgementWindow() {
    return Math.max(0.09, 0.16 - Math.max(0, game.level - 4) * 0.005);
  }
  function frame() {
    if (game.state !== "playing") return;
    const now = game.context.currentTime,
      height = $("field").clientHeight,
      line = height * 0.82;
    if (!game.movieStarted && now >= game.musicStart) {
      game.movieStarted = true;
      showPortrait(true);
    }
    document.querySelectorAll(".spark").forEach((el) => {
      if (now > Number(el.dataset.expires)) el.remove();
    });
    $("count").textContent =
      now < game.musicStart
        ? `準備をして\n${Math.min(6, Math.max(1, Math.floor((now - game.countStart) / BEAT) + 1))} / 6`
        : "";
    $("progress").style.width =
      Math.max(0, Math.min(100, ((now - game.musicStart) / DURATION) * 100)) + "%";
    for (const note of game.notes) {
      if (note.judged) continue;
      if (now - note.at > judgementWindow() + 0.0000001) {
        judge(note, "miss", now);
        continue;
      }
      if (note.at - now <= APPROACH) {
        if (!note.element) {
          const el = document.createElement("div");
          el.className = "card";
          el.dataset.lane = note.lane;
          el.style.left = note.lane ? "75%" : "25%";
          el.textContent = note.suit;
          $("cards").append(el);
          note.element = el;
        }
        const cardHeight = note.element.offsetHeight;
        const approach = Math.min(APPROACH, ((line + 40) * MIN_LANE_INTERVAL) / (cardHeight + 24));
        note.element.style.transform = `translateY(${line - ((note.at - now) / approach) * (line + 40) - cardHeight / 2}px)`;
      }
    }
    if (now > game.feedbackUntil) $("judgement").textContent = "";
    if (now >= game.endTime) {
      finish();
      return;
    }
    game.raf = requestAnimationFrame(frame);
  }
  function finish() {
    for (const note of game.notes) if (!note.judged) judge(note, "miss", game.context.currentTime);
    game.passed = game.score >= Math.ceil(game.notes.length * 60);
    game.state = "result";
    clearRun();
    screen("result");
    showPortrait(false);
    dialogue(game.passed ? "合格、やるじゃんすけ。次は、もう少し難しいステップを。" : "もう一度、同じステップで踊ってみる？");
    $("result-status").textContent = `LEVEL ${game.level} · ${game.passed ? "合格！" : "再挑戦"} · 及第点 ${Math.ceil(game.notes.length * 60)}点`;
    $("retry").textContent = game.passed ? `レベル ${game.level + 1} へ進む →` : `レベル ${game.level} に再挑戦 ↻`;
    const complete = game.passed && game.level === MAX_LEVEL;
    $("retry").hidden = complete;
    if (complete) {
      dialogue("全10レベルクリア！最高の舞踏会をありがとう。おめでとう！");
      $("result-status").textContent = "LEVEL 10 · ALL CLEAR！";
      window.JokerCelebration.start(game.context, game.master);
    }
    $("result-score").textContent = game.score;
    $("result-combo").textContent = game.maxCombo;
    for (const k of ["perfect", "good", "miss"]) $("result-" + k).textContent = game[k];
  }
  function pause() {
    if (game.state !== "playing") return;
    game.state = "paused";
    cancelAnimationFrame(game.raf);
    game.context.suspend().catch(reportAudioError);
    $("movie").pause();
    $("pause-dialog").showModal();
  }
  function reportAudioError() {
    $("error").hidden = false;
    $("error").textContent = "音声の再開に失敗しました。タイトルに戻り、もう一度開始してください。";
  }
  async function resume() {
    if (game.state !== "paused" || game.busy) return;
    game.busy = true;
    const generation = game.generation;
    try {
      await game.context.resume();
      if (game.generation !== generation) return;
      $("pause-dialog").close();
      game.state = "playing";
      showPortrait(game.movieStarted);
      frame();
      if (document.hidden) pause();
    } catch {
      reportAudioError();
    } finally {
      game.busy = false;
    }
  }
  function title() {
    $("retry").hidden = false;
    game.level = 1;
    game.passed = false;
    clearRun();
    game.state = "title";
    $("pause-dialog").close();
    screen("title");
    showPortrait(false);
    dialogue("わたしと踊ってみる？");
    $("error").hidden = true;
  }
  $("start").addEventListener("click", start);
  $("retry").addEventListener("click", start);
  $("finale-back").addEventListener("click", title);
  $("back").addEventListener("click", title);
  $("quit").addEventListener("click", title);
  $("pause").addEventListener("click", pause);
  $("resume").addEventListener("click", resume);
  $("help").addEventListener("click", () => $("help-dialog").showModal());
  $("close-help").addEventListener("click", () => $("help-dialog").close());
  $("pause-dialog").addEventListener("cancel", (event) => {
    event.preventDefault();
    resume();
  });
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) pause();
  });
  window.addEventListener("blur", () => {
    document.querySelectorAll(".pressed").forEach((n) => n.classList.remove("pressed"));
  });
  const pads = [...document.querySelectorAll("[data-lane]")];
  for (const pad of pads) {
    pad.addEventListener("pointerdown", (event) => {
      if (event.button !== 0) return;
      event.preventDefault();
      pad.focus({ preventScroll: true });
      input(Number(pad.dataset.lane));
      pad.classList.add("pressed");
      pad.setPointerCapture(event.pointerId);
    });
    for (const type of ["pointerup", "pointercancel", "lostpointercapture"])
      pad.addEventListener(type, () => pad.classList.remove("pressed"));
    pad.addEventListener("click", (event) => {
      if (event.detail === 0) input(Number(pad.dataset.lane));
    });
  }
  document.addEventListener("keydown", (event) => {
    if (event.repeat || event.ctrlKey || event.metaKey || event.altKey) return;
    if (event.code === "Escape" && game.state === "playing") {
      event.preventDefault();
      pause();
      return;
    }
    const lane = event.code === "KeyF" ? 0 : event.code === "KeyJ" ? 1 : -1;
    if (
      lane >= 0 &&
      game.state === "playing" &&
      !["INPUT", "TEXTAREA"].includes(event.target.tagName)
    ) {
      event.preventDefault();
      input(lane);
      pads[lane].classList.add("pressed");
    }
  });
  document.addEventListener("keyup", (event) => {
    const lane = event.code === "KeyF" ? 0 : event.code === "KeyJ" ? 1 : -1;
    if (lane >= 0) pads[lane].classList.remove("pressed");
  });
})();
