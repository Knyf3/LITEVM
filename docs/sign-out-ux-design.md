# LITEVM — Sign-Out UX Design Brief

**Status:** Design proposal  
**For:** Guard Portal (verify.html, verify.js)  
**Design philosophy:** Pragmatic, mobile-first, minimal new surface area  

---

## 1. When/Where Should the Sign-Out Button Appear?

**Recommendation: In the identity card's action bar, as a new button — but only for visitors whose status is "Checked In".**

| Visitor Status | What the guard sees in the action area |
|---|---|
| Pending Entry | Check In (green) + Reject (red) |
| **Checked In** | **Sign Out (amber/orange)** — replaces Check In |
| Rejected | "This registration was previously rejected" message (no action buttons) |

**Why only "Checked In"?**  
- If the visitor was never checked in, sign-out is meaningless — you can't leave what you never entered.
- If the visitor was already rejected, they're not on-site anyway.
- This creates a clear lifecycle: Pending → Checked In → Signed Out. Each transition is a forward step.

**Where exactly?**  
The Sign Out button goes in `#result-actions`, replacing the Check In button when the visitor's status is "Checked In". The result-actions div stays visible (currently it's hidden for non-Pending visitors) — instead of showing the "already processed" info block, we show the Sign Out button. This avoids adding new DOM sections.

---

## 2. Visual Style

**Button: `btn-signout` — amber/orange palette, visually distinct from Check In (green) and Reject (red).**

| Property | Value |
|---|---|
| Background | `#F59E0B` (amber-500) |
| Hover | `#D97706` (amber-600) |
| Icon | Door/exit arrow SVG |
| Label | "Sign Out" |
| Disabled | 0.5 opacity, cursor: not-allowed |

**Colour justification:**  
- Green = entry (positive). Amber = departure (neutral/transitional). Red = rejection (negative).
- Three distinct colours prevent confusion when guard is tapping quickly on a phone.

**Icon suggestion:**
```svg
<path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/>
<polyline points="10 17 15 12 10 7"/>
<line x1="15" y1="12" x2="3" y2="12"/>
```
Door with arrow leaving — universally understood.

---

## 3. Status Transitions

### Current lifecycle (no change):
```
Registration → Pending Entry → Checked In  → (nothing)
                              → Rejected
```

### Proposed lifecycle:
```
Registration → Pending Entry → Checked In → Signed Out
                              → Rejected
```

### Transition chain (the Sign Out action):

1. **Guard taps "Sign Out"** on a Checked In visitor identity card
2. **Confirm dialog appears** — same pattern as Check In / Reject:
   - Icon: amber door icon
   - Title: "Confirm Sign Out"
   - Message: `Are you sure you want to sign out <strong>{name}</strong>?`
   - Buttons: Cancel (left) / Confirm Sign Out (right, amber)
3. **On confirm:**
   - Loading overlay shows: "Signing out..."
   - API call: `updateStatus(visitorNumber, 'Signed Out')` — writes `Signed Out` status AND the current timestamp to column 13 (Sign-Out Time)
   - On success → transition to the **"Sign Out Success"** state
   - On error → show error overlay (existing pattern)

### Sign Out Success state:
- Same pattern as the Verified/Rejected success states but with an amber/slate theme
- Shows: checkmark icon (amber), visitor name, "has been signed out.", Sign-Out Time
- Button: "↩ Back to Search" (same as Rejected state)

---

## 4. Sign-Out Time Display

Already wired up in the HTML (`#result-sign-out-time-row`, `#result-sign-out-time`) and JavaScript (lines 273-278 of verify.js). After sign-out:

- `v.signOutTime` is populated by the API response
- The row unhides automatically via the existing `showVisitor()` logic
- The "Signed Out" status badge shows timestamp

**No additional HTML changes needed for this display.**

---

## 5. New Status Values and Their Effect

| Area | Current behaviour | With "Signed Out" |
|---|---|---|
| **Status badge** | pending / checked-in / rejected | + `signed-out` class (amber, text: "Signed Out") |
| **Action buttons** | Hidden for non-Pending | Show Sign Out btn for "Checked In"; show nothing for "Signed Out" |
| **Already-processed message** | "This visitor has already checked in" for Checked In | For Signed Out: "This visitor has already signed out. (Status: Signed Out)" |
| **Today's Visitors filter tabs** | All / Pending / Done / Rej. | Rename "Done" to "Active" or keep as-is; add a **"Signed Out"** counter in the tab bar — but keep it brief |
| **Today's list entry** | Checked In shows "Checked In" badge with sign-in time | Signed Out shows "Signed Out" badge with sign-out time |
| **Category in Today's list** | Pending / Checked In / Rejected | Pending / Checked In / Signed Out / Rejected (Signed Out below Checked In) |

**Filter tabs proposal (pragmatic — Fenky-friendly):**

```
[All (12)] [Pending (4)] [Active (5)] [Out (2)] [Rej. (1)]
        \                                /
    "Active" = "Checked In" (on-site right now)
    "Out" = "Signed Out" (departed)
```

This gives the guard a single tap to see "who's actually in the building right now" — a common operational need.

---

## 6. Edge Cases

| Edge case | Handling |
|---|---|
| **Visitor never checked in but wants to leave** | Sign Out button won't appear — status is "Pending Entry", not "Checked In". Guard would need to check them in first. Guard realises their mistake and uses Check In → Sign Out as needed. |
| **Visitor already signed out** | Status badge shows "Signed Out". No action buttons shown. Already-processed message: "This visitor has already signed out." |
| **Accidental sign-out** | Confirmation dialog prevents accidental taps. No undo mechanism (matches Check In / Reject pattern — all are one-way). |
| **Visitor was rejected but now needs to leave** | They were never on-site. No action needed. Already-processed message explains. |
| **Guard clicks while network is slow** | `actionInProgress` flag prevents double-clicks (already implemented). Loading overlay shows. |
| **API fails mid-sign-out** | Error overlay appears with "Failed to sign out. Please try again." Guard retries. State unchanged. |

**No undo.** This matches the existing Check In and Reject patterns — all guard actions are one-way. If Fenky wants add/remove later, it's a separate feature.

---

## 7. Notification Triggers

**Recommendation: No notification for sign-out in v1.**

Rationale (pragmatic):
- The guard already has full visibility: the status badge updates live, the Today's list auto-refreshes, and the Sign-Out Time appears.
- The check-in notification (if any) already told the host the visitor arrived.
- Sign-out is a routine departure — the host can check the portal if they need to know.
- Adding WhatsApp/email notification for sign-out adds API surface and cost for minimal value.

**If added later:** A simple WhatsApp template message to the host: "{Name} has signed out of {Company} at {Time}." — but defer this to a post-v1 enhancement. Fenky will appreciate keeping the scope tight.

---

## 8. Implementation Plan (for reference)

### Files to modify:

1. **verify.js** (~30 new lines):
   - Add `confirmSignOut()` — shows the confirm dialog for sign-out
   - Add `showSignedOutSuccess(v)` — success state (similar to `showRejectedState`)
   - In `showVisitor()` → when status is "Checked In", show Sign Out button instead of hiding actions
   - In `showVisitor()` → when status is "Signed Out", show "already signed out" message
   - In `renderTodayVisitors()` → add "signed-out" filter tab and category
   - In status count logic → count "Signed Out" separately
   - Export the new functions in `window.App`

2. **verify.html** (minimal, ~15 lines):
   - Add `<div id="result-signed-out">` — success state after sign-out (identical structure to the rejected state card, but amber)
   - Add `"signed-out"` to the comment on line 80 listing possible data-state values
   - Add filter tab button for "signed-out" in the Today's section

3. **styles.css** (~30 lines):
   - `.status-badge.signed-out` — amber badge
   - `.btn-signout` — amber button matching `.btn-verify` / `.btn-reject` pattern
   - `.result-signed-out-card` — success card styling (amber accent)
   - `.today-status-badge.signed-out-badge` — for Today's list

4. **Backend (Google Apps Script)**:
   - Accept `'Signed Out'` as a valid status in `updateStatus`
   - When status is `'Signed Out'`, write current timestamp to **column 13** (Sign-Out Time)
   - Return `signOutTime` in the response so the frontend can display it

---

## 9. Mockup Flow

```
┌─────────────────────────────────────┐
│  🔴 Pending    ┌──────┐ ┌────────┐ │
│                 │Verify│ │ Reject │ │
│                 │Green │ │  Red   │ │
│                 └──────┘ └────────┘ │
├─────────────────────────────────────┤
│  ✅ Checked In  ┌──────────┐        │
│                 │ Sign Out │        │
│                 │  Amber   │        │
│                 └──────────┘        │
├─────────────────────────────────────┤
│  🚪 Signed Out  (no actions)       │
│  "This visitor has signed out."     │
└─────────────────────────────────────┘
```

---

## Summary of recommendations

| Question | Answer |
|---|---|
| Where does the button go? | In `#result-actions`, replacing Check In when status == "Checked In" |
| What colour? | Amber (#F59E0B) — distinct from green Check In and red Reject |
| What icon? | Door/exit arrow |
| After sign-out? | Success state shown, button hidden, Sign-Out Time populated |
| Today's list? | New "Signed Out" filter tab + badge, live alongside other statuses |
| Can you sign out without check-in? | No — button only appears for Checked In status |
| Automatic on card reader release? | No — v1 is manual button only. Card reader integration is future scope. |
| Notification triggers? | None in v1 — defer to post-launch |
| Undo? | No — matches existing one-way pattern (Check In / Reject) |
| Edge cases? | Already signed out → message. Accidental → confirm dialog. Never checked in → no button. |
