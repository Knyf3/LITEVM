/**
 * LITEVM — Application Logic
 * IIFE-wrapped module pattern, exposed as global 'App' for inline onclick handlers.
 */
(function () {
  'use strict';

  // ──────────────────────────────────────────────
  // STATE
  // ──────────────────────────────────────────────
  const state = {
    currentStep: 1,
    // Photos (base64 data URLs)
    idPhoto: null,    // { dataUrl, file or null }
    selfiePhoto: null, // { dataUrl, file or null }
    // Camera streams
    streams: { id: null, selfie: null },
    cameraActive: { id: false, selfie: false },
    cameraDenied: { id: false, selfie: false },
    submitting: false,
  };

  // ──────────────────────────────────────────────
  // DOM SHORTCUTS
  // ──────────────────────────────────────────────
  const $ = function (sel) { return document.querySelector(sel); };

  // ──────────────────────────────────────────────
  // INIT
  // ──────────────────────────────────────────────
  function init() {
    checkOnlineStatus();
    setupFormValidation();
    updateContinueButton();
    showStep(1);
  }

  // ──────────────────────────────────────────────
  // OFFLINE DETECTION
  // ──────────────────────────────────────────────
  function checkOnlineStatus() {
    var banner = $('#offline-banner');
    var dismiss = $('#offline-dismiss');
    if (!banner || !dismiss) return;

    function updateOnline() {
      if (!navigator.onLine) {
        banner.classList.remove('hidden');
        banner.classList.add('visible');
      } else {
        banner.classList.remove('visible');
        banner.classList.add('hidden');
      }
    }

    window.addEventListener('online', updateOnline);
    window.addEventListener('offline', updateOnline);
    dismiss.addEventListener('click', function () {
      banner.classList.remove('visible');
      banner.classList.add('hidden');
    });
    updateOnline();
  }

  // ──────────────────────────────────────────────
  // STEP NAVIGATION
  // ──────────────────────────────────────────────
  function showStep(n) {
    for (var i = 1; i <= 4; i++) {
      var el = document.getElementById('step-' + i);
      if (el) {
        el.classList.remove('active');
        el.classList.add('hidden');
      }
    }

    var target = document.getElementById('step-' + n);
    if (target) {
      target.classList.remove('hidden');
      target.classList.add('active');
    }

    state.currentStep = n;
    window.scrollTo({ top: 0, behavior: 'smooth' });

    if (n === 3) populateReview();
  }

  function goToStep(n) {
    if (n === 2) {
      if (!validateStep1()) return;
    }
    if (n === 3) {
      if (!state.idPhoto || !state.selfiePhoto) return;
    }
    if (n === 1) {
      stopAllCameras();
    }
    showStep(n);
  }

  // ──────────────────────────────────────────────
  // FORM VALIDATION
  // ──────────────────────────────────────────────
  var validators = {
    fullName: function (val) {
      if (!val || val.trim().length < 2) return 'Please enter your full name';
      return '';
    },
    idNumber: function (val) {
      if (!val || val.trim().length < 6) return 'Please enter a valid ID or passport number';
      if (!/^[a-zA-Z0-9\s\-\.\/]+$/.test(val.trim())) return 'Only letters, numbers, hyphens allowed';
      return '';
    },
    company: function (val) {
      if (!val || val.trim().length < 2) return 'Please enter your company name';
      return '';
    },
    phone: function (val) {
      if (!val || val.trim().length < 8) return 'Please enter a valid phone number (e.g. +60 12-345 6789)';
      var cleaned = val.trim().replace(/[\s\-\(\)]/g, '');
      if (!/^\+?\d{7,15}$/.test(cleaned)) return 'Please enter a valid phone number (e.g. +60 12-345 6789)';
      return '';
    },
  };

  function setupFormValidation() {
    var fields = ['fullName', 'idNumber', 'company', 'phone'];
    fields.forEach(function (name) {
      var input = document.getElementById(name);
      if (!input) return;

      input.addEventListener('blur', function () {
        validateField(name);
        updateContinueButton();
      });

      input.addEventListener('input', function () {
        var errorEl = document.getElementById(name + '-error');
        if (errorEl && errorEl.classList.contains('visible')) {
          validateField(name);
        }
        updateContinueButton();
      });
    });
  }

  function validateField(name) {
    var input = document.getElementById(name);
    var errorEl = document.getElementById(name + '-error');
    if (!input || !errorEl) return true;

    var val = input.value;
    var error = validators[name] ? validators[name](val) : '';

    if (error) {
      input.classList.add('error');
      input.classList.remove('valid');
      errorEl.textContent = error;
      errorEl.classList.add('visible');
      return false;
    } else if (val.trim().length > 0) {
      input.classList.remove('error');
      input.classList.add('valid');
      errorEl.textContent = '';
      errorEl.classList.remove('visible');
      return true;
    } else {
      input.classList.remove('error');
      input.classList.remove('valid');
      errorEl.textContent = '';
      errorEl.classList.remove('visible');
      return true;
    }
  }

  function validateStep1() {
    var fields = ['fullName', 'idNumber', 'company', 'phone'];
    var allValid = true;
    var firstInvalid = null;

    fields.forEach(function (name) {
      var input = document.getElementById(name);
      var valid = validateField(name);
      if (!valid) {
        allValid = false;
        if (!firstInvalid) firstInvalid = input;
      }
    });

    if (!allValid && firstInvalid) {
      firstInvalid.focus();
      firstInvalid.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
    return allValid;
  }

  function getFormData() {
    var nameEl = document.getElementById('fullName');
    var idEl = document.getElementById('idNumber');
    var compEl = document.getElementById('company');
    var phoneEl = document.getElementById('phone');
    return {
      fullName: nameEl ? nameEl.value : '',
      idNumber: idEl ? idEl.value : '',
      company: compEl ? compEl.value : '',
      phone: phoneEl ? phoneEl.value : '',
    };
  }

  function updateContinueButton() {
    var data = getFormData();
    var btn = document.getElementById('btn-step1-continue');
    if (!btn) return;

    var allValid = validators.fullName(data.fullName) === '' &&
                   validators.idNumber(data.idNumber) === '' &&
                   validators.company(data.company) === '' &&
                   validators.phone(data.phone) === '';

    if (allValid) {
      btn.disabled = false;
      var sub = btn.querySelector('.btn-subtitle');
      if (sub) sub.textContent = 'Tap to continue';
    } else {
      btn.disabled = true;
      var sub = btn.querySelector('.btn-subtitle');
      if (sub) sub.textContent = '(fill all fields to continue)';
    }
  }

  // ──────────────────────────────────────────────
  // PHOTO CAPTURE — CAMERA
  // ──────────────────────────────────────────────
  function openCamera(zone) {
    if (state.cameraDenied[zone]) {
      uploadPhoto(zone);
      return;
    }

    var facingMode = zone === 'id' ? 'environment' : 'user';
    var videoEl = document.getElementById(zone + '-video');
    var placeholder = document.getElementById(zone + '-placeholder');
    var captured = document.getElementById(zone + '-captured');
    var photoZone = document.getElementById(zone + '-photo-zone');
    var spinner = document.getElementById(zone + '-spinner');
    var actions = document.getElementById(zone + '-actions');
    var captureActions = document.getElementById(zone + '-capture-actions');

    placeholder.classList.add('hidden');
    captured.classList.add('hidden');
    actions.classList.add('hidden');
    captureActions.classList.remove('hidden');
    photoZone.classList.add('camera-active');
    photoZone.classList.remove('has-photo');
    spinner.classList.remove('hidden');

    var retakeBtn = document.getElementById(zone + '-btn-retake');
    var cancelBtn = document.getElementById(zone + '-btn-cancel');
    if (retakeBtn) retakeBtn.classList.add('hidden');
    if (cancelBtn) cancelBtn.classList.remove('hidden');

    if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
      navigator.mediaDevices.getUserMedia({
        video: { facingMode: facingMode, width: { ideal: 1280 }, height: { ideal: 960 } },
        audio: false,
      })
      .then(function (stream) {
        stopCamera(zone);
        state.streams[zone] = stream;
        state.cameraActive[zone] = true;
        videoEl.srcObject = stream;
        videoEl.classList.remove('hidden');
        spinner.classList.add('hidden');
        videoEl.play();

        var captureBtn = document.getElementById(zone + '-btn-capture');
        if (captureBtn) captureBtn.classList.remove('hidden');
      })
      .catch(function (err) {
        console.warn('Camera error for', zone, ':', err.message);
        spinner.classList.add('hidden');
        state.cameraDenied[zone] = true;
        showCameraWarning();
        resetPhotoZone(zone);
        uploadPhoto(zone);
      });
    } else {
      spinner.classList.add('hidden');
      state.cameraDenied[zone] = true;
      showCameraWarning();
      resetPhotoZone(zone);
      uploadPhoto(zone);
    }
  }

  function capturePhoto(zone) {
    var videoEl = document.getElementById(zone + '-video');
    var canvas = document.getElementById(zone + '-canvas');
    var captured = document.getElementById(zone + '-captured');
    var placeholder = document.getElementById(zone + '-placeholder');
    var photoZone = document.getElementById(zone + '-photo-zone');
    var captureActions = document.getElementById(zone + '-capture-actions');
    var actions = document.getElementById(zone + '-actions');

    if (!videoEl || !videoEl.videoWidth) return;

    canvas.width = videoEl.videoWidth;
    canvas.height = videoEl.videoHeight;

    var ctx = canvas.getContext('2d');
    if (zone === 'selfie') {
      ctx.translate(canvas.width, 0);
      ctx.scale(-1, 1);
    }
    ctx.drawImage(videoEl, 0, 0, canvas.width, canvas.height);
    if (zone === 'selfie') {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
    }

    var rawDataUrl = canvas.toDataURL('image/jpeg', CONFIG.PHOTO_JPEG_QUALITY);

    var spinner = document.getElementById(zone + '-spinner');
    spinner.classList.remove('hidden');
    var spinnerText = spinner.querySelector('span');
    if (spinnerText) spinnerText.textContent = 'Processing photo...';

    processImage(rawDataUrl, CONFIG.PHOTO_MAX_DIMENSION).then(function (resizedDataUrl) {
      spinner.classList.add('hidden');

      state[zone + 'Photo'] = { dataUrl: resizedDataUrl, file: null };

      captured.src = resizedDataUrl;
      captured.classList.remove('hidden');
      videoEl.classList.add('hidden');
      placeholder.classList.add('hidden');
      photoZone.classList.remove('camera-active');
      photoZone.classList.add('has-photo');
      stopCamera(zone);

      captureActions.classList.add('hidden');
      actions.classList.remove('hidden');

      var cameraBtn = document.getElementById(zone + '-btn-camera');
      var retakeBtn = document.getElementById(zone + '-btn-retake');
      if (cameraBtn) cameraBtn.classList.add('hidden');
      if (retakeBtn) retakeBtn.classList.remove('hidden');

      updateStep2Continue();
    });
  }

  function retakePhoto(zone) {
    state[zone + 'Photo'] = null;

    var captured = document.getElementById(zone + '-captured');
    var retakeBtn = document.getElementById(zone + '-btn-retake');
    var cameraBtn = document.getElementById(zone + '-btn-camera');
    var actions = document.getElementById(zone + '-actions');
    var photoZone = document.getElementById(zone + '-photo-zone');
    var placeholder = document.getElementById(zone + '-placeholder');

    if (captured) captured.classList.add('hidden');
    if (retakeBtn) retakeBtn.classList.add('hidden');
    if (cameraBtn) cameraBtn.classList.remove('hidden');
    if (actions) actions.classList.remove('hidden');
    if (photoZone) {
      photoZone.classList.remove('has-photo');
      photoZone.classList.remove('camera-active');
    }
    if (placeholder) placeholder.classList.remove('hidden');

    updateStep2Continue();
    openCamera(zone);
  }

  function cancelCamera(zone) {
    stopCamera(zone);
    resetPhotoZone(zone);
  }

  function stopCamera(zone) {
    if (state.streams[zone]) {
      state.streams[zone].getTracks().forEach(function (track) { track.stop(); });
      state.streams[zone] = null;
    }
    state.cameraActive[zone] = false;

    var videoEl = document.getElementById(zone + '-video');
    if (videoEl) {
      videoEl.classList.add('hidden');
      videoEl.srcObject = null;
    }
  }

  function stopAllCameras() {
    stopCamera('id');
    stopCamera('selfie');
  }

  function resetPhotoZone(zone) {
    var videoEl = document.getElementById(zone + '-video');
    var placeholder = document.getElementById(zone + '-placeholder');
    var captured = document.getElementById(zone + '-captured');
    var photoZone = document.getElementById(zone + '-photo-zone');
    var spinner = document.getElementById(zone + '-spinner');
    var actions = document.getElementById(zone + '-actions');
    var captureActions = document.getElementById(zone + '-capture-actions');

    if (videoEl) videoEl.classList.add('hidden');
    if (spinner) spinner.classList.add('hidden');
    if (photoZone) photoZone.classList.remove('camera-active');

    if (!state[zone + 'Photo']) {
      if (placeholder) placeholder.classList.remove('hidden');
      if (captured) captured.classList.add('hidden');
      if (photoZone) photoZone.classList.remove('has-photo');
      if (actions) actions.classList.remove('hidden');
      if (captureActions) captureActions.classList.add('hidden');

      var cameraBtn = document.getElementById(zone + '-btn-camera');
      var retakeBtn = document.getElementById(zone + '-btn-retake');
      if (cameraBtn) cameraBtn.classList.remove('hidden');
      if (retakeBtn) retakeBtn.classList.add('hidden');
    }

    stopCamera(zone);
  }

  function showCameraWarning() {
    var warning = document.getElementById('camera-warning');
    if (warning) warning.classList.remove('hidden');
  }

  // ──────────────────────────────────────────────
  // PHOTO UPLOAD (File picker)
  // ──────────────────────────────────────────────
  function uploadPhoto(zone) {
    var fileInput = document.getElementById(zone + '-file-input');
    if (!fileInput) return;

    fileInput.click();

    fileInput.onchange = function () {
      var file = fileInput.files[0];
      if (!file) return;

      if (file.size > CONFIG.PHOTO_MAX_SIZE) {
        alert('Photo is too large. Maximum size is 5MB.');
        fileInput.value = '';
        return;
      }

      var reader = new FileReader();
      reader.onload = function (e) {
        var dataUrl = e.target.result;

        var spinner = document.getElementById(zone + '-spinner');
        spinner.classList.remove('hidden');
        var spinnerText = spinner.querySelector('span');
        if (spinnerText) spinnerText.textContent = 'Processing photo...';

        processImage(dataUrl, CONFIG.PHOTO_MAX_DIMENSION).then(function (resized) {
          spinner.classList.add('hidden');
          state[zone + 'Photo'] = { dataUrl: resized, file: file };

          var captured = document.getElementById(zone + '-captured');
          var placeholder = document.getElementById(zone + '-placeholder');
          var photoZone = document.getElementById(zone + '-photo-zone');
          var videoEl = document.getElementById(zone + '-video');
          var actions = document.getElementById(zone + '-actions');
          var captureActions = document.getElementById(zone + '-capture-actions');

          captured.src = resized;
          captured.classList.remove('hidden');
          placeholder.classList.add('hidden');
          if (videoEl) videoEl.classList.add('hidden');
          photoZone.classList.remove('camera-active');
          photoZone.classList.add('has-photo');

          actions.classList.remove('hidden');
          captureActions.classList.add('hidden');

          var cameraBtn = document.getElementById(zone + '-btn-camera');
          var retakeBtn = document.getElementById(zone + '-btn-retake');
          if (cameraBtn) cameraBtn.classList.add('hidden');
          if (retakeBtn) retakeBtn.classList.remove('hidden');

          updateStep2Continue();
        });
      };
      reader.readAsDataURL(file);
      fileInput.value = '';
    };
  }

  // ──────────────────────────────────────────────
  // IMAGE RESIZE (async)
  // ──────────────────────────────────────────────
  function processImage(dataUrl, maxDimension) {
    return new Promise(function (resolve) {
      if (!dataUrl) { resolve(null); return; }

      var img = new Image();
      img.onload = function () {
        var w = img.width;
        var h = img.height;

        if (w <= maxDimension && h <= maxDimension) {
          resolve(dataUrl);
          return;
        }

        if (w > h) {
          if (w > maxDimension) {
            h = Math.round(h * maxDimension / w);
            w = maxDimension;
          }
        } else {
          if (h > maxDimension) {
            w = Math.round(w * maxDimension / h);
            h = maxDimension;
          }
        }

        var canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        var ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL('image/jpeg', CONFIG.PHOTO_JPEG_QUALITY));
      };
      img.onerror = function () { resolve(dataUrl); };
      img.src = dataUrl;
    });
  }

  // ──────────────────────────────────────────────
  // STEP 2 CONTINUE BUTTON
  // ──────────────────────────────────────────────
  function updateStep2Continue() {
    var btn = document.getElementById('btn-step2-continue');
    if (!btn) return;

    var idOk = state.idPhoto !== null;
    var selfieOk = state.selfiePhoto !== null;

    if (idOk && selfieOk) {
      btn.disabled = false;
      var sub = btn.querySelector('.btn-subtitle');
      if (sub) sub.textContent = 'Review your information';
    } else {
      btn.disabled = true;
      var sub = btn.querySelector('.btn-subtitle');
      if (sub) sub.textContent = '(capture both photos to continue)';
    }
  }

  // ──────────────────────────────────────────────
  // REVIEW (Step 3)
  // ──────────────────────────────────────────────
  function populateReview() {
    var data = getFormData();

    document.getElementById('review-name').textContent = data.fullName || '—';
    document.getElementById('review-id').textContent = data.idNumber || '—';
    document.getElementById('review-company').textContent = data.company || '—';
    document.getElementById('review-phone').textContent = data.phone || '—';

    var idThumb = document.getElementById('review-id-thumb');
    var idBadge = document.getElementById('review-id-badge');
    if (state.idPhoto) {
      idThumb.innerHTML = '<img src="' + state.idPhoto.dataUrl + '" alt="ID Photo">';
      idBadge.textContent = 'Captured ✓';
      idBadge.classList.add('captured');
    } else {
      idThumb.innerHTML = '';
      idBadge.textContent = 'Not captured';
      idBadge.classList.remove('captured');
    }

    var selfieThumb = document.getElementById('review-selfie-thumb');
    var selfieBadge = document.getElementById('review-selfie-badge');
    if (state.selfiePhoto) {
      selfieThumb.innerHTML = '<img src="' + state.selfiePhoto.dataUrl + '" alt="Selfie Photo">';
      selfieBadge.textContent = 'Captured ✓';
      selfieBadge.classList.add('captured');
    } else {
      selfieThumb.innerHTML = '';
      selfieBadge.textContent = 'Not captured';
      selfieBadge.classList.remove('captured');
    }
  }

  // ──────────────────────────────────────────────
  // SUBMIT
  // ──────────────────────────────────────────────
  function submitRegistration() {
    if (state.submitting) return;

    if (!state.idPhoto || !state.selfiePhoto) {
      showError('Please capture both photos before submitting.');
      return;
    }

    if (!validateStep1()) {
      showError('Please fill all required fields correctly.');
      return;
    }

    if (!navigator.onLine) {
      showError('You are offline. Please check your internet connection and try again.');
      return;
    }

    if (!CONFIG.API_BASE) {
      showError('API endpoint not configured. Please contact the administrator.');
      return;
    }

    state.submitting = true;
    showLoading(true);

    var data = getFormData();
    var payload = {
      fullName: data.fullName.trim(),
      idNumber: data.idNumber.trim(),
      company: data.company.trim(),
      phone: data.phone.trim(),
      idPhoto: state.idPhoto.dataUrl,
      selfie: state.selfiePhoto.dataUrl,
    };

    var xhr = new XMLHttpRequest();
    xhr.open('POST', CONFIG.API_BASE, true);
    xhr.setRequestHeader('Content-Type', 'application/json');
    xhr.timeout = CONFIG.TIMEOUT_MS;

    xhr.onload = function () {
      state.submitting = false;
      showLoading(false);

      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          var response = JSON.parse(xhr.responseText);
          if (response.status === 'ok') {
            showConfirmation(response.visitorNumber || 'V-' + getDateStamp() + '-001');
          } else {
            showError(response.error || 'Submission failed. Please try again.');
          }
        } catch (e) {
          showError('Invalid response from server. Please try again.');
        }
      } else {
        showError('Server error (' + xhr.status + '). Please try again.');
      }
    };

    xhr.onerror = function () {
      state.submitting = false;
      showLoading(false);
      showError('Network error. Please check your connection and try again.');
    };

    xhr.ontimeout = function () {
      state.submitting = false;
      showLoading(false);
      showError('Connection timed out. Please check your internet and try again.');
    };

    xhr.send(JSON.stringify(payload));
  }

  // ──────────────────────────────────────────────
  // LOADING OVERLAY
  // ──────────────────────────────────────────────
  function showLoading(show) {
    var overlay = document.getElementById('loading-overlay');
    if (!overlay) return;
    if (show) overlay.classList.remove('hidden');
    else overlay.classList.add('hidden');
  }

  // ──────────────────────────────────────────────
  // ERROR OVERLAY
  // ──────────────────────────────────────────────
  function showError(message) {
    var overlay = document.getElementById('error-overlay');
    var msgEl = document.getElementById('error-message');
    if (!overlay || !msgEl) return;
    msgEl.textContent = message || 'An error occurred. Please try again.';
    overlay.classList.remove('hidden');
  }

  function dismissError() {
    var overlay = document.getElementById('error-overlay');
    if (overlay) overlay.classList.add('hidden');
  }

  // ──────────────────────────────────────────────
  // CONFIRMATION
  // ──────────────────────────────────────────────
  function showConfirmation(visitorNumber) {
    document.getElementById('visitor-number').textContent = visitorNumber;
    showStep(4);
  }

  // ──────────────────────────────────────────────
  // UTILITY
  // ──────────────────────────────────────────────
  function getDateStamp() {
    var d = new Date();
    var y = d.getFullYear();
    var m = String(d.getMonth() + 1).padStart(2, '0');
    var day = String(d.getDate()).padStart(2, '0');
    return y + m + day;
  }

  function close() {
    window.close();
  }

  // ──────────────────────────────────────────────
  // PUBLIC API
  // ──────────────────────────────────────────────
  window.App = {
    init: init,
    goToStep: goToStep,
    openCamera: openCamera,
    capturePhoto: capturePhoto,
    retakePhoto: retakePhoto,
    cancelCamera: cancelCamera,
    uploadPhoto: uploadPhoto,
    submitRegistration: submitRegistration,
    dismissError: dismissError,
    close: close,
  };

  // Auto-init on DOM ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();