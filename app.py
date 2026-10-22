"""Vercel entrypoint for Packet Highway.

Vercel detects the FastAPI framework preset from requirements.txt, loads the
top-level `app` object below, and routes every request to it — so this single
function serves the REST API, the /ws/live WebSocket, and the static frontend
(the backend already mounts StaticFiles at "/").

The frontend directory is force-included into the function bundle via
`includeFiles` in vercel.json, because Vercel's Python tracer only follows
imports and would otherwise drop frontend/ from the bundle.
"""
from __future__ import annotations

import sys
from pathlib import Path

# Make the repo root importable so `backend` resolves as a package.
sys.path.insert(0, str(Path(__file__).resolve().parent))

from backend.app import app  # noqa: E402,F401  (re-exported for Vercel)
