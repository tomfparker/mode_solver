// Pyodide is pinned (see DECISIONS.md). Loaded from jsDelivr by default; set
// VITE_PYODIDE_BASE to a self-hosted copy (e.g. "./pyodide/") for offline labs.
export const PYODIDE_VERSION = '314.0.7';

export const PYODIDE_BASE: string =
  (import.meta.env.VITE_PYODIDE_BASE as string | undefined) ??
  `https://cdn.jsdelivr.net/pyodide/v${PYODIDE_VERSION}/full/`;
