/**
 * tabs/density.js
 * ---------------
 * Density measurement tab — manual input only (no serial connection).
 *
 * Operator selects a picnometer, types the gross weight from the scale,
 * and the app calculates:
 *
 *   density = (gross_weight - picnometer_weight) / picnometer_volume
 */

function initDensityTab(panel) {
  panel.innerHTML = `
    <!-- Product summary ─────────────────────────────────────────────── -->
    <div class="card" id="dens-product-card" style="display:none;">
      <div class="card-title">Product</div>
      <div id="dens-product-body"></div>
    </div>

    <!-- Input ───────────────────────────────────────────────────────── -->
    <div class="card">
      <div class="card-title">Measurement Input</div>
      <div class="grid-2" style="gap:24px; align-items:start;">

        <div>
          <div class="field-group">
            <label class="field-label">Picnometer</label>
            <select id="dens-picnometer" class="field-select">
              <option value="">Loading…</option>
            </select>
          </div>

          <!-- Picnometer detail tile, shown after selection -->
          <div id="dens-pic-detail" style="display:none; margin-bottom:16px;">
            <div class="grid-2" style="gap:10px;">
              <div class="stat-tile">
                <div class="stat-value" id="dens-pic-weight" style="font-size:18px;">—</div>
                <div class="stat-label">Empty Weight (g)</div>
              </div>
              <div class="stat-tile">
                <div class="stat-value" id="dens-pic-volume" style="font-size:18px;">—</div>
                <div class="stat-label">Volume (mL)</div>
              </div>
            </div>
          </div>

          <div class="field-group">
            <label class="field-label">Gross Weight (g) — from scale</label>
            <input id="dens-gross-weight" class="field-input" type="number"
                   step="0.0001" min="0" placeholder="e.g. 46.32" />
          </div>

          <div class="btn-row">
            <button class="btn btn-primary" id="dens-calc-btn">Calculate</button>
            <button class="btn btn-ghost"   id="dens-reset-btn">Reset</button>
          </div>
          <div id="dens-input-alert" style="margin-top:10px;"></div>
        </div>

        <!-- Formula reference -->
        <div style="background:var(--surface2); border:1px solid var(--border);
                    border-radius:var(--radius-lg); padding:20px;">
          <div class="card-title">Formula</div>
          <div style="font-family:var(--mono); font-size:13px; color:var(--text-dim);
                      line-height:2;">
            <div>density = (gross − weight) / volume</div>
            <div style="color:var(--text-muted); font-size:11px; margin-top:8px;">
              gross  → scale reading (g)<br>
              weight → empty picnometer weight (g)<br>
              volume → picnometer calibrated volume (mL)
            </div>
          </div>
        </div>

      </div>
    </div>

    <!-- Result ──────────────────────────────────────────────────────── -->
    <div class="card" id="dens-result-card" style="display:none;">
      <div class="card-title">Result</div>

      <!-- QC verdict banner — populated by _densShowResult -->
      <div id="dens-qc-banner" style="display:none; align-items:center; gap:10px;
           padding:10px 14px; background:var(--surface2); border-radius:var(--radius);
           border:1px solid var(--border); margin-bottom:16px;"></div>

      <div style="margin-bottom:20px;">
        <span class="readout" id="dens-readout">—</span>
        <span class="readout-unit">g/mL</span>
        <div class="readout-label">Density</div>
      </div>

      <div class="grid-4" style="gap:12px; margin-bottom:16px;">
        <div class="stat-tile">
          <div class="stat-value" id="dens-res-gross" style="font-size:16px;">—</div>
          <div class="stat-label">Gross Weight (g)</div>
        </div>
        <div class="stat-tile">
          <div class="stat-value" id="dens-res-picweight" style="font-size:16px;">—</div>
          <div class="stat-label">Picnometer Weight (g)</div>
        </div>
        <div class="stat-tile">
          <div class="stat-value" id="dens-res-net" style="font-size:16px;">—</div>
          <div class="stat-label">Net Weight (g)</div>
        </div>
        <div class="stat-tile">
          <div class="stat-value" id="dens-res-vol" style="font-size:16px;">—</div>
          <div class="stat-label">Volume (mL)</div>
        </div>
      </div>

      <div class="btn-row">
        <button class="btn btn-primary" id="dens-save-btn">Save Result to PO</button>
        <button class="btn btn-ghost"   id="dens-discard-btn">Discard</button>
      </div>
    </div>
  `;

  _densLoadPicnometers();

  document.getElementById('dens-picnometer').addEventListener('change', _densOnPicnometerChange);
  document.getElementById('dens-calc-btn').addEventListener('click', _densCalculate);
  document.getElementById('dens-reset-btn').addEventListener('click', _densReset);

  renderProductSummaryCard(document.getElementById('dens-product-body'), 'density')
    .then(() => {
      if (document.getElementById('dens-product-body').innerHTML.trim())
        document.getElementById('dens-product-card').style.display = 'block';
    });
}

// ── State ─────────────────────────────────────────────────────────────────────

let _densPicnometers = [];
let _densLastResult  = null;
let _densLastQC      = null;

// ── Picnometer loading ────────────────────────────────────────────────────────

async function _densLoadPicnometers() {
  try {
    _densPicnometers = await apiGet('/api/picnometers');
    const sel = document.getElementById('dens-picnometer');
    sel.innerHTML = '<option value="">Select picnometer…</option>';
    _densPicnometers.forEach(p => {
      const opt = document.createElement('option');
      opt.value = p.id;
      opt.textContent = `${p.label}  (${p.weight_g} g / ${p.volume_ml} mL)`;
      sel.appendChild(opt);
    });
  } catch (e) {
    _densAlert('error', 'Could not load picnometer data.');
  }
}

function _densOnPicnometerChange() {
  const id  = parseInt(document.getElementById('dens-picnometer').value);
  const pic = _densPicnometers.find(p => p.id === id);
  const detail = document.getElementById('dens-pic-detail');
  if (!pic) { detail.style.display = 'none'; return; }
  document.getElementById('dens-pic-weight').textContent = pic.weight_g;
  document.getElementById('dens-pic-volume').textContent = pic.volume_ml;
  detail.style.display = 'block';
}

// ── Calculation ───────────────────────────────────────────────────────────────

async function _densCalculate() {
  const picId = parseInt(document.getElementById('dens-picnometer').value);
  const gross = parseFloat(document.getElementById('dens-gross-weight').value);

  if (!picId) { _densAlert('error', 'Please select a picnometer.'); return; }
  if (isNaN(gross) || gross <= 0) { _densAlert('error', 'Enter a valid gross weight.'); return; }

  const pic = _densPicnometers.find(p => p.id === picId);
  if (!pic) { _densAlert('error', 'Selected picnometer not found.'); return; }

  const net = gross - pic.weight_g;
  if (net <= 0) {
    _densAlert('error', `Gross weight (${gross} g) must be greater than picnometer weight (${pic.weight_g} g).`);
    return;
  }

  const density = Math.round((net / pic.volume_ml) * 10000) / 10000;

  _densLastResult = {
    density_g_ml:           density,
    gross_weight_g:         gross,
    picnometer_id:          pic.id,
    picnometer_label:       pic.label,
    picnometer_weight_g:    pic.weight_g,
    picnometer_volume_ml:   pic.volume_ml,
    net_weight_g:           Math.round(net * 10000) / 10000,
  };

  // Fetch spec for the active profile
  let qc = { status: 'approved', label: 'No Spec — Pass-through', color: 'var(--text-muted)', inRange: true, spec: null };
  try {
    const session = await apiGet('/api/session');
    const spec    = await apiGet(`/api/specs/${session.profile_key}/density`);
    qc = evaluateQC(density, spec);
  } catch (_) {}

  _densLastQC = qc;
  _densShowResult(_densLastResult, qc);
}

function _densShowResult(r, qc) {
  const qcColor = qc.status === 'rejected' ? 'var(--red)' : (qc.spec && qc.spec.defined) ? 'var(--green)' : 'var(--text-muted)';

  const readout = document.getElementById('dens-readout');
  readout.textContent = r.density_g_ml;
  readout.style.color = qcColor;

  document.getElementById('dens-res-gross').textContent  = r.gross_weight_g;
  document.getElementById('dens-res-picweight').textContent = r.picnometer_weight_g;
  document.getElementById('dens-res-net').textContent    = r.net_weight_g;
  document.getElementById('dens-res-vol').textContent    = r.picnometer_volume_ml;

  // QC verdict banner
  const banner = document.getElementById('dens-qc-banner');
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

  document.getElementById('dens-result-card').style.display = 'block';
  document.getElementById('dens-save-btn').onclick    = _densSave;
  document.getElementById('dens-discard-btn').onclick = _densReset;
}

function _densReset() {
  document.getElementById('dens-gross-weight').value = '';
  document.getElementById('dens-picnometer').value   = '';
  document.getElementById('dens-pic-detail').style.display  = 'none';
  document.getElementById('dens-result-card').style.display = 'none';
  document.getElementById('dens-input-alert').innerHTML = '';
  _densLastResult = null;
}

// ── Save ──────────────────────────────────────────────────────────────────────

async function _densSave() {
  if (!_densLastResult) return;
  const session = await apiGet('/api/session');
  const po = session.po_number;
  if (!po) { _densAlert('error', 'No PO number set. Go to Overview first.'); return; }

  const rows = {
    'PO Number':          po,
    'Density':            `${_densLastResult.density_g_ml} g/mL`,
    'Gross Weight':       `${_densLastResult.gross_weight_g} g`,
    'Picnometer':         _densLastResult.picnometer_label,
    'Picnometer Weight':  `${_densLastResult.picnometer_weight_g} g`,
    'Volume':             `${_densLastResult.picnometer_volume_ml} mL`,
  };

  const { confirmed, notes, approval_status, override_justification } =
    await showSaveModal('Density', rows, _densLastQC);
  if (!confirmed) return;

  try {
    await apiPost('/storage/save', {
      po_number:              po,
      test_id:                'density',
      values:                 _densLastResult,
      notes,
      approval_status,
      override_justification,
      product_name:           session.product_name || '',
    });
    _densAlert('success', 'Result saved.');
    document.getElementById('dens-result-card').style.display = 'none';
  } catch (e) {
    _densAlert('error', e.message);
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function _densAlert(type, msg) {
  const el = document.getElementById('dens-input-alert');
  el.innerHTML = `<div class="alert alert-${type === 'error' ? 'error' : 'success'}">${msg}</div>`;
  setTimeout(() => { el.innerHTML = ''; }, 5000);
}