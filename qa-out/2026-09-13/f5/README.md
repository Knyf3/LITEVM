# F5 — provisioning blocked by CORS: fix evidence (2026-09-13)

## Root cause
`UStarAPI/Program.cs` reads `Cors:AllowedOrigins`; empty ⇒ defaults to localhost:8123 only.
The kiosk page is browsed at `http://192.168.2.238:8123` (different origin; cross-origin even
when co-located because the port differs) ⇒ the browser blocked the provision POST and no
credential reached the reader.

## Fix applied
Gateway `C:\Program Files\Entech Security\UStarAPI\Settings\Settings.json`:
    "Cors": { "AllowedOrigins": [ "http://192.168.2.238:8123", "http://localhost:8123", "http://127.0.0.1:8123" ] }
backup: `Settings.json.bak-cors-20260913`; applied by `f5_gateway_cors.ps1`; UStarAPI restarted.

## Verification
| Probe | Result |
|---|---|
| OPTIONS preflight, Origin: http://192.168.2.238:8123 | 204 + `Access-Control-Allow-Origin: http://192.168.2.238:8123` |
| OPTIONS preflight, Origin: http://evil.example (control) | 204, **no** allow header |
| Real kiosk check-in, normal path, real face | console `UStar provision succeeded for card 5002`; device face 2 → 3 |
| Real kiosk check-in, response destroyed after commit | settled `verified`; POST reached gateway, structured result returned |

## Device refusals encountered (correct refusals, not defects)
- `LAN_EXP-8006` = No faces detected  (1×1 px test image)
- `LAN_EXP-3056` = Face has been registered  (same portrait already enrolled as person 5061 —
  all six probe selfies in the tenant are the SAME 54,528-byte image)

## Cleanup performed (f5_cleanup.py)
- V-20260913-006 / -007 signed out → cards 5001 / 5002 returned to the pool
- `DELETE /api/litevm/persons/{5001,5002}?doorGroupId=2` → both deleted (doorGroupId is REQUIRED)
- recognition records re-read: 0 on all three endpoints
- device restored to baseline: person=2 face=2 finger=3 (bench visitor card 5061 untouched)

## Owed (durable fixes, not applied)
1. KioskServer same-origin `/api/litevm/provision` proxy (no CORS, no secret in the browser).
2. Or: gateway default when the list is empty = localhost + the host's own IPv4s at :8123.
3. ACTApi sibling: `ACTApi/Program.cs` enables CORS only when `CorsOrigins` is non-empty, and the
   kiosk's grant/revoke extra-rights calls are cross-origin.
