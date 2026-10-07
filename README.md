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
npm test            # 19 tests: cards, conditions, detector, state machine, recovery, matcher
npm run build       # static dist/ (deploy to Vercel/Netlify); set VITE_PUBLIC_URL for share links
```
`predev`/`prebuild` copy the ONNX runtime wasm to `public/ort` so inference never needs a CDN.

## Offline
After one online visit: the app shell is cached by `public/sw.js`, the model by Transformers.js
(Cache API), the wasm by the service worker. The Ready screen reports model state honestly
("Not installed", needs network once). Letters and the in-progress session persist in localStorage;
a reload mid-walk returns to Ready with the session clock intact (a mic needs a fresh tap).

## Model
`Xenova/clap-htsat-unfused` (ONNX conversion of LAION CLAP), loaded `q8`. License believed
Apache-2.0; size, latency and accuracy are **not yet measured**: check the model card, then fill in
real numbers from `?debug` on your phone. Weak spots expected: faint targets, wind, overlapping sounds.

## Debug / field test
`?debug` (or the Debug button while listening): mic state and rate, RMS, inference ms, the full score
breakdown vs rival sounds, margin, smoothed score, detector hits. "Score a sound file" separates
capture problems from model problems. `?mock=1` swaps in a loudness matcher for UI testing.

## Limits
- Locked screens can suspend mic capture in mobile browsers; a screen wake lock is requested, so keep the screen on in your pocket.
- Haptics: Android only. iOS gets audio cues.
- Only single "hear" conditions run; the condition model already types SEE/FIND/REACH/THEN (`src/condition.ts`) but rejects them.
- Thresholds in `src/config.ts` are uncalibrated placeholders.
- Link payload lives in the URL hash (never sent to a server) but anyone with the link can read the message.
