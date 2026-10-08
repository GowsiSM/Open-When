# Current revision

## Updated
- Kept the general interface light-only and retained the intentionally dark palette during all active
  listening/signal phases, independent of letter style.
- Improved narrow-screen wrapping, line spacing, model detail readability, and debug output wrapping.
- Strong confirmed signals use a green indicator and status. The microphone flow stops and advances to
  the explicit letter-opening screen after the confirmation cue.
- Documented a Render static-site deployment and clarified that SEE, FIND/OCR, Gemma parsing, and
  model fine-tuning are not implemented or measured.

## Still needs real-device verification
- Microphone permission, offline model caching, signal thresholds, and visual behavior on target phones.
- The first Render deployment and public share-link flow.
- Model size, latency, and accuracy measurements; fine-tuning needs a labelled dataset first.
