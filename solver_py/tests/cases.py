"""Benchmark structures shared by the reference runner (benchmarks/run_reference.py, which
runs Tidy3D and femwell) and by test_reference.py (which runs our solver on the same input).

Each case is a version-2 Project dict using library materials, plus an explicit window. The
windows deliberately stop inside the oxide (no silicon substrate), so every solver sees the
same closed problem. Geometries are the app's template dimensions.
"""

import math

LAM = 1.55


def _project(name, background, features, wavelength=LAM):
    return {"version": 2, "name": name, "wavelength": wavelength, "background": background,
            "features": features, "customMaterials": [], "settings": {}}


def _rect(name, material, x, y, w, h, full_width=False, optic_axis=None):
    f = {"kind": "rect", "id": name, "name": name, "material": material, "x": x, "y": y, "width": w, "height": h}
    if full_width:
        f["fullWidth"] = True
    if optic_axis:
        f["opticAxis"] = optic_axis
    return f


_h, _top = 0.3, 1.2
_bottom = round(_top + 2 * _h / math.tan(math.radians(60)), 3)

CASES = {
    "soi_strip": {
        "project": _project("SOI strip 500x220", {"material": "SiO2"}, [_rect("Core", "Si", 0, 0, 0.5, 0.22)]),
        "window": {"x0": -1.5, "x1": 1.5, "y0": -1.5, "y1": 1.72},
    },
    "sin_strip": {
        "project": _project("SiN strip 1200x800", {"material": "SiO2"}, [_rect("Core", "Si3N4", 0, 0, 1.2, 0.8)]),
        "window": {"x0": -2.5, "x1": 2.5, "y0": -2.0, "y1": 2.8},
    },
    "soi_rib": {
        "project": _project("SOI rib", {"material": "SiO2"}, [
            _rect("Slab", "Si", 0, 0, 10, 0.09, full_width=True),
            _rect("Rib", "Si", 0, 0.09, 0.5, 0.13),
        ]),
        "window": {"x0": -2.5, "x1": 2.5, "y0": -1.5, "y1": 1.72},
    },
    # Same slanted-sidewall geometry as the LN ridge, but isotropic, so femwell can check it.
    "ridge_iso": {
        "project": _project("Isotropic ridge (SiN on oxide, air-clad)", {"material": "Air"}, [
            _rect("BOX", "SiO2", 0, -2.3, 10, 2.0, full_width=True),
            _rect("Slab", "Si3N4", 0, -0.3, 10, 0.3, full_width=True),
            {"kind": "trapezoid", "id": "Ridge", "name": "Ridge", "material": "Si3N4",
             "x": 0, "y": 0, "widthBottom": _bottom, "widthTop": _top, "height": _h},
        ]),
        "window": {"x0": -2.5, "x1": 2.5, "y0": -1.8, "y1": 1.8},
    },
    "ln_ridge": {
        "project": _project("LNOI ridge (X-cut)", {"material": "Air"}, [
            _rect("BOX", "SiO2", 0, -2.3, 10, 2.0, full_width=True),
            _rect("LN slab", "LiNbO3", 0, -0.3, 10, 0.3, full_width=True, optic_axis="x"),
            {"kind": "trapezoid", "id": "Ridge", "name": "Ridge", "material": "LiNbO3", "opticAxis": "x",
             "x": 0, "y": 0, "widthBottom": _bottom, "widthTop": _top, "height": _h},
        ]),
        "window": {"x0": -2.5, "x1": 2.5, "y0": -1.8, "y1": 1.8},
    },
}
