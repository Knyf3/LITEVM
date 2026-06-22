# LITEVM — Guard Verification Page Wireframe Specification

## Overview

A mobile-first verification page (`verify.html`) for guards/receptionists to look up visitor pre-registrations, verify identity via photos, and process check-ins or rejections.

**Backend data source**: Google Sheet (same as registration page). Columns: `Timestamp | Full Name | ID / Passport Number | Company Name | Hand Phone | ID Photo (Drive URL) | Selfie (Drive URL) | Visitor Number | Status`

**Status values**: `Pending Entry`, `Checked In`, `Rejected`

**Shared design system**: Dark header gradient (`#1a1a2e` → `#16213e`), Inter font, 12px card radius, slate gray text (`#334155`, `#64748B`), primary `#4361ee`, green `#16A34A`, red `#e63946`.

---

## Page Layout (Mobile-first, 440px max container)

```
┌─────────────────────────────────────────────────┐
│  █████████████████████████████████████████████  │  ← Dark header gradient
│  █         LITEVM — Guard Portal              █  │     #1a1a2e → #16213e
│  █         Verify visitor check-in            █  │     Text: white
│  █████████████████████████████████████████████  │
│                                                   │
│  ┌─────────────────────────────────────────┐   │
│  │  ┌─ Search ─────────────────────────┐   │   │  ← Search card (white bg)
│  │  │                                   │   │   │     12px radius
│  │  │  [🔍] [________________________]  │   │   │     box-shadow + border
│  │  │        ┌──────────────┐           │   │   │
│  │  │        │  Look Up     │           │   │   │  ← Primary button #4361ee
│  │  │        └──────────────┘           │   │   │
│  │  │                                   │   │   │
│  │  └───────────────────────────────────┘   │   │
│  └─────────────────────────────────────────┘   │
│                                                   │
│  ┌─────────────────────────────────────────┐   │
│  │                                         │   │  ← Results card (shown after lookup)
│  │  ┌─ Visitor Details ─────────────┐      │   │
│  │  │  Status: [Pending Entry]      │      │   │  ← Badge (amber for pending,
│  │  │                               │      │   │     green for checked-in,
│  │  │  Visitor #: V-20250622-001    │      │   │     red for rejected)
│  │  │  Registered: 22 Jun 2026,     │      │   │
│  │  │               09:30 AM        │      │   │
│  │  └───────────────────────────────┘      │   │
│  │                                         │   │
│  │  ┌─ Identity Info ──────────────┐      │   │
│  │  │  Name        Ahmad bin Ismail│      │   │
│  │  │  ─────────────────────────── │      │   │
│  │  │  ID Number   880101-01-1234  │      │   │
│  │  │  ─────────────────────────── │      │   │
│  │  │  Company     ABC Sdn Bhd     │      │   │
│  │  │  ─────────────────────────── │      │   │
│  │  │  Phone       +60 12-345 6789 │      │   │
│  │  └───────────────────────────────┘      │   │
│  │                                         │   │
│  │  ┌─ Photo Verification ─────────┐       │   │
│  │  │                               │       │   │
│  │  │  ┌──────┐    ┌──────┐        │       │   │  ← Two side-by-side photos
│  │  │  │ ID   │    │Selfie│        │       │   │     (1:1 square thumbs)
│  │  │  │Photo │    │      │        │       │   │
│  │  │  │      │    │      │        │       │   │
│  │  │  └──────┘    └──────┘        │       │   │
│  │  │  ID Photo    Selfie          │       │   │
│  │  └───────────────────────────────┘      │   │
│  │                                         │   │
│  │  ┌─ Action Buttons ────────────┐        │   │
│  │  │                               │       │   │
│  │  │  ┌──────────┐  ┌─────────┐   │       │   │
│  │  │  │  Verify & │  │ Reject  │   │       │   │
│  │  │  │  Check-in │  │         │   │       │   │
│  │  │  │  (#16A34A)│  │(#e63946)│   │       │   │
│  │  │  └──────────┘  └─────────┘   │       │   │
│  │  └───────────────────────────────┘      │   │
│  └─────────────────────────────────────────┘   │
│                                                   │
│  ┌─ OR ─────────────────────────────────────┐   │
│  │                                           │   │  ← Section divider
│  └───────────────────────────────────────────┘   │
│                                                   │
│  ┌─────────────────────────────────────────┐   │
│  │  Today's Visitors  (3 pending)          │   │  ← Section header
│  │                                         │   │
│  │  ┌─────────────────────────────────┐    │   │
│  │  │  V-20250622-001  09:30 AM       │    │   │  ← Quick-check-in card
│  │  │  Ahmad bin Ismail               │    │   │     Tap to expand/verify
│  │  │  ABC Sdn Bhd                    │    │   │
│  │  │               [Check In]        │    │   │  ← Green quick-action btn
│  │  └─────────────────────────────────┘    │   │
│  │                                         │   │
│  │  ┌─────────────────────────────────┐    │   │
│  │  │  V-20250622-002  10:15 AM       │    │   │
│  │  │  Sarah Lim                      │    │   │
│  │  │  TechCorp                       │    │   │
│  │  │               [Check In]        │    │   │
│  │  └─────────────────────────────────┘    │   │
│  │                                         │   │
│  │  ┌─────────────────────────────────┐    │   │
│  │  │  V-20250622-003  10:45 AM       │    │   │
│  │  │  Rajesh Kumar                   │    │   │
│  │  │  Global Ventures                │    │   │
│  │  │               [Check In]        │    │   │
│  │  └─────────────────────────────────┘    │   │
│  └─────────────────────────────────────────┘   │
│                                                   │
│  ┌─────────────────────────────────────────┐   │
│  │  🔒 Secured & encrypted via HTTPS       │   │  ← Page footer with lock icon
│  └─────────────────────────────────────────┘   │
└─────────────────────────────────────────────────┘
```

---

## Step-by-Step User Flow

### Flow Diagram

```
┌──────────────┐
│              │
│  EMPTY STATE │  ← Page loads, search field focused
│  (no search) │
│              │
└──────┬───────┘
       │ User types visitor number
       │ and taps "Look Up"
       ▼
┌──────────────┐
│              │
│ LOADING STATE│  ← Spinner in search card
│              │
└──────┬───────┘
       │
       ├────────────── Query result ──────────────┐
       │                                           │
       ▼                                           ▼
┌──────────────────┐                   ┌──────────────────┐
│                  │                   │                  │
│   RESULTS FOUND  │                   │   NOT FOUND      │
│                  │                   │                  │
│  Shows visitor   │                   │  Error banner    │
│  details card    │                   │  "Visitor not    │
│  + photos        │                   │   found"         │
│  + action btns   │                   │  Retry button    │
│                  │                   │                  │
└──────┬───────────┘                   └──────────────────┘
       │
       ├─── User taps "Verify & Check-in" ───► SUCCESS STATE
       │
       └─── User taps "Reject" ──────────────► REJECTED STATE
```

---

## States Detail

### 1. Empty State (Default)

```
┌───────────────────────────────────────────┐
│  ███████████████████████████████████████  │
│  █    LITEVM — Guard Portal             █  │
│  █    Verify visitor check-in           █  │
│  ███████████████████████████████████████  │
│                                            │
│  ┌──────────────────────────────────┐     │
│  │                                  │     │
│  │  [🔍] [________________________] │     │
│  │        ┌──────────────────┐      │     │
│  │        │    Look Up       │      │     │
│  │        └──────────────────┘      │     │
│  │                                  │     │
│  │  ┌────────────────────────┐     │     │
│  │  │  Enter a visitor number│     │     │  ← Hint text below
│  │  │  (e.g. V-20250622-001) │     │     │     gray #64748B
│  │  └────────────────────────┘     │     │
│  └──────────────────────────────────┘     │
│                                            │
│  ═══ OR ═════════════════════════════════  │
│                                            │
│  ┌─ Today's Visitors ─────────────────┐   │
│  │  (No visitors registered today)    │   │
│  │                                    │   │
│  │  ┌────────────────────────────┐   │   │
│  │  │  📋 No pending visitors    │   │   │  ← Empty illustration
│  │  │  Visitors who pre-register  │   │   │
│  │  │  today will appear here     │   │   │
│  │  └────────────────────────────┘   │   │
│  └────────────────────────────────────┘   │
└───────────────────────────────────────────┘
```

**HTML structure**:
- `#search-input` — type="text", placeholder="Enter visitor number (e.g. V-20250622-001)", autoCapitalize="off", maxlength="25"
- `#btn-lookup` — primary button, disabled when input empty
- `#lookup-result` — initially hidden, contains results/not-found states
- `#todays-visitors-section` — shows list of today's pending visitors or empty state
- Search input auto-focuses on page load (for guard scanning from their phone)

**Keyboard behavior**: On mobile, tapping "Look Up" dismisses keyboard; on desktop, pressing Enter triggers lookup.

---

### 2. Loading State

```
┌───────────────────────────────────────────┐
│  ███████████████████████████████████████  │
│  █    LITEVM — Guard Portal             █  │
│  ███████████████████████████████████████  │
│                                            │
│  ┌──────────────────────────────────┐     │
│  │                                  │     │
│  │  [🔍] [V-20250622-001________]  │     │
│  │        ┌──────────────────┐      │     │
│  │        │  🔄 Looking up...│      │     │  ← Button disables, shows
│  │        └──────────────────┘      │     │     animated spinner text
│  │                                  │     │
│  └──────────────────────────────────┘     │
│                                            │
│  ┌─ Today's Visitors ─────────────────┐   │
│  │  (continues to show list)          │   │
│  └────────────────────────────────────┘   │
└───────────────────────────────────────────┘
```

**Behavior**:
- Button changes to "🔄 Looking up..." and disables
- No full-page overlay — only the search card indicates loading (lightweight UX)
- If the lookup takes > 3 seconds, a subdued "Still searching..." appears below the spinner
- AbortController with 10s timeout

---

### 3. Results Found State

```
┌───────────────────────────────────────────┐
│  ███████████████████████████████████████  │
│  █    LITEVM — Guard Portal             █  │
│  ███████████████████████████████████████  │
│                                            │
│  ┌──────────────────────────────────┐     │
│  │  [🔍] [V-20250622-001________]  │     │
│  │        ┌──────────────────┐      │     │
│  │        │    Look Up       │      │     │  ← Button re-enables
│  │        └──────────────────┘      │     │
│  └──────────────────────────────────┘     │
│                                            │
│  ┌──────────────────────────────────┐     │
│  │  ┌─ Status ─────────────────┐   │     │
│  │  │                           │   │     │
│  │  │   🟡 Status: Pending     │   │     │  ← Amber badge
│  │  │       Entry              │   │     │     bg #FEF3C7
│  │  │                           │   │     │     text #92400E
│  │  │   🆔 V-20250622-001      │   │     │
│  │  │   📅 22 Jun 2026, 09:30  │   │     │
│  │  └───────────────────────────┘   │     │
│  │                                   │     │
│  │  ┌─ Identity Info ───────────┐   │     │
│  │  │  Full Name                 │   │     │
│  │  │  Ahmad bin Ismail          │   │     │
│  │  │                            │   │     │
│  │  │  ID / Passport Number      │   │     │
│  │  │  880101-01-1234            │   │     │
│  │  │                            │   │     │
│  │  │  Company Name              │   │     │
│  │  │  ABC Sdn Bhd               │   │     │
│  │  │                            │   │     │
│  │  │  Hand Phone                │   │     │
│  │  │  +60 12-345 6789           │   │     │
│  │  └────────────────────────────┘   │     │
│  │                                   │     │
│  │  ┌─ Photo Verification ──────┐   │     │
│  │  │                           │   │     │
│  │  │  ┌────────┐ ┌────────┐   │   │     │
│  │  │  │        │ │        │   │   │     │
│  │  │  │ 📷 ID  │ │ 📷     │   │   │     │
│  │  │  │  Photo │ │ Selfie │   │   │     │
│  │  │  │        │ │        │   │   │     │
│  │  │  └────────┘ └────────┘   │   │     │
│  │  │  ID Photo    Selfie      │   │     │
│  │  │                           │   │     │
│  │  │  Tap photo to enlarge     │   │     │  ← Tappable to fullscreen
│  │  └────────────────────────────┘   │     │
│  │                                   │     │
│  │  ┌─ Actions ─────────────────┐   │     │
│  │  │                           │   │     │
│  │  │  ┌──────────┐ ┌────────┐  │   │     │
│  │  │  │ ✅ Verify│ │ ❌     │  │   │     │
│  │  │  │ & Check- │ │ Reject  │  │   │     │
│  │  │  │    in    │ │         │  │   │     │
│  │  │  └──────────┘ └────────┘  │   │     │
│  │  │   #16A34A        #e63946  │   │     │
│  │  └────────────────────────────┘   │     │
│  └──────────────────────────────────┘     │
│                                            │
│  ┌─ Today's Visitors ─────────────────┐   │
│  │  (continues to show, current       │   │
│  │   visitor highlighted)             │   │
│  └────────────────────────────────────┘   │
└───────────────────────────────────────────┘
```

**Key interactions**:
- Photo thumbs are 1:1 aspect ratio, max 140px on mobile
- Tap on a photo opens it in a fullscreen lightbox overlay
- After tapping Verify or Reject, a confirmation dialog appears
- "Today's Visitors" list scrolls independently below

---

### 4. Not Found State

```
┌───────────────────────────────────────────┐
│  ███████████████████████████████████████  │
│  █    LITEVM — Guard Portal             █  │
│  ███████████████████████████████████████  │
│                                            │
│  ┌──────────────────────────────────┐     │
│  │  [🔍] [V-20250622-999________]  │     │
│  │        ┌──────────────────┐      │     │
│  │        │    Look Up       │      │     │
│  │        └──────────────────┘      │     │
│  └──────────────────────────────────┘     │
│                                            │
│  ┌──────────────────────────────────┐     │
│  │                                  │     │
│  │  ┌────────────────────────┐     │     │
│  │  │  ⚠️ Visitor Not Found  │     │     │  ← Error card
│  │  │                        │     │     │     bg #FEF2F2
│  │  │  No registration found │     │     │     border #FECACA
│  │  │  for "V-20250622-999". │     │     │     text #991B1B
│  │  │                        │     │     │
│  │  │  Please check the      │     │     │
│  │  │  number and try again. │     │     │
│  │  │                        │     │     │
│  │  │  ┌──────────────┐      │     │     │
│  │  │  │ Try Again    │      │     │     │  ← Secondary button
│  │  │  └──────────────┘      │     │     │
│  │  └────────────────────────┘     │     │
│  └──────────────────────────────────┘     │
│                                            │
│  ┌─ Today's Visitors ─────────────────┐   │
│  │  (still visible)                   │   │
│  └────────────────────────────────────┘   │
└───────────────────────────────────────────┘
```

**Edge cases**:
- Already checked-in: "This visitor has already checked in at 09:45 AM. (Status: Checked In)" — with a muted gray info card, no action buttons
- Rejected visitor: "This registration was previously rejected on 22 Jun 2026 at 09:40 AM. (Status: Rejected)" — gray info card, optional "Override & Check-in" button
- Typo suggestions: If the entered number follows the `V-YYYYMMDD-NNN` pattern but no match found, a hint: "Visitors registered today have numbers in the format V-20250622-001 through V-20250622-003"

---

### 5. Verified Success State

```
┌───────────────────────────────────────────┐
│  ███████████████████████████████████████  │
│  █    LITEVM — Guard Portal             █  │
│  ███████████████████████████████████████  │
│                                            │
│  ┌──────────────────────────────────┐     │
│  │  [🔍] [V-20250622-001________]  │     │
│  │        ┌──────────────────┐      │     │
│  │        │    Look Up       │      │     │
│  │        └──────────────────┘      │     │
│  └──────────────────────────────────┘     │
│                                            │
│  ┌──────────────────────────────────┐     │
│  │                                  │     │
│  │   ✅                           │     │
│  │                                  │     │  ← Large green checkmark
│  │   Check-In Successful!           │     │     animated draw-in
│  │                                  │     │
│  │   Ahmad bin Ismail               │     │     font-size: 1.25rem
│  │   has been checked in.           │     │     font-weight: 700
│  │                                  │     │
│  │   ┌────────────────────────┐    │     │
│  │   │  🕐 Checked in at:     │    │     │
│  │   │  10:32 AM  22 Jun 2026 │    │     │  ← Timestamp card
│  │   │  Visitor: V-20250622-  │    │     │     bg #F0FDF4
│  │   │          001           │    │     │     border #16A34A
│  │   └────────────────────────┘    │     │
│  │                                  │     │
│  │  ┌────────────────────────┐     │     │
│  │  │  ✅ Check In Another    │     │     │  ← Green primary, clears
│  │  │     Visitor             │     │     │     and returns to empty
│  │  └────────────────────────┘     │     │
│  └──────────────────────────────────┘     │
│                                            │
│  ┌─ Today's Visitors ─────────────────┐   │
│  │  (updated — this visitor now       │   │
│  │   shows as "Checked In" with       │   │
│  │   green badge)                     │   │
│  └────────────────────────────────────┘   │
└───────────────────────────────────────────┘
```

**Success animation**:
- Green checkmark circle draws in (like registration confirmation page)
- Card background briefly pulses green (#F0FDF4) then settles
- Auto-dismiss after 5 seconds? No — guard controls dismissal via "Check In Another" button

---

### 6. Rejected State

```
┌───────────────────────────────────────────┐
│  ███████████████████████████████████████  │
│  █    LITEVM — Guard Portal             █  │
│  ███████████████████████████████████████  │
│                                            │
│  ┌──────────────────────────────────┐     │
│  │  [🔍] [V-20250622-001________]  │     │
│  │        ┌──────────────────┐      │     │
│  │        │    Look Up       │      │     │
│  │        └──────────────────┘      │     │
│  └──────────────────────────────────┘     │
│                                            │
│  ┌──────────────────────────────────┐     │
│  │                                  │     │
│  │   ❌                           │     │
│  │                                  │     │  ← Red X icon
│  │   Registration Rejected          │     │
│  │                                  │     │
│  │   Ahmad bin Ismail               │     │
│  │   has been marked as rejected.   │     │
│  │                                  │     │
│  │   ┌────────────────────────┐    │     │
│  │   │  🕐 Rejected at:       │    │     │
│  │   │  10:33 AM  22 Jun 2026 │    │     │  ← Timestamp card
│  │   └────────────────────────┘    │     │     bg #FEF2F2
│  │                                  │     │     border #FECACA
│  │                                  │     │
│  │  ┌────────────────────────┐     │     │
│  │  │  ↩️ Back to Search      │     │     │  ← Returns to empty state
│  │  └────────────────────────┘     │     │
│  └──────────────────────────────────┘     │
│                                            │
│  ┌─ Today's Visitors ─────────────────┐   │
│  │  (updated — this visitor shows     │   │
│  │   as "Rejected" with red badge)    │   │
│  └────────────────────────────────────┘   │
└───────────────────────────────────────────┘
```

**Rejection flow**:
1. Guard taps "Reject" → confirmation dialog slides up
2. Dialog: "Are you sure you want to reject Ahmad bin Ismail? (Visitor V-20250622-001)"
3. Optional reason field: textarea (not required but encouraged)
4. Buttons: "Cancel" (outline) | "Confirm Reject" (red)
5. On confirm → shows rejected state above

---

## Today's Visitors Section Detail

This is always visible below the search card, serving as a quick-access dashboard.

```
┌───────────────────────────────────────────┐
│  ┌─ Today's Visitors (5 total) ────────┐  │
│  │                                       │  │
│  │  [ 🔍 Filter by name/number... ]      │  │  ← Optional inline filter
│  │                                       │  │     (collapsible)
│  │                                       │  │
│  │  ┌──────────┬───────┬──────┬──────┐  │  │  ← Tab bar
│  │  │  All (5) │Pending│Done  │Rej.  │  │  │
│  │  │          │  (3)  │(1)   │ (1)  │  │  │
│  │  └──────────┴───────┴──────┴──────┘  │  │
│  │                                       │  │
│  │  ── Pending ──────────────────────    │  │
│  │                                       │  │
│  │  ┌──────────────────────────────┐   │  │
│  │  │ 🔴 V-20250622-003   10:45 AM │   │  │  ← Pending (red dot)
│  │  │ Rajesh Kumar                  │   │  │
│  │  │ Global Ventures               │   │  │
│  │  │ ┌──────────┐ ┌────────┐     │   │  │
│  │  │ │  View &  │ │ Check  │     │   │  │
│  │  │ │  Verify  │ │  In    │     │   │  │
│  │  │ └──────────┘ └────────┘     │   │  │
│  │  └──────────────────────────────┘   │  │
│  │                                       │  │
│  │  ┌──────────────────────────────┐   │  │
│  │  │ 🔴 V-20250622-002   10:15 AM │   │  │
│  │  │ Sarah Lim                     │   │  │
│  │  │ TechCorp                      │   │  │
│  │  │ ┌──────────┐ ┌────────┐     │   │  │
│  │  │ │  View &  │ │ Check  │     │   │  │
│  │  │ │  Verify  │ │  In    │     │   │  │
│  │  │ └──────────┘ └────────┘     │   │  │
│  │  └──────────────────────────────┘   │  │
│  │                                       │  │
│  │  ── Checked In ───────────────────    │  │
│  │                                       │  │
│  │  ┌──────────────────────────────┐   │  │
│  │  │ ✅ V-20250622-001    10:32 AM│   │  │  ← Checked in (green)
│  │  │ Ahmad bin Ismail             │   │  │     (no action buttons)
│  │  │ ABC Sdn Bhd                  │   │  │
│  │  └──────────────────────────────┘   │  │
│  │                                       │  │
│  │  ── Rejected ────────────────────    │  │
│  │                                       │  │
│  │  ┌──────────────────────────────┐   │  │
│  │  │ ❌ V-20250622-004   10:33 AM │   │  │  ← Rejected (red)
│  │  │ (no name shown — hidden      │   │  │
│  │  │  for privacy)                │   │  │
│  │  └──────────────────────────────┘   │  │
│  └──────────────────────────────────────┘  │
└───────────────────────────────────────────┘
```

**Quick Check-in flow** (from "Check In" button in list):
1. Guard taps "Check In" → shows small inline confirmation within same card
2. "Check in Sarah Lim?" — [Cancel] [Confirm] mini-bar appears below the card
3. On confirm → status updates to "Checked In" with green badge, card greys out
4. On tap "View & Verify" → page scrolls up, lookup field auto-filled with that visitor's number, triggers lookup

---

## Photo Lightbox

```
┌───────────────────────────────────────────┐
│  ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░  │  ← Semi-transparent overlay
│  ░                                        ░  │     bg rgba(0,0,0,0.85)
│  ░           ┌──────────────────┐        ░  │
│  ░           │                  │        ░  │
│  ░           │   ID Photo       │        ░  │  ← Full-size photo
│  ░           │   (full width,   │        ░  │     max 90vw
│  ░           │    auto height)  │        ░  │     max 80vh
│  ░           │                  │        ░  │
│  ░           └──────────────────┘        ░  │
│  ░                                        ░  │
│  ░   ┌────────────────────────────────┐  ░  │
│  ░   │  ID Photo — Ahmad bin Ismail   │  ░  │  ← Caption bar
│  ░   │  Swipe left for selfie         │  ░  │     bg #1E293B
│  ░   └────────────────────────────────┘  ░  │
│  ░                                        ░  │
│  ░           [ ✕ Close ]                  ░  │  ← Close button (top-right)
│  ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░  │
└───────────────────────────────────────────┘
```

- Swipe left/right to toggle between ID Photo and Selfie
- Pinch-to-zoom on photos that support it (native `<img>` with `touch-action`)
- Tap close or backdrop to dismiss

---

## Confirmation Dialog (before destructive actions)

```
┌───────────────────────────────────────────┐
│  ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░  │
│  ░                                        ░  │
│  ░   ┌──────────────────────────────┐    ░  │
│  ░   │                              │    ░  │
│  ░   │  ⚠️ Confirm Check-In         │    ░  │
│  ░   │                              │    ░  │
│  ░   │  Are you sure you want to    │    ░  │
│  ░   │  check in Ahmad bin Ismail?  │    ░  │
│  ░   │                              │    ░  │
│  ░   │  Visitor: V-20250622-001     │    ░  │
│  ░   │                              │    ░  │
│  ░   │  ┌─────────┐ ┌────────────┐ │    ░  │
│  ░   │  │ Cancel  │ │ Confirm    │ │    ░  │
│  ░   │  │(outline)│ │ Check-In   │ │    ░  │
│  ░   │  │         │ │ (#16A34A)  │ │    ░  │
│  ░   │  └─────────┘ └────────────┘ │    ░  │
│  ░   └──────────────────────────────┘    ░  │
│  ░                                        ░  │
│  ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░  │
└───────────────────────────────────────────┘
```

**Reject confirmation dialog** adds an optional reason textarea:

```
┌───────────────────────────────────────────┐
│  ░   ┌──────────────────────────────┐    ░  │
│  ░   │                              │    ░  │
│  ░   │  ❌ Confirm Rejection        │    ░  │
│  ░   │                              │    ░  │
│  ░   │  Are you sure you want to    │    ░  │
│  ░   │  reject Ahmad bin Ismail?    │    ░  │
│  ░   │                              │    ░  │
│  ░   │  Reason (optional):          │    ░  │
│  ░   │  ┌────────────────────────┐  │    ░  │
│  ░   │  │ ID does not match     │  │    ░  │
│  ░   │  │ visitor                │  │    ░  │
│  ░   │  └────────────────────────┘  │    ░  │
│  ░   │                              │    ░  │
│  ░   │  ┌─────────┐ ┌────────────┐ │    ░  │
│  ░   │  │ Cancel  │ │  Confirm   │ │    ░  │
│  ░   │  │         │ │  Reject    │ │    ░  │
│  ░   │  │         │ │  (#e63946) │ │    ░  │
│  ░   │  └─────────┘ └────────────┘ │    ░  │
│  ░   └──────────────────────────────┘    ░  │
└───────────────────────────────────────────┘
```

---

## Color Palette (matching existing design system)

| Token | Hex | Usage |
|---|---|---|
| Header gradient start | `#1a1a2e` | Page header background |
| Header gradient end | `#16213e` | Page header background |
| Primary | `#4361ee` | Look Up button, active states |
| Primary hover | `#3651d4` | Button hover |
| Success | `#16A34A` | Verify & Check-in, checked-in badge |
| Success hover | `#15803d` | Verify button hover |
| Danger | `#e63946` | Reject button, error states |
| Danger hover | `#c1121f` | Reject button hover |
| Text body | `#1E293B` | Headings, names |
| Text secondary | `#475569` | Labels |
| Text muted | `#64748B` | Hints, timestamps |
| Text light | `#94A3B8` | Placeholders |
| BG page | `#F8FAFC` | Page background |
| Card bg | `#FFFFFF` | Card background |
| Border | `#E2E8F0` | Card borders, dividers |
| Badge pending bg | `#FEF3C7` | Pending status badge |
| Badge pending text | `#92400E` | Pending status text |
| Badge error bg | `#FEF2F2` | Not found/rejected card bg |
| Badge error border | `#FECACA` | Error card border |
| Badge error text | `#991B1B` | Error card text |
| Success card bg | `#F0FDF4` | Success state card |
| Success card border | `#16A34A` | Success state border |

---

## Typography & Sizing

| Element | Font Size | Weight |
|---|---|---|
| Header title | `1.25rem` | 700 |
| Header subtitle | `0.8125rem` | 400 |
| Card title | `1.0625rem` | 700 |
| Section heading | `0.9375rem` | 600 |
| Visitor name (detail) | `1rem` | 600 |
| Field labels | `0.8125rem` | 600 |
| Field values | `0.9375rem` | 500 |
| Status badge | `0.75rem` | 600 |
| Button text | `0.9375rem` | 700 |
| Timestamp | `0.8125rem` | 400 |
| List item name | `0.875rem` | 600 |
| List item meta | `0.75rem` | 400 |

---

## Component Architecture

### HTML Structure (verify.html)

```
verify.html
  ├── #offline-banner (reuse from index.html)
  ├── #verify-page (main container)
  │   ├── header.page-header
  │   │   ├── .header-logo (LITEVM logo SVG, reuse)
  │   │   ├── .header-title ("Guard Portal")
  │   │   └── .header-subtitle ("Verify visitor check-in")
  │   ├── #search-section.card
  │   │   ├── #search-input-wrapper
  │   │   │   ├── .input-icon (search icon)
  │   │   │   └── input#search-input
  │   │   ├── button#btn-lookup.btn-primary
  │   │   └── p#search-hint (hint text)
  │   ├── #lookup-result-section (hidden initially)
  │   │   ├── #result-status-bar (status badge + visitor number)
  │   │   ├── #result-details (identity info review card)
  │   │   ├── #result-photos (photo verification section)
  │   │   ├── #result-actions (Verify & Check-in + Reject buttons)
  │   │   ├── #result-success (success state)
  │   │   └── #result-rejected (rejected state)
  │   ├── .section-divider ("OR" text divider)
  │   ├── #todays-visitors-section
  │   │   ├── #todays-header (title + count badge)
  │   │   ├── #todays-filter (optional inline search/filter tabs)
  │   │   ├── #todays-list (scrollable list of visitor cards)
  │   │   │   └── .today-visitor-card (per visitor)
  │   │   └── #todays-empty (empty state placeholder)
  │   └── footer.page-footer (security badge)
  ├── #photo-lightbox.overlay (hidden)
  ├── #confirm-dialog.overlay (hidden)
  └── #loading-overlay (reuse from index.html)
```

### States (data attributes on #lookup-result-section)

```
data-state="empty"    — nothing searched yet (hidden)
data-state="loading"  — lookup in progress
data-state="found"    — visitor found, showing details
data-state="notfound" — visitor not found
data-state="verified" — successfully checked in
data-state="rejected" — rejected
```

---

## API Integration

### New backend endpoints needed (add to Code.gs)

#### `doGet` enhancements — Lookup by visitor number

```
GET /?action=lookup&visitorNumber=V-20250622-001
  → 200 { status: "ok", visitor: { ... row data ... } }
  → 404 { status: "notfound", message: "No registration found for V-20250622-001" }
```

#### `doGet` — Today's visitors

```
GET /?action=today
  → 200 {
      status: "ok",
      visitors: [
        { visitorNumber, fullName, company, idNumber, phone,
          registrationTime, status, idPhotoUrl, selfieUrl },
        ...
      ]
    }
```

#### `doPost` enhancements — Status update

```
POST / (with mode=updateStatus)
  Body: {
    mode: "updateStatus",
    visitorNumber: "V-20250622-001",
    status: "Checked In" | "Rejected",
    rejectedReason: "optional reason"  // only for rejection
  }
  → 200 { status: "ok", message: "Status updated to Checked In" }
```

**Sheet update logic**:
- `GET action=lookup` : Query sheet by Visitor Number column (col 8), return matching row
- `GET action=today` : Query sheet by Timestamp column (col 1), filter to today's date, return all matching rows
- `POST mode=updateStatus` : Find visitor number in sheet, update Status column (col 9), update Timestamp column (col 1) with current time (to record check-in/rejection time)

### Frontend config additions (config.js)

```
CONFIG.API_BASE (existing)
CONFIG.TIMEOUT_MS (existing)
+ CONFIG.API_MODE (default: "registration")  // distinguish endpoints
```

---

## Responsive Behavior

### Mobile (<480px) — default mobile-first
- Search input full width
- Results card fills full width
- Photos: 1:1 squares, side by side, ~45% width each
- Buttons: side by side, equal width
- Today's Visitors: cards fill full width, quick-action buttons only show "Check In" icon

### Tablet (480–768px)
- Container max 440px, centered
- Same layout but with more padding
- Today's Visitors list shows two action buttons (View & Verify, Check In)

### Desktop (>768px)
- Max 540px container
- Photos slightly larger (max 150px)
- More generous padding in cards

---

## Accessibility

- All interactive elements have `min-width: 44px` and `min-height: 44px` (touch targets)
- Search input has `aria-label="Search visitor by number"`
- Lookup button has `aria-live="polite"` for loading status
- Status badges use `role="status"` and `aria-label`
- Error states use `role="alert"`
- Photo thumbnails have `alt` text describing the image
- Lightbox has `role="dialog"` and `aria-modal="true"`
- Focus trap inside lightbox and modals
- Color is not the only differentiator: status badges include icon + text
- Keyboard navigation: Tab through search → lookup → results → actions → today's list
- Escape key closes lightbox and confirmation dialogs

---

## Micro-interactions & Animation

| Interaction | Animation |
|---|---|
| Search → Results slide-in | TranslateY(20px) → 0, opacity 0 → 1, 0.25s ease |
| Photos load | Crossfade in (opacity 0 → 1, 0.3s) |
| Confirm check-in success | Green checkmark draw animation (reuse from index.html), card brief scale pulse 1.0 → 1.02 → 1.0 over 0.4s |
| Reject | Red X fade-in with slight shake (translateX -2px → 2px → 0, 0.3s) |
| Today's list update | Item smoothly shifts from "Pending" to "Checked In" section with background color transition (0.4s) |
| Tab switch (All/Pending/Done/Rej) | Slide content transition, 0.2s |
| Button press | Scale 1.0 → 0.97, 0.1s |

---

## Error Handling

| Scenario | Behavior |
|---|---|
| Network error during lookup | Show inline error below search: "Network error. Please check your connection." with Retry button |
| Server returns 500 | "Server error. Please try again in a moment." |
| Rate limiting | "Too many requests. Please wait a moment." with 5s cooldown on button |
| Photo fails to load | Broken image placeholder with "Photo unavailable" text |
| Empty visitor number | Button disabled until at least 3 characters typed |
| Invalid format | Client-side validation: must match pattern `V-\d{8}-\d{3}` before allowing lookup |
| Sheet not accessible | "Backend not configured. Contact system administrator." |
| Already checked in (race condition) | "This visitor was already checked in by another guard. Refreshing..." auto-refresh |

---

## Implementation Notes

1. **File structure**:
   - `verify.html` — New HTML page
   - `verify.js` — New JS module (IIFE pattern, same as `app.js`)
   - `verify.css` — New styles OR extend `styles.css` with a new block (preferred: extend styles.css to maintain single design system file)
   - `config.js` — Extend with any new API endpoints

2. **Shared CSS**: Add verification-specific styles to `styles.css` under a `/* --- Verification Page --- */` comment block

3. **Status badge component**: CSS-only component with variants:
   - `.status-badge.pending` — amber
   - `.status-badge.checked-in` — green
   - `.status-badge.rejected` — red
   - `.status-badge.not-found` — gray

4. **Data freshness**: Today's Visitors list refreshes every 30 seconds via `setInterval` polling `GET ?action=today`

5. **No auth**: MVP version assumes this page is accessed by authorized guards who have the URL. Future: add PIN gate.

---

## ASCII State Machine (User Flow)

```
                    ┌─────────────┐
                    │  APP LOADS  │
                    │  (empty)    │
                    └──────┬──────┘
                           │
              ┌────────────┴────────────┐
              │                         │
              ▼                         ▼
    ┌─────────────────┐     ┌──────────────────────┐
    │ User types       │     │ Today's tab shown    │
    │ visitor number   │     │ (auto-loaded)        │
    └────────┬─────────┘     └──────────┬───────────┘
             │                          │
             ▼                          │
    ┌─────────────────┐                 │
    │ Tap "Look Up"   │                 │
    └────────┬─────────┘                │
             │                          │
             ▼                          │
    ┌─────────────────┐                 │
    │ LOADING state   │                 │
    └────────┬─────────┘                │
             │                          │
    ┌────────┴────────┐                 │
    │                 │                 │
    ▼                 ▼                 │
┌────────┐   ┌────────────┐            │
│ FOUND  │   │ NOT FOUND  │            │
└───┬────┘   └─────┬──────┘            │
    │              │                   │
    │              └──────► Try Again ──┤
    │                                    │
    ├───── Verify ───► SUCCESS           │
    │      (check-in)  (green card)      │
    │                    │               │
    │                    ▼               │
    │              "Check In Another" ───┤
    │                                    │
    └───── Reject ───► REJECTED          │
              (red card)   │             │
                           ▼             │
                    "Back to Search" ────┘
                                           │
                    ┌──────────────────────┘
                    ▼
           ┌──────────────────┐
           │ Tap visitor in   │
           │ Today's list     │
           │ → auto-fills     │
           │   search field   │
           │ → triggers lookup│
           └──────────────────┘
```

---

## Quick Reference: All States Summary

| State | Trigger | Key UI Elements |
|---|---|---|
| **Empty** | Page load | Search field focused, hint text, today's visitors (or "none") |
| **Loading** | After "Look Up" tap | Button shows spinner, search field disabled |
| **Found** | Match found | Status badge, identity card, photos side-by-side, action buttons |
| **Not Found** | No match | Red error card with retry, hints for correct format |
| **Already Processed** | Match found but already checked in/rejected | Gray info card, no action buttons, shows processed time |
| **Verified Success** | Check-in confirmed | Green checkmark, timestamp badge, "Check In Another" button |
| **Rejected** | Rejection confirmed | Red X, timestamp badge, "Back to Search" button |
| **Quick Check-in** | From Today's list "Check In" | Inline confirmation, auto-update list |

---

## File Output Summary

**Files to create:**
1. `verify.html` — Full verification page
2. `verify.js` — Verification logic (IIFE module, matches app.js pattern)

**Files to extend:**
1. `styles.css` — Add verification page styles at the end
2. `apps-script/Code.txt` (or Code.gs) — Add lookup, today's visitors, status update endpoints

**No new external dependencies** — everything uses existing Inter font, CSS variables, and patterns from the registration page.