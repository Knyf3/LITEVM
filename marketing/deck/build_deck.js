// LITEVM Marketing Presentation Deck
const pptxgen = require("pptxgenjs");
const path = require("path");

const SHOTS = path.join(__dirname, "..", "screenshots");
const IMG = (f) => path.join(SHOTS, f);

const NAVY = "1E2761";
const BLUE = "4361EE";
const ICE = "CADCFC";
const LIGHT = "F8FAFC";
const INK = "1E293B";
const MUTED = "64748B";
const GREEN = "16A34A";
const AMBER = "D97706";
const WHITE = "FFFFFF";

const makeShadow = () => ({ type: "outer", color: "0F172A", blur: 10, offset: 4, angle: 135, opacity: 0.18 });

let pres = new pptxgen();
pres.layout = "LAYOUT_16x9";
pres.author = "Fenky Tjhang";
pres.title = "LITEVM — Visitor Management Reimagined";

// ─────────────────────────────── 1. TITLE ───────────────────────────────
let s = pres.addSlide();
s.background = { color: NAVY };
s.addShape(pres.shapes.RECTANGLE, { x: 0, y: 0, w: 10, h: 0.12, fill: { color: BLUE } });
s.addShape(pres.shapes.OVAL, { x: 7.6, y: -1.2, w: 4, h: 4, fill: { color: BLUE, transparency: 80 } });
s.addShape(pres.shapes.OVAL, { x: -1.5, y: 3.8, w: 3.5, h: 3.5, fill: { color: BLUE, transparency: 88 } });
s.addImage({ path: IMG("04-registration-result.png"), x: 7.35, y: 0.9, w: 2.5, h: 5.41, sizing: { type: "contain", w: 2.5, h: 5.41 } });
s.addText("LITEVM", { x: 0.9, y: 1.1, w: 6, h: 0.9, fontSize: 60, bold: true, color: WHITE, fontFace: "Arial" });
s.addText("Visitor Management Reimagined", { x: 0.9, y: 2.05, w: 6, h: 0.6, fontSize: 26, color: ICE, fontFace: "Arial" });
s.addText("Mobile pre-registration · QR check-in · Photo verification · Real-time reporting — from Rp 50K/month", { x: 0.9, y: 2.85, w: 6.2, h: 0.9, fontSize: 15, color: "B8C6E8", fontFace: "Arial" });
s.addText("Prepared by Fenky Tjhang  ·  August 2026", { x: 0.9, y: 4.7, w: 6, h: 0.4, fontSize: 13, color: "8A9BC8", fontFace: "Arial" });

// ─────────────────────────────── 2. PROBLEM ───────────────────────────────
s = pres.addSlide();
s.background = { color: LIGHT };
s.addText("The Problem", { x: 0.7, y: 0.45, w: 8.6, h: 0.7, fontSize: 36, bold: true, color: INK, fontFace: "Arial" });
s.addText("Visitor management is still stuck in the paper age", { x: 0.7, y: 1.15, w: 8.6, h: 0.5, fontSize: 17, color: MUTED, fontFace: "Arial" });
const probs = [
  ["📋", "Paper logbooks", "Lost records, illegible handwriting, zero audit trail, no identity proof"],
  ["⏱", "Slow queues", "Manual lookup and phone calls at every entry — visitors and guards both wait"],
  ["🔒", "Privacy risk", "Indonesia UU PDP (2024) effectively outlaws unmanaged paper visitor logs"],
  ["💰", "Enterprise pricing", "Global SaaS starts at USD 29–362 per location/month — far beyond SME reach"],
];
probs.forEach((p, i) => {
  const y = 1.95 + i * 0.95;
  s.addShape(pres.shapes.RECTANGLE, { x: 0.7, y, w: 8.6, h: 0.78, fill: { color: WHITE }, shadow: makeShadow() });
  s.addText(p[0], { x: 0.9, y: y + 0.12, w: 0.6, h: 0.55, fontSize: 24, align: "center", valign: "middle" });
  s.addText(p[1], { x: 1.6, y: y + 0.08, w: 3.2, h: 0.35, fontSize: 15, bold: true, color: INK, fontFace: "Arial" });
  s.addText(p[2], { x: 1.6, y: y + 0.4, w: 7.4, h: 0.32, fontSize: 11.5, color: MUTED, fontFace: "Arial" });
});

// ─────────────────────────────── 3. SOLUTION ───────────────────────────────
s = pres.addSlide();
s.background = { color: NAVY };
s.addShape(pres.shapes.RECTANGLE, { x: 0, y: 0, w: 10, h: 0.12, fill: { color: BLUE } });
s.addText("Introducing LITEVM", { x: 0.7, y: 0.5, w: 8.6, h: 0.7, fontSize: 36, bold: true, color: WHITE, fontFace: "Arial" });
s.addText("A lightweight, mobile-first visitor management system built for SEA businesses", { x: 0.7, y: 1.2, w: 8.6, h: 0.5, fontSize: 16, color: ICE, fontFace: "Arial" });
const sols = [
  ["📱", "Visitor pre-registration", "Visitors register from any phone — before they arrive"],
  ["🎫", "QR-based check-in", "Show the QR at the gate; guard verifies identity in seconds"],
  ["📸", "Photo verification", "ID card + selfie captured at registration, compared at entry"],
  ["📊", "Real-time reports", "Auto-generated visitor logs, exportable to CSV / PDF"],
  ["📧", "Email confirmations", "Visitor number and confirmations delivered to any inbox — zero training"],
  ["🔑", "ACT Pro integration", "Auto-grant / revoke door access rights on check-in and sign-out"],
];
sols.forEach((p, i) => {
  const col = i % 3, row = Math.floor(i / 3);
  const x = 0.7 + col * 2.95, y = 1.95 + row * 1.55;
  s.addShape(pres.shapes.RECTANGLE, { x, y, w: 2.75, h: 1.4, fill: { color: "243A7D" }, shadow: makeShadow() });
  s.addText(p[0], { x: x + 0.15, y: y + 0.12, w: 2.45, h: 0.4, fontSize: 20 });
  s.addText(p[1], { x: x + 0.15, y: y + 0.5, w: 2.45, h: 0.35, fontSize: 13.5, bold: true, color: WHITE, fontFace: "Arial" });
  s.addText(p[2], { x: x + 0.15, y: y + 0.85, w: 2.45, h: 0.5, fontSize: 10, color: "B8C6E8", fontFace: "Arial" });
});

// ─────────────────────────────── 4. HOW IT WORKS ───────────────────────────────
s = pres.addSlide();
s.background = { color: LIGHT };
s.addText("How It Works", { x: 0.7, y: 0.45, w: 8.6, h: 0.7, fontSize: 36, bold: true, color: INK, fontFace: "Arial" });
s.addText("Three steps from visitor to verified entry", { x: 0.7, y: 1.15, w: 8.6, h: 0.5, fontSize: 17, color: MUTED, fontFace: "Arial" });
const steps = [
  ["1", "Pre-Register", "Visitor scans the QR at the lobby or opens the link. Fills details, captures ID + selfie, selects destination. Receives a unique visitor number via email."],
  ["2", "Arrive & Show QR", "Visitor presents the QR code at the gate. The guard looks up the number instantly."],
  ["3", "Verify & Check-In", "Guard matches the ID photo and selfie against the person. One tap to check in; rights auto-granted if ACT Pro is connected. Auto sign-out at end of day."],
];
steps.forEach((p, i) => {
  const y = 1.9 + i * 1.15;
  s.addShape(pres.shapes.OVAL, { x: 0.7, y: y + 0.05, w: 0.55, h: 0.55, fill: { color: BLUE } });
  s.addText(p[0], { x: 0.7, y: y + 0.05, w: 0.55, h: 0.55, fontSize: 18, bold: true, color: WHITE, align: "center", valign: "middle", fontFace: "Arial" });
  s.addText(p[1], { x: 1.5, y: y, w: 2.6, h: 0.4, fontSize: 17, bold: true, color: INK, fontFace: "Arial" });
  s.addText(p[2], { x: 1.5, y: y + 0.38, w: 7.7, h: 0.75, fontSize: 12, color: MUTED, fontFace: "Arial" });
});

// Mobile shot helper: 390x844 aspect → fit within slide (h=3.9, w=1.80)
const PHONE_W = 1.8, PHONE_H = 3.9, PHONE_Y = 1.3;
const phoneXs = [0.9, 4.1, 7.3];
function addPhone(slide, img, i) {
  slide.addImage({ path: img, x: phoneXs[i], y: PHONE_Y, w: PHONE_W, h: PHONE_H, sizing: { type: "cover", w: PHONE_W, h: PHONE_H } });
}

// ─────────────────────────────── 5. SCREENSHOT: REGISTRATION ───────────────────────────────
s = pres.addSlide();
s.background = { color: NAVY };
s.addShape(pres.shapes.RECTANGLE, { x: 0, y: 0, w: 10, h: 0.12, fill: { color: BLUE } });
s.addText("Visitors Register in Under a Minute", { x: 0.7, y: 0.45, w: 8.6, h: 0.6, fontSize: 30, bold: true, color: WHITE, fontFace: "Arial" });
addPhone(s, IMG("01-registration-form.png"), 0);
addPhone(s, IMG("02-photos-uploaded.png"), 1);
addPhone(s, IMG("04-registration-result.png"), 2);
s.addText("Details → Photos → QR", { x: 0.7, y: 5.25, w: 8.6, h: 0.35, fontSize: 12, color: ICE, align: "center", fontFace: "Arial" });

// ─────────────────────────────── 6. SCREENSHOT: GUARD PORTAL ───────────────────────────────
s = pres.addSlide();
s.background = { color: NAVY };
s.addShape(pres.shapes.RECTANGLE, { x: 0, y: 0, w: 10, h: 0.12, fill: { color: BLUE } });
s.addText("Guards Verify in Seconds", { x: 0.7, y: 0.45, w: 8.6, h: 0.6, fontSize: 30, bold: true, color: WHITE, fontFace: "Arial" });
addPhone(s, IMG("05-guard-pin.png"), 0);
addPhone(s, IMG("06-guard-today-list.png"), 1);
addPhone(s, IMG("07-guard-lookup-result.png"), 2);
s.addText("PIN-gated portal · Today's list · Photo verification · One-tap check-in / reject", { x: 0.7, y: 5.25, w: 8.6, h: 0.35, fontSize: 12, color: ICE, align: "center", fontFace: "Arial" });

// ─────────────────────────────── 7. REPORTS ───────────────────────────────
s = pres.addSlide();
s.background = { color: LIGHT };
s.addText("Reports & Audit Trail", { x: 0.7, y: 0.45, w: 8.6, h: 0.7, fontSize: 36, bold: true, color: INK, fontFace: "Arial" });
s.addText("Every visit logged, searchable, and exportable", { x: 0.7, y: 1.15, w: 8.6, h: 0.5, fontSize: 17, color: MUTED, fontFace: "Arial" });
s.addImage({ path: IMG("08-report.png"), x: 0.7, y: 1.9, w: 8.6, h: 4.84, sizing: { type: "contain", w: 8.6, h: 4.84 } });

// ─────────────────────────────── 8. PRICING ───────────────────────────────
s = pres.addSlide();
s.background = { color: NAVY };
s.addShape(pres.shapes.RECTANGLE, { x: 0, y: 0, w: 10, h: 0.12, fill: { color: BLUE } });
s.addText("Pricing That Any Business Can Afford", { x: 0.7, y: 0.45, w: 8.6, h: 0.7, fontSize: 34, bold: true, color: WHITE, fontFace: "Arial" });
s.addText("3–36× cheaper than the cheapest global competitor", { x: 0.7, y: 1.15, w: 8.6, h: 0.5, fontSize: 16, color: ICE, fontFace: "Arial" });
const tiers = [
  ["Free", "Rp 0", "1 location · 50 visitors/mo", "Try it today", WHITE, BLUE, INK],
  ["Starter", "Rp 50K/mo", "1 location · 500 visitors", "≈ USD 3.30", BLUE, WHITE, WHITE],
  ["Pro", "Rp 150K/mo", "1 location · unlimited", "≈ USD 10", GREEN, WHITE, WHITE],
  ["Multi-Site", "Rp 100K/site/mo", "3+ locations", "Volume pricing", "243A7D", WHITE, WHITE],
];
tiers.forEach((t, i) => {
  const x = 0.7 + i * 2.2, y = 1.95, w = 2.0, h = 3.0;
  const priceSize = t[1].length > 12 ? 17 : 24;
  s.addShape(pres.shapes.RECTANGLE, { x, y, w, h, fill: { color: t[4] }, shadow: makeShadow() });
  s.addText(t[0], { x, y: y + 0.12, w, h: 0.4, fontSize: 14, bold: true, color: t[5], align: "center", fontFace: "Arial" });
  s.addText(t[1], { x: x + 0.05, y: y + 0.5, w: w - 0.1, h: 0.6, fontSize: priceSize, bold: true, color: t[5], align: "center", fontFace: "Arial" });
  s.addText(t[2], { x: x + 0.12, y: y + 1.25, w: w - 0.24, h: 0.9, fontSize: 11, color: t[5], align: "center", fontFace: "Arial" });
  s.addText(t[3], { x: x + 0.12, y: y + 2.25, w: w - 0.24, h: 0.4, fontSize: 10.5, color: t[5], align: "center", italic: true, fontFace: "Arial" });
});
s.addText("vs Envoy USD 362 · Sine USD 69–199 · SwipedOn USD 29–99 per location/month", { x: 0.7, y: 5.15, w: 8.6, h: 0.4, fontSize: 11, color: "8A9BC8", align: "center", fontFace: "Arial" });

// ─────────────────────────────── 9. MARKET ───────────────────────────────
s = pres.addSlide();
s.background = { color: LIGHT };
s.addText("Market Opportunity — SEA", { x: 0.7, y: 0.45, w: 8.6, h: 0.7, fontSize: 36, bold: true, color: INK, fontFace: "Arial" });
s.addText("Regulatory tailwind meets massive under-served demand", { x: 0.7, y: 1.15, w: 8.6, h: 0.5, fontSize: 17, color: MUTED, fontFace: "Arial" });
const stats = [
  ["Email", "Email delivery — every visitor number and confirmation lands in the inbox"],
  ["100M+", "Visitors logged on paper daily across SEA apartments, offices, schools"],
  ["2024", "UU PDP passes — paper visitor logs become a legal liability"],
  ["Rp 150K", "≈ USD 10/month — less than a takeout meal for a full VMS"],
];
stats.forEach((p, i) => {
  const col = i % 2, row = Math.floor(i / 2);
  const x = 0.7 + col * 4.45, y = 1.95 + row * 1.7;
  s.addShape(pres.shapes.RECTANGLE, { x, y, w: 4.25, h: 1.5, fill: { color: WHITE }, shadow: makeShadow() });
  s.addText(p[0], { x: x + 0.25, y: y + 0.2, w: 1.6, h: 0.9, fontSize: 34, bold: true, color: BLUE, fontFace: "Arial" });
  s.addText(p[1], { x: x + 1.9, y: y + 0.25, w: 2.2, h: 1.0, fontSize: 13, color: INK, fontFace: "Arial", valign: "middle" });
});

// ─────────────────────────────── 10. BUSINESS MODEL ───────────────────────────────
s = pres.addSlide();
s.background = { color: NAVY };
s.addShape(pres.shapes.RECTANGLE, { x: 0, y: 0, w: 10, h: 0.12, fill: { color: BLUE } });
s.addText("A Business Built to Scale", { x: 0.7, y: 0.45, w: 8.6, h: 0.7, fontSize: 36, bold: true, color: WHITE, fontFace: "Arial" });
const biz = [
  ["98–99%", "Gross margin", "Near-zero marginal cost per customer on Google infrastructure"],
  ["~40", "Customers to break even", "Reached in month 4–5"],
  ["Rp 30M", "Y1 MRR target", "≈ USD 2K/month at 300 customers"],
  ["5", "ICP segments", "Apartments · SME offices · co-working · schools · ACT integrators"],
];
biz.forEach((p, i) => {
  const col = i % 2, row = Math.floor(i / 2);
  const x = 0.7 + col * 4.45, y = 1.75 + row * 1.65;
  s.addShape(pres.shapes.RECTANGLE, { x, y, w: 4.25, h: 1.45, fill: { color: "243A7D" }, shadow: makeShadow() });
  s.addText(p[0], { x: x + 0.25, y: y + 0.15, w: 3.85, h: 0.6, fontSize: 28, bold: true, color: ICE, fontFace: "Arial" });
  s.addText(p[1], { x: x + 0.25, y: y + 0.75, w: 3.85, h: 0.35, fontSize: 13, bold: true, color: WHITE, fontFace: "Arial" });
  s.addText(p[2], { x: x + 0.25, y: y + 1.05, w: 3.85, h: 0.35, fontSize: 10.5, color: "B8C6E8", fontFace: "Arial" });
});

// ─────────────────────────────── 11. DIFFERENTIATION ───────────────────────────────
s = pres.addSlide();
s.background = { color: LIGHT };
s.addText("Why LITEVM Wins", { x: 0.7, y: 0.45, w: 8.6, h: 0.7, fontSize: 36, bold: true, color: INK, fontFace: "Arial" });
s.addTable([
  [{ text: "Feature", options: { bold: true, fill: { color: NAVY }, color: WHITE, margin: 6 } }, { text: "LITEVM", options: { bold: true, fill: { color: BLUE }, color: WHITE, margin: 6 } }, { text: "Global SaaS", options: { bold: true, fill: { color: "CBD5E1" }, color: INK, margin: 6 } }],
  ["Price / location / mo", "Rp 50–150K  (USD 3–10)", "USD 29–362"],
  ["Setup", "Template copy → live in a day", "Onboarding, integrations, contracts"],
  ["Channel", "Email-based, zero training", "Apps, hardware, dedicated staff"],
  ["Integration", "ACT Pro (dominant in Indonesia)", "Enterprise access control brands"],
  ["Language", "EN / ID", "EN first"],
], { x: 0.7, y: 1.9, w: 8.6, colW: [2.4, 3.1, 3.1], border: { pt: 0.5, color: "CBD5E1" }, fontSize: 13, fontFace: "Arial", valign: "middle" });

// ─────────────────────────────── 12. CTA ───────────────────────────────
s = pres.addSlide();
s.background = { color: NAVY };
s.addShape(pres.shapes.RECTANGLE, { x: 0, y: 0, w: 10, h: 0.12, fill: { color: BLUE } });
s.addShape(pres.shapes.OVAL, { x: 7.6, y: -1.2, w: 4, h: 4, fill: { color: BLUE, transparency: 80 } });
s.addShape(pres.shapes.OVAL, { x: -1.5, y: 3.8, w: 3.5, h: 3.5, fill: { color: BLUE, transparency: 88 } });
s.addText("Try LITEVM Today", { x: 0.9, y: 1.3, w: 8.2, h: 0.9, fontSize: 48, bold: true, color: WHITE, fontFace: "Arial" });
s.addText("Free plan available — live demo at knyf3.github.io/LITEVM", { x: 0.9, y: 2.4, w: 8.2, h: 0.5, fontSize: 18, color: ICE, fontFace: "Arial" });
s.addText("From Rp 50K/month · 3–36× cheaper than global competitors", { x: 0.9, y: 3.0, w: 8.2, h: 0.5, fontSize: 16, color: "B8C6E8", fontFace: "Arial" });
s.addShape(pres.shapes.ROUNDED_RECTANGLE, { x: 0.9, y: 3.8, w: 3.4, h: 0.65, fill: { color: BLUE }, rectRadius: 0.12 });
s.addText("Contact Fenky Tjhang", { x: 0.9, y: 3.8, w: 3.4, h: 0.65, fontSize: 15, bold: true, color: WHITE, align: "center", valign: "middle", fontFace: "Arial" });
s.addText("ft@structureresearch.io", { x: 0.9, y: 4.55, w: 8.2, h: 0.4, fontSize: 14, color: ICE, fontFace: "Arial" });

pres.writeFile({ fileName: path.join(__dirname, "LITEVM-Presentation.pptx") }).then(() => {
  console.log("Deck written: " + path.join(__dirname, "LITEVM-Presentation.pptx"));
});
