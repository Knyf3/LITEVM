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

### Local Verify Kiosk (LAN, ACT/UStar door control)

The local-network verify kiosk (`verifylocal.html`, guard PIN login, ACT/UStar
provisioning) is a **separate product repo**: [`Knyf3/verify-kiosk`](https://github.com/Knyf3/verify-kiosk)
(private, backend-neutral). One `settings.json` points it at ACTApi
(`ACTApiBase`), UStarAPI (`UStarApiBase`), or both. It is **not** served from
this repo and **not** packaged in the UStarAPI/ACTApi installers.

Deploy: clone the repo on the Windows box → `settings.example.json` →
`settings.json` → double-click `start_kiosk.bat` → `http://<pc>:8123`.

This repo keeps only the cloud (GitHub Pages) assets — `verify.html` guard
portal etc. Kiosk development happens in `verify-kiosk` from now on.

> **Full installation guide:** See [`docs/INSTALL.md`](docs/INSTALL.md)

## Visitor Flow
1. Scan QR code → Opens registration page
2. Fill details (Name, ID, Company, Phone)
3. Capture ID photo + Selfie
4. Review & Submit
5. Receive visitor number via WhatsApp