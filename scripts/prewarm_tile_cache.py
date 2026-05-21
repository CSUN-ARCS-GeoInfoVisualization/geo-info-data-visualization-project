"""Pre-warm feature_cache_elevation / _evi / _kbdi for a coarse CA grid.

Hits the deployed API's pre-warm endpoint, which is cheaper than running
the heavy fetchers from GHA (no GEE / NASA POWER credentials on the runner).
A request handler in research.py iterates a 0.05° CA grid (~4000 tiles) and
ensures each tile has fresh entries in all three feature_cache_* tables.

Called from .github/workflows/daily-prewarm.yml.
"""
from __future__ import annotations

import json
import os
import sys
import urllib.error
import urllib.request

API_BASE = os.environ.get('API_BASE', 'https://firescope-api.onrender.com/api')


def main() -> int:
    url = f'{API_BASE}/research/admin/prewarm-tiles'
    try:
        req = urllib.request.Request(url, method='POST')
        with urllib.request.urlopen(req, timeout=900) as resp:
            body = json.load(resp)
        print(json.dumps(body, indent=2))
        # Pass if we got any tile writes; warn if many failed.
        wrote = body.get('wrote', 0)
        failed = body.get('failed', 0)
        if wrote == 0 and failed > 0:
            return 1
        return 0
    except urllib.error.HTTPError as e:
        print(f'HTTP {e.code}: {e.read().decode()[:500]}', file=sys.stderr)
        return 1
    except Exception as e:
        print(f'error: {e}', file=sys.stderr)
        return 1


if __name__ == '__main__':
    sys.exit(main())
