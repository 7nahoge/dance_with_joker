// Build a continuous PCM track ending after a complete final repeat from the canonical source WAV.
// Run: node js/build-music.cjs (Node.js standard library only).
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
// Preserve the original melody; fill only the missing ending with diffuse decay.
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
// Eight bars stay on the 150 BPM grid. Keep the complete original BGM.
const LOOP_BEATS = 24;
const length = Math.round(rate * LOOP_BEATS * (60 / 150));
const sourceLength = end - begin;
assert(sourceLength <= length, 'Source must fit inside eight bars');
const TAIL_EXTENSION = Number(((length - sourceLength) / rate).toFixed(4));
const originalLength = length, overlap = 0, step = length;
const phraseAudio = new Float64Array(length * channels);
for (let i = 0; i < sourceLength; i++) {
  for (let c = 0; c < channels; c++) phraseAudio[i * channels + c] = sample(begin + i, c);
}
// Feed the final tone into damped, unequal delay lines. This creates a smooth
// decay rather than replaying notes or overlapping short, fixed audio grains.
const decayStart = Math.max(0, sourceLength - Math.round(rate * .35));
for (const seconds of [.029, .037, .043, .053, .061, .071]) {
  const delay = Math.round(rate * seconds);
  const feedback = Math.pow(.001, seconds / 2.4);
  for (let c = 0; c < channels; c++) {
    const ring = new Float64Array(delay);
    let filtered = 0;
    for (let i = decayStart; i < length; i++) {
      const local = i - decayStart, slot = local % delay;
      filtered += .35 * (ring[slot] - filtered);
      const input = i < sourceLength ? sample(begin + i, c) : 0;
      ring[slot] = input + filtered * feedback;
      const fadeIn = Math.min(1, local / (rate * .12));
      phraseAudio[i * channels + c] += filtered * .10 * fadeIn;
    }
  }
}
function extendedSample(i, c) {
  const fade = Math.min(1, (length - 1 - i) / (rate * .005));
  return phraseAudio[i * channels + c] * fade;
}
assert(step > overlap);
const copies = 7;
const REVERB_TAIL = .9;
const musicFrames = (copies - 1) * step + length;
const outputFrames = musicFrames + Math.round(rate * REVERB_TAIL), DURATION = outputFrames / rate;
const mixed = new Float64Array(outputFrames * channels);
const joins = [];
for (let start = 0; start <= (copies - 1) * step; start += step) {
  if (start) joins.push(start);
  for (let i = 0; i < length && start + i < outputFrames; i++) {
    // With overlap=0 each copy follows the previous one without mixing.
    let gain = Math.min(1, i / (rate * .005));
    if (overlap > 1 && start > 0 && i < overlap) gain *= Math.sin(i / (overlap - 1) * Math.PI / 2);
    if (overlap > 1 && i >= step) gain *= Math.cos((i - step) / (overlap - 1) * Math.PI / 2);
    for (let c = 0; c < channels; c++) mixed[(start + i) * channels + c] += extendedSample(i, c) * gain;
  }
}
// Excite a diffuse reverb only during the final 300 ms, then let it decay.
const reverbStart = musicFrames - Math.round(rate * .3);
const dryEnding = mixed.slice(reverbStart * channels, musicFrames * channels);
for (const seconds of [.029, .037, .043, .053]) {
  const delay = Math.round(rate * seconds);
  const feedback = Math.pow(.001, seconds / .75);
  for (let c = 0; c < channels; c++) {
    const ring = new Float64Array(delay);
    let filtered = 0;
    for (let f = reverbStart; f < outputFrames; f++) {
      const local = f - reverbStart, slot = local % delay;
      filtered += .35 * (ring[slot] - filtered);
      const input = f < musicFrames ? dryEnding[local * channels + c] : 0;
      ring[slot] = input + filtered * feedback;
      const fadeIn = Math.min(1, local / (rate * .08));
      const fadeOut = Math.min(1, (outputFrames - 1 - f) / (rate * .15));
      mixed[f * channels + c] += filtered * .12 * fadeIn * fadeOut;
    }
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
for (let i = 0; i < musicFrames; i += Math.round(rate * .05)) {
  const last = Math.min(musicFrames, i + Math.round(rate * .05));
  let sum = 0;
  for (let f = i; f < last; f++) for (let c = 0; c < channels; c++) sum += mixed[f * channels + c] ** 2;
  minimumRms = Math.min(minimumRms, Math.sqrt(sum / ((last - i) * channels)) * level);
}
assert(minimumRms > .001, 'Unexpected silent section');
assert.equal(outputFrames / rate, DURATION);
fs.writeFileSync(path.join(__dirname, '../assets/joker_music.generated.wav'), output);
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
for (let expected = best.offset; expected < end / rate - Math.max(overlap / rate, .25); expected += beat) {
  const center = Math.round(expected * 100);
  let peakIndex = center;
  for (let j = Math.max(0, center - 4); j <= center + 4; j++) if (onset[j] > onset[peakIndex]) peakIndex = j;
  sourceBeats.push(Number((peakIndex / 100 - begin / rate).toFixed(4)));
}
const notes = [];
const melodyEvents = require('./analyze-melody.cjs')({ sample, frames, rate, channels })
  .filter(event => event.time >= begin / rate && event.time < end / rate - .25 && event.strength >= 90)
  .map(event => ({ ...event, time: Number((event.time - begin / rate).toFixed(4)), strength: Number(event.strength.toFixed(2)) }));
// Keep the main pulse and progressively fill its eighth-note offbeats.
// Use a regular beat grid: onset jitter must not create unfair short intervals.
const phraseBudgets = [32, 34, 36, 38, 40, 42, 44];
const beatOrigin = sourceBeats[0];
const pulseCount = Math.floor((originalLength / rate - beatOrigin) / beat) + 1;
assert.equal(copies, phraseBudgets.length);
assert.equal(pulseCount, LOOP_BEATS);
const lastLaneTime = [-Infinity, -Infinity];
for (let start = 0; start <= (copies - 1) * step; start += step) {
  const phrase = Math.round(start / step);
  const offbeatCount = phraseBudgets[phrase] - pulseCount;
  // Spread additions through the phrase rather than bunching them at its end.
  const offbeatSlots = new Set(Array.from({ length: offbeatCount }, (_, i) =>
    Math.floor((i + .5) * pulseCount / offbeatCount)));
  const events = [];
  for (let pulse = 0; pulse < pulseCount; pulse++) {
    events.push({ time: beatOrigin + pulse * beat, kind: 'beat', pulse });
    if (offbeatSlots.has(pulse)) {
      events.push({ time: beatOrigin + (pulse + .5) * beat, kind: 'offbeat', pulse });
    }
  }
  // In the last three phrases, play four cards then rest for two.
  const playableEvents = events.filter((event, index) => phrase < 4 || index % 6 < 4);
  for (const event of playableEvents) {
    const time = Number((start / rate + event.time).toFixed(4));
    const previous = notes[notes.length - 1], before = notes[notes.length - 2];
    // Alternate fast pairs; vary the slower passages with occasional doubles.
    let lane = previous ? (event.pulse % 3 === 0 ? previous.lane : 1 - previous.lane) : 0;
    if (time - lastLaneTime[lane] <= .32 * 1.05 ||
      (before && before.lane === lane && previous.lane === lane)) lane = 1 - lane;
    assert(time - lastLaneTime[lane] > .32 * 1.05, 'Same-lane judgement windows overlap');
    notes.push({ time, lane, kind: event.kind });
    lastLaneTime[lane] = time;
  }
}
assert(notes.every((n, i) => i === 0 || n.time - notes[i - 1].time >= .169), 'Notes too close');
assert.equal(notes.length, 226, 'The chart must contain exactly 226 notes');
const scoreData = { bpm, beat, duration: DURATION, overlap: overlap / rate, sourceBeats,
  basis: 'beat-and-eighth-offbeat', beatOrigin, phraseBudgets: Array.from({ length: copies }, (_, phrase) => notes.filter(note => Math.floor(note.time / (step / rate)) === phrase).length), tailExtension: TAIL_EXTENSION,
  reverbTail: REVERB_TAIL, melodyEvents, cycle: step / rate, notes };
fs.writeFileSync(path.join(__dirname, 'music-chart.generated.js'), '// Generated by build-music.cjs. Times include trimming and every crossfade.\nwindow.WALTZ_SCORE = ' + JSON.stringify(scoreData, null, 2) + ';\n');
console.log(JSON.stringify({ duration: DURATION, trimmedStart: begin / rate, trimmedEnd: end / rate,
  overlap: overlap / rate, joins: joins.map(i => i / rate), minimumRms, peak: peak * level, bpm, sourceBeats, notes: notes.length }, null, 2));
