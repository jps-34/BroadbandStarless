#engine v8

#feature-id    BroadbandStarless : Utilities > BroadbandStarless
#feature-info  Builds a linear starless RGB image and a linear star image from three \
   R, G and B masters: ChannelCombination, GraXpert background extraction, automatic \
   background preview, BackgroundNeutralization, BlurXTerminator (correct only), \
   ImageSolver, SpectrophotometricColorCalibration, BlurXTerminator, \
   StarXTerminator and optional NoiseXTerminator, then an optional auto STF. \
   The main settings of each tool are reachable in advanced mode and the source \
   images are left untouched. Interface in English or French.

/*
 * BroadbandStarless.js  v1.0.1
 * Copyright (c) 2026 Jacques Pouyaud.
 * SPDX-License-Identifier: GPL-3.0-or-later
 * Free software under the GNU General Public License, version 3 or (at your
 * option) any later version, WITHOUT ANY WARRANTY; see LICENSE.
 * Code written by Claude (Anthropic),
 * under the direction of Jacques Pouyaud.
 * https://github.com/jps-34/BroadbandStarless
 *
 * v1.0.0: first release.
 * ----------------------------------------------------------------------------
 * Pipeline, on a new RGB image built from the selected R, G and B views:
 *   1. ChannelCombination (astrometric solution inherited from the sources);
 *   2. GraXpert, AI background extraction (Replace image forced on);
 *   3. background preview: a square of clean sky is searched automatically
 *      (or taken from an existing preview of one of the sources) and created
 *      as a preview of the RGB image;
 *   4. BackgroundNeutralization, with that preview as reference: Upper limit
 *      from the preview statistics (median + k sigma), Target background mode
 *      with the preview median as target by default;
 *   5. BlurXTerminator, Correct Only;
 *   6. ImageSolver (forced by default; optionally skipped when the image
 *      already carries a solution);
 *   7. SpectrophotometricColorCalibration, background neutralization on the
 *      preview rectangle; the filter and sensor curves come from a process
 *      icon chosen by the user, or from the process defaults;
 *   8. BlurXTerminator (sharpening);
 *   9. StarXTerminator, starless + star image;
 *  10. NoiseXTerminator (optional, off by default);
 *  11. optional auto STF (linked) on the starless image and the background
 *      model; the star image gets the starless STF.
 * Each tool is instantiated and executed on its own (no ProcessContainer), with
 * per-step timing and abort between steps.
 *
 * Requirements: PixInsight 1.9.5 or later (V8, ImageSolver 6.5), the GraXpert process
 * (DeepSkyForge) with the GraXpert application, the RC Astro BlurXTerminator,
 * StarXTerminator and NoiseXTerminator processes, and an internet connection or
 * local catalogs for ImageSolver and SPCC.
 */

// ImageSolver as a library (no dialog): <...> paths resolve from the standard
// include directory, so ../src/scripts/ImageSolver reaches the script wherever
// this file is installed. ImageSolver.js requires PixInsight 1.9.5 or later and
// defines the TITLE and VERSION macros, hence SCRIPT_TITLE / SCRIPT_VERSION here.
#define USE_SOLVER_LIBRARY true
#define SETTINGS_MODULE "BroadbandStarless"
#include <../src/scripts/ImageSolver/ImageSolver.js>

var SCRIPT_TITLE = "BroadbandStarless";
var SCRIPT_VERSION = "1.0.1";
var LANG_KEY = "BroadbandStarless/language";
var SETTINGS_KEY = "BroadbandStarless/settings";
var LANG = "en";

// ============================================================================
// Language
// ============================================================================

function detectLanguage()
{
   try
   {
      var saved = Settings.read( LANG_KEY, DataType.String );
      if ( saved == "fr" || saved == "en" )
         return saved;
   }
   catch ( e ) {}
   var names = [ "LANGUAGE", "LC_ALL", "LC_MESSAGES", "LANG" ];
   for ( var i = 0; i < names.length; ++i )
   {
      try
      {
         var v = "";
         if ( typeof System !== "undefined" && System.getEnvironmentVariable )
            v = System.getEnvironmentVariable( names[i] );
         else if ( typeof getEnvironmentVariable === "function" )
            v = getEnvironmentVariable( names[i] );
         if ( v && v.length > 0 && v != "C" && v != "POSIX" )
            return v.toLowerCase().indexOf( "fr" ) == 0 ? "fr" : "en";
      }
      catch ( e ) {}
   }
   try
   {
      var loc = Intl.DateTimeFormat().resolvedOptions().locale;
      if ( loc && loc.toLowerCase().indexOf( "fr" ) == 0 )
         return "fr";
   }
   catch ( e ) {}
   return "en";
}

function saveLanguage( lang )
{
   try { Settings.write( LANG_KEY, DataType.String, lang ); } catch ( e ) {}
}

function L( fr, en )
{
   return LANG == "fr" ? fr : en;
}

// ============================================================================
// Channels and settings
// ============================================================================

// Input slots. 'pattern' is used to preselect a matching view.
var CHANNELS = [
   { key: "R", idKey: "rId", pattern: /(^|_)R(_|$)/i },
   { key: "G", idKey: "gId", pattern: /(^|_)G(_|$)/i },
   { key: "B", idKey: "bId", pattern: /(^|_)B(_|$)/i }
];

var DEFAULTS = {
   // inputs and outputs
   rId: "", gId: "", bId: "",
   outStarless: "StarlessRGB",
   outStars: "StarsLinear",
   advanced: false,
   // GraXpert
   gxEnabled: true,
   gxSmoothing: 0.0,
   gxCorrection: "Subtraction",
   gxShowBackground: false,
   gxDisableGPU: false,
   // background preview + BackgroundNeutralization
   bgEnabled: true,
   bgSource: "auto",          // "auto" | "preview"
   bgPreviewId: "",           // full id of an existing preview (bgSource == "preview")
   bgName: "Background",
   bgSize: 100,
   bgMargin: 2.0,
   bgWeight: 1.0,
   bnLow: 0.0,
   bnAutoHigh: true,          // Upper limit = max over channels of (median + bnSigmas x 1.4826 MAD) on the preview
   bnSigmas: 3.0,
   bnHigh: 0.1,
   bnMode: "TargetBackground",  // TargetBackground | Rescale | RescaleAsNeeded | Truncate
   bnAutoTarget: true,          // TargetBackground mode: target = median of the preview before neutralization
   bnTarget: 0.001,             // manual target, TargetBackground mode only
   // BlurXTerminator, correct only pass
   bxt1Enabled: true,
   // ImageSolver
   solveEnabled: true,
   solveForce: true,
   solveDistortion: true,
   // SpectrophotometricColorCalibration
   spccEnabled: true,
   spccIcon: "",
   spccFilterR: "",           // filter / sensor names from the PixInsight filter database ("" = icon or default)
   spccFilterG: "",
   spccFilterB: "",
   spccQE: "",
   spccNeutralize: true,
   spccUseROI: true,
   spccGraphs: false,
   // BlurXTerminator, sharpening pass
   bxtEnabled: true,
   bxtSharpenStars: 0.30,
   bxtAdjustStarHalos: -0.30,
   bxtAutoPSF: true,
   bxtPSFDiameter: 0.0,
   bxtSharpenNonstellar: 0.50,
   // StarXTerminator
   sxtEnabled: true,
   sxtUnscreen: false,
   // NoiseXTerminator
   nxtEnabled: false,
   nxtColorSep: true,
   nxtFreqSep: true,
   nxtDenoise: 0.85,
   nxtDetail: 0.15,
   nxtIterations: 5,
   nxtDenoiseIntensity: 0.90,
   nxtDenoiseColor: 0.90,
   nxtDenoiseHF: 0.80,
   nxtDenoiseLF: 0.90,
   nxtDenoiseIntensityHF: 0.80,
   nxtDenoiseIntensityLF: 0.90,
   nxtDenoiseColorHF: 0.90,
   nxtDenoiseColorLF: 0.90,
   nxtFrequencyScale: 5.0,
   // Auto STF on the results (display only, pixels unchanged)
   autoSTF: true,
   stfShadowsClipping: -2.80,
   stfTargetBackground: 0.25
};

var TP = {};

function resetTP( keepViews )
{
   var keep = {};
   if ( keepViews )
      for ( var i = 0; i < CHANNELS.length; ++i )
         keep[CHANNELS[i].idKey] = TP[CHANNELS[i].idKey];
   for ( var key in DEFAULTS )
      TP[key] = DEFAULTS[key];
   for ( var k in keep )
      TP[k] = keep[k];
}

function saveSettings()
{
   try { Settings.write( SETTINGS_KEY, DataType.String, JSON.stringify( TP ) ); } catch ( e ) {}
}

function loadSettings()
{
   try
   {
      var s = Settings.read( SETTINGS_KEY, DataType.String );
      if ( s != null && s.length > 0 )
      {
         var o = JSON.parse( s );
         for ( var key in DEFAULTS )
            if ( o[key] !== undefined && typeof o[key] == typeof DEFAULTS[key] )
               TP[key] = o[key];
      }
   }
   catch ( e ) {}
}

// Process icon support: every setting is stored as a script parameter.
function saveParameters()
{
   Parameters.clear();
   for ( var key in DEFAULTS )
   {
      var t = typeof DEFAULTS[key];
      if ( t == "string" || t == "boolean" || t == "number" )
         Parameters.set( key, TP[key] );
   }
}

function loadParameters()
{
   for ( var key in DEFAULTS )
   {
      if ( !Parameters.has( key ) )
         continue;
      var t = typeof DEFAULTS[key];
      if ( t == "string" )
         TP[key] = Parameters.getString( key );
      else if ( t == "boolean" )
         TP[key] = Parameters.getBoolean( key );
      else
         TP[key] = Parameters.getReal( key );
   }
}

// ============================================================================
// Helpers
// ============================================================================

function bbLog( s )
{
   console.writeln( s );
   console.flush();
}

function bbErrText( e )
{
   return ( e && e.message ) ? e.message : String( e );
}

function findView( id )
{
   if ( id == null || id.length == 0 )
      return null;
   var v = View.viewById( id );
   return ( v == null || v.isNull ) ? null : v;
}

function uniqueId( base )
{
   if ( findView( base ) == null )
      return base;
   var n = 1;
   while ( findView( base + "_" + n ) != null )
      ++n;
   return base + "_" + n;
}

function validId( name )
{
   return /^[A-Za-z_][A-Za-z0-9_]*$/.test( name );
}

function windowIdSet()
{
   var set = {};
   var ws = ImageWindow.windows;
   for ( var i = 0; i < ws.length; ++i )
      set[ws[i].mainView.id] = true;
   return set;
}

// Windows that did not exist in 'before' (excluding 'exceptView').
function newWindows( before, exceptView )
{
   var out = [];
   var ws = ImageWindow.windows;
   for ( var i = 0; i < ws.length; ++i )
   {
      var id = ws[i].mainView.id;
      if ( !before[id] && ( exceptView == null || id != exceptView.id ) )
         out.push( ws[i] );
   }
   return out;
}

// First open monochrome main view whose id matches the channel pattern
// (previous results and the other channels skipped).
function guessView( channel, taken )
{
   var ws = ImageWindow.windows;
   for ( var i = 0; i < ws.length; ++i )
   {
      var v = ws[i].mainView;
      if ( taken[v.id] || v.image.isColor )
         continue;
      if ( /^(Starless|Stars|Background)/i.test( v.id ) )
         continue;
      if ( channel.pattern.test( v.id ) )
         return v;
   }
   return null;
}

function errorBox( text )
{
   ( new MessageBox( "<p>" + text + "</p>", SCRIPT_TITLE, StdIcon.Error, StdButton.Ok ) ).execute();
}

function checkAbort()
{
   CoreApplication.processEvents();
   if ( console.abortRequested )
      throw new Error( L( "Interrompu par l'utilisateur", "Aborted by user" ) );
}

// SpectrophotometricColorCalibration process icons available on the workspace.
function spccIcons()
{
   var out = [];
   try
   {
      var ids = ProcessInstance.icons();
      for ( var i = 0; i < ids.length; ++i )
      {
         try
         {
            var inst = ProcessInstance.fromIcon( ids[i] );
            if ( inst != null && inst.processId() == "SpectrophotometricColorCalibration" )
               out.push( ids[i] );
         }
         catch ( e ) {}
      }
   }
   catch ( e ) {}
   return out;
}

// ============================================================================
// PixInsight filter database (SPCC filters and sensor QE curves)
// ============================================================================

// Candidate locations of filters.xspd: the user database first (FilterManager
// imports land there), then the one shipped with the core application.
function filterDatabasePaths()
{
   var paths = [];
   function add( dir )
   {
      if ( dir && dir.length > 0 )
         paths.push( dir + "/filters.xspd" );
   }
   try { if ( typeof coreLibDirPath !== "undefined" ) add( coreLibDirPath ); } catch ( e ) {}
   try { if ( typeof coreDirPath !== "undefined" ) add( coreDirPath + "/library" ); } catch ( e ) {}
   try { add( File.homeDirectory + "/.PixInsight/library" ); } catch ( e ) {}
   try { add( File.homeDirectory + "/Library/PixInsight/library" ); } catch ( e ) {}
   add( "/opt/PixInsight/library" );
   add( "/Applications/PixInsight/library" );
   add( "C:/Program Files/PixInsight/library" );
   return paths;
}

// Parses an .xspd file: elements carrying name= and data= attributes. Returns
// { filters: [ { name, channel, data } ], qe: [ { name, data } ], path }.
// Entries on channel "Q" are sensor QE curves, the others filters (R, G, B,
// L, PAN for broadband OSC/multiband filters).
function parseFilterDatabase( text )
{
   var db = { filters: [], qe: [] };
   var re = /<([A-Za-z_][\w\-]*)\b([^>]*?)(\/?)>/g;
   var m;
   while ( ( m = re.exec( text ) ) != null )
   {
      var tag = m[1], attrText = m[2];
      var attrs = {};
      var ra = /([\w\-:]+)\s*=\s*"([^"]*)"/g, a;
      while ( ( a = ra.exec( attrText ) ) != null )
         attrs[a[1].toLowerCase()] = a[2];
      if ( attrs.name === undefined )
         continue;
      var data = attrs.data;
      if ( data === undefined && m[3] != "/" )
      {
         // data as element text
         var close = text.indexOf( "</" + tag, re.lastIndex );
         if ( close > 0 )
         {
            var inner = text.substring( re.lastIndex, close ).replace( /<!\[CDATA\[|\]\]>/g, "" ).trim();
            if ( /^[\d.,\s\-eE+]+$/.test( inner ) )
               data = inner.replace( /\s+/g, "" );
         }
      }
      if ( data === undefined || data.length == 0 )
         continue;
      // Sensor QE curves are stored as filters on channel "Q".
      var channel = ( attrs.channel || "" ).toUpperCase();
      if ( channel == "Q" || /qe|sensor|device|camera/i.test( tag ) )
         db.qe.push( { name: attrs.name, data: data } );
      else
         db.filters.push( { name: attrs.name, channel: channel, data: data } );
   }
   return db;
}

var FILTER_DB = null;

function loadFilterDatabase()
{
   if ( FILTER_DB != null )
      return FILTER_DB;
   FILTER_DB = { filters: [], qe: [], path: "", tried: [] };
   var paths = filterDatabasePaths();
   var seen = {};
   for ( var i = 0; i < paths.length; ++i )
   {
      var p = paths[i];
      if ( seen[p] )
         continue;
      seen[p] = true;
      FILTER_DB.tried.push( p );
      try
      {
         if ( !File.exists( p ) )
            continue;
         var db = parseFilterDatabase( File.readTextFile( p ) );
         if ( db.filters.length + db.qe.length == 0 )
            continue;
         FILTER_DB.filters = db.filters;
         FILTER_DB.qe = db.qe;
         FILTER_DB.path = p;
         break;
      }
      catch ( e ) {}
   }
   return FILTER_DB;
}

function filterByName( list, name )
{
   for ( var i = 0; i < list.length; ++i )
      if ( list[i].name == name )
         return list[i];
   return null;
}

// Robust per-channel statistics on a rectangle of the image (the background
// preview), for the automatic BackgroundNeutralization Upper limit: median,
// normalized MAD, the limit median + sigmas x MAD, and the fraction of pixels
// at or below that limit. Returns { channels: [...], high } where high is the
// largest per-channel limit, so no channel gets clipped.
function previewBackgroundStats( view, rect, sigmas )
{
   var img = view.image;
   var n = img.isColor ? 3 : 1;
   var out = { channels: [], high: 0 };
   try
   {
      if ( rect != null )
         img.selectedRect = rect;
      for ( var c = 0; c < n; ++c )
      {
         img.selectedChannel = c;
         var med = img.median();
         var sigma = 1.4826 * img.MAD( med );
         var limit = Math.min( 1, med + sigmas * sigma );
         var kept = 1;
         try
         {
            // Fraction of preview pixels retained by the limit.
            var r = ( rect != null ) ? rect : new Rect( 0, 0, img.width, img.height );
            var total = r.width * r.height, above = 0;
            var row = new Float32Array( r.width );
            for ( var y = r.y0; y < r.y1; ++y )
            {
               img.getSamples( row, new Rect( r.x0, y, r.x1, y + 1 ), c );
               for ( var x = 0; x < r.width; ++x )
                  if ( row[x] > limit )
                     ++above;
            }
            kept = 1 - above / total;
         }
         catch ( e ) {}
         out.channels.push( { median: med, sigma: sigma, limit: limit, kept: kept } );
         if ( limit > out.high )
            out.high = limit;
      }
      img.resetSelections();
   }
   catch ( e )
   {
      try { img.resetSelections(); } catch ( e2 ) {}
      throw e;
   }
   return out;
}

// ============================================================================
// Auto STF
// ============================================================================

// Midtones transfer function.
function bbMTF( m, x )
{
   if ( x <= 0 ) return 0;
   if ( x >= 1 ) return 1;
   if ( x == m ) return 0.5;
   return ( m - 1 ) * x / ( ( 2 * m - 1 ) * x - m );
}

// Median and normalized MAD of one channel.
function channelStats( view, c )
{
   var img = view.image;
   try
   {
      img.selectedChannel = c;
      var med = img.median();
      var mad = img.MAD( med );
      img.resetSelections();
      return { median: med, mad: 1.4826 * mad };
   }
   catch ( e )
   {
      try { img.resetSelections(); } catch ( e2 ) {}
      var m = view.computeOrFetchProperty( "Median" );
      var d = view.computeOrFetchProperty( "MAD" );
      return { median: m.at( c ), mad: 1.4826 * d.at( c ) };
   }
}

// Linked automatic screen stretch, as the STF auto stretch: shadows clipped at
// median + shadowsClipping * normalized MAD, midtones set so that the median
// lands on the target background. Display only: the pixels are not changed.
function applyAutoSTF( view, shadowsClipping, targetBackground )
{
   var n = view.image.isColor ? 3 : 1;
   var c0 = 0, median = 0;
   for ( var c = 0; c < n; ++c )
   {
      var s = channelStats( view, c );
      if ( 1 + s.mad != 1 )
         c0 += s.median + shadowsClipping * s.mad;
      median += s.median;
   }
   c0 = Math.min( Math.max( c0 / n, 0 ), 1 );
   var m = bbMTF( targetBackground, median / n - c0 );
   var stf = new ScreenTransferFunction;
   stf.STF = [ [ c0, 1, m, 0, 1 ],
               [ c0, 1, m, 0, 1 ],
               [ c0, 1, m, 0, 1 ],
               [ 0, 1, 0.5, 0, 1 ] ];
   stf.executeOn( view );
   return { c0: c0, m: m };
}

// Same screen stretch as another image (display only).
function applySTF( view, c0, m )
{
   var stf = new ScreenTransferFunction;
   stf.STF = [ [ c0, 1, m, 0, 1 ],
               [ c0, 1, m, 0, 1 ],
               [ c0, 1, m, 0, 1 ],
               [ 0, 1, 0.5, 0, 1 ] ];
   stf.executeOn( view );
}

// ============================================================================
// Background search
// ============================================================================

// Statistics of a square of the image: per-channel median, normalized MAD and
// mean. The score is low for dark, flat, star-free sky: median (darkest area
// once gradients are removed) plus 'weight' times the dispersion (nebulosity,
// noise) and the mean/median gap (stars, which pull the mean up).
function squareStats( img, x0, y0, s, weight )
{
   var n = img.isColor ? 3 : 1;
   img.selectedRect = new Rect( x0, y0, x0 + s, y0 + s );
   var score = 0;
   var medians = [];
   for ( var c = 0; c < n; ++c )
   {
      img.selectedChannel = c;
      var med = img.median();
      var mad = 1.4826 * img.MAD( med );
      var mean = img.mean();
      score += med + weight * ( mad + Math.abs( mean - med ) );
      medians.push( med );
   }
   return { x0: x0, y0: y0, score: score, medians: medians };
}

// Finds the square of 'size' pixels with the lowest score, a border margin
// (percent of width/height) excluded: coarse grid first, then refinement
// around the best candidates. Returns { rect, medians }.
function findBackgroundSquare( view, size, marginPct, weight )
{
   var img = view.image;
   var W = img.width, H = img.height;
   var s = Math.round( size );
   s = Math.max( 16, Math.min( s, Math.floor( Math.min( W, H ) / 2 ) ) );
   var mx = Math.round( W * marginPct / 100 ), my = Math.round( H * marginPct / 100 );
   var xMin = mx, yMin = my, xMax = W - mx - s, yMax = H - my - s;
   if ( xMax < xMin || yMax < yMin )
      throw new Error( L( "Image trop petite pour la recherche de fond (taille du carré et marge).",
                          "Image too small for the background search (square size and margin)." ) );
   try
   {
      // Coarse pass: non-overlapping squares.
      var step = s;
      var nx = Math.floor( ( xMax - xMin ) / step ) + 1;
      var ny = Math.floor( ( yMax - yMin ) / step ) + 1;
      while ( nx * ny > 6000 )
      {
         step = Math.round( step * 1.5 );
         nx = Math.floor( ( xMax - xMin ) / step ) + 1;
         ny = Math.floor( ( yMax - yMin ) / step ) + 1;
      }
      var cands = [];
      for ( var j = 0; j < ny; ++j )
      {
         for ( var i = 0; i < nx; ++i )
            cands.push( squareStats( img, xMin + i * step, yMin + j * step, s, weight ) );
         if ( ( j & 7 ) == 0 )
            checkAbort();
      }
      cands.sort( function( a, b ) { return a.score - b.score; } );

      // Refinement: around the best candidates, quarter-square steps.
      var keep = Math.min( cands.length, Math.max( 8, Math.round( cands.length * 0.02 ) ) );
      var fine = Math.max( 4, Math.round( s / 4 ) );
      var best = cands[0];
      var seen = {};
      for ( var k = 0; k < keep; ++k )
      {
         var c = cands[k];
         for ( var dy = -step; dy <= step; dy += fine )
            for ( var dx = -step; dx <= step; dx += fine )
            {
               var x0 = c.x0 + dx, y0 = c.y0 + dy;
               if ( x0 < xMin || y0 < yMin || x0 > xMax || y0 > yMax )
                  continue;
               var key = x0 + "," + y0;
               if ( seen[key] )
                  continue;
               seen[key] = true;
               var r = squareStats( img, x0, y0, s, weight );
               if ( r.score < best.score )
                  best = r;
            }
         checkAbort();
      }
      img.resetSelections();
      return { rect: new Rect( best.x0, best.y0, best.x0 + s, best.y0 + s ),
               medians: best.medians, tested: cands.length + Object.keys( seen ).length };
   }
   catch ( e )
   {
      try { img.resetSelections(); } catch ( e2 ) {}
      throw e;
   }
}

// Rectangle of an existing preview, given its full id ("image->preview").
function previewRect( fullId )
{
   var pv = findView( fullId );
   if ( pv == null || !pv.isPreview )
      throw new Error( L( "Preview de fond introuvable : ", "Background preview not found: " ) + fullId );
   return pv.window.previewRect( pv );
}

// ============================================================================
// Tool instances
// ============================================================================

function makeChannelCombination( p )
{
   var P = new ChannelCombination;
   P.colorSpace = ChannelCombination.RGB;
   P.channels = [ [ true, p.rId ], [ true, p.gId ], [ true, p.bId ] ];
   P.inheritAstrometricSolution = true;
   return P;
}

function makeGraXpert( p )
{
   var P = new GraXpert;
   P.backgroundExtractionSampleFree = false;
   P.backgroundExtraction = true;
   P.smoothing = p.gxSmoothing;
   P.backgroundExtractionAIModel = "";
   P.denoising = false;
   P.deconvolution = false;
   P.correction = p.gxCorrection;
   P.createBackground = p.gxShowBackground;
   P.disableGPU = p.gxDisableGPU;
   P.replaceImage = true;           // required: the next steps must see the corrected image
   P.showLogs = false;
   P.appPath = "";
   P.batchSize = 4;
   return P;
}

function makeBackgroundNeutralization( p, referenceId, high, target )
{
   var P = new BackgroundNeutralization;
   P.backgroundReferenceViewId = referenceId;
   P.backgroundLow = p.bnLow;
   P.backgroundHigh = high;
   P.useROI = false;
   P.mode = BackgroundNeutralization[p.bnMode] !== undefined
            ? BackgroundNeutralization[p.bnMode] : BackgroundNeutralization.TargetBackground;
   P.targetBackground = target;
   return P;
}

function makeBlurX( p, correctOnly )
{
   var P = new BlurXTerminator;
   P.ml_version = 0;
   P.correct_only = correctOnly;
   P.sharpen_stars = p.bxtSharpenStars;
   P.adjust_star_halos = p.bxtAdjustStarHalos;
   P.nonstellar_diameter = p.bxtPSFDiameter;
   P.auto_nonstellar_psf = p.bxtAutoPSF;
   P.sharpen_nonstellar = p.bxtSharpenNonstellar;
   P.lunar_planetary = false;
   P.overlap = 0.50;
   return P;
}

// Plate solving with the ImageSolver engine (library mode, no dialog). The
// engine reads focal length, pixel size and coordinates from the image
// metadata and the solver settings saved by the ImageSolver script; only the
// options below are overridden.
function runImageSolver( window, p )
{
   var engine = new ImageSolver;
   engine.initialize( window, false /*prioritizeSettings*/ );
   var cfg = engine.solverCfg;
   function set( key, value )
   {
      if ( cfg !== undefined && cfg !== null && key in cfg )
         cfg[key] = value;
   }
   set( "useActive", true );
   set( "autoMagnitude", true );
   set( "distortionCorrection", p.solveDistortion );
   set( "generateErrorImg", false );
   set( "showStars", false );
   set( "showStarMatches", false );
   set( "showSimplifiedSurfaces", false );
   set( "showDistortion", false );
   set( "generateDistortModel", false );
   engine.solveImage( window );
   try { console.writeln( window.astrometricSolutionSummary().trim() ); } catch ( e ) {}
}

// SPCC: settings of the chosen process icon (filters, sensor, white
// reference, catalog...), or the process defaults; only the background
// neutralization block is set by the script.
function makeSPCC( p, roi )
{
   var P = null;
   if ( p.spccIcon.length > 0 )
   {
      P = ProcessInstance.fromIcon( p.spccIcon );
      if ( P == null || P.processId() != "SpectrophotometricColorCalibration" )
         throw new Error( L( "L'icône de process SPCC « " + p.spccIcon + " » est introuvable.",
                             "SPCC process icon \"" + p.spccIcon + "\" not found." ) );
   }
   else
      P = new SpectrophotometricColorCalibration;
   P.applyCalibration = true;

   // Filters and sensor from the PixInsight filter database, when chosen.
   var db = loadFilterDatabase();
   var fr = filterByName( db.filters, p.spccFilterR );
   var fg = filterByName( db.filters, p.spccFilterG );
   var fb = filterByName( db.filters, p.spccFilterB );
   var qe = filterByName( db.qe, p.spccQE );
   if ( fr != null ) { P.redFilterName = fr.name;   P.redFilterTrCurve = fr.data; }
   if ( fg != null ) { P.greenFilterName = fg.name; P.greenFilterTrCurve = fg.data; }
   if ( fb != null ) { P.blueFilterName = fb.name;  P.blueFilterTrCurve = fb.data; }
   if ( qe != null ) { P.deviceQECurveName = qe.name; P.deviceQECurve = qe.data; }
   bbLog( format( L( "Filtres R/G/B : %s / %s / %s ; capteur : %s", "R/G/B filters: %s / %s / %s; sensor: %s" ),
                P.redFilterName, P.greenFilterName, P.blueFilterName, P.deviceQECurveName ) );

   P.neutralizeBackground = p.spccNeutralize;
   P.backgroundReferenceViewId = "";
   if ( roi != null && p.spccUseROI )
   {
      P.backgroundUseROI = true;
      P.backgroundROIX0 = roi.x0;
      P.backgroundROIY0 = roi.y0;
      P.backgroundROIX1 = roi.x1;
      P.backgroundROIY1 = roi.y1;
   }
   else
      P.backgroundUseROI = false;
   P.generateGraphs = p.spccGraphs;
   P.generateStarMaps = false;
   P.generateTextFiles = false;
   return P;
}

function makeStarX( p )
{
   var P = new StarXTerminator;
   P.ml_version = 0;
   P.output_stars = true;
   P.unscreen = p.sxtUnscreen;
   P.remove_stars = true;
   P.remove_spikes = true;
   P.remove_aureoles = false;
   P.remove_reflections = false;
   P.overlap = 0.50;
   return P;
}

function makeNoiseX( p )
{
   var P = new NoiseXTerminator;
   P.ml_version = 0;
   P.enable_color_separation = p.nxtColorSep;
   P.enable_frequency_separation = p.nxtFreqSep;
   P.denoise = p.nxtDenoise;
   P.detail = p.nxtDetail;
   P.iterations = Math.round( p.nxtIterations );
   P.denoise_intensity = p.nxtDenoiseIntensity;
   P.denoise_color = p.nxtDenoiseColor;
   P.denoise_high_freq = p.nxtDenoiseHF;
   P.denoise_low_freq = p.nxtDenoiseLF;
   P.denoise_intensity_high_freq = p.nxtDenoiseIntensityHF;
   P.denoise_intensity_low_freq = p.nxtDenoiseIntensityLF;
   P.denoise_color_high_freq = p.nxtDenoiseColorHF;
   P.denoise_color_low_freq = p.nxtDenoiseColorLF;
   P.frequency_scale = p.nxtFrequencyScale;
   P.overlap = 0.50;
   return P;
}

// ============================================================================
// Steps
// ============================================================================

// Each step gets the context: { p, target (View), roi (Rect), previewId,
// backgrounds [View], stars (View) }. Steps run in this order.
function buildSteps( p )
{
   var steps = [];

   if ( p.gxEnabled )
      steps.push( { name: "GraXpert", run: function( ctx )
      {
         var before = windowIdSet();
         if ( !makeGraXpert( ctx.p ).executeOn( ctx.target ) )
            throw new Error( "GraXpert" + L( " a échoué", " failed" ) );
         var extra = newWindows( before, ctx.target );
         for ( var i = 0; i < extra.length; ++i )
         {
            extra[i].mainView.id = uniqueId( "Background_" + ctx.p.outStarless );
            bbLog( L( "Fenêtre annexe : ", "Extra window: " ) + extra[i].mainView.id );
            ctx.backgrounds.push( extra[i].mainView );
         }
      } } );

   if ( p.bgEnabled )
      steps.push( { name: L( "Preview de fond", "Background preview" ), run: function( ctx )
      {
         var rect, medians = null;
         if ( ctx.p.bgSource == "preview" )
         {
            rect = previewRect( ctx.p.bgPreviewId );
            bbLog( L( "Preview reprise de ", "Preview taken from " ) + ctx.p.bgPreviewId );
         }
         else
         {
            var r = findBackgroundSquare( ctx.target, ctx.p.bgSize, ctx.p.bgMargin, ctx.p.bgWeight );
            rect = r.rect;
            medians = r.medians;
            bbLog( format( L( "%d carrés testés", "%d squares tested" ), r.tested ) );
         }
         var w = ctx.target.window;
         var name = validId( ctx.p.bgName ) ? ctx.p.bgName : "Background";
         var pv = w.createPreview( rect, name );
         ctx.previewId = ctx.target.id + "->" + pv.id;
         ctx.roi = rect;
         var msg = format( L( "Preview %s : x %d-%d, y %d-%d", "Preview %s: x %d-%d, y %d-%d" ),
                           ctx.previewId, rect.x0, rect.x1, rect.y0, rect.y1 );
         if ( medians != null )
            msg += format( L( " ; médianes R %.6f, G %.6f, B %.6f", "; medians R %.6f, G %.6f, B %.6f" ),
                           medians[0], medians[1], medians[2] );
         bbLog( msg );
      } } );

   if ( p.bgEnabled )
      steps.push( { name: "BackgroundNeutralization", run: function( ctx )
      {
         var high = ctx.p.bnHigh;
         var target = ctx.p.bnTarget;
         var st = null;
         if ( ctx.p.bnAutoHigh || ( ctx.p.bnMode == "TargetBackground" && ctx.p.bnAutoTarget ) )
            st = previewBackgroundStats( ctx.target, ctx.roi, ctx.p.bnSigmas );
         if ( ctx.p.bnMode == "TargetBackground" && ctx.p.bnAutoTarget )
         {
            // Keep the level the image already has: the mean of the channel medians
            // on the preview becomes the imposed background, so the neutralization
            // is purely additive and nothing is pushed against the floor.
            var sum = 0;
            for ( var k = 0; k < st.channels.length; ++k )
               sum += st.channels[k].median;
            target = sum / st.channels.length;
            bbLog( format( L( "Target background automatique = %.6f (moyenne des médianes de la preview)",
                              "Automatic Target background = %.6f (mean of the preview medians)" ), target ) );
         }
         if ( ctx.p.bnAutoHigh )
         {
            // Robust statistics on the preview before neutralization: per channel,
            // median + k sigma (sigma from the MAD, insensitive to the stars left in
            // the square); the largest channel limit is used so no channel is clipped.
            high = st.high;
            var names = [ "R", "G", "B" ];
            for ( var c = 0; c < st.channels.length; ++c )
            {
               var s = st.channels[c];
               bbLog( format( L( "Preview %s : médiane %.6f, sigma %.6f, médiane + %.1f sigma = %.6f, pixels retenus %.1f %%",
                               "Preview %s: median %.6f, sigma %.6f, median + %.1f sigma = %.6f, pixels kept %.1f %%" ),
                            names[c], s.median, s.sigma, ctx.p.bnSigmas, s.limit, 100 * s.kept ) );
            }
            bbLog( format( "Upper limit = %.6f", high ) );
         }
         if ( !makeBackgroundNeutralization( ctx.p, ctx.previewId, high, target ).executeOn( ctx.target ) )
            throw new Error( "BackgroundNeutralization" + L( " a échoué", " failed" ) );
      } } );

   if ( p.bxt1Enabled )
      steps.push( { name: "BlurXTerminator (Correct Only)", run: function( ctx )
      {
         if ( !makeBlurX( ctx.p, true ).executeOn( ctx.target ) )
            throw new Error( "BlurXTerminator" + L( " a échoué", " failed" ) );
      } } );

   if ( p.solveEnabled )
      steps.push( { name: "ImageSolver", run: function( ctx )
      {
         if ( ctx.target.window.hasAstrometricSolution && !ctx.p.solveForce )
         {
            bbLog( L( "Solution astrométrique déjà présente, ImageSolver sauté.",
                    "Astrometric solution already present, ImageSolver skipped." ) );
            return;
         }
         runImageSolver( ctx.target.window, ctx.p );
         if ( !ctx.target.window.hasAstrometricSolution )
            throw new Error( L( "ImageSolver n'a pas résolu l'image (métadonnées FITS manquantes ?).",
                                "ImageSolver did not solve the image (missing FITS metadata?)." ) );
      } } );

   if ( p.spccEnabled )
      steps.push( { name: "SpectrophotometricColorCalibration", run: function( ctx )
      {
         if ( !ctx.target.window.hasAstrometricSolution )
            throw new Error( L( "SPCC a besoin d'une solution astrométrique : active ImageSolver ou résous l'image avant.",
                                "SPCC needs an astrometric solution: enable ImageSolver or solve the image first." ) );
         bbLog( ctx.p.spccIcon.length > 0 ? L( "Réglages de l'icône ", "Settings of icon " ) + ctx.p.spccIcon
                                        : L( "Réglages par défaut de SPCC", "SPCC default settings" ) );
         if ( !makeSPCC( ctx.p, ctx.roi ).executeOn( ctx.target ) )
            throw new Error( "SpectrophotometricColorCalibration" + L( " a échoué", " failed" ) );
      } } );

   if ( p.bxtEnabled )
      steps.push( { name: "BlurXTerminator", run: function( ctx )
      {
         if ( !makeBlurX( ctx.p, false ).executeOn( ctx.target ) )
            throw new Error( "BlurXTerminator" + L( " a échoué", " failed" ) );
      } } );

   if ( p.sxtEnabled )
      steps.push( { name: "StarXTerminator", run: function( ctx )
      {
         var before = windowIdSet();
         if ( !makeStarX( ctx.p ).executeOn( ctx.target ) )
            throw new Error( "StarXTerminator" + L( " a échoué", " failed" ) );
         var extra = newWindows( before, ctx.target );
         if ( extra.length == 0 )
            throw new Error( L( "StarXTerminator n'a pas créé l'image des étoiles.",
                                "StarXTerminator did not create the star image." ) );
         ctx.stars = extra[0].mainView;
         ctx.stars.id = uniqueId( ctx.p.outStars );
         bbLog( L( "Image des étoiles : ", "Star image: " ) + ctx.stars.id );
      } } );

   if ( p.nxtEnabled )
      steps.push( { name: "NoiseXTerminator", run: function( ctx )
      {
         if ( !makeNoiseX( ctx.p ).executeOn( ctx.target ) )
            throw new Error( "NoiseXTerminator" + L( " a échoué", " failed" ) );
      } } );

   return steps;
}

// ============================================================================
// Validation and run
// ============================================================================

function validate( p )
{
   var views = [];
   var seen = {};
   for ( var i = 0; i < CHANNELS.length; ++i )
   {
      var c = CHANNELS[i];
      var v = findView( p[c.idKey] );
      if ( v == null )
         throw new Error( L( "Aucune image choisie pour le canal ", "No image selected for channel " ) + c.key + "." );
      if ( v.isPreview )
         throw new Error( L( "Le canal " + c.key + " doit être une image principale, pas une preview.",
                             "Channel " + c.key + " must be a main view, not a preview." ) );
      if ( v.image.isColor )
         throw new Error( L( "Le canal " + c.key + " (" + v.id + ") doit être monochrome.",
                             "Channel " + c.key + " (" + v.id + ") must be monochrome." ) );
      if ( seen[v.fullId] )
         throw new Error( L( "L'image " + v.id + " est choisie pour deux canaux.",
                             "Image " + v.id + " is selected for two channels." ) );
      seen[v.fullId] = true;
      views.push( v );
   }
   for ( var j = 1; j < views.length; ++j )
      if ( views[j].image.width != views[0].image.width || views[j].image.height != views[0].image.height )
         throw new Error( L( "Les images R, G et B n'ont pas les mêmes dimensions.",
                             "The R, G and B images do not have the same dimensions." ) );

   var names = [ [ "outStarless", L( "image sans étoiles", "starless image" ) ],
                 [ "outStars", L( "image des étoiles", "star image" ) ] ];
   for ( var k = 0; k < names.length; ++k )
   {
      var name = String( p[names[k][0]] ).trim();
      if ( !validId( name ) )
         throw new Error( L( "Nom invalide pour l'" + names[k][1] + " : « " + name + " ». " +
                             "Lettres, chiffres et _ uniquement, sans chiffre au début.",
                             "Invalid name for the " + names[k][1] + ": \"" + name + "\". " +
                             "Letters, digits and _ only, not starting with a digit." ) );
      p[names[k][0]] = name;
   }
   if ( p.outStarless == p.outStars )
      throw new Error( L( "Les deux images de sortie ont le même nom.", "Both output images have the same name." ) );

   if ( p.bgEnabled && p.bgSource == "preview" )
   {
      var pv = findView( p.bgPreviewId );
      if ( pv == null || !pv.isPreview )
         throw new Error( L( "Choisis une preview existante pour le fond de ciel.",
                             "Pick an existing preview for the sky background." ) );
      if ( pv.window.mainView.image.width != views[0].image.width ||
           pv.window.mainView.image.height != views[0].image.height )
         throw new Error( L( "La preview de fond appartient à une image d'une autre taille.",
                             "The background preview belongs to an image of another size." ) );
   }
   if ( !p.bgEnabled && p.spccEnabled && p.spccUseROI )
      bbLog( L( "Note : sans preview de fond, SPCC neutralise sur l'image entière.",
              "Note: without a background preview, SPCC neutralizes on the whole image." ) );
   if ( p.spccEnabled && !p.solveEnabled && !views[0].window.hasAstrometricSolution )
      throw new Error( L( "SPCC est activé sans ImageSolver et l'image R n'a pas de solution astrométrique.",
                          "SPCC is enabled without ImageSolver and the R image has no astrometric solution." ) );
}

function runPipeline( p )
{
   validate( p );
   var steps = buildSteps( p );
   console.show();
   try { console.abortEnabled = true; } catch ( e ) {}
   var t0 = Date.now();
   bbLog( "<end><cbr><b>" + SCRIPT_TITLE + " " + SCRIPT_VERSION + "</b> : ChannelCombination > " +
        steps.map( function( s ) { return s.name; } ).join( " > " ) );
   try
   {
      // 1. ChannelCombination: a new RGB window.
      bbLog( "<end><cbr><b>--- ChannelCombination</b>" );
      var before = windowIdSet();
      var t = Date.now();
      if ( !makeChannelCombination( p ).executeGlobal() )
         throw new Error( "ChannelCombination" + L( " a échoué", " failed" ) );
      var created = newWindows( before, null );
      if ( created.length == 0 )
         throw new Error( L( "ChannelCombination n'a pas créé d'image.", "ChannelCombination did not create an image." ) );
      var target = created[0].mainView;
      target.id = uniqueId( p.outStarless + "_wip" );
      created[0].show();
      bbLog( format( L( "ChannelCombination terminé en %.1f s : %s", "ChannelCombination done in %.1f s: %s" ),
                   ( Date.now() - t ) / 1000, target.id ) );
      checkAbort();

      var ctx = { p: p, target: target, roi: null, previewId: "", backgrounds: [], stars: null };

      for ( var s = 0; s < steps.length; ++s )
      {
         bbLog( "<end><cbr><b>--- " + steps[s].name + "</b>" );
         t = Date.now();
         steps[s].run( ctx );
         bbLog( format( L( "%s terminé en %.1f s", "%s done in %.1f s" ), steps[s].name, ( Date.now() - t ) / 1000 ) );
         checkAbort();
      }

      target.id = uniqueId( p.outStarless );

      // Auto STF at the end: starless image and background model. The star
      // image gets the STF of the starless image, not an auto STF of its own: with
      // a median of zero an auto stretch would blow up the residuals (that is what
      // StarXTerminator does when run by hand, copying the source STF).
      if ( p.autoSTF )
      {
         var list = [ target ].concat( ctx.backgrounds );
         var starlessSTF = null;
         for ( var b = 0; b < list.length; ++b )
         {
            var r = applyAutoSTF( list[b], p.stfShadowsClipping, p.stfTargetBackground );
            if ( b == 0 )
               starlessSTF = r;
            bbLog( format( L( "Auto STF sur %s : ombres %.6f, tons moyens %.6f",
                            "Auto STF on %s: shadows %.6f, midtones %.6f" ), list[b].id, r.c0, r.m ) );
         }
         if ( ctx.stars != null && starlessSTF != null )
         {
            applySTF( ctx.stars, starlessSTF.c0, starlessSTF.m );
            bbLog( L( "STF de l'image sans étoiles appliquée à ", "Starless STF applied to " ) + ctx.stars.id );
         }
      }

      bbLog( format( L( "<end><cbr><b>Terminé en %.1f s : %s%s</b>", "<end><cbr><b>Done in %.1f s: %s%s</b>" ),
                   ( Date.now() - t0 ) / 1000, target.id,
                   ctx.stars != null ? " + " + ctx.stars.id : "" ) );
   }
   finally
   {
      try { console.abortEnabled = false; } catch ( e ) {}
   }
}

// ============================================================================
// Tooltips
// ============================================================================

function tips()
{
   return {
      view: L( "<p>Master linéaire monochrome du canal, avec étoiles, déjà recadré sur la zone commune.</p>",
               "<p>Linear monochrome master of the channel, with stars, already cropped to the common area.</p>" ),
      outStarless: L( "<p>Identifiant de l'image RGB sans étoiles. Un suffixe _1, _2... est ajouté si le nom existe déjà.</p>",
                      "<p>Identifier of the starless RGB image. A _1, _2... suffix is added if the name already exists.</p>" ),
      outStars: L( "<p>Identifiant de l'image des étoiles, linéaire, produite par StarXTerminator.</p>",
                   "<p>Identifier of the linear star image produced by StarXTerminator.</p>" ),
      advanced: L( "<p>Affiche les réglages principaux de chaque outil, nommés comme dans les outils.</p>",
                   "<p>Shows the main settings of each tool, named as in the tools.</p>" ),
      gxSmoothing: L( "<p>Flou gaussien ajouté au modèle de fond. La documentation du process GraXpert " +
                      "recommande 0.0 dans la plupart des cas.</p>",
                      "<p>Gaussian blur added to the background model. The GraXpert process documentation " +
                      "recommends 0.0 in most cases.</p>" ),
      gxCorrection: L( "<p>Subtraction dans la plupart des cas, Division seulement pour des gradients très forts " +
                       "(vignetage).</p>",
                       "<p>Subtraction in most cases, Division only for very strong gradients (vignetting).</p>" ),
      gxShowBackground: L( "<p>Affiche le modèle de fond calculé (fenêtre Background_&lt;nom&gt;).</p>",
                           "<p>Shows the computed background model (Background_&lt;name&gt; window).</p>" ),
      gxDisableGPU: L( "<p>Désactive l'accélération matérielle de GraXpert (problèmes de pilote).</p>",
                       "<p>Turns GraXpert hardware acceleration off (driver issues).</p>" ),
      bg: L( "<p>Crée une preview sur une zone de fond de ciel propre de l'image RGB, puis l'utilise comme " +
             "référence de BackgroundNeutralization et comme région de neutralisation de SPCC. À faire après " +
             "le retrait de gradient, sinon la recherche s'arrête sur la zone la moins dégradée plutôt que " +
             "sur le vrai fond.</p>",
             "<p>Creates a preview on a clean sky area of the RGB image, then uses it as the " +
             "BackgroundNeutralization reference and as the SPCC neutralization region. Run it after the " +
             "gradient removal, otherwise the search settles on the least degraded area rather than on the " +
             "true background.</p>" ),
      bgAuto: L( "<p>Recherche automatique : carré de fond le plus sombre et le plus plat, étoiles et nébulosité " +
                 "évitées (médiane basse, dispersion et écart moyenne/médiane pénalisés).</p>",
                 "<p>Automatic search: darkest and flattest square of sky, stars and nebulosity avoided (low " +
                 "median, dispersion and mean/median gap penalized).</p>" ),
      bgPreview: L( "<p>Reprend le rectangle d'une preview déjà posée sur une des images d'entrée (ou sur toute image " +
                    "de même taille).</p>",
                    "<p>Takes the rectangle of a preview already placed on one of the input images (or on any image " +
                    "of the same size).</p>" ),
      bgName: L( "<p>Identifiant de la preview créée sur l'image RGB.</p>",
                 "<p>Identifier of the preview created on the RGB image.</p>" ),
      bgSize: L( "<p>Côté du carré de fond, en pixels.</p>", "<p>Side of the background square, in pixels.</p>" ),
      bgMargin: L( "<p>Bord de l'image exclu de la recherche, en pourcentage de la largeur et de la hauteur " +
                   "(artefacts de bord d'empilement).</p>",
                   "<p>Image border excluded from the search, in percent of width and height (stacking edge " +
                   "artifacts).</p>" ),
      bgWeight: L( "<p>Poids de la pénalité sur la dispersion et sur l'écart moyenne/médiane. 0 : seul le niveau " +
                   "médian compte ; plus haut : les zones texturées ou étoilées sont davantage évitées.</p>",
                   "<p>Weight of the penalty on dispersion and on the mean/median gap. 0: only the median level " +
                   "counts; higher: textured or starry areas are avoided more.</p>" ),
      bn: L( "<p>Réglages de BackgroundNeutralization, nommés comme dans le process.</p>",
             "<p>BackgroundNeutralization settings, named as in the process.</p>" ),
      bnMode: L( "<p>Working mode du process. Rescale as needed (défaut) : remise à l'échelle seulement si la " +
                 "neutralisation sort de la plage. Target background : impose la moyenne du fond RGB à la valeur " +
                 "Target background par une transformation additive. Rescale : remise à l'échelle systématique " +
                 "(multiplicative, niveau de fond non maîtrisé). Truncate : écrêtage des valeurs hors plage.</p>",
                 "<p>Process Working mode. Rescale as needed (default): rescales only when neutralization produces " +
                 "out-of-range values. Target background: forces the mean RGB background to the Target background " +
                 "value with an additive transformation. Rescale: always rescales (multiplicative, background level " +
                 "not controlled). Truncate: clips out-of-range values.</p>" ),
      bnTarget: L( "<p>Niveau moyen de fond imposé, utilisé seulement en mode Target background.</p>",
                   "<p>Imposed mean background level, used in Target background mode only.</p>" ),
      bnAutoTarget: L( "<p>Mode Target background : le niveau imposé est la moyenne des médianes R, G, B de la preview, " +
                       "mesurée juste avant la neutralisation. L'image garde son niveau de fond, la correction est " +
                       "purement additive et rien n'est plaqué sur le plancher à zéro, ce qui évite les artefacts " +
                       "de tuiles des outils IA sur un fond nul. Décoché : la valeur Target background saisie.</p>",
                       "<p>Target background mode: the imposed level is the mean of the R, G, B medians of the preview, " +
                       "measured right before neutralization. The image keeps its background level, the correction " +
                       "is purely additive and nothing is pushed onto the zero floor, which avoids the tile " +
                       "artifacts of AI tools on a zero background. Unchecked: the typed Target background.</p>" ),
      bnAutoHigh: L( "<p>Upper limit calculé avant la neutralisation à partir des statistiques de la preview de fond : " +
                     "pour chaque canal, médiane + k sigma (sigma = 1,4826 × MAD, insensible aux étoiles), et la " +
                     "plus grande des trois bornes est retenue pour ne pas écrêter le canal le plus clair. Les pixels " +
                     "de la preview au-dessus (étoiles restantes) sont exclus de la référence. La console indique le " +
                     "pourcentage de pixels retenus par canal : proche de 100 %, la borne ne coupe que les étoiles. " +
                     "Décoché : la valeur Upper limit saisie est utilisée.</p>",
                     "<p>Upper limit computed before neutralization from the statistics of the background preview: " +
                     "for each channel, median + k sigma (sigma = 1.4826 × MAD, insensitive to stars), and the " +
                     "largest of the three limits is kept so the brightest channel is not clipped. Preview pixels " +
                     "above it (remaining stars) are excluded from the reference. The console shows the percentage " +
                     "of pixels kept per channel: close to 100 %, the limit only cuts the stars. Unchecked: the " +
                     "typed Upper limit is used.</p>" ),
      spccFilters: L( "<p>Filtres et courbe de rendement quantique du capteur, lus dans la base de filtres de PixInsight " +
                      "(celle de FilterManager et de SPCC). « (icône ou défaut) » laisse la valeur de l'icône de " +
                      "process ou le défaut de SPCC.</p>",
                      "<p>Filters and sensor quantum efficiency curve, read from the PixInsight filter database (the " +
                      "one FilterManager and SPCC use). \"(icon or default)\" keeps the value of the process icon " +
                      "or the SPCC default.</p>" ),
      bxt1: L( "<p>Passe BlurXTerminator en Correct Only avant la résolution astrométrique et SPCC, pour corriger " +
               "les étoiles sans les affiner.</p>",
               "<p>BlurXTerminator pass in Correct Only mode before plate solving and SPCC, to correct the stars " +
               "without sharpening them.</p>" ),
      solve: L( "<p>Résolution astrométrique par le script ImageSolver de PixInsight, à partir des métadonnées de " +
                "l'image (focale, taille de pixel, coordonnées). Sautée si l'image RGB a déjà une solution, " +
                "héritée des masters.</p>",
                "<p>Plate solving with the PixInsight ImageSolver script, from the image metadata (focal length, " +
                "pixel size, coordinates). By default the image is solved even when it already inherits a " +
                "solution from the masters (advanced mode checkbox).</p>" ),
      solveForce: L( "<p>Résout même si l'image a déjà une solution astrométrique.</p>",
                     "<p>Solves even when the image already has an astrometric solution.</p>" ),
      solveDistortion: L( "<p>Distortion correction d'ImageSolver (splines), recommandée avec des optiques " +
                          "grand champ.</p>",
                          "<p>ImageSolver Distortion correction (splines), recommended with wide-field optics.</p>" ),
      spcc: L( "<p>SpectrophotometricColorCalibration. Les courbes de filtres, le capteur, la référence de blanc " +
               "et le catalogue viennent de l'icône de process choisie ; le script ne règle que la " +
               "neutralisation du fond.</p>",
               "<p>SpectrophotometricColorCalibration. Filter curves, sensor, white reference and catalog come " +
               "from the chosen process icon; the script only sets the background neutralization.</p>" ),
      spccIcon: L( "<p>Icône de process SPCC présente sur le bureau PixInsight, réglée pour tes filtres et ton " +
                   "capteur. Sans icône, SPCC tourne avec ses réglages par défaut.</p>",
                   "<p>SPCC process icon present on the PixInsight workspace, set up for your filters and " +
                   "sensor. Without an icon, SPCC runs with its default settings.</p>" ),
      spccNeutralize: L( "<p>Background neutralization de SPCC.</p>", "<p>SPCC Background neutralization.</p>" ),
      spccUseROI: L( "<p>Neutralise sur le rectangle de la preview de fond (Region of interest de SPCC) plutôt " +
                     "que sur l'image entière.</p>",
                     "<p>Neutralizes on the background preview rectangle (SPCC Region of interest) rather than " +
                     "on the whole image.</p>" ),
      spccGraphs: L( "<p>Generate graphs de SPCC.</p>", "<p>SPCC Generate graphs.</p>" ),
      bxtPSFDiameter: L( "<p>En pixels. Utilisé seulement si Automatic PSF est décoché.</p>",
                         "<p>In pixels. Used only when Automatic PSF is unchecked.</p>" ),
      sxtUnscreen: L( "<p>Réservé aux images étirées : RC Astro recommande de ne pas l'utiliser sur une image " +
                      "linéaire.</p>",
                      "<p>For stretched images only: RC Astro recommends not using it on a linear image.</p>" ),
      nxt: L( "<p>Réduction de bruit sur l'image sans étoiles, en fin de pipeline. Décochée par défaut : beaucoup " +
              "préfèrent la placer plus tard, après l'étirement.</p>",
              "<p>Noise reduction on the starless image, at the end of the pipeline. Unchecked by default: many " +
              "prefer to run it later, after stretching.</p>" ),
      nxtFrequencyScale: L( "<p>En pixels : échelle qui sépare hautes et basses fréquences.</p>",
                            "<p>In pixels: scale separating high and low frequencies.</p>" ),
      autoSTF: L( "<p>Applique une STF automatique (liée) à l'image sans étoiles et au modèle de fond, en fin de " +
                  "pipeline. L'image des étoiles reçoit la STF de l'image sans étoiles (une auto STF à part n'a " +
                  "pas de sens sur une image de médiane nulle). Affichage seulement : les pixels ne sont pas " +
                  "modifiés.</p>",
                  "<p>Applies a linked automatic STF to the starless image and to the background model, at the " +
                  "end of the pipeline. The star image gets the STF of the starless image (an auto STF of its " +
                  "own makes no sense on a zero-median image). Display only: pixels are not changed.</p>" ),
      stfShadowsClipping: L( "<p>Écrêtage des ombres, en MAD normalisées sous la médiane. Plus négatif = fond plus " +
                             "clair.</p>",
                             "<p>Shadows clipping, in normalized MAD units below the median. More negative = " +
                             "brighter background.</p>" ),
      stfTargetBackground: L( "<p>Niveau visé pour la médiane du fond à l'écran (0 à 1).</p>",
                              "<p>Target screen level for the background median (0 to 1).</p>" ),
      lang: L( "<p>Langue de l'interface. Le dialogue se rouvre aussitôt dans la langue choisie, en gardant les " +
               "réglages. Le choix est mémorisé.</p>",
               "<p>Interface language. The dialog reopens right away in the chosen language, keeping the " +
               "settings. The choice is remembered.</p>" ),
      newInstance: L( "<p>Glisser sur le bureau pour créer une icône de process avec tous les réglages et le nom " +
                      "des images. Un double-clic sur l'icône rouvre ce dialogue avec ces réglages.</p>",
                      "<p>Drag to the workspace to create a process icon with all settings and image names. " +
                      "Double-clicking the icon reopens this dialog with these settings.</p>" ),
      reset: L( "<p>Remet tous les réglages à leurs valeurs par défaut (les images choisies sont conservées).</p>",
                "<p>Restores all settings to their default values (the selected images are kept).</p>" ),
      run: L( "<p>Lance le pipeline.</p>", "<p>Runs the pipeline.</p>" )
   };
}

// ============================================================================
// Dialog
// ============================================================================

var BBDialog = class extends Dialog {
constructor()
{
   super();
   var self = this;
   var T = tips();
   this.windowTitle = SCRIPT_TITLE + " " + SCRIPT_VERSION;
   this.relaunch = false;
   this.runRequested = false;

   var lw = this.font.width( "Denoise HF intensity:" ) + 12;
   var outWidth = this.font.width( "StarlessRGB_00000" ) + 16;

   this.numerics = {};
   this.checks = {};

   // Scrollable area holding all the groups: the dialog stays on screen whatever
   // the number of advanced groups shown.
   // Manual scrolling: the content control is laid out at its natural size
   // inside the viewport and moved up by the scroll position; the vertical range
   // is the overflow of the content over the visible area.
   this.scrollBox = new ScrollBox( this );
   this.scrollBox.autoScroll = false;
   this.scrollBox.horizontalScrollBarVisible = false;
   this.scrollBox.verticalScrollBarVisible = true;
   this.scrollBox.setScaledMinHeight( 520 );
   this.content = new Control( this.scrollBox.viewport );
   this.content.sizer = new VerticalSizer;
   this.content.sizer.margin = 2;
   this.content.sizer.spacing = 8;
   this.scrollBox.onVerticalScrollPosUpdated = function( pos )
   {
      self.content.move( 0, -pos );
   };
   this.scrollBox.viewport.onResize = function()
   {
      self.updateScrollRange();
   };

   function makeGroup( title )
   {
      var g = new GroupBox( self.content );
      g.title = title;
      g.sizer = new VerticalSizer;
      g.sizer.margin = 6;
      g.sizer.spacing = 4;
      return g;
   }

   function makeCheck( parent, key, text, tip )
   {
      var c = new CheckBox( parent );
      c.text = text;
      if ( tip ) c.toolTip = tip;
      c.onCheck = function( checked )
      {
         TP[key] = checked;
         self.refresh();
      };
      self.checks[key] = c;
      return c;
   }

   function makeNumeric( parent, key, label, min, max, prec, tip )
   {
      var nc = new NumericControl( parent );
      nc.label.text = label;
      nc.label.minWidth = lw;
      nc.setReal( true );
      nc.setRange( min, max );
      nc.setPrecision( prec );
      nc.slider.setRange( 0, 1000 );
      nc.slider.minWidth = 200;
      if ( tip ) nc.toolTip = tip;
      nc.onValueUpdated = function( v ) { TP[key] = v; };
      self.numerics[key] = nc;
      return nc;
   }

   function makeLabel( parent, text, tip )
   {
      var l = new Label( parent );
      l.text = text;
      l.minWidth = lw;
      l.textAlignment = TextAlignment.Right | TextAlignment.VertCenter;
      if ( tip ) l.toolTip = tip;
      return l;
   }

   function labelledRow( parent, text, control, tip )
   {
      var s = new HorizontalSizer;
      s.spacing = 4;
      s.add( makeLabel( parent, text, tip ) );
      s.add( control );
      s.addStretch();
      return s;
   }

   // --- Help ------------------------------------------------------------------
   this.helpLabel = new Label( this );
   this.helpLabel.wordWrapping = true;
   this.helpLabel.useRichText = true;
   this.helpLabel.text = L(
      "<p><b>" + SCRIPT_TITLE + "</b> : choisis les masters R, G et B. Le script assemble l'image RGB, retire le " +
      "gradient, pose une preview sur le fond de ciel, neutralise et calibre les couleurs (SPCC), puis sépare " +
      "les étoiles. Les masters restent intacts. Le mode avancé donne accès aux réglages de chaque outil, " +
      "nommés comme dans les outils eux-mêmes.</p>",
      "<p><b>" + SCRIPT_TITLE + "</b>: pick the R, G and B masters. The script builds the RGB image, removes the " +
      "gradient, places a preview on the sky background, neutralizes and calibrates the colors (SPCC), then " +
      "separates the stars. The masters stay untouched. Advanced mode gives access to the settings of each " +
      "tool, named as in the tools themselves.</p>" );

   // --- Images ----------------------------------------------------------------
   this.imagesGroup = makeGroup( L( "Images", "Images" ) );
   this.rows = [];
   var taken = {};
   for ( var i = 0; i < CHANNELS.length; ++i )
   {
      var c = CHANNELS[i];
      var row = { channel: c };

      row.label = new Label( this.imagesGroup );
      row.label.text = c.key + " :";
      row.label.minWidth = this.font.width( "B :" ) + 8;
      row.label.textAlignment = TextAlignment.Right | TextAlignment.VertCenter;

      row.list = new ViewList( this.imagesGroup );
      row.list.getMainViews();
      row.list.minWidth = 300;
      row.list.toolTip = T.view;
      var v = findView( TP[c.idKey] );
      if ( v == null )
      {
         v = guessView( c, taken );
         TP[c.idKey] = v != null ? v.id : "";
      }
      if ( v != null )
      {
         taken[v.id] = true;
         row.list.currentView = v;
      }
      row.list.onViewSelected = ( function( key ) {
         return function( view ) { TP[key] = ( view != null && !view.isNull ) ? view.id : ""; };
      } )( c.idKey );

      var rs = new HorizontalSizer;
      rs.spacing = 6;
      rs.add( row.label );
      rs.add( row.list, 100 );
      this.imagesGroup.sizer.add( rs );
      this.rows.push( row );
   }

   this.outStarless = new Edit( this.imagesGroup );
   this.outStarless.minWidth = outWidth;
   this.outStarless.toolTip = T.outStarless;
   this.outStarless.onTextUpdated = function( text ) { TP.outStarless = text; };
   this.outStars = new Edit( this.imagesGroup );
   this.outStars.minWidth = outWidth;
   this.outStars.toolTip = T.outStars;
   this.outStars.onTextUpdated = function( text ) { TP.outStars = text; };
   var outRow = new HorizontalSizer;
   outRow.spacing = 6;
   outRow.add( makeLabel( this.imagesGroup, L( "Sans étoiles :", "Starless:" ), T.outStarless ) );
   outRow.add( this.outStarless );
   outRow.addSpacing( 12 );
   outRow.add( makeLabel( this.imagesGroup, L( "Étoiles :", "Stars:" ), T.outStars ) );
   outRow.add( this.outStars );
   outRow.addStretch();
   this.imagesGroup.sizer.addSpacing( 4 );
   this.imagesGroup.sizer.add( outRow );

   // --- Pipeline --------------------------------------------------------------
   this.pipeGroup = makeGroup( L( "Pipeline", "Pipeline" ) );
   this.pipeGroup.sizer.add( makeCheck( this.pipeGroup, "gxEnabled",
      L( "GraXpert : retrait de gradient AI", "GraXpert: AI background extraction" ) ) );
   this.pipeGroup.sizer.add( makeCheck( this.pipeGroup, "bgEnabled",
      L( "Preview de fond + BackgroundNeutralization", "Background preview + BackgroundNeutralization" ), T.bg ) );
   this.pipeGroup.sizer.add( makeCheck( this.pipeGroup, "bxt1Enabled", "BlurXTerminator (Correct Only)", T.bxt1 ) );
   this.pipeGroup.sizer.add( makeCheck( this.pipeGroup, "solveEnabled",
      "ImageSolver", T.solve ) );
   this.pipeGroup.sizer.add( makeCheck( this.pipeGroup, "spccEnabled", "SpectrophotometricColorCalibration", T.spcc ) );
   this.pipeGroup.sizer.add( makeCheck( this.pipeGroup, "bxtEnabled", "BlurXTerminator" ) );
   this.pipeGroup.sizer.add( makeCheck( this.pipeGroup, "sxtEnabled",
      L( "StarXTerminator : sans étoiles + étoiles", "StarXTerminator: starless + stars" ) ) );
   this.pipeGroup.sizer.add( makeCheck( this.pipeGroup, "nxtEnabled", "NoiseXTerminator", T.nxt ) );
   this.pipeGroup.sizer.add( makeCheck( this.pipeGroup, "autoSTF",
      L( "Auto STF en fin de pipeline", "Auto STF at the end of the pipeline" ), T.autoSTF ) );
   this.pipeGroup.sizer.addSpacing( 6 );
   this.pipeGroup.sizer.add( makeCheck( this.pipeGroup, "advanced", L( "Mode avancé", "Advanced mode" ), T.advanced ) );

   // --- Background preview (always visible: the source choice matters) -------
   this.bgGroup = makeGroup( L( "Fond de ciel", "Sky background" ) );
   this.bgAuto = new RadioButton( this.bgGroup );
   this.bgAuto.text = L( "Recherche automatique", "Automatic search" );
   this.bgAuto.toolTip = T.bgAuto;
   this.bgAuto.onCheck = function( on ) { if ( on ) { TP.bgSource = "auto"; self.refresh(); } };
   this.bgFromPreview = new RadioButton( this.bgGroup );
   this.bgFromPreview.text = L( "Preview existante :", "Existing preview:" );
   this.bgFromPreview.toolTip = T.bgPreview;
   this.bgFromPreview.onCheck = function( on ) { if ( on ) { TP.bgSource = "preview"; self.refresh(); } };
   this.bgPreviewList = new ViewList( this.bgGroup );
   this.bgPreviewList.getPreviews();
   this.bgPreviewList.minWidth = 260;
   this.bgPreviewList.toolTip = T.bgPreview;
   var pv = findView( TP.bgPreviewId );
   if ( pv != null && pv.isPreview )
      this.bgPreviewList.currentView = pv;
   this.bgPreviewList.onViewSelected = function( view )
   {
      TP.bgPreviewId = ( view != null && !view.isNull ) ? view.fullId : "";
   };
   var bgRow = new HorizontalSizer;
   bgRow.spacing = 8;
   bgRow.add( this.bgAuto );
   bgRow.add( this.bgFromPreview );
   bgRow.add( this.bgPreviewList, 100 );
   this.bgGroup.sizer.add( bgRow );

   // --- Advanced: GraXpert ----------------------------------------------------
   this.gxGroup = makeGroup( "GraXpert" );
   this.gxGroup.sizer.add( makeNumeric( this.gxGroup, "gxSmoothing", "Smoothing:", 0, 1, 2, T.gxSmoothing ) );
   this.gxCorrection = new ComboBox( this.gxGroup );
   this.gxCorrection.addItem( "Subtraction" );
   this.gxCorrection.addItem( "Division" );
   this.gxCorrection.toolTip = T.gxCorrection;
   this.gxCorrection.onItemSelected = function( index )
   {
      TP.gxCorrection = ( index == 1 ) ? "Division" : "Subtraction";
   };
   this.gxGroup.sizer.add( labelledRow( this.gxGroup, "Correction:", this.gxCorrection ) );
   this.gxGroup.sizer.add( makeCheck( this.gxGroup, "gxShowBackground", "Show background", T.gxShowBackground ) );
   this.gxGroup.sizer.add( makeCheck( this.gxGroup, "gxDisableGPU", "Disable GPU acceleration", T.gxDisableGPU ) );

   // --- Advanced: background search + BackgroundNeutralization ----------------
   this.bgAdvGroup = makeGroup( L( "Preview de fond + BackgroundNeutralization", "Background preview + BackgroundNeutralization" ) );
   this.bgName = new Edit( this.bgAdvGroup );
   this.bgName.minWidth = outWidth;
   this.bgName.toolTip = T.bgName;
   this.bgName.onTextUpdated = function( text ) { TP.bgName = text; };
   this.bgAdvGroup.sizer.add( labelledRow( this.bgAdvGroup, L( "Nom de la preview :", "Preview name:" ), this.bgName, T.bgName ) );
   this.bgAdvGroup.sizer.add( makeNumeric( this.bgAdvGroup, "bgSize", L( "Taille du carré (px) :", "Square size (px):" ), 16, 1000, 0, T.bgSize ) );
   this.bgAdvGroup.sizer.add( makeNumeric( this.bgAdvGroup, "bgMargin", L( "Marge de bord (%) :", "Border margin (%):" ), 0, 25, 1, T.bgMargin ) );
   this.bgAdvGroup.sizer.add( makeNumeric( this.bgAdvGroup, "bgWeight", L( "Poids structure :", "Structure weight:" ), 0, 5, 2, T.bgWeight ) );
   this.bgAdvGroup.sizer.addSpacing( 4 );
   this.bgAdvGroup.sizer.add( makeNumeric( this.bgAdvGroup, "bnLow", "Lower limit:", 0, 1, 7, T.bn ) );
   this.bgAdvGroup.sizer.add( makeCheck( this.bgAdvGroup, "bnAutoHigh",
      L( "Upper limit automatique (statistiques de la preview)", "Automatic Upper limit (preview statistics)" ), T.bnAutoHigh ) );
   this.bgAdvGroup.sizer.add( makeNumeric( this.bgAdvGroup, "bnSigmas",
      L( "Sigmas au-dessus de la médiane :", "Sigmas above the median:" ), 0.5, 10, 1, T.bnAutoHigh ) );
   this.bgAdvGroup.sizer.add( makeNumeric( this.bgAdvGroup, "bnHigh", "Upper limit:", 0, 1, 7, T.bn ) );
   this.bnMode = new ComboBox( this.bgAdvGroup );
   this.bnModeIds = [ "TargetBackground", "Rescale", "RescaleAsNeeded", "Truncate" ];
   this.bnMode.addItem( "Target background" );
   this.bnMode.addItem( "Rescale" );
   this.bnMode.addItem( "Rescale as needed" );
   this.bnMode.addItem( "Truncate" );
   this.bnMode.toolTip = T.bnMode;
   this.bnMode.onItemSelected = function( index )
   {
      TP.bnMode = self.bnModeIds[index];
      self.refresh();
   };
   this.bgAdvGroup.sizer.add( labelledRow( this.bgAdvGroup, "Working mode:", this.bnMode, T.bnMode ) );
   this.bgAdvGroup.sizer.add( makeCheck( this.bgAdvGroup, "bnAutoTarget",
      L( "Target background automatique (médiane de la preview)", "Automatic Target background (preview median)" ), T.bnAutoTarget ) );
   this.bgAdvGroup.sizer.add( makeNumeric( this.bgAdvGroup, "bnTarget", "Target background:", 0, 1, 7, T.bnTarget ) );

   // --- Advanced: ImageSolver -------------------------------------------------
   this.solveGroup = makeGroup( "ImageSolver" );
   this.solveGroup.sizer.add( makeCheck( this.solveGroup, "solveForce",
      L( "Résoudre même si déjà résolue", "Solve even when already solved" ), T.solveForce ) );
   this.solveGroup.sizer.add( makeCheck( this.solveGroup, "solveDistortion", "Distortion correction", T.solveDistortion ) );

   // --- Advanced: SPCC --------------------------------------------------------
   this.spccGroup = makeGroup( "SpectrophotometricColorCalibration" );
   this.spccIconCombo = new ComboBox( this.spccGroup );
   this.spccIconCombo.toolTip = T.spccIcon;
   this.spccIconIds = [ "" ].concat( spccIcons() );
   this.spccIconCombo.addItem( L( "(réglages par défaut de SPCC)", "(SPCC default settings)" ) );
   for ( var k = 1; k < this.spccIconIds.length; ++k )
      this.spccIconCombo.addItem( this.spccIconIds[k] );
   this.spccIconCombo.onItemSelected = function( index ) { TP.spccIcon = self.spccIconIds[index]; };
   this.spccGroup.sizer.add( labelledRow( this.spccGroup, L( "Icône de process :", "Process icon:" ), this.spccIconCombo, T.spccIcon ) );

   // Filters and sensor, from the PixInsight filter database.
   var db = loadFilterDatabase();
   var noneItem = L( "(icône ou défaut)", "(icon or default)" );
   // Filters of the channel, plus the PAN (OSC / multiband) and untagged ones.
   function filterNames( channel )
   {
      var names = [];
      for ( var i = 0; i < db.filters.length; ++i )
      {
         var ch = db.filters[i].channel;
         if ( channel.length == 0 || ch == channel || ch == "PAN" || ch.length == 0 )
            names.push( db.filters[i].name );
      }
      return names;
   }
   function makeFilterCombo( key, names )
   {
      var cb = new ComboBox( self.spccGroup );
      cb.toolTip = T.spccFilters;
      cb.names = [ "" ].concat( names );
      cb.addItem( noneItem );
      for ( var i = 0; i < names.length; ++i )
         cb.addItem( names[i] );
      cb.onItemSelected = function( index ) { TP[key] = cb.names[index]; };
      return cb;
   }
   // Channel-tagged lists first; if the database carries no channel tags, all filters.
   var rNames = filterNames( "R" ), gNames = filterNames( "G" ), bNames = filterNames( "B" );
   if ( rNames.length == 0 || gNames.length == 0 || bNames.length == 0 )
      rNames = gNames = bNames = filterNames( "" );
   var qeNames = [];
   for ( var q = 0; q < db.qe.length; ++q )
      qeNames.push( db.qe[q].name );
   this.spccFilterR = makeFilterCombo( "spccFilterR", rNames );
   this.spccFilterG = makeFilterCombo( "spccFilterG", gNames );
   this.spccFilterB = makeFilterCombo( "spccFilterB", bNames );
   this.spccQE = makeFilterCombo( "spccQE", qeNames );
   this.spccGroup.sizer.add( labelledRow( this.spccGroup, "Red filter:", this.spccFilterR, T.spccFilters ) );
   this.spccGroup.sizer.add( labelledRow( this.spccGroup, "Green filter:", this.spccFilterG, T.spccFilters ) );
   this.spccGroup.sizer.add( labelledRow( this.spccGroup, "Blue filter:", this.spccFilterB, T.spccFilters ) );
   this.spccGroup.sizer.add( labelledRow( this.spccGroup, "QE curve:", this.spccQE, T.spccFilters ) );
   this.spccDbLabel = new Label( this.spccGroup );
   this.spccDbLabel.wordWrapping = true;
   this.spccDbLabel.text = db.path.length > 0
      ? format( L( "Base de filtres : %s (%d filtres, %d courbes QE)", "Filter database: %s (%d filters, %d QE curves)" ),
                db.path, db.filters.length, db.qe.length )
      : L( "Base de filtres introuvable (filters.xspd) : filtres et capteur de l'icône ou par défaut.",
           "Filter database not found (filters.xspd): filters and sensor from the icon or defaults." );
   this.spccGroup.sizer.add( this.spccDbLabel );
   this.spccGroup.sizer.add( makeCheck( this.spccGroup, "spccNeutralize", "Background neutralization", T.spccNeutralize ) );
   this.spccGroup.sizer.add( makeCheck( this.spccGroup, "spccUseROI",
      L( "Region of interest = preview de fond", "Region of interest = background preview" ), T.spccUseROI ) );
   this.spccGroup.sizer.add( makeCheck( this.spccGroup, "spccGraphs", "Generate graphs", T.spccGraphs ) );

   // --- Advanced: BlurXTerminator ---------------------------------------------
   this.bxtGroup = makeGroup( "BlurXTerminator" );
   this.bxtGroup.sizer.add( makeNumeric( this.bxtGroup, "bxtSharpenStars", "Sharpen Stars:", 0, 0.70, 2 ) );
   this.bxtGroup.sizer.add( makeNumeric( this.bxtGroup, "bxtAdjustStarHalos", "Adjust Star Halos:", -0.50, 0.50, 2 ) );
   this.bxtGroup.sizer.add( makeCheck( this.bxtGroup, "bxtAutoPSF", "Automatic PSF" ) );
   this.bxtGroup.sizer.add( makeNumeric( this.bxtGroup, "bxtPSFDiameter", "PSF Diameter:", 0, 8, 2, T.bxtPSFDiameter ) );
   this.bxtGroup.sizer.add( makeNumeric( this.bxtGroup, "bxtSharpenNonstellar", "Sharpen Nonstellar:", 0, 1, 2 ) );

   // --- Advanced: StarXTerminator ---------------------------------------------
   this.sxtGroup = makeGroup( "StarXTerminator" );
   this.sxtGroup.sizer.add( makeCheck( this.sxtGroup, "sxtUnscreen", "Unscreen Stars", T.sxtUnscreen ) );

   // --- Advanced: NoiseXTerminator --------------------------------------------
   this.nxtGroup = makeGroup( "NoiseXTerminator" );
   this.nxtGroup.sizer.add( makeCheck( this.nxtGroup, "nxtColorSep", "Intensity/color separation" ) );
   this.nxtGroup.sizer.add( makeCheck( this.nxtGroup, "nxtFreqSep", "Frequency separation" ) );
   this.nxtGroup.sizer.add( makeNumeric( this.nxtGroup, "nxtDenoise", "Denoise:", 0, 1, 2 ) );
   this.nxtGroup.sizer.add( makeNumeric( this.nxtGroup, "nxtDenoiseIntensity", "Denoise intensity:", 0, 1, 2 ) );
   this.nxtGroup.sizer.add( makeNumeric( this.nxtGroup, "nxtDenoiseColor", "Denoise color:", 0, 1, 2 ) );
   this.nxtGroup.sizer.add( makeNumeric( this.nxtGroup, "nxtDenoiseHF", "Denoise HF:", 0, 1, 2 ) );
   this.nxtGroup.sizer.add( makeNumeric( this.nxtGroup, "nxtDenoiseLF", "Denoise LF:", 0, 1, 2 ) );
   this.nxtGroup.sizer.add( makeNumeric( this.nxtGroup, "nxtDenoiseIntensityHF", "Denoise HF intensity:", 0, 1, 2 ) );
   this.nxtGroup.sizer.add( makeNumeric( this.nxtGroup, "nxtDenoiseIntensityLF", "Denoise LF intensity:", 0, 1, 2 ) );
   this.nxtGroup.sizer.add( makeNumeric( this.nxtGroup, "nxtDenoiseColorHF", "Denoise HF color:", 0, 1, 2 ) );
   this.nxtGroup.sizer.add( makeNumeric( this.nxtGroup, "nxtDenoiseColorLF", "Denoise LF color:", 0, 1, 2 ) );
   this.nxtGroup.sizer.add( makeNumeric( this.nxtGroup, "nxtFrequencyScale", "Frequency scale:", 1, 10, 1, T.nxtFrequencyScale ) );
   this.nxtGroup.sizer.add( makeNumeric( this.nxtGroup, "nxtDetail", "Detail:", 0, 1, 2 ) );
   this.nxtIterations = new SpinBox( this.nxtGroup );
   this.nxtIterations.minValue = 1;
   this.nxtIterations.maxValue = 5;
   this.nxtIterations.onValueUpdated = function( v ) { TP.nxtIterations = v; };
   this.nxtGroup.sizer.add( labelledRow( this.nxtGroup, "Iterations:", this.nxtIterations ) );

   // --- Advanced: Auto STF ----------------------------------------------------
   this.stfGroup = makeGroup( "Auto STF" );
   this.stfGroup.sizer.add( makeNumeric( this.stfGroup, "stfShadowsClipping", "Shadows clipping:", -10, 0, 2, T.stfShadowsClipping ) );
   this.stfGroup.sizer.add( makeNumeric( this.stfGroup, "stfTargetBackground", "Target background:", 0, 1, 2, T.stfTargetBackground ) );

   // --- Language --------------------------------------------------------------
   this.langLabel = new Label( this );
   this.langLabel.text = "Langue / Language :";
   this.langLabel.textAlignment = TextAlignment.Right | TextAlignment.VertCenter;
   this.langLabel.toolTip = T.lang;
   this.langCombo = new ComboBox( this );
   this.langCombo.addItem( "English" );
   this.langCombo.addItem( "Français" );
   this.langCombo.currentItem = LANG == "fr" ? 1 : 0;
   this.langCombo.toolTip = T.lang;
   this.langCombo.onItemSelected = function( idx )
   {
      var nl = idx == 1 ? "fr" : "en";
      if ( nl == LANG )
         return;
      LANG = nl;
      saveLanguage( nl );
      self.relaunch = true;
      self.ok();
   };
   var langRow = new HorizontalSizer;
   langRow.spacing = 4;
   langRow.addStretch();
   langRow.add( this.langLabel );
   langRow.add( this.langCombo );

   // --- Buttons ---------------------------------------------------------------
   this.newInstanceButton = new ToolButton( this );
   this.newInstanceButton.icon = this.scaledResource( ":/process-interface/new-instance.png" );
   this.newInstanceButton.setScaledFixedSize( 20, 20 );
   this.newInstanceButton.toolTip = T.newInstance;
   this.newInstanceButton.onMousePress = function()
   {
      this.hasFocus = true;
      saveParameters();
      this.pushed = false;
      this.dialog.newInstance();
   };

   this.resetButton = new ToolButton( this );
   this.resetButton.icon = this.scaledResource( ":/process-interface/reset.png" );
   this.resetButton.setScaledFixedSize( 20, 20 );
   this.resetButton.toolTip = T.reset;
   this.resetButton.onClick = function()
   {
      resetTP( true );
      self.updateControls();
   };

   this.runButton = new PushButton( this );
   this.runButton.text = L( "Exécuter", "Run" );
   this.runButton.icon = this.scaledResource( ":/icons/ok.png" );
   this.runButton.toolTip = T.run;
   this.runButton.onClick = function()
   {
      try
      {
         validate( TP );
      }
      catch ( e )
      {
         errorBox( bbErrText( e ) );
         return;
      }
      saveSettings();
      self.runRequested = true;
      self.ok();
   };

   this.closeButton = new PushButton( this );
   this.closeButton.text = L( "Fermer", "Close" );
   this.closeButton.icon = this.scaledResource( ":/icons/cancel.png" );
   this.closeButton.onClick = function()
   {
      saveSettings();
      self.cancel();
   };

   var bRow = new HorizontalSizer;
   bRow.spacing = 6;
   bRow.add( this.newInstanceButton );
   bRow.add( this.resetButton );
   bRow.addStretch();
   bRow.add( this.runButton );
   bRow.add( this.closeButton );

   var vs = this.content.sizer;
   vs.add( this.imagesGroup );
   vs.add( this.pipeGroup );
   vs.add( this.bgGroup );
   vs.add( this.gxGroup );
   vs.add( this.bgAdvGroup );
   vs.add( this.solveGroup );
   vs.add( this.spccGroup );
   vs.add( this.bxtGroup );
   vs.add( this.sxtGroup );
   vs.add( this.nxtGroup );
   vs.add( this.stfGroup );
   vs.addStretch();

   this.sizer = new VerticalSizer;
   this.sizer.margin = 8;
   this.sizer.spacing = 8;
   this.sizer.add( this.helpLabel );
   this.sizer.add( this.scrollBox, 100 );
   this.sizer.add( langRow );
   this.sizer.add( bRow );
   this.userResizable = true;

   this.updateControls();
}

// Resize the scroll viewport to its contents, so the vertical scroll bar
// follows the groups currently shown.
layoutScroll()
{
   var c = this.content;
   c.setMinSize( 1, 1 );
   c.adjustToContents();
   this.contentMinWidth = c.width;
   var h = c.height;
   c.setMinSize( c.width, h );
   var bw = c.width + this.logicalPixelsToPhysical( 24 );
   if ( this.scrollBox.minWidth < bw )
      this.scrollBox.setMinWidth( bw );
   this.updateScrollRange();
}

// Vertical scroll range from the overflow of the content over the viewport;
// the content is stretched to the viewport width so the groups fill it.
updateScrollRange()
{
   if ( !this.content || !this.scrollBox )
      return;
   var vp = this.scrollBox.viewport;
   var c = this.content;
   var w = Math.max( this.contentMinWidth || c.width, vp.width );
   if ( c.width != w )
      c.resize( w, c.height );
   var max = Math.max( 0, c.height - vp.height );
   this.scrollBox.setVerticalScrollRange( 0, max );
   this.scrollBox.pageHeight = vp.height;
   this.scrollBox.lineHeight = this.logicalPixelsToPhysical( 24 );
   var pos = Math.min( this.scrollBox.verticalScrollPosition, max );
   this.scrollBox.verticalScrollPosition = pos;
   c.move( 0, -pos );
}

// Push the settings into the controls.
updateControls()
{
   for ( var k in this.numerics )
      this.numerics[k].setValue( TP[k] );
   for ( var k in this.checks )
      this.checks[k].checked = TP[k];
   this.outStarless.text = TP.outStarless;
   this.outStars.text = TP.outStars;
   this.bgName.text = TP.bgName;
   this.bgAuto.checked = TP.bgSource != "preview";
   this.bgFromPreview.checked = TP.bgSource == "preview";
   this.gxCorrection.currentItem = ( TP.gxCorrection == "Division" ) ? 1 : 0;
   var mi = this.bnModeIds.indexOf( TP.bnMode );
   if ( mi < 0 )
   {
      mi = 0;
      TP.bnMode = "TargetBackground";
   }
   this.bnMode.currentItem = mi;
   var si = this.spccIconIds.indexOf( TP.spccIcon );
   if ( si < 0 )
   {
      si = 0;
      TP.spccIcon = "";
   }
   this.spccIconCombo.currentItem = si;
   var combos = [ [ this.spccFilterR, "spccFilterR" ], [ this.spccFilterG, "spccFilterG" ],
                  [ this.spccFilterB, "spccFilterB" ], [ this.spccQE, "spccQE" ] ];
   for ( var c = 0; c < combos.length; ++c )
   {
      var idx = combos[c][0].names.indexOf( TP[combos[c][1]] );
      if ( idx < 0 )
      {
         idx = 0;
         TP[combos[c][1]] = "";
      }
      combos[c][0].currentItem = idx;
   }
   this.nxtIterations.value = Math.round( TP.nxtIterations );
   this.refresh();
}

// Enable and show the controls according to the settings.
refresh()
{
   var n = this.numerics;
   var adv = TP.advanced;

   this.bgGroup.enabled = TP.bgEnabled;
   this.bgPreviewList.enabled = TP.bgSource == "preview";

   this.gxGroup.visible = adv;
   this.bgAdvGroup.visible = adv;
   this.solveGroup.visible = adv;
   this.spccGroup.visible = adv;
   this.bxtGroup.visible = adv;
   this.sxtGroup.visible = adv;
   this.nxtGroup.visible = adv;
   this.stfGroup.visible = adv;

   this.gxGroup.enabled = TP.gxEnabled;
   this.bgAdvGroup.enabled = TP.bgEnabled;
   n.bgSize.enabled = TP.bgSource != "preview";
   n.bgMargin.enabled = TP.bgSource != "preview";
   n.bgWeight.enabled = TP.bgSource != "preview";
   n.bnSigmas.enabled = TP.bnAutoHigh;
   n.bnHigh.enabled = !TP.bnAutoHigh;
   this.checks.bnAutoTarget.enabled = TP.bnMode == "TargetBackground";
   n.bnTarget.enabled = TP.bnMode == "TargetBackground" && !TP.bnAutoTarget;
   this.solveGroup.enabled = TP.solveEnabled;
   this.spccGroup.enabled = TP.spccEnabled;
   this.checks.spccUseROI.enabled = TP.spccNeutralize && TP.bgEnabled;
   this.bxtGroup.enabled = TP.bxtEnabled;
   this.sxtGroup.enabled = TP.sxtEnabled;
   this.nxtGroup.enabled = TP.nxtEnabled;
   this.stfGroup.enabled = TP.autoSTF;

   // BlurXTerminator: Automatic PSF disables PSF Diameter.
   n.bxtPSFDiameter.enabled = !TP.bxtAutoPSF;

   // NoiseXTerminator: show only the settings used by the selected separation mode.
   var cs = TP.nxtColorSep, fs = TP.nxtFreqSep;
   n.nxtDenoise.visible            = !cs && !fs;
   n.nxtDenoiseIntensity.visible   =  cs && !fs;
   n.nxtDenoiseColor.visible       =  cs && !fs;
   n.nxtDenoiseHF.visible          = !cs &&  fs;
   n.nxtDenoiseLF.visible          = !cs &&  fs;
   n.nxtDenoiseIntensityHF.visible =  cs &&  fs;
   n.nxtDenoiseIntensityLF.visible =  cs &&  fs;
   n.nxtDenoiseColorHF.visible     =  cs &&  fs;
   n.nxtDenoiseColorLF.visible     =  cs &&  fs;
   n.nxtFrequencyScale.visible     =  fs;

   this.layoutScroll();
   this.adjustToContents();
}
};

// ============================================================================
// Entry point
// ============================================================================

function main()
{
   LANG = detectLanguage();
   resetTP( false );
   if ( Parameters.isGlobalTarget || Parameters.isViewTarget )
      loadParameters();
   else
      loadSettings();

   for ( ;; )
   {
      var dialog = new BBDialog;
      dialog.execute();
      if ( dialog.relaunch )
         continue;
      if ( dialog.runRequested )
         try
         {
            runPipeline( TP );
         }
         catch ( e )
         {
            console.criticalln( SCRIPT_TITLE + " : " + bbErrText( e ) );
            console.flush();
         }
      break;
   }
}

main();
