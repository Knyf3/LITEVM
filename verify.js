/**
 * LITEVM — Guard Verification Logic
 * IIFE-wrapped module, exposed as global 'App' for inline onclick handlers.
 */
(function () {
  'use strict';

  // ──────────────────────────────────────────────
  // STATE
  // ──────────────────────────────────────────────
  const state = {
    currentVisitor: null,       // the currently loaded visitor object
    actionInProgress: false,    // prevent double-clicks
    lightboxIndex: 0,           // 0 = ID, 1 = Selfie
    photos: [],                 // [{label, url}]
    todayVisitors: [],          // full list of today's visitors
    currentFilter: 'all',       // 'all' | 'pending' | 'checkedin' | 'done' | 'rejected'
    inlinePendingVn: null,      // visitor number for inline quick check-in
    selectedVisitors: {},       // { visitorNumber: true }
    isBulkProcessing: false,
    provisionFailed: false,     // UStar gate-reader provisioning failed (red banner)
    provisionPayload: null,     // last provision payload for the retry button
  };

  // ──────────────────────────────────────────────
  // DOM SHORTCUTS
  // ──────────────────────────────────────────────
  const $ = function (sel) { return document.querySelector(sel); };
  const $$ = function (sel) { return document.querySelectorAll(sel); };

  // Null-safe text setter: writes textContent only when the element exists. The kiosk
  // (verifylocal.html) and online (verify.html) pages must stay layout-compatible with
  // showVisitor; a missing element must never abort the render (a throw here used to be
  // caught by lookup()'s catch and mislabelled "Network error").
  const setText = function (sel, value) {
    const el = $(sel);
    if (el) el.textContent = value || '—';
  };

  // ──────────────────────────────────────────────
  // INIT
  // ──────────────────────────────────────────────
  function init() {
    // Fetch config first (guard PIN from GAS), then proceed
    fetchSheetConfig().then(function () {
      if (!sessionStorage.getItem('guardAuth')) {
        showLogin();
        return;
      }
      showExpiryBanner();
      App.render();
      checkOnlineStatus();
      setupSearchInput();
      loadTodayVisitors();
      // Auto-refresh today's visitors every 30 seconds
      window.todayRefreshInterval = setInterval(loadTodayVisitors, 30000);
      // Focus search on load
      setTimeout(function () {
        var inp = $('#search-input');
        if (inp) inp.focus();
      }, 300);
    });
  }

  /** Fetch guard PIN and settings from GAS, store in memory. Returns a promise. */
  var _guardPin = '1234'; // fallback
  var _actEnabled = false; // ACTApi door access entitlement
  var _lastConfigData = null; // cached config response for expiry banner

  function fetchSheetConfig() {
    return fetch(CONFIG.API_BASE + '?action=config&sheetId=' + CONFIG.SHEET_ID)
      .then(function (r) { return r.json(); })
      .then(function (data) {
        _lastConfigData = data;
        if (data && data.status === 'ok' && data.guardPin) {
          _guardPin = data.guardPin;
        }
        // Store ACTApi entitlement flag from server
        if (data && typeof data.actEnabled === 'boolean') {
          _actEnabled = data.actEnabled;
        }
      })
      .catch(function () {
        // GAS unreachable — fallback to config.js value
        _lastConfigData = null;
        _guardPin = CONFIG.GUARD_PIN || '1234';
        _actEnabled = false;
      });
  }

  // ──────────────────────────────────────────────
  // GUARD AUTH
  // ──────────────────────────────────────────────
  function showLogin() {
    var overlay = $('#guard-login');
    var page = $('#verify-page');
    if (overlay) overlay.style.display = 'flex';
    if (page) page.style.overflow = 'hidden';
    // Focus PIN input
    setTimeout(function () {
      var input = $('#guard-pin-input');
      if (input) input.focus();
    }, 100);
  }

  function hideLogin() {
    var overlay = $('#guard-login');
    var page = $('#verify-page');
    if (overlay) overlay.style.display = 'none';
    if (page) page.style.overflow = '';
  }

  function setupGuardLogin() {
    var input = $('#guard-pin-input');
    var btn = $('#btn-guard-login');
    var error = $('#guard-login-error');
    if (!input || !btn || !error) return;

    input.addEventListener('input', function () {
      var val = input.value.trim();
      btn.disabled = val.length < 4;
      // Hide error while typing
      error.style.display = 'none';
    });

    input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') {
        e.preventDefault();
        if (!btn.disabled) attemptLogin();
      }
    });

    btn.addEventListener('click', function () {
      attemptLogin();
    });
  }

  function attemptLogin() {
    var input = $('#guard-pin-input');
    var error = $('#guard-login-error');
    if (!input || !error) return;

    var pin = input.value.trim();
    if (pin === _guardPin) {
      sessionStorage.setItem('guardAuth', 'true');
      hideLogin();
      // Run the normal init now
      showExpiryBanner();
      App.render();
      checkOnlineStatus();
      setupSearchInput();
      loadTodayVisitors();
      window.todayRefreshInterval = setInterval(loadTodayVisitors, 30000);
      setTimeout(function () {
        var inp = $('#search-input');
        if (inp) inp.focus();
      }, 300);
    } else {
      error.style.display = 'block';
      input.value = '';
      input.focus();
    }
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
  // EXPIRY BANNER
  // ──────────────────────────────────────────────
  function showExpiryBanner() {
    var banner = $('#expiry-banner');
    var dismiss = $('#expiry-banner-dismiss');
    var text = $('#expiry-banner-text');
    if (!banner || !text || !dismiss) return;

    // Dismiss button hides the banner (warning state only)
    dismiss.addEventListener('click', function () {
      banner.classList.add('hidden');
    });

    var data = _lastConfigData;
    if (!data) return;

    // Expired customer: config endpoint is denied by validateRequest and
    // returns {"status":"error","error":"Customer subscription expired."}
    var errMsg = (data.error || data.message || '').toLowerCase();
    if (data.status === 'error' && errMsg.indexOf('expired') !== -1) {
      banner.classList.remove('hidden', 'expiry-banner--warning');
      banner.classList.add('expiry-banner--error');
      text.textContent = App.t('expiry-expired');
      return;
    }

    // Expiring subscription
    if (data.expiryState === 'expiring') {
      var msg;
      var days = data.remainingDays;
      if (days === 0) {
        msg = App.t('expiry-warning-today');
      } else if (typeof days === 'number' && days > 0 && days === Math.floor(days)) {
        msg = App.t('expiry-warning-days').replace('{n}', String(days));
      } else {
        msg = App.t('expiry-warning-date-only');
      }
      banner.classList.remove('hidden', 'expiry-banner--error');
      banner.classList.add('expiry-banner--warning');
      text.textContent = msg;
      return;
    }

    // No expiry condition — keep banner hidden
    banner.classList.remove('expiry-banner--warning', 'expiry-banner--error');
    banner.classList.add('hidden');
  }

  // ──────────────────────────────────────────────
  // SEARCH INPUT BEHAVIOR
  // ──────────────────────────────────────────────
  function setupSearchInput() {
    var input = $('#search-input');
    var btn = $('#btn-lookup');
    if (!input || !btn) return;

    input.addEventListener('input', function () {
      var val = input.value.trim();
      btn.disabled = val.length < 3;
    });

    input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') {
        e.preventDefault();
        if (!btn.disabled) lookup();
      }
    });
  }

  // ──────────────────────────────────────────────
  // LOOKUP
  // ──────────────────────────────────────────────
  function lookup() {
    var input = $('#search-input');
    var vn = input.value.trim();
    if (!vn || vn.length < 3) return;
    if (state.actionInProgress) return;

    state.actionInProgress = true;
    setResultState('loading');

    var url = CONFIG.API_BASE + '?action=lookup&visitorNumber=' + encodeURIComponent(vn) + '&sheetId=' + encodeURIComponent(CONFIG.SHEET_ID) + '&_=' + Date.now();

    var controller = new AbortController();
    var timeoutId = setTimeout(function () {
      controller.abort();
      state.actionInProgress = false;
      setResultState('timeout');
    }, 60000);

    fetch(url, {
      method: 'GET',
      redirect: 'follow',
      signal: controller.signal,
      headers: { 'Content-Type': 'text/plain' },
    })
    .then(function (res) {
      clearTimeout(timeoutId);
      return res.text();
    })
    .then(function (text) {
      state.actionInProgress = false;
      var data;
      try { data = JSON.parse(text); } catch (e) {
        showError(App.t('unexpected-server-response'));
        setResultState('empty');
        return;
      }

      if (data.status === 'ok' && data.visitor) {
        showVisitor(data.visitor);
      } else if (data.status === 'notfound') {
        // If input doesn't look like a visitor number, try card lookup
        if (!/^V-/i.test(vn)) {
          tryCardLookup(vn);
          return;
        }
        setResultState('notfound');
        $('#not-found-message').textContent = data.message || App.t('not-found-message');
        $('#not-found-hint').textContent = suggestFormatHint(vn);
      } else if (data.status === 'error') {
        // Backend error (403 auth, 500, quota). Do NOT mask it as "not found" —
        // GAS error bodies carry `error`, not `message`. Surface it with retry.
        setResultState('notfound');
        $('#not-found-message').textContent = data.error || data.message || App.t('unexpected-server-response');
        $('#not-found-hint').textContent = App.t('tap-try-again-retry');
      } else {
        setResultState('notfound');
        $('#not-found-message').textContent = data.message || App.t('not-found-message');
        $('#not-found-hint').textContent = App.t('not-found-hint');
      }
    })
    .catch(function (err) {
      clearTimeout(timeoutId);
      state.actionInProgress = false;
      if (err.name === 'AbortError') return; // handled by timeout
      setResultState('notfound');
      $('#not-found-message').textContent = App.t('network-error');
      $('#not-found-hint').textContent = App.t('tap-try-again-retry');
    });
  }

  function tryCardLookup(cardNo) {
    var url = CONFIG.API_BASE + '?action=lookupByCard&cardNo=' + encodeURIComponent(cardNo) + '&sheetId=' + encodeURIComponent(CONFIG.SHEET_ID);

    fetch(url, {
      method: 'GET',
      redirect: 'follow',
      signal: AbortSignal.timeout(60000),
    })
    .then(function (res) { return res.text(); })
    .then(function (text) {
      state.actionInProgress = false;
      var data;
      try { data = JSON.parse(text); } catch (e) {
        setResultState('notfound');
        $('#not-found-message').textContent = App.t('err-card-not-found');
        $('#not-found-hint').textContent = App.t('err-visitor-number-format');
        return;
      }
      if (data.status === 'ok' && data.visitor) {
        showVisitor(data.visitor);
      } else {
        setResultState('notfound');
        $('#not-found-message').textContent = data.message || 'No registration found for card ' + cardNo;
        $('#not-found-hint').textContent = App.t('err-visitor-number-format');
      }
    })
    .catch(function (err) {
      state.actionInProgress = false;
      if (err.name === 'AbortError') {
        setResultState('timeout');
        return;
      }
      setResultState('notfound');
      $('#not-found-message').textContent = App.t('network-error');
      $('#not-found-hint').textContent = App.t('tap-try-again-retry');
    });
  }

  function suggestFormatHint(vn) {
    var match = vn.match(/V-(\d{8})-\d{3}/);
    if (match) {
      return App.t('err-no-match-today');
    }
    return App.t('err-visitor-number-format');
  }

  // ──────────────────────────────────────────────
  // SHOW VISITOR (Found state)
  // ──────────────────────────────────────────────
  function showVisitor(v) {
    state.currentVisitor = v;
    setResultState('found');

    // Status badge
    var status = v.status || 'Pending Entry';
    var badge = $('#status-badge');
    badge.className = 'status-badge';
    var statusText = $('#status-text');

    if (status === 'Checked In') {
      badge.classList.add('checked-in');
      statusText.textContent = App.t('status-checked-in');
    } else if (status === 'Rejected') {
      badge.classList.add('rejected');
      statusText.textContent = App.t('status-rejected');
    } else if (status === 'Signed Out') {
      badge.classList.add('signed-out');
      statusText.textContent = App.t('status-signed-out');
    } else {
      badge.classList.add('pending');
      statusText.textContent = App.t('status-pending');
    }

    // Meta
    setText('#result-visitor-number', v.visitorNumber);
    setText('#result-timestamp', v.registrationTime);
    if (v.signInTime) {
      setText('#result-sign-in-time', v.signInTime);
      const r = $('#result-sign-in-time-row'); if (r) r.classList.remove('hidden');
    } else {
      const r = $('#result-sign-in-time-row'); if (r) r.classList.add('hidden');
    }
    if (v.signOutTime) {
      setText('#result-sign-out-time', v.signOutTime);
      const r = $('#result-sign-out-time-row'); if (r) r.classList.remove('hidden');
    } else {
      const r = $('#result-sign-out-time-row'); if (r) r.classList.add('hidden');
    }

    // Identity
    setText('#result-name', v.fullName);
    setText('#result-id', v.idNumber);
    setText('#result-company', v.company);
    setText('#result-visitation-date', v.visitationDate);
    setText('#result-destination', v.destination);
    setText('#result-visitor-type', v.visitorType);
    setText('#result-phone', v.phone);

    // Card number for checked-in visitors
    var cardRow = $('#result-card-no-row');
    if (v.cardNo) {
      setText('#result-card-no', v.cardNo);
      if (cardRow) cardRow.classList.remove('hidden');
    } else {
      if (cardRow) cardRow.classList.add('hidden');
    }

    // Photos
    var idImg = $('#result-photo-id-img');
    var selfieImg = $('#result-photo-selfie-img');
    if (v.idPhotoUrl) {
      idImg.src = driveThumbUrl(v.idPhotoUrl);
      idImg.alt = 'ID Photo of ' + (v.fullName || 'visitor');
      idImg.classList.remove('photo-error');
    } else {
      idImg.src = '';
      idImg.alt = 'No ID photo';
      idImg.classList.add('photo-error');
    }
    if (v.selfieUrl) {
      selfieImg.src = driveThumbUrl(v.selfieUrl);
      selfieImg.alt = 'Selfie of ' + (v.fullName || 'visitor');
      selfieImg.classList.remove('photo-error');
    } else {
      selfieImg.src = '';
      selfieImg.alt = 'No selfie';
      selfieImg.classList.add('photo-error');
    }

    // Photos array for lightbox (use ORIGINAL Drive URLs for lightbox)
    state.photos = [];
    if (v.idPhotoUrl) state.photos.push({ label: 'ID Photo — ' + (v.fullName || ''), url: v.idPhotoUrl });
    if (v.selfieUrl) state.photos.push({ label: 'Selfie — ' + (v.fullName || ''), url: v.selfieUrl });

    // Action buttons visibility
    var actions = $('#result-actions');
    var processed = $('#result-processed-info');
    var signoutBtn = $('#btn-signout');
    if (status === 'Pending Entry') {
      actions.classList.remove('hidden');
      if (signoutBtn) signoutBtn.classList.add('hidden');
      $('#btn-verify').classList.remove('hidden');
      $('#btn-verify').disabled = false;
      $('#btn-reject').classList.remove('hidden');
      $('#btn-reject').disabled = false;
      processed.classList.add('hidden');
    } else if (status === 'Checked In') {
      // Show only sign-out button for checked-in visitors
      actions.classList.remove('hidden');
      if (signoutBtn) signoutBtn.classList.remove('hidden');
      $('#btn-verify').classList.add('hidden');
      $('#btn-reject').classList.add('hidden');
      processed.classList.add('hidden');
    } else {
      actions.classList.add('hidden');
      processed.classList.remove('hidden');
      if (status === 'Rejected') {
        $('#processed-info-text').textContent = App.t('prev-rejected');
      } else if (status === 'Signed Out') {
        $('#processed-info-text').textContent = App.t('already-signed-out');
      } else {
        $('#processed-info-text').textContent = App.t('already-checked-in');
      }
    }

    // Scroll result into view
    var section = $('#lookup-result-section');
    if (section) section.scrollIntoView({ behavior: 'smooth', block: 'nearest' });

    // Highlight in today's list if present
    highlightTodayVisitor(v.visitorNumber);
  }

  // ──────────────────────────────────────────────
  // SET RESULT STATE
  // ──────────────────────────────────────────────
  function setResultState(s) {
    var section = $('#lookup-result-section');
    if (!section) return;
    section.setAttribute('data-state', s);

    // Hide all result sub-states
    $$('.result-state').forEach(function (el) { el.classList.add('hidden'); });

    var map = {
      loading: 'result-loading',
      found: 'result-found',
      notfound: 'result-notfound',
      timeout: 'result-timeout',
      verified: 'result-verified',
      rejected: 'result-rejected',
      signedout: 'result-signedout',
    };

    if (map[s]) {
      var target = $('#' + map[s]);
      if (target) target.classList.remove('hidden');
      // Slide-in animation
      target.style.opacity = '0';
      target.style.transform = 'translateY(20px)';
      requestAnimationFrame(function () {
        target.style.transition = 'opacity 0.25s ease, transform 0.25s ease';
        target.style.opacity = '1';
        target.style.transform = 'translateY(0)';
      });
    }
  }

  // ──────────────────────────────────────────────
  // CONFIRM DIALOGS
  // ──────────────────────────────────────────────
  function confirmCheckIn() {
    if (!state.currentVisitor) return;
    showConfirmDialog('check-in');
  }

  function confirmReject() {
    if (!state.currentVisitor) return;
    showConfirmDialog('reject');
  }

  function confirmSignOut() {
    if (!state.currentVisitor) return;
    showConfirmDialog('sign-out');
  }

  function showConfirmDialog(type) {
    var v = state.currentVisitor;
    var dialog = $('#confirm-dialog');
    var icon = $('#confirm-icon');
    var title = $('#confirm-title');
    var msg = $('#confirm-message');
    var vn = $('#confirm-vn');
    var reasonSection = $('#confirm-reason-section');
    var actionBtn = $('#btn-confirm-action');
    var reasonTextarea = $('#reject-reason');

    if (type === 'reject') {
      icon.innerHTML = '<svg viewBox="0 0 24 24" width="36" height="36" fill="none" stroke="#e63946" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>';
      title.textContent = App.t('confirm-rejection');
      msg.innerHTML = App.t('confirm-reject-msg') + ' <strong>' + (v.fullName || 'this visitor') + '</strong>?';
      actionBtn.textContent = App.t('confirm-action-reject');
      actionBtn.className = 'btn-confirm-action btn-confirm-reject';
      reasonSection.classList.remove('hidden');
      if (reasonTextarea) reasonTextarea.value = '';
    } else if (type === 'sign-out') {
      icon.innerHTML = '<svg viewBox="0 0 24 24" width="36" height="36" fill="none" stroke="#F59E0B" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>';
      title.textContent = App.t('confirm-sign-out');
      msg.innerHTML = App.t('confirm-signout-msg') + ' <strong>' + (v.fullName || 'this visitor') + '</strong>?';
      actionBtn.textContent = App.t('confirm-action-signout');
      actionBtn.className = 'btn-confirm-action btn-confirm-signout';
      reasonSection.classList.add('hidden');
    } else {
      icon.innerHTML = '<svg viewBox="0 0 24 24" width="36" height="36" fill="none" stroke="#16A34A" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>';
      title.textContent = App.t('confirm-checkin');
      msg.innerHTML = App.t('confirm-checkin-msg') + ' <strong>' + (v.fullName || 'this visitor') + '</strong>?';
      actionBtn.textContent = App.t('confirm-action-checkin');
      actionBtn.className = 'btn-confirm-action btn-confirm-verify';
      reasonSection.classList.add('hidden');
    }

    vn.textContent = App.t('visitor') + ' ' + (v.visitorNumber || '—');
    dialog._actionType = type;
    dialog.classList.remove('hidden');
  }

  function closeDialog() {
    var dialog = $('#confirm-dialog');
    if (dialog) dialog.classList.add('hidden');
  }

  function executeAction() {
    var dialog = $('#confirm-dialog');
    var type = dialog._actionType || 'check-in';
    var status = type === 'reject' ? 'Rejected' : (type === 'sign-out' ? 'Signed Out' : 'Checked In');
    var reason = '';
    if (type === 'reject') {
      var ta = $('#reject-reason');
      if (ta) reason = ta.value.trim();
    }
    closeDialog();
    updateStatus(state.currentVisitor.visitorNumber, status, reason);
  }

  // ──────────────────────────────────────────────
  // UPDATE STATUS (POST)
  // ──────────────────────────────────────────────
  function updateStatus(visitorNumber, status, reason) {
    if (state.actionInProgress) return;
    state.actionInProgress = true;

    var overlay = $('#loading-overlay');
    if (overlay) overlay.classList.remove('hidden');

    var payload = {
      mode: 'updateStatus',
      visitorNumber: visitorNumber,
      status: status,
      sheetId: CONFIG.SHEET_ID,
      origin: window.location.origin,
    };
    if (reason) payload.rejectedReason = reason;

    fetch(CONFIG.API_BASE, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: JSON.stringify(payload),
      redirect: 'follow',
    })
    .then(function (res) { return res.text(); })
    .then(function (text) {
      state.actionInProgress = false;
      if (overlay) overlay.classList.add('hidden');

      var data;
      try { data = JSON.parse(text); } catch (e) {
        showError(App.t('unexpected-server-response'));
        return;
      }

      if (data.status === 'ok') {
        if (status === 'Checked In') {
          showVerifiedSuccess(state.currentVisitor, {
            cardNo: data.cardNo,
            cardQRUrl: data.cardQRUrl,
            cardStatus: data.cardStatus
          });

          // Grant ACT door access if card and door group are available
          if (data.cardNo && data.doorGroupId) {
            var actApiBase = CONFIG.ACTApiBase;
            if (actApiBase !== null && actApiBase !== undefined) {
              grantActAccess(data.cardNo, data.doorGroupId, actApiBase);
            }
          }

          // Provision the gate-reader credential (face + QR) — non-blocking, after ACT access.
          if (data.cardNo && data.doorGroupId && data.selfieUrl && data.visitorName) {
            provisionUstar(data.cardNo, data.doorGroupId, data.selfieUrl, data.visitorName);
          }
        } else if (status === 'Signed Out') {
          showSignedOutState(state.currentVisitor);
          // Revoke ACT door access if card was assigned
          var cardNo = data.cardNo || (state.currentVisitor && state.currentVisitor.cardNo);
          if (cardNo) {
            var actApiBase = CONFIG.ACTApiBase;
            if (actApiBase !== null && actApiBase !== undefined) {
              revokeActAccess(cardNo, actApiBase);
            }
          }
        } else {
          showRejectedState(state.currentVisitor);
        }
        // Refresh today's list
        loadTodayVisitors();
      } else {
        showError(data.message || App.t('err-failed-update-status'));
      }
    })
    .catch(function (err) {
      state.actionInProgress = false;
      if (overlay) overlay.classList.add('hidden');
      showError(App.t('err-network'));
    });
  }

  // ──────────────────────────────────────────────
  // VERIFIED SUCCESS STATE
  // ──────────────────────────────────────────────
  function showVerifiedSuccess(v, cardInfo) {
    setResultState('verified');
    $('#success-name').textContent = v.fullName || '';
    $('#success-vn').textContent = v.visitorNumber || '';
    var now = new Date();
    $('#success-time').textContent = formatTimestamp(now);

    // Card assignment display
    var cardSection = $('#success-card-assignment');
    var cardDepleted = $('#success-card-depleted');

    if (cardInfo && cardInfo.cardNo) {
      // Card was assigned — show card number and QR
      if (cardSection) {
        cardSection.classList.remove('hidden');
        $('#success-card-number').textContent = cardInfo.cardNo;
        if (cardInfo.cardQRUrl) {
          $('#success-card-qr').src = cardInfo.cardQRUrl;
          $('#success-card-qr-wrapper').classList.remove('hidden');
        }
      }
      if (cardDepleted) cardDepleted.classList.add('hidden');
    } else if (cardInfo && cardInfo.cardStatus === 'depleted') {
      // Pool exhausted — show warning
      if (cardSection) cardSection.classList.add('hidden');
      if (cardDepleted) cardDepleted.classList.remove('hidden');
    } else {
      // No card info (error or not applicable) — hide both
      if (cardSection) cardSection.classList.add('hidden');
      if (cardDepleted) cardDepleted.classList.add('hidden');
    }

    // Trigger animation
    var checkmark = $('.checkmark-path');
    if (checkmark) {
      checkmark.style.animation = 'none';
      void checkmark.offsetHeight;
      checkmark.style.animation = 'drawCheck 0.6s ease forwards';
    }

    // Pulse animation on card
    var card = $('.result-success-card');
    if (card) {
      card.style.animation = 'none';
      void card.offsetHeight;
      card.style.animation = 'successPulse 0.4s ease';
    }

    // Update state
    if (state.currentVisitor) state.currentVisitor.status = 'Checked In';
  }

  // ──────────────────────────────────────────────
  // REJECTED STATE
  // ──────────────────────────────────────────────
  function showRejectedState(v) {
    setResultState('rejected');
    $('#rejected-name').textContent = v.fullName || '';
    var now = new Date();
    $('#rejected-time').textContent = formatTimestamp(now);

    // Shake animation
    var card = $('.result-rejected-card');
    if (card) {
      card.style.animation = 'none';
      void card.offsetHeight;
      card.style.animation = 'shake 0.3s ease';
    }

    // Update state
    if (state.currentVisitor) state.currentVisitor.status = 'Rejected';
  }

  // ──────────────────────────────────────────────
  // SIGNED OUT STATE
  // ──────────────────────────────────────────────
  function showSignedOutState(v) {
    setResultState('signedout');
    $('#signedout-name').textContent = v.fullName || '';
    var now = new Date();
    $('#signedout-time').textContent = formatTimestamp(now);

    // Pulse animation
    var card = $('.result-signedout-card');
    if (card) {
      card.style.animation = 'none';
      void card.offsetHeight;
      card.style.animation = 'successPulse 0.4s ease';
    }

    // Update state
    if (state.currentVisitor) state.currentVisitor.status = 'Signed Out';
  }

  // ──────────────────────────────────────────────
  // CHECK IN ANOTHER / RESET
  // ──────────────────────────────────────────────
  function checkInAnother() {
    state.currentVisitor = null;
    state.actionInProgress = false;
    setResultState('empty');
    var input = $('#search-input');
    if (input) {
      input.value = '';
      input.focus();
    }
    $('#btn-lookup').disabled = true;
  }

  function resetSearch() {
    checkInAnother();
  }

  // ──────────────────────────────────────────────
  // TODAY'S VISITORS
  // ──────────────────────────────────────────────
  function loadTodayVisitors() {
    var loading = $('#todays-loading');
    if (loading) loading.classList.remove('hidden');

    var url = CONFIG.API_BASE + '?action=today&sheetId=' + encodeURIComponent(CONFIG.SHEET_ID);

    fetch(url, {
      method: 'GET',
      redirect: 'follow',
      headers: { 'Content-Type': 'text/plain' },
    })
    .then(function (res) { return res.text(); })
    .then(function (text) {
      if (loading) loading.classList.add('hidden');
      var data;
      try { data = JSON.parse(text); } catch (e) {
        return;
      }
      if (data.status === 'ok' && Array.isArray(data.visitors)) {
        state.todayVisitors = data.visitors;
        renderTodayVisitors();
        // Re-apply selections after refresh
        if (state.selectedVisitors) {
          var cbs = document.querySelectorAll('.visitor-checkbox');
          cbs.forEach(function(cb) {
            if (state.selectedVisitors[cb.dataset.vn]) {
              cb.checked = true;
            }
          });
          updateBulkSignOutButton();
        }
      }
    })
    .catch(function () {
      if (loading) loading.classList.add('hidden');
    });
  }

  function renderTodayVisitors() {
    var list = $('#todays-list');
    var empty = $('#todays-empty');
    var visitors = state.todayVisitors;

    if (!list || !empty) return;

    // Update counts
    var all = visitors.length;
    var pending = visitors.filter(function (v) { return v.status === 'Pending Entry' || !v.status; }).length;
    var checkedin = visitors.filter(function (v) { return v.status === 'Checked In'; }).length;
    var done = visitors.filter(function (v) { return v.status === 'Signed Out'; }).length;
    var rej = visitors.filter(function (v) { return v.status === 'Rejected'; }).length;

    $('#count-all').textContent = all;
    $('#count-pending').textContent = pending;
    $('#count-checkedin').textContent = checkedin;
    $('#count-done').textContent = done;
    $('#count-rejected').textContent = rej;
    $('#todays-count-badge').textContent = all;

    // Filter
    var filtered = visitors;
    if (state.currentFilter === 'pending') {
      filtered = visitors.filter(function (v) { return v.status === 'Pending Entry' || !v.status; });
    } else if (state.currentFilter === 'checkedin') {
      filtered = visitors.filter(function (v) { return v.status === 'Checked In'; });
    } else if (state.currentFilter === 'done') {
      filtered = visitors.filter(function (v) { return v.status === 'Signed Out' || v.status === 'Rejected'; });
    } else if (state.currentFilter === 'rejected') {
      filtered = visitors.filter(function (v) { return v.status === 'Rejected'; });
    }

    // Text filter
    var textFilter = $('#todays-filter-input');
    if (textFilter && textFilter.value.trim()) {
      var q = textFilter.value.trim().toLowerCase();
      filtered = filtered.filter(function (v) {
        var matches = (v.fullName || '').toLowerCase().indexOf(q) >= 0 ||
               (v.visitorNumber || '').toLowerCase().indexOf(q) >= 0 ||
               (v.company || '').toLowerCase().indexOf(q) >= 0;
        if (!matches && v.cardNo) {
          matches = v.cardNo.toLowerCase().indexOf(q) >= 0;
        }
        return matches;
      });
    }

    if (filtered.length === 0) {
      list.innerHTML = '';
      empty.classList.remove('hidden');
      return;
    }
    empty.classList.add('hidden');

    var html = '';
    var categoryMap = { pending: [], checkedin: [], checkedin_signout: [], rejected: [] };

    filtered.forEach(function (v) {
      var s = v.status || 'Pending Entry';
      var cat = 'pending';
      if (s === 'Checked In') cat = 'checkedin';
      else if (s === 'Rejected') cat = 'rejected';
      else if (s === 'Signed Out') cat = 'checkedin_signout';
      if (!categoryMap[cat]) categoryMap[cat] = [];
      categoryMap[cat].push(v);
    });

    // Render in category order: pending, checkedin, done (signed out), rejected
    var categories = [
      { key: 'pending', label: 'Pending', icon: '🔴' },
      { key: 'checkedin', label: 'Checked In', icon: '🟢' },
      { key: 'checkedin_signout', label: 'Done', icon: '✅' },
      { key: 'rejected', label: 'Rejected', icon: '❌' },
    ];

    categories.forEach(function (cat) {
      var items = categoryMap[cat.key] || [];
      if (items.length === 0) return;

      html += '<div class="today-category-header">' + cat.icon + ' ' + cat.label + '</div>';

      items.forEach(function (v) {
        var s = v.status || 'Pending Entry';
        var isPending = s === 'Pending Entry' || !s;
        var isCheckedIn = s === 'Checked In';

        html += '<div class="today-visitor-card" data-vn="' + escAttr(v.visitorNumber) + '" data-status="' + escAttr(s) + '">';
        html += '  <div class="today-card-row">';

        // Checkbox for checked-in rows, placeholder for others
        if (isCheckedIn) {
          html += '    <label class="today-checkbox" onclick="event.stopPropagation()">';
          html += '      <input type="checkbox" class="visitor-checkbox" data-vn="' + escAttr(v.visitorNumber) + '"';
          if (state.selectedVisitors[v.visitorNumber]) {
            html += ' checked';
          }
          html += '      >';
          html += '    </label>';
        } else {
          html += '    <div class="today-checkbox-placeholder"></div>';
        }

        html += '    <div class="today-card-main">';
        html += '      <div class="today-card-info">';
        html += '        <span class="today-vn">' + escHtml(v.visitorNumber || '') + '</span>';
        html += '        <span class="today-time">' + escHtml(v.registrationTime || '') + '</span>';
        html += '      </div>';
        html += '      <span class="today-name">' + escHtml(v.fullName || '') + '</span>';
        html += '      <span class="today-company">' + escHtml(v.company || '') + '</span>';
        html += '      <span class="today-company">' + escHtml(v.destination || '') + ' · ' + escHtml(v.visitorType || '') + '</span>';
        html += '    </div>';

        html += '  </div>'; // close today-card-row

        if (isPending) {
          html += '  <div class="today-card-actions">';
          html += '    <button class="btn-today-view" onclick="App.lookupNumber(\'' + escAttr(v.visitorNumber) + '\')" aria-label="View and verify">View &amp; Verify</button>';
          html += '    <button class="btn-today-checkin" onclick="App.quickCheckIn(\'' + escAttr(v.visitorNumber) + '\')" aria-label="Quick check in">Check In</button>';
          html += '  </div>';
        } else if (isCheckedIn) {
          html += '  <div class="today-card-actions">';
          html += '    <span class="today-status-badge checked-in-badge">Checked In</span>';
          if (v.cardNo) {
            html += '    <span class="today-cardno">Card: ' + escHtml(v.cardNo) + '</span>';
          }
          html += '    <button class="btn-today-signout" onclick="App.quickSignOut(\'' + escAttr(v.visitorNumber) + '\')" aria-label="Sign out">Sign Out</button>';
          html += '  </div>';
          if (v.signInTime) {
            html += '  <span class="today-action-time">' + escHtml(v.signInTime) + '</span>';
          }
        } else if (s === 'Signed Out') {
          html += '  <span class="today-status-badge signed-out-badge">Signed Out</span>';
          if (v.signOutTime) {
            html += '  <span class="today-action-time">Signed Out: ' + escHtml(v.signOutTime) + '</span>';
          }
        } else {
          html += '  <span class="today-status-badge rejected-badge">Rejected</span>';
          if (v.signInTime) {
            html += '  <span class="today-action-time">' + escHtml(v.signInTime) + '</span>';
          }
        }

        html += '</div>';
      });
    });

    list.innerHTML = html;

    // Set up checkbox event delegation on the container
    setupCheckboxDelegation();
  }

  // ──────────────────────────────────────────────
  // CHECKBOX DELEGATION (for bulk sign-out)
  // ──────────────────────────────────────────────
  function setupCheckboxDelegation() {
    var container = $('#todays-list');
    if (!container) return;
    // Remove old listener by cloning (won't have listener) and readding
    // Instead, just use a flag to avoid duplicates
    if (container._checkboxListenerAttached) return;
    container._checkboxListenerAttached = true;

    container.addEventListener('change', function(e) {
      if (e.target.classList.contains('visitor-checkbox')) {
        var vn = e.target.dataset.vn;
        if (e.target.checked) {
          state.selectedVisitors[vn] = true;
        } else {
          delete state.selectedVisitors[vn];
        }
        updateBulkSignOutButton();
      }
    });
  }

  // ──────────────────────────────────────────────
  // SELECT ALL / BULK SIGN-OUT
  // ──────────────────────────────────────────────
  function toggleSelectAll(checkbox) {
    if (checkbox.checked) {
      // Select all rows with status 'Checked In'
      var rows = document.querySelectorAll('.today-visitor-card');
      rows.forEach(function(row) {
        var statusEl = row.querySelector('.checked-in-badge');
        if (statusEl) {
          var cb = row.querySelector('.visitor-checkbox');
          if (cb) {
            cb.checked = true;
            state.selectedVisitors[cb.dataset.vn] = true;
          }
        }
      });
    } else {
      // Deselect all
      var cbs = document.querySelectorAll('.visitor-checkbox');
      cbs.forEach(function(cb) { cb.checked = false; });
      state.selectedVisitors = {};
    }
    updateBulkSignOutButton();
  }

  function updateBulkSignOutButton() {
    var count = Object.keys(state.selectedVisitors).length;
    var bar = document.getElementById('bulk-signout-bar');
    var btn = document.getElementById('btn-bulk-signout');
    var label = document.getElementById('bulk-signout-label');

    if (!bar || !btn || !label) return;

    if (count > 0) {
      bar.classList.remove('hidden');
      label.textContent = 'Sign Out Selected (' + count + ')';
      btn.disabled = false;
    } else {
      bar.classList.add('hidden');
      btn.disabled = true;
    }
  }

  function confirmBulkSignOut() {
    var count = Object.keys(state.selectedVisitors).length;
    if (count === 0) return;
    if (state.isBulkProcessing) return;

    var dialog = $('#confirm-dialog');
    var icon = $('#confirm-icon');
    var title = $('#confirm-title');
    var msg = $('#confirm-message');
    var vn = $('#confirm-vn');
    var reasonSection = $('#confirm-reason-section');
    var actionBtn = $('#btn-confirm-action');

    if (!dialog || !icon || !title || !msg || !vn || !reasonSection || !actionBtn) return;

    icon.innerHTML = '<svg viewBox="0 0 24 24" width="36" height="36" fill="none" stroke="#F59E0B" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>';
    title.textContent = App.t('bulk-sign-out');
    msg.textContent = App.t('btn-sign-out') + ' ' + count + ' ' + App.t('visitors') + (count > 1 ? '' : '') + '? ' + App.t('cards-released');
    vn.textContent = count + ' ' + App.t('sign-out-selected');
    reasonSection.classList.add('hidden');
    actionBtn.textContent = App.t('sign-out-all');
    actionBtn.className = 'btn-confirm-action btn-confirm-signout';

    // Override the execute action for bulk
    dialog._actionType = 'bulk-signout';
    actionBtn.onclick = function() {
      dialog.classList.add('hidden');
      executeBulkSignOut();
    };

    // Cancel
    var cancelBtn = document.querySelector('.btn-confirm-cancel');
    if (cancelBtn) {
      cancelBtn.onclick = function() {
        dialog.classList.add('hidden');
      };
    }

    dialog.classList.remove('hidden');
  }

  function executeBulkSignOut() {
    state.isBulkProcessing = true;
    var visitorNumbers = Object.keys(state.selectedVisitors);

    // Disable auto-refresh during operation
    if (window.todayRefreshInterval) {
      clearInterval(window.todayRefreshInterval);
      window.todayRefreshInterval = null;
    }

    // Show progress
    showProgress(App.t('signing-out-visitors'));

    var payload = {
      mode: 'bulkSignOut',
      visitorNumbers: visitorNumbers,
      sheetId: CONFIG.SHEET_ID,
      origin: window.location.origin,
    };

    fetch(CONFIG.API_BASE, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: JSON.stringify(payload),
      redirect: 'follow',
      signal: AbortSignal.timeout(60000),
    })
    .then(function(r) { return r.text(); })
    .then(function(text) {
      state.isBulkProcessing = false;
      hideProgress();

      var parsed;
      try { parsed = JSON.parse(text); } catch (e) {
        showError('Unexpected server response');
        restartTodayRefresh();
        return;
      }

      if (parsed.status === 'ok') {
        var summary = parsed.summary;
        var msg = summary.ok + ' signed out';
        if (summary.skipped > 0) msg += ', ' + summary.skipped + ' skipped';
        if (summary.error > 0) msg += ', ' + summary.error + ' failed';

        if (summary.ok > 0) {
          // Show success toast with details
          var toastMsg = msg + '. Cards released.';
          if (summary.error > 0 || summary.skipped > 0) {
            var details = '';
            parsed.results.forEach(function(r) {
              if (r.status !== 'ok') {
                details += '\n' + (r.visitorNumber || '?') + ': ' + (r.message || r.status);
              }
            });
            toastMsg += details;
          }
          showToast(toastMsg);
        } else {
          // Nothing succeeded — show error
          showError(msg || 'No visitors were signed out');
        }

        // Revoke ACT door access for each signed-out visitor with a card
        if (parsed.results && Array.isArray(parsed.results)) {
            var actApiBase = CONFIG.ACTApiBase;
            if (actApiBase !== null && actApiBase !== undefined) {
                parsed.results.forEach(function(r) {
                    if (r.cardNo) {
                        revokeActAccess(r.cardNo, actApiBase);
                    }
                });
            }
        }

        // Clear selections
        state.selectedVisitors = {};
        updateBulkSignOutButton();

        // Reload today's list
        loadTodayVisitors();
      } else {
        showError(parsed.error || 'Bulk sign-out failed');
        restartTodayRefresh();
      }
    })
    .catch(function(err) {
      state.isBulkProcessing = false;
      hideProgress();
      showError(err.message || 'Network error');
      restartTodayRefresh();
    });
  }

  function restartTodayRefresh() {
    if (!window.todayRefreshInterval) {
      window.todayRefreshInterval = setInterval(loadTodayVisitors, 30000);
    }
  }

  // ──────────────────────────────────────────────
  // PROGRESS / TOAST HELPERS
  // ──────────────────────────────────────────────
  function showProgress(text) {
    var el = document.getElementById('bulk-progress');
    var textEl = document.getElementById('bulk-progress-text');
    if (el) el.classList.remove('hidden');
    if (textEl && text) textEl.textContent = text;
  }

  function hideProgress() {
    var el = document.getElementById('bulk-progress');
    if (el) el.classList.add('hidden');
  }

  function showToast(message) {
    var toast = $('#toast-overlay');
    var msgEl = $('#toast-message');
    if (!toast || !msgEl) return;
    msgEl.textContent = message;
    toast.classList.remove('hidden');
    toast.onclick = function() { toast.classList.add('hidden'); };
    // Auto-dismiss after 4 seconds
    setTimeout(function() {
      toast.classList.add('hidden');
    }, 4000);
  }

  // ──────────────────────────────────────────────
  // TODAY'S LIST INTERACTIONS
  // ──────────────────────────────────────────────
  function lookupNumber(vn) {
    var input = $('#search-input');
    if (input) {
      input.value = vn;
      $('#btn-lookup').disabled = false;
    }
    // Scroll to search and trigger lookup
    var header = $('.page-header');
    if (header) header.scrollIntoView({ behavior: 'smooth' });
    setTimeout(function () {
      lookup();
      if (input) input.focus();
    }, 350);
  }

  function quickCheckIn(vn) {
    state.inlinePendingVn = vn;
    var visitor = state.todayVisitors.find(function (v) { return v.visitorNumber === vn; });
    if (!visitor) return;

    var bar = $('#inline-confirm-bar');
    if (!bar) return;
    $('#inline-confirm-text').textContent = App.t('check-in') + ' ' + (visitor.fullName || 'this visitor') + '?';
    bar.classList.remove('hidden');
    bar.setAttribute('data-vn', vn);

    // Scroll to bar
    bar.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  function dismissInlineConfirm() {
    var bar = $('#inline-confirm-bar');
    if (bar) bar.classList.add('hidden');
    state.inlinePendingVn = null;
  }

  function executeInlineCheckIn() {
    var vn = state.inlinePendingVn;
    if (!vn) return;
    dismissInlineConfirm();

    // Look up full data first
    state.currentVisitor = state.todayVisitors.find(function (v) { return v.visitorNumber === vn; });
    if (!state.currentVisitor) {
      showError('Visitor data not found. Please use the search instead.');
      return;
    }
    updateStatus(vn, 'Checked In', '');
  }

  // ──────────────────────────────────────────────
  // QUICK SIGN OUT (from today's list)
  // ──────────────────────────────────────────────
  function quickSignOut(visitorNumber) {
    if (!visitorNumber) return;
    var visitor = state.todayVisitors.find(function (v) { return v.visitorNumber === visitorNumber; });
    if (!visitor) return;

    state.currentVisitor = visitor;

    // Show the existing confirm dialog for sign-out
    showConfirmDialog('sign-out');

    // Override the action to use the specific visitor number
    var actionBtn = document.querySelector('.btn-confirm-signout');
    if (actionBtn) {
      actionBtn.onclick = function() {
        closeDialog();
        executeQuickSignOut(visitorNumber);
      };
    }
  }

  function executeQuickSignOut(visitorNumber) {
    showProgress('Signing out...');

    var payload = {
      mode: 'updateStatus',
      visitorNumber: visitorNumber,
      status: 'Signed Out',
      sheetId: CONFIG.SHEET_ID,
      origin: window.location.origin,
    };

    fetch(CONFIG.API_BASE, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: JSON.stringify(payload),
      redirect: 'follow',
      signal: AbortSignal.timeout(15000),
    })
    .then(function(r) { return r.text(); })
    .then(function(text) {
      hideProgress();
      var parsed;
      try { parsed = JSON.parse(text); } catch (e) {
        showError('Unexpected server response');
        return;
      }
      if (parsed.status === 'ok') {
        showToast('Signed out. Card released.');
        // Remove from selected visitors if present
        delete state.selectedVisitors[visitorNumber];
        updateBulkSignOutButton();
        // Reload list
        loadTodayVisitors();
        
        // Revoke ACT door access if card was assigned
        if (parsed.cardNo || (state.currentVisitor && state.currentVisitor.cardNo)) {
            var actApiBase = CONFIG.ACTApiBase;
            if (actApiBase !== null && actApiBase !== undefined) {
                revokeActAccess(parsed.cardNo || state.currentVisitor.cardNo, actApiBase);
            }
        }
      } else {
        showError(parsed.error || 'Sign out failed');
      }
    })
    .catch(function(err) {
      hideProgress();
      showError(err.message || 'Network error');
    });
  }

  // ──────────────────────────────────────────────
  // FILTER TODAY'S LIST
  // ──────────────────────────────────────────────
  function filterToday(filter) {
    state.currentFilter = filter;
    $$('.filter-tab').forEach(function (tab) {
      tab.classList.remove('active');
      if (tab.getAttribute('data-filter') === filter) tab.classList.add('active');
    });
    renderTodayVisitors();
  }

  function filterTodayInput() {
    renderTodayVisitors();
  }

  // ──────────────────────────────────────────────
  // PHOTO LIGHTBOX
  // ──────────────────────────────────────────────
  function openLightbox(type) {
    if (state.photos.length === 0) return;

    state.lightboxIndex = type === 'selfie' ? Math.min(1, state.photos.length - 1) : 0;

    var overlay = $('#photo-lightbox');
    if (!overlay) return;
    overlay.classList.remove('hidden');
    updateLightbox();

    // Trap focus
    setTimeout(function () {
      var closeBtn = $('.lightbox-close');
      if (closeBtn) closeBtn.focus();
    }, 100);
  }

  function updateLightbox() {
    var img = $('#lightbox-img');
    var caption = $('#lightbox-caption');
    var counter = $('#lightbox-counter');
    var prev = $('#lightbox-prev');
    var next = $('#lightbox-next');

    if (!img || state.photos.length === 0) return;

    var photo = state.photos[state.lightboxIndex];
    img.src = photo.url;
    caption.textContent = photo.label;
    counter.textContent = (state.lightboxIndex + 1) + ' / ' + state.photos.length;

    if (prev) prev.style.display = state.photos.length > 1 ? '' : 'none';
    if (next) next.style.display = state.photos.length > 1 ? '' : 'none';
  }

  function navigateLightbox(dir) {
    state.lightboxIndex += dir;
    if (state.lightboxIndex < 0) state.lightboxIndex = state.photos.length - 1;
    if (state.lightboxIndex >= state.photos.length) state.lightboxIndex = 0;
    updateLightbox();
  }

  function closeLightbox() {
    var overlay = $('#photo-lightbox');
    if (overlay) overlay.classList.add('hidden');
    $('#lightbox-img').src = '';
  }

  // ──────────────────────────────────────────────
  // ERROR OVERLAY
  // ──────────────────────────────────────────────
  function showError(message) {
    var overlay = $('#error-overlay');
    var msgEl = $('#error-message');
    if (!overlay || !msgEl) return;
    msgEl.textContent = message || App.t('an-error-occurred');
    overlay.classList.remove('hidden');
  }

  function dismissError() {
    var overlay = $('#error-overlay');
    if (overlay) overlay.classList.add('hidden');
  }

  // ──────────────────────────────────────────────
  // HELPERS
  // ──────────────────────────────────────────────

  /**
   * Convert a Google Drive view URL to a thumbnail URL for direct <img> display.
   * Input:  https://drive.google.com/file/d/FILE_ID/view?usp=drivesdk
   * Output: https://drive.google.com/thumbnail?id=FILE_ID&sz=w400
   */
  function driveThumbUrl(driveUrl) {
    if (!driveUrl) return '';
    var match = driveUrl.match(/\/file\/d\/([^\/\?]+)/) || driveUrl.match(/[?&]id=([^&#]+)/);
    if (match && match[1]) {
      // Local kiosk mode: use ACTApi photo proxy to avoid referrer blocking.
      // ACTApiBase is the full ACTApi URL (kiosk is served separately by LITEVM).
      if (CONFIG.ACTApiBase) {
        return CONFIG.ACTApiBase.replace(/\/+$/, '') + '/api/photo-proxy?id=' + match[1];
      }
      // Online mode: use direct Google Drive thumbnail (HTTPS)
      return 'https://drive.google.com/thumbnail?id=' + match[1] + '&sz=w400';
    }
    return driveUrl;
  }

  function formatTimestamp(date) {
    var d = date || new Date();
    var months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    var hours = d.getHours();
    var mins = String(d.getMinutes()).padStart(2, '0');
    var ampm = hours >= 12 ? 'PM' : 'AM';
    var h12 = hours % 12 || 12;
    return h12 + ':' + mins + ' ' + ampm + ' ' + d.getDate() + ' ' + months[d.getMonth()] + ' ' + d.getFullYear();
  }

  function escHtml(str) {
    if (!str) return '';
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function escAttr(str) {
    if (!str) return '';
    return str.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function highlightTodayVisitor(vn) {
    if (!vn) return;
    $$('.today-visitor-card').forEach(function (card) {
      card.classList.remove('highlighted');
      if (card.getAttribute('data-vn') === vn) {
        card.classList.add('highlighted');
      }
    });
  }

  // ──────────────────────────────────────────────
  // ESC KEY HANDLER
  // ──────────────────────────────────────────────
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') {
      var lightbox = $('#photo-lightbox');
      var dialog = $('#confirm-dialog');
      var inlineBar = $('#inline-confirm-bar');
      if (lightbox && !lightbox.classList.contains('hidden')) closeLightbox();
      else if (dialog && !dialog.classList.contains('hidden')) closeDialog();
      else if (inlineBar && !inlineBar.classList.contains('hidden')) dismissInlineConfirm();
    }
  });

  // Close lightbox/dialog overlay on backdrop click
  document.addEventListener('click', function (e) {
    var lightbox = $('#photo-lightbox');
    var dialog = $('#confirm-dialog');
    if (lightbox && e.target === lightbox) closeLightbox();
    if (dialog && e.target === dialog) closeDialog();
  });

  // ──────────────────────────────────────────────
  // ACT DOOR ACCESS
  // ──────────────────────────────────────────────
  /**
   * Grant ACT door access for a card. Non-blocking — failures are logged only.
   * @param {string} cardNo — The card/user number
   * @param {number} doorGroupId — The ACT door group ID
   * @param {string} apiBase — The ACTApi server base URL
   */
  function grantActAccess(cardNo, doorGroupId, apiBase) {
    if (!_actEnabled) {
      console.log('ACT door access skipped: tier not entitled (requires Pro plan or higher)');
      return;
    }
    var url = apiBase.replace(/\/+$/, '') + '/api/users/' + encodeURIComponent(cardNo) + '/extra-rights';

    // Build dates from config (default: today only)
    var extraRightsCfg = CONFIG.ACTExtraRights || { timezone: 1, validityDays: 1 };
    var now = new Date();
    var validityTo = new Date(now);
    validityTo.setDate(validityTo.getDate() + extraRightsCfg.validityDays);

    var payload = {
      userNumber: parseInt(cardNo, 10),
      rights: [{
        doorGroup: doorGroupId,
        timezone: extraRightsCfg.timezone,
        validityFrom: now.toISOString().split('T')[0] + 'T00:00:00',
        validityTo: validityTo.toISOString().split('T')[0] + 'T00:00:00'
      }]
    };

    fetch(url, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      redirect: 'follow'
    }).then(function (r) { return r.json(); })
    .then(function (data) {
      console.log('ACT door access granted for card ' + cardNo + ': ' + JSON.stringify(data));
    })
    .catch(function (err) {
      console.warn('ACT door access could not be granted: ' + err.message);
      // Non-blocking — don't show error to guard, just log it
    });
  }

  /**
   * Revoke ACT door access for a card. Non-blocking — failures are logged only.
   * @param {string} cardNo — The card/user number
   * @param {string} apiBase — The ACTApi server base URL
   */
  function revokeActAccess(cardNo, apiBase) {
    if (!_actEnabled) {
      console.log('ACT door access revoke skipped: tier not entitled (requires Pro plan or higher)');
      return;
    }
    var url = apiBase.replace(/\/+$/, '') + '/api/users/' + encodeURIComponent(cardNo) + '/extra-rights';

    fetch(url, {
      method: 'DELETE',
      redirect: 'follow'
    }).then(function (r) {
      if (r.ok) {
        console.log('ACT door access revoked for card ' + cardNo);
      } else {
        console.warn('ACT revoke returned ' + r.status + ' for card ' + cardNo);
      }
    }).catch(function (err) {
      console.warn('ACT door access could not be revoked: ' + err.message);
    });
  }

  // ──────────────────────────────────────────────
  // USTAR GATE-READER PROVISIONING
  // ──────────────────────────────────────────────
  /**
   * Provision the gate-reader credential (person + face + QR) via the UStarAPI facade.
   * Non-blocking — failures set provisionFailed and show the persistent red banner (MED-2).
   * Gated SOLELY by CONFIG.UStarApiBase (MED-4): UStarAPI is not an ACT entitlement, so this
   * must NOT mirror grantActAccess's _actEnabled tier guard.
   * @param {string} cardNo — the card number (also the device person id)
   * @param {number} doorGroupId — the LITEVM door group
   * @param {string} selfieUrl — the visitor selfie Drive URL
   * @param {string} visitorName — the visitor full name
   */
  function provisionUstar(cardNo, doorGroupId, selfieUrl, visitorName) {
    var base = CONFIG.UStarApiBase;
    if (base === null || base === undefined) {
      return; // online mode — no UStar integration
    }

    var payload = {
      cardNo: cardNo,
      doorGroupId: doorGroupId,
      visitorName: visitorName,
      selfieUrl: selfieUrl,
    };

    // Keep the last payload for the retry button, and clear any stale failure state.
    state.provisionPayload = payload;
    state.provisionFailed = false;
    hideProvisionBanner();

    fetch(base.replace(/\/+$/, '') + '/api/litevm/provision', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        // M8.8: the gateway's LitevmSecretMiddleware requires X-Litevm-Secret on /api/litevm/*
        // whenever Litevm:Secret is configured (it is, for sign-out). The kiosk carries the
        // shared secret in its own settings.json (LITEVM_SECRET, same trust domain as GUARD_PIN);
        // without this header every provision 401s (verified live 2026-08-30).
        'X-Litevm-Secret': (CONFIG && CONFIG.LITEVM_SECRET) || '',
      },
      body: JSON.stringify(payload),
      redirect: 'follow',
    })
    .then(function (r) { return r.json().catch(function () { return null; }); })
    .then(function (data) {
      var failed = !data || !Array.isArray(data.provisioned)
        || data.provisioned.some(function (p) { return !p.success; });
      if (failed) {
        state.provisionFailed = true;
        showProvisionBanner();
        console.warn('UStar provision failed for card ' + cardNo + ': ' + JSON.stringify(data));
        return;
      }
      console.log('UStar provision succeeded for card ' + cardNo);
    })
    .catch(function (err) {
      state.provisionFailed = true;
      showProvisionBanner();
      console.warn('UStar provision could not be sent: ' + err.message);
    });
  }

  /** Re-call provisionUstar with the last payload; the banner hides on success. */
  function retryProvision() {
    var payload = state.provisionPayload;
    if (!payload) return;
    provisionUstar(payload.cardNo, payload.doorGroupId, payload.selfieUrl, payload.visitorName);
  }

  function showProvisionBanner() {
    var banner = $('#ustar-provision-banner');
    if (banner) banner.classList.remove('hidden');
  }

  function hideProvisionBanner() {
    var banner = $('#ustar-provision-banner');
    if (banner) banner.classList.add('hidden');
  }

  // ──────────────────────────────────────────────
  // PUBLIC API
  // ──────────────────────────────────────────────
  window.App = {
    init: init,
    lookup: lookup,
    confirmCheckIn: confirmCheckIn,
    confirmReject: confirmReject,
    confirmSignOut: confirmSignOut,
    closeDialog: closeDialog,
    executeAction: executeAction,
    checkInAnother: checkInAnother,
    resetSearch: resetSearch,
    openLightbox: openLightbox,
    navigateLightbox: navigateLightbox,
    closeLightbox: closeLightbox,
    loadTodayVisitors: loadTodayVisitors,
    filterToday: filterToday,
    filterTodayInput: filterTodayInput,
    lookupNumber: lookupNumber,
    quickCheckIn: quickCheckIn,
    dismissInlineConfirm: dismissInlineConfirm,
    executeInlineCheckIn: executeInlineCheckIn,
    showError: showError,
    dismissError: dismissError,
    toggleSelectAll: toggleSelectAll,
    confirmBulkSignOut: confirmBulkSignOut,
    quickSignOut: quickSignOut,
    grantActAccess: grantActAccess,
    revokeActAccess: revokeActAccess,
    retryProvision: retryProvision,
    t: window.App.t,
    setLang: window.App.setLang,
    render: window.App.render,
    _lang: window.App._lang,
  };

  // Auto-init on DOM ready
  function onReady() {
    setupGuardLogin();
    init();
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', onReady);
  } else {
    onReady();
  }
})();