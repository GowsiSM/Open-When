import { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { CONFIG } from "./config";
import { Card, cardFromHash, cardUrl, conditionPhrase, makeCard } from "./card";
import { AudioEngine } from "./audio";
import { createMatcher } from "./matcher";
import { Detector, Level } from "./detector";
import "./styles.css";

type View = "home" | "create" | "intro" | "listen" | "found" | "unlocked";

function App() {
  const [card, setCard] = useState<Card | null>(() => cardFromHash(location.hash));
  const [view, setView] = useState<View>(card ? "intro" : "home");

  const open = (c: Card) => { setCard(c); setView("intro"); };
  const exit = () => { history.replaceState(null, "", location.pathname + location.search); setCard(null); setView("home"); };

  return (
    <main className="screen">
      {view === "home" && <Home onCreate={() => setView("create")} />}
      {view === "create" && <Create onBack={() => setView("home")} onPreview={open} />}
      {view === "intro" && card && <Intro card={card} onStart={() => setView("listen")} onBack={exit} />}
      {view === "listen" && card && <Listen card={card} onFound={() => setView("found")} onCancel={() => setView("intro")} />}
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

  const create = () => { try { setMade(makeCard({ condition, message, from })); setErr(""); } catch (e: any) { setErr(e.message); } };
  const copy = async () => { await navigator.clipboard.writeText(cardUrl(made!)); setCopied(true); };

  if (made) return (
    <>
      <p className="label">Card ready</p>
      <h1 className="big">Open when you hear {conditionPhrase(made.condition)}.</h1>
      <p className="quiet">Send this link. The message stays sealed inside it.</p>
      <input className="field mono" readOnly value={cardUrl(made)} onFocus={(e) => e.target.select()} />
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

function Listen({ card, onFound, onCancel }: { card: Card; onFound: () => void; onCancel: () => void }) {
  const [status, setStatus] = useState("Preparing the listener…");
  const [secs, setSecs] = useState(0);
  const [level, setLevel] = useState<Level>("none");
  const levelRef = useRef<Level>("none");
  const engine = useRef(new AudioEngine());

  useEffect(() => {
    let dead = false, busy = false;
    const matcher = createMatcher(), det = new Detector();
    const eng = engine.current;
    (async () => {
      try {
        await matcher.load((p) => setStatus(`Loading model ${p}%`));
        if (dead) return;
        await eng.start(async (audio) => {
          if (busy || dead) return;
          busy = true;
          try {
            const r = det.push(await matcher.match(audio, card.condition));
            levelRef.current = r.level; setLevel(r.level);
            if (r.level === "confirmed" && !dead) { dead = true; eng.chime(); setTimeout(() => { eng.stop(); onFound(); }, 900); }
          } finally { busy = false; }
        });
        if (!dead) setStatus("Listening");
      } catch (e: any) {
        setStatus(e?.name === "NotAllowedError" ? "Microphone access is blocked. Allow it and try again." : "Couldn't start: " + (e?.message ?? e));
      }
    })();
    const clock = setInterval(() => setSecs((s) => s + 1), 1000);
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

  const t = `${String(Math.floor(secs / 60)).padStart(2, "0")}:${String(secs % 60).padStart(2, "0")}`;
  return (
    <>
      <p className="label">Open when</p>
      <div className="listen">
        <span className={`dot ${level}`} />
        <p className="quiet">{conditionPhrase(card.condition)}</p>
        <p className="label">{status}</p>
      </div>
      <p className="quiet">Phone can stay in your pocket.</p>
      <div className="row between">
        <span className="mono dim">{t}</span>
        <button className="btn ghost small" onClick={onCancel}>Stop</button>
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
