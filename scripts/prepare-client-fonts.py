#!/usr/bin/env python3
"""Prepare local client fonts from offline original font files.

This is a manual conversion tool, not part of client prepare/build or packaging.
Requires fonttools==4.66.1 and brotli==1.2.0 for reproducible WOFF2 output.
MiSans keeps every glyph and its complete variable axis. The OFL fallback keeps
every SourceHan codepoint missing from MiSans, including dynamic chat text.
"""

from __future__ import annotations

import argparse
import hashlib
import io
import json
import platform
from pathlib import Path
import sys
import zipfile


OFL_TEXT = """SIL OPEN FONT LICENSE Version 1.1 - 26 February 2007

PREAMBLE
The goals of the Open Font License (OFL) are to stimulate worldwide
development of collaborative font projects, to support the font
creation efforts of academic and linguistic communities, and to
provide a free and open framework in which fonts may be shared and
improved in partnership with others.

The OFL allows the licensed fonts to be used, studied, modified and
redistributed freely as long as they are not sold by themselves. The
fonts, including any derivative works, can be bundled, embedded,
redistributed and/or sold with any software provided that any reserved
names are not used by derivative works. The fonts and derivatives,
however, cannot be released under any other type of license. The
requirement for fonts to remain under this license does not apply to
any document created using the fonts or their derivatives.

DEFINITIONS
"Font Software" refers to the set of files released by the Copyright
Holder(s) under this license and clearly marked as such. This may
include source files, build scripts and documentation.

"Reserved Font Name" refers to any names specified as such after the
copyright statement(s).

"Original Version" refers to the collection of Font Software
components as distributed by the Copyright Holder(s).

"Modified Version" refers to any derivative made by adding to,
deleting, or substituting -- in part or in whole -- any of the
components of the Original Version, by changing formats or by porting
the Font Software to a new environment.

"Author" refers to any designer, engineer, programmer, technical
writer or other person who contributed to the Font Software.

PERMISSION & CONDITIONS
Permission is hereby granted, free of charge, to any person obtaining
a copy of the Font Software, to use, study, copy, merge, embed,
modify, redistribute, and sell modified and unmodified copies of the
Font Software, subject to the following conditions:

1) Neither the Font Software nor any of its individual components, in
Original or Modified Versions, may be sold by itself.

2) Original or Modified Versions of the Font Software may be bundled,
redistributed and/or sold with any software, provided that each copy
contains the above copyright notice and this license. These can be
included either as stand-alone text files, human-readable headers or
in the appropriate machine-readable metadata fields within text or
binary files as long as those fields can be easily viewed by the user.

3) No Modified Version of the Font Software may use the Reserved Font
Name(s) unless explicit written permission is granted by the
corresponding Copyright Holder. This restriction only applies to the
primary font name as presented to the users.

4) The name(s) of the Copyright Holder(s) or the Author(s) of the Font
Software shall not be used to promote, endorse or advertise any
Modified Version, except to acknowledge the contribution(s) of the
Copyright Holder(s) and the Author(s) or with their explicit written
permission.

5) The Font Software, modified or unmodified, in part or in whole,
must be distributed entirely under this license, and must not be
distributed under any other license. The requirement for fonts to
remain under this license does not apply to any document created using
the Font Software.

TERMINATION
This license becomes null and void if any of the above conditions are
not met.

DISCLAIMER
THE FONT SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,
EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO ANY WARRANTIES OF
MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT
OF COPYRIGHT, PATENT, TRADEMARK, OR OTHER RIGHT. IN NO EVENT SHALL THE
COPYRIGHT HOLDER BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY,
INCLUDING ANY GENERAL, SPECIAL, INDIRECT, INCIDENTAL, OR CONSEQUENTIAL
DAMAGES, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING
FROM, OUT OF THE USE OR INABILITY TO USE THE FONT SOFTWARE OR FROM
OTHER DEALINGS IN THE FONT SOFTWARE.
"""


def digest(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def load_dependencies():
    try:
        import brotli
        import fontTools
        from fontTools import subset
        from fontTools.ttLib import TTFont
    except ImportError as error:
        raise ValueError(
            "Install conversion dependencies: python -m pip install "
            "fonttools==4.66.1 brotli==1.2.0"
        ) from error
    return TTFont, subset, {
        "python": platform.python_version(),
        "fonttools": fontTools.__version__,
        "brotli": brotli.__version__,
    }


def font_metadata(font) -> dict:
    return {
        "family": font["name"].getDebugName(1),
        "subfamily": font["name"].getDebugName(2),
        "version": font["name"].getDebugName(5),
        "copyright": font["name"].getDebugName(0),
        "license": font["name"].getDebugName(13),
        "license_url": font["name"].getDebugName(14),
        "codepoints": len(font.getBestCmap()),
        "glyphs": len(font.getGlyphOrder()),
        "axes": [
            {"tag": axis.axisTag, "min": axis.minValue,
             "default": axis.defaultValue, "max": axis.maxValue}
            for axis in font["fvar"].axes
        ] if "fvar" in font else [],
    }


def save_woff2(font, path: Path) -> dict:
    font.recalcTimestamp = False
    font.flavor = "woff2"
    font.save(path)
    return {"file": path.name, "bytes": path.stat().st_size,
            "sha256": digest(path.read_bytes()), **font_metadata(font)}


def rename_fallback(font, weight: str) -> None:
    family = "LastRO Glyph Fallback"
    ps_name = f"LastROGlyphFallback-{weight}"
    full_name = f"{family} {weight}"
    replacements = {
        1: family, 2: weight, 3: f"{ps_name};subset-v1", 4: full_name,
        6: ps_name, 16: family, 17: weight, 21: family, 22: weight,
        25: "LastROGlyphFallback",
    }
    for record in font["name"].names:
        if record.nameID in replacements:
            record.string = replacements[record.nameID].encode(record.getEncoding())
    cff = font["CFF "].cff
    cff.fontNames = [ps_name]
    cff.topDictIndex[0].FullName = full_name
    cff.topDictIndex[0].FamilyName = family


def prepare(args) -> dict:
    TTFont, subset, versions = load_dependencies()
    with zipfile.ZipFile(args.misans_zip) as archive:
        matches = [entry for entry in archive.infolist()
                   if not entry.is_dir() and not entry.filename.startswith("__MACOSX/")
                   and Path(entry.filename).name.lower() == "misansvf.ttf"]
        if len(matches) != 1:
            raise ValueError("MiSans ZIP must contain exactly one original MiSansVF.ttf")
        entry = matches[0]
        primary_data = archive.read(entry)
    primary = TTFont(io.BytesIO(primary_data), recalcTimestamp=False)
    if "fvar" not in primary or "wght" not in {
        axis.axisTag for axis in primary["fvar"].axes
    }:
        raise ValueError("MiSansVF.ttf must contain its original variable weight axis")
    # Coverage inspection uses a separate instance so the conversion can retain
    # untouched binary tables instead of reserializing the loaded cmap/post data.
    primary_cmap = TTFont(io.BytesIO(primary_data), recalcTimestamp=False).getBestCmap()
    primary_codepoints = set(primary_cmap)
    sources = []
    for weight, path in [("Medium", args.source_han_medium), ("Bold", args.source_han_bold)]:
        data = path.read_bytes()
        font = TTFont(io.BytesIO(data), recalcTimestamp=False)
        license_text = font["name"].getDebugName(13) or ""
        family = (font["name"].getDebugName(1) or "").replace(" ", "").lower()
        expected_weight = 500 if weight == "Medium" else 700
        if ("CFF " not in font or "SIL Open Font License" not in license_text
                or not family.startswith("sourcehansans")
                or font["OS/2"].usWeightClass != expected_weight):
            raise ValueError(f"{weight} input must be an original SourceHan CFF font under OFL")
        metadata = font_metadata(font)
        metadata.update({"file": path.name, "bytes": len(data), "sha256": digest(data)})
        sources.append((weight, font, metadata, set(font.getBestCmap())))

    args.output.mkdir(parents=True, exist_ok=True)
    primary_result = save_woff2(primary, args.output / "MiSans-VF.woff2")
    restored_primary = TTFont(args.output / "MiSans-VF.woff2", recalcTimestamp=False)
    if restored_primary.getBestCmap() != primary_cmap:
        raise ValueError("WOFF2 conversion changed MiSans character coverage")
    files = [primary_result]
    copyrights = []
    for weight, font, original, original_codepoints in sources:
        wanted = original_codepoints - primary_codepoints
        options = subset.Options()
        options.hinting = True
        options.layout_features = ["*"]
        options.name_IDs = ["*"]
        options.name_languages = ["*"]
        options.name_legacy = True
        options.desubroutinize = False
        options.recalc_timestamp = False
        options.notdef_glyph = True
        options.notdef_outline = True
        subsetter = subset.Subsetter(options=options)
        subsetter.populate(unicodes=wanted)
        subsetter.subset(font)
        rename_fallback(font, weight)
        output = args.output / f"LastROGlyphFallback-{weight}.woff2"
        result = save_woff2(font, output)
        restored = TTFont(output, recalcTimestamp=False)
        codepoints = set(restored.getBestCmap())
        if primary_codepoints | codepoints != primary_codepoints | original_codepoints:
            raise ValueError(f"{weight} fallback changed combined character coverage")
        result.update({"source": original, "requested_codepoints": len(wanted),
                       "combined_codepoints": len(primary_codepoints | codepoints)})
        files.append(result)
        if original["copyright"] and original["copyright"] not in copyrights:
            copyrights.append(original["copyright"])
    (args.output / "LastROGlyphFallback-OFL.txt").write_text(
        "\n\n".join(copyrights) + "\n\n" + OFL_TEXT, encoding="utf-8", newline="\n"
    )
    report = {
        "tools": versions,
        "policy": "Full MiSans glyphs/axes; SourceHan set-difference fallback with hints and OFL retained; no network or installer generation.",
        "files": files,
        "total_font_bytes": sum(item["bytes"] for item in files),
    }
    return report


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--misans-zip", type=Path, required=True)
    parser.add_argument("--source-han-medium", type=Path, required=True)
    parser.add_argument("--source-han-bold", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True,
                        help="Directory for the three WOFF2 files and OFL")
    args = parser.parse_args()
    try:
        report = prepare(args)
    except (ValueError, OSError, zipfile.BadZipFile) as error:
        parser.exit(1, f"Font preparation failed: {error}\n")
    print(json.dumps({"output": str(args.output), "total_font_bytes": report["total_font_bytes"],
                      "fonts": [{"file": item["file"], "bytes": item["bytes"]}
                                for item in report["files"]]}, ensure_ascii=True))
    return 0


if __name__ == "__main__":
    sys.exit(main())
