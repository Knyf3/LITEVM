# Oracle Review: LITEVM Verify Page Dual-Deployment Approach

## Source files analyzed
- `verify.js` (1625 lines) — all ACTApiBase refs, GAS fetch patterns, scanner code
- `verify.html` (506 lines) — full DOM structure
- `config.js` (15 lines) — all config values

---

## 🔴 Critical — will break production. Must fix.

### C1. GAS POST + 302 redirect + origin change risk
**All core operations (check-in, reject, sign-out, bulk sign-out, quick sign-out) depend on Google Apps Script.** The current code uses `redirect: 'follow'` on POST requests with `Content-Type: text/plain`:

```
POST https://script.google.com/macros/s/.../exec  →  302 redirect  →  GET https://script.googleusercontent.com/...
```

This works from `https://knyf3.github.io` today. **It may break from `http://192.168.x.x:8021`** because:
- The browser changes POST→GET on the 302 redirect (standard behavior for 302)
- The final `script.googleusercontent.com` response includes CORS headers, but these are dynamically generated based on the requesting origin
- **If Google's infrastructure doesn't include `http://192.168.x.x:8021` in the `Access-Control-Allow-Origin` response, ALL local-mode operations fail — lookup, check-in, reject, today's list, everything**
- This is NOT an ACTApi issue — it affects the entire verify page in local mode

**File:** lines 538-542, 544 (response as text), and all other GAS fetch() calls

**Must-test before declaring local mode viable.** If this fails, the entire dual-deployment approach is blocked unless the page is served from `localhost` or another allowed origin.

### C2. grantActAccess uses `Content-Type: application/json` — preflight risk
The ACT door access PUT (line 1565-1568):

```javascript
fetch(url, {
  method: 'PUT',
  headers: { 'Content-Type': 'application/json' },
  ...
})
```

`Content-Type: application/json` is NOT a CORS-safelisted content type. This triggers a CORS preflight (OPTIONS request). This is fine when:
- **Local mode:** verify.html is served from the ACTApi's own origin → no CORS needed → ✓
- **Online mode:** ACT call is skipped (guard blocks `null`) → ✓

**🔴 BUT:** If someone misconfigures and sets `ACTApiBase` to a string that doesn't match the page origin in local mode (e.g., `ACTApiBase: 'http://different-host:8021'` when the page is on `http://192.168.x.x:8021`), the preflight fails silently (catch at line 1574 just logs warning). The check-in succeeds but ACT door access fails with no user-visible feedback.

### C3. Default config.js has `ACTApiBase: ''` — online deployment will make phantom API calls
Current config.js line 15:
```javascript
ACTApiBase: '',  // e.g. 'http://192.168.2.121:8021' — set during deployment
```

If someone doesn't explicitly set `ACTApiBase: null` before deploying to GitHub Pages:
- The guard fix (`if (actApiBase !== null && actApiBase !== undefined)`) passes `''`
- `grantActAccess` makes a PUT to `https://knyf3.github.io/api/users/{cardNo}/extra-rights`
- This 404s silently (caught by catch at line 1574)
- Result: useless network call + console warning for EVERY check-in, no user-visible error

**Fix:** Make the online-mode config explicit. Add a deploy script that sets `null` or change the default to `null` with a clear comment.

---

## 🟡 Medium — should address for quality

### M1. GAS GET requests also set Content-Type: text/plain (unnecessary but harmless)
Lines 199, 247, 716:
```javascript
headers: { 'Content-Type': 'text/plain' },
```

On GET requests this header is meaningless (no body). It doesn't trigger preflight (`text/plain` is safelisted), but it's misleading. Not a bug, but cleanup opportunity.

### M2. Card QR URL and photo URLs from GAS may be relative
The `cardQRUrl` and photo URLs (`idPhotoUrl`, `selfieUrl`) come from GAS. If GAS returns relative URLs (e.g., `/thumbnail?id=abc`), they resolve against the page origin. In local mode (`http://192.168.x.x:8021`), this would fetch from the local server, not Google Drive — photos would fail to load. The code assumes Google Drive thumbnail URLs (absolute `https://drive.google.com/...`) and converts them via `driveThumbUrl()`.

**Currently photos work because GAS returns full Google Drive URLs.** If GAS ever changes, local mode breaks silently. Consider having GAS always return full absolute URLs.

### M3. `origin` field in POST payloads sent to GAS
All POST payloads include `origin: window.location.origin` (lines 534, 1023, 1206). In local mode this will be `http://192.168.x.x:8021`. If the GAS backend validates or whitelists origins, local mode will be rejected. The GAS backend needs to accept any origin or not check this field.

### M4. Mixed-content concern: HTTPS images on HTTP page (local mode)
- `driveThumbUrl()` generates `https://drive.google.com/thumbnail?id=...&sz=w400`
- These are loaded as `<img>` tags on the verify page
- From an HTTP origin (`http://192.168.x.x:8021`), loading HTTPS images is **allowed** (passive mixed content, not blocked)
- However, the Photo Lightbox (`openLightbox()`) sets `<img src>` to the full Google Drive URL — same HTTPS-on-HTTP situation
- **Not a blocker**, but the architect should be aware of the mixed-content indicator in browser DevTools

### M5. Scanner dead code after HTML removal
If the QR scanner button/UI is removed from the HTML, the scanner JavaScript (lines 1398-1536) becomes dead code. The code references `$('#scanner-modal')` and `$('#scanner-viewport')` with null guards, so it won't crash, but:
- `App.scanBarcode` and `App.closeScanner` are exposed in the public API (line 1583+)
- The HTML5-QRcode CDN script (line 14 of verify.html) is still loaded but unused
- The keyboard handler references `scanner-modal` (line 1377, 1390)

**Recommend removing the scanner JS section, removing the CDN `<script>` tag, and cleaning up the App public API** for a leaner local deployment. The HTML-only removal leaves ~140 lines of dead JS + an extra CDN load.

---

## 🟢 Minor — nice to have

### N1. Cache-busting version coordination
Files load with version params: `config.js?v=6`, `verify.js?v=8`. In dual deployment, these versions need to be updated in lockstep across both deployment targets. If GitHub Pages updates verify.js to `v=9` but the local copy still has `v=8`, the browser cache might serve stale code. Consider:
- A single source of truth for version numbers
- Or switch to content-hash-based cache busting in the build step

### N2. Missing `Content-Type` header on GET `tryCardLookup` (minor inconsistency)
Line 244-248:
```javascript
fetch(url, {
  method: 'GET',
  redirect: 'follow',
  signal: AbortSignal.timeout(CONFIG.TIMEOUT_MS || 10000),
})
```

Note: no `headers` key at all here. The other GET requests (lookup, today) explicitly set `headers: { 'Content-Type': 'text/plain' }`. Inconsistent but harmless since GET has no body.

### N3. validate.js not checked
The project may have other HTML pages (index.html, report.html). If those also depend on `CONFIG.ACTApiBase` or have similar origin assumptions, they need review too. This review only covered verify.js and verify.html.

---

## 💡 Refinements — improvement suggestions

### R1. ACTApiBase validation in grantActAccess
The function has no input validation:

```javascript
function grantActAccess(cardNo, doorGroupId, apiBase) {
  var url = apiBase.replace(/\/+$/, '') + '/api/users/' + ...
```

If `apiBase` contains a path segment (e.g., `http://192.168.x.x:8021/somepath`):
- Result: `http://192.168.x.x:8021/somepath/api/users/...` → broken

If `apiBase` is set to a relative path like `/api`:
- Result: `/api/api/users/...` → broken

**Suggestion:** Validate that the final URL starts with `http://` or `https://` or `/` before calling fetch(), or strip path segments from the base URL. Add a warning log if the base URL looks malformed.

### R2. Deployment automation for config patching
The dual-mode approach requires two config.js files: one with `ACTApiBase: null`, one with `ACTApiBase: ''`. Consider adding a build step:

```bash
# Online deployment
cp config.js config.js.online && sed -i 's/ACTApiBase: .*/ACTApiBase: null/' config.js

# Local deployment
cp config.js config.js.local && sed -i "s/ACTApiBase: .*/ACTApiBase: ''/" config.js
```

Or use a build script that reads an environment variable (e.g., `DEPLOY_MODE=online|local`) and generates config.js accordingly. This prevents human error.

### R3. Consider using a relative path for ACTApi in local mode
Since the verify page is served from the ACTApi's own web server in local mode, `ACTApiBase: ''` works but is unintuitive. Consider either:
- Document clearly that `''` means "same origin via absolute path"
- Or allow the developer to set `ACTApiBase: '/'` which also produces correct URLs

Same result either way — the `replace(/\/+$/, '')` call strips the trailing slash regardless.

### R4. GAS response parsing: `res.text()` → `res.json()`
The code consistently calls `res.text()` and then `JSON.parse(text)` inside `.then()`. This is an extra unnecessary step. Using `res.json()` directly would be cleaner:

```javascript
// Current pattern (repeated 6 times):
fetch(...).then(function (res) { return res.text(); }).then(function (text) {
  var data;
  try { data = JSON.parse(text); } catch(e) { ... }
  ...
});

// Could be:
fetch(...).then(function (res) { return res.json(); }).then(function (data) {
  ...
}).catch(function(err) {
  // JSON parse errors caught here automatically
});
```

This is safe because GAS always responds with JSON-like text body that can be parsed. Cleanup suggestion, not a bug.

---

## Summary of dual-mode viability

| Check | Result |
|-------|--------|
| Single verify.js sufficient? | ✅ Yes — ACTApiBase is only referenced at line 565-568 |
| Config-only difference? | ✅ Yes — change `ACTApiBase` value only |
| Empty string URL valid for fetch()? | ✅ Yes — resolves to same-origin absolute path |
| grantActAccess URL construction correct? | ✅ Yes for trailing-slash cases |
| No other ACTApiBase references? | ✅ Confirmed zero other references |
| CORS risk for GAS from HTTP origin? | ⚠️ **Uncertain** — must test with real `192.168.x.x` deployment |
| Mixed content (HTTPS images on HTTP page)? | ⚠️ Passive content only — browser allows it |
| Scanner code/data size after removal? | ⚠️ ~140 lines dead JS remain if only HTML removed |

**Bottom line:** The dual-deployment approach is architecturally sound **IF** Google Apps Script accepts fetch() calls from `http://192.168.x.x:8021`. This is the single make-or-break question. Everything else is cleanup or polish.

**Recommended next step:** Deploy to a real `http://192.168.x.x:8021/verify/` endpoint and test all operations (lookup, check-in, reject, today's list, bulk sign-out).
