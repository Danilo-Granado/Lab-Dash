/**
 * app.js
 * ------
 * Entry point. Runs after all tab scripts are loaded.
 * Responsibilities:
 *   - Load equipment list + profiles from the API
 *   - Inject equipment tabs dynamically into the tab bar and content area
 *   - Handle tab switching, including disabled state
 *   - Restore session state (PO, active tests)
 *   - Drive the clock in the topbar
 *   - Expose the global confirm-and-save modal
 */

// ── Global API helpers ────────────────────────────────────────────────────────

async function apiGet(path) {
  const r = await fetch(path);
  if (!r.ok) throw new Error(`GET ${path} → ${r.status}`);
  return r.json();
}

async function apiPost(path, body = {}) {
  const r = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`POST ${path} → ${r.status}`);
  return r.json();
}

// ── Tab system ────────────────────────────────────────────────────────────────

let activeTests = [];   // test_ids currently enabled for this session
let allEquipment = [];  // full equipment list from API

function switchTab(tabId) {
  document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.dataset.tab === tabId));
  document.querySelectorAll('.tab-panel').forEach(p => p.classList.toggle('active', p.id === `panel-${tabId}`));
}

function injectEquipmentTabs(equipmentList) {
  const tabbar  = document.getElementById('tabbar');
  const content = document.querySelector('.tab-content');
  const historyTab   = tabbar.querySelector('[data-tab="history"]');
  const historyPanel = document.getElementById('panel-history');

  equipmentList.forEach(eq => {
    // Tab button
    const btn = document.createElement('button');
    btn.className = 'tab';
    btn.dataset.tab = eq.test_id;
    btn.textContent = eq.display_name;
    btn.disabled = true;   // enabled when session activates this test
    tabbar.insertBefore(btn, historyTab);

    // Panel
    const panel = document.createElement('section');
    panel.className = 'tab-panel';
    panel.id = `panel-${eq.test_id}`;
    content.insertBefore(panel, historyPanel);
  });

  // Tab click handler (skip disabled)
  tabbar.addEventListener('click', e => {
    const btn = e.target.closest('.tab');
    if (!btn || btn.disabled) return;
    switchTab(btn.dataset.tab);
  });
}

function updateTabStates(activeTestIds) {
  allEquipment.forEach(eq => {
    const btn = document.querySelector(`.tab[data-tab="${eq.test_id}"]`);
    if (!btn) return;
    const isActive = activeTestIds.includes(eq.test_id);
    btn.disabled = !isActive;
    btn.title = isActive ? '' : 'Not selected for current session';
  });

  // If current active tab just got disabled, fall back to overview
  const currentTab = document.querySelector('.tab.active');
  if (currentTab && currentTab.disabled) switchTab('overview');
}

// ── Session management (called by overview.js) ────────────────────────────────

async function applySession({ poNumber, selectedTests, profileKey }) {
  await apiPost('/api/session', { po_number: poNumber, active_tests: selectedTests, profile_key: profileKey || 'default' });
  activeTests = selectedTests;

  // Update PO chip in topbar
  const chip = document.getElementById('po-chip');
  document.getElementById('po-chip-value').textContent = poNumber;
  chip.style.display = poNumber ? 'inline-block' : 'none';

  updateTabStates(selectedTests);

  // Initialise each active equipment tab
  selectedTests.forEach(testId => {
    const panel = document.getElementById(`panel-${testId}`);
    if (!panel) return;
    if (testId === 'viscosity' && typeof initViscosityTab === 'function')
      initViscosityTab(panel);
    else if (testId === 'moisture' && typeof initMoistureTab === 'function')
      initMoistureTab(panel);
  });
}

// ── QC evaluation helper (called by tab scripts) ──────────────────────────────

/**
 * Evaluate a numeric reading against a spec.
 * Returns { status, label, color, inRange, spec }
 * status is one of: "approved" | "rejected" | "no_spec"
 */
function evaluateQC(value, spec) {
  if (!spec || !spec.defined) {
    return { status: 'approved', label: 'No Spec — Pass-through', color: 'var(--text-muted)', inRange: true, spec };
  }
  const tooLow  = spec.min != null && value < spec.min;
  const tooHigh = spec.max != null && value > spec.max;
  if (tooLow || tooHigh) {
    const reason = tooLow ? `below min (${spec.min})` : `above max (${spec.max})`;
    return { status: 'rejected', label: `Out of Spec — ${reason}`, color: 'var(--red)', inRange: false, spec };
  }
  return { status: 'approved', label: 'Within Spec', color: 'var(--green)', inRange: true, spec };
}

// ── Confirm & Save modal ──────────────────────────────────────────────────────

let _modalResolve = null;

/**
 * Open the save modal with a result preview and QC verdict.
 *
 * @param {string} testName   - Display name of the test
 * @param {object} resultRows - Key/value pairs shown in the preview
 * @param {object} qc         - Result of evaluateQC(): { status, label, color, inRange, spec }
 *
 * Returns Promise<{ confirmed: bool, notes: string, approval_status: string, override_justification: string }>
 */
function showSaveModal(testName, resultRows, qc) {
  const backdrop = document.getElementById('modal-backdrop');
  const body     = document.getElementById('modal-body');
  const notes    = document.getElementById('modal-notes');

  notes.value = '';

  const isRejected = qc && qc.status === 'rejected';
  const specLine = qc ? `
    <div style="display:flex; align-items:center; gap:10px; padding:12px 14px;
                background:var(--surface2); border-radius:var(--radius);
                border:1px solid ${isRejected ? 'var(--red)' : 'var(--border)'};
                margin-bottom:14px;">
      <span style="font-size:20px">${isRejected ? '✗' : '✓'}</span>
      <div>
        <div style="font-weight:600; color:${qc.color}">${isRejected ? 'REJECTED' : 'APPROVED'}</div>
        <div style="font-size:12px; color:var(--text-muted)">${qc.label}</div>
        ${qc.spec && qc.spec.defined ? `<div style="font-size:11px; color:var(--text-muted); margin-top:2px;">
          Spec: ${qc.spec.min != null ? `min ${qc.spec.min}` : ''}${qc.spec.min != null && qc.spec.max != null ? ' / ' : ''}${qc.spec.max != null ? `max ${qc.spec.max}` : ''}
        </div>` : ''}
      </div>
    </div>` : '';

  const overrideSection = `
    <div id="modal-override-section" style="display:none; margin-top:12px;">
      <div style="display:flex; align-items:center; gap:8px; margin-bottom:10px;">
        <input type="checkbox" id="modal-override-check"
               style="width:15px;height:15px;accent-color:var(--amber)" />
        <label for="modal-override-check" style="font-size:13px; cursor:pointer; color:var(--amber)">
          Override decision
        </label>
      </div>
      <div id="modal-override-fields" style="display:none;">
        <div style="font-size:11px; text-transform:uppercase; letter-spacing:.08em;
                    color:var(--text-muted); margin-bottom:6px;">Override target</div>
        <select id="modal-override-target" class="field-select" style="margin-bottom:10px;">
          ${isRejected
            ? '<option value="override_approved">Override → APPROVED</option>'
            : '<option value="override_rejected">Override → REJECTED</option>'}
        </select>
        <div style="font-size:11px; text-transform:uppercase; letter-spacing:.08em;
                    color:var(--text-muted); margin-bottom:6px;">Justification <span style="color:var(--red)">*</span></div>
        <textarea id="modal-override-justification" class="field-input" rows="3"
                  placeholder="Required — describe reason for override…"
                  style="resize:vertical;"></textarea>
      </div>
    </div>`;

  body.innerHTML = specLine + Object.entries(resultRows)
    .map(([k, v]) => `
      <div class="modal-result-row">
        <span class="modal-result-key">${k}</span>
        <span class="modal-result-value">${v ?? '—'}</span>
      </div>`)
    .join('') + overrideSection;

  // Always show override option
  document.getElementById('modal-override-section').style.display = 'block';

  // Toggle override fields on checkbox change
  document.getElementById('modal-override-check').addEventListener('change', e => {
    document.getElementById('modal-override-fields').style.display = e.target.checked ? 'block' : 'none';
  });

  // Update confirm button label
  const confirmBtn = document.getElementById('modal-confirm');
  confirmBtn.textContent = isRejected ? 'Save (Rejected)' : 'Save Result';
  confirmBtn.className   = isRejected ? 'btn btn-danger' : 'btn btn-primary';

  backdrop.style.display = 'flex';

  return new Promise(resolve => {
    _modalResolve = resolve;

    confirmBtn.onclick = () => {
      const overriding     = document.getElementById('modal-override-check').checked;
      const justification  = (document.getElementById('modal-override-justification')?.value || '').trim();
      const overrideTarget = document.getElementById('modal-override-target')?.value || '';

      if (overriding && !justification) {
        document.getElementById('modal-override-justification').style.borderColor = 'var(--red)';
        document.getElementById('modal-override-justification').focus();
        return; // block save — justification required
      }

      let finalStatus;
      if (overriding) {
        finalStatus = overrideTarget; // "override_approved" or "override_rejected"
      } else {
        finalStatus = qc ? qc.status : 'approved';
      }

      backdrop.style.display = 'none';
      resolve({
        confirmed:              true,
        notes:                  notes.value.trim(),
        approval_status:        finalStatus,
        override_justification: overriding ? justification : '',
      });
    };

    document.getElementById('modal-cancel').onclick = () => {
      backdrop.style.display = 'none';
      resolve({ confirmed: false, notes: '', approval_status: '', override_justification: '' });
    };
  });
}

// Close modal on backdrop click
document.getElementById('modal-backdrop').addEventListener('click', e => {
  if (e.target === e.currentTarget) {
    e.currentTarget.style.display = 'none';
    if (_modalResolve) _modalResolve({ confirmed: false, notes: '' });
  }
});

// ── Clock ─────────────────────────────────────────────────────────────────────

function startClock() {
  const el = document.getElementById('sys-time');
  function tick() {
    el.textContent = new Date().toLocaleTimeString('en-GB', { hour12: false });
  }
  tick();
  setInterval(tick, 1000);
}

// ── Bootstrap ─────────────────────────────────────────────────────────────────

async function boot() {
  startClock();

  try {
    allEquipment = await apiGet('/api/equipment');
    injectEquipmentTabs(allEquipment);
  } catch (e) {
    console.error('Failed to load equipment list:', e);
  }

  // Restore session state (e.g. on page refresh)
  try {
    const session = await apiGet('/api/session');
    if (session.active_tests.length) {
      activeTests = session.active_tests;
      updateTabStates(activeTests);
      if (session.po_number) {
        document.getElementById('po-chip-value').textContent = session.po_number;
        document.getElementById('po-chip').style.display = 'inline-block';
      }
    }
  } catch (e) {
    console.warn('Could not restore session:', e);
  }

  // Init overview (always visible)
  if (typeof initOverviewTab === 'function') initOverviewTab();

  // Init history tab
  if (typeof initHistoryTab === 'function') initHistoryTab();

  switchTab('overview');
}

document.addEventListener('DOMContentLoaded', boot);
