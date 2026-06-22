# Destination Dropdown — UX Design for LITEVM Visitor Registration

---

## Table of Contents

1. [User Flow Diagram](#1-user-flow-diagram)
2. [Mobile Wireframes](#2-mobile-wireframes)
3. [UX Decisions Document](#3-ux-decisions-document)

---

## 1. User Flow Diagram

The following ASCII diagram shows the complete registration flow with the new Destination dropdown integrated into Step 1.

```
┌─────────────────────────────────────────────────────────────────┐
│                    REGISTRATION ENTRANCE                         │
│              (Mobile Web / QR Code / Direct Link)                │
└──────────────────────────┬──────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│  STEP 1: PERSONAL DETAILS                                        │
│                                                                  │
│  ┌─────────────────────────────────────────────────────────┐     │
│  │  Progress: [1● Details]────[2 Photos]────[3 Submit]     │     │
│  │                                         ┌─────────────┐ │     │
│  │  ┌─ Full Name ──────────────────────────│   👤 Name   │─│─┐   │
│  │  │              [__________]            └─────────────┘ │ │   │
│  │  ├─ ID/Passport ────────────────────────────────────────┤ │   │
│  │  │              [__________]                            │ │   │
│  │  ├─ Company ────────────────────────────────────────────┤ │   │
│  │  │              [__________]                            │ │   │
│  │  ├─ Destination ── NEW ─────────────────────────────────┤ │   │
│  │  │              [Select destination  ▼]                 │ │   │
│  │  ├─ Phone ──────────────────────────────────────────────┤ │   │
│  │  │              [__________]                            │ │   │
│  │  └──────────────────────────────────────────────────────┘ │   │
│  │                                              ┌──────────┐ │   │
│  │  [Continue ──→ Photos]                       │ Disabled │ │   │
│  │  (fill all fields to continue)               └──────────┘ │   │
│  └─────────────────────────────────────────────────────────────┘   │
│                                                                  │
│  WHEN ALL FIELDS VALID (incl. Destination selected):             │
│  ┌─────────────────────────────────────────────────────────┐     │
│  │ [Continue ──→ Photos]  ← Enabled, tap to proceed        │     │
│  └─────────────────────────────────────────────────────────┘     │
└──────────────────────────┬──────────────────────────────────────┘
                           │  validateStep1() passes
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│  STEP 2: PHOTOS                                                  │
│                                                                  │
│  ┌─────────────────────────────────────────────────────────┐     │
│  │  Progress: [✓ Details]───[2● Photos]───[3 Submit]       │     │
│  │                         ┌────────────┐ ┌────────────┐   │     │
│  │  [Open Camera] [Upload] │ ID Photo   │ │ Selfie     │   │     │
│  │                         │ [Capture]  │ │ [Capture]  │   │     │
│  │                         └────────────┘ └────────────┘   │     │
│  │  [Review & Submit]  ← Disabled until both photos done    │     │
│  └─────────────────────────────────────────────────────────┘     │
└──────────────────────────┬──────────────────────────────────────┘
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│  STEP 3: REVIEW & SUBMIT                                         │
│                                                                  │
│  ┌─────────────────────────────────────────────────────────┐     │
│  │  Progress: [✓ Details]───[✓ Photos]───[3● Submit]       │     │
│  │                                                         │     │
│  │  ┌─ Personal Information ──── ─── ─── ──── ── [Edit] ─┐│     │
│  │  │  Full Name:    Ahmad bin Ismail                    ││     │
│  │  │  ID/Passport:  880101-01-1234                     ││     │
│  │  │  Company:      ABC Sdn Bhd                        ││     │
│  │  │  Destination:  PLN           ← NEW FIELD          ││     │
│  │  │  Phone:        +60 12-345 6789                    ││     │
│  │  └──────────────────────────────────────────────────┘│     │
│  │                                                         │     │
│  │  ┌── Photos ──────────────────────────────────────────┐│     │
│  │  │  [ID Photo ✓]     [Selfie ✓]                      ││     │
│  │  └──────────────────────────────────────────────────┘│     │
│  │                                                         │     │
│  │  ⚠ By submitting, you consent...                       │     │
│  │                                                         │     │
│  │  [Submit Registration]                                  │     │
│  └─────────────────────────────────────────────────────────┘     │
└──────────────────────────┬──────────────────────────────────────┘
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│  STEP 4: CONFIRMATION                                            │
│                                                                  │
│  ┌─────────────────────────────────────────────────────────┐     │
│  │                    ✅ (animated checkmark)               │     │
│  │              Registration Complete!                     │     │
│  │                                                         │     │
│  │  ┌── Your Visitor Number ─────────────────────────────┐ │     │
│  │  │              V-20250622-005                        │ │     │
│  │  └────────────────────────────────────────────────────┘ │     │
│  │                                                         │     │
│  │  📱 WhatsApp Notification                              │     │
│  │  You will receive your visitor number via WhatsApp...   │     │
│  │                                                         │     │
│  │  Next Steps:                                            │     │
│  │  1. Check your WhatsApp                                │     │
│  │  2. Show visitor number at entrance                    │     │
│  │  3. Guard will verify and grant access                 │     │
│  │                                                         │     │
│  │  [Done]                                                 │     │
│  └─────────────────────────────────────────────────────────┘     │
└─────────────────────────────────────────────────────────────────┘
```

### Edge Case Flows

```
                    ┌─ FETCH FAILS ───────────────────────────────┐
                    │                                             │
                    │  ⚠ Could not load destinations              │
                    │  ┌─────────────────────────────────┐        │
                    │  │ [Select destination ▼]          │        │
                    │  │ ────────────────────────────── │        │
                    │  │ ⚠ Failed to load options        │        │
                    │  │ [Tap to retry]                  │        │
                    │  └─────────────────────────────────┘        │
                    │  Continue button remains disabled            │
                    └─────────────────────────────────────────────┘

                    ┌─ NO DESTINATIONS ───────────────────────────┐
                    │                                             │
                    │  ⚠ No destinations available                 │
                    │  ┌─────────────────────────────────┐        │
                    │  │ [No destinations available  ▼]  │        │
                    │  │ ────────────────────────────── │        │
                    │  │ No options available            │        │
                    │  └─────────────────────────────────┘        │
                    │  Continue button disabled,                   │
                    │  hint text: "Contact reception for access"   │
                    └─────────────────────────────────────────────┘
```

---

## 2. Mobile Wireframes

### Screen A: Step 1 — Default State (Dropdown Closed)

```
┌──────────────────────────────────┐
│  ┌────────────────────────────┐  │
│  │  🏢  Visitor Registration │  │
│  │  Pre-register for entry    │  │
│  │  🔒 Guard Portal →        │  │
│  └────────────────────────────┘  │
│                                    │
│  ┌ 1 ●  ────  2  ────  3  ─┐   │
│  │ Details    Photos   Submit│   │
│  └──────────────────────────┘   │
│                                    │
│  ┌────────────────────────────┐  │
│  │ Your Details               │  │
│  │ Please fill in info below  │  │
│                                    │
│  │ Full Name                   │  │
│  │ ┌─────────────────────────┐ │  │
│  │ │👤 e.g. Ahmad bin Ismail│ │  │
│  │ └─────────────────────────┘ │  │
│                                    │
│  │ ID / Passport Number        │  │
│  │ ┌─────────────────────────┐ │  │
│  │ │📇 e.g. 880101-01-1234  │ │  │
│  │ └─────────────────────────┘ │  │
│                                    │
│  │ Company Name                │  │
│  │ ┌─────────────────────────┐ │  │
│  │ │🏢 e.g. ABC Sdn Bhd     │ │  │
│  │ └─────────────────────────┘ │  │
│                                    │
│  │ Destination  ⚡ NEW          │  │
│  │ ┌─────────────────────────┐ │  │
│  │ │📍 Select destination  ▼│ │  │
│  │ └─────────────────────────┘ │  │
│  │        field-hint:          │  │
│  │ Which office are you        │  │
│  │ visiting today?             │  │
│                                    │
│  │ Hand Phone Number           │  │
│  │ ┌─────────────────────────┐ │  │
│  │ │📞 e.g. +60 12-345 6789 │ │  │
│  │ └─────────────────────────┘ │  │
│  │ WhatsApp notification...    │  │
│  └────────────────────────────┘  │
│                                    │
│  ┌────────────────────────────┐  │
│  │  Continue ──→ Photos       │  │
│  │  (fill all fields to       │  │
│  │   continue)               │  │
│  │  [DISABLED — grey, 50%]   │  │
│  └────────────────────────────┘  │
│                                    │
│  ┌────────────────────────────┐  │
│  │🛡 Your info is secure...   │  │
│  └────────────────────────────┘  │
└──────────────────────────────────┘
```

### Screen B: Step 1 — Dropdown Open (Options Visible)

```
┌──────────────────────────────────┐
│                                   │
│  (header, progress bar,          │
│   previous fields same as above) │
│                                   │
│  │ Destination                   │
│  │ ┌─────────────────────────┐  │
│  │ │📍 Select destination  ▼│  │
│  │ └─────────────────────────┘  │
│  │ ┌─────────────────────────┐  │
│  │ │ BRI                     │  │
│  │ ├─────────────────────────┤  │
│  │ │ BNI                     │  │
│  │ ├─────────────────────────┤  │
│  │ │ BCA                     │  │
│  │ ├─────────────────────────┤  │
│  │ │ PL)                     │  │  ← keyboard nav: ↓ arrow moves
│  │ ├─────────────────────────┤  │     through items, Enter selects
│  │ │ Danantara               │  │
│  │ └─────────────────────────┘  │
│                                   │
│  (phone field, continue button   │
│   below)                         │
│                                   │
└──────────────────────────────────┘
```

### Screen C: Step 1 — Loading State (Fetching Destinations)

```
┌──────────────────────────────────┐
│                                   │
│  (header, progress bar,          │
│   previous fields)                │
│                                   │
│  │ Destination                   │
│  │ ┌─────────────────────────┐  │
│  │ │⏳ Loading destinations │  │
│  │ │   ┌───┐                │  │
│  │ │   │ ◌ │ (spinner)     │  │
│  │ │   └───┘                │  │
│  │ └─────────────────────────┘  │
│  │    Field is disabled         │
│  │    during load               │
│                                   │
│  (phone field, continue button   │
│   stays disabled)                │
│                                   │
└──────────────────────────────────┘
```

### Screen D: Step 1 — Error State (Fetch Failed)

```
┌──────────────────────────────────┐
│                                   │
│  (header, progress bar,          │
│   previous fields)                │
│                                   │
│  │ Destination                   │
│  │ ┌─────────────────────────┐  │
│  │ │⚠ Could not load        │  │
│  │ │ destinations            │  │
│  │ └─────────────────────────┘  │
│  │                            │  │
│  │ field-error (visible):      │  │
│  │ ⛔ Connection issue.       │  │
│  │ [Tap to retry]            │  │
│                                   │
│  (phone field, continue button   │
│   stays disabled)                │
│                                   │
│  Note: User CAN still fill       │
│  other fields while dest. is     │
│  in error state. Continue btn    │
│  stays disabled until dest.      │
│  is resolved.                    │
│                                   │
└──────────────────────────────────┘
```

### Screen E: Step 3 — Review with Destination

```
┌──────────────────────────────────┐
│  ← Back                          │
│  ┌────────────────────────────┐  │
│  │  Review & Submit           │  │
│  └────────────────────────────┘  │
│                                    │
│  ┌ ✓  ────  ✓  ────  3●  ─┐   │
│  │ Details   Photos   Submit│   │
│  └──────────────────────────┘   │
│                                    │
│  ┌────────────────────────────┐  │
│  │ Confirm Your Details       │  │
│  │ Please review before       │  │
│  │ submitting.                │  │
│                                    │
│  │ ┌─ Personal Info ────[Edit]┐ │  │
│  │ │ Full Name        Ahmad   │ │  │
│  │ │ ─────────────────────── │ │  │
│  │ │ ID/Passport      880101 │ │  │
│  │ │ ─────────────────────── │ │  │
│  │ │ Company          ABC    │ │  │
│  │ │ ─────────────────────── │ │  │
│  │ │ Destination      PLN    │ │  │  ← NEW FIELD
│  │ │ ─────────────────────── │ │  │
│  │ │ Phone          +60...   │ │  │
│  │ └─────────────────────────┘ │  │
│  │                             │  │
│  │ (Photos preview)            │  │
│  │ (Consent notice)            │  │
│  │                             │  │
│  │ [Submit Registration]       │  │
│  └────────────────────────────┘  │
└──────────────────────────────────┘
```

---

## 3. UX Decisions Document

### 3.1 Form Position Recommendation

**Recommendation: Destination goes between Company and Phone.**

```
Current order:  Full Name → ID/Passport → Company → Phone
New order:      Full Name → ID/Passport → Company → Destination → Phone
```

**Rationale:**
- **Logical grouping**: Company and Destination are both "work context" fields — *who* you work for and *where* you're going. Booking systems universally group destination after origin/company context.
- **Visual rhythm**: The four text-input fields (Name, ID, Company, Phone) benefit from a "visual break" — a dropdown between Company and Phone prevents the form from being an endless wall of text inputs.
- **Phone separation**: Phone stays at the bottom because it has a hint text ("WhatsApp notification") and is the last field before the Continue button, maintaining the existing visual hierarchy.
- **Thumb reach**: On a mobile device (320-480px), the dropdown is right at thumb-center when held naturally, making it easy to tap.

### 3.2 Validation Rules

| Rule | Implementation |
|------|---------------|
| **Required** | Yes. Destination is mandatory. |
| **Must select a value** | The default "Select destination" option has `value=""`, making it invalid. Only a real selection passes validation. |
| **Dependency on other fields** | None. Destination is validated independently of other fields. |
| **Continue button logic** | The existing `updateContinueButton()` function must be extended to check destination validity alongside the four text fields. Button enables only when ALL five fields (name, id, company, destination, phone) pass validation. |
| **Blur validation** | On blur, if no selection made, show error: "Please select a destination." |
| **Input/change validation** | On `change` event, if a valid option is selected, clear error and mark field valid. |
| **Error text** | "Please select a destination" (shown in `.field-error` below dropdown, same pattern as other fields). |
| **Hint text** | "Which office are you visiting today?" (shown in `.field-hint` below the error area). |

**Validation flow in code:**
```javascript
// Add to validators object in app.js
destination: function (val) {
  if (!val || val.trim() === '') return 'Please select a destination';
  return '';
}
```

### 3.3 Loading State Design

**Trigger:** On page load (init) of the registration page, before the form is shown.

**Implementation:**
1. The `<select>` element starts with one `<option>`: `"⏳ Loading destinations..."` with `disabled selected value=""`.
2. The select element is disabled during loading to prevent user interaction.
3. A fetch to `CONFIG.API_BASE + '?action=destinations'` is initiated.
4. Visual: The select uses the standard `.form-input` style but with a subtle spinner/animated indicator.

**HTML pattern:**
```html
<div class="field-group" id="field-destination">
  <label for="destination" class="field-label">Destination</label>
  <div class="input-wrapper">
    <svg class="input-icon" viewBox="..." width="18" height="18">
      <!-- Map pin icon -->
    </svg>
    <select id="destination" name="destination" class="form-input" required
            aria-describedby="destination-error destination-hint"
            disabled>
      <option value="" disabled selected>Loading destinations...</option>
    </select>
  </div>
  <p id="destination-error" class="field-error" role="alert"></p>
  <p id="destination-hint" class="field-hint">Which office are you visiting today?</p>
</div>
```

**After load success:**
1. Enable the select
2. Replace the loading option with `"Select destination"` (value="", disabled selected)
3. Populate each destination as `<option value="BRI">BRI</option>`, etc.
4. The `change` event triggers validation

**Timeout behavior:** If fetch takes > 8 seconds (shorter than submit timeout), move to error state.

### 3.4 Error State Design (Fetch Failure)

**What happens:** If the `?action=destinations` fetch fails (network error, server error, timeout).

**Visual:**
- The select remains disabled.
- The loading option is replaced with `"⚠ Could not load destinations"` (disabled, selected).
- The `.field-error` element shows: `"Connection issue. Tap to retry."` with a clickable "Tap to retry" link.
- The `.field-hint` changes to: `"Make sure you have internet and try again."`

**Retry mechanism:**
- A "Tap to retry" link in the error text is clickable.
- Clicking it re-fetches the destinations.
- The select goes back to "⏳ Loading destinations..." state during retry.
- Max 3 retries, then show a more permanent error: "Unable to load. Contact reception at [number]."

**Integration with Continue button:**
- Continue button remains disabled until destination is validly selected.
- Other fields CAN be filled while destination is in error state — no reason to block the whole form for a failed dropdown load.

**Accessible error handling:**
- Error message uses `role="alert"` (via the existing `.field-error[role="alert"]` pattern).
- A `aria-live="polite"` region on the select wrapper announces state changes.
- Retry button is an actual `<button>` or `<a>` with `role="button"`, not just text.

### 3.5 Accessibility

| Concern | Solution |
|---------|----------|
| **Keyboard navigation** | Use a native `<select>` element — it inherently supports arrow keys, type-ahead find, and Enter/Space to open options. No custom dropdown widget needed, which preserves OS-level accessibility. |
| **Screen reader labels** | `<label for="destination">` explicitly associates the label. `aria-describedby="destination-error destination-hint"` links the describedby to both error and hint messages. |
| **Loading announcement** | Use `aria-live="polite"` on a hidden span that updates when loading starts/completes: "Loading destinations" / "Destinations loaded" / "Failed to load destinations". |
| **Error announcement** | The existing `role="alert"` on `.field-error` will be read automatically when `.visible` class is added. |
| **Touch targets** | The native select on mobile opens the OS picker wheel — minimum 44px height (use same padding as `.form-input`: 12px top/bottom, bringing it to ~44px total). |
| **Focus indicator** | Same as `.form-input:focus` — `border-color: #4361ee; box-shadow: 0 0 0 3px rgba(67, 97, 238, 0.12)`. The `appearance: none` CSS already removes the default arrow, so we need to add a custom chevron. |
| **Custom chevron** | Add a downward chevron SVG as a pseudo-element or background-image on the select, positioned at the right. Without it, the `appearance: none` makes the select look indistinguishable from a text input. |
| **Voice control** | Native `<select>` has built-in support for voice control ("tap destination", "choose BRI"). |

### 3.6 Edge Cases

#### Case 1: No destinations available (empty array from API)

```
┌──────────────────────────────┐
│ Destination                  │
│ ┌──────────────────────────┐│
│ │📍 No destinations avail ││
│ └──────────────────────────┘│
│ ⚠ Contact reception        │
│   for access                │
└──────────────────────────────┘
```

- The select shows a single disabled option "No destinations available".
- The `.field-error` shows "No destinations configured. Contact reception for access."
- Continue button remains disabled.
- This is a blocking state — pre-registration cannot proceed without a destination. The user sees this error path early rather than being surprised at submission.

#### Case 2: User refreshes the page

- On page reload, `init()` re-fetches destinations from scratch.
- If the user had filled in other fields, those are lost (the form is not persisted).
- This is acceptable behavior matching existing UX — photos are also lost on refresh.
- No sessionStorage or localStorage persistence is needed for this feature, matching the existing pattern.

#### Case 3: User navigates back from Step 2 to Step 1

- `goToStep(1)` already calls `stopAllCameras()` and shows Step 1.
- The Destination dropdown retains its selected value because the DOM isn't recreated on back-navigation — it's hidden/reshown via `step.active`.
- The Continue button state recalculates correctly via `updateContinueButton()` which checks all fields.
- No special handling needed.

#### Case 4: Very long destination names

- The destinations are all short (3-12 chars: BRI, BNI, BCA, PLN, Danantara).
- If the Google Sheet is updated with longer names (e.g., "PT Pertamina (Persero)"), the native `<select>` handles overflow with ellipsis if needed.
- Add `text-overflow: ellipsis; overflow: hidden; white-space: nowrap;` to the select to be safe.

#### Case 5: Concurrent requests

- Add a loading flag (`state.destinationsLoading`) to prevent duplicate fetches.
- If the user navigates away and back quickly, abort the previous AbortController if one exists.

#### Case 6: Offline mode

- The offline banner already exists.
- The fetch for destinations fails silently (caught in `.catch`).
- Error state is shown.
- When the user comes back online, they must tap "Retry" — no auto-retry to avoid unexpected network bursts.
- The `navigator.onLine` event could trigger a retry attempt, but for simplicity and predictability, manual retry is preferred.

### 3.7 CSS Additions Required

New CSS classes needed in `styles.css`:

```css
/* --- Custom Select (Dropdown) --- */
.form-select {
  width: 100%;
  padding: 12px 36px 12px 40px;  /* extra right padding for chevron */
  font-size: 0.9375rem;
  font-family: 'Inter', -apple-system, sans-serif;
  color: #1E293B;
  background: #F8FAFC;
  border: 1.5px solid #E2E8F0;
  border-radius: 8px;
  outline: none;
  transition: border-color 0.2s, box-shadow 0.2s;
  -webkit-appearance: none;
  appearance: none;
  cursor: pointer;
  /* Custom chevron via background SVG */
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' width='18' height='18' fill='none' stroke='%2364748B' stroke-width='1.5' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpolyline points='6 9 12 15 18 9'/%3E%3C/svg%3E");
  background-repeat: no-repeat;
  background-position: right 10px center;
  background-size: 18px;
}

.form-select:focus {
  border-color: #4361ee;
  box-shadow: 0 0 0 3px rgba(67, 97, 238, 0.12);
}

.form-select.error {
  border-color: #e63946;
  box-shadow: 0 0 0 3px rgba(230, 57, 70, 0.1);
}

.form-select.valid {
  border-color: #16A34A;
}

.form-select:disabled {
  opacity: 0.5;
  cursor: not-allowed;
  background-color: #F1F5F9;
}

/* Override default OS specific styles */
.form-select option {
  color: #1E293B;
  background: #FFFFFF;
  padding: 8px;
}

.form-select optgroup {
  font-weight: 600;
  color: #475569;
}
```

### 3.8 JavaScript Changes Required

**In `app.js`:**

1. **State additions:**
```javascript
destinations: [],              // Array from API
destinationsLoading: false,    // Loading flag
destinationsError: null,       // Error message or null
selectedDestination: '',       // Selected value
```

2. **Init update:**
```javascript
function init() {
  checkOnlineStatus();
  setupFormValidation();
  fetchDestinations();      // NEW: fetch destinations on init
  updateContinueButton();
  showStep(1);
}
```

3. **New function: `fetchDestinations()`:**
```javascript
function fetchDestinations() {
  if (state.destinationsLoading) return;
  state.destinationsLoading = true;
  state.destinationsError = null;

  var select = document.getElementById('destination');
  var errorEl = document.getElementById('destination-error');
  var hintEl = document.getElementById('destination-hint');
  if (!select) return;

  select.disabled = true;
  select.innerHTML = '<option value="" disabled selected>Loading destinations...</option>';
  if (errorEl) { errorEl.textContent = ''; errorEl.classList.remove('visible'); }
  if (hintEl) hintEl.textContent = 'Loading available offices...';

  fetch(CONFIG.API_BASE + '?action=destinations')
    .then(function (res) { return res.text(); })
    .then(function (text) {
      state.destinationsLoading = false;
      var data;
      try { data = JSON.parse(text); } catch (e) { throw new Error('Invalid JSON response'); }
      if (data.status !== 'ok') throw new Error(data.message || 'Server error');

      state.destinations = data.destinations || [];
      if (state.destinations.length === 0) {
        renderDestinationsEmpty(select, errorEl, hintEl);
      } else {
        renderDestinations(select, errorEl, hintEl);
      }
      select.disabled = false;
      updateContinueButton();
    })
    .catch(function (err) {
      state.destinationsLoading = false;
      state.destinationsError = err.message || 'Failed to load destinations';
      renderDestinationsError(select, errorEl, hintEl);
    });
}

function renderDestinations(select, errorEl, hintEl) {
  select.innerHTML = '<option value="" disabled selected>Select destination</option>' +
    state.destinations.map(function (d) {
      var val = d.Pertamina || '';
      return '<option value="' + escapeHtml(val) + '">' + escapeHtml(val) + '</option>';
    }).join('');
  if (hintEl) hintEl.textContent = 'Which office are you visiting today?';
}

function renderDestinationsEmpty(select, errorEl, hintEl) {
  select.innerHTML = '<option value="" disabled selected>No destinations available</option>';
  if (errorEl) {
    errorEl.textContent = 'No destinations configured. Contact reception for access.';
    errorEl.classList.add('visible');
  }
  if (hintEl) hintEl.textContent = '';
}

function renderDestinationsError(select, errorEl, hintEl) {
  select.innerHTML = '<option value="" disabled selected>⚠ Could not load destinations</option>';
  if (errorEl) {
    errorEl.innerHTML = 'Connection issue. <a href="#" onclick="App.retryFetchDestinations();return false;" role="button">Tap to retry</a>.';
    errorEl.classList.add('visible');
  }
  if (hintEl) hintEl.textContent = 'Make sure you have internet and try again.';
}

function retryFetchDestinations() {
  var errorEl = document.getElementById('destination-error');
  if (errorEl) { errorEl.textContent = ''; errorEl.classList.remove('visible'); }
  fetchDestinations();
}

function escapeHtml(str) {
  var div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}
```

4. **Validation update:**
Add `destination` to the `validators` object and the `fields` array:
```javascript
destination: function (val) {
  if (!val || val.trim() === '') return 'Please select a destination';
  return '';
}
```

And in `setupFormValidation`, add a `change` event listener for the destination select.

5. **`updateContinueButton()` update:**
```javascript
function updateContinueButton() {
  var data = getFormData();
  var btn = document.getElementById('btn-step1-continue');
  if (!btn) return;

  var dest = document.getElementById('destination');
  var destVal = dest ? dest.value : '';

  var allValid =
    validators.fullName(data.fullName) === '' &&
    validators.idNumber(data.idNumber) === '' &&
    validators.company(data.company) === '' &&
    validators.destination(destVal) === '' &&
    validators.phone(data.phone) === '';

  // ... existing enable/disable logic
}
```

6. **`getFormData()` update:**
```javascript
function getFormData() {
  var dest = document.getElementById('destination');
  return {
    fullName: document.getElementById('fullName').value,
    idNumber: document.getElementById('idNumber').value,
    company: document.getElementById('company').value,
    destination: dest ? dest.value : '',
    phone: document.getElementById('phone').value,
  };
}
```

7. **`populateReview()` update:**
```javascript
function populateReview() {
  var data = getFormData();
  document.getElementById('review-name').textContent = data.fullName || '—';
  document.getElementById('review-id').textContent = data.idNumber || '—';
  document.getElementById('review-company').textContent = data.company || '—';
  document.getElementById('review-destination').textContent = data.destination || '—';  // NEW
  document.getElementById('review-phone').textContent = data.phone || '—';
  // ... existing photo review logic
}
```

8. **`submitRegistration()` update — payload:**
```javascript
var payload = {
  fullName: data.fullName.trim(),
  idNumber: data.idNumber.trim(),
  company: data.company.trim(),
  destination: data.destination.trim(),  // NEW
  phone: data.phone.trim(),
  idPhoto: state.idPhoto.dataUrl,
  selfie: state.selfiePhoto.dataUrl,
};
```

### 3.9 HTML Changes Required (index.html)

1. **Add the Destination field** between Company and Phone in the `<form id="details-form">`:

```html
<!-- Company --> (existing)

<!-- Destination — NEW -->
<div class="field-group" id="field-destination">
  <label for="destination" class="field-label">Destination</label>
  <div class="input-wrapper">
    <svg class="input-icon" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="#64748B" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
      <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z"/>
      <circle cx="12" cy="10" r="3"/>
    </svg>
    <select id="destination" name="destination" class="form-select" required
            aria-describedby="destination-error destination-hint" disabled>
      <option value="" disabled selected>Loading destinations...</option>
    </select>
  </div>
  <p id="destination-error" class="field-error" role="alert"></p>
  <p id="destination-hint" class="field-hint">Which office are you visiting today?</p>
</div>

<!-- Phone --> (existing)
```

2. **Add review row in Step 3:**

```html
<!-- After Company review row, before Phone -->
<div class="review-divider"></div>
<div class="review-row">
  <span class="review-label">Destination</span>
  <span class="review-value" id="review-destination">—</span>
</div>
```

### 3.10 Backend Payload Update (Code.gs)

The `handleRegistration()` function in `Code.gs` needs to:
- Add `destination` to required fields validation
- Add it to the `sheet.appendRow()` call (column 10 — shift Action Time to column 11)
- OR add it before Status as column 9 and shift existing columns

Updated sheet headers:
```javascript
var headers = [
  'Timestamp',
  'Full Name',
  'ID / Passport Number',
  'Company Name',
  'Destination',           // NEW
  'Hand Phone',
  'ID Photo (Drive URL)',
  'Selfie (Drive URL)',
  'Visitor Number',
  'Status',
  'Action Time'
];
```

### 3.11 Summary of Changes

| File | Change Type | Details |
|------|-------------|---------|
| `index.html` | Add field markup | Destination select between Company and Phone; review row in Step 3 |
| `app.js` | Add logic | `fetchDestinations()`, validation, review population, submit payload |
| `styles.css` | Add styles | `.form-select` class with custom chevron, disabled/error/valid states |
| `Code.gs` | Add column | Destination column in sheet headers and appendRow |
| `config.js` | No change | API_BASE already used, no new config needed |

---

*Design prepared: 22 June 2026*
*For: LITEVM Visitor Registration System*