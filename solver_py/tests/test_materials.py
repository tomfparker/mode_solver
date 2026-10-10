import math

import pytest

from modesolver.materials import evaluate, index_tensor, load_library

SRC = {"citation": "t"}


def test_formula1_equals_formula2_with_squared_poles():
    f1 = {"model": "sellmeier1", "coefficients": [0.1, 0.7, 0.07, 0.4, 0.12], "range": [0.2, 5]}
    f2 = {"model": "sellmeier2", "coefficients": [0.1, 0.7, 0.07**2, 0.4, 0.12**2], "range": [0.2, 5]}
    for lam in (0.5, 1.0, 1.55, 3):
        assert evaluate(f1, lam)[0] == pytest.approx(evaluate(f2, lam)[0], abs=1e-12)


def test_single_term_sellmeier_closed_form():
    d = {"model": "sellmeier1", "coefficients": [0, 1.0, 0.1], "range": [0.2, 5]}
    assert evaluate(d, 1.2)[0] == pytest.approx(math.sqrt(1 + 1.44 / (1.44 - 0.01)), abs=1e-12)


def test_gas_formula():
    d = {"model": "gases", "coefficients": [0, 0.05, 200], "range": [0.2, 2]}
    assert evaluate(d, 1)[0] == pytest.approx(1 + 0.05 / 199, abs=1e-12)


def test_tabulated_interpolates_clamps_and_flags_range():
    d = {"model": "tabulated", "table": [[1, 3], [2, 2]], "range": [1, 2]}
    assert evaluate(d, 1.25) == (2.75, True)
    assert evaluate(d, 0.5) == (3, False)
    assert evaluate(d, 3) == (2, False)


def test_library_loads_with_sources():
    lib = load_library()
    assert {"SiO2", "Si", "Si3N4", "LiNbO3", "Air"} <= set(lib)
    assert "check_values" not in lib  # helper files are not materials


def test_si_table_point_is_exact():
    # Li 293 K file: 1.55 µm → 3.4757
    assert index_tensor("Si", 1.55)[0].real == pytest.approx(3.4757, abs=1e-10)


def test_uniaxial_uses_ne_along_the_optic_axis():
    nx, ny, nz = index_tensor("LiNbO3", 1.55, optic_axis="x")
    assert ny == nz and nx != ny
    assert index_tensor("LiNbO3", 1.55, optic_axis="y")[1] == nx


def test_custom_and_unknown_materials():
    custom = [{"id": "custom:a", "name": "A", "n": 1.7, "k": 0.01}]
    assert index_tensor("custom:a", 1.0, custom) == (1.7 + 0.01j,) * 3
    assert index_tensor("nope", 1.0) == (1 + 0j,) * 3
