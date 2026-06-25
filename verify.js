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
    currentFilter: 'all',       // 'all' | 'pending' | 'checked-in' | 'rejected'
    inlinePendingVn: null,      // visitor number for inline quick check-in
  };

  // ──────────────────────────────────────────────
  // DOM SHORTCUTS
  // ──────────────────────────────────────────────
  const $ = function (sel) { return document.querySelector(sel); };
  const $$ = function (sel) { return document.querySelectorAll(sel); };

  // ──────────────────────────────────────────────
  // INIT
  // ──────────────────────────────────────────────
  function init() {
    // Check if already authenticated this session
    if (!sessionStorage.getItem('guardAuth')) {
      showLogin();
      return;
    }
    checkOnlineStatus();
    setupSearchInput();
    loadTodayVisitors();
    // Auto-refresh today's visitors every 30 seconds
    setInterval(loadTodayVisitors, 30000);
    // Focus search on load
    setTimeout(function () {
      var inp = $('#search-input');
      if (inp) inp.focus();
    }, 300);
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
    if (pin === CONFIG.GUARD_PIN) {
      sessionStorage.setItem('guardAuth', 'true');
      hideLogin();
      // Run the normal init now
      checkOnlineStatus();
      setupSearchInput();
      loadTodayVisitors();
      setInterval(loadTodayVisitors, 30000);
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

    var url = CONFIG.API_BASE + '?action=lookup&visitorNumber=' + encodeURIComponent(vn) + '&sheetId=' + encodeURIComponent(CONFIG.SHEET_ID);

    var controller = new AbortController();
    var timeoutId = setTimeout(function () {
      controller.abort();
      state.actionInProgress = false;
      setResultState('notfound');
      $('#not-found-message').textContent = 'Request timed out. Please check your connection.';
      $('#not-found-hint').textContent = 'Make sure you have an internet connection and try again.';
    }, CONFIG.TIMEOUT_MS || 10000);

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
        showError('Unexpected server response. Please try again.');
        setResultState('empty');
        return;
      }

      if (data.status === 'ok' && data.visitor) {
        showVisitor(data.visitor);
      } else if (data.status === 'notfound') {
        setResultState('notfound');
        $('#not-found-message').textContent = data.message || 'No registration found for "' + vn + '".';
        $('#not-found-hint').textContent = suggestFormatHint(vn);
      } else {
        setResultState('notfound');
        $('#not-found-message').textContent = data.message || 'No registration found.';
        $('#not-found-hint').textContent = 'Please check the number and try again.';
      }
    })
    .catch(function (err) {
      clearTimeout(timeoutId);
      state.actionInProgress = false;
      if (err.name === 'AbortError') return; // handled by timeout
      setResultState('notfound');
      $('#not-found-message').textContent = 'Network error. Please check your connection.';
      $('#not-found-hint').textContent = 'Tap "Try Again" to retry.';
    });
  }

  function suggestFormatHint(vn) {
    var match = vn.match(/V-(\d{8})-\d{3}/);
    if (match) {
      return 'No match found for today. Make sure the number is correct.';
    }
    return 'Visitor numbers follow the format V-YYYYMMDD-NNN (e.g. V-20250622-001). Please check the number and try again.';
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
      statusText.textContent = 'Checked In';
    } else if (status === 'Rejected') {
      badge.classList.add('rejected');
      statusText.textContent = 'Rejected';
    } else {
      badge.classList.add('pending');
      statusText.textContent = 'Pending Entry';
    }

    // Meta
    $('#result-visitor-number').textContent = v.visitorNumber || '—';
    $('#result-timestamp').textContent = v.registrationTime || '—';
    if (v.actionTime) {
      $('#result-action-time').textContent = v.actionTime;
      $('#result-action-time-row').classList.remove('hidden');
    } else {
      $('#result-action-time-row').classList.add('hidden');
    }

    // Identity
    $('#result-name').textContent = v.fullName || '—';
    $('#result-id').textContent = v.idNumber || '—';
    $('#result-company').textContent = v.company || '—';
    $('#result-phone').textContent = v.phone || '—';

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
    if (status === 'Pending Entry') {
      actions.classList.remove('hidden');
      processed.classList.add('hidden');
      $('#btn-verify').disabled = false;
      $('#btn-reject').disabled = false;
    } else {
      actions.classList.add('hidden');
      processed.classList.remove('hidden');
      if (status === 'Checked In') {
        $('#processed-info-text').textContent = 'This visitor has already checked in. (Status: Checked In)';
      } else if (status === 'Rejected') {
        $('#processed-info-text').textContent = 'This registration was previously rejected. (Status: Rejected)';
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
      verified: 'result-verified',
      rejected: 'result-rejected',
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
      title.textContent = 'Confirm Rejection';
      msg.innerHTML = 'Are you sure you want to reject <strong>' + (v.fullName || 'this visitor') + '</strong>?';
      actionBtn.textContent = 'Confirm Reject';
      actionBtn.className = 'btn-confirm-action btn-confirm-reject';
      reasonSection.classList.remove('hidden');
      if (reasonTextarea) reasonTextarea.value = '';
    } else {
      icon.innerHTML = '<svg viewBox="0 0 24 24" width="36" height="36" fill="none" stroke="#16A34A" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>';
      title.textContent = 'Confirm Check-In';
      msg.innerHTML = 'Are you sure you want to check in <strong>' + (v.fullName || 'this visitor') + '</strong>?';
      actionBtn.textContent = 'Confirm Check-In';
      actionBtn.className = 'btn-confirm-action btn-confirm-verify';
      reasonSection.classList.add('hidden');
    }

    vn.textContent = 'Visitor: ' + (v.visitorNumber || '—');
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
    var status = type === 'reject' ? 'Rejected' : 'Checked In';
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
        showError('Unexpected server response. Please try again.');
        return;
      }

      if (data.status === 'ok') {
        if (status === 'Checked In') {
          showVerifiedSuccess(state.currentVisitor, {
            cardNo: data.cardNo,
            cardQRUrl: data.cardQRUrl,
            cardStatus: data.cardStatus
          });
        } else {
          showRejectedState(state.currentVisitor);
        }
        // Refresh today's list
        loadTodayVisitors();
      } else {
        showError(data.message || 'Failed to update status. Please try again.');
      }
    })
    .catch(function (err) {
      state.actionInProgress = false;
      if (overlay) overlay.classList.add('hidden');
      showError('Network error. Please check your connection and try again.');
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
    var done = visitors.filter(function (v) { return v.status === 'Checked In'; }).length;
    var rej = visitors.filter(function (v) { return v.status === 'Rejected'; }).length;

    $('#count-all').textContent = all;
    $('#count-pending').textContent = pending;
    $('#count-checked-in').textContent = done;
    $('#count-rejected').textContent = rej;
    $('#todays-count-badge').textContent = all;

    // Filter
    var filtered = visitors;
    if (state.currentFilter === 'pending') {
      filtered = visitors.filter(function (v) { return v.status === 'Pending Entry' || !v.status; });
    } else if (state.currentFilter === 'checked-in') {
      filtered = visitors.filter(function (v) { return v.status === 'Checked In'; });
    } else if (state.currentFilter === 'rejected') {
      filtered = visitors.filter(function (v) { return v.status === 'Rejected'; });
    }

    // Text filter
    var textFilter = $('#todays-filter-input');
    if (textFilter && textFilter.value.trim()) {
      var q = textFilter.value.trim().toLowerCase();
      filtered = filtered.filter(function (v) {
        return (v.fullName || '').toLowerCase().indexOf(q) >= 0 ||
               (v.visitorNumber || '').toLowerCase().indexOf(q) >= 0 ||
               (v.company || '').toLowerCase().indexOf(q) >= 0;
      });
    }

    if (filtered.length === 0) {
      list.innerHTML = '';
      empty.classList.remove('hidden');
      return;
    }
    empty.classList.add('hidden');

    var html = '';
    var categoryMap = { pending: [], 'checked-in': [], rejected: [] };

    filtered.forEach(function (v) {
      var s = v.status || 'Pending Entry';
      var cat = 'pending';
      if (s === 'Checked In') cat = 'checked-in';
      else if (s === 'Rejected') cat = 'rejected';
      if (!categoryMap[cat]) categoryMap[cat] = [];
      categoryMap[cat].push(v);
    });

    // Render in category order: pending, checked-in, rejected
    var categories = [
      { key: 'pending', label: 'Pending', icon: '🔴' },
      { key: 'checked-in', label: 'Checked In', icon: '✅' },
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
        html += '  <div class="today-card-main">';
        html += '    <div class="today-card-info">';
        html += '      <span class="today-vn">' + escHtml(v.visitorNumber || '') + '</span>';
        html += '      <span class="today-time">' + escHtml(v.registrationTime || '') + '</span>';
        html += '    </div>';
        html += '    <span class="today-name">' + escHtml(v.fullName || '') + '</span>';
        html += '    <span class="today-company">' + escHtml(v.company || '') + '</span>';
        html += '  </div>';

        if (isPending) {
          html += '  <div class="today-card-actions">';
          html += '    <button class="btn-today-view" onclick="App.lookupNumber(\'' + escAttr(v.visitorNumber) + '\')" aria-label="View and verify">View &amp; Verify</button>';
          html += '    <button class="btn-today-checkin" onclick="App.quickCheckIn(\'' + escAttr(v.visitorNumber) + '\')" aria-label="Quick check in">Check In</button>';
          html += '  </div>';
        } else if (isCheckedIn) {
          html += '  <span class="today-status-badge checked-in-badge">Checked In</span>';
          if (v.actionTime) {
            html += '  <span class="today-action-time">' + escHtml(v.actionTime) + '</span>';
          }
        } else {
          html += '  <span class="today-status-badge rejected-badge">Rejected</span>';
          if (v.actionTime) {
            html += '  <span class="today-action-time">' + escHtml(v.actionTime) + '</span>';
          }
        }

        html += '</div>';
      });
    });

    list.innerHTML = html;
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
    $('#inline-confirm-text').textContent = 'Check in ' + (visitor.fullName || 'this visitor') + '?';
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
    msgEl.textContent = message || 'An error occurred. Please try again.';
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
    var match = driveUrl.match(/\/file\/d\/([^\/]+)/);
    if (match && match[1]) {
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
  // PUBLIC API
  // ──────────────────────────────────────────────
  window.App = {
    init: init,
    lookup: lookup,
    confirmCheckIn: confirmCheckIn,
    confirmReject: confirmReject,
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