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
    // Check PIN gate
    if (sessionStorage.getItem('guardAuth') !== CONFIG.GUARD_PIN) {
      $('pin-overlay').classList.remove('hidden');
      $('pin-input').focus();
      setupPinHandler();
      return;
    }
    $('pin-overlay').classList.add('hidden');
    $('main-content').classList.remove('hidden');
    setupApp();
  }

  function setupPinHandler() {
    var input = $('pin-input');
    var error = $('pin-error');

    input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') {
        e.preventDefault();
        var pin = input.value.trim();
        if (pin === CONFIG.GUARD_PIN) {
          sessionStorage.setItem('guardAuth', 'true');
          $('pin-overlay').classList.add('hidden');
          $('main-content').classList.remove('hidden');
          setupApp();
        } else {
          error.classList.remove('hidden');
          input.value = '';
          input.focus();
        }
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

    var url = CONFIG.API_BASE + '?action=report&sheetId=' + encodeURIComponent(CONFIG.SHEET_ID) + '&_t=' + Date.now();
    var body = JSON.stringify({ fromDate: from, toDate: to });

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
        if (!data || data.status !== 'ok') { showError(data && data.message ? data.message : 'Request failed'); return; }
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
    renderTable();
    $('csv-btn').disabled = state.allData.length === 0;
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

    state.filteredData = state.allData.filter(function (v) {
      if (statusFilter && v.status !== statusFilter) return false;
      if (query) {
        var text = (v.fullName + ' ' + v.company + ' ' + v.visitorNumber + ' ' + v.destination).toLowerCase();
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

    var headers = ['Visitor #', 'Full Name', 'ID Number', 'Company', 'Destination', 'Visitation Date', 'Phone', 'Email', 'Status', 'Sign-In', 'Sign-Out'];

    var rows = data.map(function (v) {
      return [
        v.visitorNumber, v.fullName, v.idNumber, v.company, v.destination,
        v.visitationDate, v.phone, v.email, v.status, v.signInTime || '', v.signOutTime || '',
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
  };

})();

document.addEventListener('DOMContentLoaded', function () { window.App.init(); });
