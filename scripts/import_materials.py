"""Convert refractiveindex.info YAML files into data/materials/*.json.

Every coefficient comes from the YAML files in data/materials/refractiveindex/ (copied
verbatim from the CC0 refractiveindex.info database). Nothing here is typed in by hand
except names, ids and URLs. Run: .venv/bin/python scripts/import_materials.py
"""

import json
import re
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "data/materials/refractiveindex"
OUT = ROOT / "data/materials"
RETRIEVED = "2026-10-05"

FORMULA = {"formula 1": "sellmeier1", "formula 2": "sellmeier2", "formula 6": "gases"}


def strip_html(s):
    s = re.sub(r"<sub>(.*?)</sub>", r"\1", s)
    s = re.sub(r"<[^>]+>", "", s)
    s = re.sub(r"\[[^\]]*\]", "", s)  # bracketed side notes (e.g. links to calculation scripts)
    return " ".join(s.split())


def dispersion(yml_name, shelf, book, page):
    d = yaml.safe_load((SRC / yml_name).read_text())
    refs = d["REFERENCES"]
    dois = re.findall(r'href="https://doi.org/([^"]+)"', refs)
    entry = d["DATA"][0]
    t = entry["type"]
    out = {}
    if t in FORMULA:
        out["model"] = FORMULA[t]
        out["coefficients"] = [float(c) for c in str(entry["coefficients"]).split()]
        lo, hi = (float(v) for v in str(entry["wavelength_range"]).split())
    elif t == "tabulated n":
        rows = [[float(v) for v in line.split()] for line in entry["data"].strip().splitlines()]
        out["model"] = "tabulated"
        out["table"] = rows
        lo, hi = rows[0][0], rows[-1][0]
    else:
        raise ValueError(f"unsupported type {t} in {yml_name}")
    out["range"] = [lo, hi]
    parts = [strip_html(r) for r in refs.split("<br>")]
    cites = [re.sub(r"^\d+\)\s*", "", p) for p in parts if p and not p.startswith("*")]
    notes = [p.lstrip("* ") for p in parts if p.startswith("*")]
    out["source"] = {
        "citation": "; ".join(cites),
        "doi": dois[0] if dois else None,
        "otherDois": dois[1:],
        "notes": " ".join(notes) or None,
        "url": f"https://refractiveindex.info/?shelf={shelf}&book={book}&page={page}",
        "file": f"data/materials/refractiveindex/{yml_name}",
        "conditions": strip_html(d.get("COMMENTS", "")),
        "retrieved": RETRIEVED,
    }
    return out


MATERIALS = [
    {"id": "SiO2", "name": "SiO₂ (fused silica)", "kind": "isotropic",
     "n": ("SiO2_nk_Malitson.yml", "main", "SiO2", "Malitson")},
    {"id": "Si", "name": "Si", "kind": "isotropic",
     "n": ("Si_nk_Li-293K.yml", "main", "Si", "Li-293K")},
    {"id": "Si3N4", "name": "Si₃N₄", "kind": "isotropic",
     "n": ("Si3N4_nk_Luke.yml", "main", "Si3N4", "Luke")},
    {"id": "LiNbO3", "name": "LiNbO₃ (congruent)", "kind": "uniaxial",
     "o": ("LiNbO3_nk_Zelmon-o.yml", "main", "LiNbO3", "Zelmon-o"),
     "e": ("LiNbO3_nk_Zelmon-e.yml", "main", "LiNbO3", "Zelmon-e")},
    {"id": "Air", "name": "Air", "kind": "isotropic",
     "n": ("air_nk_Ciddor.yml", "other", "air", "Ciddor")},
]


def main():
    for m in MATERIALS:
        rec = {"id": m["id"], "name": m["name"], "kind": m["kind"]}
        if m["kind"] == "isotropic":
            rec["n"] = dispersion(*m["n"])
        else:
            rec["ordinary"] = dispersion(*m["o"])
            rec["extraordinary"] = dispersion(*m["e"])
        path = OUT / f"{m['id']}.json"
        path.write_text(json.dumps(rec, indent=2, ensure_ascii=False) + "\n")
        print("wrote", path.relative_to(ROOT))


if __name__ == "__main__":
    main()
