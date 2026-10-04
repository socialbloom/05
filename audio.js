// THE ONE FILE THAT MAY OPEN A SOUND, and only from start(), which only the PLAY click calls (Marco's
// rule: music starts only from PLAY). tools/check.js fails if a sound is opened anywhere else.
//
// The context is opened inside the PLAY tap itself, as a phone requires. While it plays, the audio
// clock is the clock: the screen asks beat(). The scheduler is the usual look-ahead — every 25 ms,
// every note in the next 0.3 s is handed to the engine at its exact time. The hand's colour, drive,
// echo, space and hold are applied on every tick, glided.
import { createEngine } from './engine.js';
import { events, levelOf, BPM, NP } from './music.js';

const SPB = 60 / BPM, AHEAD = 0.3, TICK = 25;
let ctx = null, eng = null, timer = null, t0 = 0, next = 0, hand = null, playing = false;

export const awake = () => !!ctx && ctx.state === 'running' && playing;
// The beat now, as heard (the output's latency taken off); null when not playing.
export function beat() {
  if (!awake()) return null;
  return (ctx.currentTime - (ctx.outputLatency || ctx.baseLatency || 0) - t0) / SPB;
}

// Called from the PLAY click, and from nowhere else. `lead`: beats of silence before beat 0 (the
// lead-in); `getHand()` → { colour, drive, echo, space, tension } arrays, read every tick.
export function start(lead, getHand) {
  if (!ctx) {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    ctx = new Ctx({ latencyHint: 'interactive' });
    eng = createEngine(ctx);
    eng.out.connect(ctx.destination);
  }
  throughTheSwitch();
  ctx.resume();                                    // inside the tap: a phone lets it start here
  hand = getHand;
  playing = true;
  t0 = ctx.currentTime + 0.08 + lead * SPB;
  next = 0;
  eng.unhush(ctx.currentTime);
  clearInterval(timer);
  timer = setInterval(run, TICK);
  run();
}

// THE IPHONE'S SILENT SWITCH (Marco, 2026-10-04: play through it, as music apps do). From iOS 17 the page
// says it is playback, not a ring or a click; on older iOS a looping silent <audio> element, started in the
// same tap, puts the page in the same category. Volume stays the phone's own. Nothing heard is added: the
// element plays silence.
let quiet = null;
function throughTheSwitch() {
  try { if (navigator.audioSession) navigator.audioSession.type = 'playback'; } catch { /* not there */ }
  if (navigator.audioSession) return;
  if (quiet) { quiet.play().catch(() => {}); return; }
  try {
    quiet = document.createElement('audio');
    quiet.setAttribute('playsinline', ''); quiet.loop = true; quiet.src = silentWav();
    quiet.play().catch(() => {});
  } catch { /* not there */ }
}
function silentWav() {
  const sr = 8000, n = sr / 2, b = new DataView(new ArrayBuffer(44 + n * 2));
  const w = (o, str) => { for (let i = 0; i < str.length; i++) b.setUint8(o + i, str.charCodeAt(i)); };
  w(0, 'RIFF'); b.setUint32(4, 36 + n * 2, true); w(8, 'WAVE'); w(12, 'fmt '); b.setUint32(16, 16, true); b.setUint16(20, 1, true);
  b.setUint16(22, 1, true); b.setUint32(24, sr, true); b.setUint32(28, sr * 2, true); b.setUint16(32, 2, true); b.setUint16(34, 16, true);
  w(36, 'data'); b.setUint32(40, n * 2, true);
  return URL.createObjectURL(new Blob([b], { type: 'audio/wav' }));
}

// STOP: out quickly. LEAVING (the phone locked, a call, another app): out over a bar (docs/02 §11).
export function stop(over = 0.12) {
  playing = false;
  clearInterval(timer); timer = null;
  if (quiet) quiet.pause();
  if (!ctx) return;
  eng.hush(ctx.currentTime, over);
  const c = ctx;
  setTimeout(() => { if (!playing) c.suspend(); }, over * 1000 + 300);
}

function run() {
  if (!ctx || !playing) return;
  const h = hand && hand();
  if (h) for (let p = 0; p < NP; p++) eng.apply(p, { colour: h.colour[p], drive: h.drive[p], echo: h.echo[p], space: h.space[p], tension: h.tension[p] }, ctx.currentTime);
  const horizon = (ctx.currentTime + AHEAD - t0) / SPB;
  if (horizon <= next) return;
  for (const e of events(Math.max(0, next), horizon)) {
    const at = t0 + e.beat * SPB;
    if (at < ctx.currentTime - 0.01) continue;
    const lv = levelOf(e.part, e.beat);
    eng.play(e, Math.max(at, ctx.currentTime), lv / 0.85);
  }
  next = horizon;
}
