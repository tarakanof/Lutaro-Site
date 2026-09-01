#!/usr/bin/env python3
"""Extract Sony's published camera list into `src/data/sony-ptp3-models.json`.

Source: `README.pdf` from Sony's Camera Remote Command package (2.02.00), which
carries two tables - "Protocol Compatibility" (which bodies speak Camera Control
PTP 3 / PTP 2) and an unnamed per-model interface table (USB / IP). Lutaro
speaks PTP 3, so only PTP 3 bodies are emitted.

This is a TRANSCRIPTION of Sony's document, not a Lutaro compatibility list -
it says what Sony published, never what Lutaro can do. Which of these bodies
Lutaro has actually been run against lives in the reviewed catalog
(`camera-support-catalog.json`), and that always wins where the two overlap.

Regenerate (needs the Sony package and `pdftotext` from poppler):

    scripts/extract-sony-models.py --pdf ~/Downloads/CameraRemoteCommand-2.02.00/README.pdf

The PDF is Sony's copyright and is deliberately NOT vendored here; the emitted
JSON is, so the site builds without it.
"""
import argparse
import json
import pathlib
import re
import subprocess
import sys

PACKAGE = 'CameraRemoteCommand-2.02.00'

# Marketing names are DERIVED from the model code by Sony's own naming
# conventions, not hand-typed per body, so a new body in a future package gets a
# name without anyone editing a table. Bodies whose code IS their retail name
# (ILX, PXW, HXR, BRC) fall through unchanged.
ROMAN = {2: 'II', 3: 'III', 4: 'IV', 5: 'V', 6: 'VI', 7: 'VII'}
EXPLICIT = {
    'MPC-2610': 'BURANO',        # Sony's retail name for this body.
    'ILCE-7RM4A': 'α7R IVA',
    'ILCE-7CR': 'α7CR',
    'ILCE-7C': 'α7C',
    'ILCE-6700': 'α6700',
}


def marketing_name(code: str) -> str:
    if code in EXPLICIT:
        return EXPLICIT[code]
    for prefix, stem in (('ILCE-7RM', 'α7R '), ('ILCE-7SM', 'α7S '),
                         ('ILCE-7CM', 'α7C '), ('ILCE-7M', 'α7 '),
                         ('ILCE-9M', 'α9 '), ('ILCE-1M', 'α1 ')):
        if code.startswith(prefix) and code[len(prefix):].isdigit():
            return stem + ROMAN.get(int(code[len(prefix):]), code[len(prefix):])
    if code == 'ILCE-1':
        return 'α1'
    if code.startswith('ILME-'):
        return code[len('ILME-'):]                      # ILME-FX30 -> FX30
    if code.startswith('DSC-'):
        body = code[len('DSC-'):]                       # DSC-RX100M7 -> RX100 VII
        m = re.match(r'^(.*?)M(\d)$', body)
        return f'{m.group(1)} {ROMAN.get(int(m.group(2)), m.group(2))}' if m else body
    m = re.match(r'^(ZV-.*?)M(\d)$', code)              # ZV-E10M2 -> ZV-E10 II
    if m:
        return f'{m.group(1)} {ROMAN.get(int(m.group(2)), m.group(2))}'
    return code


def centre(line: str, label: str) -> float:
    return line.index(label) + len(label) / 2


def parse(pdf: pathlib.Path) -> list[dict]:
    text = subprocess.run(['pdftotext', '-layout', str(pdf), '-'],
                          capture_output=True, text=True, check=True).stdout
    proto, iface = {}, {}
    mode = cols = None
    for line in (l for l in text.splitlines() if l.strip()):
        if re.match(r'^\s*Model Name\s+Camera Control PTP 3\s+Camera Control PTP 2', line):
            mode = 'proto'
            cols = (centre(line, 'Camera Control PTP 3'), centre(line, 'Camera Control PTP 2'))
            continue
        if re.match(r'^\s*Model Name\s+USB\s+IP\*1', line):
            mode, cols = 'iface', (centre(line, 'USB'), centre(line, 'IP*1'))
            continue
        if line.lstrip().startswith('*'):
            mode = None
            continue
        if mode is None:
            continue
        m = re.match(r'^\s*([A-Z][A-Za-z0-9\-()]+)', line)
        if not m:
            continue
        left = right = False
        for i, ch in enumerate(line):
            if ch != '✓':
                continue
            if abs(i - cols[0]) <= abs(i - cols[1]):
                left = True
            else:
                right = True
        notes = set(re.findall(r'\*(\d)', line))
        target = proto if mode == 'proto' else iface
        target[m.group(1)] = ({'ptp3': left, 'notes': notes} if mode == 'proto'
                              else {'usb': left, 'ip': right})

    if not proto or not iface:
        sys.exit('could not find both tables - is this the right README.pdf?')

    models = []
    for raw, p in sorted(proto.items()):
        if not p['ptp3']:
            continue                                  # PTP 2 only: Lutaro cannot drive it.
        code = raw.replace('(A)', '')
        models.append({
            'bodyCode': code,
            'marketingName': marketing_name(code),
            'aliases': [f'{code}A'] if '(A)' in raw else [],
            'usb': iface[raw]['usb'],
            'ip': iface[raw]['ip'],
            'noLiveView': '1' in p['notes'],
        })
    return models


def main() -> int:
    here = pathlib.Path(__file__).resolve().parent.parent
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument('--pdf', type=pathlib.Path, required=True, help="Sony's README.pdf")
    ap.add_argument('--out', type=pathlib.Path,
                    default=here / 'src/data/sony-ptp3-models.json')
    args = ap.parse_args()

    models = parse(args.pdf)
    artifact = {
        'source': "Sony Camera Control PTP Reference, README.pdf - 'Protocol "
                  "Compatibility' and the per-model USB/IP interface table",
        'package': PACKAGE,
        'ipNote': 'Sony defers which kind of IP connection each body supports to '
                  "that model's own help guide.",
        'models': models,
    }
    args.out.write_text(json.dumps(artifact, indent=2, ensure_ascii=False) + '\n')
    print(f'{len(models)} PTP 3 bodies -> {args.out}')
    return 0


if __name__ == '__main__':
    sys.exit(main())
