/**
 * tabs/overview.js
 * ----------------
 * Overview tab: session setup (PO number, product profile, test selection)
 * and equipment connection status + port configuration.
 */

function initOverviewTab() {
  const root = document.getElementById('overview-root');
  root.innerHTML = `
    <!-- Session setup ──────────────────────────────────────────────── -->
    <div class="card">
      <div class="card-title">Session Setup</div>
      <div class="grid-2" style="gap:24px; align-items:start">

        <div>
          <div class="field-group">
            <label class="field-label">Production Order (PO)</label>
            <input id="ov-po" class="field-input" placeholder="e.g. PO-2024-001" />
          </div>

          <div class="field-group">
            <label class="field-label">Product Profile</label>
            <select id="ov-profile" class="field-select">
              <option value="">Loading profiles…</option>
            </select>
          </div>

          <div class="field-group">
            <label class="field-label">Tests to Run</label>
            <div id="ov-test-checks" style="display:flex; flex-direction:column; gap:8px; margin-top:4px;"></div>
          </div>

          <div class="btn-row">
            <button class="btn btn-primary" id="ov-start-session">Start Session</button>
            <button class="btn btn-ghost"   id="ov-clear-session">Clear</button>
          </div>
          <div id="ov-session-alert" style="margin-top:12px;"></div>
        </div>

        <!-- Current session summary -->
        <div style="background:var(--surface2); border:1px solid var(--border); border-radius:var(--radius-lg); padding:20px;">
          <div class="card-title">Active Session</div>
          <div id="ov-session-summary" style="color:var(--text-muted); font-size:13px;">
            No session active.
          </div>
        </div>

      </div>
    </div>

    <!-- Equipment status + port config ─────────────────────────────── -->
    <div class="card">
      <div class="card-title">Equipment</div>
      <div id="ov-equipment-rows"></div>
    </div>
  `;

  _loadProfiles();
  _loadEquipment();

  document.getElementById('ov-profile').addEventListener('change', _onProfileChange);
  document.getElementById('ov-start-session').addEventListener('click', _onStartSession);
  document.getElementById('ov-clear-session').addEventListener('click', _onClearSession);
}

// ── Profiles ──────────────────────────────────────────────────────────────────

let _profiles    = {};
let _equipList   = [];

async function _loadProfiles() {
  try {
    _profiles = await apiGet('/api/profiles');
    const sel = document.getElementById('ov-profile');
    sel.innerHTML = '<option value="">Custom</option>';
    Object.entries(_profiles).forEach(([key, p]) => {
      const opt = document.createElement('option');
      opt.value = key;
      opt.textContent = p.display_name;
      if (key === 'default') opt.selected = true;
      sel.appendChild(opt);
    });
    _onProfileChange();
  } catch (e) {
    console.error('Could not load profiles:', e);
  }
}

async function _loadEquipment() {
  try {
    _equipList = await apiGet('/api/equipment');
    const session = await apiGet('/api/session');
    _renderTestChecks(_equipList, session.active_tests);
    _renderEquipmentRows(_equipList, session);
    _pollStatus();
  } catch (e) {
    console.error('Could not load equipment:', e);
  }
}

function _onProfileChange() {
  const key     = document.getElementById('ov-profile').value;
  const profile = _profiles[key];
  if (!profile || !_equipList.length) return;
  // Tick the relevant checkboxes
  _equipList.forEach(eq => {
    const cb = document.getElementById(`ov-check-${eq.test_id}`);
    if (cb) cb.checked = profile.tests.includes(eq.test_id);
  });
}

// ── Test checkboxes ───────────────────────────────────────────────────────────

function _renderTestChecks(equipList, activeTests) {
  const container = document.getElementById('ov-test-checks');
  container.innerHTML = '';
  equipList.forEach(eq => {
    const label = document.createElement('label');
    label.style.cssText = 'display:flex; align-items:center; gap:8px; cursor:pointer; font-size:13px;';
    label.innerHTML = `
      <input type="checkbox" id="ov-check-${eq.test_id}"
             ${activeTests.includes(eq.test_id) ? 'checked' : ''}
             style="width:15px;height:15px;accent-color:var(--accent)" />
      ${eq.display_name}
    `;
    // Switching to Custom profile when user manually changes checkboxes
    label.querySelector('input').addEventListener('change', () => {
      document.getElementById('ov-profile').value = '';
    });
    container.appendChild(label);
  });
}

// ── Session actions ───────────────────────────────────────────────────────────

async function _onStartSession() {
  const po = document.getElementById('ov-po').value.trim();
  if (!po) {
    _showAlert('ov-session-alert', 'error', 'Please enter a PO number.');
    return;
  }
  const selected = _equipList
    .filter(eq => document.getElementById(`ov-check-${eq.test_id}`)?.checked)
    .map(eq => eq.test_id);

  if (!selected.length) {
    _showAlert('ov-session-alert', 'error', 'Select at least one test.');
    return;
  }

  await applySession({ poNumber: po, selectedTests: selected });
  _updateSessionSummary(po, selected);
  _showAlert('ov-session-alert', 'success', 'Session started. Switch to an equipment tab to begin testing.');
}

function _onClearSession() {
  document.getElementById('ov-po').value = '';
  _equipList.forEach(eq => {
    const cb = document.getElementById(`ov-check-${eq.test_id}`);
    if (cb) cb.checked = false;
  });
  document.getElementById('ov-session-summary').innerHTML = '<span style="color:var(--text-muted)">No session active.</span>';
  applySession({ poNumber: '', selectedTests: [] });
  _showAlert('ov-session-alert', 'info', 'Session cleared.');
}

function _updateSessionSummary(po, tests) {
  const names = tests.map(id => {
    const eq = _equipList.find(e => e.test_id === id);
    return eq ? eq.display_name : id;
  });
  document.getElementById('ov-session-summary').innerHTML = `
    <div style="margin-bottom:10px;">
      <div class="text-muted" style="font-size:11px;text-transform:uppercase;letter-spacing:.08em;margin-bottom:4px">PO Number</div>
      <div style="font-family:var(--mono);font-size:16px;color:var(--accent)">${po}</div>
    </div>
    <div>
      <div class="text-muted" style="font-size:11px;text-transform:uppercase;letter-spacing:.08em;margin-bottom:6px">Active Tests</div>
      ${names.map(n => `<div style="font-size:13px;margin-bottom:4px">✓ ${n}</div>`).join('')}
    </div>
  `;
}

// ── Equipment rows with port config + connect/disconnect ──────────────────────

function _renderEquipmentRows(equipList, session) {
  const container = document.getElementById('ov-equipment-rows');
  container.innerHTML = equipList.map(eq => `
    <div class="ov-eq-row" id="ov-row-${eq.test_id}"
         style="display:flex; align-items:center; gap:16px; padding:14px 0; border-bottom:1px solid var(--border);">
      <div style="width:200px;">
        <div style="font-weight:500; margin-bottom:2px">${eq.display_name}</div>
        <div style="font-size:12px;">
          <span class="status-dot disconnected" id="ov-dot-${eq.test_id}"></span>
          <span id="ov-status-${eq.test_id}" style="color:var(--text-muted)">Disconnected</span>
        </div>
      </div>
      <div style="flex:1; max-width:200px;">
        <input class="field-input" id="ov-port-${eq.test_id}"
               value="${session.ports[eq.test_id] || ''}"
               placeholder="COM3 or /dev/ttyUSB0"
               style="margin:0" />
      </div>
      <div style="display:flex; gap:8px;">
        <button class="btn btn-ghost btn-sm" id="ov-set-port-${eq.test_id}"
                onclick="_setPort('${eq.test_id}')">Set Port</button>
        <button class="btn btn-green" id="ov-connect-${eq.test_id}"
                onclick="_connect('${eq.test_id}')">Connect</button>
        <button class="btn btn-ghost" id="ov-disconnect-${eq.test_id}"
                onclick="_disconnect('${eq.test_id}')" style="display:none">Disconnect</button>
      </div>
      <div id="ov-eq-alert-${eq.test_id}" style="min-width:160px;"></div>
    </div>
  `).join('');
}

async function _setPort(testId) {
  const port = document.getElementById(`ov-port-${testId}`).value.trim();
  await apiPost('/api/ports', { [testId]: port });
  _showAlert(`ov-eq-alert-${testId}`, 'info', 'Port updated.');
}

async function _connect(testId) {
  const port = document.getElementById(`ov-port-${testId}`).value.trim();
  if (port) await apiPost('/api/ports', { [testId]: port });
  try {
    const res = await apiPost('/api/connect', { test_id: testId });
    if (res.ok) {
      _showAlert(`ov-eq-alert-${testId}`, 'success', 'Connected.');
    } else {
      _showAlert(`ov-eq-alert-${testId}`, 'error', res.error || 'Failed.');
    }
  } catch (e) {
    _showAlert(`ov-eq-alert-${testId}`, 'error', e.message);
  }
}

async function _disconnect(testId) {
  try {
    await apiPost('/api/disconnect', { test_id: testId });
    _showAlert(`ov-eq-alert-${testId}`, 'info', 'Disconnected.');
  } catch (e) {
    _showAlert(`ov-eq-alert-${testId}`, 'error', e.message);
  }
}

// ── Status polling ────────────────────────────────────────────────────────────

function _pollStatus() {
  async function tick() {
    try {
      const status = await apiGet('/api/status');
      Object.entries(status).forEach(([testId, s]) => {
        const dot    = document.getElementById(`ov-dot-${testId}`);
        const label  = document.getElementById(`ov-status-${testId}`);
        const conBtn = document.getElementById(`ov-connect-${testId}`);
        const disBtn = document.getElementById(`ov-disconnect-${testId}`);
        if (!dot) return;

        dot.className = 'status-dot ' + (
          s.error       ? 'error' :
          s.running     ? 'running' :
          s.connected   ? 'connected' : 'disconnected'
        );
        label.textContent = s.error ? `Error` : s.running ? 'Running' : s.connected ? 'Connected' : 'Disconnected';
        label.style.color = s.error ? 'var(--red)' : s.running ? 'var(--amber)' : s.connected ? 'var(--green)' : 'var(--text-muted)';

        if (conBtn) conBtn.style.display = s.connected ? 'none' : 'inline-flex';
        if (disBtn) disBtn.style.display = s.connected ? 'inline-flex' : 'none';
      });
    } catch (_) {}
  }
  tick();
  setInterval(tick, 3000);
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function _showAlert(containerId, type, msg) {
  const el = document.getElementById(containerId);
  if (!el) return;
  el.innerHTML = `<div class="alert alert-${type === 'error' ? 'error' : type === 'success' ? 'success' : type === 'info' ? 'info' : 'amber'}">${msg}</div>`;
  setTimeout(() => { el.innerHTML = ''; }, 4000);
}
