/**
 * tabs/moisture.js
 * ----------------
 * Moisture Content tab.
 * Fire-and-wait pattern: the MB27 runs the test internally;
 * the app polls every 30s until the final result block arrives.
 */

let _moistSource = null;

function initMoistureTab(panel) {
  panel.innerHTML = `
    <!-- Product summary ─────────────────────────────────────────────── -->
    <div class="card" id="moist-product-card" style="display:none;">
      <div class="card-title">Product</div>
      <div id="moist-product-body"></div>
    </div>

    <!-- Controls ──────────────────────────────────────────────────── -->
    <div class="card">
      <div class="card-title">Test Control</div>
      <p style="color:var(--text-muted); font-size:13px; margin-bottom:16px;">
        The MB27 runs the drying test autonomously. Press Start — the analyzer
        will be polled every 30 seconds until the final moisture result is ready.
      </p>
      <div class="btn-row">
        <button class="btn btn-green"  id="moist-start-btn">▶ Start Test</button>
        <button class="btn btn-danger" id="moist-stop-btn" disabled>■ Abort</button>
      </div>
      <div id="moist-ctrl-alert" style="margin-top:10px;"></div>
    </div>

    <!-- Status ─────────────────────────────────────────────────────── -->
    <div class="card">
      <div class="card-title">Test Status</div>
      <div class="grid-4" style="gap:12px; margin-bottom:20px;">
        <div class="stat-tile">
          <div class="stat-value" id="moist-elapsed">—</div>
          <div class="stat-label">Elapsed</div>
        </div>
        <div class="stat-tile">
          <div class="stat-value" id="moist-polls">0</div>
          <div class="stat-label">Polls Sent</div>
        </div>
        <div class="stat-tile" style="grid-column: span 2;">
          <div class="stat-value" id="moist-phase" style="font-size:14px; color:var(--text-muted)">Not running</div>
          <div class="stat-label">Phase</div>
        </div>
      </div>

      <div style="color:var(--text-muted); font-size:12px; margin-bottom:6px;">Last Poll Response</div>
      <div class="mini-log" id="moist-log" style="height:100px;"></div>
    </div>

    <!-- Result (shown after final reading) ──────────────────────── -->
    <div class="card" id="moist-result-card" style="display:none;">
      <div class="card-title">Final Result</div>

      <!-- QC verdict banner — populated by _moistShowResult -->
      <div id="moist-qc-banner" style="display:none; align-items:center; gap:10px;
           padding:10px 14px; background:var(--surface2); border-radius:var(--radius);
           border:1px solid var(--border); margin-bottom:16px;"></div>

      <div style="margin-bottom:24px;">
        <span class="readout" id="moist-readout">—</span>
        <span class="readout-unit">%MC</span>
        <div class="readout-label">Final Moisture Content</div>
      </div>

      <div class="grid-3" style="gap:12px; margin-bottom:16px;">
        <div class="stat-tile">
          <div class="stat-value" id="moist-init-w">—</div>
          <div class="stat-label">Initial Weight (g)</div>
        </div>
        <div class="stat-tile">
          <div class="stat-value" id="moist-final-w">—</div>
          <div class="stat-label">Final Weight (g)</div>
        </div>
        <div class="stat-tile">
          <div class="stat-value" id="moist-time">—</div>
          <div class="stat-label">Elapsed Time</div>
        </div>
      </div>

      <div class="btn-row">
        <button class="btn btn-primary" id="moist-save-btn">Save Result to PO</button>
        <button class="btn btn-ghost"   id="moist-discard-btn">Discard</button>
      </div>
    </div>
  `;

  document.getElementById('moist-start-btn').addEventListener('click', _moistStart);
  document.getElementById('moist-stop-btn').addEventListener('click',  _moistStop);

  // Render product summary card
  renderProductSummaryCard(document.getElementById('moist-product-body'), 'moisture')
    .then(() => {
      const card = document.getElementById('moist-product-card');
      if (document.getElementById('moist-product-body').innerHTML.trim()) card.style.display = 'block';
    });
}

// ── Last final reading ────────────────────────────────────────────────────────
let _moistLastFinal = null;
let _moistPollCount = 0;
let _moistStartTime = null;
let _moistClockInterval = null;

async function _moistStart() {
  try {
    const res = await apiPost('/api/start', { test_id: 'moisture' });
    if (!res.ok) { _moistAlert('error', res.error); return; }
  } catch (e) { _moistAlert('error', e.message); return; }

  document.getElementById('moist-start-btn').disabled = true;
  document.getElementById('moist-stop-btn').disabled  = false;
  document.getElementById('moist-result-card').style.display = 'none';
  document.getElementById('moist-phase').textContent = 'Drying in progress…';
  document.getElementById('moist-phase').style.color = 'var(--amber)';

  _moistLastFinal  = null;
  _moistPollCount  = 0;
  _moistStartTime  = Date.now();

  // Running clock
  clearInterval(_moistClockInterval);
  _moistClockInterval = setInterval(() => {
    const s = Math.floor((Date.now() - _moistStartTime) / 1000);
    const m = Math.floor(s / 60);
    const sec = s % 60;
    document.getElementById('moist-elapsed').textContent =
      `${String(m).padStart(2,'0')}:${String(sec).padStart(2,'0')}`;
  }, 1000);

  _moistLog('START sent to analyzer.', 'ok');

  // Open SSE stream
  if (_moistSource) _moistSource.close();
  _moistSource = new EventSource('/stream/moisture');
  _moistSource.onmessage = e => _moistOnEvent(JSON.parse(e.data));
  _moistSource.onerror   = () => {
    _moistAlert('error', 'Stream disconnected.');
    _moistResetControls();
  };
}

async function _moistStop() {
  if (_moistSource) { _moistSource.close(); _moistSource = null; }
  try { await apiPost('/api/stop', { test_id: 'moisture' }); } catch (_) {}
  clearInterval(_moistClockInterval);
  document.getElementById('moist-phase').textContent = 'Aborted.';
  document.getElementById('moist-phase').style.color = 'var(--red)';
  _moistLog('Test aborted by user.', 'err');
  _moistResetControls();
}

function _moistOnEvent(event) {
  if (event.type === 'error') {
    _moistAlert('error', event.message);
    _moistResetControls();
    return;
  }
  if (event.type === 'stopped') {
    _moistResetControls();
    return;
  }
  if (event.type !== 'reading') return;

  const d = event.data;

  if (!event.final) {
    // Intermediate poll heartbeat
    _moistPollCount++;
    document.getElementById('moist-polls').textContent = _moistPollCount;
    document.getElementById('moist-phase').textContent = 'Waiting for final result…';

    const lines = d.last_poll || [];
    if (lines.length) {
      _moistLog(`Poll ${_moistPollCount}: ${lines.join(' | ')}`, 'info');
    } else {
      _moistLog(`Poll ${_moistPollCount}: No response yet.`, 'info');
    }
  } else {
    // Final result
    clearInterval(_moistClockInterval);
    _moistLastFinal = d;
    _moistShowResult(d);   // async — runs in background
    _moistResetControls();
    if (_moistSource) { _moistSource.close(); _moistSource = null; }
    _moistLog('Test complete. Final result received.', 'ok');
  }
}

let _moistLastQC = null;

async function _moistShowResult(d) {
  // Fetch spec for the active profile
  let qc = { status: 'approved', label: 'No Spec — Pass-through', color: 'var(--text-muted)', inRange: true, spec: null };
  try {
    const session = await apiGet('/api/session');
    const spec    = await apiGet(`/api/specs/${session.profile_key}/moisture`);
    qc = evaluateQC(d.moisture_pct, spec);
  } catch (_) {}

  _moistLastQC = qc;

  const qcColor = qc.status === 'rejected' ? 'var(--red)' : qc.spec?.defined ? 'var(--green)' : 'var(--text-muted)';

  document.getElementById('moist-phase').textContent = 'Complete';
  document.getElementById('moist-phase').style.color = 'var(--green)';

  // Colour the main readout according to QC verdict
  document.getElementById('moist-readout').textContent = d.moisture_pct ?? '—';
  document.getElementById('moist-readout').style.color = qcColor;
  document.getElementById('moist-init-w').textContent  = d.initial_weight_g ?? '—';
  document.getElementById('moist-final-w').textContent = d.final_weight_g ?? '—';
  document.getElementById('moist-time').textContent    = d.elapsed_time ?? '—';

  // QC verdict banner above the result card buttons
  const banner = document.getElementById('moist-qc-banner');
  if (banner) {
    banner.style.display = 'flex';
    banner.style.borderColor = qc.status === 'rejected' ? 'var(--red)' : 'var(--border)';
    banner.innerHTML = `
      <span style="font-size:20px; color:${qcColor}">${qc.status === 'rejected' ? '✗' : '✓'}</span>
      <div>
        <div style="font-weight:600; color:${qcColor}">${qc.status === 'rejected' ? 'REJECTED' : 'APPROVED'}</div>
        <div style="font-size:12px; color:var(--text-muted)">${qc.label}</div>
      </div>
    `;
  }

  document.getElementById('moist-result-card').style.display = 'block';
  document.getElementById('moist-save-btn').onclick    = _moistSave;
  document.getElementById('moist-discard-btn').onclick = () => {
    document.getElementById('moist-result-card').style.display = 'none';
  };
}

async function _moistSave() {
  if (!_moistLastFinal) return;
  const session = await apiGet('/api/session');
  const po = session.po_number;
  if (!po) { _moistAlert('error', 'No PO number set. Go to Overview first.'); return; }

  const rows = {
    'PO Number':        po,
    'Moisture Content': `${_moistLastFinal.moisture_pct} %MC`,
    'Initial Weight':   `${_moistLastFinal.initial_weight_g} g`,
    'Final Weight':     `${_moistLastFinal.final_weight_g} g`,
    'Elapsed Time':     _moistLastFinal.elapsed_time,
  };

  const { confirmed, notes, approval_status, override_justification } =
    await showSaveModal('Moisture Content', rows, _moistLastQC);
  if (!confirmed) return;

  try {
    await apiPost('/storage/save', {
      po_number:              po,
      test_id:                'moisture',
      values:                 _moistLastFinal,
      notes,
      approval_status,
      override_justification,
      product_name:           session.product_name || '',
    });
    _moistAlert('success', 'Result saved.');
    document.getElementById('moist-result-card').style.display = 'none';
  } catch (e) {
    _moistAlert('error', e.message);
  }
}

function _moistResetControls() {
  document.getElementById('moist-start-btn').disabled = false;
  document.getElementById('moist-stop-btn').disabled  = true;
}

function _moistAlert(type, msg) {
  const el = document.getElementById('moist-ctrl-alert');
  el.innerHTML = `<div class="alert alert-${type === 'error' ? 'error' : 'success'}">${msg}</div>`;
  setTimeout(() => { el.innerHTML = ''; }, 5000);
}

function _moistLog(msg, cls = 'info') {
  const log  = document.getElementById('moist-log');
  if (!log) return;
  const line = document.createElement('div');
  line.className = `log-line ${cls}`;
  line.textContent = `[${new Date().toLocaleTimeString('en-GB')}] ${msg}`;
  log.appendChild(line);
  log.scrollTop = log.scrollHeight;
}