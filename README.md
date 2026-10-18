# BroadbandStarless

**A PixInsight script that turns three R, G and B masters into a linear starless RGB image and a
linear star image, colour-calibrated with SPCC.**
Pick the masters, press *Run*: the script combines the channels, removes the gradient, places a
preview on a clean patch of sky, neutralizes and calibrates the colours, then separates the stars.
The masters are never modified.

*Version française : [README.fr.md](README.fr.md)*

Built for the author's own workflow (masters from CommonCrop, then this script, then stretching and
star recombination). Sister script of NarrowbandStarless, which does the same job on SII, Ha and
OIII masters. Shared as is.

## What it does

On a new RGB image built from the selected views:

1. **ChannelCombination** of R, G and B; the astrometric solution of the masters is inherited.
2. **GraXpert**: AI background extraction (*Replace image* always on inside the pipeline).
3. **Sky background preview**: the script looks for the square of sky with the lowest, flattest
   signal (median level, dispersion and mean/median gap penalized, so stars and nebulosity are
   avoided) and creates a preview on it, `Background` by default. An existing preview of one of the
   masters can be used instead. The preview is then the reference of the next two steps.
4. **BackgroundNeutralization**, reference = the preview. *Upper limit* is computed from the
   preview statistics (median + 3 σ per channel, σ from the MAD, the largest channel limit kept), so
   only the stars left in the square are rejected. *Working mode* defaults to *Target background*
   with the preview median as target: the image keeps its background level and nothing is pushed
   onto the zero floor, which keeps the AI tools downstream free of tile artifacts. The percentage
   of preview pixels kept per channel is written to the console.
5. **BlurXTerminator**, *Correct Only*: star shapes corrected before plate solving and SPCC.
6. **ImageSolver**: plate solving through the ImageSolver engine (no dialog), from the image
   metadata (focal length, pixel size, coordinates). On by default even when the image already
   carries a solution.
7. **SpectrophotometricColorCalibration**: filters and sensor QE curve picked from the PixInsight
   filter database (the one FilterManager and SPCC use), or taken from a SPCC process icon of the
   workspace; *Background neutralization* on the preview rectangle (*Region of interest*).
8. **BlurXTerminator**: deconvolution.
9. **StarXTerminator**: starless image and star image.
10. **NoiseXTerminator** (optional, off by default): noise reduction on the starless image.
11. **Auto STF** (optional, on by default): linked automatic screen stretch on the starless image
    and the background model; the star image gets the same STF as the starless image (an auto STF of
    its own makes no sense on an image whose median is zero). Display only: pixels are not changed.

Each tool is run on its own (no ProcessContainer), with the time of each step in the console and
*Pause/Abort* honoured between steps. Results are named `StarlessRGB` and `StarsLinear` by default
(editable). The GraXpert background model, when shown, is named `Background_<result>`.

## Requirements

| Item | Version |
|---|---|
| PixInsight | 1.9.5 and later (V8 JavaScript engine, ImageSolver 6.5) |
| GraXpert process (DeepSkyForge) and GraXpert application | process requires GraXpert 4.0.0 or later |
| BlurXTerminator, StarXTerminator, NoiseXTerminator | RC Astro, licensed separately |
| Gaia DR3 and Gaia DR3/SP catalogs (local XPSD files) or an internet connection | for ImageSolver and SPCC |

Only the enabled tools need to be installed.

## Installation

### From the PixInsight update repository (recommended)

1. *Resources > Updates > Manage Repositories*, add
   `https://jps-34.github.io/BroadbandStarless/`
2. *Resources > Updates > Check for Updates*, then restart PixInsight.
3. The script appears under *Script > Utilities > BroadbandStarless*.

Until the repository is code-signed, PixInsight only accepts it with the *Allow unsigned update
repositories* security preference enabled.

### Manual

Download `scripts/BroadbandStarless.js`, then either run it with *Script > Execute Script File*, or
add its folder with *Script > Feature Scripts > Add* so it shows up in *Script > Utilities*.

## Quick start

1. Open the three **linear monochrome masters with stars**, already cropped to the same area (for
   example `R_crop`, `G_crop`, `B_crop`). The script preselects views whose name contains R, G or B
   as a word (`R_crop`, `master_G`...).
2. Check the three images in the *Images* group and the two result names.
3. Tick the steps to run. In *Sky background*, keep *Automatic search* unless you already placed a
   preview on a master.
4. In advanced mode, *SpectrophotometricColorCalibration*: pick your *Red*, *Green* and *Blue
   filters* and the *QE curve* of your camera, once; the choice is remembered.
5. *Run*. Progress, the preview rectangle, the background statistics, the plate solving summary and
   the SPCC results are in the Process Console.

Settings are remembered between sessions. *Reset* (bottom left) restores the defaults and keeps the
selected images. Dragging the *New Instance* triangle to the workspace saves all settings and image
names in a process icon; double-clicking the icon reopens the dialog with them.

## Settings

The interface is in English or French (*Langue / Language* menu) and scrolls when advanced mode is
on. **The settings of the tools keep the names used by the tools themselves**, in both languages, so
they can be matched one to one.

*Advanced mode* shows:

| Group | Settings |
|---|---|
| GraXpert | Smoothing (default 0.0), Correction (Subtraction / Division), Show background, Disable GPU acceleration |
| Background preview + BackgroundNeutralization | Preview name, Square size (px, default 100), Border margin (%, default 2), Structure weight; Lower limit, Automatic Upper limit (Sigmas above the median, default 3) or Upper limit, Working mode, Automatic Target background (preview median) or Target background |
| ImageSolver | Solve even when already solved (on by default), Distortion correction |
| SpectrophotometricColorCalibration | Process icon, Red / Green / Blue filter, QE curve, Background neutralization, Region of interest = background preview, Generate graphs |
| BlurXTerminator | Sharpen Stars, Adjust Star Halos, Automatic PSF, PSF Diameter, Sharpen Nonstellar |
| StarXTerminator | Unscreen Stars |
| NoiseXTerminator | Intensity/color separation, Frequency separation, then only the settings used by that mode, Frequency scale, Detail, Iterations |
| Auto STF | Shadows clipping (default -2.80, in normalized MAD units), Target background (default 0.25) |

Notes:

* **Background search after gradient removal.** The search looks for the darkest flat square; run on
  an image that still carries a gradient, it would settle on the least degraded corner rather than on
  the true sky. Keep GraXpert enabled, or feed an already flattened image.
* **Upper limit as a percentage does not work in automation.** After gradient subtraction the
  background level is tiny, and a few percent of it can be smaller than the noise: the limit would
  then cut into the sky pixels themselves. The sigma-based limit is independent of the level. Check
  the console: close to 99 % of preview pixels kept means the limit only cuts the stars.
* **SPCC filters and sensor.** The lists come from `filters.xspd` in the PixInsight `library`
  folder (user or core installation). *(icon or default)* keeps the value of the chosen process
  icon, or the SPCC default. The white reference and the catalog always come from the icon or the
  defaults.
* **SPCC process icon.** Any SpectrophotometricColorCalibration icon on the workspace can serve as
  a settings source; the script only overrides the background neutralization block.
* GraXpert *Smoothing*: the GraXpert process documentation recommends 0.0 in most cases (it only
  blurs the background model).
* StarXTerminator *Unscreen Stars* is meant for stretched images; RC Astro recommends not using it on
  linear data.

## License

Copyright (c) 2026 Jacques Pouyaud. Released under the [MIT License](LICENSE).

## Credits

*Code written by Claude (Anthropic), under the direction of Jacques Pouyaud, who defined the need,
tested it on his own data and validated the results.* The sky background search was inspired by the
FindBackground script of Franklin Marek (SetiAstro), reimplemented here so the pipeline needs no
other script.
