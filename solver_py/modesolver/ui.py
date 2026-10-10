"""Bridge between the browser worker and the solver.

`solve_request` takes the request as a JSON string and returns plain Python containers plus
float32/float64 numpy arrays, which Pyodide hands to JavaScript as typed arrays without a
JS-side conversion step. The shape matches SolveResult in src/solver/types.ts.
"""

import json
import time

import numpy as np

from .api import solve_project

#: Mesh quality presets: multiplier on all target cell sizes (mesh.py constants = scale 1).
#: Chosen from benchmarks/sweep.py (docs/benchmarks-m2.md): worst n_eff error over the five
#: reference cases is ~2.6e-3 (fast), ~7e-4 (standard) and ~6e-4 (fine).
MESH_SCALE = {"fast": 2.0, "standard": 1.3, "fine": 0.8}

#: The most recent solve (native-mesh fields included), kept for coupling calculations (M3).
last_result = None


def _f32(a):
    return np.ascontiguousarray(a, dtype=np.float32).ravel()


def solve_request(request_json):
    global last_result
    t0 = time.perf_counter()
    req = json.loads(request_json)
    project = req["project"]
    settings = project.get("settings", {})
    kind = settings.get("solverKind", "auto")
    n_guess = req.get("nGuess")
    scale = MESH_SCALE.get(req.get("meshQuality") or "standard", 1.0)
    res = solve_project(project, req["window"], {"scale": scale}, num_modes=int(req["numModes"]), kind=kind, n_guess=n_guess)
    last_result = res
    disp, grid = res["display"], res["grid"]
    modes = []
    for m in res["modes"]:
        fields = {name: {"re": _f32(a.real), "im": _f32(a.imag)} for name, a in m["fields"].items()}
        modes.append({
            "neff": {"re": float(m["neff"].real), "im": float(m["neff"].imag)},
            "mfd": {"x": float(m["mfd"]["x"]), "y": float(m["mfd"]["y"])},
            "mfdD4s": {"x": float(m["mfdD4s"]["x"]), "y": float(m["mfdD4s"]["y"])},
            "aEff": float(m["aEff"]),
            "teFraction": float(m["teFraction"]),
            "boundaryAmplitude": float(m["boundaryAmplitude"]),
            "guided": bool(m["guided"]),
            "fields": fields,
        })
    notes = []
    if any(abs(m["neff"]["im"]) > 1e-9 for m in modes):
        notes.append("Lossy materials: results are approximate (no absorbing boundaries yet).")
    timings = {k: float(v) for k, v in res["timings_ms"].items()}
    timings["total"] = (time.perf_counter() - t0) * 1e3
    return {
        "requestId": req["id"],
        "grid": {
            "x": np.ascontiguousarray(disp["x"], dtype=np.float64),
            "y": np.ascontiguousarray(disp["y"], dtype=np.float64),
            "nx": int(len(disp["x"])),
            "ny": int(len(disp["y"])),
        },
        "modes": modes,
        "indexMap": _f32(disp["n"]),
        "diagnostics": {
            "solverKind": res["kind"],
            "timingsMs": timings,
            "notes": notes,
            "mesh": {"nx": int(len(grid["dx"])), "ny": int(len(grid["dy"])), "minCell": float(min(grid["dx"].min(), grid["dy"].min()))},
        },
        "isMock": False,
    }
