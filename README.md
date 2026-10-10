# Open When

**A letter that only opens when the world says so.**

Write a sealed message, choose a sound ("you hear running water"), and send the link. The person
who receives it has to go outside. A small audio model running inside their browser listens
through the phone's microphone, and the letter unlocks only when the surroundings match.

**Live demo:** https://open-when-gp8x.onrender.com

## The idea

Most "go outside" apps tell you to go outside. Open When gives you a reason: someone left you
something, and the only key is a place.

- **The world is the key.** There is no timer, button or password. The real environment is the trigger.
- **The AI never writes the message.** It only listens and decides whether the sound is present.
- **The audio never leaves the device.** Listening happens in short windows in memory and is discarded.
- **No server.** The letter lives in the link itself (the URL hash). There is no database, account or backend.

## How it works

```
mic -> 5 s audio windows -> CLAP audio model (in the browser) -> score vs. rival sounds
    -> smoothing + sustained-signal check -> confirmed -> letter opens
```

1. **Create:** write the message, pick a condition and a letter style. The letter is encoded into the link.
2. **Open the link:** the message stays sealed. The recipient installs the model once (needs internet).
3. **Listen:** the phone scores each window against the target sound _and_ competing sounds
   (traffic, wind, music...). A match needs a clear margin over the rivals, held for several seconds.
4. **Unlock:** the screen shows a green confirmation, then the envelope opens.

Model: `Xenova/clap-htsat-unfused` (an ONNX conversion of LAION's CLAP), run with
[Transformers.js](https://github.com/huggingface/transformers.js), quantized to 8-bit. The model file is
about 161 MB, installed once and cached for offline use.

## Letter styles

Chosen when you create a letter and stored in the link. Styles change only paper, ink, type and
ornaments, never the logic.

- **The old letter:** warm paper, ink-brown text, a muted wax seal.
- **Field letter:** notebook paper, an "open outside" note, a line sketch matched to the sound.
- **Dove / memory:** slate-blue paper and a dove that waits while you listen and flies off when the sound is found.

While listening, the screen goes dark and nearly blank for every style so the phone can stay in a pocket.

## Run it

```bash
npm install
npm run dev:https   # HTTPS is required for the microphone, including on a phone over Wi-Fi
npm test
npm run build       # static output in dist/
```

Microphone access needs HTTPS (or `localhost`). Set `VITE_PUBLIC_URL` before building if the
public address differs from the current origin, so shared links point to the right place.

## Deploy

It is a static site. On Render, create a **Static Site** with build command `npm ci && npm run build`
and publish directory `dist`, or use the included `render.yaml`. Then open the HTTPS URL on a phone
and test the full flow outdoors.

## Debug and field testing

Open the app with `?debug` to see the microphone state, signal level, per-sound scores, the margin
over rival sounds, detector hits and inference time. You can copy or download a CSV log of a session,
which is how thresholds should be calibrated. `?mock=1` swaps in a loudness-based matcher for UI testing.

## Privacy

- Microphone audio is analysed locally and not uploaded or stored.
- A letter's text is inside its link, so anyone who has the link can read the message. Share it with care.
- The internet is used only to install the model once. There is no analytics or tracking.

## Origin and credit

Open When was designed and built by **GowsiSM**. The concept, the sealed-letter flow, and the
world-as-key mechanic originate here. If you build on this project or adapt the idea, please link
back to this repository and credit the original.

## Acknowledgements

- [LAION CLAP](https://huggingface.co/laion/clap-htsat-unfused), the audio-text model.
- [Xenova](https://huggingface.co/Xenova/clap-htsat-unfused), for the ONNX conversion.
- [Transformers.js](https://github.com/huggingface/transformers.js), for in-browser inference.

## License

Add a `LICENSE` file before sharing this publicly (see the note in your repo's checklist).
