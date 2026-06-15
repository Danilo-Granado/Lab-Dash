/**
 * tabs/history.js
 * ---------------
 * Results history table. Loads from the CSV via /storage/results.
 * Filterable by PO number and test type.
 * Each row has an inline approval editor — operator can override status post-save.
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
        <div style="flex:1; min-width:160px;">
          <label class="field-label">Filter by Product</label>
          <input id="hist-prod-filter" class="field-input" placeholder="Product name…" />
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
              <th>Product</th>
              <th>Test</th>
              <th>Result</th>
              <th>Approval</th>
              <th>Notes</th>
              <th></th>
            </tr>
          </thead>
          <tbody id="hist-tbody">
            <tr><td colspan="8" style="text-align:center; color:var(--text-muted);">Loading…</td></tr>
          </tbody>
        </table>
      </div>

      <div id="hist-empty" style="display:none; text-align:center; padding:32px; color:var(--text-muted);">
        No results found.
      </div>
    </div>

    <!-- Inline override panel (shown below a row when Edit is clicked) -->
    <div class="card" id="hist-override-panel" style="display:none;">
      <div class="card-title">Override Approval Decision</div>
      <div id="hist-override-context" style="margin-bottom:16px; font-size:13px; color:var(--text-muted);"></div>

      <div class="field-group">
        <label class="field-label">New Decision</label>
        <select id="hist-override-status" class="field-select">
          <option value="approved">Approved</option>
          <option value="rejected">Rejected</option>
          <option value="override_approved">Override → Approved</option>
          <option value="override_rejected">Override → Rejected</option>
        </select>
      </div>

      <div class="field-group">
        <label class="field-label">
          Justification
          <span id="hist-just-required" style="color:var(--red); display:none"> *</span>
        </label>
        <textarea id="hist-override-justification" class="field-input" rows="3"
                  placeholder="Required for override decisions…" style="resize:vertical;"></textarea>
      </div>

      <div class="btn-row">
        <button class="btn btn-primary" id="hist-override-save">Save Decision</button>
        <button class="btn btn-ghost"   id="hist-override-cancel">Cancel</button>
      </div>
      <div id="hist-override-alert" style="margin-top:10px;"></div>
    </div>
  `;

  // Populate test filter
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
    document.getElementById('hist-prod-filter').value = '';
    document.getElementById('hist-test-filter').value = '';
    _histLoad();
  });
  document.getElementById('hist-po-filter').addEventListener('keydown', e => {
    if (e.key === 'Enter') _histLoad();
  });
  document.getElementById('hist-prod-filter').addEventListener('keydown', e => {
    if (e.key === 'Enter') _histLoad();
  });
  document.getElementById('hist-test-filter').addEventListener('change', _histLoad);

  // Show/hide justification required marker based on override status
  document.getElementById('hist-override-status').addEventListener('change', e => {
    const isOverride = e.target.value.startsWith('override_');
    document.getElementById('hist-just-required').style.display = isOverride ? 'inline' : 'none';
  });

  document.getElementById('hist-override-cancel').addEventListener('click', _histCloseOverride);
  document.getElementById('hist-override-save').addEventListener('click', _histSaveOverride);

  // Refresh when history tab is clicked
  document.querySelector('[data-tab="history"]')?.addEventListener('click', _histLoad);

  _histLoad();
}

// ── Data loading ──────────────────────────────────────────────────────────────

async function _histLoad() {
  const po     = document.getElementById('hist-po-filter')?.value.trim() || '';
  const prod   = document.getElementById('hist-prod-filter')?.value.trim() || '';
  const testId = document.getElementById('hist-test-filter')?.value || '';

  const params = new URLSearchParams();
  if (po)     params.set('po_number', po);
  if (prod)   params.set('product_name', prod);
  if (testId) params.set('test_id', testId);

  try {
    const rows = await apiGet(`/storage/results?${params}`);
    _histRender(rows);
  } catch (e) {
    document.getElementById('hist-tbody').innerHTML =
      `<tr><td colspan="8" style="color:var(--red)">Error loading results: ${e.message}</td></tr>`;
  }
}

// ── Rendering ─────────────────────────────────────────────────────────────────

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
    const { badge, text } = _approvalBadge(row.approval_status, row.override_justification);

    return `
      <tr id="hist-row-${_rowId(row.timestamp)}">
        <td>${ts}</td>
        <td style="color:var(--accent)">${row.po_number || '—'}</td>
        <td style="color:var(--text-dim)">${row.product_name || '—'}</td>
        <td>${row.display_name || row.test_id}</td>
        <td style="color:var(--text)">${result}</td>
        <td>
          <span ${badge}>${text}</span>
          ${row.override_justification
            ? `<div style="font-size:11px; color:var(--text-muted); margin-top:3px; font-family:inherit;">
                 ↳ ${row.override_justification}
               </div>`
            : ''}
        </td>
        <td style="color:var(--text-muted); font-family:inherit; font-size:12px;">${row.notes || ''}</td>
        <td>
          <button class="btn btn-ghost" style="padding:4px 10px; font-size:11px;"
                  onclick="_histOpenOverride('${row.timestamp}', '${row.approval_status}', '${row.display_name || row.test_id}', '${row.po_number}')">
            Edit
          </button>
        </td>
      </tr>
    `;
  }).join('');
}

function _rowId(timestamp) {
  return (timestamp || '').replace(/[:.]/g, '-');
}

function _approvalBadge(status, justification) {
  const styles = {
    approved:          'background:var(--green-dim); color:#6ee7b7; border:1px solid var(--green)',
    rejected:          'background:var(--red-dim);   color:#fca5a5; border:1px solid var(--red)',
    override_approved: 'background:var(--amber-dim); color:#fcd34d; border:1px solid var(--amber)',
    override_rejected: 'background:var(--amber-dim); color:#fcd34d; border:1px solid var(--amber)',
  };
  const labels = {
    approved:          'Approved',
    rejected:          'Rejected',
    override_approved: 'Override ✓',
    override_rejected: 'Override ✗',
  };
  const s = status || 'approved';
  const style = styles[s] || styles.approved;
  return {
    badge: `style="display:inline-block; padding:2px 8px; border-radius:4px; font-size:11px; font-weight:600; ${style}"`,
    text:  labels[s] || s,
  };
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
  if (testId === 'density') {
    const d = vals.density != null ? `${vals.density} g/mL` : '—';
    const p = vals.picnometer_id != null ? ` (ID: ${vals.picnometer_id})` : '';
    return `${d}${p}`;
  }
  // Generic fallback for future equipment
  return Object.entries(vals)
    .filter(([, v]) => v != null)
    .map(([k, v]) => `${k}: ${v}`)
    .join('  |  ') || '—';
}

// ── Override panel ────────────────────────────────────────────────────────────

let _editingTimestamp = null;

function _histOpenOverride(timestamp, currentStatus, testName, poNumber) {
  _editingTimestamp = timestamp;

  document.getElementById('hist-override-context').innerHTML = `
    <strong>${testName}</strong> &nbsp;·&nbsp; PO: <span style="color:var(--accent)">${poNumber}</span>
    &nbsp;·&nbsp; ${timestamp.replace('T', ' ')}
    <br><span style="margin-top:4px; display:inline-block;">
      Current decision: <strong>${currentStatus}</strong>
    </span>
  `;

  document.getElementById('hist-override-status').value = currentStatus || 'approved';
  document.getElementById('hist-override-justification').value = '';
  document.getElementById('hist-override-justification').style.borderColor = '';
  document.getElementById('hist-just-required').style.display =
    (currentStatus || '').startsWith('override_') ? 'inline' : 'none';
  document.getElementById('hist-override-alert').innerHTML = '';

  const panel = document.getElementById('hist-override-panel');
  panel.style.display = 'block';
  panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function _histCloseOverride() {
  document.getElementById('hist-override-panel').style.display = 'none';
  _editingTimestamp = null;
}

async function _histSaveOverride() {
  if (!_editingTimestamp) return;

  const newStatus   = document.getElementById('hist-override-status').value;
  const justification = document.getElementById('hist-override-justification').value.trim();
  const isOverride  = newStatus.startsWith('override_');

  if (isOverride && !justification) {
    const field = document.getElementById('hist-override-justification');
    field.style.borderColor = 'var(--red)';
    field.focus();
    _histOverrideAlert('error', 'Justification is required for override decisions.');
    return;
  }

  try {
    const res = await fetch(`/storage/results/${encodeURIComponent(_editingTimestamp)}`, {
      method:  'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ approval_status: newStatus, override_justification: justification }),
    });
    const data = await res.json();
    if (!data.ok) { _histOverrideAlert('error', data.error); return; }

    _histOverrideAlert('success', 'Decision updated.');
    setTimeout(() => {
      _histCloseOverride();
      _histLoad();  // reload table
    }, 800);
  } catch (e) {
    _histOverrideAlert('error', e.message);
  }
}

function _histOverrideAlert(type, msg) {
  document.getElementById('hist-override-alert').innerHTML =
    `<div class="alert alert-${type === 'error' ? 'error' : 'success'}">${msg}</div>`;
}