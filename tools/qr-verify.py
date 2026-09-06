"""Verify qr.js against a reference encoder, module by module.

NOT part of the app or its build. Requires a local venv:

    python -m venv .qrvenv
    .qrvenv/Scripts/python -m pip install qrcode
    .qrvenv/Scripts/python tools/qr-verify.py

Two checks, for a spread of payload sizes and every one of the eight masks:

  1. Every module of our matrix matches python-qrcode's.
  2. Our masking penalty equals python-qrcode's lost_point for that matrix.

A single differing module or score fails the run — a far stronger check than
"it scanned on my phone once".

Automatic mask selection is deliberately not compared. We score the finished
symbol including format information, as Nayuki's reference implementation does;
python-qrcode scores candidates with placeholder format bits, so the two
sometimes settle on different masks. Check 2 above pins down the scoring itself,
and every mask is valid regardless — the choice is recorded in the format
information, so all eight decode.

A note on references: segno was tried first and disagreed on every payload that
needs padding. The cause is in segno, not here — its write_padding_bits does
`[0] * (8 - (length % 8))`, which appends a whole spurious zero byte when the
stream already ends on a codeword boundary, as a byte-mode stream always does.
ISO/IEC 18004 section 7.4.10 only calls for padding when the stream does *not*
end on a boundary. Both encodings scan, since the extra byte lands in padding
that a decoder discards after the terminator, but only one is canonical.
"""

import json
import subprocess
import sys
import tempfile
from pathlib import Path

import qrcode
from qrcode.constants import ERROR_CORRECT_L
from qrcode.util import MODE_8BIT_BYTE, QRData, lost_point


def reference(text, mask=None):
    """python-qrcode's matrix: byte mode, level L, no quiet zone."""
    qr = qrcode.QRCode(
        version=None,
        error_correction=ERROR_CORRECT_L,
        box_size=1,
        border=0,
        mask_pattern=mask,
    )
    qr.add_data(QRData(text.encode("utf-8"), mode=MODE_8BIT_BYTE, check_data=False))
    qr.make(fit=True)
    matrix = [[1 if v else 0 for v in row] for row in qr.get_matrix()]
    return qr.version, matrix, lost_point(qr.modules)


def ours(cases):
    """Run our encoder. Payloads go via files — argv is far too small."""
    with tempfile.TemporaryDirectory() as tmp:
        src = Path(tmp) / "cases.json"
        dst = Path(tmp) / "out.json"
        src.write_text(json.dumps(cases), encoding="utf-8")
        subprocess.run(
            ["node", "tools/qr-dump.js", str(src), str(dst)],
            capture_output=True, text=True, check=True,
        )
        return json.loads(dst.read_text(encoding="utf-8"))


def compare(label, mine, expected_version, expected_matrix, expected_penalty):
    if not mine["ok"]:
        return f"{label}: our encoder failed - {mine['error']}"
    if mine["version"] != expected_version:
        return f"{label}: version {mine['version']}, reference says {expected_version}"
    if mine["size"] != len(expected_matrix):
        return f"{label}: size {mine['size']}, reference says {len(expected_matrix)}"
    for r, (row_mine, row_ref) in enumerate(zip(mine["modules"], expected_matrix)):
        for c, (a, b) in enumerate(zip(row_mine, row_ref)):
            if a != b:
                return f"{label}: first difference at row {r}, col {c} (ours {a}, reference {b})"
    if mine["penalty"] != expected_penalty:
        return f"{label}: penalty {mine['penalty']}, reference says {expected_penalty}"
    return None


BASE = "https://nanivijay.github.io/cricket-scorer/#m="

PAYLOADS = [
    ("tiny", "hi"),
    ("bare url", "https://nanivijay.github.io/cricket-scorer/"),
    ("v1 exact fit", "A" * 17),
    ("v1 needs padding", "A" * 10),
    ("v1/v2 boundary", "A" * 18),
    ("v2", "A" * 20),
    ("v9/v10 boundary", "x" * 230),
    ("v9/v10 boundary +1", "x" * 231),
    ("fresh match link", BASE + "Ab9-_" * 9),
    ("5-over link", BASE + "Ab9-_" * 23),
    ("12-over link", BASE + "Ab9-_" * 55),
    ("20-over link", BASE + "Ab9-_" * 86),
    ("20-over, both innings", BASE + "Ab9-_" * 153),
    ("50-over, both innings", BASE + "Ab9-_" * 366),
    ("unicode team names", "Cafe XI v Mumbai India"),
    ("every ASCII byte", "".join(chr(i) for i in range(1, 128))),
]


def main():
    cases, meta = [], []
    for label, text in PAYLOADS:
        for mask in range(8):
            cases.append({"text": text, "mask": mask})
            meta.append((f"{label} / mask {mask}", text, mask))

    results = ours(cases)

    failures = []
    versions = set()
    for (label, text, mask), mine in zip(meta, results):
        try:
            version, matrix, score = reference(text, mask)
        except Exception as exc:                      # noqa: BLE001
            failures.append(f"{label}: reference encoder refused - {exc}")
            continue
        versions.add(version)
        problem = compare(label, mine, version, matrix, score)
        if problem:
            failures.append(problem)

    for problem in failures:
        print("FAIL ", problem)
    if failures:
        print()
    print(f"{len(meta) - len(failures)}/{len(meta)} matrices and penalty scores "
          f"identical to the reference encoder")
    print(f"versions exercised: {', '.join(str(v) for v in sorted(versions))}")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
