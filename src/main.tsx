import { useEffect, useReducer, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { CONFIG } from "./config";
import { Card, LETTER_THEMES, LetterTheme, cardFromHash, cardUrl, conditionPhrase, isLocalBase, makeCard, themeOf } from "./card";
import { resolveCondition } from "./conditionConfig";
import { AudioEngine, normalize, resample, rms, sfx } from "./audio";
import { AudioMatcher, MatchResult, Progress, createMatcher, modelInstalled } from "./matcher";
import { IMPROVEMENT, MODELS, ModelError, PRIVACY, modelState, classify, installModel, installedBytes, modelFor, removeModel } from "./models";
import { Detector, Level } from "./detector";
import { parseCondition } from "./condition";
import { Ctx, Ev, INITIAL, Phase, inField, recover, reduce } from "./machine";
import { getTheme, loadSession, saveLetter, saveSession, saveTheme } from "./store";
import { Theme, applyTheme, nextTheme, themeLabel, watchSystem } from "./theme";
import { RunLog } from "./log";
import "./styles.css";

const LABEL: Record<Level, string> = { none: "Cold", low: "Warm", medium: "Close", high: "Strong signal", confirmed: "Confirmed" };
const mmss = (ms: number) => { const s = Math.max(0, Math.round(ms / 1000)); return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`; };
const useOnline = () => {
  const [on, setOn] = useState(navigator.onLine);
  useEffect(() => { const u = () => setOn(navigator.onLine); addEventListener("online", u); addEventListener("offline", u); return () => { removeEventListener("online", u); removeEventListener("offline", u); }; }, []);
  return on;
};

function App() {
  const [ctx, dispatch] = useReducer(reduce, undefined, (): Ctx => {
    const c = cardFromHash(location.hash);
    return c ? reduce(INITIAL, { t: "RECEIVE", card: c }) : recover(loadSession());
  });
  const engine = useRef<AudioEngine | null>(null);
  const online = useOnline();
  const [installed, setInstalled] = useState<boolean | null>(null);
  const [theme, setT] = useState<Theme>(getTheme());
  const [models, setModels] = useState(false);
  const [pick, setPick] = useState<LetterTheme>("field");
  const p = ctx.phase;
  useEffect(() => { saveSession(ctx); }, [ctx]);
  useEffect(() => { modelInstalled().then(setInstalled); }, [p, models]);
  const begin = () => { engine.current = new AudioEngine(); engine.current.prepare(); dispatch({ t: "BEGIN", now: Date.now() }); }; // inside the tap
  const home = () => { history.replaceState(null, "", location.pathname + location.search); dispatch({ t: "HOME" }); };
  const cycle = () => { const n = nextTheme(theme); saveTheme(n); setT(n); };
  useEffect(() => { applyTheme(theme); return theme === "system" ? watchSystem(() => applyTheme("system")) : undefined; }, [theme]);
  const ai = modelState(installed, online);
  const lt = ctx.card ? themeOf(ctx.card) : p === "create" ? pick : null;
  useEffect(() => { const r = document.documentElement; lt ? (r.dataset.letter = lt) : delete r.dataset.letter; r.toggleAttribute("data-field", p === "searching"); }, [lt, p]);

  return (
    <main className={`screen ${p === "searching" ? "field" : ""}`}>
      <header className="top field-hide">
        <span className="label">Open when</span>
        <span><button className="link" onClick={() => setModels(true)}>Local AI</button> <button className="link themebtn" onClick={cycle} aria-label={`Theme: ${themeLabel(theme)}. Tap to change`} title="Theme: Auto → Light → Dark"><ThemeIcon theme={theme} />{themeLabel(theme)}</button></span>
      </header>
      {models && <Models online={online} onClose={() => setModels(false)} />}
      {!models && p === "home" && <Home ai={ai} onCreate={() => dispatch({ t: "CREATE" })} />}
      {!models && p === "create" && <Create theme={pick} onTheme={setPick} onBack={home} onSeal={(card) => dispatch({ t: "SEALED", card })} />}
      {!models && p === "seal" && ctx.card && <Seal card={ctx.card} onContinue={() => dispatch({ t: "ACK" })} />}
      {!models && p === "ready" && ctx.card && <Ready card={ctx.card} ctx={ctx} installed={installed} online={online} onBegin={begin} onLeave={home} onInstall={() => setModels(true)} />}
      {(inField(p) || p === "confirmed") && ctx.card && engine.current && <Listen eng={engine.current} card={ctx.card} phase={p} dispatch={dispatch} />}
      {p === "unlock" && ctx.card && <Unlock card={ctx.card} onOpen={() => dispatch({ t: "OPEN" })} />}
      {p === "message" && ctx.card && <Message card={ctx.card} onDone={() => dispatch({ t: "FINISH" })} />}
      {p === "summary" && ctx.card && <Summary ctx={ctx} onHome={home} />}
    </main>
  );
}

const ThemeIcon = ({ theme }: { theme: Theme }) => (
  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" aria-hidden>
    {theme === "light" ? <><circle cx="8" cy="8" r="3" /><path d="M8 1.5v1.6M8 12.9v1.6M1.5 8h1.6M12.9 8h1.6M3.4 3.4l1.1 1.1M11.5 11.5l1.1 1.1M3.4 12.6l1.1-1.1M11.5 4.5l1.1-1.1" /></>
      : theme === "dark" ? <path d="M13 9.5A5.5 5.5 0 0 1 6.5 3a5.5 5.5 0 1 0 6.5 6.5Z" />
      : <><circle cx="8" cy="8" r="5.5" /><path d="M8 2.5v11a5.5 5.5 0 0 0 0-11Z" fill="currentColor" /></>}
  </svg>
);
const Dove = ({ className = "" }: { className?: string }) => (
  <svg className={`dove ${className}`} viewBox="0 0 64 40" width="44" height="28" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="M4 31C14 30 24 27 32 22C38 18 42 17 46 17C47 12 51 9 55 10L61 12L55 14C54 19 50 24 44 27C36 32 22 34 4 31Z" /><path d="M30 22C28 12 22 6 12 3C18 10 20 17 24 24" />
  </svg>
);
function Sketch({ card }: { card: Card }) {
  if (themeOf(card) !== "field") return null;
  const id = resolveCondition(conditionPhrase(card.condition)).id;
  return (
    <svg className="sketch" viewBox="0 0 80 28" width="96" height="34" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" aria-hidden>
      {id === "running-water" ? <path d="M2 7q8-6 16 0t16 0 16 0 16 0M2 15q8-6 16 0t16 0 16 0 16 0M2 23q8-6 16 0t16 0 16 0 16 0" />
        : id === "rain" ? <path d="M12 4l-3 8M26 8l-3 8M40 3l-3 8M54 8l-3 8M68 4l-3 8M20 18l-3 8M46 18l-3 8M62 19l-3 8" />
        : <path d="M10 22C20 6 44 4 70 6C64 22 36 26 10 22ZM10 22L58 10" />}
    </svg>
  );
}
function Envelope({ cls = "", theme }: { cls?: string; theme: LetterTheme }) {
  return (
    <div className={`env ${cls}`} aria-hidden>
      <i className="sheet" /><i className="pocket"><b className="addr">{theme === "old" ? "for you" : theme === "field" ? "open outside" : ""}</b></i><i className="flap" />
      <i className="wax">{theme === "dove" && <Dove />}</i>
    </div>
  );
}
function Letterhead({ card }: { card: Card }) {
  const th = themeOf(card), date = new Date().toLocaleDateString(undefined, { day: "numeric", month: "long", year: "numeric" });
  return (
    <header className="lhead">
      {th === "dove" && <Dove />}
      <span className="hand">{th === "field" ? `opened outside · ${date}` : th === "old" ? date : ""}</span>
      {th === "field" && <Sketch card={card} />}
      <span className="label">Open when / found</span>
    </header>
  );
}

function Home({ ai, onCreate }: { ai: string; onCreate: () => void }) {
  const [link, setLink] = useState("");
  const go = () => { if (cardFromHash(link)) { location.hash = link.slice(link.indexOf("c=")); location.reload(); } else alert("That doesn't look like an Open When link."); };
  return (
    <>
      <h1 className="big">The world<br />is the password.</h1>
      <div className="stack">
        <p className="quiet">A sealed message. A real-world condition. One reason to go outside.</p>
        <button className="btn" onClick={onCreate}>Create a letter</button>
        <input className="field" aria-label="Open a letter" placeholder="Open a letter: paste its link" value={link} onChange={(e) => setLink(e.target.value)} onKeyDown={(e) => e.key === "Enter" && go()} />
        <p className="label">{ai}</p>
      </div>
    </>
  );
}

function Create({ theme, onTheme, onBack, onSeal }: { theme: LetterTheme; onTheme: (t: LetterTheme) => void; onBack: () => void; onSeal: (c: Card) => void }) {
  const [condition, setCondition] = useState(""), [message, setMessage] = useState(""), [from, setFrom] = useState(""), [err, setErr] = useState("");
  const seal = () => {
    const r = parseCondition(condition);
    if (!r.ok) return setErr(r.reason);
    try { const c = makeCard({ condition, message, from, theme }); sfx("seal"); onSeal(c); } catch (e: any) { setErr(e.message); }
  };
  return (
    <div className="create">
      <section className="stack">
        <p className="label">What should unlock it?</p>
        <input className="field big-field" aria-label="Condition" placeholder="you hear running water" value={condition} onChange={(e) => setCondition(e.target.value)} />
        <div className="chips">{CONFIG.suggestions.map((s) => <button key={s} className="chip" onClick={() => setCondition(`you hear ${s}`)}>{s}</button>)}</div>
        <p className="label">Your message (only you write it)</p>
        <textarea className="field" aria-label="Message" rows={6} placeholder="You made it. I knew you would." value={message} onChange={(e) => setMessage(e.target.value)} />
        <input className="field" aria-label="Your name" placeholder="Your name (optional)" value={from} onChange={(e) => setFrom(e.target.value)} />
        <p className="label">Letter style</p>
        <div className="themes" role="radiogroup" aria-label="Letter style">
          {LETTER_THEMES.map((t) => <button key={t.id} role="radio" aria-checked={theme === t.id} className={`chip theme ${theme === t.id ? "on" : ""}`} onClick={() => onTheme(t.id)}><b>{t.name}</b><span>{t.blurb}</span></button>)}
        </div>
        {err && <p className="err" role="alert">{err}</p>}
        <div className="row"><button className="btn" onClick={seal}>Seal letter</button><button className="btn ghost" onClick={onBack}>Back</button></div>
      </section>
      <aside className="preview" aria-label="Preview">
        <p className="label">Preview</p>
        <p className="big small">Open when<br />{conditionPhrase(condition) || "…"}</p>
        <p className="quiet blur">{message ? "Sealed. " + "▒".repeat(Math.min(40, message.length)) : ""}</p>
      </aside>
    </div>
  );
}

function Seal({ card, onContinue }: { card: Card; onContinue: () => void }) {
  const [done, setDone] = useState(false), [copied, setCopied] = useState(false);
  const [base, setBase] = useState(() => { try { return localStorage.getItem("ow:base") || (import.meta.env.VITE_PUBLIC_URL as string) || location.origin + location.pathname; } catch { return location.origin + location.pathname; } });
  useEffect(() => { const t = setTimeout(() => { setDone(true); navigator.vibrate?.(40); }, 2500); return () => clearTimeout(t); }, []);
  const editBase = (v: string) => { setBase(v); try { localStorage.setItem("ow:base", v); } catch {} };
  const url = cardUrl(card, base);
  return (
    <>
      <Envelope cls="sealing" theme={themeOf(card)} />
      <p className="label" role="status">{done ? "Sealed" : "Sealing…"}</p>
      {done && (
        <div className="stack rise">
          <h1 className="big small">This message now has a physical key.</h1>
          {isLocalBase(base) && <><p className="err">This link points at your own device. Paste your deployed https:// address so other phones can open it:</p><input className="field mono" aria-label="Public URL" placeholder="https://open-when.vercel.app" onChange={(e) => editBase(e.target.value)} /></>}
          <input className="field mono" readOnly aria-label="Letter link" value={url} onFocus={(e) => e.target.select()} />
          <div className="row"><button className="btn" onClick={async () => { await navigator.clipboard.writeText(url); setCopied(true); }}>{copied ? "Copied" : "Copy link"}</button><button className="btn ghost" onClick={onContinue}>Try it myself</button></div>
        </div>
      )}
    </>
  );
}

function Ready({ card, ctx, installed, online, onBegin, onLeave, onInstall }: { card: Card; ctx: Ctx; installed: boolean | null; online: boolean; onBegin: () => void; onLeave: () => void; onInstall: () => void }) {
  const m = modelFor("hear")!;
  return (
    <>
      <div><Sketch card={card} /><p className="hand">open when</p><h1 className="big">you hear<br />{conditionPhrase(card.condition)}.</h1></div>
      <div className="stack">
        <p className="quiet">Your message is sealed. Go outside.</p>
        <dl className="meta">
          <dt>Local AI</dt><dd>{installed === null ? "Checking…" : installed ? "Ready" : "Not installed"}</dd>
          <dt>Model</dt><dd>{m.name} / {m.tagline}</dd>
          <dt>Runs</dt><dd>On device{installed ? " · offline ready" : ""}</dd>
          <dt>Network</dt><dd>{installed ? "Not required" : "Needed once, to install"}</dd>
        </dl>
        {installed === false && <p className={online ? "quiet" : "err"} role="status">{online ? "To listen for the world around you, Open When needs its environmental audio model, installed once. The size is shown while it downloads." : "You're offline and the local AI model isn't installed yet. Connect once to install it."}</p>}
        {ctx.startedAt && <p className="label">Session resumed · {mmss(ctx.listenMs)} listened</p>}
        <div className="row">
          {installed === false ? <button className="btn" onClick={onInstall}>Install model</button> : <button className="btn" disabled={installed === null} onClick={onBegin}>Begin</button>}
          <button className="btn ghost" onClick={onLeave}>Leave</button>
        </div>
      </div>
    </>
  );
}

const mb = (b: number) => (b / 1048576).toFixed(b < 1e7 ? 1 : 0) + " MB";
const ERR_HELP: Record<string, string> = { offline: "Connect and retry. Files already downloaded are kept.", storage: "Free some space on this device, then retry.", unsupported: "Try a current Chrome, Edge, Safari or Firefox over HTTPS.", failed: "If it keeps failing, remove the model and install again." };

function Models({ online, onClose }: { online: boolean; onClose: () => void }) {
  const [installed, setInstalled] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false), [prog, setProg] = useState<Progress | null>(null), [err, setErr] = useState<ModelError | null>(null), [why, setWhy] = useState<string | null>(null);
  const refresh = () => modelInstalled().then(setInstalled);
  useEffect(() => { refresh(); }, []);
  const install = async () => {
    setErr(null); setBusy(true); setProg(null);
    try { await installModel(setProg); await refresh(); } catch (e) { setErr(classify(e, navigator.onLine)); } finally { setBusy(false); }
  };
  const remove = async () => { await removeModel(); setErr(null); refresh(); };
  const size = installedBytes();
  return (
    <section className="stack models" aria-label="Local AI">
      <p className="label">Your field AI</p>
      <h1 className="big small">{installed ? "Your phone can listen now." : "Teach your phone to listen."}</h1>
      <p className="quiet">{installed ? "No cloud. No upload. Just the world around you." : "Install once. Use offline. The model lives on this device and your microphone audio never leaves it."}</p>
      {MODELS.map((m) => (
        <article key={m.id} className={`model ${m.available ? "" : "planned"}`}>
          <p className="label">{m.recommended ? "Recommended for Open When" : m.available ? "Optional" : "Planned"}</p>
          <h2 className="mname">{m.name} <span className="dim">/ {m.tagline}</span></h2>
          <dl className="meta">
            <dt>Status</dt><dd>{!m.available ? "Not available yet" : installed === null ? "Checking…" : busy ? "Downloading" : installed ? "Installed" : "Not installed"}</dd>
            <dt>Size</dt><dd>{installed && size ? mb(size) + " on device" : m.available ? "Shown while installing (not measured yet)" : "tbd"}</dd>
            <dt>Runs</dt><dd>{m.available ? "On device" : "tbd"}</dd>
            <dt>Network</dt><dd>{m.available ? "Only for first install" : "n/a"}</dd>
            <dt>License</dt><dd>{m.license}</dd>
          </dl>
          {m.available && busy && <div role="progressbar" aria-valuenow={prog?.pct ?? 0} aria-valuemin={0} aria-valuemax={100}><div className="bar"><i style={{ width: `${prog?.pct ?? 0}%` }} /></div><p className="label">{prog ? `${prog.pct}% · ${mb(prog.loaded)} / ${mb(prog.total)}` : "Starting…"} · keep this screen open</p></div>}
          {m.available && installed === false && !busy && !online && <p className="err">You're offline and the local AI model isn't installed yet. Connect once to install it.</p>}
          {m.available && err && <p className="err" role="alert">{err.message} {ERR_HELP[err.kind]}</p>}
          <div className="row wrap">
            {m.available && installed === false && <button className="btn" disabled={busy} onClick={install}>{err ? "Retry install" : "Install model"}</button>}
            {m.available && installed && <button className="btn ghost small" onClick={remove}>Remove from device</button>}
            {m.available && err?.kind === "failed" && <button className="btn ghost small" onClick={remove}>Remove &amp; retry</button>}
            <button className="link" onClick={() => setWhy(why === m.id ? null : m.id)}>Why this model?</button>
            {m.sourceUrl && <a className="link" href={m.sourceUrl} target="_blank" rel="noreferrer">View model source</a>}
          </div>
          {why === m.id && <p className="quiet">{m.why}</p>}
        </article>
      ))}
      <article className="model">
        <p className="label">Improvement path (experimental)</p>
        <dl className="meta">{IMPROVEMENT.map((i) => <><dt key={i.name}>{i.status}</dt><dd>{i.name}. {i.note}</dd></>)}</dl>
      </article>
      <article className="model">
        <p className="label">Privacy</p>
        {PRIVACY.map((x) => <p key={x} className="quiet">{x}</p>)}
      </article>
      {installed && !busy && <p className="quiet rise">Local AI ready. Internet is no longer required for audio detection.</p>}
      <button className="btn" onClick={onClose}>{installed ? "Continue" : "Back"}</button>
    </section>
  );
}

interface Dbg { rms: number; windows: number; skipped: number; res: MatchResult; margin: number; smoothed: number; hits: number; level: Level }
const bar = (v: number) => "█".repeat(Math.round(v * 10)).padEnd(10, "░");

function Listen({ eng, card, phase, dispatch }: { eng: AudioEngine; card: Card; phase: Phase; dispatch: (e: Ev) => void }) {
  const [status, setStatus] = useState("Preparing the listener…");
  const [secs, setSecs] = useState(0);
  const [level, setLevel] = useState<Level>("none");
  const [debug, setDebug] = useState(() => new URLSearchParams(location.search).has("debug"));
  const [dbg, setDbg] = useState<Dbg | null>(null);
  const [fileRes, setFileRes] = useState<MatchResult | null>(null);
  const [place, setPlace] = useState(""), [copied, setCopied] = useState("");
  const logRef = useRef(new RunLog());
  const levelRef = useRef<Level>("none");
  const matcherRef = useRef<AudioMatcher | null>(null);

  useEffect(() => {
    let dead = false, busy = false, windows = 0, skipped = 0;
    const matcher = createMatcher(), det = new Detector({ ...CONFIG.detection, ...resolveCondition(conditionPhrase(card.condition)).detection });
    matcherRef.current = matcher;
    eng.onLost = () => setStatus("Microphone disconnected. Tap Stop, then Begin again.");
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
            let res: MatchResult = { score: 0, raw: 0, margin: 0, cfgId: "none", scores: [], ms: 0 };
            if (level_ < CONFIG.audio.silenceRms) { skipped++; setStatus("Mic is silent. Check the browser's mic permission."); }
            else { res = await matcher.match(CONFIG.audio.normalize ? normalize(audio) : audio, card.condition); setStatus("Listening"); }
            const r = det.push(res.score, Date.now());
            levelRef.current = r.level; setLevel(r.level); if (r.level !== "confirmed") dispatch({ t: "SIGNAL", level: r.level });
            logRef.current.add({ t: Date.now(), rms: level_, raw: res.raw, score: res.score, margin: res.margin, smoothed: r.smoothed, hits: r.hits, level: r.level, ms: res.ms, top: res.scores[0]?.label ?? "" });
            setDbg({ rms: level_, windows, skipped, res, margin: res.margin, smoothed: r.smoothed, hits: r.hits, level: r.level });
            if (r.level === "confirmed" && !dead) { dead = true; dispatch({ t: "CONFIRMED", now: Date.now() }); eng.chime(); setTimeout(() => dispatch({ t: "ACK" }), 1200); }
          } catch (e: any) { setStatus("Model error: " + (e?.message ?? e)); }
          finally { busy = false; }
        });
      } catch (e: any) {
        setStatus(e?.name === "NotAllowedError" ? "Microphone access is blocked. Allow it and try again." : "Couldn't start: " + (e?.message ?? e));
      }
    })();
    const field = setTimeout(() => dispatch({ t: "FIELD" }), CONFIG.fieldDelayMs);
    const clock = setInterval(() => setSecs((x) => x + 1), 1000);
    let tick = 0;
    const fb = setInterval(() => {
      tick++;
      const l = levelRef.current, f = CONFIG.feedback;
      if ((l === "medium" && tick % f.mediumEveryTicks === 0) || (l === "high" && tick % f.highEveryTicks === 0)) {
        eng.beep(l === "high" ? 880 : 520, 60, l === "high" ? 0.2 : 0.1); eng.pulse();
      }
    }, CONFIG.feedback.tickMs);
    return () => { dead = true; eng.stop(); clearInterval(clock); clearTimeout(field); clearInterval(fb); };
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
      <div className="listen">
        {themeOf(card) === "dove" && <Dove className={`marker ${phase === "confirmed" ? "fly" : ""}`} />}
        <span className={`dot ${level}`} role="img" aria-label={LABEL[level]} />
        <p className="quiet">{phrase}</p>
        <p className="label" role="status" aria-live="polite">{phase === "confirmed" ? "Confirmed" : status === "Listening" ? LABEL[level] : status}</p>
      </div>
      {debug && (
        <pre className="debug">
{`MIC      ${eng.info().state}  ${eng.info().rate}Hz (track ${eng.info().track || "?"})
LEVEL    ${dbg ? dbg.rms.toFixed(4) : "-"} rms  ${dbg && dbg.rms < CONFIG.audio.silenceRms ? "SILENT" : ""}
MODEL    ${CONFIG.model.id} loaded
TARGET   ${phrase} [${resolveCondition(phrase).id}] ${resolveCondition(phrase).prompts.length} prompts / ${resolveCondition(phrase).rivals.length} rivals
NORMALIZE ${CONFIG.audio.normalize ? "on" : "off"}   RAW ${dbg ? dbg.res.raw.toFixed(2) : "-"} (summed prompts)
WINDOWS  ${dbg?.windows ?? 0} (silent ${dbg?.skipped ?? 0})  ${dbg?.res.ms ?? 0}ms/inference
`}
{(dbg?.res.scores ?? []).slice(0, 5).map((x) => `${x.label.padEnd(16).slice(0, 16)} ${x.score.toFixed(2)} ${bar(x.score)}${resolveCondition(phrase).prompts.includes(x.label) ? " <" : ""}\n`).join("")}
{dbg ? `MARGIN   ${dbg.margin >= 0 ? "+" : ""}${dbg.margin.toFixed(2)}\nSMOOTHED ${bar(dbg.smoothed)} ${dbg.smoothed.toFixed(2)}\nHITS     ${dbg.hits}/${CONFIG.detection.hitsRequired} needed   ${dbg.level.toUpperCase()}` : "waiting for first window…"}
{fileRes ? `\nVERDICT  ${fileRes.score >= CONFIG.detection.high ? "model recognises this file: if live mic scores low, suspect capture" : "model does NOT score this file high: model/labels/thresholds, not the mic"}\nFILE     ${fileRes.scores.slice(0, 3).map((x) => `${x.label} ${x.score.toFixed(2)}`).join(" | ")}` : ""}
        </pre>
      )}
      {debug && <label className="label">Score a sound file <input type="file" accept="audio/*" onChange={(e) => e.target.files?.[0] && scoreFile(e.target.files[0])} /></label>}
      {debug && (
        <div className="stack">
          <input className="field mono" aria-label="Where are you? (saved in the log)" placeholder="Where are you? e.g. stream near bridge" value={place} onChange={(e) => setPlace(e.target.value)} />
          <div className="row wrap">
            <button className="btn ghost small" onClick={async () => { const csv = logRef.current.toCsv({ condition: phrase, place }); try { await navigator.clipboard.writeText(csv); setCopied(`Copied ${logRef.current.rows.length} rows`); } catch { setCopied("Copy blocked: use Download"); } }}>Copy log (CSV)</button>
            <button className="btn ghost small" onClick={() => { const b = new Blob([logRef.current.toCsv({ condition: phrase, place })], { type: "text/csv" }), a = document.createElement("a"); a.href = URL.createObjectURL(b); a.download = `open-when-${Date.now()}.csv`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000); }}>Download</button>
            <button className="btn ghost small" onClick={() => { logRef.current.clear(); setCopied("Log cleared"); }}>Clear</button>
          </div>
          <p className="label" role="status">{copied || `${logRef.current.rows.length} windows logged · stays on this device`}</p>
        </div>
      )}
      <p className="quiet field-hide">Phone can stay in your pocket.</p>
      <div className="row between">
        <span className="mono dim">{t}</span>
        <span className="row">
          <button className="btn ghost small" onClick={() => setDebug(!debug)}>Debug</button>
          <button className="btn ghost small" onClick={() => dispatch({ t: "STOP", now: Date.now() })}>Stop</button>
        </span>
      </div>
    </>
  );
}

function Unlock({ card, onOpen }: { card: Card; onOpen: () => void }) {
  return (
    <>
      <Envelope theme={themeOf(card)} />
      <h1 className="big small">Signal confirmed.<br />The world unlocked this.</h1>
      <button className="btn" onClick={() => { sfx("open"); onOpen(); }}>Open</button>
    </>
  );
}

function Message({ card, onDone }: { card: Card; onDone: () => void }) {
  const [open, setOpen] = useState(false), [saved, setSaved] = useState(false);
  useEffect(() => { const t = setTimeout(() => { setOpen(true); navigator.vibrate?.(30); }, 80); return () => { clearTimeout(t); window.speechSynthesis?.cancel(); }; }, []);
  return (
    <>
      <Envelope cls={open ? "open" : ""} theme={themeOf(card)} />
      {themeOf(card) === "dove" && <Dove className="pass" />}
      <article className="paper"><Letterhead card={card} /><blockquote className="letter">{card.message}</blockquote>{card.from && <p className="quiet">— {card.from}</p>}</article>
      <div className="row">{"speechSynthesis" in window && <button className="btn ghost" onClick={() => { speechSynthesis.cancel(); speechSynthesis.speak(new SpeechSynthesisUtterance(card.message)); }}>Read aloud</button>}
        <button className="btn ghost" disabled={saved} onClick={() => { saveLetter(card); setSaved(true); }}>{saved ? "Saved on this device" : "Save"}</button><button className="btn" onClick={onDone}>Close</button></div>
    </>
  );
}

function Summary({ ctx, onHome }: { ctx: Ctx; onHome: () => void }) {
  const rows: [string, string][] = [
    ["Condition", conditionPhrase(ctx.card!.condition)],
    ["Time outside", mmss((ctx.foundAt ?? Date.now()) - (ctx.startedAt ?? Date.now()))],
    ["Listening", mmss(ctx.listenMs)], ["Signal", "Confirmed"], ["Message", "Unlocked"],
  ];
  return (
    <>
      <h1 className="big small">You found it.</h1>
      <dl className="meta">{rows.map(([k, v]) => <><dt key={k}>{k}</dt><dd>{v}</dd></>)}</dl>
      <button className="btn" onClick={onHome}>Home</button>
    </>
  );
}

if ("serviceWorker" in navigator && import.meta.env.PROD) navigator.serviceWorker.register(import.meta.env.BASE_URL + "sw.js").catch(() => {});
createRoot(document.getElementById("root")!).render(<App />);
