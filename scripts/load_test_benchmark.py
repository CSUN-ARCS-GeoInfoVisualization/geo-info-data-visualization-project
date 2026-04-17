#!/usr/bin/env python3
"""
Lightweight load test: concurrent GET /health and POST /api/predict.
Usage:
  python scripts/load_test_benchmark.py [--base http://127.0.0.1:5000] [--health-only]
"""
from __future__ import annotations

import argparse
import json
import statistics
import sys
import threading
import time
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed


def _request(
    method: str,
    url: str,
    body: bytes | None = None,
    timeout: float = 120.0,
) -> tuple[float, int, str | None]:
    t0 = time.perf_counter()
    err: str | None = None
    code = 0
    try:
        req = urllib.request.Request(url, method=method, data=body)
        if body is not None:
            req.add_header("Content-Type", "application/json")
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            code = resp.status
    except urllib.error.HTTPError as e:
        code = e.code
        err = e.read().decode(errors="replace")[:200]
    except Exception as e:
        err = str(e)
    elapsed = time.perf_counter() - t0
    return elapsed, code, err


def run_phase(
    name: str,
    base: str,
    method: str,
    path: str,
    body: bytes | None,
    concurrency: int,
    total_requests: int,
) -> None:
    url = base.rstrip("/") + path
    latencies_ok: list[float] = []
    latencies_fail: list[float] = []
    codes: dict[int, int] = {}
    errors: list[str] = []
    lock = threading.Lock()

    def one(_i: int) -> None:
        elapsed, code, err = _request(method, url, body)
        with lock:
            codes[code] = codes.get(code, 0) + 1
            if code == 200 and err is None:
                latencies_ok.append(elapsed)
            else:
                latencies_fail.append(elapsed)
                if err and len(errors) < 8:
                    errors.append(err)

    t0 = time.perf_counter()
    with ThreadPoolExecutor(max_workers=concurrency) as ex:
        list(ex.map(one, range(total_requests)))
    wall = time.perf_counter() - t0

    ok = len(latencies_ok)
    fail = len(latencies_fail)
    all_lat = latencies_ok + latencies_fail

    def pct(p: float) -> float:
        if not latencies_ok:
            return float("nan")
        return statistics.quantiles(latencies_ok, n=100)[p - 1]

    print(f"\n=== {name} ===")
    print(f"  URL: {method} {url}")
    print(f"  Concurrency: {concurrency}  Total requests: {total_requests}  Wall time: {wall:.2f}s")
    print(f"  Success (HTTP 200): {ok}  Fail: {fail}")
    print(f"  Status codes: {codes}")
    if latencies_ok:
        print(
            f"  Latency OK (s): min={min(latencies_ok):.3f}  p50={pct(50):.3f}  "
            f"p95={pct(95):.3f}  max={max(latencies_ok):.3f}"
        )
        print(f"  Throughput (OK req/s): {ok / wall:.2f}")
    else:
        print("  Latency OK: (no successful responses)")
    if latencies_fail:
        print(
            f"  Latency all failures (s): min={min(latencies_fail):.3f}  max={max(latencies_fail):.3f}"
        )
    for e in errors[:5]:
        print(f"  Sample error: {e[:120]}")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", default="http://127.0.0.1:5000", help="API origin (no /api suffix)")
    ap.add_argument("--health-only", action="store_true")
    args = ap.parse_args()
    base = args.base.rstrip("/")

    predict_body = json.dumps({"lat": 34.05, "lon": -118.25}).encode()

    # Warmup
    _request("GET", base + "/health", None, timeout=30)

    run_phase(
        "GET /health (light)",
        base,
        "GET",
        "/health",
        None,
        concurrency=20,
        total_requests=100,
    )

    if not args.health_only:
        run_phase(
            "POST /api/predict (heavy: external APIs + ML)",
            base,
            "POST",
            "/api/predict",
            predict_body,
            concurrency=5,
            total_requests=15,
        )
        run_phase(
            "POST /api/predict stress (same, higher concurrency)",
            base,
            "POST",
            "/api/predict",
            predict_body,
            concurrency=15,
            total_requests=30,
        )

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
