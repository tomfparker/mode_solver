from modesolver.spike import TOY_N_CLAD, TOY_N_CORE, time_case


def test_scalar_spike_finds_guided_modes():
    res = time_case("scalar", 40)
    assert res["paths_agree"]
    assert all(TOY_N_CLAD < n < TOY_N_CORE for n in res["neff"][:1])


def test_vector_sized_spike_runs():
    res = time_case("vector", 30)
    assert res["unknowns"] == 2 * 30 * 30
    assert res["paths_agree"]
