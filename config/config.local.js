/**
 * LITEVM — Configuration (Local ACTApi mode)
 * ACTApiBase is '' (empty) — same-origin calls to ACTApi for door access.
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
  ACTApiBase: '',
  // Extra Rights defaults applied when granting ACT door access
  ACTExtraRights: {
    timezone: 2,         // ACT timezone ID (2 = your preferred timezone)
    validityDays: 1,     // Number of days from today the right is valid
  },
};
