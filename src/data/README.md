# Generated data files

Both files in this directory are **generated or transcribed from the Lutaro app
repository**. Do not hand-edit them here; fix the upstream source and re-export.

## `camera-support-catalog.json`

The deterministic site export of the reviewed camera-support catalog
(Lutaro issue #1484). Regenerate with, from a checkout of the app repo:

```sh
Scripts/export-support-catalog.py --out /path/to/Lutaro-Site/src/data/camera-support-catalog.json
```

The exporter reads the single source of truth,
`App/CameraCore/SupportCatalog/camera-support-catalog.json`, canonicalizes it
(sorted keys, ASCII, no timestamp) and drops the per-source provenance detail
strings. Two runs over the same input are byte-identical, so a re-export is a
no-op diff unless the catalog actually changed.

This site holds **no second compatibility list**. `src/lib/camera-catalog.mjs`
validates this artifact at build time and refuses an unknown schema version, an
unknown vocabulary value or a missing required display field; the build fails
rather than serving a guess.

## `sony-ptp3-models.json`

Sony's own published camera list, extracted from `README.pdf` in the Camera
Remote Command 2.02.00 package (its "Protocol Compatibility" table plus the
per-model USB/IP interface table). Regenerate with:

```sh
scripts/extract-sony-models.py --pdf ~/Downloads/CameraRemoteCommand-2.02.00/README.pdf
```

Needs `pdftotext` (poppler). The PDF is Sony's copyright and is deliberately
not vendored; the generated JSON is, so the site builds without it. Marketing
names are DERIVED from the model codes by Sony's naming conventions inside the
script, not hand-typed, so a new body in a future package gets a name for free.

This is a transcription of Sony's document - what Sony published, never what
Lutaro can do. Where a body also appears in the reviewed catalog above, the
catalog wins and the body renders as tested.

## `profile-keys.json`

The `/format/` page's key/enum/range data, transcribed from the app's
`PropertySchema.swift` and `ProfileIO.swift`. See the `_comment` field inside it.
