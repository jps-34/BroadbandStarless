#!/usr/bin/env python3
"""
Build the PixInsight update repository served from docs/ (GitHub Pages).

  python3 tools/build_repo.py --user <github_user>

Creates, for the current script version:
  docs/BroadbandStarless-<version>-PI195.zip   V8 script, PixInsight 1.9.5 and later
  docs/updates.xri                              repository index (unsigned)

The archive follows the layout required by PixInsight:
  src/scripts/BroadbandStarless/BroadbandStarless.js  (+ .xsgn if present next to the .js)
  src/scripts/BroadbandStarless/LICENSE

Order for a signed release:
  1. sign scripts/BroadbandStarless.js with CodeSign (creates the .xsgn next to it);
  2. run this script (the .xsgn file is packed, SHA-1 digest computed);
  3. sign docs/updates.xri with CodeSign (last step: any later change to the
     archive or to updates.xri invalidates the signature);
  4. commit and push.
"""
import argparse, datetime, hashlib, os, re, sys, zipfile
from xml.sax.saxutils import escape

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
NAME = "BroadbandStarless"

PACKAGES = [
    {
        "script": "scripts/BroadbandStarless.js",
        "suffix": "PI195",
        "version": "1.9.5:1.9.99",
        "title": "BroadbandStarless {v} (PixInsight 1.9.5 and later)",
        "desc": "Builds a linear starless RGB image and a linear star image from three R, G and B masters: "
                "ChannelCombination, GraXpert AI background extraction, automatic sky background preview, "
                "BackgroundNeutralization, BlurXTerminator (correct only), ImageSolver, "
                "SpectrophotometricColorCalibration, BlurXTerminator, StarXTerminator and optional "
                "NoiseXTerminator, then an optional auto STF. Main settings of each tool in advanced mode, "
                "source images left untouched. English or French interface. Requires the GraXpert process "
                "and the RC Astro tools. Installs under Script > Utilities > BroadbandStarless.",
    },
]
NOTICE = "Copyright (c) 2026 Jacques Pouyaud. GNU GPL v3 or later. Source: https://github.com/{user}/" + NAME


def script_version(path):
    m = re.search(r'var SCRIPT_VERSION\s*=\s*"([^"]+)"', open(path, encoding="utf-8").read())
    if not m:
        sys.exit("SCRIPT_VERSION not found in " + path)
    return m.group(1)


def build_zip(pkg, version, outdir):
    src = os.path.join(ROOT, pkg["script"])
    base = os.path.splitext(os.path.basename(src))[0]
    zname = "%s-%s-%s.zip" % (NAME, version, pkg["suffix"])
    zpath = os.path.join(outdir, zname)
    entries = [(src, "src/scripts/%s/%s.js" % (NAME, base)),
               (os.path.join(ROOT, "LICENSE"), "src/scripts/%s/LICENSE" % NAME)]
    sig = os.path.splitext(src)[0] + ".xsgn"
    if os.path.exists(sig):
        entries.append((sig, "src/scripts/%s/%s.xsgn" % (NAME, base)))
    # fixed timestamps: the same sources always give the same archive (and SHA-1)
    with zipfile.ZipFile(zpath, "w", zipfile.ZIP_DEFLATED) as z:
        for f, arc in entries:
            info = zipfile.ZipInfo(arc, date_time=(2026, 1, 1, 0, 0, 0))
            info.external_attr = 0o644 << 16
            info.compress_type = zipfile.ZIP_DEFLATED
            z.writestr(info, open(f, "rb").read())
    sha1 = hashlib.sha1(open(zpath, "rb").read()).hexdigest()
    return zname, sha1, os.path.exists(sig)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--user", required=True, help="GitHub user name (GitHub Pages host)")
    ap.add_argument("--date", default=datetime.date.today().strftime("%Y%m%d"), help="release date YYYYMMDD")
    a = ap.parse_args()
    server = "https://%s.github.io/%s/" % (a.user, NAME)
    outdir = os.path.join(ROOT, "docs")
    os.makedirs(outdir, exist_ok=True)
    for f in os.listdir(outdir):                      # drop archives from older releases
        if f.startswith(NAME + "-") and f.endswith(".zip"):
            os.remove(os.path.join(outdir, f))
    lines = ['<?xml version="1.0" encoding="UTF-8"?>', '<xri version="1.0">', '   <description>',
             '      <p>BroadbandStarless: linear RGB pipeline (ChannelCombination, GraXpert, background preview, '
             'BackgroundNeutralization, BlurXTerminator, ImageSolver, SPCC, StarXTerminator) from R, G and B masters.</p>',
             '      <p>Add %s under Resources &gt; Updates &gt; Manage Repositories.</p>' % escape(server),
             '   </description>']
    for pkg in PACKAGES:
        v = script_version(os.path.join(ROOT, pkg["script"]))
        zname, sha1, signed = build_zip(pkg, v, outdir)
        print("%-40s sha1 %s  %s" % (zname, sha1, "signed" if signed else "UNSIGNED"))
        lines += ['   <platform os="all" arch="noarch" version="%s">' % pkg["version"],
                  '      <package fileName="%s" sha1="%s" type="script" releaseDate="%s" serverURL="%s">'
                  % (zname, sha1, a.date, escape(server)),
                  '         <title>%s</title>' % escape(pkg["title"].format(v=v)),
                  '         <description>',
                  '            <p>%s</p>' % escape(pkg["desc"]),
                  '            <p>%s</p>' % escape(NOTICE.format(user=a.user)),
                  '         </description>',
                  '      </package>',
                  '   </platform>']
    lines.append('</xri>')
    open(os.path.join(outdir, "updates.xri"), "w", encoding="utf-8").write("\n".join(lines) + "\n")
    print("docs/updates.xri written (unsigned): sign it with CodeSign as the very last step.")


if __name__ == "__main__":
    main()
