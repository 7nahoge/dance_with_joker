"use strict";
(() => {
  function chart(score, level, duration = score.duration) {
    const notes = [];
    const beats = Math.round(score.cycle / score.beat);
    const phrases = Math.round((score.duration - (score.reverbTail || 0)) / score.cycle);
    for (let phrase = 0; phrase < phrases; phrase++) {
      for (let pulse = 0; pulse < beats; pulse += 6) {
        // Keep each two-bar note budget, but spread it across both bars.
        // Every pattern leaves a gap after at most two half-beat notes.
        let extras = 0;
        for (let beat = 0; beat < 3; beat++) {
          const number = phrase * (beats / 2) + pulse / 2 + beat;
          if (level === 1 ? number % 4 === 0 : level === 2 ? number % 2 === 0 :
            level === 3 ? number % 4 !== 3 : true) extras++;
        }
        const slots = [0, 3, 6, 9];
        if (extras >= 1) slots.push(1);
        if (extras >= 2) slots.push(8);
        if (extras >= 3) slots.push(4);
        slots.sort((a, b) => a - b);
        for (const slot of slots) {
          if (pulse + slot / 2 >= beats) continue;
          const time = Number((phrase * score.cycle + score.beatOrigin + (pulse + slot / 2) * score.beat).toFixed(4));
          if (time >= duration - .17) continue;
          const previous = notes[notes.length - 1];
          const lane = !previous ? 0 : notes.length % 6 === 3 && time - previous.time >= .3
            ? previous.lane : 1 - previous.lane;
          notes.push({ time, lane, kind: slot % 2 ? "offbeat" : "beat" });
        }
      }
    }
    return notes;
  }
  window.JokerDifficulty = {
    chart,
    judgementWindow: level => Math.max(.144, .18 - (level - 1) * .004),
  };
})();
