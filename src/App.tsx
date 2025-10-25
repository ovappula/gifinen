import { useEffect, useMemo, useState } from "react";
import { motion, AnimatePresence, useMotionValue, useTransform, animate } from "framer-motion";


/**
 * Tinder‑like GIF swiper
 * ---------------------------------------------------------
 * • Drag (left/right) on desktop or touch to Like / Dislike
 * • Click buttons or use ← / → keys
 * • Results saved to localStorage (per GIF URL)
 * • Paste your own GIF URLs (one per line) or hardcode them below
 * • Minimal, single‑file React component + Tailwind classes
 *
 * Optional (persistence): implement POST /vote in your backend and
 * call persistVote(url, decision) where indicated.
 */

// Auto-import every .gif in src/assets/gifs as URLs
const ALL_GIFS: string[] = Object.values(
  import.meta.glob("/src/assets/gifs/*.{gif,GIF}", { eager: true, as: "url" })
);

// Use these as your deck
const DEFAULT_GIFS: string[] = ALL_GIFS;

// ----- Utility: preload images to reduce flicker -----
function usePreload(urls: string[]) {
  useEffect(() => {
    const imgs = urls.map((u) => {
      const img = new Image();
      img.src = u;
      return img;
    });
    return () => {
      imgs.forEach((img) => (img.src = ""));
    };
  }, [urls.join("|")]);
}

// Decode images so the browser has them decoded into memory before we
// attempt to render them as the next card. Returns a map of url->ready.
function useDecoded(urls: string[]) {
  const [ready, setReady] = useState<Record<string, boolean>>({});

  useEffect(() => {
    let mounted = true;
    const imgs: HTMLImageElement[] = [];
    urls.forEach((u) => {
      if (ready[u]) return;
      const img = new Image();
      img.src = u;
      imgs.push(img);
      // Prefer decode() when available so the image is fully decoded
      // before we attempt to paint it.
      if ((img as any).decode) {
        (img as any)
          .decode()
          .then(() => {
            if (!mounted) return;
            setReady((r) => ({ ...r, [u]: true }));
          })
          .catch(() => {
            if (!mounted) return;
            setReady((r) => ({ ...r, [u]: true }));
          });
      } else {
        // Fallback: treat it as ready once the src is set (best-effort)
        img.onload = () => {
          if (!mounted) return;
          setReady((r) => ({ ...r, [u]: true }));
        };
        img.onerror = () => {
          if (!mounted) return;
          setReady((r) => ({ ...r, [u]: true }));
        };
      }
    });

    return () => {
      mounted = false;
      imgs.forEach((i) => (i.src = ""));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [urls.join("|")]);

  return ready;
}

// ----- Local storage helpers -----
const LS_KEY = "gif-swipe-votes"; // { [url]: "like" | "dislike" }
function loadVotes() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    return raw ? (JSON.parse(raw) as Record<string, "like" | "dislike">) : {};
  } catch {
    return {} as Record<string, "like" | "dislike">;
  }
}
function saveVotes(v: Record<string, "like" | "dislike">) {
  localStorage.setItem(LS_KEY, JSON.stringify(v));
}

// Optional backend persistence stub
async function persistVote(_url: string, _decision: "like" | "dislike") {
  // await fetch("/vote", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url: _url, decision: _decision }) });
}

// (old GifCard helper removed — SwipeCard handles per-card motion/overlays)

// ----- Main App -----
export default function App() {
  const [inputMode, setInputMode] = useState(false);
  const [gifInput, setGifInput] = useState("");
  const [deck, setDeck] = useState<string[]>(() => {
    const fromInput = [] as string[];
    return fromInput.length ? fromInput : DEFAULT_GIFS;
  });
  const [index, setIndex] = useState(0); // current top card index
  const [leaving, setLeaving] = useState<null | "left" | "right">(null);
  const [votes, setVotes] = useState<Record<string, "like" | "dislike">>(loadVotes());
  // When the deck finishes, we'll compute a randomized gallery order
  const [galleryOrder, setGalleryOrder] = useState<string[] | null>(null);
  // Whether the top card is actively being dragged — used to avoid
  // showing a confusing preview of the wrong card behind it.
  const [topDragging, setTopDragging] = useState(false);
  
  // (per-card motion values live inside SwipeCard)

  // Preload current + next and decode the next few so they render smoothly.
  usePreload(deck.slice(index, Math.min(deck.length, index + 4)));
  const decoded = useDecoded(deck.slice(index, Math.min(deck.length, index + 4)));

  // Keyboard support
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowLeft") handleDecision("left");
      if (e.key === "ArrowRight") handleDecision("right");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [index, deck]);

  const progress = useMemo(() => (deck.length ? (index / deck.length) * 100 : 0), [index, deck.length]);

  function applyInputList() {
    const urls = gifInput
      .split(/\n|,/) // newline or comma separated
      .map((s) => s.trim())
      .filter((s) => s.endsWith(".gif") || s.includes("giphy") || s.startsWith("http"));
    if (urls.length) {
      setDeck(urls);
      setIndex(0);
      setVotes({});
      saveVotes({});
      setGalleryOrder(null);
      setTopDragging(false);
      setInputMode(false);
    }
  }

  function resetDeck() {
    setIndex(0);
    setVotes({});
    saveVotes({});
    setLeaving(null);
    setGalleryOrder(null);
    setTopDragging(false);
  }

  // Shuffle and prepare gallery once when the deck finishes
  useEffect(() => {
    if (index < deck.length) return;
    if (galleryOrder) return; // already prepared

    // Keep unique URLs and shuffle
    const unique = Array.from(new Set(deck));
    // Fisher-Yates shuffle
    for (let i = unique.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [unique[i], unique[j]] = [unique[j], unique[i]];
    }
    setGalleryOrder(unique);
  }, [index, deck, galleryOrder]);

  function handleDecision(direction: "left" | "right") {
    if (index >= deck.length || leaving) return;
    // mark which direction this top card is leaving so the exit animation
    // can read the direction before the card is removed from the DOM
    setLeaving(direction);
    const url = deck[index];
    const decision = direction === "right" ? "like" : "dislike";

    // save vote immediately
    const next = { ...votes, [url]: decision } as Record<string, "like" | "dislike">;
    setVotes(next);
    saveVotes(next);
    persistVote(url, decision).catch(() => void 0);

    // advance the deck after a short delay so the exit animation plays
    // (the SwipeCard uses the `leaving` prop to choose its exit direction)
    setTimeout(() => {
      setIndex((i) => i + 1);
      setLeaving(null);
    }, 260);
  }

  function undo() {
    if (index === 0) return;
    const prevIdx = index - 1;
    const url = deck[prevIdx];
    const next = { ...votes };
    delete next[url];
    setVotes(next);
    saveVotes(next);
    setIndex(prevIdx);
    setLeaving(null);
  }

  const remaining = deck.length - index;
  const liked = Object.values(votes).filter((v) => v === "like").length;
  const disliked = Object.values(votes).filter((v) => v === "dislike").length;

  return (
    <div className="min-h-screen bg-gradient-to-b from-pink-50 via-slate-50 to-slate-100 flex flex-col items-center p-6">
      <header className="w-full max-w-xl mb-4">
        <h1 className="text-2xl font-semibold tracking-tight">🐻 Tyttiksen hupsuttelu tinder</h1>
        <p className="text-sm text-slate-600">Pyyhkäise oikealle (Joppaa) tai vasemmalle (Eippaa). Käytä nuolia tai nappeja myös.</p>
        {/* progress */}
        <div className="mt-3 h-2 w-full rounded-full bg-slate-200 overflow-hidden">
          <div className="h-full bg-slate-800" style={{ width: `${progress}%` }} />
        </div>
      </header>

      {/* Controls row */}
      <div className="w-full max-w-xl flex flex-wrap items-center justify-between gap-2 mb-4">
        <div className="text-sm text-slate-700">Pehmoisuutta jäljellä: <b>{remaining}</b> · Pehmoisia: <b>{liked}</b> · Did pehmoisia: <b>{disliked}</b></div>
        <div className="flex gap-2">
          <button onClick={undo} className="px-3 py-1.5 rounded-xl bg-white shadow border border-slate-200 text-sm disabled:opacity-50" disabled={index === 0}>Undo</button>
          <button onClick={resetDeck} className="px-3 py-1.5 rounded-xl bg-white shadow border border-slate-200 text-sm">Reset</button>
        </div>
      </div>

      {/* Input panel */}
      {inputMode && (
        <div className="w-full max-w-xl mb-4 p-4 rounded-2xl bg-white shadow border border-slate-200">
          <p className="text-sm mb-2 text-slate-700">Paste .gif URLs here (one per line, or comma separated), then <b>Apply</b>:</p>
          <textarea value={gifInput} onChange={(e) => setGifInput(e.target.value)} placeholder={`https://…/a.gif\nhttps://…/b.gif`} className="w-full h-32 p-3 rounded-xl border border-slate-300 focus:outline-none focus:ring-2 focus:ring-slate-400" />
          <div className="mt-3 flex gap-2 justify-end">
            <button onClick={() => setInputMode(false)} className="px-3 py-1.5 rounded-xl bg-slate-100 text-slate-800">Cancel</button>
            <button onClick={applyInputList} className="px-3 py-1.5 rounded-xl bg-slate-900 text-white">Apply</button>
          </div>
        </div>
      )}

      {/* Card stack */}
      <div className="relative w-full max-w-xl h-[520px]">
        <AnimatePresence>
          {deck.slice(index, index + 3).map((url, i) => {
            const isTop = i === 0;
            // Slight stacking effect for next cards
            const yOffset = i * 10;
            const scale = 1 - i * 0.03;
            return (
              <SwipeCard
                key={url}
                url={url}
                isTop={isTop}
                initial={{ y: yOffset, scale, rotate: 0, opacity: 1 }}
                onDecision={handleDecision}
                leaving={isTop ? leaving : null}
                setTopDragging={setTopDragging}
                isDecoded={!!decoded[url]}
                isPreviewHidden={topDragging}
              />
            );
          })}
        </AnimatePresence>

        {/* End-of-deck: show a gallery (shuffled, unique) with vote overlays */}
        {index >= deck.length && (
          <div className="absolute inset-0 p-4 rounded-3xl bg-white shadow border border-slate-200 overflow-auto">
            <div className="flex items-center justify-between mb-3">
              <div>
                <h2 className="text-lg font-semibold">Pehmoisuusgalleria</h2>
              </div>
              <div className="flex items-center gap-2">
                <div className="text-sm text-slate-700">Pehmoisia: <b>{liked}</b></div>
                <div className="text-sm text-slate-700">Did pehmoisia: <b>{disliked}</b></div>
                <button onClick={resetDeck} className="px-3 py-1 rounded-xl bg-slate-900 text-white">Reset</button>
              </div>
            </div>

            {galleryOrder && galleryOrder.length ? (
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
                {galleryOrder.map((url) => {
                  const v = votes[url];
                  const isLike = v === "like";
                  const label = isLike ? "Joppaa" : v === "dislike" ? "Eippaa" : "—";
                  const bg = isLike ? "bg-green-600/90" : v === "dislike" ? "bg-red-600/90" : "bg-slate-400/80";
                  return (
                    <div key={url} className="relative rounded-xl overflow-hidden border border-slate-200 bg-black/5">
                      <img src={url} alt="gif" className="w-full h-40 object-contain bg-white" draggable={false} />
                      <div className={`absolute top-2 left-2 px-2 py-1 rounded-md text-xs font-semibold text-white ${bg}`}>{label}</div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="text-center text-slate-600">Valmistellaan galleria…</div>
            )}
          </div>
        )}
      </div>

      {/* Bottom action buttons */}
      <div className="mt-5 flex items-center gap-6">
        <button
          onClick={() => handleDecision("left")}
          className="h-14 w-14 rounded-full bg-white shadow-lg border border-slate-200 text-slate-800 text-lg"
          aria-label="Dislike"
        >
          ✖
        </button>
        <button
          onClick={() => handleDecision("right")}
          className="h-16 w-16 rounded-full bg-slate-900 text-white shadow-lg text-xl"
          aria-label="Like"
        >
          ♥
        </button>
      </div>

      <footer className="mt-6 text-xs text-slate-500 max-w-xl text-center">
        Copyright nalle artisti 2025
      </footer>
    </div>
  );
}

function SwipeCard({
  url,
  isTop,
  initial,
  onDecision,
  leaving,
  setTopDragging,
  isDecoded,
  isPreviewHidden,
}: {
  url: string;
  isTop: boolean;
  initial: any;
  onDecision: (dir: "left" | "right") => void;
  leaving: null | "left" | "right";
  setTopDragging?: (v: boolean) => void;
  isDecoded?: boolean;
  isPreviewHidden?: boolean;
}) {
  const x = useMotionValue(0);
  const rotate = useTransform(x, [-300, 0, 300], [-30, 0, 30]);

  const likeOpacity = useTransform(x, [0, 120], [0, 0.8]);
  const nopeOpacity = useTransform(x, [-120, 0], [0.8, 0]);

  // decode / readiness info for this card
  const ready = typeof isDecoded === "boolean" ? isDecoded : true;

  const SWIPE_THRESHOLD = 120;

  const exitX = leaving === "left" ? -500 : leaving === "right" ? 500 : 0;
  const exitRotate = leaving ? (leaving === "left" ? -12 : 12) : 0;

  // If the parent marked this card as leaving, animate it off-screen
  // immediately so the user sees the card fly away in the chosen
  // direction. The parent will advance `index` shortly after.
  useEffect(() => {
    if (!leaving) return;
    const target = leaving === "right" ? 600 : -600;
    // animate this card's x to the target so it visibly flies away
    animate(x, target, { type: "spring", stiffness: 220, damping: 30 });
  }, [leaving]);

  return (
    <motion.div
      className="absolute inset-0 p-2"
      initial={{ opacity: 0, y: 20, scale: 0.98 }}
      animate={{ opacity: 1, y: initial.y, scale: initial.scale }}
      exit={{ opacity: 0, x: exitX, rotate: exitRotate, transition: { duration: 0.25 } }}
    >
      <motion.div
        // ✅ allow free horizontal dragging for the top card only
        drag={isTop && !leaving ? "x" : false}
        dragMomentum={false}
        // ❌ remove this – it was preventing movement
        // dragConstraints={{ left: 0, right: 0 }}
        onDragStart={() => setTopDragging?.(true)}
        onDrag={(_, info) => x.set(info.offset.x)}
        onDragEnd={(_, info) => {
          setTopDragging?.(false);
          if (info.offset.x > SWIPE_THRESHOLD) onDecision("right");
          else if (info.offset.x < -SWIPE_THRESHOLD) onDecision("left");
          else animate(x, 0, { type: "spring", stiffness: 500, damping: 35 });
        }}
        className={`relative h-full rounded-3xl overflow-hidden bg-white border border-slate-200 shadow-xl cursor-grab active:cursor-grabbing select-none ${isTop ? "z-10" : "z-0"}`}
        style={{ x, rotate, touchAction: "none" }}   // ✅ important for consistent pointer behavior
      >
        {/* The GIF */}
        <img
          src={url}
          alt="gif"
          className={`h-full w-full object-contain bg-black/5 pointer-events-none ${(!ready || (!isTop && isPreviewHidden)) ? "filter blur-sm scale-105 opacity-60" : ""}`}
          draggable={false}
        />

        {/* If the image isn't ready yet, show a small overlay spinner/text */}
        {(!ready || (!isTop && isPreviewHidden)) && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div className="bg-white/70 px-3 py-1 rounded-md text-sm text-slate-700">Loading…</div>
          </div>
        )}

        {/* Overlays */}
        <motion.div
          className="pointer-events-none absolute inset-0 bg-gradient-to-r from-green-500/80 to-transparent flex items-center justify-start p-8"
          style={{ opacity: likeOpacity }}
        >
          <div className="transform -rotate-12">
            <div className="text-6xl font-bold text-white drop-shadow-lg">Pehmoinen</div>
          </div>
        </motion.div>
        <motion.div
          className="pointer-events-none absolute inset-0 bg-gradient-to-l from-red-500/80 to-transparent flex items-center justify-end p-8"
          style={{ opacity: nopeOpacity }}
        >
          <div className="transform rotate-12">
            <div className="text-6xl font-bold text-white drop-shadow-lg">Did pehmoinen</div>
          </div>
        </motion.div>
      </motion.div>
    </motion.div>
  );
}
