# Open When

A message that opens only when the real world matches a condition.
Write a message, choose something to hear, pocket the phone, walk. A local
open-weight audio-text model (CLAP, via Transformers.js) listens and unlocks it.

```
mic -> short windows -> AudioMatcher (CLAP) -> score -> Detector (smoothing) -> unlock
```

## Run
```bash
npm install
npm run dev      # then open on your phone
npm test
npm run build    # static output in dist/
```
Microphone access needs **HTTPS** (or localhost). To test on a phone, deploy `dist/`
to Vercel/Netlify/GitHub Pages, or tunnel the dev server (e.g. `cloudflared`, `ngrok`).

The model (~45MB) downloads once from the Hugging Face hub, is cached by the browser,
and inference runs on-device. Raw audio is never uploaded. To go fully offline, host
the model files yourself (see `models/` note below) and set `env.localModelPath`.

`?mock=1` swaps in a loudness-based matcher so you can test the UI without the model.

## Test on a phone (microphone needs HTTPS)
- **Fastest:** `npm run dev:https`, open the `https://192.168.x.x:5173` address on your phone,
  accept the self-signed certificate warning.
- **Real demo:** `npm run build`, then deploy `dist/` (e.g. `npx vercel dist`). Create cards
  *from the deployed URL*, or paste your deployed address into the box that appears when the
  link would point at localhost. Optionally set `VITE_PUBLIC_URL=https://your-app.vercel.app`.

## Calibrate outdoors
Open the app with `?debug` (or tap **Debug** while listening). It shows mic state and
sample rate, RMS level, the model's scores for the condition vs rival sounds, margin,
smoothed score, and detector hits. "Score a sound file" runs a recording through the same
model, which tells you whether a problem is mic capture or the model. Then set thresholds in `src/config.ts`.

## Layout
- `src/config.ts` - every tunable (model, window sizes, thresholds, feedback timing)
- `src/matcher.ts` - `AudioMatcher` interface + `ClapMatcher` (swap models here only)
- `src/audio.ts` - mic capture, rolling windows, resampling, beeps/haptics
- `src/detector.ts` - EMA smoothing + N-of-M confirmation, no single-frame unlocks
- `src/card.ts` - card payload <-> URL hash (no backend)
- `src/main.tsx` - Home / Create / Listen / Unlocked

## Known limits
- Screen lock can suspend mic capture in mobile browsers. The app requests a screen
  wake lock; keep the screen on and the phone in a pocket.
- Haptics: `navigator.vibrate` works on Android, not iOS Safari (audio cues still do).
- Tune `CONFIG.detection` outdoors; thresholds are starting points, not truth.
- Card links contain the message in the URL hash (never sent to a server by the browser),
  but anyone with the link can read it.
