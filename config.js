/**
 * LITEVM — Configuration
 * Update API_BASE with your Google Apps Script Web App URL during deployment.
 */
const CONFIG = {
  API_BASE: '',  // e.g. 'https://script.google.com/macros/s/.../exec'
  SITE_NAME: 'Visitor Registration',
  PHOTO_MAX_SIZE: 5 * 1024 * 1024,  // 5MB
  PHOTO_MAX_DIMENSION: 1024,  // max pixels on longest edge
  PHOTO_JPEG_QUALITY: 0.8,
  TIMEOUT_MS: 30000,
};