# Geo Info Data Visualization - Backend
#
# Inside `backend/` we use absolute imports (`from models import db`, etc.),
# which assumes `backend/` itself is on sys.path. That's how it runs in
# development and in the gunicorn startCommand (where rootDir=backend is CWD).
#
# Render's preDeployCommand does NOT honor rootDir, so when flask is invoked
# from the project root the package gets imported as `backend.app`, the
# inner `from models import db` resolves against the project root, and we
# crash with ModuleNotFoundError: No module named 'models'. Putting this
# directory on sys.path on import keeps both call sites working.
import os
import sys

_pkg_dir = os.path.dirname(os.path.abspath(__file__))
if _pkg_dir not in sys.path:
    sys.path.insert(0, _pkg_dir)
