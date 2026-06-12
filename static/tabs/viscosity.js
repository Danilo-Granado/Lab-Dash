/**
 * tabs/viscosity.js
 * -----------------
 * Live viscosity instrument panel.
 * Supports fixed_rpm and auto_torque modes.
 * Streams readings via SSE, shows stability progress, triggers save modal on completion.
 */

let _viscSource = null;   // active EventSource

function initViscosityTab(panel) {
  panel.innerHTML = `
    <!-- Product summary ─────────────────────────────────────────────── -->
    <div class="card" id="visc-product-card" style="display:none;">
      <div class="card-title">Product</div>
      <div id="visc-product-body"></div>
    </div>

    <!-- Controls ────────────────────────────────────────────────────── -->
    <div class="card">
      <div class="card-title">Test Configuration</div>
      <div class="grid-2" style="gap:24px; align-items:start">

        <div>
          <div class="field-group">
            <label class="field-label">Mode</label>
            <select id="visc-mode" class="field-select">
              <option value="fixed_rpm">Fixed RPM</option>
              <option value="auto_torque">Auto Torque (PID)</option>
            </select>
          </div>

          <div class="field-group">
            <label class="field-label">Spindle</label>
            <input id="visc-spindle" class="field-input" type="number" min="1" max="7" value="1" />
          </div>

          <!-- Fixed RPM params -->
          <div id="visc-fixed-params">
            <div class="field-group">
              <label class="field-label">Speed (RPM)</label>
              <input id="visc-speed" class="field-input" type="number" min="5" max="200" step="0.1" value="50" />
            </div>
          </div>

          <!-- Auto torque params -->
          <div id="visc-auto-params" style="display:none">
            <div class="field-group">
              <label class="field-label">Initial Speed (RPM)</label>
              <input id="visc-init-speed" class="field-input" type="number" min="5" max="200" step="0.1" value="50" />
            </div>
            <div class="field-group">
              <label class="field-label">Target Torque (%)</label>
              <input id="visc-torque-sp" class="field-input" type="number" min="10" max="90" step="1" value="50" />
            </div>
          </div>

          <div class="btn-row">
            <button class="btn btn-green"  id="visc-start-btn">▶ Start Test</button>
            <button class="btn btn-danger" id="visc-stop-btn" disabled>■ Stop</button>
          </div>
          <div id="visc-ctrl-alert" style="margin-top:10px;"></div>
        </div>

        <!-- Live state summary -->
        <div style="background:var(--surface2); border:1px solid var(--border); border-radius:var(--radius-lg); padding:20px;">
          <div class="card-title">Live State</div>
          <div class="grid-2" style="gap:12px;">
            <div class="stat-tile">
              <div class="stat-value" id="visc-live-speed">—</div>
              <div class="stat-label">Speed (RPM)</div>
            </div>
            <div class="stat-tile">
              <div class="stat-value" id="visc-live-torque">—</div>
              <div class="stat-label">Torque (%)</div>
            </div>
            <div class="stat-tile">
              <div class="stat-value" id="visc-live-range">—</div>
              <div class="stat-label">Rel. Range (%)</div>
            </div>
            <div class="stat-tile">
              <div class="stat-value" id="visc-live-buf">0 / 15</div>
              <div class="stat-label">Buffer Fill</div>
            </div>
          </div>
        </div>

      </div>
    </div>

    <!-- Live readout ─────────────────────────────────────────────────── -->
    <div class="card">
      <div class="card-title">Viscosity Reading</div>
      <div style="display:grid; grid-template-columns:1fr 1fr; gap:24px; align-items:start;">

        <!-- Left: numeric readout + stability -->
        <div>
          <div style="margin-bottom:20px;">
            <span class="readout" id="visc-readout">—</span>
            <span class="readout-unit">mPa·s</span>
            <div class="readout-label" id="visc-readout-label">Waiting for test start</div>
          </div>

          <div style="max-width:480px;">
            <div style="display:flex; justify-content:space-between; margin-bottom:4px; font-size:12px;">
              <span class="text-muted">Stability</span>
              <span id="visc-stable-label" class="text-muted">—</span>
            </div>
            <div class="stability-bar-track">
              <div class="stability-bar-fill" id="visc-stable-bar" style="width:0%"></div>
            </div>
            <div style="display:flex; justify-content:space-between; margin-top:4px; font-size:11px; color:var(--text-muted);">
              <span>Unstable</span>
              <span id="visc-stable-time">0s / 15s</span>
              <span>Stable ✓</span>
            </div>
          </div>

        <!-- Right: live chart -->
        <div style="position:relative; height:200px;">
          <canvas id="visc-chart"></canvas>
        </div>

      </div>
    </div>

    <!-- Result (shown after final reading) ─────────────────────────── -->
    <div class="card" id="visc-result-card" style="display:none;">
      <div class="card-title">Test Complete</div>
      <div id="visc-result-body"></div>
      <div class="btn-row">
        <button class="btn btn-primary" id="visc-save-btn">Save Result to PO</button>
        <button class="btn btn-ghost"   id="visc-discard-btn">Discard</button>
      </div>
    </div>
  `;

  // Mode toggle
  document.getElementById('visc-mode').addEventListener('change', e => {
    const auto = e.target.value === 'auto_torque';
    document.getElementById('visc-fixed-params').style.display = auto ? 'none' : 'block';
    document.getElementById('visc-auto-params').style.display  = auto ? 'block' : 'none';
  });

  document.getElementById('visc-start-btn').addEventListener('click', _viscStart);
  document.getElementById('visc-stop-btn').addEventListener('click',  _viscStop);

  // Render product summary card and load default settings from profile
  renderProductSummaryCard(document.getElementById('visc-product-body'), 'viscosity')
    .then(() => {
      const card = document.getElementById('visc-product-card');
      if (document.getElementById('visc-product-body').innerHTML.trim()) card.style.display = 'block';
    });

  _viscLoadProfileDefaults();
}

async function _viscLoadProfileDefaults() {
  try {
    const session  = await apiGet('/api/session');
    const profiles = await apiGet('/api/profiles');
    const settings = profiles[session.profile_key]?.viscosity_settings;
    if (!settings) return;

    // Apply mode
    if (settings.mode) {
      document.getElementById('visc-mode').value = settings.mode;
      const auto = settings.mode === 'auto_torque';
      document.getElementById('visc-fixed-params').style.display = auto ? 'none' : 'block';
      document.getElementById('visc-auto-params').style.display  = auto ? 'block' : 'none';
    }

    // Apply spindle
    if (settings.spindle != null)
      document.getElementById('visc-spindle').value = settings.spindle;

    // Apply speed/torque fields
    if (settings.speed != null) {
      document.getElementById('visc-speed').value      = settings.speed;
      document.getElementById('visc-init-speed').value = settings.speed;
    }
    if (settings.torque_setpoint != null)
      document.getElementById('visc-torque-sp').value = settings.torque_setpoint;

    _viscLog(`Defaults loaded from profile (${settings.mode}, spindle ${settings.spindle}, ${settings.speed} RPM).`, 'info');
  } catch (e) {
    // No settings defined for this profile — silently skip
  }
}

// ── Last final reading — held for save ───────────────────────────────────────
let _viscLastFinal = null;

// ── Chart ─────────────────────────────────────────────────────────────────────
const VISC_CHART_WINDOW_S = 60;   // ← change this to adjust the rolling window
let _viscChart      = null;
let _viscChartData  = [];         // { t: elapsed_s, v: viscosity }
let _viscTestStart  = null;

function _viscInitChart() {
  const existing = Chart.getChart('visc-chart');
  if (existing) existing.destroy();

  _viscChartData = [];
  _viscTestStart = Date.now();

  const ctx = document.getElementById('visc-chart').getContext('2d');
  _viscChart = new Chart(ctx, {
    type: 'line',
    data: {
      datasets: [
        {
          label: 'Viscosity (mPa·s)',
          data: [],
          borderColor:     '#2a6dd9',
          backgroundColor: 'rgba(42,109,217,0.08)',
          borderWidth: 2,
          pointRadius: 0,
          tension: 0.3,
          fill: true,
        },
        // Invisible dataset used only to paint the stable background region
        {
          label: '_stable_fill',
          data: [],
          borderWidth: 0,
          pointRadius: 0,
          fill: false,
          hidden: true,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: ctx => `${ctx.parsed.y.toFixed(2)} mPa·s`,
            title: ctx => `t = ${ctx[0].parsed.x}s`,
          },
        },
      },
      scales: {
        x: {
          type: 'linear',
          title: { display: true, text: 'Time (s)', color: '#64748b', font: { size: 11 } },
          ticks: { color: '#64748b', font: { size: 10 } },
          grid:  { color: 'rgba(255,255,255,0.05)' },
          min: 0,
        },
        y: {
          title: { display: true, text: 'mPa·s', color: '#64748b', font: { size: 11 } },
          ticks: { color: '#64748b', font: { size: 10 } },
          grid:  { color: 'rgba(255,255,255,0.05)' },
        },
      },
    },
  });
}

function _viscChartPush(viscosity, isStable) {
  if (!_viscChart) return;

  const elapsed = Math.round((Date.now() - _viscTestStart) / 1000);
  _viscChartData.push({ t: elapsed, v: viscosity, stable: isStable });

  // Trim to rolling window
  const cutoff = elapsed - VISC_CHART_WINDOW_S;
  _viscChartData = _viscChartData.filter(d => d.t >= cutoff);

  // Main viscosity line
  _viscChart.data.datasets[0].data = _viscChartData.map(d => ({ x: d.t, y: d.v }));

  // Stable background annotation via chartArea plugin
  // Build green fill segments for stable stretches using point background colors
  _viscChart.data.datasets[0].pointBackgroundColor = _viscChartData.map(d =>
    d.stable ? 'rgba(29,158,117,0.9)' : 'rgba(42,109,217,0.0)'
  );
  _viscChart.data.datasets[0].pointRadius = _viscChartData.map(d => d.stable ? 3 : 0);

  // Slide the x-axis window
  const xMin = Math.max(0, elapsed - VISC_CHART_WINDOW_S);
  _viscChart.options.scales.x.min = xMin;
  _viscChart.options.scales.x.max = xMin + VISC_CHART_WINDOW_S;

  _viscChart.update('none');  // 'none' skips animation for live updates
}

async function _viscStart() {
  const mode    = document.getElementById('visc-mode').value;
  const spindle = parseInt(document.getElementById('visc-spindle').value);
  const params  = { test_id: 'viscosity', mode, spindle };

  if (mode === 'fixed_rpm') {
    params.speed = parseFloat(document.getElementById('visc-speed').value);
  } else {
    params.speed            = parseFloat(document.getElementById('visc-init-speed').value);
    params.torque_setpoint  = parseFloat(document.getElementById('visc-torque-sp').value);
  }

  try {
    const res = await apiPost('/api/start', params);
    if (!res.ok) { _viscAlert('error', res.error); return; }
  } catch (e) { _viscAlert('error', e.message); return; }

  document.getElementById('visc-start-btn').disabled = true;
  document.getElementById('visc-stop-btn').disabled  = false;
  document.getElementById('visc-result-card').style.display = 'none';
  _viscLastFinal = null;
  _viscLog('Test started.', 'ok');
  _viscInitChart();

  // Open SSE stream
  if (_viscSource) _viscSource.close();
  _viscSource = new EventSource('/stream/viscosity');
  _viscSource.onmessage = e => _viscOnEvent(JSON.parse(e.data));
  _viscSource.onerror   = () => { _viscAlert('error', 'Stream disconnected.'); _viscResetControls(); };
}

async function _viscStop() {
  if (_viscSource) { _viscSource.close(); _viscSource = null; }
  try { await apiPost('/api/stop', { test_id: 'viscosity' }); } catch (_) {}
  _viscLog('Test stopped by user.', 'info');
  _viscResetControls();
}

function _viscOnEvent(event) {
  if (event.type === 'error') {
    _viscAlert('error', event.message);
    _viscResetControls();
    return;
  }
  if (event.type === 'stopped') {
    _viscResetControls();
    return;
  }
  if (event.type !== 'reading') return;

  const d = event.data;

  // Main readout
  document.getElementById('visc-readout').textContent = d.viscosity ?? '—';
  if (d.viscosity != null) _viscChartPush(d.viscosity, event.stable);
  document.getElementById('visc-readout-label').textContent = event.stable ? '● Stable' : '○ Measuring…';
  document.getElementById('visc-readout-label').style.color = event.stable ? 'var(--green)' : 'var(--text-muted)';

  // Stat tiles
  document.getElementById('visc-live-speed').textContent  = d.speed_rpm  != null ? `${d.speed_rpm}` : '—';
  document.getElementById('visc-live-torque').textContent = d.torque      != null ? `${d.torque}` : '—';
  document.getElementById('visc-live-range').textContent  = d.rel_range_pct != null ? `${d.rel_range_pct.toFixed(2)}` : '—';
  document.getElementById('visc-live-buf').textContent    = `${d.buffer_fill ?? 0} / 15`;

  // Stability bar (min_stable_duration = 15s)
  const MIN_DUR = 15;
  const pct = Math.min(100, ((d.stable_for_s || 0) / MIN_DUR) * 100);
  const bar = document.getElementById('visc-stable-bar');
  bar.style.width = pct + '%';
  bar.classList.toggle('stable', event.stable && pct > 0);
  document.getElementById('visc-stable-time').textContent = `${d.stable_for_s ?? 0}s / ${MIN_DUR}s`;
  document.getElementById('visc-stable-label').textContent = event.stable ? '✓ Stable' : 'Stabilising…';

  if (event.final) {
    _viscLastFinal = d;
    _viscShowResult(d);   // async — runs in background, card appears when ready
    _viscResetControls();
    if (_viscSource) { _viscSource.close(); _viscSource = null; }
  }
}

async function _viscShowResult(d) {
  // Fetch spec for the active profile
  let qc = { status: 'approved', label: 'No Spec — Pass-through', color: 'var(--text-muted)', inRange: true, spec: null };
  try {
    const session = await apiGet('/api/session');
    const spec    = await apiGet(`/api/specs/${session.profile_key}/viscosity`);
    qc = evaluateQC(d.viscosity, spec);
  } catch (_) {}

  _viscLastQC = qc;

  const qcColor = qc.status === 'rejected' ? 'var(--red)' : qc.status === 'approved' && qc.spec?.defined ? 'var(--green)' : 'var(--text-muted)';
  const qcIcon  = qc.status === 'rejected' ? '✗' : '✓';

  const card = document.getElementById('visc-result-card');
  document.getElementById('visc-result-body').innerHTML = `
    <div style="display:flex; align-items:center; gap:10px; padding:10px 14px;
                background:var(--surface2); border-radius:var(--radius);
                border:1px solid ${qc.status === 'rejected' ? 'var(--red)' : 'var(--border)'};
                margin-bottom:16px;">
      <span style="font-size:22px; color:${qcColor}">${qcIcon}</span>
      <div>
        <div style="font-weight:600; color:${qcColor}">${qc.status === 'rejected' ? 'REJECTED' : 'APPROVED'}</div>
        <div style="font-size:12px; color:var(--text-muted)">${qc.label}</div>
      </div>
    </div>
    <div class="grid-3" style="gap:12px; margin-bottom:16px;">
      <div class="stat-tile">
        <div class="stat-value" style="color:${qcColor}">${d.viscosity}</div>
        <div class="stat-label">Viscosity (mPa·s)</div>
      </div>
      <div class="stat-tile">
        <div class="stat-value">${d.speed_rpm ?? '—'}</div>
        <div class="stat-label">Final Speed (RPM)</div>
      </div>
      <div class="stat-tile">
        <div class="stat-value">${d.torque != null ? d.torque : '—'}</div>
        <div class="stat-label">Final Torque (%)</div>
      </div>
    </div>
  `;
  card.style.display = 'block';

  document.getElementById('visc-save-btn').onclick    = _viscSave;
  document.getElementById('visc-discard-btn').onclick = () => { card.style.display = 'none'; };
}

let _viscLastQC = null;

async function _viscSave() {
  if (!_viscLastFinal) return;
  const session = await apiGet('/api/session');
  const po = session.po_number;
  if (!po) { _viscAlert('error', 'No PO number set. Go to Overview first.'); return; }

  const rows = {
    'PO Number':    po,
    'Viscosity':    `${_viscLastFinal.viscosity} mPa·s`,
    'Final Speed':  `${_viscLastFinal.speed_rpm} RPM`,
    'Final Torque': _viscLastFinal.torque != null ? `${_viscLastFinal.torque} %` : 'N/A',
  };

  const { confirmed, notes, approval_status, override_justification } =
    await showSaveModal('Viscosity', rows, _viscLastQC);
  if (!confirmed) return;

  try {
    await apiPost('/storage/save', {
      po_number:              po,
      test_id:                'viscosity',
      values:                 _viscLastFinal,
      notes,
      approval_status,
      override_justification,
      product_name:           session.product_name || '',
    });
    _viscAlert('success', 'Result saved.');
    document.getElementById('visc-result-card').style.display = 'none';
  } catch (e) {
    _viscAlert('error', e.message);
  }
}

function _viscResetControls() {
  document.getElementById('visc-start-btn').disabled = false;
  document.getElementById('visc-stop-btn').disabled  = true;
}

function _viscAlert(type, msg) {
  const el = document.getElementById('visc-ctrl-alert');
  el.innerHTML = `<div class="alert alert-${type === 'error' ? 'error' : 'success'}">${msg}</div>`;
  setTimeout(() => { el.innerHTML = ''; }, 5000);
}

function _viscLog(msg, cls = 'info') {
  const log  = document.getElementById('visc-log');
  if (!log) return;
  const line = document.createElement('div');
  line.className = `log-line ${cls}`;
  line.textContent = `[${new Date().toLocaleTimeString('en-GB')}] ${msg}`;
  log.appendChild(line);
  log.scrollTop = log.scrollHeight;
}