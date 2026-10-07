# Improving Open When's sound detection

Status legend: **[measured]** done and recorded, **[TODO]** must be collected, **[unverified]** claim not checked here.
Nothing below has been measured yet. All result tables are intentionally empty.

## 1. The problem
Open When uses a general CLAP model (`Xenova/clap-htsat-unfused`, an ONNX conversion of LAION's `laion/clap-htsat-unfused`; the upstream model page lists Apache-2.0) to compare microphone audio with text. CLAP was trained on broad audio-caption data, so "running water" can match one recording (a loud stream) and miss another (a distant tap, a fountain behind traffic). Causes to separate before changing anything:
1. **Capture:** quiet or clipped mic, resampling, a suspended audio context.
2. **Text side:** one phrase is one point in embedding space; real water is many.
3. **Scoring side:** softmax over a few rivals is sensitive to which rivals you chose.
4. **Domain gap:** phone mics, wind noise, distance, mixed sources.
5. **Window length:** CLAP's training clips are longer than our 5 s windows [unverified].

The debug panel (`?debug`) and "Score a sound file" exist to split 1 from 2-4.

## 2. Dataset strategy
Conditions: running water, rain, birds, footsteps, traffic, dog barking, laughter, wind, music. For each:
- **Positives:** clear examples. **Hard positives:** target is faint, distant, or mixed with other sounds.
- **Hard negatives:** the confusable sounds (water vs rain vs wind vs white noise vs traffic hiss).
- **Background-only:** the places people actually walk, with no target present.
- **Variety:** several phones, distances (0.5 m to 20 m), environments (street, park, indoors), loud vs quiet, short (5 s) vs long (60 s+) recordings.
- Record at the device's native rate and keep metadata: device, place, date, distance, target present (y/n), other sounds.

## 3. Collection
Walk the routes where letters will be opened. Record with the app's own capture path (same constraints: echo cancellation, noise suppression and auto-gain off) so training data matches deployment. Get consent for any recording containing speech; do not collect recordings of identifiable people talking. Label with a second listener to catch errors. Store recordings for evaluation only on your own machine; the shipped app never uploads audio.

## 4. Splits
Split by **location and device, not by clip**. Two clips from the same stream in train and test inflate results. Use train / validation / test with whole environments held out (e.g. test = places and phones never seen in training). Tune thresholds on validation only; report once on test.

## 5. Baseline (do this before changing anything)
Run the current single-prompt and ensemble setups over the test set and record: accuracy, precision, recall, F1, false-positive rate, false-negative rate, score distributions for positives vs negatives, latency per window on target phones, and installed model size.

| Setup | Dataset | Precision | Recall | F1 | FPR | Latency | Size |
| --- | --- | --: | --: | --: | --: | --: | --: |
| CLAP, 1 prompt | TODO | TODO | TODO | TODO | TODO | TODO | TODO |
| CLAP, prompt ensemble (in app) | TODO | TODO | TODO | TODO | TODO | TODO | TODO |
| + per-condition margin/thresholds | TODO | TODO | TODO | TODO | TODO | TODO | TODO |
| CLAP embeddings + linear head | TODO | TODO | TODO | TODO | TODO | TODO | TODO |
| Fine-tuned CLAP | TODO | TODO | TODO | TODO | TODO | TODO | TODO |

## 6. Prompt ensemble (implemented, unmeasured)
`src/conditionConfig.ts` gives each condition several prompts and rivals; positive prompt probabilities from one softmax are summed, compared with the best rival, and halved when the margin is below `minMargin`. **Do not add prompts blindly**: for each candidate prompt, check on validation that it raises recall without raising false positives, and drop it if not. Order of experiments: single prompt -> ensemble -> margin -> rival set -> optional `normalize` flag in `config.ts`.

## 7. Fine-tuning options
| Option | Idea | Pros | Cons | Compute | Browser impact |
| --- | --- | --- | --- | --- | --- |
| Calibration only | per-condition thresholds/margins | trivial, no new model | cannot fix a model that cannot hear it | none | none |
| Classifier head on frozen CLAP audio embeddings | logistic regression / small MLP per condition | small data (hundreds of clips), fast, tiny file | needs audio embeddings exported, loses open-vocabulary conditions for those sounds | CPU minutes | extra few KB; keep text path for free-form conditions |
| Hard-negative training of the head | add confusable negatives | targets real errors | needs labelled hard negatives | CPU | same |
| CLAP contrastive fine-tuning | continue training on your audio-text pairs | can adapt the embedding itself | needs a PyTorch training setup, risk of forgetting, must re-export to ONNX and re-quantise | a GPU | new model download |
| Parameter-efficient (LoRA/adapters) | train small adapters | cheaper, less forgetting | export/merge path for ONNX in the browser is not established [unverified] | a GPU | merge then re-export |

## 8. Recommended path (evidence-based, not full fine-tuning first)
**Measure baseline -> prompt ensemble -> per-condition calibration -> frozen-embedding classifier head -> fine-tuning only if still short.** The head is the likely sweet spot: it needs little data, ships as a tiny file, and keeps CLAP unchanged. This is a hypothesis until the tables above are filled.

## 9. What runs in a browser
Transformers.js + ONNX Runtime Web (wasm) run the quantised CLAP today in this app; weights are cached in the Cache API and wasm is served from our origin. Unknowns to measure per phone: download size, memory, per-window latency, battery. Mobile CPUs may need longer hop intervals. WebGPU could help but is not required [unverified for this model].

## 10. Partner and tooling notes (honest scope)
- **Tinker** (Thinking Machines): a LoRA fine-tuning API for open-weight **language and vision-language models** (Qwen, Llama and others, per its docs). It does not list audio-embedding models like CLAP, so it is **not** a fit for improving the audio matcher. Its plausible role is fine-tuning a small LLM for natural-language condition parsing (see below). Not integrated.
- **Gemma / condition parsing:** could turn "open when it's raining really hard" into `{target: heavy rain, rivals: [light rain, wind, traffic]}`. CLAP would still do the listening. Running an LLM in a phone browser adds a second large download and a new failure point; not shipped. The in-app `conditionConfig` keyword table is a rule-based stand-in, not Gemma.
- **ElevenLabs:** not integrated. A cloud voice would send the private letter text to a third party and needs an API key that cannot live safely in a static client. The app offers the device's built-in "Read aloud" instead.
- **Sentry:** not added; the app ships no telemetry by design. If added later, report error types only, never audio or letter text.
- **DigitalOcean / MongoDB Atlas:** not needed. The model is fetched from Hugging Face once; letters live in the link and on-device. Mirroring model files to your own storage is an option if Hugging Face availability becomes a problem.
- **Render:** `render.yaml` describes a static-site deploy for HTTPS phone testing. Not deployed or verified.
