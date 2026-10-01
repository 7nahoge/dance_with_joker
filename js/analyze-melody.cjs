// Offline upper-register melody estimate; no runtime dependencies or beat snapping.
module.exports = function analyzeMelody({ sample, frames, rate, channels }) {
  const size = 4096,
    hop = Math.round(rate * 0.01),
    rows = [];
  function spectrum(center) {
    const re = new Float64Array(size),
      im = new Float64Array(size);
    for (let i = 0; i < size; i++) {
      const at = center + i - size / 2;
      if (at >= 0 && at < frames) {
        for (let c = 0; c < channels; c++) re[i] += sample(at, c) / channels;
        re[i] *= 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (size - 1));
      }
    }
    for (let i = 1, j = 0; i < size; i++) {
      let bit = size >> 1;
      for (; j & bit; bit >>= 1) j ^= bit;
      j ^= bit;
      if (i < j) [re[i], re[j]] = [re[j], re[i]];
    }
    for (let len = 2; len <= size; len *= 2) {
      const angle = (-2 * Math.PI) / len;
      for (let start = 0; start < size; start += len) {
        for (let j = 0; j < len / 2; j++) {
          const a = start + j,
            b = a + len / 2,
            wr = Math.cos(angle * j),
            wi = Math.sin(angle * j);
          const tr = re[b] * wr - im[b] * wi,
            ti = re[b] * wi + im[b] * wr;
          re[b] = re[a] - tr;
          im[b] = im[a] - ti;
          re[a] += tr;
          im[a] += ti;
        }
      }
    }
    return Array.from({ length: size / 2 }, (_, k) => Math.hypot(re[k], im[k]));
  }
  let previous = null;
  for (let center = 0; center < frames; center += hop) {
    const bins = spectrum(center);
    const energy = (hz) => {
      const k = Math.round((hz * size) / rate);
      return Math.max(bins[k - 1] || 0, bins[k] || 0, bins[k + 1] || 0);
    };
    let pitch = 0,
      strength = 0,
      flux = 0;
    // Suppress bass/accompaniment; follow fundamentals and harmonics in the lead register.
    for (let midi = 72; midi <= 96; midi++) {
      const hz = 440 * 2 ** ((midi - 69) / 12);
      const value = energy(hz) + 0.35 * energy(hz * 2) - 0.5 * energy(hz / 2);
      if (value > strength) {
        strength = value;
        pitch = midi;
      }
    }
    for (let k = Math.ceil((520 * size) / rate); k < Math.floor((4000 * size) / rate); k++) {
      flux += Math.max(0, bins[k] - (previous?.[k] || 0));
    }
    rows.push({ time: center / rate, pitch, strength, flux });
    previous = bins;
  }
  const candidates = [];
  for (let i = 3; i < rows.length - 5; i++) {
    const row = rows[i],
      local = rows.slice(i - 3, i + 4);
    const baseline =
      rows.slice(Math.max(0, i - 15), i + 16).reduce((s, r) => s + r.flux, 0) /
      Math.min(31, i + 16);
    if (row.flux < 8 || row.flux < baseline * 1.4 || local.some((r) => r.flux > row.flux)) continue;
    const after = rows.slice(i + 2, i + 8),
      before = rows.slice(i - 3, i);
    const pitch = after.reduce((best, r) => (r.strength > best.strength ? r : best)).pitch;
    const previousPitch = before.reduce((best, r) => (r.strength > best.strength ? r : best)).pitch;
    candidates.push({
      time: Number(row.time.toFixed(3)),
      pitch,
      strength: row.flux,
      pitchChange: pitch !== previousPitch,
    });
  }
  const selected = [];
  for (const event of candidates.sort((a, b) => b.strength - a.strength)) {
    if (selected.every((other) => Math.abs(other.time - event.time) >= 0.17)) selected.push(event);
  }
  return selected.sort((a, b) => a.time - b.time);
};
