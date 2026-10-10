"""Material library: evaluate refractive indices from data/materials/*.json.

Mirrors src/materials/dispersion.ts and library.ts. Both read the same JSON files, and
tests/test_materials.py plus data/materials/check_values.json keep the two in agreement.
Formula definitions: refractiveindex.info "Dispersion formulas" (see
data/materials/refractiveindex/README.md). Wavelengths in µm.
"""

import json
import math
from pathlib import Path

# solver_py/modesolver/materials.py → repo root / data / materials. The Pyodide worker
# writes the same relative layout into its virtual filesystem.
DEFAULT_DIR = Path(__file__).resolve().parent.parent.parent / "data" / "materials"

_library = None


def load_library(directory=None):
    """Load every material JSON in `directory` (cached for the default directory)."""
    global _library
    if directory is None and _library is not None:
        return _library
    d = Path(directory) if directory else DEFAULT_DIR
    lib = {}
    for f in sorted(d.glob("*.json")):
        rec = json.loads(f.read_text(encoding="utf-8"))
        if isinstance(rec, dict) and "id" in rec and "kind" in rec:
            lib[rec["id"]] = rec
    if directory is None:
        _library = lib
    return lib


def evaluate(disp, lam):
    """Refractive index n(λ) for one dispersion record. Returns (n, in_range)."""
    lo, hi = disp["range"]
    in_range = lo <= lam <= hi
    model = disp["model"]
    if model in ("sellmeier1", "sellmeier2"):
        # n² − 1 = C1 + Σ C_{2i} λ² / (λ² − P_i), P_i = C_{2i+1}² (formula 1) or C_{2i+1} (formula 2)
        c = disp["coefficients"]
        l2 = lam * lam
        n2m1 = c[0]
        for i in range(1, len(c) - 1, 2):
            pole = c[i + 1] ** 2 if model == "sellmeier1" else c[i + 1]
            n2m1 += c[i] * l2 / (l2 - pole)
        return math.sqrt(1 + n2m1), in_range
    if model == "gases":
        # n − 1 = C1 + Σ C_{2i} / (C_{2i+1} − λ⁻²)
        c = disp["coefficients"]
        il2 = 1 / (lam * lam)
        nm1 = c[0]
        for i in range(1, len(c) - 1, 2):
            nm1 += c[i] / (c[i + 1] - il2)
        return 1 + nm1, in_range
    if model == "tabulated":
        # Linear interpolation; clamped to the end values outside the table.
        t = disp["table"]
        if lam <= t[0][0]:
            return t[0][1], in_range
        if lam >= t[-1][0]:
            return t[-1][1], in_range
        lo_i, hi_i = 0, len(t) - 1
        while hi_i - lo_i > 1:
            mid = (lo_i + hi_i) // 2
            if t[mid][0] <= lam:
                lo_i = mid
            else:
                hi_i = mid
        f = (lam - t[lo_i][0]) / (t[hi_i][0] - t[lo_i][0])
        return t[lo_i][1] + f * (t[hi_i][1] - t[lo_i][1]), in_range
    raise ValueError(f"unknown dispersion model {model!r}")


def index_tensor(material, lam, custom=(), optic_axis="z", library=None):
    """Principal indices (n_x, n_y, n_z) in the lab frame, as complex numbers.

    Uniaxial materials use n_e along `optic_axis` and n_o along the other two axes.
    Custom materials are constant n + ik. Unknown ids are treated as n = 1 (the UI warns).
    """
    for c in custom:
        if c["id"] == material:
            n = complex(c["n"], c.get("k", 0.0))
            return n, n, n
    lib = library if library is not None else load_library()
    m = lib.get(material)
    if m is None:
        return 1 + 0j, 1 + 0j, 1 + 0j
    if m["kind"] == "isotropic":
        n = complex(evaluate(m["n"], lam)[0])
        return n, n, n
    no = complex(evaluate(m["ordinary"], lam)[0])
    ne = complex(evaluate(m["extraordinary"], lam)[0])
    return tuple(ne if a == (optic_axis or "z") else no for a in "xyz")
