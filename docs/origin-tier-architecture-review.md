# LITEVM — Origin-Based Access Control + Usage Tier Architecture Review

**Date:** 30 June 2026  
**Context:** Multi-tenant visitor management system. One GAS Web App serves many customer sheets.  
**Proposed Architecture:** Master config sheet mapping `sheetId → allowedOrigins, visitorLimit, tier`; GAS reads it on every request.

---

## 1. GAS Performance — Master Sheet on Every Request

### The Problem

Currently, each request opens exactly **one** spreadsheet (the customer's). The proposed architecture requires opening **two** sheets per request: the master config sheet (to resolve access/tier) AND the customer data sheet.

`SpreadsheetApp.openById()` takes **0.5–2s** per call (Google's documented latency for cross-sheet access). Adding one extra `openById()` per request means:

| Metric | Current | Proposed | Delta |
|--------|---------|----------|-------|
| openById calls per request | 1 | 2 | 2× |
| Typical latency per request | 1–3s | 1.5–5s | +50–100% |
| GAS execution time (6 min max) | Safe up to ~180 reqs | Safe up to ~72-120 reqs | ↓ |

### Cache in PropertiesService?

**Available storage:** 500KB total.
**Data per customer:** very small (origin URL ~30 bytes, tier name ~10 bytes, limit ~4 bytes).
**100 customers:** ~4,400 bytes → well within 500KB.
**1,000 customers:** ~44KB → still fine.

**The real issue is staleness:**
- `PropertiesService` changes are **not transactional** with Sheets data
- If you cache at script start, the cached tier/limit serves all concurrent requests during that execution
- A tier upgrade mid-execution won't be seen until the next execution starts
- `PropertiesService` values are cached at the **script container** level for the duration of the execution

**Better approach:** Load the ENTIRE master config once into script memory at the **first request** of each execution, cache in a global variable. No per-request `openById()` for the config:

```javascript
var _masterConfig = null;

function getMasterConfig() {
  if (_masterConfig) return _masterConfig;
  var ss = SpreadsheetApp.openById(MASTER_SHEET_ID);
  var sheet = ss.getSheetByName('Customers');
  var data = sheet.getDataRange().getValues();
  _masterConfig = {};
  for (var i = 1; i < data.length; i++) {
    _masterConfig[data[i][0]] = {  // keyed by sheetId
      allowedOrigins: (data[i][1] || '').split(',').map(function(s) { return s.trim(); }),
      visitorLimit: parseInt(data[i][2], 10) || 50,
      tier: data[i][3] || 'free',
    };
  }
  return _masterConfig;
}
```

This reduces the cost from one `openById()` per request to **zero** after the first call. The first request pays ~1s, subsequent requests in the same execution are instant.

### Execution Duration Impact

GAS has a **6-minute (360s) execution limit** per invocation. If each non-cached request costs 2s (2× openById), you get 180 sequential requests max. With the cache pattern above, the warm requests cost 0.5–1s (1× openById for the customer data), giving you up to 360–720 requests per execution.

**Verdict:** Not a showstopper. The in-memory cache pattern fixes the primary performance concern. But the cache busts on every new execution (which is every ~60–180s for an idle Web App, near-instant for a busy one), so high-traffic customers see **no penalty** while low-traffic ones pay a ~1s penalty at most once per execution.

---

## 2. Origin Header Reliability

### The Core Problem

The `Origin` header is an **optional** HTTP header. Browsers send it, but:

| Scenario | Origin Sent? | Value |
|----------|-------------|-------|
| Standard browser fetch, same-origin | Not sent | — |
| Standard browser fetch, cross-origin | ✅ Sent | The origin (e.g., `https://knyf3.github.io`) |
| Mobile app / WebView | ❌ Often stripped | — |
| Corporate proxy / enterprise browser | ❌ May be stripped | — |
| Privacy browsers (Brave Shield, Firefox Strict) | ✅ Sent | But `Sec-Fetch-*` headers may be preferred |
| `curl` / Postman / non-browser client | ❌ Not sent | — |
| Google Apps Script `UrlFetchApp` | ❌ Not sent | — |
| JavaScript `fetch()` with `mode: 'no-cors'` | ✅ Sent | But response is opaque |
| Browser extension / background script | ⚠️ Depends on permissions | — |
| iOS `WKWebView` / Android `WebView` | ⚠️ Varies by version | Often omitted |

**This means Origin-based access control is unreliable for:**

1. **Mobile app integrations** — If a client builds a custom mobile app wrapping LITEVM, the Origin may not be sent
2. **Corporate deployments** — Enterprise proxies frequently strip Origin for security/privacy reasons
3. **The wrapper.gs (bound script)** — When `callWebApp_()` fires, the request comes from GAS `UrlFetchApp`, which does NOT send an Origin header. The auto-sign-out trigger would be blocked!
4. **Internal testing** — Developer testing from curl/Postman would be blocked

### Four-Layer Fallback Strategy

A single Origin check is insufficient. You need a graduated approach:

```
Origin check:
  ├─ Origin matches an allowedOrigin → ALLOW
  └─ Origin is empty/missing → fallback:
       ├─ sheetId + secret token match → ALLOW (wrapper.gs calls, admin calls)
       ├─ GAS IP range match → ALLOW (time-driven triggers, bound scripts)
       └─ ALL other no-Origin requests → BLOCK with strict logging
```

**The hard problem:** You can't distinguish "legitimate client forgot to send Origin" from "attacker is trying to bypass Origin check." The fallback mechanisms above each have their own weaknesses:

- **Secret token:** Must be stored somewhere. In config.js (same file as sheetId) — trivial to extract. In Script Properties (wrapper.gs) — OK for bound scripts.
- **IP matching:** GAS runs on Google's IP ranges, which change. Maintaining them is a pain.

**Recommendation:** Origin check as a **deterrence layer, not a security boundary**. Treat it as defense-in-depth, not the sole authentication mechanism.

---

## 3. SheetId Exposure & Multi-Subdomain Customers

### Current Exposure

The `sheetId` lives in `config.js`, served on the customer's GitHub Pages domain:

```javascript
const CONFIG = {
  SHEET_ID: '1-rHZEn2AWvezVBW3qfRLwOWE7mwHSxcV0_UJNVOSqAs',
  // ...
};
```

Anyone who views the page source gets the sheetId. This is **unavoidable** with this architecture.

### What Origin Control Actually Protects

If a malicious actor *copies* `config.js` and runs LITEVM from their own domain:
- Origin check blocks the API call → their fork cannot register visitors or access data
- BUT: the attacker has the sheetId. They could use the Google Sheets API directly (if the sheet is shared publicly)
- The real security boundary is **Google Sheet sharing permissions**, not the Origin check

### Multi-Subdomain Customers (office1.example.com, office2.example.com)

A customer who deploys on multiple subdomains needs **all** of them in the allowedOrigins list:

```json
{
  "allowedOrigins": "office1.example.com,office2.example.com,example.com"
}
```

**Pattern:** Support wildcard prefixes? `*.example.com` would be convenient but risky — `evil.example.com` would also be allowed. Better to require explicit entries but cap at a reasonable number (e.g., 20 per customer).

**Implementation in master config:** Store origins as a comma-separated string, split and trim in GAS, match against `e.parameter.origin.toLowerCase()` or a custom header.

**Match logic:**
```javascript
function isOriginAllowed(origin, allowedOrigins) {
  if (!origin) return false;
  var o = origin.toLowerCase();
  for (var i = 0; i < allowedOrigins.length; i++) {
    var a = allowedOrigins[i].toLowerCase();
    if (o === a || o === a + '/' || o.replace(/\/$/, '') === a) return true;
    // Optional wildcard support: if (a.indexOf('*.') === 0 && o.endsWith(a.slice(1))) return true;
  }
  return false;
}
```

### SheetId Rotation

If a customer's sheetId is compromised (e.g., the GitHub Pages repo is forked maliciously), can you rotate? **Yes, with pain:**

1. Copy the customer sheet to a new Sheet → new sheetId
2. Update `config.js` → redeploy frontend
3. Update master config → new sheetId
4. Old sheetId stops working (not in master config)

This is a **valid incident response procedure** — not something you'd do routinely.

---

## 4. GAS Quotas — At What Customer Count Does This Break?

### Free GAS Quotas (Consumer Google Account)

| Quota | Limit | What it means |
|-------|-------|---------------|
| URL fetch calls | 20,000 / day | Web App receives requests; inbound requests don't count here |
| Execution time | 6 min / invocation | Your code must finish in 360s |
| Total runtime | 90 min / day | All executions combined |
| Triggers total | 90 min / day | Same pool as Web App runtime |
| `openById()` cross-sheet | No explicit quota | Performance degrades, not hard-limited |
| Concurrent requests | 30 | At most 30 simultaneous executions |

### Breaking Down the 90 Min/Day Limit

Assume each request = 1–2s (cached config, openById customer sheet).

**100 customers, 20 requests/day each:**  
→ 2,000 requests × 1.5s = 3,000s = **50 minutes**  
→ ✅ Viable on free tier

**100 customers, 50 requests/day each:**  
→ 5,000 requests × 1.5s = 7,500s = **125 minutes**  
→ ❌ Exceeds free tier by 39% — need paid Google Workspace

**500 customers, 10 requests/day each:**  
→ 5,000 requests × 1.5s = 7,500s = **125 minutes**  
→ ❌ Same issue

**1,000 customers, 5 requests/day each:**  
→ 5,000 requests × 1.5s = 7,500s = **125 minutes**  
→ ❌

### Where It Breaks

**Critical threshold:** approximately **2,000–3,000 requests/day**, regardless of customer count. After that, you either:

1. **Upgrade to Google Workspace** ($6–12/user/month) → bumps to **12 hr/day runtime, 100,000 URL fetches**
2. **Add a caching layer** — Cloudflare Worker in front of GAS that caches GET responses and rate-limits POST
3. **Move to per-customer GAS deployments** (each customer gets their own 90-min budget)

### The Auto Sign-Out Trigger

The 21:00 auto-sign-out trigger consumes the **same 90-min budget**. For 100 customers with 50 checked-in visitors each, the trigger takes:

- Read VisitorLog × 100 sheets: ~0.5s × 100 = 50s
- Write status updates: 5,000 rows × 0.2s = 1,000s (sequential, non-batched)
- **Total: ~17.5 minutes** of the daily budget consumed by one trigger

**Fix:** Batch writes using `setValues()` instead of per-row `setValue()` — cuts write time by 10×.

---

## 5. GitHub Pages Deployment — Developer's Own Origins (knyf3.github.io)

### The Problem

Pages like `verify.html` and `report.html` at `https://knyf3.github.io/LITEVM/` call the same API. Their Origin is `https://knyf3.github.io`. These need whitelisting, but they are:

1. **Your deployment**, not the customer's
2. **Shared by all customers** (or at least, the demo/market-facing version)
3. **Not subject to tier limits** (your pages should have full access)

### How to Handle This Cleanly

**Option A: Reserved super-admin sheetId in master config**

In the master config, reserve a special row for `knyf3.github.io`:

```
sheetId                     | allowedOrigins                         | visitorLimit | tier
INTERNAL_DEV_SHEET_ID       | https://knyf3.github.io                 | 999999       | enterprise
```

Where `INTERNAL_DEV_SHEET_ID` is also a Script Property on the Web App project itself. The frontend at knyf3.github.io uses this sheetId for the report/demo pages.

**Option B: Bypass Origin check when a master admin flag is set**

The frontend at knyf3.github.io sends a special request header or param:

```javascript
// config.js for knyf3.github.io
const CONFIG = {
  SHEET_ID: '...',
  API_BASE: '...',
  MASTER_KEY: 'admin_override_key_set_in_script_properties', // optionally
};
```

Backend checks: if `data.masterKey === PropertiesService.getScriptProperties().getProperty('MASTER_KEY')` → skip origin check, full tier access.

**Option C: Embed the origin check into the route, not at the gate level**

Instead of a single global gate at `doGet()`/`doPost()` entry, do tier/origin checks **per-endpoint**:

- `report` endpoint → tier check, origin check
- `today` endpoint → origin check but no tier check
- `lookup` endpoint → origin check
- `register` endpoint → origin check + tier (visitor count)

This way, knyf3.github.io can hit `lookup`/`today` without tier limits but `register` gets routed through customer-checks.

**Recommendation:** Use **Option A** — it's the simplest. Add an `INTERNAL_SHEET_ID` Script Property. Your frontend at `knyf3.github.io` uses this sheet. The master config gives it unlimited tier. No code paths for special keys, no security risk.

---

## 6. Multi-Tenant Architecture — Single Web App vs Per-Customer GAS

### Comparison Table

| Factor | Single GAS Web App (current + master config) | Per-Customer GAS Deployment |
|--------|----------------------------------------------|----------------------------|
| **Deployments to manage** | 1 | N (1 per customer) |
| **Update roll-out** | Instant — redeploy once | Need to redeploy N times (or use clasp) |
| **Shared quota pool** | All customers share 90 min/day | Each customer gets their own 90 min/day |
| **Per-customer custom logic** | In master config (tier, origins, limits) | In Script Properties per deployment |
| **CORS handling** | Single URL to manage | Unique URL per customer |
| **Origin enforcement** | GAS side (in code) | Built-in — each URL is unique |
| **Migration complexity** | Single migration, all sheets | Must run migration per sheet |
| **Cost** | Free tier works for ~2K reqs/day | 6 GAS projects = 6× quota, but still free |
| **Setup for new customer** | Developer creates sheet → adds row to master config | Developer creates sheet + creates new GAS project + sets props + deploys |
| **Bound script (wrapper.gs)** | One per customer sheet (already done!) | One per customer sheet (same) |
| **Development overhead** | Low | Medium-High (30+ deployments becomes unmanageable without clasp) |

### At What Scale Should You Switch?

| Customer Count | Model | Why |
|---------------|-------|-----|
| 0–50 | **Single Web App** | 1 deployment, quotas hold, management overhead minimal |
| 50–200 | **Single Web App** | Quotas getting tighter (2K-5K reqs/day). Upgrade to Google Workspace |
| 200+ | **Per-customer GAS** | Quotas per customer mean each customer has their own budget. Risk: deployment overhead |
| 500+ | **Neither** — GAS is hitting limits. Migrate to server-side backend | See section 9 |

### Recommendation

**Start with single Web App + master config.** At 100+ customers, implement the caching optimizations above. At 200+ customers, consider the hybrid path:

1. Keep single Web App for the **frontend-facing API** (register, lookup, today, report)
2. Move **background jobs** (auto-sign-out) to per-customer bound scripts (they already have wrapper.gs!)
3. Add a **Cloudflare Worker** as API gateway in front (see section 10)

---

## 7. Monthly Visitor Limit Reset

### The Problem

The `visitorLimit` counter needs to reset **monthly** (e.g., Free tier = 50 visitors/month, resets on the 1st). GAS time-based triggers handle this, but triggers can fail.

### Storage Strategy

Where does the current month's count live?

| Option | Pros | Cons |
|--------|------|------|
| **In the master config sheet** (append column "CurrentMonthVisits") | Everything in one place; easy audit | Every registration writes to master sheet; extra latency; write conflicts at scale |
| **In ScriptProperties** | Fast (no sheet I/O); atomic for the single Web App | Must be maintained across all customers in one property bag; 500KB limit |
| **In the customer's own sheet** (hidden cell in VisitorLog) | Natural locality; each customer's data is self-contained | Need to read an extra cell on every request; GAS openById already paid |
| **Computed from data at request time** (`COUNTIF` in memory) | No counter to maintain; always accurate | Expensive for large sheets (must scan all rows) |

**Recommendation: Compute from data at request time.**

```javascript
function getMonthlyVisitorCount(sheetId) {
  var ss = SpreadsheetApp.openById(sheetId);
  var sheet = ss.getSheetByName('VisitorLog');
  var data = sheet.getDataRange().getValues();
  var timeZone = Session.getScriptTimeZone();
  var now = new Date();
  var firstOfMonth = Utilities.formatDate(
    new Date(now.getFullYear(), now.getMonth(), 1),
    timeZone, 'yyyy-MM-dd'
  );

  var count = 0;
  for (var i = 1; i < data.length; i++) {
    var visitDate = getDateString_(data[i][5]); // col 5 = Visitation Date
    if (visitDate >= firstOfMonth) count++;
  }
  return count;
}
```

**Why this works:**
- No monthly reset trigger needed at all
- Always accurate — no staleness, no missed resets
- Only computed on registration (not on every lookup/today view)
- ~0.5–2s for <5K rows (the range where GAS is viable anyway)
- For larger sheets, add an index (date-sorted rows, binary search exit)

### What if the Trigger Fails?

If you DO go the trigger route for the counter:

**Problem:** Trigger fires, updates ScriptProperties, but half the customers didn't process → some have old counts until next month.

**Idempotency pattern:**

```javascript
function monthlyCounterReset() {
  var config = getMasterConfig();
  var propKey = 'MONTHLY_RESET_' + Utilities.formatDate(new Date(), 'UTC', 'yyyyMM');
  // Check if already done this month
  if (PropertiesService.getScriptProperties().getProperty(propKey) === 'done') return;
  // Reset all counters
  for (var sheetId in config) {
    if (config.hasOwnProperty(sheetId)) {
      // Delete any per-sheet counter if using ScriptProperties
      PropertiesService.getScriptProperties().deleteProperty('COUNT_' + sheetId);
    }
  }
  // Mark complete
  PropertiesService.getScriptProperties().setProperty(propKey, 'done');
}
```

Run this trigger at **00:05 on the 1st of every month**. If it fails, run it manually. The idempotency check means it can be run 10 times with no side effects.

---

## 8. Mid-Month Tier Upgrade

### The Question

Customer upgrades from Free (50 visitors) to Starter (500) on day 15. Current month's count is 40. What happens?

### Expected Behavior: Immediate Expansion

The tier upgrade takes effect **immediately** — the customer has already paid, and locking them until next month would be bad UX.

```javascript
function checkVisitorLimit(sheetId, tier) {
  var currentCount = getMonthlyVisitorCount(sheetId);
  var limit = getTierLimit(tier);  // read from master config, always fresh

  if (currentCount >= limit) {
    return {
      allowed: false,
      message: 'Monthly visitor limit (' + limit + ') reached. ' +
               'Current: ' + currentCount + '. Upgrade your plan at [link].'
    };
  }
  return { allowed: true };
}
```

**Since the tier and limit are read from the master config sheet on every request, a tier upgrade is instantly reflected.** No code changes, no trigger waits.

### Corner Cases

| Scenario | Count | Limit | Result |
|----------|-------|-------|--------|
| Upgrade from Free (50) to Starter (500), count=40 | 40 | 500 | ✅ Allowed — 460 remaining |
| Upgrade, count=55 (already exceeded old limit via pending registrations) | 55 | 500 | ✅ Allowed — count doesn't retroactively block |
| Downgrade from Starter (500) to Free (50), count=300 | 300 | 50 | ⚠️ Visitor cannot register until next month. **Grace period needed** |
| Downgrade, but admin wants to allow existing +1 visit for current month | 300 | 50 | ❌ Blocked. **Pro-rate or "finish current month" grace period** |

**Downgrade Grace Policy:** Apply new limit **next month**, not immediately. The customer paid for this month — honour it.

```javascript
function getEffectiveLimit(config, currentDate) {
  var dayOfMonth = currentDate.getDate();
  // If downgraded this month, still allow the old limit
  var effectiveTier = (config.downgradeRequested && dayOfMonth > 1)
    ? config.previousTier
    : config.tier;
  return getTierLimit(effectiveTier);
}
```

---

## 9. Scalability Path — When and How to Migrate

### When GAS Breaks

| Symptom | Threshold | Indicator |
|---------|-----------|-----------|
| **Execution time limit** | ~360 requests/6-min window | GAS returns 500 error for heavy requests |
| **Daily runtime quota** | ~2,000 requests/day (free) or ~7,200 req/day (Google Workspace) | `Service invoked too many times` errors |
| **Sheet row count latency** | ~10K+ rows/visitorlog | `getDataRange()` takes 5+ seconds |
| **Concurrent request limit** | 30 simultaneous users | Requests queue, time out |
| **Master config sheet growth** | 1,000+ customers | Config load time > 5s |

### Migration Path: Progressive Enhancement

**Phase 1 — Pre-migration (50–200 customers):**
- Stay on GAS
- Add Cloudflare Worker in front as cache + rate-limiter
- Use in-memory config cache (described above)
- Upgrade to Google Workspace for quota increase

**Phase 2 — Hybrid (200–500 customers):**
- Move **registration** endpoint off GAS to a lightweight backend
- Keep **read-only** endpoints (lookup, today, destinations) on GAS (cached via Cloudflare)
- Backend options:
  - **Node.js + SQLite** (on a $5 VPS — 500 customers, 50 regs/day each = 25K regs/day)
  - **Supabase** (free tier: 500MB DB, 50K rows — enough for 100+ customers/month)
  - **Cloudflare Workers + D1** (100K reads/day free, 5M writes/month)

```
Cloudflare Worker (auth + routing)
  ├── GET /lookup, /today    → cached ← GAS (legacy)
  ├── POST /register          → writes ← Node.js + SQLite
  ├── POST /report            → reads ← SQLite (aggregated)
  └── Cron: auto-sign-out     → batch update ← GAS (legacy)
```

**Phase 3 — Full Migration (500+ customers):**
- Replace GAS backend entirely with a proper server
- Migrate Sheets data → PostgreSQL (or keep Sheets as admin UI, sync to DB)
- Drop GAS Web App, keep Sheets as data store
- Frontend remains identical — only `API_BASE` changes
- Estimated timeline: 2–4 weeks of development

### Cost Comparison

| Architecture | 100 Customers | 500 Customers | 1,000 Customers |
|-------------|--------------|---------------|-----------------|
| **GAS-only (free)** | $0/mo | ❌ Doesn't scale | ❌ |
| **GAS-only (Google Workspace)** | $6–12/mo | $6–12/mo | ❌ (quota limits) |
| **Hybrid (Cloudflare + GAS)** | $0–5/mo | $5–10/mo | $10–20/mo |
| **Node.js + SQLite (VPS)** | $5/mo | $10/mo | $20/mo |
| **Supabase Pro** | $25/mo | $25/mo | $75/mo |

---

## 10. Alternative Architectures

### Option A: Cloudflare Worker API Gateway

**What:** A Cloudflare Worker (free tier: 100K requests/day) sits in front of the GAS Web App. It:
- Checks Origin header and validates against a KV store (free tier: 1GB, 100K reads/day)
- Validates a JWT or API token embedded in the request
- Rate-limits per customer (up to 10 req/s per customer)
- Caches GET responses (reducing GAS load by 40–60%)
- Prevents sheetId tampering (attached to the request by the Worker, not the client)

**Pros:**
- Zero GAS overhead for auth/rate-limiting
- GAS only handles legitimate data queries
- Free tier covers up to 100K requests/day
- 0ms cold start (Isolates)

**Cons:**
- Adds a deployment step (you deploy one Worker)
- KV store has eventual consistency (seconds delay)
- Still eventually hits GAS quotas

**Cost:** $0 (within free tier up to 100K reqs/day, 1GB KV, 10M KV reads/month)

### Option B: Vercel Edge Function

**What:** Edge function at Vercel (Hobby plan: 100K invocations/month, 100GB bandwidth, 10 Edge Functions) handles auth and proxies to GAS.

**Pros:**
- Git-based deploys (same workflow as GitHub Pages)
- Better latency than GAS global routing
- Built-in rate limiting via Vercel WAF

**Cons:**
- 10-second max execution on Hobby plan (fine for proxying)
- Cold starts on Edge Functions (50–200ms)
- GAS still in the loop — you haven't eliminated the bottleneck

**Cost:** $0 (Hobby plan)

### Option C: Vercel + Simple Node API (No GAS)

**What:** Replace GAS entirely with a Node.js API on Vercel. Data stays in Google Sheets (read via `googleapis` npm package) or migrates to Vercel Postgres/Edge Config.

**Pros:**
- No GAS quotas at all
- Proper Origin header handling (Express middleware)
- Rate limiting per IP/customer (built-in)
- JWT auth, API keys, webhook support
- Edge Config for tier management (sub-millisecond reads)

**Cons:**
- Full backend to maintain
- Vercel Blob/Postgres costs at scale
- 10s timeout on Hobby (tight for large sheet reads)
- Need to handle GAS-to-Vercel migration

**Cost:** $0 (Hobby) → $20/mo (Pro)

### Option D: Supabase Backend

**What:** Supabase (PostgreSQL + auth + storage) handles all backend logic. Frontend talks directly to Supabase (Row Level Security for multi-tenancy). Google Sheets becomes a read-only export/backup.

**Pros:**
- True multi-tenancy via Row Level Security (RLS)
- Real-time subscriptions (WebSockets)
- Built-in auth, storage, edge functions
- No sheetId exposure (RLS per customer)
- 500MB free DB

**Cons:**
- Major migration from Sheets → SQL
- Non-trivial — RLS policies, schema design, migration script
- Google Sheets as backup only (loses the "admin can edit data in Sheets" advantage)

**Cost:** $0 (Free tier: 500MB DB, 5GB bandwidth, 50K monthly active users) → $25/mo (Pro)

### Comparison Matrix

| Feature | GAS-only | Cloudflare + GAS | Vercel Edge + GAS | Vercel Node API | Supabase |
|---------|----------|-----------------|-------------------|-----------------|----------|
| **Origin enforcement** | ⚠️ Unreliable | ✅ Strong | ✅ Strong | ✅ Strong | ✅ RLS |
| **Rate limiting** | ❌ None | ✅ Worker | ✅ Vercel WAF | ✅ Express | ✅ PG + RLS |
| **Tier management** | Master Sheet | KV Store | Edge Config | Env vars / DB | PG RLS |
| **Scalability** | ~2K reqs/day | ~100K reqs/day | ~100K reqs/day | ~100K reqs/day | ~500K reqs/day |
| **Cold start** | ~1s (first req of exec) | ~0ms (Isolates) | ~50-200ms | ~200ms-1s | ~0ms (live) |
| **Data mutability** | Sheets (editable) | Sheets | Sheets | Sheets/SQL | SQL only |
| **Migration effort** | None | ~2 days | ~2 days | ~2-4 weeks | ~2-4 weeks |
| **Cost at scale** | $0-12/mo | $0-5/mo | $0-20/mo | $20+/mo | $0-25/mo |

---

## Summary of Recommendations

### Do Now (0–50 customers)

1. **Implement the master config sheet** with in-memory caching (per-execution global variable). The 1s penalty on first cold request per execution is acceptable.
2. **DO NOT use Origin as the sole auth mechanism.** Implement it as a defense-in-depth layer with clear fallbacks:
   - Origin check → primary gate
   - `X-LITEVM-Token` in wrapper.gs calls → bypass for bound-script requests
   - All no-Origin requests → BLOCK with logging + monitoring
3. **Compute monthly visitor counts from data** — no counter maintenance, no reset triggers, always accurate.
4. **Immediate tier upgrade** — read from master config per request, no cooldown period.
5. **Handle your own deployment (knyf3.github.io)** via a reserved sheetId in the master config with unlimited tier.

### Do Soon (50–200 customers)

6. **Add a Cloudflare Worker** as a caching proxy for GET endpoints. Cuts GAS load by 40–60%.
7. **Upgrade to Google Workspace** for higher GAS quotas when daily requests exceed 2,000.
8. **Batch writes** in the auto-sign-out trigger to avoid the per-row write bottleneck.

### Do When Growing (200+ customers)

9. **Begin hybrid migration** — move registration to Node.js/Supabase, keep reads on GAS.
10. **Consider Supabase** for full migration — RLS + real-time + no quotas wins at scale.

### What NOT to Do

- ❌ **Don't open the master config sheet on every request** — use the in-memory cache pattern
- ❌ **Don't rely on Origin for critical security** — it's a deterrence layer, not auth
- ❌ **Don't use counter triggers with monthly reset** — compute from data, it's simpler and more reliable
- ❌ **Don't force multi-subdomain customers to redeploy** — configurable allowedOrigins solves this
- ❌ **Don't let the "evil path" block the architecture** — the master config approach is pragmatic and sufficient for 100+ customers with proper caching
