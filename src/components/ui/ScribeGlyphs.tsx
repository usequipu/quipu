import { useEffect, useRef, useState } from 'react';

// Curated Unicode ranges from ancient scripts. Each tuple is an inclusive
// codepoint range. Coverage in the browser depends on whether any font
// in the stack (Google Fonts Noto Sans Historical, then system fallbacks)
// renders the codepoint — uncovered glyphs render as tofu (□). To avoid
// shipping tofu, we runtime-probe each codepoint with a canvas width
// measurement and keep only the ones that render with non-tofu width.
const SCRIPT_RANGES: Array<[number, number]> = [
  [0x12000, 0x123ff], // Cuneiform
  [0x11f00, 0x11f5f], // Kawi
  [0x10080, 0x100fa], // Linear B Ideograms
  [0x1d2e0, 0x1d2f3], // Mayan Numerals (full block, 0–19)
  [0x14400, 0x14646], // Anatolian Hieroglyphs
];

const SCRIBE_FONT_STACK =
  '"Noto Sans Cuneiform", "Noto Sans Linear B", "Noto Sans Anatolian Hieroglyphs", "Noto Sans Kawi", "Noto Sans Mayan Numerals", "Noto Sans", system-ui, sans-serif';

// Pre-flatten the codepoint pool so picking a random glyph is one
// random-int call instead of two (range, then offset). Computed once at
// module load. Filtered by the runtime coverage probe before use.
const RAW_GLYPH_POOL: number[] = (() => {
  const out: number[] = [];
  for (const [start, end] of SCRIPT_RANGES) {
    for (let cp = start; cp <= end; cp++) out.push(cp);
  }
  return out;
})();

// Mayan numerals 10–19 form a natural counting cycle. Used as the
// "loading" animation in place of a spinner — visually consistent with
// the scribe-glyph theme and language-agnostic.
const MAYAN_LOADER_CODEPOINTS: number[] = (() => {
  const out: number[] = [];
  for (let cp = 0x1d2ea; cp <= 0x1d2f3; cp++) out.push(cp);
  return out;
})();

const GLYPH_COUNT = 7;
const REGEN_THROTTLE_MS = 50;

/**
 * Runtime glyph-coverage probe. Renders each candidate codepoint with the
 * scribe font stack onto an offscreen canvas and compares its width
 * against the width of a known-uncovered reference codepoint (the tofu
 * glyph). Codepoints that render at the same width as the tofu are
 * filtered out.
 *
 * Returns the filtered pool. If everything is tofu (e.g. fonts haven't
 * loaded yet, or the OS truly lacks coverage), returns the Mayan numerals
 * 0–19 block as a fallback — this block is small, well-supported, and the
 * Mayan loader animation already works on the same surface.
 */
function probeCoveredGlyphs(): number[] {
  if (typeof document === 'undefined') return RAW_GLYPH_POOL;
  let canvas: HTMLCanvasElement;
  let ctx: CanvasRenderingContext2D | null;
  try {
    canvas = document.createElement('canvas');
    canvas.width = 32;
    canvas.height = 32;
    ctx = canvas.getContext('2d');
  } catch {
    return RAW_GLYPH_POOL;
  }
  if (!ctx) return RAW_GLYPH_POOL;
  ctx.font = `16px ${SCRIBE_FONT_STACK}`;

  // U+10FFFF is the last valid Unicode codepoint and is reserved/unassigned
  // — it should always render as tofu, giving us a per-engine baseline.
  // Some browsers reject lone surrogates; wrap in try/catch for safety.
  let tofuWidth = 0;
  try {
    tofuWidth = ctx.measureText(String.fromCodePoint(0x10ffff)).width;
  } catch {
    return RAW_GLYPH_POOL;
  }

  const covered: number[] = [];
  for (const cp of RAW_GLYPH_POOL) {
    const w = ctx.measureText(String.fromCodePoint(cp)).width;
    // Cover when the rendered width differs from the tofu reference.
    // Allow a tiny tolerance for sub-pixel rounding.
    if (Math.abs(w - tofuWidth) > 0.5 && w > 0) covered.push(cp);
  }

  if (covered.length < 10) {
    // Pool too small — likely the historical fonts haven't loaded yet
    // (or aren't reachable). Fall back to the always-tested Mayan block.
    const fallback: number[] = [];
    for (let cp = 0x1d2e0; cp <= 0x1d2f3; cp++) fallback.push(cp);
    return fallback;
  }
  return covered;
}

// Lazy module-level cache. The first ScribeGlyphs render computes it; any
// subsequent re-mount or document.fonts.ready hook reuses the result.
let _glyphPool: number[] | null = null;
function getGlyphPool(): number[] {
  if (_glyphPool === null) _glyphPool = probeCoveredGlyphs();
  return _glyphPool;
}

function randomGlyph(): string {
  const pool = getGlyphPool();
  const cp = pool[Math.floor(Math.random() * pool.length)];
  return String.fromCodePoint(cp);
}

function initialGlyphs(): string[] {
  return Array.from({ length: GLYPH_COUNT }, () => randomGlyph());
}

/**
 * Ambient 7-character display of randomly-sampled ancient-script glyphs.
 * Rotates one glyph (LRU-style) on every input or selection change in the
 * document, throttled so heavy typing doesn't churn the DOM. Initial state
 * is randomized at mount.
 */
export function ScribeGlyphs() {
  const [glyphs, setGlyphs] = useState<string[]>(initialGlyphs);
  const cursorRef = useRef(0);
  const lastRegenRef = useRef(0);

  // Re-probe coverage and reset the displayed glyphs once the historical
  // fonts have finished loading. The first probe (at module load) may run
  // before Google Fonts arrives over the network, in which case the pool
  // falls back to Mayan numerals; this effect upgrades to the full pool
  // once the @font-face faces are ready.
  useEffect(() => {
    if (typeof document === 'undefined' || !('fonts' in document)) return;
    let cancelled = false;
    document.fonts.ready
      .then(() => {
        if (cancelled) return;
        _glyphPool = null; // force re-probe with the now-loaded fonts
        setGlyphs(initialGlyphs());
      })
      .catch(() => { /* ignore */ });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    const tick = () => {
      const now = performance.now();
      if (now - lastRegenRef.current < REGEN_THROTTLE_MS) return;
      lastRegenRef.current = now;
      setGlyphs((prev) => {
        const next = prev.slice();
        next[cursorRef.current] = randomGlyph();
        cursorRef.current = (cursorRef.current + 1) % GLYPH_COUNT;
        return next;
      });
    };

    document.addEventListener('input', tick, { capture: true });
    document.addEventListener('selectionchange', tick);
    return () => {
      document.removeEventListener('input', tick, { capture: true });
      document.removeEventListener('selectionchange', tick);
    };
  }, []);

  return (
    <span
      aria-hidden
      title="Scribe glyphs"
      // Match the Connect-to-Kamalu button's text color exactly — no
      // opacity dim, just the activity-bar foreground. Inheritance from
      // the parent <div> is set up by StatusBar but explicit color here
      // keeps the display robust against future container changes.
      className="font-medium tracking-wider text-[12px] leading-none select-none text-text-tertiary"
      // Noto Sans Historical fonts loaded from Google Fonts (see
      // src/index.css). The fallback chain protects against any single
      // family failing to load — but with the @import in place the
      // Latin/system fallback shouldn't be hit for the curated SCRIPT_RANGES.
      style={{ fontFamily: '"Noto Sans Cuneiform", "Noto Sans Linear B", "Noto Sans Anatolian Hieroglyphs", "Noto Sans Kawi", "Noto Sans Mayan Numerals", "Noto Sans", system-ui, sans-serif' }}
    >
      {glyphs.join('')}
    </span>
  );
}

/**
 * Loading animation in place of a spinner: cycles through the Mayan
 * numerals 10–19 at a steady cadence. Used by StatusBar when Kamalu is
 * connecting.
 */
export function MayanLoader({ intervalMs = 150 }: { intervalMs?: number }) {
  const [index, setIndex] = useState(0);

  useEffect(() => {
    const id = setInterval(() => {
      setIndex((i) => (i + 1) % MAYAN_LOADER_CODEPOINTS.length);
    }, intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);

  const glyph = String.fromCodePoint(MAYAN_LOADER_CODEPOINTS[index]);
  return (
    <span
      aria-hidden
      className="inline-block leading-none text-[14px] shrink-0"
      style={{ fontFamily: '"Noto Sans Mayan Numerals", "Noto Sans", system-ui, sans-serif' }}
    >
      {glyph}
    </span>
  );
}
