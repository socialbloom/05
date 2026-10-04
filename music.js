// WHAT PLAYS AND WHEN, AS ARITHMETIC. There is no sound in this file: the score draws these notes, and
// audio.js hands them to engine.js.
//
// From the reference set (docs/00): Pablo Bolivar's *Recall* — deep melodies over a firm, clean drum
// line; warm chords and pads; dub echo; parts that grow slowly. 120 BPM. Eight channels, channel 1 on
// top (docs/02 §3, Marco: *"8 channels at least!"*):
//   0 KICK · 1 CLAP · 2 HATS · 3 PERC · 4 BASS · 5 CHORDS · 6 PAD · 7 MELODY
//
// A minor, a chord every two bars, from the family the reference set names: minor sevenths and
// ninths.
//
// THE SHAPE (Marco, 2026-10-04: *"it starts quick"*, *"the buildup can be way way longer"*, *"a swell to the first
// channel"*): the song grows by itself. Bars 1–16 the dub chord alone, dark, its colour opening very slowly; the pad
// from 17, soft hats from 25; bars 33–40 the swell, rising into the kick, which drops in on bar 41; then the bass,
// the perc, the clap and the melody, one every eight to sixteen bars, everything open by about bar 96. A swipe
// brings the next entry sooner.
//
// THE HAND. Every change the player makes is written against a bar: what they do now is heard from
// the next bar on, so a change never lands off the beat (docs/01 §6.6). `events(from, to)` reads the
// state that holds for each bar.
//
// A beat is a quarter note. `events(from, to)` is every note that starts in [from, to).

export const BPM = 120;
export const BAR = 4;
const STEP = 0.25;                                // a sixteenth

export const CHANNELS = ['KICK', 'CLAP', 'HATS', 'PERC', 'BASS', 'CHORDS', 'PAD', 'MELODY'];
export const NP = CHANNELS.length;
export const CHORDS_PART = 5;

// The chords: close voicings round C4 for CHORDS, an octave lower for PAD; `root` the bass's note.
export const CH = {
  Am9: { name: 'Am9', v: [60, 64, 67, 71], root: 45 },
  Fmaj7: { name: 'Fmaj7', v: [57, 60, 64, 65], root: 41 },
  Dm9: { name: 'Dm9', v: [60, 64, 65, 69], root: 38 },
  Em7: { name: 'Em7', v: [59, 62, 64, 67], root: 40 },
  Cmaj7: { name: 'Cmaj7', v: [59, 60, 64, 67], root: 48 },
  G6: { name: 'G6', v: [59, 62, 64, 67], root: 43 },
};
// What can follow what — every one fits (docs/01 §6.5). The first is the one the song takes.
const NEXT = {
  Am9: ['Fmaj7', 'Dm9', 'Em7', 'Cmaj7'],
  Fmaj7: ['Am9', 'G6', 'Dm9', 'Em7'],
  Dm9: ['Am9', 'Em7', 'Fmaj7', 'G6'],
  Em7: ['Am9', 'Fmaj7', 'Dm9', 'Cmaj7'],
  Cmaj7: ['Fmaj7', 'Am9', 'Em7', 'Dm9'],
  G6: ['Am9', 'Em7', 'Cmaj7', 'Fmaj7'],
};
const CHORD_BARS = 2;

// The bar each part comes in (0-based: bar 0 is the first). The kick drops in at once; the others grow in over
// eight bars, playing little at first.
const ENTER = [40, 72, 24, 60, 48, 0, 16, 84];
const RAMP = [0, 8, 8, 8, 8, 0, 8, 8];
const SWELL = 8;                                  // bars of swell before the kick
const OPEN_BY = 96;                               // the bar the colours are fully open by
let enter = ENTER.slice(), swell = { from: ENTER[0] - SWELL, bars: SWELL };
export const swellOf = () => ({ ...swell });
export const enterOf = (p) => enter[p];

// ─── The state, by bar ──────────────────────────────────────────────────────────────────────────

const fresh = () => ({
  more: [0.5, 0.3, 0.35, 0.3, 0.3, 0.3, 0.3, 0.3],
  down: null,                                     // the breakdown: the bar it began, while held
});
let history = [{ bar: 0, s: fresh() }];           // [{ bar, s }] — the state from that bar on
const chordPick = new Map();                      // chord-change bar → the chord chosen there

export function reset() { history = [{ bar: 0, s: fresh() }]; chordPick.clear(); enter = ENTER.slice(); swell = { from: ENTER[0] - SWELL, bars: SWELL }; }
function stateAt(bar) { let s = history[0].s; for (const h of history) if (h.bar <= bar) s = h.s; return s; }
const nextBar = (beat) => Math.floor(beat / BAR + 1e-6) + 1;
// A change from the next bar on: copies the state there, lets `f` change it, keeps the later ones in step.
function change(beat, f) {
  const bar = nextBar(beat);
  history = history.filter((h) => h.bar <= bar);
  const base = stateAt(bar), s = { ...base, more: base.more.slice() };
  f(s, bar);
  if (history[history.length - 1].bar === bar) history[history.length - 1].s = s; else history.push({ bar, s });
  return bar;
}

// ─── What the hand does ─────────────────────────────────────────────────────────────────────────

// MORE OR LESS (one finger, up and down): a part's density, 0–1, from the next bar.
export function setMore(part, v, beat) { change(beat, (s) => { s.more[part] = Math.max(0, Math.min(1, v)); }); }
export const moreOf = (part, beat) => stateAt(nextBar(beat)).more[part];

// THE NEXT SECTION, sooner (Marco: *"make the next section a slow growth"*): the next part to come in comes in from
// the next bar, growing in as it would have. The kick keeps a short swell of four bars before it. Returns the part, or
// null when everything is in.
export function grow(beat) {
  const nb = nextBar(beat);
  let part = null;
  for (let p = 0; p < NP; p++) if (enter[p] >= nb && (part == null || enter[p] < enter[part])) part = p;
  if (part == null) return null;
  if (part === 0) { if (swell.from < nb) return null; swell = { from: nb, bars: 4 }; enter[0] = nb + 4; }   // into the swell, shorter
  else enter[part] = nb;
  return part;
}

// THE BREAKDOWN: held, the parts thin out from the drums up, a bar each; let go, all back on the one.
export function breakdown(beat) { change(beat, (s, bar) => { s.down = bar; }); }
export function drop(beat) { change(beat, (s) => { s.down = null; }); }

// THE NEXT CHORD: the choices at the next change, and a pick.
export function chordOfBar(bar) {
  let c = 'Am9';
  for (let b = CHORD_BARS; b <= bar; b += CHORD_BARS) c = chordPick.get(b) ?? NEXT[c][0];
  return CH[c];
}
export function nextChange(beat) { return (Math.floor(beat / BAR / CHORD_BARS) + 1) * CHORD_BARS; }
export function choicesAt(bar) { const prev = chordOfBar(bar - 1).name; return NEXT[prev].map((n) => CH[n]); }
export function pickChord(bar, name) { chordPick.set(bar, name); }
export const pickedAt = (bar) => chordPick.get(bar) ?? null;

// ─── How loud each part is, 0–1 — for the score's light, as a meter would read it ───────────────

const rampOf = (p, b) => (RAMP[p] ? Math.min(1, 0.15 + Math.max(0, b - enter[p]) / RAMP[p]) : 1);
export function levelOf(part, beat) {
  const bar = Math.floor(beat / BAR), s = stateAt(bar);
  if (bar < enter[part] || thinned(s, part, bar)) return 0;
  return 0.85 * rampOf(part, beat / BAR);
}
// THE SONG'S OWN COLOUR, 0–1, by which the hand's colour is heard: dark at the start, opening very slowly; the
// swell opens it fast; after the kick it goes on opening, fully open by OPEN_BY.
export function openAt(beat) {
  const b = beat / BAR, k = enter[0];
  if (b < swell.from) return 0.12 + 0.38 * Math.max(0, b) / Math.max(1, swell.from);
  if (b < k) return 0.5 + 0.4 * (b - swell.from) / swell.bars;
  return Math.min(1, 0.62 + 0.38 * (b - k) / Math.max(1, OPEN_BY - k));
}
// THE SWELL's rise, 0–1, on the chords and the pad — the song's own hold, let go on the kick.
export function swellAt(beat) { const b = beat / BAR; return b >= swell.from && b < enter[0] ? (b - swell.from) / swell.bars : 0; }

// The breakdown takes the drums first, then the bass and the melody; the chords and the pad stay.
const THIN = [0, 2, 1, 3, 4, 7];
function thinned(s, part, bar) { if (s.down == null) return false; const k = THIN.indexOf(part); return k >= 0 && bar - s.down >= Math.floor(k / 2); }
export const isOn = (part, beat) => levelOf(part, beat) > 0;

// ─── The notes ──────────────────────────────────────────────────────────────────────────────────

export function rng(seed) { let x = seed >>> 0 || 1; return () => ((x = (x * 16807) % 2147483647) / 2147483647); }

function barOf(bar) {
  const s = stateAt(bar), ch = chordOfBar(bar), next = chordOfBar(bar + 1), out = [];
  const add = (part, step, midi, dur, vel, kind) => out.push({ part, at: step * STEP, midi, dur, vel, kind });
  const plays = (p) => bar >= enter[p] && !thinned(s, p, bar);
  const growing = (p) => rampOf(p, bar + 1);
  const m = (p) => s.more[p] * growing(p);        // a part coming in plays little, then more
  const r = rng(bar * 7919 + 11);

  if (bar === swell.from) out.push({ part: 6, at: 0, midi: 0, dur: swell.bars * BAR, vel: 0.8, kind: 'swell' });   // the swell, rising into the kick
  if (plays(0)) {                                 // KICK — four on the floor; less: one and three; more: a pickup
    const k = m(0);
    for (const st of k < 0.25 ? [0, 8] : [0, 4, 8, 12]) add(0, st, 0, 0.25, 0.9, 'kick');
    if (k > 0.75 && bar % 2) add(0, 14, 0, 0.25, 0.5, 'kick');
  }
  if (plays(1)) {                                 // CLAP — a soft rim on two and four, more: a ghost before four
    add(1, 4, 0, 0.25, 0.7, 'clap'); add(1, 12, 0, 0.25, 0.7, 'clap');
    if (m(1) > 0.5) add(1, 11, 0, 0.25, 0.35, 'clap');
    if (m(1) > 0.8 && bar % 4 === 3) add(1, 15, 0, 0.25, 0.4, 'clap');
  }
  if (plays(2)) {                                 // HATS — the off-beats; more: eighths, then sixteenths
    const k = m(2);
    for (let st = 0; st < 16; st++) {
      const off = st % 4 === 2, eighth = st % 2 === 0, six = true;
      if (off || (k > 0.45 && eighth) || (k > 0.8 && six)) add(2, st, 0, 0.25, off ? 0.8 : 0.45, off ? 'ohh' : 'chh');
    }
  }
  if (plays(3)) {                                 // PERC — a shaker that thickens, a conga now and then
    const k = m(3);
    for (let st = 0; st < 16; st++) if (r() < 0.15 + 0.7 * k && (st % 2 === 1 || k > 0.6)) add(3, st, 0, 0.25, 0.5, 'shaker');
    if (k > 0.3) for (const st of [3, 10]) if (r() < k) add(3, st, 0, 0.25, 0.6, 'conga');
  }
  if (plays(4)) {                                 // BASS — the root held; more: off-beat pulses; most: a line that walks
    const k = m(4), root = ch.root;
    if (k < 0.3) add(4, 0, root, 3.5, 0.8);
    else if (k < 0.7) for (const st of [2, 6, 10, 14]) add(4, st, root, 0.4, 0.8);
    else {
      const line = [0, 0, 7, 12, 10, 7, 3, next.root - root];
      line.forEach((n, i) => add(4, i * 2, root + n, 0.45, i % 2 ? 0.7 : 0.85));
    }
  }
  if (plays(5)) {                                 // CHORDS — the dub chord, a stab on the off-beat; more: a pattern
    const k = m(5);
    const hits = k < 0.3 ? [2] : k < 0.65 ? [2, 10] : [2, 6, 10, 13];
    for (const st of hits) add(5, st, ch.v, 0.4, 0.75);
  }
  if (plays(6) && bar % 2 === 0) {                // PAD — the chord held over the two bars; more: struck again
    const vs = ch.v.map((x) => x - 12);
    if (m(6) < 0.6) add(6, 0, vs, 8, 0.55); else { add(6, 0, vs, 4, 0.55); add(6, 0, vs, 4, 0.5); out[out.length - 1].at = 4; }
  }
  if (plays(7)) {                                 // MELODY — one simple line from the chord's notes, a step at a time
    const k = m(7), tones = [...ch.v.map((x) => x + 12)], n = k < 0.3 ? 2 : k < 0.7 ? 4 : 7;
    const steps = [0, 6, 10, 3, 8, 12, 14].slice(0, n).sort((a, b) => a - b);
    steps.forEach((st, i) => add(7, st, tones[(i + bar) % tones.length], i === steps.length - 1 ? 16 - st : steps[i + 1] - st, 0.7));
  }
  return out;
}

// Every note that starts in [from, to): { part, kind, beat, dur, midi (a number, or an array for a chord), vel }.
export function events(from, to) {
  const out = [];
  for (let bar = Math.max(0, Math.floor(from / BAR)); bar < Math.ceil(to / BAR); bar++) {
    for (const n of barOf(bar)) {
      const beat = bar * BAR + n.at;
      if (beat < from || beat >= to) continue;
      out.push({ ...n, beat });
    }
  }
  return out.sort((a, b) => a.beat - b.beat);
}
