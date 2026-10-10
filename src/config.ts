// All tunable detection + model parameters live here.
export const CONFIG = {
  model: {
    id: "Xenova/clap-htsat-unfused", // open-weight CLAP, runs in-browser
    dtype: "q8" as const, // quantized weights: smaller download, faster on phones
    sampleRate: 48000,
    template: "This is a sound of {}.",
  },
  audio: {
    windowSec: 5, // length of each analysed window
    hopSec: 2, // how often a new window is scored
    normalize: false, // RMS-normalise windows before the model (untested; flip in ?debug experiments)
    silenceRms: 0.002, // windows quieter than this are treated as "mic dead/silent", not scored
  },
  detection: {
    emaAlpha: 0.5, // smoothing of raw scores
    low: 0.2, // smoothed score -> feedback levels
    medium: 0.35,
    high: 0.5,
    confirm: 0.6, // smoothed score needed to unlock...
    hitsRequired: 2, // ...plus this many of the last `hitsWindow` raw scores >= `high`
    hitsWindow: 3,
    minConfirmMs: 2000, // keep the confident signal sustained for one analysis hop
    cooldownMs: 2000, // after a broken streak, wait before a new one may start
  },
  fieldDelayMs: 10000, // listening -> searching: the screen goes nearly blank
  feedback: { tickMs: 500, mediumEveryTicks: 4, highEveryTicks: 2 },
  // PLACEHOLDER thresholds: calibrate with the debug panel (?debug) outdoors.
  // Contrast sounds: the condition is scored against these (softmax), so
  // "running water" only wins when it beats ambient alternatives.
  negatives: [
    "silence", "wind", "traffic", "people talking", "music", "birds chirping",
    "rain", "running water", "a dog barking", "footsteps", "laughter",
  ],
  suggestions: ["running water", "birds", "traffic", "people talking", "laughter", "rain", "wind", "music"],
};
