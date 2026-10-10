"""Small builders for test projects. Indices are arbitrary test values (custom materials)."""


def custom(mid, n, k=0.0):
    return {"id": f"custom:{mid}", "name": mid, "n": n, "k": k}


def project(wavelength, background, features, customs):
    return {
        "version": 2,
        "name": "test",
        "wavelength": wavelength,
        "background": {"material": background},
        "features": features,
        "customMaterials": customs,
        "settings": {},
    }


def rect(material, x, y, w, h, full_width=False, **extra):
    return {"kind": "rect", "id": f"r{x}{y}{w}{h}", "name": "r", "material": material, "x": x, "y": y,
            "width": w, "height": h, "fullWidth": full_width, **extra}


def circle(material, x, y, r, **extra):
    return {"kind": "circle", "id": "c", "name": "c", "material": material, "x": x, "y": y, "radius": r, **extra}
