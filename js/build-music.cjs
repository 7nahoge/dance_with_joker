// Build a continuous PCM track ending after a complete final repeat from the canonical source WAV.
// Run: node js/build-music.cjs (Node.js standard library only).
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const TARGET_DURATION = 60;
const wav = fs.readFileSync(path.join(__dirname, '../source/joker_movie.wav'));
assert.equal(wav.toString('ascii', 0, 4), 'RIFF');
assert.equal(wav.toString('ascii', 8, 12), 'WAVE');
let format, data;
for (let offset = 12; offset + 8 <= wav.length;) {
  const size = wav.readUInt32LE(offset + 4);
  const name = wav.toString('ascii', offset, offset + 4);
  if (name === 'fmt ') format = wav.subarray(offset + 8, offset + 8 + size);
  if (name === 'data') data = wav.subarray(offset + 8, offset + 8 + size);
  offset += 8 + size + size % 2;
}
assert(format && data);
assert.equal(format.readUInt16LE(0), 1, 'PCM required');
assert.equal(format.readUInt16LE(14), 16, '16-bit required');
const channels = format.readUInt16LE(2), rate = format.readUInt32LE(4);
const frames = data.length / (2 * channels), block = Math.round(rate * .01);
const sample = (frame, channel) => data.readInt16LE((frame * channels + channel) * 2) / 32768;
function rms(start, end) {
  let sum = 0;
  for (let i = start; i < end; i++) for (let c = 0; c < channels; c++) sum += sample(i, c) ** 2;
  return Math.sqrt(sum / ((end - start) * channels));
}
// Trim only the outer quiet sections; leave pauses inside the music intact.
let begin = 0, end = frames;
while (begin + block < end && rms(begin, begin + block) < .01) begin += block;
while (end - block > begin && rms(end - block, end) < .01) end -= block;
const length = end - begin, overlap = 0, step = length - overlap;
assert(step > overlap);
const copies = Math.max(1, Math.ceil((rate * TARGET_DURATION - length) / step) + 1);
const outputFrames = (copies - 1) * step + length, DURATION = outputFrames / rate;
const mixed = new Float64Array(outputFrames * channels);
const joins = [];
for (let start = 0; start <= (copies - 1) * step; start += step) {
  if (start) joins.push(start);
  for (let i = 0; i < length && start + i < outputFrames; i++) {
    // With overlap=0 each copy follows the previous one without mixing.
    let gain = 1;
    if (overlap > 1 && start > 0 && i < overlap) gain *= Math.sin(i / (overlap - 1) * Math.PI / 2);
    if (overlap > 1 && i >= step) gain *= Math.cos((i - step) / (overlap - 1) * Math.PI / 2);
    for (let c = 0; c < channels; c++) mixed[(start + i) * channels + c] += sample(begin + i, c) * gain;
  }
}
let peak = 0;
for (const value of mixed) peak = Math.max(peak, Math.abs(value));
const level = peak > .98 ? .98 / peak : 1;
const output = Buffer.alloc(44 + outputFrames * channels * 2);
output.write('RIFF'); output.writeUInt32LE(output.length - 8, 4); output.write('WAVEfmt ', 8);
output.writeUInt32LE(16, 16); output.writeUInt16LE(1, 20); output.writeUInt16LE(channels, 22);
output.writeUInt32LE(rate, 24); output.writeUInt32LE(rate * channels * 2, 28);
output.writeUInt16LE(channels * 2, 32); output.writeUInt16LE(16, 34);
output.write('data', 36); output.writeUInt32LE(output.length - 44, 40);
for (let i = 0; i < mixed.length; i++) output.writeInt16LE(Math.round(mixed[i] * level * 32767), 44 + i * 2);
// Check every 50 ms window, including all crossfades, for accidental silence.
let minimumRms = Infinity;
for (let i = 0; i < outputFrames; i += Math.round(rate * .05)) {
  const last = Math.min(outputFrames, i + Math.round(rate * .05));
  let sum = 0;
  for (let f = i; f < last; f++) for (let c = 0; c < channels; c++) sum += mixed[f * channels + c] ** 2;
  minimumRms = Math.min(minimumRms, Math.sqrt(sum / ((last - i) * channels)) * level);
}
assert(minimumRms > .001, 'Unexpected silent section');
assert.equal(outputFrames / rate, DURATION);
fs.writeFileSync(path.join(__dirname, '../assets/joker_music.wav'), output);
// Estimate the beat grid from positive changes in the original 10 ms RMS envelope.
const envelope = [];
for (let i = 0; i + block <= frames; i += block) envelope.push(rms(i, i + block));
const onset = envelope.map((value, i) => Math.max(0, value - (envelope[Math.max(0, i - 2)] || 0)));
let best = { score: -Infinity };
for (let period = .35; period <= .75; period += .001) {
  for (let offset = .08; offset <= .20; offset += .005) {
    let score = 0, count = 0;
    for (let t = offset; t < end / rate - .3; t += period) {
      const at = Math.round(t * 100);
      score += Math.max(...onset.slice(Math.max(0, at - 2), at + 3)); count++;
    }
    score /= count;
    if (score > best.score) best = { score, period, offset };
  }
}
const bpm = Math.round(60 / best.period);
const beat = 60 / bpm, sourceBeats = [];
for (let expected = best.offset; expected < (begin + step) / rate - Math.max(overlap / rate, .25); expected += beat) {
  const center = Math.round(expected * 100);
  let peakIndex = center;
  for (let j = Math.max(0, center - 4); j <= center + 4; j++) if (onset[j] > onset[peakIndex]) peakIndex = j;
  sourceBeats.push(Number((peakIndex / 100 - begin / rate).toFixed(4)));
}
const notes = [];
const melodyEvents = require('./analyze-melody.cjs')({ sample, frames, rate, channels })
  .filter(event => event.time >= begin / rate && event.time < end / rate - .25 && event.strength >= 90)
  .map(event => ({ ...event, time: Number((event.time - begin / rate).toFixed(4)), strength: Number(event.strength.toFixed(2)) }));
const rankedMelody = [...melodyEvents].sort((a,b) =>
  a === melodyEvents[0] ? -1 : b === melodyEvents[0] ? 1 : b.strength - a.strength);
const phraseBudgets = [13, 17, 20, 22, 24, 26, 28];
assert.equal(copies, phraseBudgets.length);
assert(melodyEvents.length >= Math.max(...phraseBudgets));
let previousPitch = null;
for (let start = 0; start <= (copies - 1) * step; start += step) {
  for (const event of melodyEvents) {
    const time = Number((start / rate + event.time).toFixed(4));
    // Each successive phrase includes more melodic attacks; exactly 150 in total.
    const budget = phraseBudgets[Math.round(start / step)];
    if (rankedMelody.indexOf(event) >= budget || time >= DURATION - .2) continue;
    const previous = notes[notes.length - 1], before = notes[notes.length - 2];
    let lane = previousPitch === null ? 0 : event.pitch > previousPitch ? 1 : event.pitch < previousPitch ? 0 : 1 - previous.lane;
    if (previous && ((time - previous.time < .34 && lane === previous.lane) ||
      (before && before.lane === lane && previous.lane === lane))) lane = 1 - previous.lane;
    notes.push({ time, lane, pitch: event.pitch }); previousPitch = event.pitch;
  }
}
assert(notes.every((n, i) => i === 0 || n.time - notes[i - 1].time >= .169), 'Notes too close');
assert.equal(notes.length, 150, 'The chart must contain exactly 150 notes');
const scoreData = { bpm, beat, duration: DURATION, overlap: overlap / rate, sourceBeats,
  basis: 'upper-register-melody-onsets', melodyEvents, cycle: step / rate, notes };
fs.writeFileSync(path.join(__dirname, 'music-chart.js'), '// Generated by build-music.cjs. Times include trimming and every crossfade.\nwindow.WALTZ_SCORE = ' + JSON.stringify(scoreData, null, 2) + ';\n');
console.log(JSON.stringify({ duration: DURATION, trimmedStart: begin / rate, trimmedEnd: end / rate,
  overlap: overlap / rate, joins: joins.map(i => i / rate), minimumRms, peak: peak * level, bpm, sourceBeats, notes: notes.length }, null, 2));
