/**
 * LITEVM — Configuration (Local kiosk mode)
 * Served by serve_local.bat from the LITEVM folder.
 * ACTApiBase must be the FULL ACTApi URL — the kiosk no longer runs
 * same-origin behind ACTApi (ACTApi is API-only; the kiosk lives in LITEVM).
 */
const CONFIG = {
  SHEET_ID: '1-rHZEn2AWvezVBW3qfRLwOWE7mwHSxcV0_UJNVOSqAs',
  API_BASE: 'https://script.google.com/macros/s/AKfycbyQA6WibRYfpTJYA7syYaskM2n45csIs_sjzn-FfF8sNKaAFWOkIrNcRfYC-nTJc7JK/exec',
  SITE_NAME: 'Visitor Registration',
  DEFAULT_LANG: 'en',
  PHOTO_MAX_SIZE: 5 * 1024 * 1024,
  PHOTO_MAX_DIMENSION: 1024,
  PHOTO_JPEG_QUALITY: 0.8,
  TIMEOUT_MS: 30000,
  GUARD_PIN: '1234',
  // Full ACTApi base URL (no trailing slash). Example: 'http://192.168.2.194:8021'
  // ACTApi must have CorsOrigins set to allow this kiosk's origin (e.g. http://localhost:8123).
  ACTApiBase: 'http://192.168.2.194:8021',
  // Extra Rights defaults applied when granting ACT door access
  ACTExtraRights: {
    timezone: 2,         // ACT timezone ID (2 = your preferred timezone)
    validityDays: 1,     // Number of days from today the right is valid
  },
};
