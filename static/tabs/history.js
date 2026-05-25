/**
 * tabs/history.js
 * ---------------
 * Results history table. Loads from the CSV via /storage/results.
 * Filterable by PO number and test type.
 * Refreshes automatically when the tab becomes visible.
 */

function initHistoryTab() {
  const root = document.getElementById('history-root');
  root.innerHTML = `
    <div class="card">
      <div class="card-title">Results History</div>

      <!-- Filters -->
      <div style="display:flex; gap:12px; align-items:flex-end; margin-bottom:20px; flex-wrap:wrap;">
        <div style="flex:1; min-width:160px;">
          <label class="field-label">Filter by PO</label>
          <input id="hist-po-filter" class="field-input" placeholder="PO number…" />
        </div>
        <div style="min-width:160px;">
          <label class="field-label">Filter by Test</label>
          <select id="hist-test-filter" class="field-select">
            <option value="">All tests</option>
          </select>
        </div>
        <button class="btn btn-ghost" id="hist-refresh-btn">↺ Refresh</button>
        <button class="btn btn-ghost" id="hist-clear-filter-btn">Clear Filters</button>
      </div>

      <!-- Table -->
      <div id="hist-table-wrap" style="overflow-x:auto;">
        <table class="data-table">
          <thead>
            <tr>
              <th>Timestamp</th>
              <th>PO Number</th>
              <th>Test</th>
              <th>Result</th>
              <th>Notes</th>
            </tr>
          </thead>
          <tbody id="hist-tbody">
            <tr><td colspan="5" style="text-align:center; color:var(--text-muted);">Loading…</td></tr>
          </tbody>
        </table>
      </div>

      <div id="hist-empty" style="display:none; text-align:center; padding:32px; color:var(--text-muted);">
        No results found.
      </div>
    </div>
  `;

  // Populate test filter from equipment list
  apiGet('/api/equipment').then(eq => {
    const sel = document.getElementById('hist-test-filter');
    eq.forEach(e => {
      const opt = document.createElement('option');
      opt.value = e.test_id;
      opt.textContent = e.display_name;
      sel.appendChild(opt);
    });
  }).catch(() => {});

  document.getElementById('hist-refresh-btn').addEventListener('click', _histLoad);
  document.getElementById('hist-clear-filter-btn').addEventListener('click', () => {
    document.getElementById('hist-po-filter').value = '';
    document.getElementById('hist-test-filter').value = '';
    _histLoad();
  });
  document.getElementById('hist-po-filter').addEventListener('keydown', e => {
    if (e.key === 'Enter') _histLoad();
  });
  document.getElementById('hist-test-filter').addEventListener('change', _histLoad);

  // Refresh when history tab becomes active
  document.querySelector('[data-tab="history"]')?.addEventListener('click', _histLoad);

  _histLoad();
}

async function _histLoad() {
  const po     = document.getElementById('hist-po-filter')?.value.trim() || '';
  const testId = document.getElementById('hist-test-filter')?.value || '';

  const params = new URLSearchParams();
  if (po)     params.set('po_number', po);
  if (testId) params.set('test_id', testId);

  try {
    const rows = await apiGet(`/storage/results?${params}`);
    _histRender(rows);
  } catch (e) {
    document.getElementById('hist-tbody').innerHTML =
      `<tr><td colspan="5" style="color:var(--red)">Error loading results: ${e.message}</td></tr>`;
  }
}

function _histRender(rows) {
  const tbody = document.getElementById('hist-tbody');
  const empty = document.getElementById('hist-empty');

  if (!rows.length) {
    tbody.innerHTML = '';
    empty.style.display = 'block';
    return;
  }

  empty.style.display = 'none';
  tbody.innerHTML = rows.map(row => {
    const vals   = row.values || {};
    const result = _formatResult(row.test_id, vals);
    const ts     = row.timestamp ? row.timestamp.replace('T', ' ') : '—';

    return `
      <tr>
        <td>${ts}</td>
        <td style="color:var(--accent)">${row.po_number || '—'}</td>
        <td>${row.display_name || row.test_id}</td>
        <td style="color:var(--text)">${result}</td>
        <td style="color:var(--text-muted); font-family:inherit; font-size:12px">${row.notes || ''}</td>
      </tr>
    `;
  }).join('');
}

function _formatResult(testId, vals) {
  if (testId === 'moisture') {
    const mc = vals.moisture_pct != null ? `${vals.moisture_pct} %MC` : '—';
    const iw = vals.initial_weight_g != null ? `${vals.initial_weight_g}g → ` : '';
    const fw = vals.final_weight_g   != null ? `${vals.final_weight_g}g` : '';
    return `${mc}  ${iw}${fw}`;
  }
  if (testId === 'viscosity') {
    const v = vals.viscosity != null ? `${vals.viscosity} mPa·s` : '—';
    const r = vals.speed_rpm != null ? ` @ ${vals.speed_rpm} RPM` : '';
    return `${v}${r}`;
  }
  // Generic fallback for future equipment
  return Object.entries(vals)
    .filter(([, v]) => v != null)
    .map(([k, v]) => `${k}: ${v}`)
    .join('  |  ') || '—';
}
