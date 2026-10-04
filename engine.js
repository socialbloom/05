// THE ENGINE — 05's sound graph, and nothing that opens a sound. createEngine(ctx) builds on ANY
// BaseAudioContext: audio.js gives it a real one, from PLAY; tools/measure.html an OfflineAudioContext,
// which reaches no speaker.
//
// FROM THE REFERENCE SET (docs/00): Pablo Bolivar's *Recall* — deep melodies over a firm, clean drum
// line; warm chords and pads; dub techno's echo and space as a big part of the music; a round bass.
// Every voice is made here; nothing from a record. His instruments are the palette, not copied: a
// Prophet-style pad, a DX7-style bell, the dub chord of the Basic Channel school he grew from.
//
// THE VOICES, by channel:
//   KICK     deep and round: a sine falling from 160 to 48 Hz, a long body, a soft felt click
//   CLAP     a rim and a soft clap together, small and dry — the space makes it big
//   HATS     six metal squares, high-passed, closed short and open longer, plus air
//   PERC     a shaker that breathes, a conga that falls
//   BASS     a round sub: a sine and its octave, softly saturated, low-passed
//   CHORDS   the dub chord: two saws and a square below each note through a resonant low-pass that
//            snaps shut — made to be echoed
//   PAD      a Prophet-style pad: three detuned saws a note, slow in, slow out, its filter breathing
//   MELODY   a soft FM bell, as a DX7's: a carrier and two modulators, the tine fading first
//
// THE CHANNEL, as the hand plays it (docs/01 §6.3–§6.4): voice ─ trim ─ COLOUR (low-pass, and a
// high shelf above the middle) ─ DRIVE (saturation, louder and dirtier, held in control) ─ HOLD (the
// tension: opens, lifts) ─ the kick's duck ─ the bus. From the channel, two sends: ECHO (a dotted
// eighth, dub style — each repeat darker and a little dirtier) and SPACE (a long dark hall). On the
// bus: a glue compressor, a little tape, a low cut and the limiter. No panning: a phone's speaker is
// one (Marco: panning *"not for phones"*).
import { BPM, NP } from './music.js';

const hz = (m) => 440 * Math.pow(2, (m - 69) / 12);
const SPB = 60 / BPM;

// Each channel's trim, set by measuring (tools/measure.html), and the lowest its colour goes.
export const TRIM = [0.24, 0.68, 0.3, 1.0, 0.14, 0.11, 0.037, 0.066];
const DARKEST = [260, 500, 1400, 900, 70, 220, 180, 300];
// The kick ducks the bass, the pad and the chords — the pump, gently.
const DUCK = [0, 0, 0, 0, 0.45, 0.3, 0.35, 0.15];
export const ECHO_TIME = 0.75 * SPB;                // a dotted eighth: 0.375 s at 120
export const DEFAULTS = { colour: 0.6, drive: 0, space: 0.25, echo: 0, tension: 0 };
// Colour: 0 darkest, 0.6 open (the default), 1 open and bright.
export const cutoffOf = (p, c) => Math.min(20000, DARKEST[p] * Math.pow(20000 / DARKEST[p], Math.min(1, c / 0.6)));
export const brightDb = (c) => Math.max(0, (c - 0.6) / 0.4) * 6;

export function createEngine(ctx) {
  const noise = noiseBuffer(ctx);
  const now = () => ctx.currentTime;

  // ── THE BUS
  const busIn = ctx.createGain(); busIn.gain.value = 0.5;
  const glue = ctx.createDynamicsCompressor();
  glue.threshold.value = -18; glue.knee.value = 10; glue.ratio.value = 2; glue.attack.value = 0.015; glue.release.value = 0.2;
  const make = ctx.createGain(); make.gain.value = 1.3;
  const tape = ctx.createWaveShaper(); tape.curve = softCurve(1.4); tape.oversample = '2x';
  const lowCut = ctx.createBiquadFilter(); lowCut.type = 'highpass'; lowCut.frequency.value = 28; lowCut.Q.value = 0.7;
  const lim = ctx.createDynamicsCompressor();
  lim.threshold.value = -3; lim.knee.value = 2; lim.ratio.value = 16; lim.attack.value = 0.002; lim.release.value = 0.15;
  const out = ctx.createGain(); out.gain.value = 0;   // hushed until wake
  busIn.connect(glue).connect(make).connect(tape).connect(lowCut).connect(lim).connect(out);

  // ── SPACE: a long, dark hall, a little pre-delay
  const verbIn = ctx.createGain();
  const pre = ctx.createDelay(0.2); pre.delayTime.value = 0.03;
  const verb = ctx.createConvolver(); verb.buffer = hallImpulse(ctx, 3.6);
  const verbOut = ctx.createGain(); verbOut.gain.value = 0.9;
  verbIn.connect(pre).connect(verb).connect(verbOut).connect(busIn);

  // ── ECHO: dub style — a dotted eighth; in the loop the repeats darken, thin and saturate a little
  const echoIn = ctx.createGain();
  const eThin = ctx.createBiquadFilter(); eThin.type = 'highpass'; eThin.frequency.value = 200; eThin.Q.value = 0.6;
  const eDelay = ctx.createDelay(2); eDelay.delayTime.value = ECHO_TIME;
  const eDark = ctx.createBiquadFilter(); eDark.type = 'lowpass'; eDark.frequency.value = 2600; eDark.Q.value = 0.5;
  // The loop's saturation has unity gain for quiet repeats (it only rounds loud ones off), so with the
  // feedback under 1 every repeat is quieter than the last and the echo always dies away. (It had a gain of
  // 1.9 on quiet signals: the loop ran at 1.05 and never stopped — Marco, 2026-10-04.)
  const eSat = ctx.createWaveShaper(); eSat.curve = loopCurve(1.8);
  const eFb = ctx.createGain(); eFb.gain.value = 0.62;
  const eOut = ctx.createGain(); eOut.gain.value = 0.8;
  echoIn.connect(eThin).connect(eDelay);
  eDelay.connect(eDark).connect(eSat).connect(eFb).connect(eDelay);
  eDelay.connect(eOut).connect(busIn);
  const eWash = ctx.createGain(); eWash.gain.value = 0.3; eOut.connect(eWash).connect(verbIn);   // the echoes into the space

  // ── THE CHANNELS
  const driveCurve = softCurve(1);
  const ch = Array.from({ length: NP }, (_, p) => {
    const input = ctx.createGain(); input.gain.value = TRIM[p];
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 20000; lp.Q.value = 0.8;
    const shelf = ctx.createBiquadFilter(); shelf.type = 'highshelf'; shelf.frequency.value = 4500; shelf.gain.value = 0;
    const dPre = ctx.createGain(); dPre.gain.value = 1;
    const shaper = ctx.createWaveShaper(); shaper.curve = driveCurve; shaper.oversample = '2x';
    const dPost = ctx.createGain(); dPost.gain.value = 1;
    const lift = ctx.createGain(); lift.gain.value = 1;
    const duck = ctx.createGain(); duck.gain.value = 1;
    const eSend = ctx.createGain(); eSend.gain.value = 0;
    const sSend = ctx.createGain(); sSend.gain.value = 0;
    input.connect(lp).connect(shelf).connect(dPre).connect(shaper).connect(dPost).connect(lift).connect(duck).connect(busIn);
    duck.connect(eSend).connect(echoIn);
    duck.connect(sSend).connect(verbIn);
    return { input, lp, shelf, dPre, dPost, lift, duck, eSend, sSend };
  });

  // THE HAND, applied: each channel's colour, drive, echo, space and hold — glided, never stepped.
  const held = new Array(NP).fill(0);              // each part's hold now — the voices open with it too
  function apply(p, v, at = now(), glide = 0.06) {
    const c = ch[p], t = v.tension || 0;
    held[p] = t;
    const set = (param, x) => param.setTargetAtTime(x, at, glide);
    set(c.lp.frequency, Math.min(20000, cutoffOf(p, v.colour) * (1 + 3 * t)));
    set(c.shelf.gain, brightDb(v.colour) + 3 * t);
    set(c.dPre.gain, 1 + 20 * v.drive);
    set(c.dPost.gain, (1 + 1.3 * v.drive) / (1 + 12 * v.drive));   // dirtier and louder, held in control
    set(c.lift.gain, 1 + 0.8 * t);
    set(c.eSend.gain, v.echo);
    set(c.sSend.gain, Math.min(1.2, v.space * 0.9 + 0.4 * t));
  }
  for (let p = 0; p < NP; p++) apply(p, DEFAULTS, 0, 0.001);

  function duckAt(at) {
    for (let p = 0; p < NP; p++) {
      if (!DUCK[p]) continue;
      const g = ch[p].duck.gain;
      g.cancelScheduledValues(at); g.setValueAtTime(1 - DUCK[p], at); g.setTargetAtTime(1, at + 0.02, 0.07);
    }
  }

  // ── VOICE HELPERS
  const env = (at, a, peak, hold, rel) => {         // attack, a held level, a release
    const g = ctx.createGain(); const p = g.gain;
    p.setValueAtTime(0, at); p.linearRampToValueAtTime(peak, at + a);
    if (hold > a) p.setValueAtTime(peak, at + hold);
    p.setTargetAtTime(0, at + Math.max(a, hold), rel);
    return g;
  };
  const osc = (type, f, at, stop, detune = 0) => { const o = ctx.createOscillator(); o.type = type; o.frequency.value = f; o.detune.value = detune; o.start(at); o.stop(stop); return o; };
  const noiseAt = (at, stop) => { const s = ctx.createBufferSource(); s.buffer = noise; s.loop = true; s.start(at, Math.random() * 1.5); s.stop(stop); return s; };
  const filt = (type, f, q = 0.7) => { const b = ctx.createBiquadFilter(); b.type = type; b.frequency.value = f; b.Q.value = q; return b; };

  // ── THE VOICES
  function kick(at, v) {
    const o = osc('sine', 160, at, at + 0.9);
    o.frequency.setValueAtTime(160, at); o.frequency.exponentialRampToValueAtTime(62, at + 0.035); o.frequency.exponentialRampToValueAtTime(48, at + 0.28);
    const g = ctx.createGain(); g.gain.setValueAtTime(0, at); g.gain.linearRampToValueAtTime(v, at + 0.003); g.gain.setTargetAtTime(0, at + 0.06, 0.17);
    const sat = ctx.createWaveShaper(); sat.curve = softCurve(1.6);
    o.connect(sat).connect(g).connect(ch[0].input);
    const n = noiseAt(at, at + 0.02), nf = filt('bandpass', 1800, 1.2);   // the felt click
    const ng = env(at, 0.0008, v * 0.18, 0.002, 0.004);
    n.connect(nf).connect(ng).connect(ch[0].input);
    duckAt(at);
  }
  function clap(at, v) {
    // The rim: a short knock, pitched.
    const r1 = osc('sine', 1720, at, at + 0.05), r2 = osc('triangle', 470, at, at + 0.06);
    const rg = env(at, 0.001, v * 0.5, 0.004, 0.012);
    r1.connect(rg); r2.connect(rg); rg.connect(filt('highpass', 300)).connect(ch[1].input);
    // The clap: three bursts and a short tail, soft.
    const n = noiseAt(at, at + 0.25), bp = filt('bandpass', 1150, 1.4), g = ctx.createGain(), p = g.gain;
    p.setValueAtTime(0, at);
    for (const k of [0, 0.011, 0.022]) { p.setValueAtTime(v * 0.6, at + k); p.setTargetAtTime(0, at + k + 0.001, 0.003); }
    p.setValueAtTime(v * 0.35, at + 0.03); p.setTargetAtTime(0, at + 0.031, 0.045);
    n.connect(bp).connect(g).connect(ch[1].input);
  }
  const METAL = [205.3, 304.4, 369.6, 522.7, 540, 800];
  function hat(at, v, open) {
    const len = open ? 0.32 : 0.06, g = ctx.createGain(), hp = filt('highpass', 7200, 0.8), bp = filt('bandpass', 10000, 0.6);
    for (const f of METAL) osc('square', f * 1.6, at, at + len + 0.05).connect(hp);
    const n = noiseAt(at, at + len + 0.05), ng = ctx.createGain(); ng.gain.value = 0.5; n.connect(filt('highpass', 9000)).connect(ng).connect(bp);
    hp.connect(bp).connect(g).connect(ch[2].input);
    g.gain.setValueAtTime(0, at); g.gain.linearRampToValueAtTime(v * 0.5, at + 0.002); g.gain.setTargetAtTime(0, at + 0.004, open ? 0.09 : 0.016);
  }
  function shaker(at, v) {
    const n = noiseAt(at, at + 0.18), bp = filt('bandpass', 5600, 1.1), g = ctx.createGain();
    g.gain.setValueAtTime(0, at); g.gain.linearRampToValueAtTime(v * 0.55, at + 0.012); g.gain.setTargetAtTime(0, at + 0.016, 0.03);
    n.connect(bp).connect(g).connect(ch[3].input);
  }
  function conga(at, v) {
    const o = osc('sine', 230, at, at + 0.4); o.frequency.exponentialRampToValueAtTime(196, at + 0.08);
    const g = env(at, 0.002, v * 0.8, 0.01, 0.07);
    o.connect(g).connect(ch[3].input);
    const n = noiseAt(at, at + 0.03), ng = env(at, 0.001, v * 0.25, 0.002, 0.006);
    n.connect(filt('bandpass', 2400, 1)).connect(ng).connect(ch[3].input);
  }
  function bass(at, midi, dur, v) {
    const f = hz(midi), end = at + dur + 0.4;
    const a = osc('sine', f, at, end), b = osc('sine', f * 2, at, end), bg = ctx.createGain(); bg.gain.value = 0.22;
    const sat = ctx.createWaveShaper(); sat.curve = softCurve(2.2);
    const lp = filt('lowpass', 520, 0.6);
    const g = env(at, 0.006, v, dur, 0.06);
    a.connect(sat); b.connect(bg).connect(sat); sat.connect(lp).connect(g).connect(ch[4].input);
  }
  function chord(at, midis, dur, v) {
    // The dub chord: the filter snaps shut, the echo carries it.
    const end = at + dur + 0.5, lp = filt('lowpass', 3000, 5.5), g = env(at, 0.002, v, Math.max(0.05, dur * 0.6), 0.09);
    const t = held[5];                             // held, the chord stays open longer and higher
    lp.frequency.setValueAtTime((400 + 2800 * v) * (1 + 1.5 * t), at); lp.frequency.setTargetAtTime(380 * (1 + 7 * t), at + 0.004, 0.06 * (1 + 2 * t));
    for (const m of midis) {
      const f = hz(m);
      osc('sawtooth', f, at, end, -6).connect(lp); osc('sawtooth', f, at, end, 7).connect(lp);
      const sq = osc('square', f / 2, at, end), sg = ctx.createGain(); sg.gain.value = 0.35; sq.connect(sg).connect(lp);
    }
    lp.connect(g).connect(ch[5].input);
  }
  function pad(at, midis, dur, v) {
    const end = at + dur + 3.2, lp = filt('lowpass', 1300 * (1 + 2.5 * held[6]), 0.9), g = env(at, 1.3, v, dur, 0.9);
    const lfo = osc('sine', 0.13, at, end), lg = ctx.createGain(); lg.gain.value = 420; lfo.connect(lg).connect(lp.frequency);
    for (const m of midis) for (const d of [-9, 0, 8]) osc('sawtooth', hz(m), at, end, d + (Math.random() - 0.5) * 3).connect(lp);
    lp.connect(g).connect(ch[6].input);
  }
  function bell(at, midi, dur, v) {
    // A soft FM bell, as a DX7's: the tine fades first, the body rings, a slow vibrato after a while.
    const f = hz(midi), end = at + dur + 1.6;
    const car = osc('sine', f, at, end);
    const m1 = osc('sine', f, at, end), i1 = ctx.createGain();
    i1.gain.setValueAtTime(f * 2.2 * v, at); i1.gain.setTargetAtTime(f * 0.35, at + 0.01, 0.35);
    const m2 = osc('sine', f * 14, at, end), i2 = ctx.createGain();
    i2.gain.setValueAtTime(f * 1.4 * v, at); i2.gain.setTargetAtTime(0, at + 0.002, 0.03);
    m1.connect(i1).connect(car.frequency); m2.connect(i2).connect(car.frequency);
    const vib = osc('sine', 5.2, at, end), vg = ctx.createGain(); vg.gain.setValueAtTime(0, at); vg.gain.linearRampToValueAtTime(5, at + 0.6);
    vib.connect(vg).connect(car.detune);
    const g = env(at, 0.004, v, Math.max(0.05, dur), 0.35);
    g.gain.setTargetAtTime(v * 0.6, at + 0.01, 0.6);
    car.connect(g).connect(ch[7].input);
  }

  // THE SWELL into the kick (Marco: *"a swell to the first channel"*): noise rising through a narrowing band from
  // low to high, louder all the way, cut on the kick's first beat — the drop. On the PAD channel, so its echo and
  // space carry it.
  function swellUp(at, dur, v) {
    const end = at + dur, n = noiseAt(at, end + 0.05), bp = filt('bandpass', 250, 1.6), hp = filt('highpass', 120);
    bp.frequency.setValueAtTime(250, at); bp.frequency.exponentialRampToValueAtTime(7500, end);
    bp.Q.setValueAtTime(1.2, at); bp.Q.linearRampToValueAtTime(4, end);
    const g = ctx.createGain(); g.gain.setValueAtTime(0, at); g.gain.linearRampToValueAtTime(v * 3, at + dur * 0.5); g.gain.linearRampToValueAtTime(v * 13, end - 0.01);   // the PAD's trim is low: the swell is lifted past it g.gain.linearRampToValueAtTime(0, end + 0.02);
    n.connect(hp).connect(bp).connect(g).connect(ch[6].input);
  }

  // A note from music.js, at an audio time. `scale` is the part's level then (a part growing in plays soft).
  function play(e, at, scale = 1) {
    const v = Math.max(0, Math.min(1, e.vel * scale)), dur = e.dur * SPB;
    if (v < 0.005) return;
    switch (e.part) {
      case 0: return kick(at, v);
      case 1: return clap(at, v);
      case 2: return hat(at, v, e.kind === 'ohh');
      case 3: return e.kind === 'conga' ? conga(at, v) : shaker(at, v);
      case 4: return bass(at, e.midi, dur, v);
      case 5: return chord(at, e.midi, dur, v);
      case 6: return e.kind === 'swell' ? swellUp(at, dur, v) : pad(at, e.midi, dur, v);
      case 7: return bell(at, e.midi, dur, v);
    }
  }
  function hush(at, over = 0.08) { out.gain.cancelScheduledValues(at); out.gain.setTargetAtTime(0, at, over / 3); }
  function unhush(at) { out.gain.cancelScheduledValues(at); out.gain.setTargetAtTime(1, at, 0.02); }
  return { out, play, apply, hush, unhush, duckAt };
}

// ─── Buffers and curves ─────────────────────────────────────────────────────────────────────────

function softCurve(k) {
  const n = 2048, c = new Float32Array(n);
  for (let i = 0; i < n; i++) { const x = (i / (n - 1)) * 2 - 1; c[i] = Math.tanh(k * x) / Math.tanh(k); }
  return c;
}
// Unity gain at small signals: tanh(kx) / k — rounds the loud, leaves the quiet as it is.
function loopCurve(k) {
  const n = 2048, c = new Float32Array(n);
  for (let i = 0; i < n; i++) { const x = (i / (n - 1)) * 2 - 1; c[i] = Math.tanh(k * x) / k; }
  return c;
}
function noiseBuffer(ctx) {
  const n = Math.floor(ctx.sampleRate * 2), b = ctx.createBuffer(1, n, ctx.sampleRate), d = b.getChannelData(0);
  let s = 22222; for (let i = 0; i < n; i++) { s = (s * 16807) % 2147483647; d[i] = s / 1073741823.5 - 1; }
  return b;
}
// A long, dark hall: noise decaying over `seconds`, darkening as it goes; stereo, each side its own.
function hallImpulse(ctx, seconds) {
  const sr = ctx.sampleRate, n = Math.floor(sr * seconds), buf = ctx.createBuffer(2, n, sr);
  for (let c = 0; c < 2; c++) {
    const d = buf.getChannelData(c);
    let s = 7331 + c * 977, y = 0;
    for (let i = 0; i < n; i++) {
      s = (s * 16807) % 2147483647;
      const t = i / sr, x = (s / 1073741823.5 - 1) * Math.exp(-t * 6.9 / seconds) * Math.min(1, t / 0.04);
      const fc = 9000 * Math.pow(900 / 9000, Math.min(1, t / seconds)), a = Math.exp(-2 * Math.PI * fc / sr);
      y = (1 - a) * x + a * y;
      d[i] = y * 0.8;
    }
  }
  return buf;
}
