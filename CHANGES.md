# Changes in this revision

## Fixed
- **Light/Dark toggle did nothing on most screens.** Root cause: letter styles (`data-letter`) set
  `--bg/--fg` with light-only colours and came later in the CSS, so they overrode the toggle whenever a
  letter was active (including the Create screen, which defaults to the Field style). Now palettes are
  keyed by a resolved `data-mode`, and every letter style has light and dark variants.
- Unverified "about 45 MB" claim removed from the Ready and Local AI screens; real size is shown while installing.
- Stale README test count.

## Added
- `src/theme.ts`: preference -> mode resolution, OS-change listener, browser `theme-color` sync, early no-flash script.
- Theme button with an icon and an accessible label (Auto / Light / Dark).
- `src/log.ts`: field-calibration CSV log (copy / download / clear, with a "where are you" label) in `?debug`.
- Audio: wake lock re-acquired on return to the page, AudioContext resumed after interruptions, mic-lost message.
- Listening status is announced to screen readers (`aria-live`).
- 8 new tests (38 total), including a CSS regression guard for the toggle bug.

## Verified here
- 38 unit tests pass, `tsc` clean, production build succeeds.
- In headless Chrome: the toggle switches the background on Home and Create, and all three letter styles
  switch between light and dark.

## NOT verified (still the real next step)
- Real phone, real microphone, real running water, offline mode, Render deploy, threshold calibration.
