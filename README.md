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

## Visitor Flow
1. Scan QR code → Opens registration page
2. Fill details (Name, ID, Company, Phone)
3. Capture ID photo + Selfie
4. Review & Submit
5. Receive visitor number via WhatsApp