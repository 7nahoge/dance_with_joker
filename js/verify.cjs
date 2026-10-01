// Node.js standard library only. Runs production game.js in a deterministic DOM/audio mock.
const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
async function verify(root = require('node:path').resolve(__dirname, '..')) {
  const elements = new Map();
  class Element {
    constructor() { this.handlers = {}; this.hidden = false; this.value = '35'; this.style = {}; this.dataset = {}; this.children = []; this.clientHeight = 400; this.offsetHeight = 72; this.tagName = 'BUTTON'; this.classList = { add(){}, remove(){}, toggle(){} }; }
    addEventListener(k, fn) { (this.handlers[k] ||= []).push(fn); }
    async fire(k, data = {}) { for (const fn of this.handlers[k] || []) await fn({ preventDefault(){}, target: this, ...data }); }
    append(el) { this.children.push(el); } replaceChildren() { this.children = []; } remove() {} setAttribute() {} focus() {} setPointerCapture() {} play() { return Promise.resolve(); } pause() {} showModal() { this.open = true; } close() { this.open = false; }
  }
  const get = id => { if (!elements.has(id)) elements.set(id, new Element()); return elements.get(id); };
  const pads = [new Element(), new Element()]; pads.forEach((p,i) => p.dataset.lane = String(i));
  const document = new Element(); document.hidden = false; document.body = new Element(); document.getElementById = get; document.createElement = () => new Element(); document.querySelectorAll = s => s === '[data-lane]' ? pads : [];
  const param = () => ({ setValueAtTime(){}, linearRampToValueAtTime(){}, exponentialRampToValueAtTime(){}, setTargetAtTime(){} });
  let audio, raf, active = new Set(), sources = [], fetchCount = 0, failFetch = false, failDecode = false;
  class Audio {
    constructor() { audio = this; this.currentTime = 0; this.state = 'suspended'; this.destination = {}; }
    async resume() { this.state = 'running'; } async suspend() { this.state = 'suspended'; }
    createGain() { return { gain: param(), connect(){}, disconnect(){} }; }
    createOscillator() { const o = { frequency: {}, connect(){}, disconnect(){}, start(){active.add(o);}, stop(at){if (at === undefined) active.delete(o);} }; return o; }
    async decodeAudioData() { if (failDecode) throw new Error('decode failure'); return { duration: 63 }; }
    createBufferSource() { const s = { playbackRate: {value:1}, connect(){}, disconnect(){}, start(at, offset){this.startedAt=at;this.offset=offset;active.add(s);}, stop(at){this.stoppedAt=at;if(at===undefined)active.delete(s);} }; sources.push(s); return s; }
  }
  const window = new Element(); window.AudioContext = Audio; window.location = { protocol: 'http:' };
  const context = vm.createContext({ document, window, fetch: async url => { assert.equal(url,'assets/joker_music.wav?v=nooverlap63'); fetchCount++; return {ok:!failFetch,arrayBuffer:async()=>new ArrayBuffer(8)}; }, requestAnimationFrame: fn => { raf = fn; return 1; }, cancelAnimationFrame: () => { raf = null; } });
  vm.runInContext(fs.readFileSync(root + '/js/music-chart.js', 'utf8'), context);
  const scoreData = window.WALTZ_SCORE, chart = scoreData.notes, lead = .12 + 6 * (scoreData.beat / 1.05);
  const wav = fs.readFileSync(root + '/assets/joker_music.wav');
  assert.equal(wav.readUInt32LE(40) / wav.readUInt32LE(28), scoreData.duration);
  assert.equal(scoreData.duration,63);
  assert.equal(scoreData.bpm,150); assert.equal(scoreData.overlap,0); assert.equal(scoreData.cycle,9);
  assert.equal(chart.length,150);
  const phraseCounts = Array.from({length:7}, (_,i) => chart.filter(n=>n.time>=i*9 && n.time<(i+1)*9).length);
  assert(phraseCounts.every((count,i)=>i===0 || count>=phraseCounts[i-1]), 'Density must grow across repeated phrases');
  assert(phraseCounts[6]>phraseCounts[0], 'Ending must contain more notes than opening');
  for (let i=0; i<chart.length; i++) {
    const n=chart[i];
    assert([0,1].includes(n.lane)); assert(n.time>=0 && n.time<scoreData.duration-.2);
    if(i>1) assert(!(n.lane===chart[i-1].lane && n.lane===chart[i-2].lane),'No three same-lane hits in a row');
    if(i) assert(n.time-chart[i-1].time>=.169);
    assert(scoreData.melodyEvents.some(event=>Math.abs(n.time-(Math.floor(n.time/scoreData.cycle)*scoreData.cycle+event.time))<.00001),'Note must follow a melodic onset after loop shift');
    const previousSameLane = chart.slice(0,i).reverse().find(other=>other.lane===n.lane);
    if(previousSameLane) assert((n.time-previousSameLane.time)/1.05>.32,'Same-lane windows must not overlap');
  }
  assert(chart.some((n,i)=>i>0 && n.lane===chart[i-1].lane),'Include same-lane doubles');
  assert(chart.some((n,i)=>i>0 && n.time-chart[i-1].time<.3),'Include melody subdivisions');
  assert(chart.some(n=>!scoreData.sourceBeats.some(t=>Math.abs(n.time-(Math.floor(n.time/scoreData.cycle)*scoreData.cycle+t))<.08)),'Chart must not be a beat-only grid');
  const playDuration = scoreData.duration / 1.05;

  vm.runInContext(fs.readFileSync(root + '/js/game.js', 'utf8'), context);
  const tick = t => { if(audio.state === 'running') audio.currentTime = t; const fn = raf; raf = null; if(fn) fn(); };
  const press = (lane, repeat = false) => document.fire('keydown', { code: lane ? 'KeyJ' : 'KeyF', repeat });
  window.location.protocol = 'file:'; await get('start').fire('click'); assert.equal(get('error').hidden,false); assert.equal(active.size,0);
  window.location.protocol = 'http:'; failFetch=true; await get('start').fire('click'); assert.equal(get('error').hidden,false); assert.equal(active.size,0);
  failFetch=false; failDecode=true; await get('start').fire('click'); assert.equal(get('error').hidden,false); assert.equal(active.size,0);
  failDecode=false; await get('start').fire('click'); const voices = active.size; assert.equal(voices,7); assert.equal(get('play').hidden, false); assert.equal(get('error').hidden,true);
  assert.equal(sources[0].playbackRate.value,1.05); assert.equal(sources[0].loop,false); assert.equal(sources[0].startedAt,lead); assert.equal(sources[0].offset,0); assert.equal(sources[0].stoppedAt,lead+playDuration);
  tick(lead+chart[0].time/1.05); await press(0); assert.equal(get('score').textContent, '0100'); await press(0); await press(1); assert.equal(get('score').textContent, '0100');
  tick(lead+chart[1].time/1.05+.1); await press(1, true); assert.equal(get('score').textContent, '0100'); await press(1); assert.equal(get('score').textContent, '0160');
  tick(lead+chart[2].time/1.05+.17); assert.equal(get('combo').textContent, 0);
  await get('pause').fire('click'); const stoppedAt = audio.currentTime; tick(25); assert.equal(audio.currentTime, stoppedAt); await press(1); assert.equal(get('score').textContent, '0160');
  await get('resume').fire('click'); assert.equal(audio.currentTime, stoppedAt); assert.equal(active.size, voices); assert.equal(sources.length,1);
  tick(lead+playDuration-1); assert.equal(get('play').hidden,false); assert.equal(get('result').hidden,true);
  tick(lead+playDuration-.001); assert.equal(get('play').hidden,false);
  tick(lead+playDuration+.01); assert.equal(get('result').hidden, false); assert.equal(get('result-perfect').textContent, 1); assert.equal(get('result-good').textContent, 1); assert.equal(get('result-miss').textContent, chart.length-2); assert.equal(active.size, 0);
  await get('retry').fire('click'); assert.equal(active.size, voices); assert.equal(get('score').textContent, '0000'); assert.equal(sources.length,2); assert.equal(sources[1].offset,0); assert.equal(fetchCount,3);
  document.hidden = true; await document.fire('visibilitychange'); assert.equal(audio.state, 'suspended'); document.hidden = false; await get('resume').fire('click');
  await get('quit').fire('click'); assert.equal(active.size, 0);
  await get('joker').fire('error'); await get('movie').fire('error'); assert.equal(get('placeholder').hidden, false);
  await get('start').fire('click'); const start = audio.currentTime + lead;
  for(const n of chart) { tick(start+n.time/1.05); await pads[n.lane].fire('pointerdown', {button:0,pointerId:1}); await pads[n.lane].fire('click',{detail:1}); await press(n.lane, true); }
  tick(start+playDuration+.01); assert.equal(get('result-score').textContent, chart.length*100); assert.equal(get('result-combo').textContent, chart.length); assert.equal(get('result-perfect').textContent, chart.length); assert.equal(get('result-miss').textContent, 0);
  // Inclusive timing boundaries and just-outside input rejection.
  await get('retry').fire('click'); const boundaryStart = audio.currentTime + lead;
  tick(boundaryStart+chart[0].time/1.05-.161); await press(0); assert.equal(get('score').textContent,'0000');
  tick(boundaryStart+chart[0].time/1.05-.160); await press(0); assert.equal(get('score').textContent,'0060');
  tick(boundaryStart+chart[1].time/1.05+.080); await press(1); assert.equal(get('score').textContent,'0160');
  tick(boundaryStart+chart[2].time/1.05+.160); await press(0); assert.equal(get('score').textContent,'0220');
  await get('pause').fire('click'); await get('quit').fire('click'); assert.equal(active.size,0); assert.equal(raf,null);
  return `PASS: ${chart.length} onset-aligned notes, ${scoreData.bpm*1.05} BPM, no overlap; WAV loading/cache/scheduling; failure recovery; pause/resume; retry; full run; judgement boundaries; duplicate input; held key; hidden tab; cleanup; missing images/video; ${chart.length*100}-point perfect run.`;
}
module.exports = verify;
if (require.main === module) verify().then(console.log).catch(e => { console.error(e); process.exitCode = 1; });
