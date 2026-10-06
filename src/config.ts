// All tunable detection + model parameters live here.
export const CONFIG = {
  model: {
    id: "Xenova/clap-htsat-unfused", // open-weight CLAP, ~45MB quantized, runs in-browser
    sampleRate: 48000,
    template: "This is a sound of {}.",
  },
  audio: {
    windowSec: 5, // length of each analysed window
    hopSec: 2, // how often a new window is scored
  },
  detection: {
    emaAlpha: 0.5, // smoothing of raw scores
    low: 0.25, // smoothed score -> feedback levels
    medium: 0.45,
    high: 0.65,
    confirm: 0.75, // smoothed score needed to unlock...
    hitsRequired: 3, // ...plus this many of the last `hitsWindow` raw scores >= `high`
    hitsWindow: 4,
  },
  feedback: { tickMs: 500, mediumEveryTicks: 4, highEveryTicks: 2 },
  // Contrast sounds: the condition is scored against these (softmax), so
  // "running water" only wins when it beats ambient alternatives.
  negatives: [
    "silence", "wind", "traffic", "people talking", "music", "birds chirping",
    "rain", "running water", "a dog barking", "footsteps", "laughter",
  ],
  suggestions: ["running water", "birds", "traffic", "people talking", "laughter", "rain", "wind", "music"],
};
