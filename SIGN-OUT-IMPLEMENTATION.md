# LITEVM — Sign-Out Feature Implementation Plan

## Architecture Decision Record

| Question | Decision | Rationale |
|----------|----------|-----------|
| New mode vs extend updateStatus? | **Extend `updateStatus`** — reuse existing `mode='updateStatus'` pattern; add `'Signed Out'` as a third valid status | Minimal code change, same API contract, no new route |
| LockService needed? | **No** — sign-out has no card pool interaction | LockService only guards card assignment concurrency |
| Guard: allow sign-out without prior Check-In? | **Reject** — only allow if current status is `'Checked In'` | Prevent invalid state transitions |
| Release card on sign-out? | **Skip for now** — the daily `releaseDailyCards()` trigger at 18:00 already releases all assigned cards | Keeps scope minimal; can be added later as a separate feature |
| Where to add the sign-out button? | **In `#result-actions`**, visible only when `status === 'Checked In'` | Reuses the existing found-state layout; no structural HTML changes |
| New success state needed? | **Yes** — add `#result-signed-out` state (parallel to `#result-verified` / `#result-rejected`) | Clear UX feedback that sign-out succeeded |
| Sign-out from Today's list? | **Skip** — sign-out requires looking up the checked-in visitor first | Minimal scope; guard does a search to find the visitor, then signs out |
| Expected sheet column for sign-out time | **Col 14 (1-indexed)** = `Sign-Out Time` — already exists, never written | No migration needed |

---

## Change 1: `Code.gs` — Backend

### 1a. Allow `'Signed Out'` as a valid status

**File:** `apps-script/Code.gs`  
**Function:** `handleStatusUpdate()`, around line 446

**Old (line 446):**
```javascript
  if (!newStatus || (newStatus !== 'Checked In' && newStatus !== 'Rejected')) {
    return jsonResponse({ status: 'error', message: 'Invalid status. Must be "Checked In" or "Rejected".' }, 400);
  }
```

**New:**
```javascript
  if (!newStatus || (newStatus !== 'Checked In' && newStatus !== 'Rejected' && newStatus !== 'Signed Out')) {
    return jsonResponse({ status: 'error', message: 'Invalid status. Must be "Checked In", "Rejected", or "Signed Out".' }, 400);
  }
```

### 1b. Skip LockService for sign-out

**Already handled** — LockService is only acquired when `newStatus === 'Checked In'`. Sign-out naturally bypasses it.

### 1c. Add guard check: only sign out if currently Checked In

**Insert after LockService block (around line 462), before the loop:**

```javascript
  // Guard: sign-out requires current status = Checked In
  if (newStatus === 'Signed Out') {
    var currentStatus = null;
    for (var si = 1; si < values.length; si++) {
      if (String(values[si][10] || '').trim() === visitorNumber.trim()) {
        currentStatus = String(values[si][11] || '').trim();
        break;
      }
    }
    if (currentStatus !== 'Checked In') {
      return jsonResponse({
        status: 'error',
        message: 'Cannot sign out — visitor status is "' + (currentStatus || 'Pending Entry') + '". Must be "Checked In".'
      }, 400);
    }
  }
```

### 1d. Write to correct column for sign-out

**Inside the loop, after the idempotency check (around line 478), update the timestamp write:**

**Old (lines 479-481):**
```javascript
        // Update Status column (col 12 = index 11)
        sheet.getRange(i + 1, 12).setValue(newStatus);
        // Update Sign-In Time column (col 13 = index 12) to record when check-in/rejection happened
        sheet.getRange(i + 1, 13).setValue(new Date());
```

**New:**
```javascript
        // Update Status column (col 12 = index 11)
        sheet.getRange(i + 1, 12).setValue(newStatus);

        if (newStatus === 'Signed Out') {
          // Write to Sign-Out Time column (col 14 = index 13)
          sheet.getRange(i + 1, 14).setValue(new Date());
        } else {
          // Write to Sign-In Time column (col 13 = index 12) — for check-in or rejection
          sheet.getRange(i + 1, 13).setValue(new Date());
        }
```

### 1e. Skip card assignment for sign-out

**Already handled** — card assignment only runs when `newStatus === 'Checked In'` (line 490). Sign-out naturally skips it.

### 1f. Return signOutTime in response (for frontend display)

**No change needed** — the existing return object already has no card assignment for non-Checked-In statuses, and the frontend will handle the Signed Out display.

---

## Change 2: `verify.js` — Frontend Logic

### 2a. Add `confirmSignOut()` function

**File:** `verify.js`  
**Add after `confirmReject()` (around line 384):**

```javascript
  function confirmSignOut() {
    if (!state.currentVisitor) return;
    showConfirmDialog('sign-out');
  }
```

### 2b. Add `'sign-out'` path to `showConfirmDialog()`

**In `showConfirmDialog()` (around line 397), extend the type check:**

**Add before or within the if/else block:**

```javascript
    if (type === 'sign-out') {
      icon.innerHTML = '<svg viewBox="0 0 24 24" width="36" height="36" fill="none" stroke="#F59E0B" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>';
      title.textContent = 'Confirm Sign-Out';
      msg.innerHTML = 'Are you sure you want to sign out <strong>' + (v.fullName || 'this visitor') + '</strong>?';
      actionBtn.textContent = 'Confirm Sign-Out';
      actionBtn.className = 'btn-confirm-action btn-confirm-signout';
      reasonSection.classList.add('hidden');
    } else if (type === 'reject') {
      // ... existing code
```

> Note: The existing if/else chain at line 397 is already structured as `if (type === 'reject') { ... } else { ... }` for check-in. The sign-out check must be inserted **before** the reject check, or the chain restructured as `if (type === 'sign-out') { ... } else if (type === 'reject') { ... } else { ... }`.

### 2c. Extend `executeAction()` to handle `'sign-out'`

**In `executeAction()` (around line 424), update the mapping:**

**Old (line 427):**
```javascript
    var status = type === 'reject' ? 'Rejected' : 'Checked In';
```

**New:**
```javascript
    var status;
    if (type === 'sign-out') {
      status = 'Signed Out';
    } else if (type === 'reject') {
      status = 'Rejected';
    } else {
      status = 'Checked In';
    }
```

### 2d. Add `showSignedOutState()` success view

**Add after `showRejectedState()` (around line 569):**

```javascript
  // ──────────────────────────────────────────────
  // SIGNED OUT STATE
  // ──────────────────────────────────────────────
  function showSignedOutState(v) {
    setResultState('signed-out');
    $('#signed-out-name').textContent = v.fullName || '';
    var now = new Date();
    $('#signed-out-time').textContent = formatTimestamp(now);

    // Update state
    if (state.currentVisitor) state.currentVisitor.status = 'Signed Out';
  }
```

### 2e. Handle `'Signed Out'` in `updateStatus()` success branch

**In `updateStatus()` (around line 472), extend the status check:**

**Old (lines 472-483):**
```javascript
      if (data.status === 'ok') {
        if (status === 'Checked In') {
          showVerifiedSuccess(state.currentVisitor, {
            cardNo: data.cardNo,
            cardQRUrl: data.cardQRUrl,
            cardStatus: data.cardStatus
          });
        } else {
          showRejectedState(state.currentVisitor);
        }
        // Refresh today's list
        loadTodayVisitors();
      }
```

**New:**
```javascript
      if (data.status === 'ok') {
        if (status === 'Checked In') {
          showVerifiedSuccess(state.currentVisitor, {
            cardNo: data.cardNo,
            cardQRUrl: data.cardQRUrl,
            cardStatus: data.cardStatus
          });
        } else if (status === 'Signed Out') {
          showSignedOutState(state.currentVisitor);
        } else {
          showRejectedState(state.currentVisitor);
        }
        // Refresh today's list
        loadTodayVisitors();
      }
```

### 2f. Show sign-out button when status is 'Checked In'

**In `showVisitor()` (around line 315-330), update the action buttons / processed info logic:**

**Old (lines 314-330):**
```javascript
    // Action buttons visibility
    var actions = $('#result-actions');
    var processed = $('#result-processed-info');
    if (status === 'Pending Entry') {
      actions.classList.remove('hidden');
      processed.classList.add('hidden');
      $('#btn-verify').disabled = false;
      $('#btn-reject').disabled = false;
    } else {
      actions.classList.add('hidden');
      processed.classList.remove('hidden');
      if (status === 'Checked In') {
        $('#processed-info-text').textContent = 'This visitor has already checked in. (Status: Checked In)';
      } else if (status === 'Rejected') {
        $('#processed-info-text').textContent = 'This registration was previously rejected. (Status: Rejected)';
      }
    }
```

**New:**
```javascript
    // Action buttons visibility
    var actions = $('#result-actions');
    var processed = $('#result-processed-info');
    var signOutBtn = $('#btn-sign-out');
    if (status === 'Pending Entry') {
      actions.classList.remove('hidden');
      processed.classList.add('hidden');
      $('#btn-verify').disabled = false;
      $('#btn-reject').disabled = false;
      if (signOutBtn) signOutBtn.style.display = 'none';
    } else if (status === 'Checked In') {
      // Show sign-out button, hide check-in/reject
      actions.classList.remove('hidden');
      processed.classList.add('hidden');
      $('#btn-verify').style.display = 'none';
      $('#btn-reject').style.display = 'none';
      if (signOutBtn) signOutBtn.style.display = '';
    } else {
      actions.classList.add('hidden');
      processed.classList.remove('hidden');
      if (status === 'Rejected') {
        $('#processed-info-text').textContent = 'This registration was previously rejected. (Status: Rejected)';
      } else if (status === 'Signed Out') {
        $('#processed-info-text').textContent = 'This visitor has already signed out. (Status: Signed Out)';
      } else {
        $('#processed-info-text').textContent = 'This visitor has already been processed. (Status: ' + status + ')';
      }
    }
```

### 2g. Expose new functions in public API

**In the `window.App` object (around line 941), add:**

```javascript
    confirmSignOut: confirmSignOut,
```

---

## Change 3: `verify.html` — Frontend HTML

### 3a. Add sign-out button in action buttons

**In `verify.html`, inside `#result-actions` (after `#btn-reject` at line 175), add:**

```html
            <button class="btn-sign-out hidden" id="btn-sign-out" onclick="App.confirmSignOut()" aria-label="Sign out visitor" style="display:none">
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
              Sign Out
            </button>
```

### 3b. Add signed-out success state

**In `verify.html`, inside `#lookup-result-section` (after `#result-rejected` at line 269), add:**

```html
      <!-- SIGNED OUT STATE -->
      <div id="result-signed-out" class="result-state">
        <div class="result-signed-out-card">
          <div class="signed-out-icon">
            <svg viewBox="0 0 24 24" width="56" height="56" fill="none" stroke="#F59E0B" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
              <circle cx="12" cy="12" r="10" fill="#FFFBEB" stroke="#F59E0B" stroke-width="2"/>
              <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/>
              <polyline points="16 17 21 12 16 7"/>
              <line x1="21" y1="12" x2="9" y2="12"/>
            </svg>
          </div>
          <h2 class="signed-out-title">Sign-Out Successful!</h2>
          <p class="signed-out-name" id="signed-out-name">—</p>
          <p class="signed-out-subtitle">has been signed out.</p>
          <div class="signed-out-timestamp-card" id="signed-out-timestamp-card">
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
            <span>Signed out at: <strong id="signed-out-time">—</strong></span>
          </div>
          <button class="btn-primary btn-check-another" onclick="App.checkInAnother()">
            <span>↩ Back to Search</span>
          </button>
        </div>
      </div>
```

### 3c. Register the new state in `setResultState()` mapping

**Small note:** The frontend's `setResultState()` in verify.js already maps state names to element IDs. Add the new mapping entry so `setResultState('signed-out')` shows the right element.

**In `setResultState()` (around line 351), add to the `map` object:**

```javascript
      'signed-out': 'result-signed-out',
```

---

## Change 4: CSS / Styles (verify.html's linked `styles.css`)

Add styles for the sign-out button and signed-out success state. These can go in the existing `styles.css` referenced by verify.html.

### Sign-out button class (amber/yellow theme to differentiate from green verify and red reject):

```css
.btn-sign-out {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  width: 100%;
  padding: 14px 20px;
  border: none;
  border-radius: 12px;
  font-family: inherit;
  font-size: 15px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s ease;
  color: #fff;
  background: #F59E0B;
}
.btn-sign-out:hover {
  background: #D97706;
}
.btn-sign-out:active {
  transform: scale(0.98);
}
```

### Signed-out success state (amber theming):

```css
.result-signed-out-card {
  text-align: center;
  padding: 32px 24px;
}
.signed-out-icon {
  margin-bottom: 16px;
}
.signed-out-title {
  font-size: 22px;
  font-weight: 700;
  color: #1E293B;
  margin: 0 0 8px 0;
}
.signed-out-name {
  font-size: 18px;
  font-weight: 600;
  color: #4361EE;
  margin: 0;
}
.signed-out-subtitle {
  font-size: 14px;
  color: #64748B;
  margin: 4px 0 16px 0;
}
.signed-out-timestamp-card {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 8px 16px;
  background: #FFFBEB;
  border: 1px solid #FDE68A;
  border-radius: 8px;
  font-size: 13px;
  color: #92400E;
  margin-bottom: 20px;
}
```

### Confirm dialog sign-out action button:

```css
.btn-confirm-signout {
  background: #F59E0B;
  color: #fff;
}
.btn-confirm-signout:hover {
  background: #D97706;
}
```

---

## Summary of All Changes

| File | Type | Description | Lines Changed |
|------|------|-------------|---------------|
| `Code.gs` | Edit | Allow `'Signed Out'` in valid status check | 1 line |
| `Code.gs` | Edit | Add guard check: reject sign-out if not Checked In | ~8 lines |
| `Code.gs` | Edit | Write Sign-Out Time to col 14 instead of col 13 | ~4 lines |
| `verify.js` | Add | `confirmSignOut()` function | ~4 lines |
| `verify.js` | Edit | Add `'sign-out'` path in `showConfirmDialog()` | ~6 lines |
| `verify.js` | Edit | Extend `executeAction()` to map `'sign-out'` → `'Signed Out'` | ~7 lines |
| `verify.js` | Add | `showSignedOutState()` function | ~8 lines |
| `verify.js` | Edit | Handle `'Signed Out'` in `updateStatus()` success branch | ~3 lines |
| `verify.js` | Edit | Show sign-out button when status is `'Checked In'` | ~15 lines |
| `verify.js` | Edit | Add `'signed-out'` to `setResultState()` map | 1 line |
| `verify.js` | Edit | Expose `confirmSignOut` in public API | 1 line |
| `verify.html` | Add | Sign-out button in `#result-actions` | ~7 lines |
| `verify.html` | Add | `#result-signed-out` success state block | ~25 lines |
| `styles.css` | Add | `.btn-sign-out`, `.result-signed-out-card*`, `.btn-confirm-signout` styles | ~40 lines |

**Total estimated lines added/changed: ~130 lines** across 4 files.

---

## Rollout Order

1. **No deployment needed for Code.gs** — it's part of the Google Apps Script Web App bound script. Deploy a new version of the Web App.
2. **Deploy frontend files** (verify.html, verify.js, styles.css) to hosting (GitHub Pages, static hosting, or wherever the frontend is served).
3. **Test flow**: Search a checked-in visitor → see Sign Out button → confirm → verify sign-out time written to col 14.
4. **Test edge case**: Search a pending visitor → no sign-out button shown. Search an already signed-out visitor → shows "already signed out" message.
