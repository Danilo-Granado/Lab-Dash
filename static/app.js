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

async function applySession({ poNumber, selectedTests }) {
  await apiPost('/api/session', { po_number: poNumber, active_tests: selectedTests });
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

// ── Confirm & Save modal ──────────────────────────────────────────────────────

let _modalResolve = null;

/**
 * Open the save modal with a result preview.
 * Returns a Promise that resolves to { confirmed: bool, notes: string }.
 *
 * Usage (from a tab script):
 *   const { confirmed, notes } = await showSaveModal('Viscosity', { 'Viscosity': '123.4 mPa·s', ... });
 *   if (confirmed) { ... }
 */
function showSaveModal(testName, resultRows) {
  const backdrop = document.getElementById('modal-backdrop');
  const body     = document.getElementById('modal-body');
  const notes    = document.getElementById('modal-notes');

  notes.value = '';

  // Build result preview rows
  body.innerHTML = Object.entries(resultRows)
    .map(([k, v]) => `
      <div class="modal-result-row">
        <span class="modal-result-key">${k}</span>
        <span class="modal-result-value">${v ?? '—'}</span>
      </div>`)
    .join('');

  backdrop.style.display = 'flex';

  return new Promise(resolve => {
    _modalResolve = resolve;

    document.getElementById('modal-confirm').onclick = () => {
      backdrop.style.display = 'none';
      resolve({ confirmed: true, notes: notes.value.trim() });
    };
    document.getElementById('modal-cancel').onclick = () => {
      backdrop.style.display = 'none';
      resolve({ confirmed: false, notes: '' });
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
