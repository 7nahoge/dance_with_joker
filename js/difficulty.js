"use strict";
(() => {
  function chart(score, level, duration = score.duration) {
    const notes = [];
    const beats = Math.round(score.cycle / score.beat);
    const phrases = Math.round((score.duration - (score.reverbTail || 0)) / score.cycle);
    for (let phrase = 0; phrase < phrases; phrase++) {
      for (let pulse = 0; pulse < beats; pulse++) {
        for (let half = 0; half < 2; half++) {
          const number = phrase * beats + pulse;
          if (half && (level === 1 ? number % 4 !== 0 : level === 2 ? number % 2 !== 0 :
            level === 3 ? number % 4 === 3 : false)) continue;
          const time = Number((phrase * score.cycle + score.beatOrigin + (pulse + half / 2) * score.beat).toFixed(4));
          if (time >= duration - .17) continue;
          const previous = notes[notes.length - 1];
          const lane = !previous ? 0 : notes.length % 6 === 3 && time - previous.time >= .3
            ? previous.lane : 1 - previous.lane;
          notes.push({ time, lane, kind: half ? "offbeat" : "beat" });
        }
      }
    }
    return notes;
  }
  window.JokerDifficulty = {
    chart,
    judgementWindow: level => Math.max(.075, .12 - (level - 1) * .005),
  };
})();
