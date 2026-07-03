# LITEVM — Business Plan
## Lightweight Visitor Management for Southeast Asia

**Prepared:** June 30, 2026
**Product:** LITEVM (github.com/Knyf3/LITEVM)
**Core Tech:** Google Apps Script + Google Sheets + Google Drive + WhatsApp Cloud API
**Developer:** Fenky (Indonesia)

---

## 1. Executive Summary

**LITEVM** is a lightweight, mobile-first visitor pre-registration system built on Google infrastructure. Visitors scan a QR code, fill a 4-step form (Details → Photo + Selfie → Review → Submit), and receive a visitor number via WhatsApp. The system is **multi-tenant by design** — a single Google Apps Script Web App serves unlimited customer sheets, each identified by a `sheetId` parameter in the frontend config.

**The Opportunity:** The global VMS market is projected at ~$2-3B (2025), growing at 12-15% CAGR toward $6-8B by 2030. Yet in Southeast Asia, the market is massively underserved — most small-to-medium enterprises, apartment complexes, co-working spaces, and individual office buildings still use **paper logbooks, basic Excel files, or nothing at all**. The existing VMS players (Envoy at $362/location/month, Sine at $69-199/mo, Proxyclick at $250-500/mo) are priced for Western enterprise budgets, making them prohibitively expensive for SEA SMEs.

**The LITEVM Advantage:**
- Near-zero operational cost (Google infrastructure — no servers to maintain)
- Multi-tenant from day one (one deployment serves all customers)
- WhatsApp-native (the dominant messaging platform in SEA — 95%+ penetration in Indonesia)
- Mobile-first, works on any smartphone with a browser
- PIN-gated reports for security managers
- Already integrates with ACT Pro access control via ACTProAPI
- Indonesian developer = native understanding of the market, pricing, and pain points

**Business Model:** Subscription-based (per-location/month) with a freemium tier. Target price point: **Rp 50,000-150,000/month ($3-10 USD)** — accessible to any business in SEA.

---

## 2. Product Analysis

### 2.1 Current State (v1.0)

**Frontend (GitHub Pages):**
- `index.html` — 3-step registration form: Details → Photos (ID + Selfie via camera/upload) → Review & Submit
- `report.html` — PIN-gated report dashboard with date range, search, status filter, CSV export, pagination, mobile-responsive cards
- `verify.html` — visitor number lookup/verification
- `styles.css` — 3,400+ lines of mobile-first CSS, zero external dependencies
- `config.js` — single configuration file per customer (SHEET_ID, API_BASE, SITE_NAME, PIN)

**Backend (Google Apps Script — 1,730 lines):**
- `doGet()` — visitor lookup, today's visitors, destinations, card pool diagnostic, health check
- `doPost()` — registration, status update (check-in/check-out), migration, bulk sign-out, auto sign-out trigger, report generation
- 14-column schema: Timestamp, Full Name, ID/Passport, Company, Destination, Visitation Date, Phone, Email, ID Photo URL, Selfie URL, Visitor Number, Status, Sign-In Time, Sign-Out Time
- Photo storage in Google Drive (base64 decode → Drive upload → store URL in Sheets)
- Multi-tenant via sheetId parameter (one Web App serves all customers)
- Automated daily sign-out at 21:00

**Current Architecture:**
```
Visitor's Phone (QR) → Static Frontend (GitHub Pages)
                    → Google Apps Script Web App (single deployment)
                    → Google Sheets (per customer)
                    → Google Drive (photo storage per customer)
                    → WhatsApp Cloud API (notification)
                    → Email (confirmation)
```

### 2.2 Key Differentiators From Competitors

| Feature | LITEVM | Envoy ($362/loc/mo) | Sine ($69-199/loc/mo) | SwipedOn ($29-99/loc/mo) |
|---------|--------|---------------------|----------------------|-------------------------|
| **Cost** | Near-zero infra | $362+/loc/mo | $69-199/loc/mo | $29-99/loc/mo |
| **Mobile-first** | ✅ Pure PWA | ✅ | ✅ | ✅ |
| **WhatsApp notification** | ✅ Native | ❌ | ❌ | ❌ |
| **Photo capture** | ✅ Camera + Upload | ✅ | ✅ | ✅ |
| **Multi-tenant** | ✅ Built-in | ❌ (separate instances) | ❌ | ❌ |
| **No server ops** | ✅ (Google infra) | ❌ (SaaS) | ❌ (SaaS) | ❌ (SaaS) |
| **ACT Pro integration** | ✅ (via ACTProAPI) | ❌ | ❌ | ❌ |
| **Indonesian/SEA pricing** | ✅ Local | ❌ USD | ❌ USD/AUD | ❌ USD |
| **Offline capable** | ❌ | ❌ | ❌ | ✅ (iPad app) |
| **Hardware kiosk** | ❌ | ✅ (iPad) | ✅ (iPad/tablet) | ✅ (iPad) |
| **API access** | ✅ (REST/JSON) | ✅ | ✅ | ✅ |
| **Reports & CSV** | ✅ | ✅ | ✅ | ✅ |

### 2.3 Feature Gap Analysis (Future Roadmap)

| Priority | Feature | Rationale |
|----------|---------|-----------|
| **P0** | Admin dashboard (web-based) | Security managers need a proper backend to view/manage visitors, not just raw Sheets |
| **P0** | Multi-language (ID, EN, MS, TH, VI) | SEA market needs Bahasa Indonesia, Malay, Thai, Vietnamese |
| **P0** | Self-service onboarding | Currently manual per-customer deployment = not scalable |
| **P1** | QR check-in/out scanning | Visitor scans QR at gate to check in/out autonomously |
| **P1** | Host notification (email/WA) | Pre-registered visitor → alert to the person they're visiting |
| **P1** | Pre-registration link sharing | Host sends guest a link → guest pre-registers before arrival |
| **P1** | Export to PDF | For compliance/audit purposes |
| **P2** | Visitor badge generation | Printable badge with name, photo, date, visitor number |
| **P2** | Blacklist/watchlist | Flag returning visitors of concern |
| **P2** | Vehicle plate registration | For parking/vehicle tracking |
| **P3** | Native mobile app (WA Bot) | Bypass browser entirely via WhatsApp chatbot |
| **P3** | Offline fallback | Service worker cache for intermittent connectivity |
| **P3** | Facial recognition check-in | Compare selfie on arrival vs stored selfie |

---

## 3. Market Analysis

### 3.1 Global VMS Market Overview

| Metric | Value |
|--------|-------|
| Market Size (2025) | ~$2.3-3.0B |
| Projected (2030) | ~$6.0-8.5B |
| CAGR | 12-15% |
| Key Growth Drivers | Post-COVID security awareness, digitalization, building compliance |
| Key Geography | North America (40%), Europe (30%), APAC (20%), RoW (10%) |

### 3.2 Competitive Landscape (Pricing)

| Company | Pricing (per location/month) | Notes |
|---------|------------------------------|-------|
| **Envoy** | Free (Basic) → $362 (Premium) → Custom (Enterprise) | Acquired by Milan Laser 2025; enterprise focus |
| **Sine** (Honeywell) | $69 (Starter) → $199 (Plus) → Custom | Acquired by Honeywell; strong in AU/NZ |
| **SwipedOn** (Sign In App) | $29 (Essential) → $59 (Pro) → $99 (Enterprise) | Best entry-level pricing among majors |
| **Proxyclick** (Eptura) | $250-500+ (contact sales) | Enterprise/Wework focused |
| **Verkada** | Hardware + $xxx/year per device | Hardware-locked; enterprise |
| **Traction Guest** | $99-249/mo | Acquired by Eptura |
| **iVisitor** | $50-300/mo | Mid-market |
| **KeepnTrack** | $50-199/mo | SMB focused |
| **Vizito** (Indonesia) | ~Rp 200-500K/mo (~$13-33) | Mobile app based; Indonesian startup |
| **ZKTeco VMS** | Hardware + free software | Hardware vendor lock-in |
| **LITEVM (proposed)** | **Freemium → Rp 50-150K/mo ($3-10)** | **SEA-optimized pricing** |

### 3.3 Southeast Asia Market Deep Dive

#### 3.3.1 Target Countries

| Country | Offices/Apts | Co-working | SME Segment | WhatsApp % | Data Privacy Law | Key Opportunity |
|---------|-------------|------------|-------------|------------|-----------------|-----------------|
| **Indonesia** | 500K+ | 200+ | 65M MSMEs | 96% | UU PDP (2024) | Largest SEA market; PDP drives digitalization |
| **Malaysia** | 100K+ | 150+ | 1.1M SMEs | 85% | PDPA 2010 | Mature market; English-friendly |
| **Philippines** | 200K+ | 180+ | 1M SMEs | 92% | Data Privacy Act | Strong BPO sector needs VMS |
| **Thailand** | 150K+ | 120+ | 3M SMEs | 88% | PDPA 2022 | Tourism drives visitor mgmt need |
| **Vietnam** | 100K+ | 100+ | 800K+ | 75% (Zalo) | Data Privacy Decree | Zalo/ZaloPay ecosystem (WA less dominant) |
| **Singapore** | 50K+ | 300+ | 300K SMEs | 80% | PDPA 2012 | Most mature; higher price tolerance |

*Sources: Estimated based on World Bank enterprise data, Statista, country SME agencies*

#### 3.3.2 Current Pain Points in SEA

1. **Paper logbooks still dominate** — Security guards at apartment blocks and small offices use physical notebooks. Problems: illegible handwriting, no photo, no way to search, easy to forge, no compliance.

2. **Excel-based tracking** — Some mid-size offices use shared Excel files. Problems: version conflicts, no photo storage, no mobile access, everyone can edit.

3. **WhatsApp-based manual check-in** — A surprising number of offices use WhatsApp groups like "security received visitor Mr. X" — no way to search history, photos are lost in chat.

4. **Expensive SaaS is out of reach** — Envoy at $362/month is more than a security guard's monthly salary in Indonesia (Rp 3-5M / ~$200-330). Even SwipedOn at $29/month adds up for multi-gate locations.

5. **Google Forms workarounds** — Some smart operators use Google Forms for visitor registration. Problems: no photo capture, no WhatsApp notification, data in separate sheets per day, no visitor number generation.

6. **Regulatory pressure increasing** — Indonesia's UU PDP (effective 2024) requires visitor data to be stored securely, with access controls, consent, and the right to deletion. Paper logbooks do NOT comply.

#### 3.3.3 Total Addressable Market (TAM)

| Segment | Indonesia | SEA-6 Total | Est. Monthly Spend |
|---------|-----------|-------------|-------------------|
| SME offices (1-50 staff) | 500K | 1.5M | $3-10/mo |
| Apartment/condo complexes | 150K | 400K | $3-5/mo |
| Co-working spaces | 200+ | 1,200+ | $5-20/mo |
| Private schools | 50K | 150K | $3-10/mo |
| Hospitals/clinics | 5K | 25K | $5-15/mo |
| Factories/warehouses | 30K | 80K | $5-20/mo |
| **Total TAM** | **~735K** | **~2.15M locations** | **$10-50M/mo potential** |

*Conservative: Even capturing 0.5% of Indonesian offices = 2,500 paying customers @ Rp 100K/mo = Rp 250M/mo ($16,500/mo)*

---

## 4. Business Model & Pricing

### 4.1 Proposed Pricing Tiers

| Tier | Price (IDR) | Price (USD) | Features |
|------|-------------|-------------|----------|
| **Free** | Rp 0 | $0 | 1 location, 50 visitors/mo, basic reports, WhatsApp notification |
| **Starter** | Rp 50,000/mo | ~$3.30 | 1 location, 500 visitors/mo, CSV export, email support |
| **Pro** | Rp 150,000/mo | ~$10 | 1 location, unlimited visitors, all features, priority support |
| **Multi-Site** | Rp 100,000/site/mo | ~$6.60 | 3+ locations, per-site configs, consolidated reports |
| **Enterprise** | Custom | Custom | White-label, dedicated GAS deployment, SLA, ACT Pro integration |

### 4.2 Revenue Model Comparison vs Competitors

```
LITEVM Pro:        Rp 150K/mo  ($10)    ─── 1 location, unlimited visitors
SwipedOn:          $29/mo                 ─── 1 location, unlimited, basic
Sine Starter:      $69/mo                 ─── 1 location, basic features
Envoy Premium:     $362/mo                ─── 1 location, full features
LITEVM Multi-Site: Rp 100K/site/mo ($6.60) ─── 3+ locations
```

**LITEVM is 3-36x cheaper than the cheapest global competitor.**

### 4.3 Cost Structure

| Cost Item | Monthly | Annual | Notes |
|-----------|---------|--------|-------|
| Google Workspace (developer) | $0-12 | $0-144 | Free tier sufficient for low volume |
| GitHub Pages | $0 | $0 | Free for public repos |
| WhatsApp Cloud API | $0-50 | $0-600 | Free tier: 1,000 conversations/mo |
| Google Apps Script | $0 | $0 | Free quota: 90 min/day execution |
| Google Sheets | $0 | $0 | Free for 15GB |
| Domain + branding | ~$10/yr | ~$10 | Custom domain for each customer's QR page |
| WhatsApp Business number | $0 | $0 | One-time via Meta/BSP |
| **Infrastructure cost per customer** | **~$0** | **~$0** | **Near-zero marginal cost** |

### 4.4 Unit Economics

- **Cost per new customer acquisition:** Rp 0-50K ($0-3) — organic/word-of-mouth/WhatsApp
- **Cost to serve per customer per month:** ~$0.02-0.10 (Google API calls + WA messages)
- **Gross margin:** 98-99%
- **Target MRR Break-even:** Rp 5M/mo (~$330) — just 50 Starter tier customers
- **Target Month 12 MRR:** Rp 25M/mo (~$1,650) — ~250 customers
- **Target Month 24 MRR:** Rp 100M/mo (~$6,600) — ~1,000 customers

---

## 5. Go-to-Market Strategy

### 5.1 Target Customer Profiles (Segmented)

1. **ICP-1: Apartment/Condo Security Desks** — The biggest low-hanging fruit. Every apartment complex in Jakarta/Surabaya/Bandung has 1-2 security guards at the gate logging visitors in a book. They already use WhatsApp to communicate. *Entry point:* Free tier → Pro after 30-day trial.

2. **ICP-2: SME Office Reception** — Small offices (5-50 staff) that receive 5-30 visitors/day. Currently using Excel or paper. Want professional look but can't afford Envoy. *Entry point:* "Professional visitor management for the price of 2 cups of kopi/day."

3. **ICP-3: Co-working Space Managers** — Spaces like GoWork, WeWork, Coworkinc, Colony, etc. Need multi-tenant, branded registration for guests, integration with access control. *Entry point:* Multi-Site tier with white-label option.

4. **ICP-4: Private Schools/Universities** — Need to register parents, delivery personnel, contractors. *Entry point:* Free tier for schools (CSR angle) → upgrade for features.

5. **ICP-5: ACT Pro Integrators** — Security system integrators who install ACT Pro panels in Indonesian buildings. LITEVM + ACTProGateway = full visitor + access control solution. *Entry point:* Partnership/reseller model.

### 5.2 Distribution Channels

| Channel | Priority | Strategy |
|---------|----------|----------|
| **Direct WhatsApp** | P0 | Share QR code via WhatsApp groups (security community, building management groups) |
| **Security System Integrators** | P0 | Partner with ACT Pro resellers; bundle LITEVM with access control installs |
| **Google Workspace Resellers** | P1 | Offer as a Google Workspace add-on for Workspace customers |
| **Content Marketing** | P1 | Blog posts: "How to digitize your visitor logbook for free", comparison articles |
| **Facebook/IG Ads** | P1 | Targeted ads in Indonesia (Bahasa) — Rp 50K/day budget |
| **Partnerships** | P2 | Property management software, co-working aggregators |
| **SEO** | P2 | Rank for "sistem manajemen pengunjung" (visitor management system) Indonesian keywords |

### 5.3 Marketing Copy (Bahasa Indonesia)

**Headline:** *"Buku tamu digital. Tanpa ribet. Tanpa server. Tanpa biaya bulanan mahal."*
(Digital visitor book. No hassle. No server. No expensive monthly fees.)

**Subheadline:** *"Ganti buku tamu kertas dengan QR code. Pengunjung daftar sendiri via HP. Kamu dapat notifikasi WhatsApp otomatis."*
(Replace paper logbooks with QR codes. Visitors register themselves via their phone. You get automatic WhatsApp notifications.)

**Call to Action:** *"Coba gratis. Siap dalam 5 menit."*
(Try for free. Set up in 5 minutes.)

### 5.4 Pricing Psychology

- **Free tier** acts as an acquisition funnel — no credit card needed, instant setup
- **Rp 50K/mo ($3.30)** — priced below "cost of one takeout meal"; an impulse decision
- **Annual billing discount**: 2 months free (Rp 500K/year for Pro instead of Rp 1.8M)
- **Referral program**: 1 month free for referring another customer
- **Integrator partner**: 30% recurring commission to system integrators

---

## 6. Operational Plan

### 6.1 Phase 1: Foundation (Month 1-2)

**Product:**
- Add admin dashboard (web-based visitor list, not raw Sheets)
- Multi-language support (ID, EN)
- Self-service onboarding flow (customer enters sheet ID, frontend auto-deploys)

**Business:**
- Set up WhatsApp Business API account
- Create QR code + landing page with Bahasa Indonesia copy
- First 10 beta customers (friends, security community contacts)
- Set up payment (manual transfer first → automated via Xendit/Midtrans)

### 6.2 Phase 2: Growth (Month 3-6)

**Product:**
- QR check-in/out scanning at gate
- Host notification system
- Pre-registration link sharing
- Export to PDF
- Indonesian/SEA language versions

**Business:**
- Launch paid tiers
- Target 50-100 paying customers
- Partner with 3-5 ACT Pro integrators
- Google Ads (Rp 100K/day for Bahasa keywords)
- Create customer testimonials/case studies

### 6.3 Phase 3: Scale (Month 7-12)

**Product:**
- WhatsApp chatbot registration (no browser needed)
- Visitor badge generation
- Blacklist/watchlist
- Vehicle plate tracking
- Facial recognition check-in (compare selfie on submit vs on arrival)
- API for third-party integration

**Business:**
- Target 250-500 paying customers
- Expand to Malaysia and Thailand
- Hire part-time support (WhatsApp-based)
- Apply to Google Workspace Marketplace
- Seek partnership with co-working space chains

### 6.4 Phase 4: Expansion (Year 2+)

- White-label offering for security integrators (resell as their own product)
- Philippines and Vietnam entry
- Dedicated mobile app (Flutter/React Native)
- On-premise option for enterprises that can't use Google Cloud
- Consider seed funding for scaling

---

## 7. Financial Projections

### 7.1 Revenue Forecast (Base Case — Conservative)

| Month | Free Users | Paid Users | ASP/mo | MRR | Cumulative Revenue |
|-------|-----------|-----------|--------|-----|--------------------|
| M1 | 50 | 0 | Rp 0 | Rp 0 | Rp 0 |
| M2 | 100 | 10 | Rp 75K | Rp 750K | Rp 750K |
| M3 | 150 | 25 | Rp 80K | Rp 2.0M | Rp 2.75M |
| M4 | 200 | 40 | Rp 85K | Rp 3.4M | Rp 6.15M |
| M5 | 300 | 60 | Rp 88K | Rp 5.3M | Rp 11.45M |
| M6 | 400 | 85 | Rp 90K | Rp 7.7M | Rp 19.15M |
| M9 | 800 | 175 | Rp 95K | Rp 16.6M | Rp 58M |
| M12 | 1,200 | 300 | Rp 100K | Rp 30M | Rp 130M (~$8,500) |
| M18 | 2,500 | 600 | Rp 105K | Rp 63M | Rp 400M (~$26K) |
| M24 | 5,000 | 1,200 | Rp 110K | Rp 132M | Rp 1B+ (~$66K) |

### 7.2 Key Assumptions

- Free → Paid conversion: 15-20% within 6 months
- Monthly churn: 5% (higher initially, dropping to 3% by M12)
- ASP increases as customers upgrade to Pro/Multi-Site
- Marketing spend: Rp 3M/month ($200) from M3 onwards
- Indonesia is primary market for first 12 months

### 7.3 Break-even Analysis

- Fixed costs: ~Rp 3M/mo ($200) — domain, WhatsApp API, ads, VA support
- Variable costs: Near-zero (Google infra)
- Break-even: **~40 paid customers** at Rp 75K ASP
- Time to break-even: **Month 4-5**

---

## 8. Risk Analysis

| Risk | Probability | Impact | Mitigation |
|------|------------|--------|------------|
| Google Sheets quota limits | Medium | High | Monitor quota usage; offer SQLite/Postgres upgrade path |
| WhatsApp API changes | Medium | High | Abstract notifications layer; support Telegram and email fallback |
| Low conversion (free→paid) | Medium | Medium | Improve free tier limitations; automated onboarding emails |
| Competition from local players | Medium | Medium | First-mover advantage; community-driven distribution |
| Google deprecates Apps Script | Low | Critical | Architecture is portable; migrate to Node.js + SQLite |
| Customer data privacy concerns | Low | Medium | UU PDP compliance; encryption at rest; data deletion API |
| Payment processing friction | Low | Medium | Xendit/Midtrans integration; auto-debit; manual backup |

---

## 9. Unique Advantages for SEA

### 9.1 Why LITEVM Wins in Indonesia Specifically

1. **WhatsApp is the OS of Indonesia** — 96% of smartphone users use WhatsApp. LITEVM's WhatsApp notification isn't a "nice to have," it's the **primary communication channel**. No other global VMS supports WhatsApp natively.

2. **Cost sensitivity** — Rp 150K/month ($10) is affordable for a warung (street stall), let alone an office. Envoy at $362/month is 36x more expensive and priced in a currency that fluctuates against IDR.

3. **No server maintenance** — Indonesian SMEs don't have IT departments. LITEVM runs on Google infrastructure — zero maintenance, zero hosting fees, zero sysadmin.

4. **ACT Pro dominance** — ACT Pro is widely used in Indonesian apartment/office security. LITEVM already integrates via ACTProAPI. This creates a **unique bundle**: LITEVM for visitor management + ACT Pro for access control.

5. **Multi-tenant architecture** — One GAS deployment serves all customers. This means near-zero marginal cost to add customers. Competitors run separate infrastructure per customer.

6. **Regulatory tailwind** — Indonesia's UU PDP (effective Sept 2024) effectively **outlaws paper logbooks** for companies handling personal data. Visitor name, phone, ID number, and photo are personal data. Every office needs a digital solution — and LITEVM is the cheapest compliant option.

7. **Local developer, local understanding** — Fenky is Indonesian and understands the market, payment preferences, pain points, and distribution channels. Not a Silicon Valley export team guessing.

### 9.2 Country-by-Country Market Entry Strategy

| Country | Entry Strategy | Localization Required | Priority |
|---------|---------------|----------------------|----------|
| **Indonesia** | Direct WhatsApp distribution; ACT Pro integrator partnerships | B. Indonesia UI + WA template | **P0** |
| **Malaysia** | Google Workspace Marketplace; SME Facebook groups | B. Malaysia, English | **P1 (M6+)** |
| **Thailand** | Line OA integration (TH uses Line, not WA) | Thai UI + Line API + Thai language | **P1 (M9+)** |
| **Philippines** | BPO industry partnerships; FB Groups | English, Filipino | **P2 (M12+)** |
| **Vietnam** | Zalo integration (VN uses Zalo, not WA) | Vietnamese UI + Zalo API | **P2 (M12+)** |
| **Singapore** | Co-working space partnerships | English | **P2 (M12+)** |

---

## 10. Funding & Investment Thesis

### 10.1 Bootstrap vs Fundraise

**Recommendation: Bootstrap first, then consider funding at scale.**

| Phase | Funding | Rationale |
|-------|---------|-----------|
| Month 1-6 | Bootstrap (Rp 3-5M/mo) | Low costs; validate product-market fit first |
| Month 7-12 | Revenue-funded growth | Should be profitable by M5 |
| Year 2+ | Angel/Seed ($50-100K) | If scaling to 1,000+ customers and multiple countries |

**Why fundraise (if needed):**
- To hire: developer for mobile app, designer for white-label
- To expand to Thailand/Vietnam (requires Line/Zalo integration)
- To build dedicated mobile app (Flutter/React Native)
- To offer on-premise enterprise version (sales team)

### 10.2 Exit Options

- **Acquisition by Honeywell/Sine** — Sine is actively expanding in APAC. A lightweight SEA-focused VMS would complement their $69-199/mo product line.
- **Acquisition by Eptura (Proxyclick/Traction)** — Eptura is consolidating the VMS market (bought Proxyclick 2021, Traction Guest 2022).
- **Acquisition by Google Workspace partner** — As a Google-native app, a Workspace reseller or Google Cloud partner might acquire for the multi-tenant technology.
- **Organic growth** — Steady-state MRR of Rp 100-200M/mo ($6,500-13,000) as a lifestyle business with minimal overhead.

---

## 11. Immediate Next Steps (Next 30 Days)

| # | Action | Owner | Timeline |
|---|--------|-------|----------|
| 1 | Create admin dashboard web app (visitor list, search, filter, status update) | Fenky | Week 1-2 |
| 2 | Add Bahasa Indonesia translation to frontend | Fenky | Week 1-2 |
| 3 | Set up WhatsApp Business API account and phone number | Fenky | Week 1 |
| 4 | Create self-service onboarding (config.js generator) | Fenky | Week 2-3 |
| 5 | Set up payment gateway (Xendit/Midtrans) | Fenky | Week 2-3 |
| 6 | Create Bahasa landing page with QR demo | Fenky | Week 2-3 |
| 7 | Deploy Free tier on GitHub Pages with clear CTA | Fenky | Week 3 |
| 8 | Contact 5 ACT Pro integrators for partnership | Fenky | Week 3-4 |
| 9 | Post in 3 Indonesian security/office management WhatsApp groups | Fenky | Week 3-4 |
| 10 | First 10 beta customers on Free tier | Fenky | Week 4 |

---

## 12. Conclusion

**LITEVM has a clear, defensible position in a growing market with zero direct competitors at its price point.** The combination of:
- **Zero-cost infrastructure** (Google ecosystem)
- **WhatsApp-native** (the dominant communication channel in SEA)
- **Multi-tenant architecture** (near-zero marginal cost per customer)
- **ACT Pro integration** (existing access control ecosystem)  
- **35-50% cheaper than the next cheapest option** ($3-10 vs $29-362)

...creates a powerful wedge into a market that global VMS vendors have ignored.

The business is **capital-light**, **profitable from single-digit customer counts**, and **scalable to thousands of customers** without proportional infrastructure cost increases.

**Recommended action:** Start immediately. Deploy Free tier this week. Get first 10 customers this month. Validate the model with real revenue before investing in major features.
