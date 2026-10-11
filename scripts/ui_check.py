"""Scripted UI check: drives the app in headless Firefox via Selenium and reports PASS/FAIL.

Stopgap until the Playwright smoke tests (M6): Playwright's browser downloads time out on the
maintainer's network, but the Firefox snap ships geckodriver. Usage:

    npm run build && npx vite preview --port 4173 &
    .venv/bin/pip install selenium   # once
    .venv/bin/python scripts/ui_check.py [http://localhost:4173/]

Screenshots go to $UI_CHECK_SHOTS (default ~/snap/firefox/common/shots; the snap can only
write inside its own directories). Set GECKODRIVER if it isn't /snap/bin/geckodriver.
"""
import json, os, sys, time, tempfile
from selenium import webdriver
from selenium.webdriver.common.by import By
from selenium.webdriver.common.keys import Keys
from selenium.webdriver.common.action_chains import ActionChains
from selenium.webdriver.firefox.service import Service
from selenium.webdriver.support.ui import Select

SHOTS = os.environ.get("UI_CHECK_SHOTS", os.path.expanduser("~/snap/firefox/common/shots"))
os.makedirs(SHOTS, exist_ok=True)
BASE = sys.argv[1] if len(sys.argv) > 1 else "http://localhost:4173/"
# Interaction checks use the mock solver (instant, deterministic); the last section loads the
# real solver end to end.
URL = BASE + "?solver=mock"

opts = webdriver.FirefoxOptions()
opts.add_argument("--headless")
opts.add_argument("--width=1440")
opts.add_argument("--height=900")
prof = tempfile.mkdtemp(dir=os.path.dirname(SHOTS))
opts.add_argument("-profile"); opts.add_argument(prof)
d = webdriver.Firefox(options=opts, service=Service(os.environ.get("GECKODRIVER", "/snap/bin/geckodriver")))
d.set_window_size(1440, 900)
results = []

def ok(name, cond, extra=""):
    results.append((name, bool(cond), extra))
    print(("PASS " if cond else "FAIL ") + name + (f"  [{extra}]" if extra else ""), flush=True)

def shot(name):
    d.save_screenshot(f"{SHOTS}/{name}.png")

def wait(fn, t=5):
    end = time.time() + t
    while time.time() < end:
        try:
            v = fn()
            if v: return v
        except Exception:
            pass
        time.sleep(0.1)
    return None

def errors():
    return d.execute_script("return window.__errs || []")

def neff0():
    return d.execute_script("const td=document.querySelector('table.modes tbody tr td:nth-child(2)'); return td && td.textContent")

def status():
    return d.find_element(By.CSS_SELECTOR, ".results-status").text

def click_solve():
    d.find_element(By.XPATH, "//button[contains(@class,'solve')]").click()

def hash_():
    return d.execute_script("return location.hash")

try:
    d.get(URL)
    d.execute_script("window.__errs=[]; window.addEventListener('error', e=>window.__errs.push(String(e.message))); window.addEventListener('unhandledrejection', e=>window.__errs.push(String(e.reason)));")
    ok("default example solves", wait(lambda: neff0()), neff0())
    ok("URL hash written", wait(lambda: hash_().startswith("#p=")), hash_()[:30])
    ok("mock banner visible", d.find_elements(By.CSS_SELECTOR, ".mock-banner"))

    # Select core from list, edit width numerically
    d.find_element(By.XPATH, "//div[contains(@class,'row')]//span[text()='Core']").click()
    width = wait(lambda: d.find_element(By.CSS_SELECTOR, "input[aria-label='Width']"))
    ok("properties show width field", width, width.get_attribute("value") if width else "")
    n_before = neff0()
    width.send_keys(Keys.CONTROL, "a"); width.send_keys("2 um", Keys.ENTER)
    ok("typed '2 um' → shows 2000 nm", wait(lambda: width.get_attribute("value") == "2000"), width.get_attribute("value"))
    time.sleep(0.4)
    ok("edit does not re-solve; results marked out of date", neff0() == n_before and status() == "Out of date", status())
    click_solve()
    ok("Solve button updates n_eff", wait(lambda: neff0() != n_before, 3), f"{n_before} → {neff0()}")
    ok("status back to up to date", wait(lambda: status() == "Preview (mock)"), status())
    shot("drive-1-width")

    # Arrow keys in field
    width.send_keys(Keys.ARROW_UP); width.send_keys(Keys.ARROW_UP)
    ok("arrow up ×2 → 2002 nm", wait(lambda: width.get_attribute("value") == "2002"), width.get_attribute("value"))
    width.send_keys(Keys.TAB)

    # Undo via keyboard, while focus is in another field
    ActionChains(d).key_down(Keys.CONTROL).send_keys("z").key_up(Keys.CONTROL).perform()
    ok("Ctrl+Z undoes the arrow burst in one step", wait(lambda: width.get_attribute("value") == "2000"), width.get_attribute("value"))
    ActionChains(d).key_down(Keys.CONTROL).send_keys("z").key_up(Keys.CONTROL).perform()
    ok("Ctrl+Z again restores 1200 nm", wait(lambda: d.find_element(By.CSS_SELECTOR, "input[aria-label='Width']").get_attribute("value") == "1200"))

    # Drag right handle on canvas
    handles = d.find_elements(By.CSS_SELECTOR, "circle.handle")
    ok("handles shown for selected rect", len(handles) == 4, str(len(handles)))
    right = [h for h in handles if h.get_attribute("data-id") == "r"][0]
    ActionChains(d).click_and_hold(right).move_by_offset(40, 0).move_by_offset(40, 0).release().perform()
    w = d.find_element(By.CSS_SELECTOR, "input[aria-label='Width']").get_attribute("value")
    ok("dragging the right handle widens the core (numbers update)", wait(lambda: float(d.find_element(By.CSS_SELECTOR, "input[aria-label='Width']").get_attribute("value")) > 1300), w)
    shot("drive-2-drag")
    ActionChains(d).key_down(Keys.CONTROL).send_keys("z").key_up(Keys.CONTROL).perform()
    ok("one Ctrl+Z undoes the whole drag", wait(lambda: d.find_element(By.CSS_SELECTOR, "input[aria-label='Width']").get_attribute("value") == "1200"),
       d.find_element(By.CSS_SELECTOR, "input[aria-label='Width']").get_attribute("value"))

    # Drag the body → x changes
    body = d.find_element(By.CSS_SELECTOR, "path[data-kind='feature']")
    ActionChains(d).click_and_hold(body).move_by_offset(30, 0).move_by_offset(30, 0).release().perform()
    x = d.find_element(By.CSS_SELECTOR, "input[aria-label='x (centre)']").get_attribute("value")
    ok("dragging the body moves x", x not in ("0", ""), x)

    # Pop-up editor: open by clicking a shape on the canvas, close with Escape
    ok("clicking a shape opens its pop-up editor", wait(lambda: d.find_elements(By.CSS_SELECTOR, ".editor-pop [role='dialog']")))
    d.find_element(By.CSS_SELECTOR, ".panel-right").click()
    ActionChains(d).send_keys(Keys.ESCAPE).perform()
    ok("Escape closes the pop-up", wait(lambda: not d.find_elements(By.CSS_SELECTOR, ".editor-pop")))

    # Layer (full-width shape) thickness: drag the BOX's top handle
    d.find_element(By.XPATH, "//div[@role='listitem'][.//span[contains(., 'BOX')]]").click()
    top = wait(lambda: [h for h in d.find_elements(By.CSS_SELECTOR, "circle.handle") if h.get_attribute("data-id") == "t"][0])
    ActionChains(d).click_and_hold(top).move_by_offset(0, 30).move_by_offset(0, 30).release().perform()
    meta = d.find_element(By.XPATH, "//div[@role='listitem'][.//span[contains(., 'BOX')]]/span[contains(@class,'meta')]").text
    ok("dragging the BOX top handle changes its thickness", "4000 nm" not in meta, meta)
    ActionChains(d).key_down(Keys.CONTROL).send_keys("z").key_up(Keys.CONTROL).perform()

    # Structure list order = drawing order
    order = lambda: [e.text.split(" ·")[0].replace("▭", "").strip() for e in d.find_elements(By.CSS_SELECTOR, "div[role='listitem'] .name")]
    ok("list shows Core above BOX above Substrate, Background last", order()[:3] == ["Core", "BOX", "Substrate"] and order()[-1] == "Background", " / ".join(order()))
    d.find_element(By.XPATH, "//div[@role='listitem']//span[text()='Core']").click()
    d.find_element(By.XPATH, "//div[contains(@class,'editor-pop')]//button[contains(., 'Down')]").click()
    ok("↓ Down moves Core below BOX in the list", wait(lambda: order().index("Core") > order().index("BOX")), " / ".join(order()))
    d.find_element(By.XPATH, "//div[contains(@class,'editor-pop')]//button[contains(., 'Up')]").click()
    ok("↑ Up restores it", wait(lambda: order()[0] == "Core"), " / ".join(order()))

    # Wavelength chip 780 → Si out-of-range warning (substrate Si)
    wl = d.find_element(By.ID, "wavelength")
    wl.send_keys(Keys.CONTROL, "a"); wl.send_keys("780", Keys.ENTER)
    ok("typing 780 sets λ", wait(lambda: d.find_element(By.ID, "wavelength").get_attribute("value") == "780"))
    ok("Si range warning at 780 nm", wait(lambda: "outside the published data range for Si" in d.find_element(By.CSS_SELECTOR, ".panel-right").text))
    shot("drive-3-780")

    # Type wavelength in µm
    wl = d.find_element(By.ID, "wavelength")
    wl.send_keys(Keys.CONTROL, "a"); wl.send_keys("1.31 µm", Keys.ENTER)
    ok("typing 1.31 µm → 1310", wait(lambda: wl.get_attribute("value") == "1310"), wl.get_attribute("value"))

    # Unit toggle
    d.find_element(By.XPATH, "//div[@class='seg']/button[text()='µm']").click()
    ok("µm toggle relabels layer list", wait(lambda: "µm" in d.find_element(By.CSS_SELECTOR, ".panel-left").text))
    d.find_element(By.XPATH, "//div[@class='seg']/button[text()='nm']").click()

    # Templates
    for tid, label in [("ln-ridge", "LN ridge"), ("fibre", "Step-index fibre"), ("diffused", "Diffused channel"), ("slot", "Slot"), ("soi-rib", "SOI rib"), ("soi-strip", "SOI strip")]:
        Select(d.find_element(By.CSS_SELECTOR, "select[aria-label='Start from a template']")).select_by_value(tid)
        time.sleep(0.6)
        ok(f"template {tid} loads and solves", wait(lambda: neff0()) and label.split()[0] in d.find_element(By.CSS_SELECTOR, ".project-name").get_attribute("value"), neff0())
        shot(f"drive-t-{tid}")

    # Add shapes of each kind
    for k in ["Rectangle", "Trapezoid", "Circle", "Polygon", "Graded index"]:
        d.find_element(By.XPATH, f"//div[@class='add-menu']/button[contains(., '{k}')]").click()
        time.sleep(0.3)
    ActionChains(d).key_down(Keys.CONTROL).send_keys(Keys.ENTER).key_up(Keys.CONTROL).perform()
    ok("Ctrl+Enter solves after adding 5 shapes", wait(lambda: status() == "Preview (mock)"), status())
    shot("drive-4-shapes")

    # URL round trip: reload current hash in fresh page
    h = hash_()
    time.sleep(0.6); h = hash_()
    d.get("about:blank"); d.get(URL + h)
    rows = lambda: len(d.find_elements(By.CSS_SELECTOR, "div[role='listitem']"))
    ok("reload from URL restores project (template + 5 shapes)", wait(lambda: rows() >= 9), str(rows()))

    # Broken link
    d.get("about:blank"); d.get(URL + "#p=garbage")
    ok("broken link shows notice and default example", wait(lambda: "Couldn" in d.find_element(By.CSS_SELECTOR, ".notice").text))

    # Simulation window: fixed by default (resizing the core leaves it alone), editable in the left panel
    d.get("about:blank"); d.get(URL)
    wait(lambda: neff0())
    ww = lambda: d.find_element(By.CSS_SELECTOR, "input[aria-label='Window width']").get_attribute("value")
    w0 = wait(lambda: ww())
    d.find_element(By.XPATH, "//div[@role='listitem']//span[text()='Core']").click()
    cw = d.find_element(By.CSS_SELECTOR, "input[aria-label='Width']")
    cw.send_keys(Keys.CONTROL, "a"); cw.send_keys("2000", Keys.ENTER)
    time.sleep(0.3)
    ok("resizing the core leaves a fixed window unchanged", ww() == w0, f"{w0} → {ww()}")
    win = d.find_element(By.CSS_SELECTOR, "input[aria-label='Window width']")
    win.send_keys(Keys.CONTROL, "a"); win.send_keys("1500", Keys.ENTER)
    click_solve()
    ok("a too-small window triggers the boundary warning", wait(lambda: "reaches the edge" in d.find_element(By.CSS_SELECTOR, ".panel-right").text))
    shot("drive-5-boundary")
    d.find_element(By.XPATH, "//button[starts-with(., 'Enlarge window')]").click()
    ok("fix button enlarges the window by 50%", wait(lambda: ww() == "2250"), ww())
    d.find_element(By.CSS_SELECTOR, "input[aria-label='Auto-size window to structure']").click()
    ok("auto-size shows padding instead of window size", wait(lambda: d.find_elements(By.CSS_SELECTOR, "input[aria-label='Padding']")) and not d.find_elements(By.CSS_SELECTOR, "input[aria-label='Window width']"))

    # Field component switch
    Select(d.find_element(By.ID, "fieldview")).select_by_value("Ex")
    ok("Ex view shows 'real part'", wait(lambda: "real part" in d.find_element(By.CSS_SELECTOR, ".canvas-tools").text))
    shot("drive-6-ex")
    ok("no JS errors", not errors(), json.dumps(errors())[:300])

    # Profiles option: marginal and peak-cut strips on the canvas
    ok("profiles are on by default, with rulers and MFD marks", wait(lambda: len(d.find_elements(By.CSS_SELECTOR, "g.profiles > path")) == 6)
       and len(d.find_elements(By.CSS_SELECTOR, "g.profiles .ruler-label")) > 6 and len(d.find_elements(By.CSS_SELECTOR, "g.mfd-mark")) == 2)
    marks = d.execute_script("return [...document.querySelectorAll('g.mfd-mark text')].map(t => t.textContent)")
    # The view is Ex at this point, so the marks give that component's 1/e² width (they say "MFD" for |E|²).
    ok("width marks are labelled for the Ex view, in µm", len(marks) == 2 and marks[0].startswith("1/e² width x") and marks[0].endswith("µm"), " / ".join(marks))
    Select(d.find_element(By.ID, "fieldview")).select_by_value("E2")
    marks = d.execute_script("return [...document.querySelectorAll('g.mfd-mark text')].map(t => t.textContent)")
    ok("and as MFD for the |E|² view", len(marks) == 2 and marks[0].startswith("MFD x") and marks[1].startswith("MFD y"), " / ".join(marks))
    ok("1/e² contour is off by default", not d.find_element(By.XPATH, "//label[contains(., 'contour')]/input").is_selected())
    d.find_element(By.XPATH, "//label[contains(., 'Profiles')]/input").click()
    ok("unticking Profiles hides them", wait(lambda: not d.find_elements(By.CSS_SELECTOR, "g.profiles")))
    d.find_element(By.XPATH, "//label[contains(., 'Profiles')]/input").click()

    # About page
    d.find_element(By.XPATH, "//nav[@class='tabs']/button[text()='About']").click()
    about = wait(lambda: d.find_element(By.CSS_SELECTOR, "main.about").text)
    ok("About page shows method, benchmarks and references", about and all(k in about for k in ("How the solver works", "femwell", "Zhu", "Malitson")))
    d.find_element(By.XPATH, "//nav[@class='tabs']/button[text()='Solver']").click()
    ok("back to the solver, results still there", wait(lambda: neff0()))

    # Real solver, end to end: Pyodide loads, the default SiN strip solves, numbers are physical.
    d.get("about:blank"); d.get(BASE)
    d.execute_script("window.__errs=[]; window.addEventListener('error', e=>window.__errs.push(String(e.message))); window.addEventListener('unhandledrejection', e=>window.__errs.push(String(e.reason)));")
    t0 = time.time()
    ok("real solver loads and solves the default example", wait(lambda: status() == "Up to date", 180), f"{time.time() - t0:.0f} s, status {status()!r}")
    ok("no mock banner with the real solver", not d.find_elements(By.CSS_SELECTOR, ".mock-banner"))
    n0 = float(neff0())
    # femwell reference for this structure: TE0 = 1.80277 (solver_py/tests/reference/sin_strip.json)
    ok("TE0 n_eff of the SiN strip matches the reference to 1e-3", abs(n0 - 1.80277) < 1e-3, str(n0))
    info = d.find_element(By.CSS_SELECTOR, ".panel-right").text
    ok("solver diagnostics shown (mesh and time)", "mesh" in info and "cells" in info)
    d.find_element(By.XPATH, "//div[@role='listitem']//span[text()='Core']").click()
    cw = d.find_element(By.CSS_SELECTOR, "input[aria-label='Width']")
    cw.send_keys(Keys.CONTROL, "a"); cw.send_keys("700", Keys.ENTER)
    click_solve()
    t0 = time.time()
    ok("re-solve after an edit gives a lower n_eff for a narrower core", wait(lambda: status() == "Up to date" and float(neff0()) < n0 - 0.01, 60), f"{neff0()} in {time.time() - t0:.1f} s")
    shot("drive-7-real")
    ok("no JS errors with the real solver", not errors(), json.dumps(errors())[:300])
finally:
    d.quit()
    print(f"\n{sum(r[1] for r in results)}/{len(results)} passed")
    sys.exit(0 if results and all(r[1] for r in results) else 1)
