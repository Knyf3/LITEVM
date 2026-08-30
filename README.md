# LITEVM — Basic Visitor Management System

A lightweight, mobile-first visitor pre-registration system. Visitors scan a QR code, fill a simple form, capture ID photo + selfie, and receive a visitor number via WhatsApp.

## Architecture

- **Frontend**: Static HTML/CSS/JS (GitHub Pages)
- **Backend**: Google Apps Script Web App (middleware)
- **Storage**: Google Sheets (data) + Google Drive (photos)
- **Notification**: WhatsApp Business Cloud API

## Deployment

### Frontend
The frontend is deployed via GitHub Pages at:
`https://knyf3.github.io/LITEVM/`

### Backend (Google Apps Script)
1. Open Google Apps Script editor
2. Copy `apps-script/Code.gs`
3. Set up the required script properties
4. Deploy as Web App

### Local Kiosk (Windows, LAN deployment)
The local verify kiosk is served by LITEVM itself — **not** by ACTApi (ACTApi is API-only since 2026-08-04).

1. Copy `config/config.local.js` → `config.local.js` (same folder as `verifylocal.html`) and fill in values
2. Set `ACTApiBase` to the full ACTApi URL (e.g. `http://192.168.2.194:8021`)
3. On the ACTApi side, set `CorsOrigins` in `Settings/Settings.json` to allow the kiosk origin (e.g. `http://localhost:8123`)
4. Run `start_kiosk.bat` (double-click, or from cmd) — serves this folder at `http://localhost:8123/`
5. Open `http://localhost:8123/verifylocal.html`

Zero dependencies — `start_kiosk.bat` → `serve_local.ps1` (PowerShell's built-in `HttpListener`), no Python/Node needed.

> **Installer packaging:** this kiosk runtime is also shipped inside the UStarAPI installer (staged at `UStarAPI/Installer/kiosk/`); keep that copy in sync with this folder.

> **Full installation guide:** See [`docs/INSTALL.md`](docs/INSTALL.md)

## Visitor Flow
1. Scan QR code → Opens registration page
2. Fill details (Name, ID, Company, Phone)
3. Capture ID photo + Selfie
4. Review & Submit
5. Receive visitor number via WhatsApp