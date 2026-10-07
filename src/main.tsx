import { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { CONFIG } from "./config";
import { Card, cardFromHash, cardUrl, conditionPhrase, isLocalBase, makeCard } from "./card";
import { AudioEngine, resample, rms } from "./audio";
import { AudioMatcher, MatchResult, createMatcher } from "./matcher";
import { Detector, Level } from "./detector";
import "./styles.css";

type View = "home" | "create" | "intro" | "listen" | "found" | "unlocked";

function App() {
  const [card, setCard] = useState<Card | null>(() => cardFromHash(location.hash));
  const [view, setView] = useState<View>(card ? "intro" : "home");
  const engine = useRef<AudioEngine | null>(null);
  const begin = () => { engine.current = new AudioEngine(); engine.current.prepare(); setView("listen"); }; // inside the tap

  const open = (c: Card) => { setCard(c); setView("intro"); };
  const exit = () => { history.replaceState(null, "", location.pathname + location.search); setCard(null); setView("home"); };

  return (
    <main className="screen">
      {view === "home" && <Home onCreate={() => setView("create")} />}
      {view === "create" && <Create onBack={() => setView("home")} onPreview={open} />}
      {view === "intro" && card && <Intro card={card} onStart={begin} onBack={exit} />}
      {view === "listen" && card && engine.current && <Listen eng={engine.current} card={card} onFound={() => setView("found")} onCancel={() => setView("intro")} />}
      {view === "found" && <Found onOpen={() => setView("unlocked")} />}
      {view === "unlocked" && card && <Unlocked card={card} onClose={exit} />}
    </main>
  );
}

function Home({ onCreate }: { onCreate: () => void }) {
  const [link, setLink] = useState("");
  const go = () => {
    const c = cardFromHash(link);
    if (c) { location.hash = link.slice(link.indexOf("c=")); location.reload(); }
    else alert("That doesn't look like an Open When link.");
  };
  return (
    <>
      <p className="label">Open when</p>
      <h1 className="big">Messages that open when the world says so.</h1>
      <div className="stack">
        <button className="btn" onClick={onCreate}>Create a card</button>
        <input className="field" placeholder="Paste a card link to open it" value={link} onChange={(e) => setLink(e.target.value)} onKeyDown={(e) => e.key === "Enter" && go()} />
      </div>
    </>
  );
}

function Create({ onBack, onPreview }: { onBack: () => void; onPreview: (c: Card) => void }) {
  const [condition, setCondition] = useState("");
  const [message, setMessage] = useState("");
  const [from, setFrom] = useState("");
  const [made, setMade] = useState<Card | null>(null);
  const [err, setErr] = useState("");
  const [copied, setCopied] = useState(false);
  const [base, setBase] = useState(() => {
    try { return localStorage.getItem("ow:base") || (import.meta.env.VITE_PUBLIC_URL as string) || location.origin + location.pathname; }
    catch { return location.origin + location.pathname; }
  });
  const editBase = (v: string) => { setBase(v); try { localStorage.setItem("ow:base", v); } catch {} };
  const local = isLocalBase(base);

  const create = () => { try { setMade(makeCard({ condition, message, from })); setErr(""); } catch (e: any) { setErr(e.message); } };
  const copy = async () => { await navigator.clipboard.writeText(cardUrl(made!, base)); setCopied(true); };

  if (made) return (
    <>
      <p className="label">Card ready</p>
      <h1 className="big">Open when you hear {conditionPhrase(made.condition)}.</h1>
      <p className="quiet">Send this link. The message stays sealed inside it.</p>
      {local && (
        <>
          <p className="err">This link points at {new URL(base).host || "your own device"}, so other phones can't open it. Paste the address of your deployed app (https://…):</p>
          <input className="field mono" placeholder="https://open-when.vercel.app" onChange={(e) => editBase(e.target.value)} />
        </>
      )}
      <input className="field mono" readOnly value={cardUrl(made, base)} onFocus={(e) => e.target.select()} />
      <div className="row">
        <button className="btn" onClick={copy}>{copied ? "Copied" : "Copy link"}</button>
        <button className="btn ghost" onClick={() => onPreview(made)}>Try it</button>
      </div>
    </>
  );

  return (
    <>
      <p className="label">Open when…</p>
      <input className="field big-field" placeholder="you hear running water" value={condition} onChange={(e) => setCondition(e.target.value)} list="sugg" />
      <datalist id="sugg">{CONFIG.suggestions.map((s) => <option key={s} value={`you hear ${s}`} />)}</datalist>
      <p className="label">Your message</p>
      <textarea className="field" rows={5} placeholder="You made it. I knew you would." value={message} onChange={(e) => setMessage(e.target.value)} />
      <input className="field" placeholder="Your name (optional)" value={from} onChange={(e) => setFrom(e.target.value)} />
      {err && <p className="err">{err}</p>}
      <div className="row">
        <button className="btn" onClick={create}>Create card</button>
        <button className="btn ghost" onClick={onBack}>Back</button>
      </div>
    </>
  );
}

function Intro({ card, onStart, onBack }: { card: Card; onStart: () => void; onBack: () => void }) {
  return (
    <>
      <p className="label">Open when</p>
      <h1 className="big">you hear<br />{conditionPhrase(card.condition)}.</h1>
      <hr />
      <p className="quiet">Put your phone away.<br />Walk normally.<br />It will tell you when you're close.</p>
      <div className="row">
        <button className="btn" onClick={onStart}>Begin</button>
        <button className="btn ghost" onClick={onBack}>Leave</button>
      </div>
    </>
  );
}

interface Dbg { rms: number; windows: number; skipped: number; res: MatchResult; margin: number; smoothed: number; hits: number; level: Level }
const bar = (v: number) => "█".repeat(Math.round(v * 10)).padEnd(10, "░");

function Listen({ eng, card, onFound, onCancel }: { eng: AudioEngine; card: Card; onFound: () => void; onCancel: () => void }) {
  const [status, setStatus] = useState("Preparing the listener…");
  const [secs, setSecs] = useState(0);
  const [level, setLevel] = useState<Level>("none");
  const [debug, setDebug] = useState(() => new URLSearchParams(location.search).has("debug"));
  const [dbg, setDbg] = useState<Dbg | null>(null);
  const [fileRes, setFileRes] = useState<MatchResult | null>(null);
  const levelRef = useRef<Level>("none");
  const matcherRef = useRef<AudioMatcher | null>(null);

  useEffect(() => {
    let dead = false, busy = false, windows = 0, skipped = 0;
    const matcher = createMatcher(), det = new Detector();
    matcherRef.current = matcher;
    (async () => {
      try {
        // Mic permission + context were started in the Begin tap; model loads in parallel.
        await Promise.all([matcher.load((p) => setStatus(`Loading model ${p}%`)), eng.ready]);
        if (dead) return;
        setStatus("Listening");
        eng.listen(async (audio) => {
          if (busy || dead) return;
          busy = true;
          try {
            windows++;
            const level_ = rms(audio);
            let res: MatchResult = { score: 0, scores: [], ms: 0 };
            if (level_ < CONFIG.audio.silenceRms) { skipped++; setStatus("Mic is silent. Check the browser's mic permission."); }
            else { res = await matcher.match(audio, card.condition); setStatus("Listening"); }
            const r = det.push(res.score);
            const rival = res.scores.find((x) => x.label !== conditionPhrase(card.condition))?.score ?? 0;
            levelRef.current = r.level; setLevel(r.level);
            setDbg({ rms: level_, windows, skipped, res, margin: res.score - rival, smoothed: r.smoothed, hits: r.hits, level: r.level });
            if (r.level === "confirmed" && !dead) { dead = true; eng.chime(); setTimeout(() => { eng.stop(); onFound(); }, 900); }
          } catch (e: any) { setStatus("Model error: " + (e?.message ?? e)); }
          finally { busy = false; }
        });
      } catch (e: any) {
        setStatus(e?.name === "NotAllowedError" ? "Microphone access is blocked. Allow it and try again." : "Couldn't start: " + (e?.message ?? e));
      }
    })();
    const clock = setInterval(() => setSecs((x) => x + 1), 1000);
    let tick = 0;
    const fb = setInterval(() => {
      tick++;
      const l = levelRef.current, f = CONFIG.feedback;
      if ((l === "medium" && tick % f.mediumEveryTicks === 0) || (l === "high" && tick % f.highEveryTicks === 0)) {
        eng.beep(l === "high" ? 880 : 520, 60, l === "high" ? 0.2 : 0.1); eng.pulse();
      }
    }, CONFIG.feedback.tickMs);
    return () => { dead = true; eng.stop(); clearInterval(clock); clearInterval(fb); };
  }, []);

  // Scores a recorded file through the same model, to separate "mic capture" problems from "model" problems.
  const scoreFile = async (f: File) => {
    if (!matcherRef.current) return;
    const ctx = new AudioContext();
    const buf = await ctx.decodeAudioData(await f.arrayBuffer());
    ctx.close();
    const ch = resample(buf.getChannelData(0), buf.sampleRate, CONFIG.model.sampleRate);
    const win = CONFIG.audio.windowSec * CONFIG.model.sampleRate, start = Math.max(0, Math.floor((ch.length - win) / 2));
    setFileRes(await matcherRef.current.match(ch.slice(start, start + win), card.condition));
  };

  const t = `${String(Math.floor(secs / 60)).padStart(2, "0")}:${String(secs % 60).padStart(2, "0")}`;
  const phrase = conditionPhrase(card.condition);
  return (
    <>
      <p className="label">Open when</p>
      <div className="listen">
        <span className={`dot ${level}`} />
        <p className="quiet">{phrase}</p>
        <p className="label">{status}</p>
      </div>
      {debug && (
        <pre className="debug">
{`MIC      ${eng.info().state}  ${eng.info().rate}Hz (track ${eng.info().track || "?"})
LEVEL    ${dbg ? dbg.rms.toFixed(4) : "-"} rms  ${dbg && dbg.rms < CONFIG.audio.silenceRms ? "SILENT" : ""}
WINDOWS  ${dbg?.windows ?? 0} (silent ${dbg?.skipped ?? 0})  ${dbg?.res.ms ?? 0}ms/inference
`}
{(dbg?.res.scores ?? []).slice(0, 5).map((x) => `${x.label.padEnd(16).slice(0, 16)} ${x.score.toFixed(2)} ${bar(x.score)}${x.label === phrase ? " <" : ""}\n`).join("")}
{dbg ? `MARGIN   ${dbg.margin >= 0 ? "+" : ""}${dbg.margin.toFixed(2)}\nSMOOTHED ${bar(dbg.smoothed)} ${dbg.smoothed.toFixed(2)}\nHITS     ${dbg.hits}/${CONFIG.detection.hitsRequired} needed   ${dbg.level.toUpperCase()}` : "waiting for first window…"}
{fileRes ? `\nFILE     ${fileRes.scores.slice(0, 3).map((x) => `${x.label} ${x.score.toFixed(2)}`).join(" | ")}` : ""}
        </pre>
      )}
      {debug && <label className="label">Score a sound file <input type="file" accept="audio/*" onChange={(e) => e.target.files?.[0] && scoreFile(e.target.files[0])} /></label>}
      <p className="quiet">Phone can stay in your pocket.</p>
      <div className="row between">
        <span className="mono dim">{t}</span>
        <span className="row">
          <button className="btn ghost small" onClick={() => setDebug(!debug)}>Debug</button>
          <button className="btn ghost small" onClick={onCancel}>Stop</button>
        </span>
      </div>
    </>
  );
}

function Found({ onOpen }: { onOpen: () => void }) {
  return (
    <>
      <p className="label">Found</p>
      <h1 className="big">Condition met.</h1>
      <p className="quiet">You can open your message now.</p>
      <button className="btn" onClick={onOpen}>Open</button>
    </>
  );
}

function Unlocked({ card, onClose }: { card: Card; onClose: () => void }) {
  return (
    <>
      <p className="label">You found it</p>
      <blockquote className="letter">{card.message}</blockquote>
      {card.from && <p className="quiet">— {card.from}</p>}
      <p className="label mono">{new Date().toLocaleDateString(undefined, { day: "2-digit", month: "short", year: "numeric" })}</p>
      <button className="btn ghost" onClick={onClose}>Close</button>
    </>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
