#!/usr/bin/env python3
"""
LITEVM Auto Sign-Out — Local Script (Option 2)

Runs on the Windows machine alongside ACTApi. At scheduled time (default 21:00):
1. Fetches checked-in visitors from GAS (includes assigned card numbers)
2. Revokes ACT door access for each via ACTApi (gracefully skips if unreachable)
3. Signs them out in GAS via bulkSignOut (releases cards, updates status)

Works without ACTApi — just skips the revoke step and still signs out in GAS.
"""

import json
import logging
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

# ── Configuration ────────────────────────────────────────────────
CONFIG = {
    # GAS Web App URL (required)
    "gas_url": "https://script.google.com/macros/s/AKfycbyQA6WibRYfpTJYA7syYaskM2n45csIs_sjzn-FfF8sNKaAFWOkIrNcRfYC-nTJc7JK/exec",

    # ACTApi base URL — empty string = skip ACT door revoke entirely
    # e.g. "http://localhost:8021" or ""
    "actapi_base": "http://localhost:8021",

    # Google Sheet ID for visitor data
    "sheet_id": "1-rHZEn2AWvezVBW3qfRLwOWE7mwHSxcV0_UJNVOSqAs",
}

# Log to file next to script + console
LOG_DIR = os.path.dirname(os.path.abspath(__file__))

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
    handlers=[
        logging.FileHandler(os.path.join(LOG_DIR, "auto-signout.log"), encoding="utf-8"),
        logging.StreamHandler(sys.stdout),
    ],
)
logger = logging.getLogger("auto-signout")


# ── HTTP Helpers ─────────────────────────────────────────────────


def _safe_urlopen(req, timeout):
    """urlopen wrapper with scheme/host guard — all outbound calls go through here.

    Blocks non-http(s) schemes (e.g. ``file://`` local reads) and non-local
    plain-HTTP targets. Local plain HTTP is allowed because ACTApi runs on
    this machine (http://localhost:8021). # nosemgrep
    python.lang.security.audit.dynamic-urllib-use-detected
    (intentional: the dynamic URL is validated here before opening)
    """
    parsed = urllib.parse.urlparse(req.full_url)
    if parsed.scheme not in ("https", "http"):
        raise ValueError(f"blocked non-http(s) URL scheme: {parsed.scheme!r}")
    if parsed.scheme == "http":
        host = parsed.hostname or ""
        if host not in ("localhost", "127.0.0.1", "::1"):
            raise ValueError(f"blocked plain-http (non-local) URL: {req.full_url}")
    # (intentional: the dynamic URL is validated above before opening)
    # nosemgrep
    return urllib.request.urlopen(req, timeout=timeout)


def gas_get(action, sheet_id):
    """GET request to GAS Web App."""
    url = f"{CONFIG['gas_url']}?{urllib.parse.urlencode({'action': action, 'sheetId': sheet_id})}"
    req = urllib.request.Request(url)
    with _safe_urlopen(req, timeout=30) as resp:
        return json.loads(resp.read().decode("utf-8"))


def gas_post(payload):
    """POST request to GAS Web App.

    Uses text/plain to avoid CORS preflight (matches frontend convention).
    """
    data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(CONFIG["gas_url"], data=data)
    req.add_header("Content-Type", "text/plain")
    with _safe_urlopen(req, timeout=30) as resp:
        return json.loads(resp.read().decode("utf-8"))


def actapi_revoke(card_no):
    """DELETE extra-rights via ACTApi. Returns True on success."""
    url = f"{CONFIG['actapi_base']}/api/users/{urllib.parse.quote(card_no, safe='')}/extra-rights"
    req = urllib.request.Request(url, method="DELETE")
    try:
        with _safe_urlopen(req, timeout=10) as resp:
            body = resp.read().decode("utf-8", errors="replace")
            if resp.status == 200:
                logger.info(f"  ACTApi revoke OK — card {card_no}: {body[:100]}")
                return True
            else:
                logger.warning(f"  ACTApi revoke returned {resp.status} for card {card_no}: {body[:100]}")
                return False
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", errors="replace")
        logger.warning(f"  ACTApi HTTP {e.code} for card {card_no}: {body[:100]}")
        return False
    except urllib.error.URLError as e:
        logger.warning(f"  ACTApi unreachable for card {card_no}: {e.reason}")
        return False
    except Exception as e:
        logger.warning(f"  ACTApi error for card {card_no}: {e}")
        return False


# ── Main Logic ───────────────────────────────────────────────────


def auto_signout():
    logger.info("=" * 60)
    logger.info("LITEVM Auto Sign-Out Started")
    logger.info("=" * 60)

    actapi_available = bool(CONFIG.get("actapi_base", "").strip())

    # ── Step 1: Fetch today's visitors ──────────────────────────
    logger.info("Step 1: Fetching today's visitors from GAS...")
    try:
        resp = gas_get("today", CONFIG["sheet_id"])
    except Exception as e:
        logger.error(f"Failed to fetch visitors from GAS: {e}")
        return False

    if resp.get("status") != "ok":
        logger.error(f"GAS returned error: {resp.get('error', 'unknown')}")
        return False

    visitors = resp.get("visitors", [])
    checked_in = [v for v in visitors if v.get("status") == "Checked In"]
    logger.info(f"  Total today: {len(visitors)}, Checked in: {len(checked_in)}")

    if not checked_in:
        logger.info("  No checked-in visitors. Nothing to do.")
        return True

    # ── Step 2: Revoke ACT access for each ──────────────────────
    act_success = 0
    act_failed = 0

    if actapi_available:
        logger.info(f"Step 2: Revoking ACT door access via {CONFIG['actapi_base']}...")
        for v in checked_in:
            card_no = v.get("cardNo", "")
            if not card_no:
                logger.info(f"  {v.get('visitorNumber', '?')}: no card assigned, skipping ACT revoke")
                continue
            if actapi_revoke(card_no):
                act_success += 1
            else:
                act_failed += 1
            time.sleep(0.5)  # gentle pace for ACT Pro
    else:
        logger.info("Step 2: ACTApi not configured — skipping door revoke.")

    logger.info(f"  ACT revoke: {act_success} succeeded, {act_failed} failed/skipped")

    # ── Step 3: Bulk sign-out in GAS ────────────────────────────
    logger.info("Step 3: Signing out visitors in GAS...")

    visitor_numbers = [v.get("visitorNumber", "") for v in checked_in if v.get("visitorNumber")]
    logger.info(f"  Sending {len(visitor_numbers)} visitor(s) to bulkSignOut...")

    # Batch in chunks of 25 (GAS limit)
    batch_size = 25
    total_ok = 0
    total_error = 0

    for batch_start in range(0, len(visitor_numbers), batch_size):
        batch = visitor_numbers[batch_start:batch_start + batch_size]
        try:
            result = gas_post({
                "mode": "bulkSignOut",
                "sheetId": CONFIG["sheet_id"],
                "visitorNumbers": batch,
            })
            summary = result.get("summary", {})
            batch_ok = summary.get("ok", 0)
            batch_err = summary.get("error", 0)
            total_ok += batch_ok
            total_error += batch_err
            logger.info(f"  Batch {batch_start // batch_size + 1}: {batch_ok} ok, {batch_err} errors")
        except Exception as e:
            logger.error(f"  Batch {batch_start // batch_size + 1} failed: {e}")
            total_error += len(batch)

        time.sleep(1)

    # ── Summary ──────────────────────────────────────────────────
    logger.info("=" * 60)
    logger.info("SUMMARY")
    logger.info(f"  Visitors processed: {len(checked_in)}")
    if actapi_available:
        logger.info(f"  ACT revocations:    {act_success} ok, {act_failed} failed")
    logger.info(f"  GAS bulk sign-out:  {total_ok} ok, {total_error} errors")
    logger.info("=" * 60)

    return total_error == 0


# ── Entry Point ──────────────────────────────────────────────────

if __name__ == "__main__":
    success = auto_signout()
    sys.exit(0 if success else 1)
