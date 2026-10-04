// instrument-design-05 — THE SCORE. Copied from instrument-design-04's score.js on 2026-10-04 for 05's
// specimen (docs/01, docs/02): 04's lit score on a phone. What changed from 04 is marked `05:`:
//
//   · EIGHT STAFFS (docs/02 §3): KICK · CLAP · HATS · PERC · BASS · CHORDS · PAD · MELODY.
//   · SWITCHING ON (docs/02 §1–§2, Marco: *"the device switching on"*): a red standby light in the dark;
//     tapped, green, a light runs down the staffs, the names come on one by one, everything settles.
//   · THE CAMERA PLAYED BY HAND (docs/01 §5): it turns round the score, glides on after the finger and
//     slows to a stop; pinch, two fingers move it, double-tap the next shot, the phone's tilt leans it;
//     left alone in CAMERA it drifts on.
//   · WHAT THE HAND DOES TO A PART, SEEN (docs/01 §6.6): colour warms and brightens its light; drive
//     makes it glow hotter; echo trails copies behind each note; space softens and widens the light;
//     hold raises it. A selected staff in full light, the others dimmed.
//   · THE NEXT CHORDS (docs/02 §8): faint chords on the CHORDS staff in the coming bar, side by side.
//
// It opens no sound and reads no device: it draws what it is given. 04's header follows, for what
// the rest of the file is.
//
// ─── API ─────────────────────────────────────────────────────────────────────────────────────────
//
//   const score = createScore({ canvas })
//   score.frame(view, dt)   score.resize(w, h)   score.pick(x, y)   score.dispose()
//   score.screenOf(what)    → { x, y, visible } — 'led', or { choice: i }: where to tap
//   score.orbit(dx, dy) · score.pinch(k) · score.pan(dx, dy) · score.fling(vx, vy) · score.touched()
//
//   view, beyond 04's: boot (seconds since the standby light was tapped; null — standby), camMode,
//   shot (0 the music's camera, 1 above, 2 close on the selected staff, 3 low along the page),
//   tilt { x, y } −1…1, colour/drive/echo/space/tension [8] 0–1, focus + selected, choices
//   { beat, chords: [[midi]], picked }.
//
import * as THREE from './vendor/three/three.module.js';

// ─── The page, in staff spaces ───────────────────────────────────────────────────────────────────

const BAR = 16, SYS = 8 * BAR;                   // beats: a bar of sixteenths; the staff is drawn eight bars at a time
const ZB = 1.5;                                  // staff spaces of paper per beat
const MARGIN = 19;                               // before the first bar: a gap, the names, the clefs
const ECHO_EVERY = 3;                            // the dub delay: a dotted eighth, three sixteenths
const ECHO_KEEP = 0.45;                          // each repeat's share of the last — the feedback (03: view.repeats when given)
const REINK = 0.6;                               // seconds for old coming notes to fade, new to appear
const PHRASE = 32;                               // beats: the vamp's chord, and the longest slur

// Top of the page first. `top` is the u of the staff's top line; u grows up the page.
// 05: EIGHT STAFFS, channel 1 on top (docs/02 §3): 0 KICK · 1 CLAP · 2 HATS · 3 PERC · 4 BASS ·
// 5 CHORDS · 6 PAD · 7 MELODY.
const NP = 8;
const KIND = ['drum', 'drum', 'drum', 'drum', 'pitch', 'chord', 'chord', 'pitch'];
const PITCHED = (part) => KIND[part] !== 'drum';
const STAVES = [
  { name: 'KICK', short: 'KICK', clef: 'perc', parts: [0], top: 0 },
  { name: 'CLAP', short: 'CLAP', clef: 'perc', parts: [1], top: -8.5 },
  { name: 'HATS', short: 'HATS', clef: 'perc', parts: [2], top: -17 },
  { name: 'PERC', short: 'PERC', clef: 'perc', parts: [3], top: -25.5 },
  { name: 'BASS', short: 'BASS', clef: 'bass', parts: [4], top: -35.5 },
  { name: 'CHORDS', short: 'CHD', clef: 'treble', parts: [5], top: -47.5 },
  { name: 'PAD', short: 'PAD', clef: 'bass', parts: [6], top: -58.5 },
  { name: 'MELODY', short: 'MEL', clef: 'treble', parts: [7], top: -69.5 },
];
const MELODY = 7;                                  // 05: the staff that is phrased under slurs
const STAFF_OF = Array.from({ length: NP }, (_, p) => STAVES.findIndex((st) => st.parts.includes(p)));
const LAST = STAVES.length - 1;
const isDrum = (s) => STAVES[s].clef === 'perc';
// Where a stroke sits on its drum staff, by what it is; the cymbals and the shaker as an x.
const DRUM_POS = { kick: 3, clap: 4, chh: 6, ohh: 6, shaker: 8, conga: 3, crash: 9 };
const DRUM_X = new Set(['chh', 'ohh', 'shaker', 'crash']);
const U_TOP = 7, U_BOT = -80, U0 = (U_TOP + U_BOT) / 2;
const WIDE = (U_TOP - U_BOT) / 57;                // 04: the page against 03's five staffs — cameras and shots scale by it
const posU = (s, pos) => STAVES[s].top - 4 + pos * 0.5;   // pos 0 is the bottom line, 8 the top

// 03: ONE CONTINUOUS STAFF (Marco, 2026-10-01): no system breaks — the names and clefs stand once,
// before the first bar, and the paper runs on unbroken, so the camera never jumps a margin.
const P = (t) => MARGIN + t * ZB;                        // the paper under a beat
const lineStart = (k) => (k === 0 ? 9 : P(k * SYS) - 1.02);   // eight bars of staff, each meeting the last
const barEndP = (b) => P((b + 1) * BAR) - 1.1;
const beatOf = (p) => Math.max(0, (p - MARGIN) / ZB);

// The camera's place on the paper: `now`.
const smooth = (x) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));
const easeIO = (x) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * x * (x * (6 * x - 15) + 10));   // slow in, slow out
const camP = (now) => P(now);

// ─── Pitch to the staff ──────────────────────────────────────────────────────────────────────────

const LET = [0, 0, 1, 2, 2, 3, 3, 4, 5, 5, 6, 6], ALT = [0, 1, 0, -1, 0, 0, 1, 0, -1, 0, -1, 0];
const pc = (m) => ((m % 12) + 12) % 12;
const midiOf = (f) => Math.round(69 + 12 * Math.log2(f / 440));
const diaOf = (m) => Math.floor(m / 12) * 7 + LET[pc(m)];
const BOTTOM = { treble: diaOf(64), bass: diaOf(43) };  // E4 and G2 on the bottom lines
function head(s, m, part, small) {
  const dia = diaOf(m);
  return { pos: dia - BOTTOM[STAVES[s].clef], dia, alter: ALT[pc(m)], m, part, small, x: false };
}

// ─── Notation: note values, ties, rests ──────────────────────────────────────────────────────────

// The value that starts at `l` (sixteenths into the bar) and fits before `end`. A dotted value only
// when it ends the note exactly; a plain one only on its own grid, so beat 3 is always shown.
function valueAt(l, end) {
  for (const v of [16, 12, 8, 6, 4, 3, 2, 1]) {
    const dotted = v === 12 || v === 6 || v === 3;
    if (dotted ? l + v === end && l % (v / 3) === 0 : l % v === 0 && l + v <= end) return v;
  }
  return 1;
}
function restsIn(l, end) {
  const out = [];
  while (l < end) { const v = [16, 8, 4, 2, 1].find((x) => l % x === 0 && l + x <= end); out.push({ l, v }); l += v; }
  return out;
}
function split(t, n) {
  const out = []; let cur = t; const end = t + n;
  while (cur < end) {
    const b = Math.floor(cur / BAR), bEnd = Math.min(end, (b + 1) * BAR);
    let l = cur - b * BAR; const le = bEnd - b * BAR;
    while (l < le) { const v = valueAt(l, le); out.push({ t: b * BAR + l, v, bar: b }); l += v; }
    cur = bEnd;
  }
  return out;
}
// How long a note is written: what is played, to the eighth; the melody to its next step (legato);
// a drum to the next stroke, at most a quarter; never past the next note on the staff.
function notated(s, c, nextT) {
  let n = isDrum(s) ? 4 : s === MELODY ? Math.round(c.len / 0.95) : Math.round(c.len / 2) * 2;
  n = Math.min(Math.max(1, n), nextT - c.t);
  return Math.max(1, n);
}
const stemUp = (lo, hi) => { const a = hi - 4, b = 4 - lo; return a > b ? false : a < b ? true : hi < 4; };

// ─── How a part's light moves ────────────────────────────────────────────────────────────────────

// ts: seconds since the note began; dur: its length in seconds; fade: the glow's time after it.
// 05: by channel — the melody swells, the bass plucks, the chords strike, the pad swells slowly.
function envelope(part, ts, dur, fade) {
  const hold = (end, a, after) => (ts < end ? a(ts) : a(end) * Math.exp(-(ts - end) / after));
  switch (part) {
    case 7: return hold(dur * 0.9, (x) => 1 - Math.exp(-x / 0.12), Math.max(0.9, fade));
    case 4: return hold(dur * 0.75, (x) => 1 - Math.exp(-x / 0.02), Math.max(0.18, fade * 0.7));
    case 5: return hold(dur, (x) => 0.45 + 0.55 * Math.exp(-x / 0.6), Math.max(0.5, fade));
    case 6: return hold(dur, (x) => 1 - Math.exp(-x / 0.6), Math.max(0.8, fade));
    case 0: return Math.exp(-ts / 0.16);
    case 1: case 2: case 3: return Math.exp(-ts / 0.09);
    default: return Math.exp(-ts / 0.06);
  }
}

// ─── Colours ─────────────────────────────────────────────────────────────────────────────────────

const DARK = new THREE.Color('#000000');         // the space: full black (Marco, 2026-10-04; was #061012, faintly teal)
const PAPER = new THREE.Color('#e8dcc2');
const INK = new THREE.Color('#141210');
const GREY = new THREE.Color('#a29c90');         // muted ink
const NAME_LIT = new THREE.Color('#b8520f');     // the selected staff's name, lit
const SHORT_INK = INK.clone().lerp(PAPER, 0.4);  // 03: the short names every eight bars, faint
const LAMP_OPEN = new THREE.Color('#ffc27a'), LAMP_SHUT = new THREE.Color('#ff4a10');
const LAMP_KIT = new THREE.Color('#ffb46a');
const HOT = new THREE.Color('#fff2dc');           // 05: drive — the light running hot     // the kit and the vinyl: one warm light, unfiltered
// 03: one colour per voice, not too dominant — each part's lamp turned a third of the way to its
// voice's colour (music.js INPUTS): melody, bass, keys, pad, kick, rim, hats, room.
// 04: the nine channels' colours, as music.js CHANNELS has them.
const VOICE = ['#e3cf98', '#e6c0a0', '#a8cfe0', '#b9d3b0', '#8cc4bb', '#d9a3b4', '#a9a3d6', '#f0d0d8'].map((c) => new THREE.Color(c));
const TINT = 0.38;

// ─── Glyphs drawn as pictures: clefs, rests, accidentals, flags, figures, names ───────────────────

const SYMBOLS = "'Apple Symbols', 'Noto Music', 'Bravura Text', 'Segoe UI Symbol', serif";
const HELV = "'Helvetica Neue', Helvetica, Arial, sans-serif";
const SERIF = "'Iowan Old Style', Palatino, Georgia, 'Times New Roman', serif";

// Draws into a large canvas, finds the ink, crops it with a margin. The size on the page comes from
// the ink, not the font's metrics, so a clef sits where engraving puts it whatever the font.
function inked(draw) {
  const W = draw.W || 512, H = draw.H || 640, c = document.createElement('canvas'); c.width = W; c.height = H;   // a drawing may ask for a larger canvas
  const g = c.getContext('2d'); g.fillStyle = '#fff'; g.strokeStyle = '#fff';
  draw(g, W, H);
  const d = g.getImageData(0, 0, W, H).data;
  let x0 = W, y0 = H, x1 = -1, y1 = -1;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (d[(y * W + x) * 4 + 3] > 40) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  }
  if (x1 < 0) return null;
  const pad = 6, w = x1 - x0 + 1 + 2 * pad, h = y1 - y0 + 1 + 2 * pad;
  const o = document.createElement('canvas'); o.width = w; o.height = h;
  o.getContext('2d').drawImage(c, x0 - pad, y0 - pad, w, h, 0, 0, w, h);
  return { canvas: o, inkW: x1 - x0 + 1, inkH: y1 - y0 + 1, pad };
}
// A weight goes before the size in a canvas font ('600 200px serif'); written after it ('200px 600 serif') the whole
// font was refused and the canvas drew in its 10 px default — the names were 21 px high (found 2026-10-03).
const fontOf = (font, size) => { const m = font.match(/^(bold|\d{3})\s+(.*)$/); return m ? `${m[1]} ${size}px ${m[2]}` : `${size}px ${font}`; };
const text = (s, font, size = 300) => (g, W, H) => { g.font = fontOf(font, size); g.textBaseline = 'alphabetic'; g.fillText(s, 60, H - 170); };
// The channel names, drawn twice as large so they stay sharp lit at an angle (Marco, 2026-10-03: *"you judge"*).
const bigText = (s, font, size) => Object.assign(text(s, font, size), { W: 2048, H: 900 });
// A font with no such glyph draws a box: compared with an unassigned code point, it is left out
// rather than drawn as a box.
function symbol(ch, font) {
  const a = inked(text(ch, font)), b = inked(text('\u0378', font));
  if (!a) return null;
  if (b && Math.abs(a.inkW - b.inkW) <= 2 && Math.abs(a.inkH - b.inkH) <= 2) return null;
  return text(ch, font);
}
// Rests, drawn as engraved, because few system fonts carry them (Apple Symbols draws a box).
const stroke = (g, w, pts) => { g.lineWidth = w; g.beginPath(); g.moveTo(...pts[0]); for (const p of pts.slice(1)) g.lineTo(...p); g.stroke(); };
function restQuarter(g) {
  g.lineCap = 'round'; g.lineJoin = 'round';
  stroke(g, 20, [[92, 40], [172, 160]]);
  stroke(g, 46, [[166, 158], [104, 256]]);
  stroke(g, 20, [[104, 256], [178, 370]]);
  g.lineWidth = 26; g.beginPath(); g.moveTo(178, 370); g.bezierCurveTo(118, 334, 64, 392, 134, 482); g.stroke();
}
function restFlagged(n) {
  return (g) => {
    g.lineCap = 'round';
    const top = [196, 40], step = [-26, 132];
    stroke(g, 16, [top, [top[0] + step[0] * n - 30, top[1] + step[1] * n + 150]]);
    for (let i = 0; i < n; i++) {
      const x = top[0] + step[0] * i, y = top[1] + step[1] * i;
      g.beginPath(); g.arc(x - 104, y + 22, 30, 0, Math.PI * 2); g.fill();
      g.lineWidth = 14; g.beginPath(); g.moveTo(x - 100, y + 48); g.quadraticCurveTo(x - 40, y + 64, x, y); g.stroke();
    }
  };
}
function flag(down) {
  return (g, W, H) => {
    if (down) { g.translate(0, H); g.scale(1, -1); }
    g.beginPath(); g.moveTo(40, 40);
    g.bezierCurveTo(46, 150, 210, 200, 178, 420);
    g.bezierCurveTo(226, 250, 110, 200, 40, 170);
    g.closePath(); g.fill();
  };
}

// ─── The score ───────────────────────────────────────────────────────────────────────────────────

export function createScore({ canvas }) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;

  const scene = new THREE.Scene();
  scene.background = DARK.clone();
  scene.fog = new THREE.Fog(DARK.clone(), 60, 300);
  const camera = new THREE.PerspectiveCamera(50, 1, 0.5, 3000);
  let W = 1, H = 1;
  let CP = 0;                                     // the camera's place on the paper, this frame
  let keyT = 0; const KEY_IN = 3;                   // the key light's slow, eased coming-in
  let holdAmt = 1;                                 // the steeper launch camera, 1 until the first PLAY, then gliding to 0
  const eyeH = new THREE.Vector3(), atH = new THREE.Vector3(), qH = new THREE.Quaternion();
  let focusAmt = 0, focusX = null;                 // 04: the camera's focus on one staff, 0–1, and where

  // The GPU timer (see the frame): one query in flight at a time, its result read when ready.
  const glc = renderer.getContext(), gpuExt = glc.getExtension('EXT_disjoint_timer_query_webgl2');
  let gpuQ = null, gpuWait = null, gpuMs = null;
  const gpuBegin = () => { if (!gpuExt || gpuWait) return; gpuQ = glc.createQuery(); glc.beginQuery(gpuExt.TIME_ELAPSED_EXT, gpuQ); };
  const gpuEnd = () => {
    if (gpuQ) { glc.endQuery(gpuExt.TIME_ELAPSED_EXT); gpuWait = gpuQ; gpuQ = null; return; }
    if (!gpuWait || !glc.getQueryParameter(gpuWait, glc.QUERY_RESULT_AVAILABLE)) return;
    if (!glc.getParameter(gpuExt.GPU_DISJOINT_EXT)) { const ms = glc.getQueryParameter(gpuWait, glc.QUERY_RESULT) / 1e6; gpuMs = gpuMs == null ? ms : gpuMs * 0.9 + ms * 0.1; }
    glc.deleteQuery(gpuWait); gpuWait = null;
  };
  const disposables = [];
  const keep = (x) => { disposables.push(x); return x; };

  // Light and dark: one warm light over the page, a pool of small lamps. (The fill deleted — Marco, 2026-10-03.)
  const key = new THREE.SpotLight(0xffd4a0, 3.0, 0, 0.62, 0.85, 0);
  key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024);   // 03: was 2048 — the main cost, per the audit
  key.shadow.bias = -0.0004; key.shadow.normalBias = 0.03; key.shadow.radius = 2.5;
  key.shadow.camera.near = 20; key.shadow.camera.far = 900;
  scene.add(key, key.target);
  // 05: THE STANDBY LIGHT (docs/02 §1): a small round lamp set into the page above the first staff — red,
  // steady, in standby; green once switched on.
  const led = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 0.3, 28), new THREE.MeshBasicMaterial({ color: 0xff2a1a, toneMapped: false }));
  keep(led.geometry); keep(led.material); scene.add(led);
  const LED_P = 4.2, LED_U = 4.6;                 // on the paper: before the staffs, above KICK
  const LED_RED = new THREE.Color(0xff2a1a), LED_GREEN = new THREE.Color(0x2aff6a);
  // 05: only the score's edge caught faintly in the dark (docs/02 §1): a dim cool light from the far side, low.
  const edge = new THREE.DirectionalLight(0x8ea4c4, 0);
  scene.add(edge, edge.target);
  // 03: the balls — one per staff, a small bright sphere; its halo is a glow like a lit head's.
  const ballGeo = keep(new THREE.SphereGeometry(0.42, 20, 14));
  const balls = STAVES.map(() => { const m = new THREE.Mesh(ballGeo, keep(new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false }))); m.visible = false; scene.add(m); return m; });
  const ballAt = STAVES.map(() => ({ p: 0, u: 0, h: 0, init: false }));
  // 03: Marco's camera on top of the music's — WASD and a drag, gliding back sixty seconds after.
  // 05: the hand's camera — turned (yaw, pitch, and their glide), closer or further (dist, in powers of two), moved (px, pz).
  const user = { yaw: 0, pitch: 0, vyaw: 0, vpitch: 0, dist: 0, px: 0, pz: 0, idle: 0, drift: 0, touching: false };
  const tiltS = { x: 0, y: 0 }, pivot = new THREE.Vector3(), qYaw = new THREE.Quaternion(), qPitch = new THREE.Quaternion(), qOrbit = new THREE.Quaternion();
  const atN = new THREE.Vector3(), eyeN = new THREE.Vector3(), _sa = new THREE.Vector3(), _se = new THREE.Vector3();
  const shotPos = new THREE.Vector3(), shotQ = new THREE.Quaternion(); let shotW = 0, shotFresh = true;
  const choicePos = [];                           // 05: where each offered chord is drawn, for the tap
  const _fwd = new THREE.Vector3(), _right = new THREE.Vector3(), _up = new THREE.Vector3(0, 1, 0);
  let revealT = 0;
  const REVEAL_WAIT = 0.6, REVEAL_S = 4;   // seconds of dark, then of the light coming up
  const LAMPS = 4;                                // was 8 — the GPU (Marco, 2026-10-03: *"do 3 and 4"*)
  const lamps = Array.from({ length: LAMPS }, () => { const l = new THREE.PointLight(0xffb870, 0, 24, 1.4); scene.add(l); return l; });   // Marco: *"make them worth seeing"* — was 11 reach, decay 2
  // THE LIGHT DESIGN (docs/01 §45, Marco 2026-10-03: *"every track gets its own spotlight"*): a spot per
  // staff, straight above it at now, pointing straight down, its pool on the notes being played, all one
  // white; no shadows — only the key light casts them.
  // Drawn, not lit (Marco, 2026-10-03: *"do 3 and 4"* — the GPU): each spot is a soft round pool painted on the
  // paper, added light, one colour for all nine; it brightens the paper, not the note heads. Nine lights fewer.
  const poolTex = (() => {
    const N = 128, c = document.createElement('canvas'); c.width = c.height = N;
    const g = c.getContext('2d'), gr = g.createRadialGradient(N / 2, N / 2, 0, N / 2, N / 2, N / 2);
    gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.55, 'rgba(255,255,255,0.85)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.fillRect(0, 0, N, N);
    return keep(new THREE.CanvasTexture(c));
  })();
  const poolGeo = keep(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2));
  const spots = STAVES.map(() => {
    const m = new THREE.Mesh(poolGeo, keep(new THREE.MeshBasicMaterial({ map: poolTex, color: 0xfff4e6, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false })));
    m.renderOrder = 1; m.frustumCulled = false; scene.add(m);
    return m;
  });
  const spotLv = STAVES.map(() => 0);
  // THE MIRROR BALL (Marco, 2026-10-03: *"what about disco lights?"* … *"build both but separate lights"*): one
  // light high over the page throwing a field of small white spots — a projected pattern — that drifts slowly
  // round, as a turning ball does. It casts the notes' shadows too; one small shadow map.
  const ballTex = (() => {
    const N = 512, c = document.createElement('canvas'); c.width = c.height = N;
    const g = c.getContext('2d'); g.fillStyle = '#000'; g.fillRect(0, 0, N, N);
    let sd = 4242; const rnd = () => ((sd = (sd * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < 260; i++) {
      const x = rnd() * N, y = rnd() * N, r = 2.5 + rnd() * 3.5, gr = g.createRadialGradient(x, y, 0, x, y, r);
      gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.6, 'rgba(255,255,255,0.8)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = gr; g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
    }
    return keep(new THREE.CanvasTexture(c));
  })();
  const mirror = new THREE.SpotLight(0xf4f6ff, 0, 0, 0.75, 0, 0);
  mirror.map = ballTex; mirror.castShadow = true; mirror.shadow.mapSize.set(512, 512);
  mirror.shadow.camera.near = 20; mirror.shadow.camera.far = 400;
  scene.add(mirror, mirror.target);
  // THE DISCO LIGHTS, redesigned (Marco, 2026-10-03: *"too nervous"* … *"yes build it"*): four coloured pools —
  // red, blue, green, magenta — drawn on the paper like the track spots (no lights), gliding on long smooth paths,
  // one sweep in four bars, mixing where they cross; they swell gently over each bar; stopped, they drift slower.
  let discoT = 0;
  const DISCO = [0xff3355, 0x3366ff, 0x33ff99, 0xff33ff].map((c) => {
    const m = new THREE.Mesh(poolGeo, keep(new THREE.MeshBasicMaterial({ map: poolTex, color: c, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false })));
    m.renderOrder = 2; m.frustumCulled = false; scene.add(m);
    return m;
  });
  // THE BACK LIGHT (Marco, 2026-10-03: *"the backlite like on a macbook pro keyboard. I want the notes on the score
  // to light up like they are back lit"*): every note, stem, beam and rest glows from within, one warm white, the
  // paper as it is. (It had been a cool light from the far end.)
  // Marco: *"not full notes are displayed - they are too bright - the colour must be more towards blue - its a night
  // light type of light"*: every part of a note, a soft night-light blue, dimmer (was warm white at 0.8).
  const BACKLIT = new THREE.Color(0x7fa6ff), BACKLIT_LEVEL = 0.32;
  const CLEF_LIT = new THREE.Color(0xffd040), CLEF_LEVEL = 0.45,   // was 0.75 (Marco: *"less bright"*)
  _cg = new THREE.Color();   // the clefs: yellow
  const NAME_LIT = new THREE.Color(0x4fe08a), _ng = new THREE.Color();   // the channel names: green
  const TITLE_LIT = new THREE.Color(0xf0ebe1), _tg = new THREE.Color();  // 05: the title, warm white
  const lightsOn = { spots: 0, key: 0, back: 1, lamps: 0, ball: 0, disco: 0 };   // the LIGHTS menu, each faded; as the page opens
  const LIGHT_FADE = { spots: 0.3, key: 1.2, back: 0.3, lamps: 0.3, ball: 0.5, disco: 0.3 };   // the key light comes up slowly (Marco, 2026-10-03)

  // The glow patch: an instanced colour of light, added to what a surface emits.
  const glowing = (mat, topOnly = false) => {      // topOnly: a stacked picture glows on its top layer alone (aTop)
    mat.onBeforeCompile = (sh) => {
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nattribute vec3 aGlow;\nvarying vec3 vGlow;' + (topOnly ? '\nattribute float aTop;' : ''))
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvGlow = aGlow' + (topOnly ? ' * aTop' : '') + ';');
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vGlow;')
        .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += vGlow;');
    };
    return keep(mat);
  };
  const inkMat = glowing(new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.68, metalness: 0 }));

  // ── the paper: a long sheet with a grain, moved with the camera
  const grainTex = (() => {
    const N = 256, c = document.createElement('canvas'); c.width = c.height = N;
    const g = c.getContext('2d'), img = g.createImageData(N, N);
    let s = 91;
    const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < N * N; i++) { const v = 150 + rnd() * 105; img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = v; img.data[i * 4 + 3] = 255; }
    g.putImageData(img, 0, 0);
    g.globalAlpha = 0.18; g.strokeStyle = '#000'; g.lineWidth = 0.7;
    for (let i = 0; i < 70; i++) { const x = rnd() * N, y = rnd() * N, a = rnd() * Math.PI, l = 6 + rnd() * 22; g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l); g.stroke(); }
    const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8;
    return keep(t);
  })();
  const paperU = { uPage: { value: new THREE.Vector4() }, uGrain: { value: 0.5 }, tGrain: { value: grainTex } };
  const paperMat = keep(new THREE.MeshStandardMaterial({ color: PAPER, roughness: 0.93, metalness: 0 }));
  paperMat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, paperU);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nuniform vec4 uPage;\nvarying vec2 vPage;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvPage = vec2(uPage.x + position.x * uPage.y, uPage.z + position.y * uPage.w);');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uGrain;\nuniform sampler2D tGrain;\nvarying vec2 vPage;')
      .replace('#include <map_fragment>', '#include <map_fragment>\nfloat gr = texture2D(tGrain, vPage / 18.0).r * 0.6 + texture2D(tGrain, vPage / 4.5).r * 0.4;\ndiffuseColor.rgb *= mix(1.0, 0.62 + 0.52 * gr, uGrain);');
  };
  const paperGeo = keep(new THREE.BoxGeometry(1, 1, 1).translate(0.5, 0.5, 0.5));
  const paper = new THREE.Mesh(paperGeo, paperMat);
  paper.matrixAutoUpdate = false; paper.receiveShadow = true; paper.frustumCulled = false;
  scene.add(paper);

  // The page → the world. Page space is p (along the time), u (up the page), h (off the paper);
  // the world is camera-relative so a long session keeps its precision.
  function affine(e, o, p0, u0, sp, su, sh, k = 0, y0 = 0) {
    e[o] = -k; e[o + 1] = 0; e[o + 2] = -sp; e[o + 3] = 0;
    e[o + 4] = -su; e[o + 5] = 0; e[o + 6] = 0; e[o + 7] = 0;
    e[o + 8] = 0; e[o + 9] = sh; e[o + 10] = 0; e[o + 11] = 0;
    e[o + 12] = U0 - u0; e[o + 13] = y0; e[o + 14] = CP - p0; e[o + 15] = 1;
  }
  const worldOf = (p, u, h, v = new THREE.Vector3()) => v.set(U0 - u, h, CP - p);

  // ── batches: one instanced mesh per kind of mark
  const batches = {};
  const pickable = [];
  function batch(name, geo, mat, cap, pick = true) {
    geo = keep(geo);
    const glow = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3); glow.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('aGlow', glow);
    const mesh = new THREE.InstancedMesh(geo, mat, cap);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3);
    mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
    mesh.frustumCulled = false; mesh.castShadow = true; mesh.receiveShadow = true; mesh.count = 0;
    scene.add(mesh);
    const b = { name, mesh, glow, cap, n: 0, refs: [] };
    mesh.userData.batch = b;
    if (pick) pickable.push(mesh);
    batches[name] = b;
    return b;
  }
  function put(b, p0, u0, sp, su, sh, col, glow, ref, k = 0, y0 = 0) {
    if (b.n >= b.cap) return;
    const i = b.n++;
    affine(b.mesh.instanceMatrix.array, i * 16, p0, u0, sp, su, sh, k, y0);
    const c = b.mesh.instanceColor.array; c[i * 3] = col.r; c[i * 3 + 1] = col.g; c[i * 3 + 2] = col.b;
    const g = b.glow.array;
    if (glow) { g[i * 3] = glow.r; g[i * 3 + 1] = glow.g; g[i * 3 + 2] = glow.b; } else g[i * 3] = g[i * 3 + 1] = g[i * 3 + 2] = 0;
    b.refs[i] = ref;
  }

  // Note heads, extruded and bevelled so their edges catch the light.
  const HEAD_H = 0.3;
  const extrude = (shape, depth, bevel = 0.07) => {
    const g = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel * 0.8, bevelSegments: 2, curveSegments: 14 });
    g.translate(0, 0, bevel);
    return g;
  };
  const ellipse = (rx, ry, rot, hole) => {
    const s = new THREE.Shape(); s.absellipse(0, 0, rx, ry, 0, Math.PI * 2, false, rot);
    if (hole) { const h = new THREE.Path(); h.absellipse(0, 0, hole[0], hole[1], 0, Math.PI * 2, true, hole[2]); s.holes.push(h); }
    return s;
  };
  const TILT = 0.35;
  batch('head', extrude(ellipse(0.56, 0.4, TILT), HEAD_H - 0.14), inkMat, 900);
  batch('hollow', extrude(ellipse(0.58, 0.41, TILT, [0.46, 0.2, TILT + 0.2]), HEAD_H - 0.14, 0.05), inkMat, 300);
  batch('whole', extrude(ellipse(0.74, 0.45, 0, [0.4, 0.3, -0.9]), HEAD_H - 0.14, 0.05), inkMat, 200);
  const xShape = (() => {
    const s = 0.42, w = 0.075 / Math.SQRT1_2 * 0.5, c = 0.075 * Math.SQRT2 * 0.9, q = w;
    const pts = [[s + q, s - q], [s - q, s + q], [0, c], [-s + q, s + q], [-s - q, s - q], [-c, 0], [-s - q, -s + q], [-s + q, -s - q], [0, -c], [s - q, -s - q], [s + q, -s + q], [c, 0]];
    const sh = new THREE.Shape(); sh.moveTo(...pts[0]); for (const p of pts.slice(1)) sh.lineTo(...p); sh.closePath();
    return sh;
  })();
  batch('xhead', extrude(xShape, HEAD_H - 0.12, 0.05), inkMat, 400);
  batch('dot', (() => { const g = new THREE.CylinderGeometry(0.17, 0.17, 0.22, 14); g.rotateX(Math.PI / 2); g.translate(0, 0, 0.11); return g; })(), inkMat, 200);
  batch('box', new THREE.BoxGeometry(1, 1, 1).translate(0.5, 0.5, 0.5), inkMat, 2400);
  const crescent = (dir, inner) => {
    const s = new THREE.Shape(), N = 28;
    for (let i = 0; i <= N; i++) { const x = i / N, y = dir * 4 * x * (1 - x); i ? s.lineTo(x, y) : s.moveTo(x, y); }
    for (let i = N; i >= 0; i--) { const x = i / N, y = dir * (4 * x * (1 - x) * inner); s.lineTo(x, y); }
    s.closePath();
    return new THREE.ExtrudeGeometry(s, { depth: 0.12, bevelEnabled: false });
  };
  batch('arcU', crescent(1, 0.74), inkMat, 300);          // ties
  batch('arcD', crescent(-1, 0.74), inkMat, 300);
  batch('slurU', crescent(1, 0.9), inkMat, 60);           // slurs: longer, so thinner for their height
  batch('slurD', crescent(-1, 0.9), inkMat, 60);

  // Stickers: a picture of a glyph, stacked in thin layers so it stands off the paper and casts
  // its shadow.
  const stackGeo = keep((() => {
    const L = 9, pos = [], nor = [], uv = [], col = [], top = [], idx = [];
    for (let k = 0; k < L; k++) {
      const z = k / (L - 1), sh = 0.4 + 0.6 * z, o = k * 4;
      for (const [x, y] of [[0, 0], [1, 0], [1, 1], [0, 1]]) { pos.push(x, y, z); nor.push(0, 0, 1); uv.push(x, y); col.push(sh, sh, sh); top.push(k === L - 1 ? 1 : 0); }
      idx.push(o, o + 1, o + 2, o, o + 2, o + 3);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.setAttribute('aTop', new THREE.Float32BufferAttribute(top, 1));   // the top layer: the only one that glows
    g.setIndex(idx);
    return g;
  })());
  const stickers = {};
  function sticker(name, draw, inkH, maxW = Infinity, cap = 60) {
    const got = draw && inked(draw);
    if (!got) return;
    const s = Math.min(inkH / got.inkH, maxW / got.inkW);
    // Marco, 2026-10-03, of the lit clefs and names: *"not sharp"* — all nine layers of the stack glowed, smeared at
    // an angle; now only the top one does, and the filtering is the GPU's best.
    const tex = keep(new THREE.CanvasTexture(got.canvas)); tex.anisotropy = renderer.capabilities.getMaxAnisotropy(); tex.colorSpace = THREE.SRGBColorSpace;
    // Marco: *"you judge"* — the edges were still cut hard, ragged: now blended softly (transparent, a low cut for depth).
    const mat = glowing(new THREE.MeshStandardMaterial({ map: tex, transparent: true, alphaTest: 0.04, side: THREE.DoubleSide, vertexColors: true, roughness: 0.5, metalness: 0.05 }), true);
    const b = batch(`st:${name}`, stackGeo.clone(), mat, cap);
    stickers[name] = { b, w: got.canvas.width * s, h: got.canvas.height * s, pad: got.pad * s, inkW: got.inkW * s, inkH: got.inkH * s };
  }
  // Heights from engraving (SMuFL's Bravura), in staff spaces.
  sticker('treble', symbol('\u{1D11E}', SYMBOLS), 7.0);
  sticker('bass', symbol('\u{1D122}', SYMBOLS), 3.55);
  sticker('rest4', restQuarter, 2.9, Infinity, 200);
  sticker('rest8', restFlagged(1), 1.75, Infinity, 200);
  sticker('rest16', restFlagged(2), 2.7, Infinity, 200);
  sticker('sharp', symbol('♯', SYMBOLS), 2.75, Infinity, 120);
  sticker('flat', symbol('♭', SYMBOLS), 2.4, Infinity, 120);
  sticker('natural', symbol('♮', SYMBOLS), 2.65, Infinity, 120);
  sticker('flagU', flag(false), 3.1, Infinity, 200);
  sticker('flagD', flag(true), 3.1, Infinity, 200);
  sticker('four', text('4', `bold ${SERIF}`), 1.9, Infinity, 20);
  // The names in Helvetica (Marco, 2026-10-03: *"use helevtica!"*).
  STAVES.forEach((st, s) => sticker(`name${s}`, bigText(st.name, `600 ${HELV}`, 400), 1.15, 6.6, 12));
  STAVES.forEach((st, s) => sticker(`short${s}`, text(st.short, `600 ${HELV}`, 200), 0.8, 4, 16));   // 03
  // 05: the title printed on the page, as a model name on a machine (docs/02 §1), in Marco's title font.
  sticker('title', bigText('05', `700 "HelveticaNeue-CondensedBold", "Helvetica Neue", "Arial Narrow", ${HELV}`, 600), 4.2, 20, 2);

  // The glow: flat light around a lit head, and the paper's sparks.
  const GLOWS = 1400;
  const gPos = new Float32Array(GLOWS * 3), gCol = new Float32Array(GLOWS * 3), gSize = new Float32Array(GLOWS);
  const gGeo = keep(new THREE.BufferGeometry());
  const attr = (a, n) => { const x = new THREE.BufferAttribute(a, n); x.setUsage(THREE.DynamicDrawUsage); return x; };
  gGeo.setAttribute('position', attr(gPos, 3)); gGeo.setAttribute('aCol', attr(gCol, 3)); gGeo.setAttribute('aSize', attr(gSize, 1));
  const gMat = keep(new THREE.ShaderMaterial({
    uniforms: { uScale: { value: 1 } },
    vertexShader: 'attribute vec3 aCol; attribute float aSize; uniform float uScale; varying vec3 vCol;\nvoid main() { vCol = aCol; vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_PointSize = min(640.0, aSize * uScale / max(0.1, -mv.z)); gl_Position = projectionMatrix * mv; }',
    fragmentShader: 'varying vec3 vCol;\nvoid main() { vec2 c = gl_PointCoord * 2.0 - 1.0; float d = dot(c, c); if (d > 1.0) discard; float a = exp(-d * 7.0) * 0.85 + exp(-d * 2.2) * 0.25; a *= 1.0 - d; gl_FragColor = vec4(vCol * a, 1.0); }',
    transparent: true, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending,
  }));
  const glows = new THREE.Points(gGeo, gMat); glows.frustumCulled = false; glows.renderOrder = 10;
  scene.add(glows);
  let nGlow = 0;
  const lit = [];                                 // the brightest lit heads, for the lamps
  function glow(p, u, h, col, amount, size) {
    if (nGlow >= GLOWS || amount < 0.004) return;
    const i = nGlow++; const v = worldOf(p, u, h, _v);
    gPos[i * 3] = v.x; gPos[i * 3 + 1] = v.y; gPos[i * 3 + 2] = v.z;
    gCol[i * 3] = col.r * amount; gCol[i * 3 + 1] = col.g * amount; gCol[i * 3 + 2] = col.b * amount;
    gSize[i] = size;
  }

  // ─── The notation, bar by bar ───────────────────────────────────────────────────────────────────

  const heard = STAVES.map(() => new Map());      // per staff: beat → chord, frozen once heard
  const bars = new Map();                         // `${s}:${b}` → { sig, glyphs }
  let dying = [];
  let lists = STAVES.map(() => []);               // per staff: this frame's chords, heard and coming

  function chordsFrom(events, view) {
    const out = STAVES.map(() => []), drumAt = new Map();
    for (const e of events) {
      const lane = e.lane, at = e.at ?? e.t, s = STAFF_OF[lane];
      if (s == null || s < 0) continue;
      if (isDrum(s)) {                            // 04: strokes at one moment on one staff are one chord
        const k = `${s}:${e.t}`, pos = DRUM_POS[e.kind] ?? 4;
        let c = drumAt.get(k);
        if (!c) { c = { t: e.t, at, len: e.len, part: lane, heads: [], ev: e }; drumAt.set(k, c); out[s].push(c); }
        if (!c.heads.some((h) => h.pos === pos)) c.heads.push({ pos, dia: 0, alter: 0, part: lane, small: false, x: DRUM_X.has(e.kind), ev: e });
      } else if (e.fs) {
        out[s].push({ t: e.t, at, len: e.len, part: lane, heads: e.fs.map((f) => head(s, midiOf(f), lane, false)), ev: e });
      } else if (e.f != null) {
        out[s].push({ t: e.t, at, len: e.len, part: lane, heads: [head(s, midiOf(e.f), lane, false)], ev: e });
      }
    }
    for (const l of out) l.sort((a, b) => a.t - b.t);
    return out;
  }

  // What was heard stays as it was heard; what is coming is what the music says now.
  function combine(s, fresh, now, from) {
    const hist = heard[s];
    for (const c of fresh) if (c.at <= now && !hist.has(c.t)) hist.set(c.t, c);
    const list = [];
    for (const [t, c] of hist) { if (t < from - 72) hist.delete(t); else list.push(c); }
    for (const c of fresh) if (!hist.has(c.t)) list.push(c);
    return list.sort((a, b) => a.t - b.t);
  }

  function notation(s, list) {
    const out = new Map();
    const get = (b) => { let x = out.get(b); if (!x) out.set(b, x = { pieces: [], slurs: [] }); return x; };
    for (let i = 0; i < list.length; i++) {
      const c = list[i], next = list[i + 1];
      c.nlen = notated(s, c, next ? next.t : Infinity);
      const ps = split(c.t, c.nlen);
      c.pieces = ps;
      ps.forEach((q, j) => { q.c = c; q.first = j === 0; q.tie = ps[j + 1] || null; get(q.bar).pieces.push(q); });
    }
    // The melody's legato: notes that run into each other are one phrase, under one slur.
    if (s === MELODY) {
      let start = null;
      for (let i = 0; i < list.length; i++) {
        const c = list[i], n = list[i + 1];
        // A phrase runs while the notes join, and ends where the chord changes (every two bars),
        // as the vamp is phrased.
        const joined = n && c.t + c.nlen === n.t && c.len >= 0.9 * (n.t - c.t) && Math.floor(n.t / PHRASE) === Math.floor(c.t / PHRASE);
        if (joined && !start) start = c;
        if (!joined && start) { const sl = { c0: start, c1: c, phrase: list.slice(list.indexOf(start), i + 1) }; get(Math.floor(start.t / BAR)).slurs.push(sl); start = null; }
      }
    }
    return out;
  }

  const sigOf = (bucket) => bucket.pieces.map((q) => `${q.t},${q.v},${q.first ? 1 : 0},${q.tie ? q.tie.t : -1},${q.c.part},${q.c.at.toFixed(3)},${q.c.len.toFixed(2)},${q.c.heads.map((h) => `${h.pos}${h.alter}${h.small ? 's' : ''}${h.part}`).join(';')}`).join('/')
    + bucket.slurs.map((sl) => `|${sl.c0.t}-${sl.c1.t}`).join('');

  const HW = 1.12;                                // a head's width
  function build(s, b, bucket) {
    const G = [], drum = isDrum(s);
    const pieces = bucket.pieces.slice().sort((a, x) => a.t - x.t);
    for (const q of pieces) { const ps = q.c.heads.map((h) => h.pos); q.lo = Math.min(...ps); q.hi = Math.max(...ps); q.up = drum || stemUp(q.lo, q.hi); q.beam = null; }
    // Beams: eighths and sixteenths inside one beat.
    const groups = []; let cur = null;
    for (const q of pieces) {
      const beat = Math.floor((q.t - b * BAR) / 4);
      if (q.v <= 3) {
        if (cur && cur.beat === beat && cur.end === q.t) { cur.qs.push(q); cur.end = q.t + q.v; }
        else groups.push(cur = { beat, qs: [q], end: q.t + q.v });
      } else cur = null;
    }
    for (const g of groups) {
      if (g.qs.length < 2) continue;
      const lo = Math.min(...g.qs.map((q) => q.lo)), hi = Math.max(...g.qs.map((q) => q.hi));
      g.up = drum || stemUp(lo, hi);
      g.endPos = g.up ? Math.max(4, ...g.qs.map((q) => q.hi + 7)) : Math.min(4, ...g.qs.map((q) => q.lo - 7));
      for (const q of g.qs) { q.up = g.up; q.beam = g; }
    }
    const acc = new Map();
    for (const q of pieces) {
      const c = q.c, p = P(q.t);
      const endPos = q.beam ? q.beam.endPos : q.up ? Math.max(q.hi + 7, 4) : Math.min(q.lo - 7, 4);
      q.endPos = endPos;
      // Seconds in a chord sit either side of the stem.
      const shift = new Map(), sorted = c.heads.slice().sort((a, x) => a.pos - x.pos);
      if (q.up) { for (let i = 1; i < sorted.length; i++) if (sorted[i].pos - sorted[i - 1].pos === 1 && !shift.get(sorted[i - 1])) shift.set(sorted[i], 1); }
      else { for (let i = sorted.length - 2; i >= 0; i--) if (sorted[i + 1].pos - sorted[i].pos === 1 && !shift.get(sorted[i + 1])) shift.set(sorted[i], -1); }
      const type = q.v === 16 ? 'whole' : q.v >= 8 ? 'hollow' : 'head';
      let accX = p - 0.85;
      const accs = [];
      for (const h of c.heads) {
        const dx = (shift.get(h) || 0) * HW, hp = p + dx, hu = posU(s, h.pos), sc = h.small ? 0.7 : 1;
        const light = { c, part: h.part, from: q.t, small: h.small };
        G.push({ k: `n${q.t}:${h.pos}:${h.small ? 's' : ''}${h.part}:${q.v}`, b: h.x ? 'xhead' : type, p0: hp, u0: hu, sp: sc, su: sc, sh: 1, part: h.part, light, what: 'note', c, h, t: q.t });
        if (q.v === 12 || q.v === 6 || q.v === 3) {
          const dpos = h.pos % 2 === 0 ? h.pos + 1 : h.pos;
          G.push({ k: `d${q.t}:${h.pos}`, b: 'dot', p0: p + 0.95 + Math.max(0, ...[...shift.values()]) * HW, u0: posU(s, dpos), sp: 1, su: 1, sh: 1, part: h.part, what: 'dot', c, t: q.t });
        }
        if (!h.x) {
          const was = acc.get(h.dia) ?? 0;
          if (q.first && h.alter !== was) accs.push(h);
          acc.set(h.dia, h.alter);
        }
      }
      // Accidentals, stacked leftwards from the top note.
      accs.sort((a, x) => x.pos - a.pos).forEach((h, i) => {
        const name = h.alter > 0 ? 'sharp' : h.alter < 0 ? 'flat' : 'natural', st = stickers[name];
        if (!st) return;
        const x = accX - (i % 2) * 1.05 - st.inkW, hu = posU(s, h.pos);
        const bottom = name === 'flat' ? hu - 0.7 : hu - st.inkH / 2;
        G.push({ k: `a${q.t}:${h.pos}`, b: `st:${name}`, p0: x - st.pad, u0: bottom - st.pad, sp: st.w, su: st.h, sh: 0.26, part: h.part, what: 'accidental', c, t: q.t });
      });
      // Ledger lines.
      const minDx = Math.min(0, ...[...shift.values()]) * HW, maxDx = Math.max(0, ...[...shift.values()]) * HW;
      const ledger = (L) => G.push({ k: `l${q.t}:${L}`, b: 'box', p0: p - 0.85 + minDx, u0: posU(s, L) - 0.07, sp: 1.7 + maxDx - minDx, su: 0.14, sh: 0.05, part: c.part, what: 'ledger', c, t: q.t });
      for (let L = -2; L >= q.lo; L -= 2) ledger(L);
      for (let L = 10; L <= q.hi; L += 2) ledger(L);
      // The stem.
      if (q.v < 16) {
        const sx = q.up ? p + 0.52 : p - 0.52, from = posU(s, q.up ? q.lo : q.hi), to = posU(s, endPos);
        q.sx = sx;
        G.push({ k: `s${q.t}`, b: 'box', p0: sx - 0.06, u0: Math.min(from, to), sp: 0.12, su: Math.abs(to - from), sh: 0.16, part: drum ? -1 : c.part, staff: s, what: 'stem', c, t: q.t });
        if (q.v <= 3 && !q.beam) {
          const st = stickers[q.up ? 'flagU' : 'flagD'];
          for (let i = 0; i < (q.v === 1 ? 2 : 1) && st; i++) {
            const top = to - (q.up ? 1 : -1) * i * 0.85;
            const u0 = q.up ? top - st.inkH : top;
            G.push({ k: `f${q.t}:${i}`, b: st.b.name, p0: sx - 0.06 - st.pad, u0: u0 - st.pad, sp: st.w, su: st.h, sh: 0.2, part: drum ? -1 : c.part, staff: s, what: 'flag', c, t: q.t });
          }
        }
      }
      // Ties, on the side away from the stem, to the next piece of the same note.
      if (q.tie) {
        const p2 = P(q.tie.t);
        const spans = [[p + 0.55, p2 - 0.55]];
        for (const h of c.heads) {
          const side = q.up ? -1 : 1, hu = posU(s, h.pos) + side * 0.55;
          spans.forEach(([a, z], i) => {
            const L = z - a;
            if (L <= 0.2) return;
            G.push({ k: `t${q.t}:${h.pos}${h.small ? 's' : ''}:${i}`, b: side > 0 ? 'arcU' : 'arcD', p0: a, u0: hu, sp: L, su: Math.min(0.4 + 0.025 * L, 1.0), sh: 1, part: h.part, light: { c, part: h.part, from: i ? q.tie.t : q.t, small: h.small }, what: 'tie', c, t: q.t });
          });
        }
      }
    }
    for (const g of groups) {
      if (g.qs.length < 2) continue;
      const a = g.qs[0], z = g.qs[g.qs.length - 1], u = posU(s, g.endPos), th = 0.5;
      const beam = (p0, p1, level, key) => G.push({ k: key, b: 'box', p0, u0: g.up ? u - th - level * 0.78 : u + level * 0.78, sp: p1 - p0, su: th, sh: 0.22, part: drum ? -1 : a.c.part, staff: s, what: 'beam', c: a.c, t: a.t });
      beam(a.sx - 0.06, z.sx + 0.06, 0, `b${a.t}`);
      g.qs.forEach((q, i) => {
        if (q.v !== 1) return;
        const n = g.qs[i + 1], pr = g.qs[i - 1];
        if (n && n.v === 1) beam(q.sx - 0.06, n.sx + 0.06, 1, `b2${q.t}`);
        else if (!(pr && pr.v === 1)) beam(n ? q.sx - 0.06 : q.sx - 1.0, n ? q.sx + 1.0 : q.sx + 0.06, 1, `b2${q.t}`);
      });
    }
    // Slurs over a phrase.
    for (const sl of bucket.slurs) {
      const f = sl.c0.pieces[0], lastC = sl.c1, l = lastC.pieces[lastC.pieces.length - 1];
      const up = f.up ?? true, side = up ? -1 : 1;
      const hf = sl.c0.heads.find((h) => !h.small) || sl.c0.heads[0], hl = lastC.heads.find((h) => !h.small) || lastC.heads[0];
      const edge = (c) => (side < 0 ? Math.min(...c.heads.map((h) => h.pos)) : Math.max(...c.heads.map((h) => h.pos)));
      const pa = P(f.t) + 0.2, pb = P(l.t) - 0.2, ua = posU(s, edge(sl.c0)) + side * 1.0, ub = posU(s, edge(lastC)) + side * 1.0, L = pb - pa;
      if (L <= 0.5) continue;
      // High enough to clear every note under it.
      const far = side < 0 ? Math.min(...sl.phrase.map((c) => posU(s, edge(c)))) - 0.9 : Math.max(...sl.phrase.map((c) => posU(s, edge(c)))) + 0.9;
      const clear = side < 0 ? (ua + ub) / 2 - far : far - (ua + ub) / 2;
      G.push({ k: `sl${sl.c0.t}`, b: side > 0 ? 'slurU' : 'slurD', p0: pa, u0: ua, sp: L, su: Math.max(1.0, Math.min(5, clear + 0.4, 0.8 + 0.05 * L)), sh: 1, kk: ub - ua, part: MELODY, slur: sl, what: 'slur', c: sl.c0, t: sl.c0.t });
    }
    // Rests in what is left of the bar.
    const taken = pieces.map((q) => [q.t - b * BAR, q.t - b * BAR + q.v]).sort((a, x) => a[0] - x[0]);
    let l = 0; const gaps = [];
    for (const [a, z] of taken) { if (a > l) gaps.push([l, a]); l = Math.max(l, z); }
    if (l < BAR) gaps.push([l, BAR]);
    for (const [a, z] of gaps) for (const r of restsIn(a, z)) {
      const t = b * BAR + r.l, p = r.v === 16 ? (P(b * BAR) + barEndP(b)) / 2 - 0.6 : P(t);
      const base = { part: -1, staff: s, what: 'rest', t, v: r.v };
      if (r.v >= 8) G.push({ ...base, k: `r${t}:${r.v}`, b: 'box', p0: p - 0.6, u0: r.v === 16 ? posU(s, 5) : posU(s, 4), sp: 1.2, su: 0.5, sh: 0.24 });
      else {
        const st = stickers[r.v === 4 ? 'rest4' : r.v === 2 ? 'rest8' : 'rest16'];
        if (!st) continue;
        const mid = posU(s, 4), bottom = r.v === 4 ? mid - st.inkH / 2 : r.v === 2 ? mid - 1.0 : mid - 2.0;
        G.push({ ...base, k: `r${t}:${r.v}`, b: st.b.name, p0: p - st.inkW / 2 - st.pad, u0: bottom - st.pad, sp: st.w, su: st.h, sh: 0.24 });
      }
    }
    // The barline at the end of the bar.
    G.push({ k: `bl${b}`, b: 'box', p0: barEndP(b) - 0.08, u0: posU(s, 0) - 0.05, sp: 0.16, su: 4.1, sh: 0.06, part: -1, staff: s, what: 'barline', t: (b + 1) * BAR });
    return G;
  }

  let lastNow = null;
  function refresh(view, now) {
    const from = now - 40, to = now + 176;   // 03: past where the fog is dark (10 bars)
    // A jump in time — a loop back, a locate — starts the page again from what the music says.
    if (lastNow != null && (now < lastNow - 1 || now > lastNow + 64)) { heard.forEach((h) => h.clear()); bars.clear(); dying = []; }
    lastNow = now;
    const fresh = chordsFrom(view.events || [], view);
    lists = STAVES.map((_, s) => combine(s, fresh[s], now, from));
    const bFirst = Math.max(0, Math.floor(from / BAR)), bLast = Math.floor((to + 1) / BAR) - 1;
    STAVES.forEach((_, s) => {
      const nb = notation(s, lists[s]);
      for (let b = bFirst; b <= bLast; b++) {
        const bucket = nb.get(b) || { pieces: [], slurs: [] }, sig = sigOf(bucket), id = `${s}:${b}`, old = bars.get(id);
        if (old && old.sig === sig) continue;
        const glyphs = build(s, b, bucket);
        if (old) {
          const was = new Map(old.glyphs.map((g) => [g.k, g]));
          for (const g of glyphs) { const o = was.get(g.k); g.fade = o ? o.fade : 0; was.delete(g.k); }
          for (const g of was.values()) { g.light = null; g.slur = null; dying.push(g); }
        } else for (const g of glyphs) g.fade = 1;
        bars.set(id, { sig, glyphs, b, s });
      }
    });
    for (const [id, x] of bars) if (x.b < bFirst - 3) bars.delete(id);
    return { bFirst, bLast };
  }

  // ─── Each frame ─────────────────────────────────────────────────────────────────────────────────

  const dimS = STAVES.map(() => 1);               // 05: each staff's light, 1 full, dimmed while another is selected
  const held = new Array(NP).fill(0);              // the level each part was last heard at
  let playFade = 0, rise = 0, risen = 0, spotX = null, first = true;
  const _v = new THREE.Vector3(), _c = new THREE.Color(), _g = new THREE.Color(), _lamp = new THREE.Color();
  const eyeA = new THREE.Vector3(), eyeB = new THREE.Vector3(), atA = new THREE.Vector3(), atB = new THREE.Vector3();
  const spotA = new THREE.Vector3(), spotB = new THREE.Vector3();
  const qA = new THREE.Quaternion(), qB = new THREE.Quaternion(), rig = new THREE.PerspectiveCamera();   // a camera: it looks down its -z
  const staffX = (s) => U0 - posU(s, 4);
  const PAGE_MID_U = (STAVES[0].top + STAVES[LAST].top - 4) / 2;

  function frame(view, dt = 1 / 60) {
    dt = Math.min(0.1, Math.max(0, dt));
    const now = Math.max(0, view.now || 0), rate = view.rate || 6, playing = !!view.playing;
    const off = (p) => !!view.off?.(p);
    const staffOff = (s) => STAVES[s].parts.every(off);
    // 05: the signal and the colour, each part its own (docs/01 §6.3–§6.4).
    const per = (a, p, d) => Math.max(0, Math.min(1, view[a]?.[p] ?? d));
    const fadeOf = (p) => 0.3 + 3.2 * per('space', p, 0.25);
    const fade = fadeOf(MELODY);
    const sends = view.echo || [];
    // A selected staff in full light, the others dimmed — eased, as the camera glides (docs/02 §5).
    const selFocus = view.focus && view.selected >= 0 && view.selected < NP ? STAFF_OF[view.selected] : -1;
    for (let k = 0; k < STAVES.length; k++) dimS[k] += ((selFocus >= 0 && k !== selFocus ? 0.22 : 1) - dimS[k]) * (1 - Math.exp(-dt / 0.3));
    const dimOf = (k) => (k >= 0 ? dimS[k] : 1);
    for (let p = 0; p < NP; p++) {
      const l = Math.max(0, Math.min(1, view.level?.(p) ?? 0));
      held[p] = Math.max(l, held[p] * Math.exp(-dt / 2.5));
    }
    playFade += ((playing ? 1 : 0) - playFade) * (1 - Math.exp(-dt / (playing ? 0.15 : 0.6)));
    const riseTo = playing || view.hold ? 0 : 1;   // the Score camera from the launch until the first PLAY — no view from above
    rise = first ? riseTo : Math.max(0, Math.min(1, rise + (riseTo ? dt / 2 : -dt / 1.2)));
    const r = smooth(rise);
    risen = r;
    CP = camP(now);

    // The notation: rebuilt only where what is coming changed.
    const { bLast } = refresh(view, now);
    const pEnd = barEndP(bLast) + 0.1;

    // The light of each part: the filter warms and dims the pitched four; the rest pass unfiltered.
    // Colour: from dark and warm to bright and open. Drive: hotter. Hold: rising.
    const lampOf = (part, out) => out.copy(LAMP_SHUT).lerp(LAMP_OPEN, Math.pow(per('colour', part, 0.6), 0.6)).lerp(VOICE[part] || LAMP_KIT, TINT).lerp(HOT, 0.6 * per('drive', part, 0));
    const gainOf = (part) => (0.2 + 0.8 * Math.pow(per('colour', part, 0.6), 0.75)) * (1 + 1.6 * per('drive', part, 0)) * (1 + 1.2 * per('tension', part, 0));
    const bright = (part) => (off(part) ? 0 : held[part] * gainOf(part) * playFade * dimOf(STAFF_OF[part]));
    const octLevel = (part) => Math.max(0, Math.min(1, view.octave?.[part] ?? 0));
    const lightOf = (L) => {
      const c = L.c;
      if (now < Math.max(c.at, L.from)) return 0;
      const v = envelope(L.part, (now - c.at) / rate, c.len / rate, fadeOf(L.part)) * bright(L.part);
      return L.small ? v * octLevel(L.part) : v;
    };

    // THE LAUNCH (Marco, 2026-10-03): every light off; the back light — the notes glowing — comes up slowly.
    // 05: SWITCHING ON (docs/02 §2). t: seconds since the standby light was tapped; standby, nothing lit.
    const bt = view.boot == null ? -1 : view.boot, clamp01 = (x) => Math.max(0, Math.min(1, x));
    const settle = bt < 0 ? 0 : smooth(clamp01((bt - 2.5) / 1.0));
    // The self-test: a light runs down the eight staffs once, 0.3–1.5 s, each flashing in turn.
    const testOf = (s) => (bt < 0 ? 0 : Math.exp(-(((bt - 0.3 - s * 0.15) / 0.07) ** 2)));
    // The names come on one by one, 1.5–2.5 s, as a display filling in; then settle low with the rest.
    const nameOn = (s) => (bt < 0 ? 0 : smooth(clamp01((bt - 1.5 - s * 0.125) / 0.12)));
    const nameLv = (s) => nameOn(s) * (0.95 + (CLEF_LEVEL - 0.95) * settle);
    const titleLv = bt < 0 ? 0 : smooth(clamp01((bt - 1.5) / 0.2)) * (0.9 + (0.5 - 0.9) * settle);
    for (const b of Object.values(batches)) b.n = 0;
    nGlow = 0; lit.length = 0;

    const draw = (g) => {
      const b = batches[g.b];
      if (!b) return;
      const gone = g.part >= 0 ? off(g.part) : g.staff != null && staffOff(g.staff);
      const gs = g.staff ?? (g.part >= 0 ? STAFF_OF[g.part] : -1);
      _c.copy(PAPER).lerp(gone ? GREY : INK, g.fade * (gs >= 0 && dimOf(gs) < 1 ? 0.45 : 1));
      let glowCol = null;
      if (g.light || g.slur) {
        let L = 0;
        if (g.slur) for (const c of g.slur.phrase) L = Math.max(L, lightOf({ c, part: MELODY, from: c.t, small: false }));
        else L = lightOf(g.light);
        L *= g.fade;
        if (L > 0.003) {
          const part = g.slur ? MELODY : g.light.part;
          lampOf(part, _lamp);
          glowCol = _g.copy(_lamp).multiplyScalar(L * (g.what === 'note' ? 3.2 : g.slur ? 1.6 : 0.5));
          if (g.what === 'note') {
            glow(g.p0, g.u0, 0.5, _lamp, L * 0.7, (g.light.small ? 2.2 : 3.0) * (0.75 + 0.25 * L) * (1 + 0.9 * per('space', part, 0.25)));
            lit.push({ p: g.p0, u: g.u0, L, part });
          }
        }
      }
      put(b, g.p0, g.u0, g.sp, g.su, g.sh * (0.25 + 0.75 * g.fade), _c, glowCol, g, g.kk || 0);
    };

    // Re-ink: new marks appear, old coming ones fade into the paper.
    const step = dt / REINK;
    for (const x of bars.values()) for (const g of x.glyphs) { if (g.fade < 1) g.fade = Math.min(1, g.fade + step); draw(g); }
    dying = dying.filter((g) => (g.fade -= step) > 0);
    for (const g of dying) draw(g);

    // The staff, eight bars at a time; the system's line, clefs, names and time signature once, at the start.
    const box = batches.box;
    const sel = view.selected ?? -1, selStaff = sel >= 0 && sel < NP ? STAFF_OF[sel] : -1;
    const pA = CP - 90, pB = CP + 400;
    for (let k = Math.max(0, Math.floor((pA - MARGIN) / (SYS * ZB))); lineStart(k) <= pB; k++) {
      const ls = lineStart(k), le = Math.min(barEndP(8 * k + 7) + 0.08, pEnd);
      if (ls > pEnd) break;
      const sysRef = { what: 'system', part: -1, t: k * SYS };
      if (k === 0) put(box, ls - 0.1, posU(LAST, 0) - 0.05, 0.22, posU(0, 8) - posU(LAST, 0) + 0.1, 0.07, INK, null, sysRef);
      STAVES.forEach((st, s) => {
        const gone = staffOff(s), ink = gone ? GREY : INK, ref = { what: 'line', staff: s, part: -1, t: k * SYS };
        // THE BACK LIGHT on the staff lines (Marco, 2026-10-03: *"can we backlight the horizontal bars instead of the
        // notes?"*): the five lines glow night-light blue — at the launch and stopped, not while playing.
        const bk = gone ? 0 : ((BACKLIT_LEVEL * settle + 1.6 * testOf(s)) * lightsOn.back * (1 - playFade) + 0.7 * per('tension', st.parts[0], 0) * playFade) * dimOf(s);   // 05: hold — the staff rising
        const lineGlow = bk > 0.002 ? _g.setRGB(BACKLIT.r * bk, BACKLIT.g * bk, BACKLIT.b * bk) : null;
        for (let i = 0; i < 5; i++) put(box, ls, posU(s, 2 * i) - 0.055, le - ls, 0.11, 0.03, ink, lineGlow, ref);
        // 03: past the start, a short name over each staff every eight bars, as a printed score
        // names its later systems (Marco, 2026-10-01) — on the paper, so it moves with it.
        if (k > 0) {
          const sn = stickers[`short${s}`];
          if (sn) put(sn.b, ls + 1.2 - sn.pad, posU(s, 8) + 0.75 - sn.pad, sn.w, sn.h, 0.18,
            gone ? GREY : SHORT_INK, null, { what: 'name', staff: s, part: -1, t: k * SYS });
          return;
        }
        const cref = { what: 'clef', staff: s, part: -1, t: k * SYS };
        // The clefs — the keys — backlit a brighter yellow (Marco, 2026-10-03: *"the very first keys - a brighter yellow instead of blue"*).
        const ck = gone ? 0 : nameLv(s) * lightsOn.back * (1 - playFade);
        const clefGlow = ck > 0.002 ? _cg.setRGB(CLEF_LIT.r * ck, CLEF_LIT.g * ck, CLEF_LIT.b * ck) : null;
        if (st.clef === 'perc') {
          for (const dx of [0.9, 1.65]) put(box, ls + dx, posU(s, 2), 0.42, 2, 0.26, ink, clefGlow, cref);
        } else {
          const c = stickers[st.clef];
          if (c) {
            const bottom = st.clef === 'treble' ? posU(s, 2) - 2.63 : posU(s, 6) + 1.05 - c.inkH;
            put(c.b, ls + 0.7 - c.pad, bottom - c.pad, c.w, c.h, 0.3, ink, clefGlow, cref);
          }
        }
        const nm = stickers[`name${s}`];
        if (nm) {
          // 04 (Marco, 2026-10-03): every name in ink — no lit name floating alone in the dark.
          // Lit as the clefs are (Marco, 2026-10-03: *"also light up the channel names"*).
          // Green (Marco, 2026-10-03: *"the channel name is green backlit"*).
          const nameGlow = ck > 0.002 ? _ng.setRGB(NAME_LIT.r * ck, NAME_LIT.g * ck, NAME_LIT.b * ck) : null;
          put(nm.b, ls - 1.3 - nm.inkW - nm.pad, posU(s, 4) - nm.inkH / 2 - nm.pad, nm.w, nm.h, 0.24, ink,
            nameGlow, { what: 'name', staff: s, part: -1, t: k * SYS });
        }
        // 05: the title, printed on the page above the first staff, lit with the names.
        if (k === 0 && s === 0 && stickers.title) {
          const tt = stickers.title, tl = titleLv * (1 - playFade);
          put(tt.b, ls + 0.2 - tt.pad, posU(0, 8) + 2.2 - tt.pad, tt.w, tt.h, 0.3, INK,
            tl > 0.002 ? _tg.setRGB(TITLE_LIT.r * tl, TITLE_LIT.g * tl, TITLE_LIT.b * tl) : null, { what: 'title', staff: -1, part: -1, t: 0 });
        }
        if (k === 0 && stickers.four) {
          const f = stickers.four;
          for (const top of [8, 4]) put(f.b, ls + 4.4 - f.pad, posU(s, top) - 2 + (2 - f.inkH) / 2 - f.pad, f.w, f.h, 0.26, ink, null, { what: 'time', staff: s, part: -1, t: 0 });
        }
      });
    }

    // Echoes: a lit note's light again every dotted eighth along its staff, dimmer each time.
    lists.forEach((list, s) => {
      for (const c of list) {
        if (c.at > now) break;
        for (const h of c.heads) {
          if (h.small) continue;
          const send = Math.max(0, Math.min(1, sends[h.part] ?? 0));
          if (send < 0.01) continue;
          const b0 = bright(h.part);
          if (b0 <= 0) continue;
          lampOf(h.part, _lamp);
          for (let k = 1; k < 24; k++) {
            const te = c.at + ECHO_EVERY * k, amp = send * Math.pow(view.repeats ?? ECHO_KEEP, k - 1);   // 03: the delay's repeats as heard
            if (te > now || amp < 0.02) break;
            const age = (now - te) / rate, v = b0 * amp * Math.exp(-age / (0.2 + 0.5 * fadeOf(h.part)));
            if (v < 0.004) continue;
            glow(P(te), posU(s, h.pos), 0.35, _lamp, v * 1.5, 2.6);
            lit.push({ p: P(te), u: posU(s, h.pos), L: v * 0.8, part: h.part });
          }
        }
      }
    });

    // 03: THE BALLS — one per staff. It rests on the note that sounded, rides along it while a held
    // note sounds, hops (the last beat and a half before the next) to where the next lands, and when
    // its part stops, rises and goes.
    const HOP = 6;                                  // sixteenths
    STAVES.forEach((st, s) => {
      const m = balls[s], list = lists[s];
      const part = st.parts[0];
      if (!playing && playFade < 0.02) { m.visible = false; return; }
      let k = list.findIndex((c) => c.at > now);
      const next = k < 0 ? null : list[k];
      const prev = k < 0 ? list[list.length - 1] : k > 0 ? list[k - 1] : null;
      const on = (c) => c && !STAVES[s].parts.every(off) && !off(c.part);
      if (!on(prev) && !on(next)) { m.visible = false; return; }
      const top = (c) => { const ps = c.heads.filter((h) => !h.small).map((h) => h.pos); return ps.length ? posU(s, Math.max(...ps)) : posU(s, 4); };
      const heldTo = prev ? prev.at + (prev.len >= HOP ? prev.len : 0) : 0;
      let p, u, h = 0.9, vis = 1;
      if (prev && now < heldTo) { p = P(now); u = top(prev); }
      else if (prev && next && next.at - now < 64) {
        const from = Math.max(heldTo, next.at - HOP), hop = Math.max(0.5, next.at - from);
        const x = Math.max(0, Math.min(1, (now - from) / hop));
        const p0 = P(Math.max(prev.at, Math.min(heldTo, now))), p1 = P(next.at);
        p = p0 + (p1 - p0) * x; u = top(prev) + (top(next) - top(prev)) * (x * x * (3 - 2 * x));
        h = 0.9 + Math.sin(Math.PI * x) * (1.6 + 1.4 * Math.min(1, hop / 8));
      } else if (next && next.at - now < 8) {       // arriving: it drops in
        const x = 1 - (next.at - now) / 8;
        p = P(next.at); u = top(next); h = 0.9 + (1 - x * x) * 7; vis = x;
      } else if (prev) {                            // its part has stopped: rest, then rise and go
        const x = Math.max(0, Math.min(1, (now - heldTo - 2) / 6));
        if (x >= 1) { m.visible = false; return; }
        p = P(Math.max(prev.at, heldTo)); u = top(prev); h = 0.9 + x * x * 9; vis = 1 - x;
      } else { m.visible = false; return; }
      const b = ballAt[s];
      if (!b.init) { b.p = p; b.u = u; b.h = h; b.init = true; }
      const kk = 1 - Math.exp(-dt / 0.05);
      b.p = p; b.u += (u - b.u) * kk; b.h += (h - b.h) * kk;
      const lv = Math.max(0.35, bright(part)) * vis * playFade;
      lampOf(part, _lamp);
      m.visible = lv > 0.02;
      worldOf(b.p, b.u, b.h, m.position);
      m.material.color.copy(_lamp).lerp(LAMP_OPEN, 0.1).multiplyScalar(0.6 + 1.6 * lv);
      glow(b.p, b.u, b.h, _lamp, lv * 1.1, 3.4);
      glow(b.p, b.u, 0.2, _lamp, lv * 0.35 / (1 + b.h * 0.25), 5.5);    // its light on the paper under it
      lit.push({ p: b.p, u: b.u, L: lv * 0.7 / (1 + b.h * 0.3), part });
    });


    // 05: THE STANDBY LIGHT — red in standby, green once switched on; a small pool of its light on the paper.
    worldOf(LED_P, LED_U, 0.16, led.position);
    led.material.color.copy(bt < 0 ? LED_RED : LED_GREEN).multiplyScalar(1.4);
    glow(LED_P, LED_U, 0.4, bt < 0 ? LED_RED : LED_GREEN, 1.1, 3.6);
    glow(LED_P, LED_U, 0.05, bt < 0 ? LED_RED : LED_GREEN, 0.35, 9);
    // 05: THE NEXT CHORDS (docs/02 §8): faint chords on the CHORDS staff in the coming bar, side by side,
    // standing a little off the paper; the one picked lit.
    choicePos.length = 0;
    const ch = view.choices;
    if (ch && ch.chords?.length && batches.head) {
      const cs = STAFF_OF[5], pulse = 0.5 + 0.5 * Math.sin(now * Math.PI / 4);
      ch.chords.forEach((ms, i) => {
        const t = ch.beat + 1 + i * 4, p = P(t), isP = ch.picked === i;
        const lit = (isP ? 1 : ch.cursor === i ? 0.6 : 0.25 + 0.15 * pulse) * dimOf(cs);   // the keys' or the d-pad's choice, half lit
        lampOf(5, _lamp);
        let top = -Infinity;
        for (const m of ms) {
          const hd = head(cs, m, 5, false), u = posU(cs, hd.pos);
          top = Math.max(top, u);
          _c.copy(PAPER).lerp(INK, isP ? 0.9 : 0.35);
          put(batches.head, p, u, 1, 1, 1, _c, _g.copy(_lamp).multiplyScalar(lit * 1.2), { what: 'choice', part: -1, staff: cs, t }, 0, 0.9);
          glow(p, u, 1.3, _lamp, lit * 0.6, 2.6);
        }
        choicePos[i] = { p, u: top - 1.5, h: 1 };
      });
    }
    // 05: the score's edge caught faintly in the dark before the first PLAY (docs/02 §1).
    edge.position.set(U0 - U_BOT + 60, 14, -140); edge.target.position.set(0, 0, 0); edge.target.updateMatrixWorld();
    edge.intensity = 0.55 * (1 - playFade) * (view.started ? 0 : 1);
    edge.visible = edge.intensity > 0.002;

    // 03: only what is drawn is uploaded — 02 sent every batch's whole buffer each frame (its audit).
    const upload = (attr, n, size) => { attr.clearUpdateRanges(); if (n > 0) attr.addUpdateRange(0, n * size); attr.needsUpdate = true; };
    for (const b of Object.values(batches)) {
      const m = b.mesh;
      m.count = b.n; upload(m.instanceMatrix, b.n, 16); upload(m.instanceColor, b.n, 3); upload(b.glow, b.n, 3);
      m.boundingSphere = null;
    }
    gGeo.setDrawRange(0, nGlow);
    upload(gGeo.attributes.position, nGlow, 3); upload(gGeo.attributes.aCol, nGlow, 3); upload(gGeo.attributes.aSize, nGlow, 1);

    // The lamps: the brightest lit heads light the paper around them.
    lit.sort((a, x) => x.L - a.L);
    lamps.forEach((l, i) => {
      const x = lit[i];
      if (!x) { l.intensity = 0; return; }
      worldOf(x.p, x.u, 2.6, l.position);           // higher: a wider pool (was 1.3)
      lampOf(x.part, l.color);
      l.intensity = x.L * 60 * lightsOn.lamps;      // was 12
    });

    // The paper: the vinyl's grain is the hiss, heard while it plays.
    const pa = Math.max(-4, CP - 160), pl = 2200;
    affine(paper.matrix.elements, 0, pa, U_BOT, pl, U_TOP - U_BOT, 0.6, 0, -0.6);
    paperU.uPage.value.set(((pa % 90) + 90) % 90, pl, U_BOT, U_TOP - U_BOT);
    paperU.uGrain.value = 0.22;                    // 04: no vinyl — the paper's grain stays still

    // The camera: low and close, gliding with now; stopped, it rises and looks down on the next
    // eight bars as a page is read.
    const aspect = W / H, FOV_A = 50, FOV_B = 30, tanB = Math.tan(THREE.MathUtils.degToRad(FOV_B / 2));
    const midX = U0 - PAGE_MID_U;
    // 04: nine staffs make the page wider than 03's five: the playing camera stands back and up in
    // proportion, so every staff is in view. FOCUS (the PS controller's L1 / R1): it glides down and
    // closer over the selected staff.
    // 05: upright, the page is wider than the screen: every camera stands back in proportion (docs/02 §11).
    const fitK = aspect < 1.3 ? Math.pow(1.3 / aspect, 1.2) : 1;
    const wide = WIDE * fitK;
    const fsel = view.selected ?? -1, fStaff = view.focus && fsel >= 0 && fsel < NP ? STAFF_OF[fsel] : -1;
    focusAmt += ((fStaff >= 0 ? 1 : 0) - focusAmt) * (1 - Math.exp(-dt / 0.5));
    if (fStaff >= 0) focusX = focusX == null ? staffX(fStaff) : focusX + (staffX(fStaff) - focusX) * (1 - Math.exp(-dt / 0.35));
    const fx = midX + ((focusX ?? midX) - midX) * focusAmt, fk = 1 - 0.55 * focusAmt;
    // 04: in focus (View · Track) the close camera holds when stopped too, instead of the page from above.
    const rc = r * (1 - focusAmt);
    camera.fov = FOV_A + (FOV_B - FOV_A) * rc; camera.updateProjectionMatrix();
    const tanV = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
    eyeA.set(fx, 12 * wide * fk, 30 * wide * fk); atA.set(fx, 0, -16 * wide * fk);
    // 05: ON A PHONE, the playing camera stands high over now and looks down the page at about 58°, far enough that the
    // eight staffs fill the width at now, and now sits low on the screen (docs/02 §11).
    // Sideways too: a phone's wide screen is low, so the same fit, from lower (docs/02 §11).
    {
      const tV = Math.tan(THREE.MathUtils.degToRad(FOV_A / 2)), half = ((U_TOP - U_BOT) / 2 + 7) * (1 - 0.6 * focusAmt);
      const d = half / (tV * aspect) * (aspect < 1.3 ? 1 : 1.25), el = THREE.MathUtils.degToRad(aspect < 1.3 ? 58 : 42), up = 1;
      _sa.set(fx, 0, -d * 0.36); _se.set(fx, Math.sin(el) * d, Math.cos(el) * d - d * 0.36);
      eyeA.lerp(_se, up); atA.lerp(_sa, up);
    }
    const span = SYS * ZB + 22, fitW = (span / 2) / (tanB * aspect), fitH = ((U_TOP - U_BOT) / 2 + 2) / tanB;
    const dist = Math.max(fitW, fitH) * 1.02, tilt = 0.2;
    atB.set(U0 - (PAGE_MID_U + 1.5), 0, -(span / 2 - 16));
    eyeB.set(atB.x + Math.sin(tilt) * dist, Math.cos(tilt) * dist, atB.z);
    rig.position.copy(eyeA); rig.up.set(0, 1, 0); rig.lookAt(atA); qA.copy(rig.quaternion);
    rig.position.copy(eyeB); rig.up.set(-1, 0, 0); rig.lookAt(atB); qB.copy(rig.quaternion);
    camera.position.lerpVectors(eyeA, eyeB, rc);
    camera.quaternion.slerpQuaternions(qA, qB, rc);
    // THE LAUNCH CAMERA (Marco, 2026-10-03: *"because of the angle of the camera it looks messy"* … *"try steeper
    // looking down"*): stopped, higher, looking down at 45° on the start of the page; PLAY glides it down into the Score
    // camera, STOP back up (*"stop goes to the topview - thats old - it goes to same start score view"*).
    const lu = view.lead ?? null;                   // the lead-in, 0–1, or null
    if (lu != null) holdAmt = 1 - easeIO(lu);       // from the launch view down to the Score camera, eased
    else holdAmt += ((view.hold ? 1 : 0) - holdAmt) * (first ? 1 : 1 - Math.exp(-dt / 0.8));
    if (holdAmt > 0.001) {
      atH.set(fx, 0, -5 * wide - 16 * (fitK - 1) * WIDE); eyeH.set(fx, 30 * wide, 25.5 * wide);   // 45°, the start of the page — clefs and names — in view
      rig.position.copy(eyeH); rig.up.set(0, 1, 0); rig.lookAt(atH); qH.copy(rig.quaternion);
      const h = smooth(holdAmt);
      camera.position.lerp(eyeH, h); camera.quaternion.slerp(qH, h);
    }
    // The lead-in's swing (Marco, 2026-10-04): back, then forward — a swell back (sin², still at both ends) and a
    // curve that leaves the camera moving forward at the score's own speed on the music's first beat.
    if (lu != null) {
      const T = 8 / Math.max(1, view.rate || 8), v = ZB * (view.rate || 8);   // the lead-in's two beats in seconds; the paper's speed
      camera.position.z += 9 * wide * Math.sin(Math.PI * lu) ** 2 + v * T * lu * lu * (1 - lu);
    }
    // 05: SWITCHING ON (docs/02 §2): the camera begins close on the standby light and eases back to the
    // launch view over the 3.5 s.
    const nearAmt = playing ? 0 : view.boot == null ? 1 : 1 - easeIO(Math.min(1, view.boot / 3.5));
    if (nearAmt > 0.001) {
      worldOf(LED_P + 6, LED_U - 1, 0, atN); worldOf(LED_P - 9, LED_U - 2, 12, eyeN);   // close, the light low in the frame, the staffs' start beyond it
      rig.position.copy(eyeN); rig.up.set(0, 1, 0); rig.lookAt(atN);
      camera.position.lerp(eyeN, nearAmt); camera.quaternion.slerp(rig.quaternion, nearAmt);
    }
    // 05: THE SHOTS (docs/01 §5): a double-tap goes to the next — 1 from above, 2 close on the selected staff,
    // 3 low along the page; 0 is the music's camera. The camera glides into a shot; it never cuts.
    const shot = view.shot || 0;
    shotW += ((shot ? 1 : 0) - shotW) * (1 - Math.exp(-dt / 0.7));
    if (shot) {
      const tanF = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
      if (shot === 1) {
        const d = ((U_TOP - U_BOT) / 2 + 4) / (tanF * Math.min(1, aspect));
        _sa.set(midX, 0, -22); _se.set(midX + 0.01, d, -22); rig.up.set(0, 0, -1);
      } else if (shot === 2) {
        const sx = staffX(selStaff >= 0 ? selStaff : 5);
        _sa.set(sx, 0, -9); _se.set(sx + 5 * fitK, 6 * fitK, 11 * fitK); rig.up.set(0, 1, 0);
      } else {
        _sa.set(midX - 6, 0, -34); _se.set(U0 - U_BOT + 10 * fitK, 5, 6); rig.up.set(0, 1, 0);
      }
      rig.position.copy(_se); rig.lookAt(_sa);
      if (shotFresh) { shotPos.copy(camera.position); shotQ.copy(camera.quaternion); shotFresh = false; }
      const k = 1 - Math.exp(-dt / 0.7);
      shotPos.lerp(_se, k); shotQ.slerp(rig.quaternion, k);
      camera.position.lerp(shotPos, shotW); camera.quaternion.slerp(shotQ, shotW);
    } else shotFresh = true;
    // 05: THE CAMERA PLAYED BY HAND (docs/01 §5) — turned round the score, glides on after the finger and slows
    // to a stop; pinched closer or further; moved sideways with two fingers; leaned by the phone's tilt; left
    // alone in CAMERA, it drifts on by itself, slowly. Selecting a staff in MUSIC brings it home.
    user.idle += dt;
    if (!user.touching) {
      const gk = Math.exp(-dt / 0.9);            // the glide: the dolly's weight
      user.yaw += user.vyaw * dt; user.pitch += user.vpitch * dt; user.vyaw *= gk; user.vpitch *= gk;
    }
    const drifting = view.camMode && user.idle > 5;
    user.drift += ((drifting ? 1 : 0) - user.drift) * (1 - Math.exp(-dt / 2.5));
    if (user.drift > 0.001) { user.yaw += 0.045 * user.drift * dt; user.pitch += 0.03 * user.drift * Math.sin(user.idle * 0.21) * dt; }
    if (view.home) { const hb = Math.exp(-dt / 0.6); user.yaw *= hb; user.pitch *= hb; user.dist *= hb; user.px *= hb; user.pz *= hb; user.vyaw *= hb; user.vpitch *= hb; }
    user.pitch = Math.max(-0.75, Math.min(0.9, user.pitch));
    user.dist = Math.max(-2.2, Math.min(1.4, user.dist));
    const tl = view.tilt || { x: 0, y: 0 }, tk = 1 - Math.exp(-dt / 0.4);
    tiltS.x += (tl.x - tiltS.x) * tk; tiltS.y += (tl.y - tiltS.y) * tk;
    // The pivot: where the camera looks, on the paper.
    _fwd.set(0, 0, -1).applyQuaternion(camera.quaternion);
    const tHit = _fwd.y < -0.05 ? -camera.position.y / _fwd.y : 40;
    pivot.copy(camera.position).addScaledVector(_fwd, Math.min(tHit, 160));
    _right.set(1, 0, 0).applyQuaternion(camera.quaternion); _right.y = 0; _right.normalize();
    qYaw.setFromAxisAngle(_up, user.yaw + 0.22 * tiltS.x);
    qPitch.setFromAxisAngle(_right, -(user.pitch + 0.16 * tiltS.y));
    qOrbit.copy(qYaw).multiply(qPitch);
    _v.copy(camera.position).sub(pivot).applyQuaternion(qOrbit).multiplyScalar(Math.pow(2, user.dist));
    camera.position.copy(pivot).add(_v);
    camera.quaternion.premultiply(qOrbit);
    camera.position.x += user.px; camera.position.z += user.pz;
    camera.position.y = Math.max(1.5, camera.position.y);   // the paper is a floor
    camera.updateMatrixWorld();

    // The fog: two bars sharp, then the dark over eight more; stopped, none over the eight bars.
    const depth = (p) => { worldOf(p, PAGE_MID_U, 0, _v).applyMatrix4(camera.matrixWorldInverse); return -_v.z; };
    const nearA = depth(CP + 2 * BAR * ZB), farA = depth(CP + 10 * BAR * ZB);
    const nearB = dist * 1.5, farB = dist * 3;
    scene.fog.near = nearA + (nearB - nearA) * r; scene.fog.far = farA + (farB - farA) * r;
    {                                              // 05: a turned or lifted camera keeps the page out of the fog
      const dNow = camera.position.distanceTo(worldOf(CP, PAGE_MID_U, 0, _v));
      scene.fog.near = Math.max(scene.fog.near, dNow * 1.15); scene.fog.far = Math.max(scene.fog.far, scene.fog.near * 2 + 40);
    }

    // The key light: over the selected staff at now; stopped, over the whole eight bars.
    const wantX = selStaff >= 0 ? staffX(selStaff) : midX;
    spotX = spotX == null ? wantX : spotX + (wantX - spotX) * (1 - Math.exp(-dt / 0.35));
    spotA.set(spotX - 38 * wide, 44 * wide, 26 * wide);   // 04: the key light stands back with the camera
    spotB.set(midX - 30, dist * 0.9, atB.z + 40);         // stopped: high over the page (it had slipped into the comment above)
    key.position.lerpVectors(spotA, spotB, r);
    key.target.position.set(spotX + (midX - spotX) * r, 0, -10 + (atB.z + 10) * r);
    key.angle = 0.42 + 0.36 * r;
    // THE REVEAL (Marco, 2026-10-03: *"do a light reveal of the score"*): the page opens dark and the
    // light comes up over it, slowly at first.
    if (view.powered !== false) revealT += dt;      // the launch's light waits for POWER ON
    const want = view.lights || {};
    for (const k in lightsOn) lightsOn[k] += ((want[k] === false ? 0 : 1) - lightsOn[k]) * (1 - Math.exp(-dt / LIGHT_FADE[k]));
    // The key light comes in slowly and eased (Marco, 2026-10-04): 3 s from PLAY, slow in, slow out.
    keyT = want.key === false ? 0 : Math.min(KEY_IN, keyT + dt);
    if (want.key !== false) lightsOn.key = easeIO(keyT / KEY_IN);
    key.intensity = (1.7 + 0.6 * r) * lightsOn.key;          // §45: lower, the wash the page is read by
    key.target.updateMatrixWorld();
    // The spots: each as its channel is heard, a lift from each hit; CUE holds the others to a third;
    // the selected one narrower and brighter. After the reveal they come up one by one, top to bottom.
    const hit = STAVES.map(() => 0);
    for (const x of lit) { const s = STAFF_OF[x.part]; if (s >= 0) hit[s] = Math.max(hit[s], Math.min(1, x.L)); }
    const cueOf = (p) => !!view.cue?.(p), anyCue = STAVES.some((st) => st.parts.some(cueOf));
    spots.forEach((l, s) => {
      const st = STAVES[s], p = st.parts[0], x = staffX(s), sel = s === selStaff;
      const on = smooth(Math.max(0, Math.min(1, (revealT - REVEAL_WAIT - REVEAL_S + 0.4 - s * 0.22) / 0.6)));
      let lv = staffOff(s) ? 0 : Math.max(0, Math.min(1, held[p] / 0.75)) + 0.5 * hit[s];
      if (anyCue) lv = st.parts.some(cueOf) ? 1 : lv / 3;
      spotLv[s] += (lv - spotLv[s]) * (1 - Math.exp(-dt / 0.08));
      const r = sel ? 5.6 : 6.4;                     // on its staff at now (Marco: not angled, not into the future)
      l.position.set(x, 0.03, -3); l.scale.set(r, 1, r);
      l.material.opacity = Math.min(1, 0.45 * spotLv[s] * (sel ? 1.3 : 1) * on * lightsOn.spots);
    });
    // The mirror ball: from high over the middle of the page, its pattern turning once in 24 s.
    const th = revealT * (2 * Math.PI / 24);
    mirror.position.set(midX + 14 * Math.sin(th), 90, -30 + 14 * Math.cos(th));
    mirror.target.position.set(midX, 0, -30); mirror.target.updateMatrixWorld();
    mirror.intensity = 5 * lightsOn.ball;
    mirror.castShadow = lightsOn.ball > 0.002;     // its shadow map drawn only while it is on
    // The disco lights: their own clock in beats, at the music's tempo while playing, a third of it stopped.
    discoT += dt * (rate / 4) * (playing ? 1 : 0.35);
    const barPh = (((view.now || 0) / 4) % 4) / 4, swell = playing ? 0.6 + 0.4 * (0.5 - 0.5 * Math.cos(2 * Math.PI * barPh)) : 0.6;
    DISCO.forEach((m, i) => {
      const a = 2 * Math.PI * (discoT / 16 + i / 4), b = 2 * Math.PI * (discoT / 24 + i * 0.37);
      m.position.set(midX + 36 * Math.sin(a), 0.04, -22 + 18 * Math.sin(b));
      m.scale.set(11, 1, 11);
      m.material.opacity = 0.55 * swell * lightsOn.disco;
      m.visible = lightsOn.disco > 0.002;
    });

    gMat.uniforms.uScale.value = renderer.getDrawingBufferSize(_size).y / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)));   // 03: the lens as it is now
    // THE GPU, MEASURED (Marco, 2026-10-03: *"too heavy on the gpu"*): the GPU's own time for each frame, where the
    // browser gives it (EXT_disjoint_timer_query_webgl2); averaged, read in the status bar. Null where it does not.
    // Lights that are off leave the scene: the GPU shades every light in it for every pixel, even at brightness 0.
    for (const l of spots) l.visible = lightsOn.spots > 0.002 && l.material.opacity > 0.002;
    for (const l of lamps) l.visible = lightsOn.lamps > 0.002;
    mirror.visible = lightsOn.ball > 0.002;
    key.visible = lightsOn.key > 0.002;
    gpuBegin();
    renderer.render(scene, camera);
    gpuEnd();
    first = false;
  }
  const _size = new THREE.Vector2();

  // 03: THE CINEMATIC CAMERA (docs/02, Marco said yes 2026-10-01). One designed shot per section of
  // the song, one eased move over its sixteen bars; a hard cut when the section changes, because the
  // pose is the shot's at q and nothing carries over; stopped, q stands still, so the shot holds.
  // Now is at z = 0, the future is −z, the melody's side of the page is −x; m mirrors a shot to the
  // other side of the page when its section is played again. Lenses are focal lengths on full frame.
  // No shot looks at the paper flatter than about 13°: lower, the relief shows its layers as steps
  // and the halos lie on it as pale slabs (measured, 2026-10-01).
  const LENS = (mm) => 2 * THREE.MathUtils.radToDeg(Math.atan(12 / mm));
  const ease = (x) => x * x * x * (x * (6 * x - 15) + 10);            // starts slow, moves, settles
  const _eye = new THREE.Vector3(), _at = new THREE.Vector3(), _e2 = new THREE.Vector3(), _a2 = new THREE.Vector3();
  const lerp = (a, b, t) => a + (b - a) * t;
  function frameShotScaled(fov, up = _up) { _eye.multiplyScalar(WIDE); _at.multiplyScalar(WIDE); return frameShot(fov, up); }
  function frameShot(fov, up = _up) {
    rig.position.copy(_eye); rig.up.copy(up); rig.lookAt(_at);
    camera.position.copy(_eye); camera.quaternion.copy(rig.quaternion);
    camera.fov = fov; camera.updateProjectionMatrix();
  }
  const _down = new THREE.Vector3(-1, 0, 0);                        // overhead: the top of the page up
  function shoot(shot, q, m) {
    m = -m;                                        // the staffs' order reversed (2026-10-03): the page is mirrored, so are the shots
    const e = ease(q);
    const frameShot = (fov, up) => frameShotScaled(fov, up);   // 04: 03's shots, scaled to the wider page
    switch (shot) {
      case 0:   // A · pad and sample — a crane down from high over the dark onto the start of the page
        _eye.set(-10 * m, 150, 90).lerp(_e2.set(-6 * m, 13, 28), e);
        _at.set(0, 0, -40).lerp(_a2.set(-3 * m, 0, -18), e);
        return frameShot(LENS(24));
      case 1:   // B · the beat — a tracking shot, low at the drums' edge of the page, pushing in
        _eye.set(46 * m, 15, 10).lerp(_e2.set(36 * m, 12, 4), e);
        _at.set(8 * m, 0, -10).lerp(_a2.set(6 * m, 0, -12), e);
        return frameShot(LENS(35));
      case 2:   // C · the bass — a long lens, low along the bass staff into the future, rising slowly
        _eye.set(9 * m, 22, 80).lerp(_e2.set(9 * m, 30, 74), e);
        _at.set(9 * m, 0, -10);
        return frameShot(LENS(135));
      case 3: { // D · the keys — a quarter arc around now on the keys' staff, from the page's side to behind
        const th = lerp(Math.PI, Math.PI / 2, e), R = 42, cx = -7.5 * m;
        _eye.set(cx + Math.cos(th) * R * m, 16, Math.sin(th) * R);
        _at.set(cx, 0, -6);
        return frameShot(LENS(50));
      }
      case 4:   // E · everything — close on the melody's ball, then a crane up and back to the whole band
        _eye.set(-15 * m, 7, 12).lerp(_e2.set(-4 * m, 70, 62), e);
        _at.set(-19.5 * m, 0, -6).lerp(_a2.set(0, 0, -34), e);
        return frameShot(lerp(LENS(24), LENS(35), e));
      default:  // F · the drums drop out — straight down, rising slowly away into the dark
        _eye.set(4 * m, lerp(70, 240, e), -14);
        _at.set(4 * m, 0, -14.01);
        return frameShot(LENS(85), _down);
    }
  }

  function resize(w, h) {
    W = Math.max(1, Math.round(w)); H = Math.max(1, Math.round(h));
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));   // 03: read on every resize
    renderer.setSize(W, H, false);
    camera.aspect = W / H; camera.updateProjectionMatrix();
  }

  const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
  const pageHit = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), hitAt = new THREE.Vector3();
  function pick(clientX, clientY) {
    const rect = canvas.getBoundingClientRect();
    ndc.set(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    const hits = ray.intersectObjects(pickable, false);
    for (const h of hits) {
      const b = h.object.userData.batch, g = b?.refs[h.instanceId];
      if (!g || (g.fade != null && g.fade < 0.5)) continue;
      const s = g.staff ?? (g.part >= 0 ? STAFF_OF[g.part] : null);
      const part = g.part >= 0 ? g.part : s != null ? STAVES[s].parts[0] : -1;
      const event = g.h?.ev || g.c?.ev || null;
      return { part, event, what: g.what, t: g.t ?? null, m: g.h?.m ?? null, staff: s != null ? STAVES[s].name : null };
    }
    if (!ray.ray.intersectPlane(pageHit, hitAt)) return null;
    const u = U0 - hitAt.x, p = CP - hitAt.z;
    if (u < U_BOT || u > U_TOP || p < -4) return null;
    let best = null;
    STAVES.forEach((st, s) => { const d = Math.abs(u - posU(s, 4)); if (d < 3.5 && (!best || d < best.d)) best = { s, d }; });
    if (!best) return { part: 7, event: null, what: 'paper', t: beatOf(p), m: null, staff: null };
    let part = STAVES[best.s].parts[0];

    return { part, event: null, what: 'staff', t: beatOf(p), m: null, staff: STAVES[best.s].name };
  }

  function anchor(part, beat) {
    // Near now: just behind it; risen, a little further back. 04: every part has its own staff.
    if (part == null || part < 0 || part >= NP || STAFF_OF[part] < 0) return null;
    const p = beat != null ? P(beat) : CP + 6 - 11 * risen;   // 04: just ahead of now, where the farther camera sees it
    const u = posU(STAFF_OF[part], 4);
    worldOf(p, u, 0.3, _v).project(camera);
    return { x: (_v.x + 1) / 2 * W, y: (1 - _v.y) / 2 * H, visible: _v.z < 1 && Math.abs(_v.x) <= 1 && Math.abs(_v.y) <= 1 };
  }

  function dispose() {
    for (const x of disposables) x.dispose?.();
    for (const b of Object.values(batches)) b.mesh.dispose?.();
    renderer.dispose();
  }

  // 05: the hand on the camera (docs/01 §5). Pixels from the caller; the glide is the caller's last speed.
  const touched = () => { user.idle = 0; user.drift = 0; };
  function orbit(dx, dy) { user.yaw -= dx * 0.006; user.pitch += dy * 0.005; user.vyaw = 0; user.vpitch = 0; touched(); }
  const cap = (x, m) => Math.max(-m, Math.min(m, x));
  function fling(vx, vy) { user.vyaw = cap(-vx * 0.006, 2.4); user.vpitch = cap(vy * 0.005, 1.2); touched(); }
  function pinch(k) { user.dist -= Math.log2(Math.max(0.2, Math.min(5, k))); touched(); }
  function pan(dx, dy) {
    const d = camera.position.distanceTo(pivot) * 0.0025;
    _right.set(1, 0, 0).applyQuaternion(camera.quaternion); _right.y = 0; _right.normalize();
    _fwd.set(0, 0, -1).applyQuaternion(camera.quaternion); _fwd.y = 0; _fwd.normalize();
    user.px += (-_right.x * dx + _fwd.x * dy) * d; user.pz += (-_right.z * dx + _fwd.z * dy) * d; touched();
  }
  function hold(on) { user.touching = on; if (on) { user.vyaw = 0; user.vpitch = 0; touched(); } }
  // Where to tap: the standby light, or an offered chord.
  function screenOf(what) {
    if (what === 'led') worldOf(LED_P, LED_U, 0.3, _v);
    else if (what && what.choice != null && choicePos[what.choice]) { const c = choicePos[what.choice]; worldOf(c.p, c.u, c.h, _v); }
    else return null;
    _v.project(camera);
    return { x: (_v.x + 1) / 2 * W, y: (1 - _v.y) / 2 * H, visible: _v.z < 1 && Math.abs(_v.x) <= 1.1 && Math.abs(_v.y) <= 1.1 };
  }

  const lightCount = () => scene.children.filter((o) => o.isLight && o.visible).length;
  return { frame, resize, pick, anchor, dispose, orbit, fling, pinch, pan, hold, touched, screenOf, user, camera, scene, get gpuMs() { return gpuMs; }, lightCount };
}
