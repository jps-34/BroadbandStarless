# Changelog

## 1.0.0 (2026-10-19)
* First release.
* R, G and B view selection, preselected from the view names; two editable result names
  (`StarlessRGB`, `StarsLinear`). The source masters are never modified.
* Pipeline run tool by tool, without ProcessContainer: ChannelCombination, GraXpert (AI background
  extraction, Replace image forced on), automatic sky background preview, BackgroundNeutralization,
  BlurXTerminator (Correct Only), ImageSolver (engine API, no dialog), SpectrophotometricColorCalibration,
  BlurXTerminator, StarXTerminator (starless + star image), optional NoiseXTerminator. Timing per
  step, abort between steps.
* Sky background preview: automatic search of the darkest flat square (coarse grid then refinement,
  median level, dispersion and mean/median gap penalized), or an existing preview of one of the
  masters. The preview is the BackgroundNeutralization reference and the SPCC region of interest.
* BackgroundNeutralization: Upper limit from the preview statistics (median + k sigma, sigma from the
  MAD, largest channel limit kept, k = 3 by default), console report of the percentage of preview
  pixels kept per channel; Working mode selectable, Target background mode by default with the preview
  median as target (automatic) or a typed value.
* SPCC: filters and sensor QE curve picked from the PixInsight filter database (`filters.xspd`,
  user or core `library` folder), or taken from a SPCC process icon of the workspace; background
  neutralization on the preview rectangle.
* Auto STF at the end of the pipeline (on by default): linked automatic screen stretch on the starless
  image and the background model; the star image receives the starless STF. Display only.
* Advanced mode with the main settings of each tool, named exactly as in the tools; scrollable dialog.
* English or French interface, settings remembered between sessions, Reset button, process icon
  support (New Instance).
* PixInsight 1.9.5 and later (V8, ImageSolver 6.5).
