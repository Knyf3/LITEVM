/**
 * LITEVM — Visitor Report Page Logic
 * IIFE-wrapped module, exposed as global 'App' for inline onclick handlers.
 */
(function () {
  'use strict';

  // ──────────────────────────────────────────────
  // STATE
  // ──────────────────────────────────────────────
  var state = {
    allData: [],       // full response data from server
    filteredData: [],  // after client-side search/filter
    currentPage: 1,
    pageSize: 25,
    isLoading: false,
  };

  // ──────────────────────────────────────────────
  // DOM SHORTCUTS
  // ──────────────────────────────────────────────
  var $ = function (id) { return document.getElementById(id); };
  var $$ = function (sel) { return document.querySelectorAll(sel); };

  // ──────────────────────────────────────────────
  // ESCAPING
  // ──────────────────────────────────────────────
  function escHtml(s) {
    return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\"/g, '&quot;');
  }

  function escAttr(s) {
    return String(s || '').replace(/\"/g, '&quot;').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  // ──────────────────────────────────────────────
  // INIT
  // ──────────────────────────────────────────────
  function init() {
    // Load tenant config first (no PIN in it any more — see verifyGuardPin)
    fetchSheetConfig().then(function () {
      // The session is authentic only if it still holds a PIN the server accepted. The old boolean
      // flag alone is no longer sufficient: the PIN is what the admin calls present, so a session
      // without one could not do anything anyway.
      if (sessionStorage.getItem('guardAuth') !== 'true' || !_storedPin()) {
        _clearPin();
        $('pin-overlay').classList.remove('hidden');
        $('pin-input').focus();
        setupPinHandler();
        return;
      }
      $('pin-overlay').classList.add('hidden');
      $('main-content').classList.remove('hidden');
      App.render();
      setupApp();
    });
  }

  // ──────────────────────────────────────────────
  // LOCALSTORAGE METADATA CACHE (4h TTL)
  // ──────────────────────────────────────────────
  var CACHE_TTL_MS = 4 * 60 * 60 * 1000; // 4 hours

  function cacheKey(name) {
    return 'litevm:' + CONFIG.SHEET_ID + ':' + name;
  }

  function readCacheFresh(name) {
    try {
      var raw = localStorage.getItem(cacheKey(name));
      if (!raw) return null;
      var entry = JSON.parse(raw);
      if (!entry || typeof entry.fetchedAt !== 'number') return null;
      if (Date.now() - entry.fetchedAt > CACHE_TTL_MS) return null;
      return entry.data;
    } catch (e) { return null; }
  }

  function readCacheStale(name) {
    try {
      var raw = localStorage.getItem(cacheKey(name));
      if (!raw) return null;
      var entry = JSON.parse(raw);
      return entry && entry.data !== undefined ? entry.data : null;
    } catch (e) { return null; }
  }

  function writeCache(name, data) {
    try {
      localStorage.setItem(cacheKey(name), JSON.stringify({ data: data, fetchedAt: Date.now() }));
    } catch (e) { /* storage full / privacy mode — ignore */ }
  }

  /**
   * F3 STAGE 2 (2026-09-13): the guard PIN is NO LONGER fetched from the backend — it is not
   * published any more (it used to ride along in ?action=config, so anyone could read it). The page
   * POSTs the entered PIN to ?action=guardLogin, which validates it server-side, and holds it for
   * the session so the admin calls can present it. sessionStorage is the right home: same origin,
   * cleared with the tab, and strictly better than the old arrangement where the server handed the
   * PIN to any caller who asked for it.
   */
  function _storedPin() {
    try { return sessionStorage.getItem('guardPin') || null; } catch (e) { return null; }
  }
  function _storePin(pin) {
    try { sessionStorage.setItem('guardPin', pin); } catch (e) { /* storage full / privacy mode */ }
  }
  function _clearPin() {
    try {
      sessionStorage.removeItem('guardPin');
      sessionStorage.removeItem('guardAuth');
    } catch (e) { /* ignore */ }
  }

  /** Validate the PIN server-side. Resolves {ok:true} | {ok:false, error, retryAfterSeconds?}. */
  function verifyGuardPin(pin) {
    return fetch(CONFIG.API_BASE + '?action=guardLogin', {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: JSON.stringify({
        action: 'guardLogin', sheetId: CONFIG.SHEET_ID, pin: pin,
        origin: window.location.origin,
      }),
      signal: AbortSignal.timeout(30000),
    })
      .then(function (r) { return r.text(); })
      .then(function (text) {
        var d;
        try { d = JSON.parse(text); } catch (e) { return { ok: false, error: 'Invalid server response' }; }
        if (d && d.status === 'ok') return { ok: true };
        // Only an explicit rejection is reported as a wrong PIN. An unrecognised response means the
        // backend has not been updated to Code 1.21.0 yet — say so rather than blaming the operator.
        var err = d && d.error;
        if (err === 'TOO_MANY_ATTEMPTS') {
          return { ok: false, error: 'Too many attempts. Try again in a few minutes.', retryAfterSeconds: d.retryAfterSeconds };
        }
        if (err === 'INVALID_PIN' || err === 'GUARD_UNAUTHORIZED') {
          return { ok: false, error: 'Incorrect PIN. Try again.' };
        }
        return { ok: false, error: 'Sign-in is unavailable right now (backend not updated?).' };
      })
      .catch(function (err) {
        return { ok: false, error: err && err.name === 'AbortError' ? 'Server timed out. Try again.' : 'Cannot reach the server.' };
      });
  }

  /** Tenant config (no PIN in it any more). Returns a promise; callers only need completion. */
  function fetchSheetConfig() {
    var cached = readCacheFresh('config');
    if (cached) return Promise.resolve(cached);

    return fetch(CONFIG.API_BASE + '?action=config&sheetId=' + CONFIG.SHEET_ID)
      .then(function (r) { return r.json(); })
      .then(function (data) {
        if (data && data.status === 'ok') {
          writeCache('config', data); // cache SUCCESS only
        }
        return data;
      })
      .catch(function () {
        return readCacheStale('config'); // may be null — the page works without it
      });
  }

  var _pinHandlerAttached = false;

  function setupPinHandler() {
    var input = $('pin-input');
    var error = $('pin-error');
    if (!input || !error) return;

    // Re-entrancy guard: this is also called when a session expires mid-use, and stacking a second
    // set of listeners would fire the login twice.
    if (_pinHandlerAttached) { input.focus(); return; }
    _pinHandlerAttached = true;

    var busy = false;

    function submit() {
      if (busy) return;
      var pin = input.value.trim();
      if (!pin) return;
      busy = true;
      error.classList.add('hidden');
      input.disabled = true;
      // F3 STAGE 2: the PIN is validated by the SERVER. The page no longer knows the answer, so
      // there is nothing here to read out of the bundle or the config response.
      verifyGuardPin(pin).then(function (res) {
        busy = false;
        input.disabled = false;
        if (!res.ok) {
          error.textContent = res.error;
          error.classList.remove('hidden');
          input.value = '';
          input.focus();
          return;
        }
        _storePin(pin);
        try { sessionStorage.setItem('guardAuth', 'true'); } catch (e) { /* ignore */ }
        $('pin-overlay').classList.add('hidden');
        $('main-content').classList.remove('hidden');
        App.render();
        setupApp();
      });
    }

    input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') {
        e.preventDefault();
        submit();
      }
    });

    input.addEventListener('input', function () {
      error.classList.add('hidden');
    });
  }

  function setupApp() {
    setDateDefaults();
    attachEventListeners();
    generateReport();
  }

  // ──────────────────────────────────────────────
  // DATE DEFAULTS & PRESETS
  // ──────────────────────────────────────────────
  function setDateDefaults() {
    var today = new Date();
    var yyyy = today.getFullYear();
    var mm = ('0' + (today.getMonth() + 1)).slice(-2);
    var dd = ('0' + today.getDate()).slice(-2);
    var dateStr = yyyy + '-' + mm + '-' + dd;

    $('date-from').value = dateStr;
    $('date-to').value = dateStr;

    // Activate Today preset
    $$('.preset-btn').forEach(function (btn) { btn.classList.remove('active'); });
    var todayBtn = document.querySelector('.preset-btn[data-preset="today"]');
    if (todayBtn) todayBtn.classList.add('active');
  }

  function applyPreset(preset) {
    var today = new Date();
    var yyyy = today.getFullYear();
    var mm = ('0' + (today.getMonth() + 1)).slice(-2);
    var dd = ('0' + today.getDate()).slice(-2);
    var todayStr = yyyy + '-' + mm + '-' + dd;

    var from, to;

    switch (preset) {
      case 'today':
        from = todayStr;
        to = todayStr;
        break;
      case 'yesterday':
        var yesterday = new Date(today);
        yesterday.setDate(yesterday.getDate() - 1);
        from = yesterday.getFullYear() + '-' + ('0' + (yesterday.getMonth() + 1)).slice(-2) + '-' + ('0' + yesterday.getDate()).slice(-2);
        to = from;
        break;
      case '7days':
        var sevenAgo = new Date(today);
        sevenAgo.setDate(sevenAgo.getDate() - 6);
        from = sevenAgo.getFullYear() + '-' + ('0' + (sevenAgo.getMonth() + 1)).slice(-2) + '-' + ('0' + sevenAgo.getDate()).slice(-2);
        to = todayStr;
        break;
      case 'month':
        var firstOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);
        from = firstOfMonth.getFullYear() + '-' + ('0' + (firstOfMonth.getMonth() + 1)).slice(-2) + '-' + ('0' + firstOfMonth.getDate()).slice(-2);
        to = todayStr;
        break;
      default:
        return;
    }

    $('date-from').value = from;
    $('date-to').value = to;

    // Toggle active class
    $$('.preset-btn').forEach(function (btn) { btn.classList.remove('active'); });
    var activeBtn = document.querySelector('.preset-btn[data-preset="' + preset + '"]');
    if (activeBtn) activeBtn.classList.add('active');
  }

  // ──────────────────────────────────────────────
  // EVENT LISTENERS
  // ──────────────────────────────────────────────
  function attachEventListeners() {
    // Generate button
    $('generate-btn').addEventListener('click', function () {
      generateReport();
    });

    // CSV export
    $('csv-btn').addEventListener('click', function () {
      exportCSV();
    });

    // Preset buttons
    $$('.preset-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        applyPreset(btn.getAttribute('data-preset'));
      });
    });

    // Search input with debounce
    var searchTimer;
    $('report-search').addEventListener('input', function () {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(function () {
        filterResults();
      }, 200);
    });

    // Status filter
    $('status-filter').addEventListener('change', function () {
      filterResults();
    });

    // Type filter
    $('type-filter').addEventListener('change', function () {
      filterResults();
    });

    // Pagination
    $('prev-page').addEventListener('click', function () {
      if (state.currentPage > 1) {
        state.currentPage--;
        renderTable();
      }
    });

    $('next-page').addEventListener('click', function () {
      var totalPages = Math.ceil(state.filteredData.length / state.pageSize) || 1;
      if (state.currentPage < totalPages) {
        state.currentPage++;
        renderTable();
      }
    });
  }

  // ──────────────────────────────────────────────
  // GENERATE REPORT
  // ──────────────────────────────────────────────
  function generateReport() {
    var from = $('date-from').value;
    var to = $('date-to').value;

    if (!from || !to) { showError('Please select date range'); return; }
    if (from > to) { showError('Start date must be before end date'); return; }

    state.isLoading = true;
    showLoading();

    var url = CONFIG.API_BASE + '?_t=' + Date.now();
    // mode:'full' requests the complete VisitorLog so date-range filtering works
    // across the whole history (the backend otherwise defaults to a bounded tail).
    // `origin` is required by the backend's admin origin gate (F3, 2026-09-13): admin actions are
    // no longer exempt from the allow-list, and the browser's real Origin header is not visible to
    // Apps Script — so the page has to declare where it is running from.
    var body = JSON.stringify({
      action: 'report', sheetId: CONFIG.SHEET_ID, fromDate: from, toDate: to, mode: 'full',
      origin: window.location.origin,
      // F3 STAGE 2: the server validates this PIN on every admin call.
      guardPin: _storedPin(),
    });

    fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: body,
      signal: AbortSignal.timeout(60000),
    })
      .then(function (r) { return r.text(); })
      .then(function (text) {
        var data;
        try { data = JSON.parse(text); } catch (e) { showError('Invalid server response'); return; }
        if (!data || data.status !== 'ok') {
          // F3 STAGE 2: the server rejects a missing, stale, or rate-limited PIN. Drop the session
          // and ask for it again rather than showing a bare failure.
          if (data && (data.error === 'GUARD_UNAUTHORIZED' || data.error === 'TOO_MANY_ATTEMPTS')) {
            _clearPin();
            $('main-content').classList.add('hidden');
            $('pin-overlay').classList.remove('hidden');
            var pe = $('pin-error');
            if (pe) {
              pe.textContent = data.error === 'TOO_MANY_ATTEMPTS'
                ? 'Too many attempts. Try again in a few minutes.'
                : 'Session expired — please enter the PIN again.';
              pe.classList.remove('hidden');
            }
            var pi = $('pin-input');
            if (pi) { pi.value = ''; pi.focus(); }
            setupPinHandler();
            return;
          }
          showError(data && data.message ? data.message : 'Request failed');
          return;
        }
        renderReport(data);
      })
      .catch(function (err) {
        if (err.name === 'AbortError') { showError('Request timed out. Try a narrower date range.'); }
        else { showError('Network error: ' + err.message); }
      })
      .finally(function () {
        state.isLoading = false;
        hideLoading();
      });
  }

  // ──────────────────────────────────────────────
  // RENDER REPORT
  // ──────────────────────────────────────────────
  function renderReport(data) {
    state.allData = data.visitors || [];
    state.filteredData = state.allData;
    state.currentPage = 1;
    updateSummary(data.summary);
    populateTypeFilter();
    renderTable();
    $('csv-btn').disabled = state.allData.length === 0;
    $('print-btn').disabled = state.allData.length === 0;
  }

  function populateTypeFilter() {
    var typeFilter = $('type-filter');
    if (!typeFilter) return;
    var types = {};
    state.allData.forEach(function (v) {
      var vt = v.visitorType || '—';
      types[vt] = (types[vt] || 0) + 1;
    });
    var html = '<option value="">All Types</option>';
    var keys = Object.keys(types).sort();
    for (var i = 0; i < keys.length; i++) {
      var k = keys[i];
      html += '<option value="' + escHtml(k) + '">' + escHtml(k) + ' (' + types[k] + ')</option>';
    }
    typeFilter.innerHTML = html;
  }

  function updateSummary(summary) {
    if (!summary) {
      $('summary-bar').classList.add('hidden');
      return;
    }

    var from = $('date-from').value;
    var to = $('date-to').value;

    // Format dates for display
    function formatDateDisplay(dateStr) {
      if (!dateStr) return '';
      var parts = dateStr.split('-');
      if (parts.length !== 3) return dateStr;
      var months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
      return parseInt(parts[2], 10) + ' ' + months[parseInt(parts[1], 10) - 1] + ' ' + parts[0];
    }

    var dateRange = formatDateDisplay(from) + ' – ' + formatDateDisplay(to);
    var text = summary.total + ' visitors · ' +
      summary.checkedIn + ' Checked In · ' +
      summary.pending + ' Pending · ' +
      summary.signedOut + ' Signed Out · ' +
      dateRange;

    // Add per-type breakdown
    if (summary.byType) {
      var typeKeys = Object.keys(summary.byType).sort();
      var typeParts = [];
      for (var t = 0; t < typeKeys.length; t++) {
        typeParts.push(typeKeys[t] + ': ' + summary.byType[typeKeys[t]]);
      }
      if (typeParts.length > 0) {
        text += ' · ' + typeParts.join(', ');
      }
    }

    $('summary-text').textContent = text;
    $('summary-bar').classList.remove('hidden');
  }

  // ──────────────────────────────────────────────
  // RENDER TABLE
  // ──────────────────────────────────────────────
  function renderTable() {
    var data = state.filteredData;
    var tbody = $('report-tbody');
    var container = $('report-table-container');
    var emptyState = $('empty-state');
    var mobileCards = $('mobile-cards');

    if (data.length === 0) {
      container.classList.add('hidden');
      emptyState.classList.remove('hidden');
      $('pagination').classList.add('hidden');
      tbody.innerHTML = '';
      mobileCards.innerHTML = '';
      return;
    }

    container.classList.remove('hidden');
    emptyState.classList.add('hidden');

    // Paginate
    var start = (state.currentPage - 1) * state.pageSize;
    var end = Math.min(start + state.pageSize, data.length);
    var pageData = data.slice(start, end);

    // Build table rows
    var html = '';
    var cardHtml = '';
    for (var i = 0; i < pageData.length; i++) {
      var v = pageData[i];
      var rowNum = start + i + 1;

      // Status badge color
      var badgeClass = 'status-badge ';
      if (v.status === 'Checked In') {
        badgeClass += 'badge-checked-in';
      } else if (v.status === 'Signed Out') {
        badgeClass += 'badge-signed-out';
      } else {
        badgeClass += 'badge-pending';
      }

      html += '<tr>' +
        '<td>' + rowNum + '</td>' +
        '<td>' + escHtml(v.visitorNumber) + '</td>' +
        '<td>' + escHtml(v.fullName) + '</td>' +
        '<td>' + escHtml(v.company) + '</td>' +
        '<td>' + escHtml(v.destination) + '</td>' +
        '<td>' + escHtml(v.visitorType || '—') + '</td>' +
        '<td>' + escHtml(v.visitationDate) + '</td>' +
        '<td><span class="' + badgeClass + '">' + escHtml(v.status) + '</span></td>' +
        '<td>' + escHtml(v.signInTime || '—') + '</td>' +
        '<td>' + escHtml(v.signOutTime || '—') + '</td>' +
        '</tr>';

      // Mobile card
      var statusBadgeColor = v.status === 'Checked In' ? '#22C55E' : (v.status === 'Signed Out' ? '#6B7280' : '#EAB308');
      cardHtml += '<div class="report-card">' +
        '<div class="rc-row"><span class="rc-label">Visitor #</span><span class="rc-value">' + escHtml(v.visitorNumber) + '</span></div>' +
        '<div class="rc-row"><span class="rc-label">Name</span><span class="rc-value">' + escHtml(v.fullName) + '</span></div>' +
        '<div class="rc-row"><span class="rc-label">Company</span><span class="rc-value">' + escHtml(v.company) + '</span></div>' +
        '<div class="rc-row"><span class="rc-label">Destination</span><span class="rc-value">' + escHtml(v.destination) + '</span></div>' +
        '<div class="rc-row"><span class="rc-label">Visitor Type</span><span class="rc-value">' + escHtml(v.visitorType || '—') + '</span></div>' +
        '<div class="rc-row"><span class="rc-label">Date</span><span class="rc-value">' + escHtml(v.visitationDate) + '</span></div>' +
        '<div class="rc-row"><span class="rc-label">Status</span><span class="rc-value" style="color:' + statusBadgeColor + ';font-weight:600">' + escHtml(v.status) + '</span></div>' +
        '<div class="rc-row"><span class="rc-label">Sign-In</span><span class="rc-value">' + escHtml(v.signInTime || '—') + '</span></div>' +
        '<div class="rc-row"><span class="rc-label">Sign-Out</span><span class="rc-value">' + escHtml(v.signOutTime || '—') + '</span></div>' +
        '</div>';
    }

    tbody.innerHTML = html;
    mobileCards.innerHTML = cardHtml;

    // Pagination
    var totalPages = Math.ceil(data.length / state.pageSize) || 1;
    $('prev-page').disabled = state.currentPage <= 1;
    $('next-page').disabled = state.currentPage >= totalPages;
    $('page-info').textContent = 'Page ' + state.currentPage + ' of ' + totalPages;
    $('pagination').classList.remove('hidden');
  }

  // ──────────────────────────────────────────────
  // SEARCH & FILTER
  // ──────────────────────────────────────────────
  function filterResults() {
    var query = $('report-search').value.trim().toLowerCase();
    var statusFilter = $('status-filter').value;
    var typeFilter = $('type-filter').value;

    state.filteredData = state.allData.filter(function (v) {
      if (statusFilter && v.status !== statusFilter) return false;
      if (typeFilter) {
        var vt = v.visitorType || '—';
        if (vt !== typeFilter) return false;
      }
      if (query) {
        var text = (v.fullName + ' ' + v.company + ' ' + v.visitorNumber + ' ' + v.destination + ' ' + (v.visitorType || '')).toLowerCase();
        return text.indexOf(query) >= 0;
      }
      return true;
    });

    state.currentPage = 1;
    renderTable();
  }

  // ──────────────────────────────────────────────
  // CSV EXPORT
  // ──────────────────────────────────────────────
  function exportCSV() {
    var data = state.filteredData;
    if (data.length === 0) return;

    var headers = ['Visitor #', 'Full Name', 'ID Number', 'Company', 'Destination', 'Visitor Type', 'Visitation Date', 'Phone', 'Email', 'Status', 'Sign-In', 'Sign-Out'];

    var rows = data.map(function (v) {
      return [
        v.visitorNumber, v.fullName, v.idNumber, v.company, v.destination,
        v.visitorType || '', v.visitationDate, v.phone, v.email, v.status, v.signInTime || '', v.signOutTime || '',
      ].map(csvCell).join(',');
    });

    var csv = '\uFEFF' + headers.join(',') + '\n' + rows.join('\n');
    var blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    var link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = 'LITEVM_Report_' + new Date().toISOString().slice(0, 10) + '.csv';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(link.href);
  }

  function csvCell(str) {
    var s = String(str || '').replace(/\"/g, '""');
    return s.indexOf(',') >= 0 || s.indexOf('"') >= 0 || s.indexOf('\n') >= 0 ? '"' + s + '"' : s;
  }

  // ──────────────────────────────────────────────
  // LOADING / ERROR DISPLAY
  // ──────────────────────────────────────────────
  function showError(msg) {
    var toast = $('error-toast');
    toast.textContent = msg || 'An error occurred';
    toast.classList.remove('hidden');
    setTimeout(function () {
      toast.classList.add('hidden');
    }, 5000);
  }

  function showLoading() {
    $('loading-overlay').classList.remove('hidden');
  }

  function hideLoading() {
    $('loading-overlay').classList.add('hidden');
  }

  // ──────────────────────────────────────────────
  // EXPOSE PUBLIC API
  // ──────────────────────────────────────────────
  window.App = {
    init: init,
    generateReport: generateReport,
    exportCSV: exportCSV,
    t: window.App.t,
    setLang: window.App.setLang,
    render: window.App.render,
  };

})();

document.addEventListener('DOMContentLoaded', function () { window.App.init(); });
