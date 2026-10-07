# Open When

**The world is the password.** Write a sealed message, choose a sound, go outside. A local
open-weight audio model listens through your phone's microphone and unlocks the letter when
the world matches. The AI never writes the message and the audio never leaves the device.

```
mic -> Audio Engine (5s windows) -> AudioMatcher (CLAP, local) -> score
    -> Detector (smoothing + N-of-M + sustained 4s + cooldown) -> State machine -> unlock
```

## Why local, open-weight AI
The input is the environment, which is private. People walk out of signal. Local inference means
no audio upload, no server dependency, no per-call cost, and a model you can swap
(`src/matcher.ts` is the only file that knows which model runs).

## Run
```bash
npm install
npm run dev:https   # self-signed HTTPS so a phone on your Wi-Fi gets microphone access
npm test            # 38 tests: cards, conditions, detector, state machine, theme toggle, run log, matcher
npm run build       # static dist/ (deploy to Vercel/Netlify); set VITE_PUBLIC_URL for share links
```
`predev`/`prebuild` copy the ONNX runtime wasm to `public/ort` so inference never needs a CDN.

## Offline
After one online visit: the app shell is cached by `public/sw.js`, the model by Transformers.js
(Cache API), the wasm by the service worker. The Ready screen reports model state honestly
("Not installed", needs network once). Letters and the in-progress session persist in localStorage;
a reload mid-walk returns to Ready with the session clock intact (a mic needs a fresh tap).

## Installing the model (in-app)
**Local AI** (top bar, or Install on the Ready screen) installs CLAP into the browser cache with real
byte progress, then works offline. Handles offline, no storage, unsupported browser, interrupted
download (retry keeps finished files), and corruption (Remove & retry). `src/models.ts` is the
registry: condition mode -> required model. Only the model a condition needs is installed.
SEE / FIND / Gemma-based condition parsing are listed as **planned** and are not implemented.

## Theme (Auto / Light / Dark)
The top-bar button cycles Auto -> Light -> Dark. `src/theme.ts` resolves the preference to a concrete
mode and writes `<html data-mode>`; every palette in `styles.css` is keyed off `data-mode`, and each
letter style has a light **and** a dark palette. An inline script in `index.html` sets the mode before
first paint (no flash). Field mode (screen nearly blank outdoors) stays dark on purpose. A test fails
if a letter style is added without both palettes. (The old bug: letter styles only defined light colours,
so they overrode the toggle on every screen that had a letter.)

## Letter styles
Three styles, chosen when creating a letter and stored in the link: **The old letter** (warm paper, wax seal), **Field letter** (notebook paper, "open outside", line sketches), **Dove / memory** (slate-blue, a line-art dove on the seal, a small marker while listening, and a brief pass when the letter opens). Styles change only CSS variables and ornaments; the state machine and detector are shared. Fonts are system stacks (works offline); the handwriting accent depends on the device's script fonts. Field mode forces a dark screen for every style.

## Detection improvements
`src/conditionConfig.ts`: per-condition prompt ensembles, rivals, margin, and detector overrides (`resolveCondition`, `aggregate`). Unmeasured; see `MODEL_FINE_TUNING.md`.

## Deploy
`render.yaml` (Render static site, unverified) or any static host with HTTPS.

## Model
`Xenova/clap-htsat-unfused` (ONNX conversion of LAION CLAP), loaded `q8`. Upstream `laion/clap-htsat-unfused` lists Apache-2.0 on its model page; the Xenova ONNX conversion's own license field could not be read, so check it before redistributing. Size, latency and accuracy are **not yet measured**: check the model card, then fill in
real numbers from `?debug` on your phone. Weak spots expected: faint targets, wind, overlapping sounds.

## Debug / field test
`?debug` (or the Debug button while listening): mic state and rate, RMS, inference ms, the full score
breakdown vs rival sounds, margin, smoothed score, detector hits. "Score a sound file" separates
capture problems from model problems. `?mock=1` swaps in a loudness matcher for UI testing.

## Field calibration log
In `?debug`, type where you are (e.g. "stream near bridge"), then **Copy log (CSV)** or **Download**.
One row per scored window: rms, raw, score, margin, smoothed, hits, level, inference ms, top label.
Use it to fill the results tables in `MODEL_FINE_TUNING.md`; it stays in memory and is never uploaded.

## Audio robustness
The wake lock is re-requested when the page becomes visible again (the OS drops it when hidden), the
AudioContext is resumed after iOS-style interruptions, and a lost microphone track shows a clear message.
None of this has been tested on a real phone yet.

## Limits
- Locked screens can suspend mic capture in mobile browsers; a screen wake lock is requested, so keep the screen on in your pocket.
- Haptics: Android only. iOS gets audio cues.
- Only single "hear" conditions run; the condition model already types SEE/FIND/REACH/THEN (`src/condition.ts`) but rejects them.
- Thresholds in `src/config.ts` are uncalibrated placeholders.
- The CLAP model expects 48 kHz audio (`CONFIG.model.sampleRate`); do not "fix" this to 16 kHz.
- Model download size is not measured; the UI shows the real size while installing.
- Link payload lives in the URL hash (never sent to a server) but anyone with the link can read the message.
