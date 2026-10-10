"""Accuracy vs speed of our solver on the reference cases, across mesh settings.

Run with the project venv (native Python; the browser is ~1.5× slower, see docs/spike-m0.md):
    .venv/bin/python benchmarks/sweep.py [--md]

For each case with a saved reference it reports, per setting, the n_eff error of the
fundamental TE-like and TM-like modes against the primary reference (femwell where available,
else Tidy3D), the mesh size, and the best-of-3 wall time. `--md` prints a Markdown table.
"""

import json
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path[:0] = [str(ROOT / "solver_py"), str(ROOT / "solver_py" / "tests")]
from cases import CASES  # noqa: E402
from modesolver.api import solve_project  # noqa: E402

REF = ROOT / "solver_py" / "tests" / "reference"

SETTINGS = [
    ("fast", {"scale": 1.4}, True),
    ("standard", {"scale": 1.0}, True),
    ("fine", {"scale": 0.7}, True),
    ("standard, no extrapolation", {"scale": 1.0}, False),
    ("fine, no extrapolation", {"scale": 0.7}, False),
    ("very fine, no extrapolation", {"scale": 0.4}, False),
]


def main():
    md = "--md" in sys.argv
    rows = []
    for name, case in CASES.items():
        f = REF / f"{name}.json"
        if not f.exists():
            continue
        refs = json.loads(f.read_text())["references"]
        src = "femwell" if "femwell" in refs else "tidy3d"
        want = refs[src]["modes"]
        for label, mesh, extrap in SETTINGS:
            best, res = None, None
            for _ in range(3):
                t0 = time.perf_counter()
                res = solve_project(case["project"], case["window"], mesh, num_modes=4, extrapolate=extrap)
                dt = time.perf_counter() - t0
                best = dt if best is None else min(best, dt)
            g = res["grid"]
            errs = [res["modes"][i]["neff"].real - want[i]["neff"] for i in range(2)]
            rows.append((name, src, label, len(g["dx"]), len(g["dy"]), errs[0], errs[1], best * 1e3))
    if md:
        print("| case | reference | setting | mesh | Δn_eff mode 0 | Δn_eff mode 1 | time (ms) |")
        print("|---|---|---|---|---|---|---|")
        for name, src, label, nx, ny, e0, e1, ms in rows:
            print(f"| {name} | {src} | {label} | {nx} × {ny} | {e0:+.1e} | {e1:+.1e} | {ms:.0f} |")
    else:
        for name, src, label, nx, ny, e0, e1, ms in rows:
            print(f"{name:10s} {src:8s} {label:28s} {nx:4d}x{ny:<4d} d0 {e0:+.1e}  d1 {e1:+.1e}  {ms:6.0f} ms")


if __name__ == "__main__":
    main()
