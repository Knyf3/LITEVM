/**
 * LITEVM — Configuration
 * Update API_BASE with your Google Apps Script Web App URL during deployment.
 */
const CONFIG = {
  SHEET_ID: '1-rHZEn2AWvezVBW3qfRLwOWE7mwHSxcV0_UJNVOSqAs',
  API_BASE: 'https://script.google.com/macros/s/AKfycbyQA6WibRYfpTJYA7syYaskM2n45csIs_sjzn-FfF8sNKaAFWOkIrNcRfYC-nTJc7JK/exec',
  SITE_NAME: 'Visitor Registration',
  DEFAULT_LANG: 'en',
  PHOTO_MAX_SIZE: 5 * 1024 * 1024,  // 5MB
  PHOTO_MAX_DIMENSION: 1024,  // max pixels on longest edge
  PHOTO_JPEG_QUALITY: 0.8,
  TIMEOUT_MS: 30000,
  GUARD_PIN: '1234',
  ACTApiBase: 'http://192.168.2.194:8021',  // Set to null for no ACT integration, or '' when served from ACTApi itself
  // Extra Rights defaults applied when granting ACT door access
  ACTExtraRights: {
    timezone: 1,
    validityDays: 1,
  },
};
