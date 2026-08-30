// A single audio-level bus, 0..1, driven by whichever source is live: the mic
// while you talk, the TTS element while Cortana talks. The aura reads this, so
// it reacts to real amplitude instead of just spinning on a timer.

type Listener = (level: number) => void;

let ctx: AudioContext | null = null;
let analyser: AnalyserNode | null = null;
let source: AudioNode | null = null;
let raf = 0;
let level = 0;
const listeners = new Set<Listener>();

function ensureCtx(): AudioContext {
  // Constructed lazily: a context created before a user gesture starts
  // suspended and never produces data.
  ctx ??= new AudioContext();
  void ctx.resume().catch(() => undefined);
  return ctx;
}

function pump() {
  if (!analyser) return;
  const buf = new Uint8Array(analyser.frequencyBinCount);
  analyser.getByteTimeDomainData(buf);

  // RMS around the 128 midpoint → perceptual-ish loudness.
  let sum = 0;
  for (const v of buf) {
    const d = (v - 128) / 128;
    sum += d * d;
  }
  const rms = Math.sqrt(sum / buf.length);

  // Scale up (speech RMS is small), then asymmetric smoothing: jump to peaks,
  // fall away slowly, so the glow doesn't strobe between syllables.
  const target = Math.min(1, rms * 3.2);
  level = target > level ? target : level * 0.86 + target * 0.14;

  listeners.forEach((fn) => fn(level));
  raf = requestAnimationFrame(pump);
}

function attach(node: AudioNode) {
  detach();
  const c = ensureCtx();
  analyser = c.createAnalyser();
  analyser.fftSize = 512;
  node.connect(analyser);
  source = node;
  raf = requestAnimationFrame(pump);
}

export function attachStream(stream: MediaStream): void {
  attach(ensureCtx().createMediaStreamSource(stream));
}

export function attachElement(el: HTMLAudioElement): void {
  const c = ensureCtx();
  const node = c.createMediaElementSource(el);
  // Element sources are consumed by the graph — route to output or it's silent.
  node.connect(c.destination);
  attach(node);
}

export function detach(): void {
  cancelAnimationFrame(raf);
  raf = 0;
  try {
    source?.disconnect();
    analyser?.disconnect();
  } catch {
    // Already torn down; nothing to do.
  }
  source = null;
  analyser = null;
  level = 0;
  listeners.forEach((fn) => fn(0));
}

export function subscribe(fn: Listener): () => void {
  listeners.add(fn);
  fn(level);
  return () => listeners.delete(fn);
}
