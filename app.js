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
    // Destinations
    destinations: [],
    destinationsLoading: false,
    destinationsError: null,
    destinationsAbort: null,
    fetchRetries: 0,
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
    fetchDestinations();
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
        if (!/^[a-zA-Z0-9\s\-\\.\/]+$/.test(val.trim())) return 'Only letters, numbers, hyphens allowed';
        return '';
      },
      company: function (val) {
        if (!val || val.trim().length < 2) return 'Please enter your company name';
        return '';
      },
      phone: function (val) {
        if (!val || val.trim().length < 8) return 'Please enter a valid phone number (e.g. +60 12-345 6789)';
        var cleaned = val.trim().replace(/[\s\-\\(\)]/g, '');
        if (!/^\+?\d{7,15}$/.test(cleaned)) return 'Please enter a valid phone number (e.g. +60 12-345 6789)';
        return '';
      },
      email: function (val) {
        if (!val || val.trim() === '') return 'Please enter your email address';
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(val.trim())) return 'Please enter a valid email address';
        return '';
      },
      destination: function (val) {
        if (!val || val.trim().length === 0) return 'Please select a destination';
        return '';
      },
    };

  function setupFormValidation() {
    var fields = ['fullName', 'idNumber', 'company', 'phone', 'email'];
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

    // Destination select validation
    var destSelect = document.getElementById('destination');
    if (destSelect) {
      destSelect.addEventListener('change', function () {
        validateField('destination');
        updateContinueButton();
      });
      destSelect.addEventListener('blur', function () {
        validateField('destination');
        updateContinueButton();
      });
    }
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
    var fields = ['fullName', 'idNumber', 'company', 'destination', 'phone', 'email'];
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
    var destEl = document.getElementById('destination');
    var phoneEl = document.getElementById('phone');
    var emailEl = document.getElementById('email');
    return {
      fullName: nameEl ? nameEl.value : '',
      idNumber: idEl ? idEl.value : '',
      company: compEl ? compEl.value : '',
      destination: destEl ? destEl.value : '',
      phone: phoneEl ? phoneEl.value : '',
      email: emailEl ? emailEl.value : '',
    };
  }

  function updateContinueButton() {
    var data = getFormData();
    var btn = document.getElementById('btn-step1-continue');
    if (!btn) return;

    var allValid = validators.fullName(data.fullName) === '' &&
                   validators.idNumber(data.idNumber) === '' &&
                   validators.company(data.company) === '' &&
                   validators.destination(data.destination) === '' &&
                   validators.phone(data.phone) === '' &&
                   validators.email(data.email) === '';

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
  // DESTINATIONS FETCH
  // ──────────────────────────────────────────────

  function fetchDestinations() {
    var select = document.getElementById('destination');
    if (!select) return;

    // Abort previous request if any
    if (state.destinationsAbort) {
      state.destinationsAbort.abort();
    }

    state.destinationsLoading = true;
    state.destinationsError = null;
    select.disabled = true;
    select.innerHTML = '<option value="" disabled selected>Loading destinations...</option>';

    var controller = new AbortController();
    state.destinationsAbort = controller;

    var timeoutId = setTimeout(function () {
      controller.abort();
    }, 8000);

    fetch(CONFIG.API_BASE + '?action=destinations&sheetId=' + encodeURIComponent(CONFIG.SHEET_ID), {
      method: 'GET',
      redirect: 'follow',
      signal: controller.signal,
    })
    .then(function (response) {
      clearTimeout(timeoutId);
      if (!response.ok) {
        throw new Error('Server responded with status ' + response.status);
      }
      return response.text();
    })
    .then(function (text) {
      state.destinationsLoading = false;
      state.destinationsAbort = null;

      var parsed;
      try {
        parsed = JSON.parse(text);
      } catch (e) {
        throw new Error('Invalid JSON response');
      }

      if (parsed.status !== 'ok') {
        throw new Error(parsed.message || 'Failed to load destinations');
      }

      var destArray = [];

      // Parse destinations from response format:
      // { destinations: [ { Pertamina: "BRI" }, ... ] }
      if (parsed.destinations && parsed.destinations.length > 0) {
        for (var i = 0; i < parsed.destinations.length; i++) {
          var item = parsed.destinations[i];
          // Get the first value from each item object
          for (var key in item) {
            if (item.hasOwnProperty(key)) {
              var val = item[key].trim();
              if (val.length > 0) {
                destArray.push(val);
              }
              break;
            }
          }
        }
      }

      state.destinations = destArray;
      state.fetchRetries = 0;

      if (destArray.length === 0) {
        state.destinationsError = 'No destinations configured';
        select.disabled = true;
        select.innerHTML = '<option value="" disabled selected>No destinations available</option>';
        var errorEl = document.getElementById('destination-error');
        if (errorEl) {
          errorEl.textContent = 'No destinations configured';
          errorEl.classList.add('visible');
        }
        updateContinueButton();
        return;
      }

      // Populate select
      select.disabled = false;
      var html = '<option value="" disabled selected>Select destination</option>';
      for (var j = 0; j < destArray.length; j++) {
        var escaped = destArray[j].replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
        html += '<option value="' + escaped + '">' + escaped + '</option>';
      }
      select.innerHTML = html;
      select.classList.remove('error');
      select.classList.remove('valid');

      var errorEl = document.getElementById('destination-error');
      if (errorEl) {
        errorEl.textContent = '';
        errorEl.classList.remove('visible');
      }

      updateContinueButton();
    })
    .catch(function (err) {
      clearTimeout(timeoutId);
      state.destinationsLoading = false;
      state.destinationsAbort = null;

      if (err.name === 'AbortError') return;

      state.fetchRetries++;
      state.destinationsError = err.message || 'Failed to load destinations';

      if (state.fetchRetries < 3) {
        // Auto-retry
        select.innerHTML = '<option value="" disabled selected>Retrying... (' + state.fetchRetries + '/3)</option>';
        setTimeout(fetchDestinations, 1500);
      } else {
        select.disabled = true;
        select.innerHTML = '<option value="" disabled selected>Failed to load</option>';
        var errorEl = document.getElementById('destination-error');
        if (errorEl) {
          errorEl.textContent = 'Failed to load destinations. ';
          var retryLink = document.createElement('a');
          retryLink.href = '#';
          retryLink.textContent = 'Tap to retry';
          retryLink.style.color = '#4361ee';
          retryLink.style.textDecoration = 'underline';
          retryLink.style.cursor = 'pointer';
          retryLink.onclick = function (e) {
            e.preventDefault();
            state.fetchRetries = 0;
            fetchDestinations();
          };
          errorEl.innerHTML = '';
          errorEl.appendChild(document.createTextNode('Failed to load destinations. '));
          errorEl.appendChild(retryLink);
          errorEl.classList.add('visible');
        }
        updateContinueButton();
      }
    });
  }

  function retryFetchDestinations() {
    state.fetchRetries = 0;
    fetchDestinations();
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
    document.getElementById('review-destination').textContent = data.destination || '—';
    document.getElementById('review-phone').textContent = data.phone || '—';
    document.getElementById('review-email').textContent = data.email || '—';

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
      destination: data.destination.trim(),
      phone: data.phone.trim(),
      email: data.email.trim(),
      idPhoto: state.idPhoto.dataUrl,
      selfie: state.selfiePhoto.dataUrl,
      sheetId: CONFIG.SHEET_ID,
    };
    var jsonBody = JSON.stringify(payload);

    // Use AbortController for timeout
    var controller = new AbortController();
    var timeoutId = setTimeout(function () {
      controller.abort();
    }, CONFIG.TIMEOUT_MS || 30000);

    fetch(CONFIG.API_BASE, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: jsonBody,
      redirect: 'follow',
      signal: controller.signal,
    })
    .then(function (response) {
      clearTimeout(timeoutId);
      if (!response.ok) {
        throw new Error('Server responded with status ' + response.status);
      }
      return response.text();
    })
    .then(function (text) {
      state.submitting = false;
      showLoading(false);

      var parsed;
      try {
        parsed = JSON.parse(text);
      } catch (e) {
        console.error('Submit: server returned non-JSON:', text.substring(0, 300));
        showError('Unexpected response from server. Please try again.');
        return;
      }

      if (parsed.status === 'ok') {
        showConfirmation(parsed.visitorNumber || 'V-' + getDateStamp() + '-001');
      } else {
        showError(parsed.error || 'Submission failed. Please try again.');
      }
    })
    .catch(function (err) {
      clearTimeout(timeoutId);
      state.submitting = false;
      showLoading(false);

      // If fetch failed (CORS / redirect / timeout), try sendBeacon as
      // a fire-and-forget fallback — it has NO CORS restrictions and the
      // POST itself is a simple request that always reaches the server.
      if (navigator.sendBeacon && err.name !== 'AbortError') {
        try {
          navigator.sendBeacon(CONFIG.API_BASE, jsonBody);
        } catch (beaconErr) {
          // sendBeacon failed too — nothing more we can do
        }
      }

      // Provide a more specific error message
      var msg;
      if (err.name === 'AbortError') {
        msg = 'Request timed out. Please check your connection and try again.';
      } else if (err.message && err.message.indexOf('status') >= 0) {
        msg = err.message + '. Please try again.';
      } else if (err.name === 'TypeError' && err.message.indexOf('Failed to fetch') >= 0) {
        msg = 'Connection failed. This may be a browser security restriction. Try again or use a different browser.';
      } else {
        msg = err.message || 'Network error. Please check your connection and try again.';
      }
      showError(msg);
    });
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

    // Generate QR code
    var qrContainer = document.getElementById('qrcode-container');
    if (qrContainer) {
      qrContainer.innerHTML = '';
      try {
        if (typeof QRCode !== 'undefined') {
          QRCode.toCanvas(qrContainer, visitorNumber, {
            width: 180,
            height: 180,
            margin: 2,
            color: {
              dark: '#1E293B',
              light: '#FFFFFF',
            },
          }, function (err) {
            if (err) console.warn('QR generation error:', err);
          });
        }
      } catch (e) {
        console.warn('QR Code library not available:', e.message);
      }
    }

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
    retryFetchDestinations: retryFetchDestinations,
    close: close,
  };

  // Auto-init on DOM ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();