/* SPPS Resin Calculator – UI. Calculations live in calc.js, strings in i18n.js. */
(function () {
  'use strict';
  const C = window.SPPSCalc;
  const I18N = window.SPPS_I18N;
  const get = id => document.getElementById(id);

  const STORE_STATE = 'spps.state.v1';
  const STORE_PROJECTS = 'spps.projects.v1';
  const STORE_PRICES = 'spps.prices.v1';

  const BUILTIN_PROJECTS = {
    icr: { labelKey: 'projIcr', infoKey: 'infoIcr', values: { resin: 'rink-am', loading: '0.80', protectedMW: '3080', freeMW: '1898', yieldPct: '44', correction: '-222' } },
    custom: { labelKey: 'projCustom', infoKey: 'infoCustom', values: { resin: 'rink-am', loading: '0.80', protectedMW: '3500', freeMW: '2500', yieldPct: '85', correction: '-222' } }
  };
  const DEFAULTS = {
    scale: '100', mass: '125', sequence: '', nTerm: 'H', cTerm: 'amide', nFmoc: false,
    system: 'dic-oxyma', aaEq: '3', numResidues: '', skipFirst: false,
    swellTimes: '3', swellVol: '6', coupleVol: '6', deprotVol: '6', deprots: '2',
    washesCouple: '5', washCoupleVol: '6', washesDeprot: '5', washDeprotVol: '6',
    cocktailVol: '7', tfaPct: '95', tfaWashes: '2', tfaWashVol: '1.5', antiVols: '3'
  };
  const CD_FIELDS = ['cocktailVol', 'tfaPct', 'tfaWashes', 'tfaWashVol', 'antiVols'];
  const DEFAULT_SCAVENGERS = [
    { name: 'TIS', manual: '', pct: '2.5', solid: false },
    { name: 'H2O', manual: '', pct: '2.5', solid: false },
    { name: '', manual: '', pct: '', solid: false },
    { name: '', manual: '', pct: '', solid: false },
    { name: '', manual: '', pct: '', solid: false }
  ];
  const DEFAULT_ANTISOLVENTS = [
    { name: 'MTBE', manual: '', pct: '70' },
    { name: 'Heptane', manual: '', pct: '30' }
  ];
  const MB_FIELDS = ['loading', 'protectedMW', 'freeMW', 'correction', 'yieldPct', 'scale', 'mass'];
  const SEQ_FIELDS = ['sequence', 'nTerm', 'cTerm', 'nFmoc'];
  const PLAN_FIELDS = ['aaEq', 'numResidues', 'skipFirst', 'swellTimes', 'swellVol', 'coupleVol', 'deprotVol', 'deprots', 'washesCouple', 'washCoupleVol', 'washesDeprot', 'washDeprotVol'];
  const STATE_FIELDS = ['resin'].concat(MB_FIELDS, SEQ_FIELDS, ['system'], PLAN_FIELDS, CD_FIELDS);

  let mode = 'scale';
  let last = null;      // last mass-balance result
  let lastSeq = null;   // last sequence MW result
  let lastPlan = null;  // last coupling plan
  let lastCleavage = null; // last C&D plan
  let prices = null;       // parsed price list

  /* ---------- storage (never required for the page to work) ---------- */
  function load(key, fallback) {
    try { const raw = localStorage.getItem(key); return raw ? JSON.parse(raw) : fallback; } catch (e) { return fallback; }
  }
  function store(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); return true; } catch (e) { return false; }
  }
  function savedProjects() { return load(STORE_PROJECTS, {}); }

  /* ---------- strings ---------- */
  function t(key, vars) {
    let s = I18N.en[key] || key;
    if (vars) Object.keys(vars).forEach(k => { s = s.split('{' + k + '}').join(vars[k]); });
    return s;
  }
  function initText() {
    document.querySelectorAll('[data-i18n]').forEach(el => { el.textContent = t(el.dataset.i18n); });
    document.title = t('title');
    get('version').textContent = t('version', { v: C.APP_VERSION });
    updateProjectInfo();
    updateCorrectionInfo();
    calculate();
  }

  /* ---------- field helpers ---------- */
  function readNum(id) { const raw = String(get(id).value).trim(); return raw === '' ? NaN : Number(raw); }
  function getField(id) { const el = get(id); return el.type === 'checkbox' ? el.checked : el.value; }
  function setField(id, value) { const el = get(id); if (el.type === 'checkbox') el.checked = !!value; else el.value = value; }
  function fmt(x, unit) { return Number.isFinite(x) ? C.formatNumber(x) + (unit ? ' ' + unit : '') : '—'; }
  function esc(s) { return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
  function showError(id, messages) {
    const el = get(id);
    el.hidden = !messages.length;
    el.textContent = messages.join(' ');
  }

  /* ---------- projects ---------- */
  function renderProjectOptions(selected) {
    const sel = get('project');
    sel.textContent = '';
    Object.keys(BUILTIN_PROJECTS).forEach(key => sel.add(new Option(t(BUILTIN_PROJECTS[key].labelKey), key)));
    const names = Object.keys(savedProjects()).sort((a, b) => a.localeCompare(b));
    if (names.length) {
      const group = document.createElement('optgroup');
      group.label = t('savedGroup');
      names.forEach(name => group.appendChild(new Option(name, 'saved:' + name)));
      sel.appendChild(group);
    }
    sel.value = selected && [...sel.options].some(o => o.value === selected) ? selected : 'icr';
    get('deleteProject').hidden = !sel.value.startsWith('saved:');
  }
  function updateProjectInfo() {
    const key = get('project').value;
    get('projectInfo').textContent = key.startsWith('saved:')
      ? t('infoSaved', { name: key.slice(6) })
      : t(BUILTIN_PROJECTS[key].infoKey);
    get('deleteProject').hidden = !key.startsWith('saved:');
  }
  function applyProject() {
    const key = get('project').value;
    if (key.startsWith('saved:')) {
      const snap = savedProjects()[key.slice(6)];
      if (snap) applySnapshot(snap);
    } else {
      const values = BUILTIN_PROJECTS[key].values;
      Object.keys(values).forEach(id => setField(id, values[id]));
    }
    updateProjectInfo();
    updateCorrectionInfo();
    calculate();
  }
  function saveProject() {
    const current = get('project').value;
    const suggested = current.startsWith('saved:') ? current.slice(6) : '';
    const name = (window.prompt(t('promptName'), suggested) || '').trim();
    if (!name) return;
    const projects = savedProjects();
    if (projects[name] && name !== suggested && !window.confirm(t('confirmOverwrite', { name }))) return;
    projects[name] = snapshot();
    if (!store(STORE_PROJECTS, projects)) { window.alert(t('storageUnavailable')); return; }
    renderProjectOptions('saved:' + name);
    updateProjectInfo();
    persist();
  }
  function deleteProject() {
    const key = get('project').value;
    if (!key.startsWith('saved:')) return;
    const name = key.slice(6);
    if (!window.confirm(t('confirmDelete', { name }))) return;
    const projects = savedProjects();
    delete projects[name];
    store(STORE_PROJECTS, projects);
    renderProjectOptions('icr');
    applyProject();
  }

  /* ---------- state snapshot ---------- */
  function snapshot() {
    const snap = { mode, reagentEqs: currentReagentEqs(), customResidues: readCustom(), scavengers: readScavengers(), antisolvents: readAntisolvents() };
    STATE_FIELDS.forEach(id => { snap[id] = getField(id); });
    return snap;
  }
  function applySnapshot(snap) {
    // v8.0 had a single wash setting for both coupling and deprotection washes.
    if (snap.washes !== undefined && snap.washesCouple === undefined) {
      snap = Object.assign({}, snap, { washesCouple: snap.washes, washesDeprot: snap.washes, washCoupleVol: snap.washVol, washDeprotVol: snap.washVol });
    }
    if (snap.coupleVol === undefined) snap = Object.assign({}, snap, { coupleVol: DEFAULTS.coupleVol });
    ['coupleVol', 'deprotVol', 'washDeprotVol', 'washCoupleVol', 'swellVol', 'swellTimes'].forEach(id => {
      if (snap[id] !== undefined && !get(id).querySelector('option[value="' + snap[id] + '"]')) snap[id] = DEFAULTS[id];
    });
    STATE_FIELDS.forEach(id => { if (snap[id] !== undefined) setField(id, snap[id]); });
    renderCustom(snap.customResidues || []);
    renderScavengers(snap.scavengers || DEFAULT_SCAVENGERS);
    renderAntisolvents(snap.antisolvents || DEFAULT_ANTISOLVENTS);
    if (!C.COUPLING_SYSTEMS[get('system').value]) setField('system', DEFAULTS.system);
    renderReagentEqs(snap.reagentEqs);
    setMode(snap.mode === 'mass' ? 'mass' : 'scale', false, false);
  }
  function persist() {
    const snap = snapshot();
    snap.project = get('project').value;
    store(STORE_STATE, snap);
  }

  /* ---------- resin ---------- */
  function renderResinOptions() {
    const sel = get('resin');
    Object.keys(C.RESINS).forEach(key => sel.add(new Option(C.RESINS[key].label, key)));
  }
  function updateCorrectionInfo() {
    const r = C.RESINS[get('resin').value];
    const v = r.correction;
    get('correctionInfo').textContent = t('correctionInfo', {
      resin: r.label,
      value: (v < 0 ? '−' : '') + Math.abs(v).toLocaleString('en-US', { maximumFractionDigits: 2 })
    });
    get('chemNote').textContent = t('note-' + r.family) + ' ' + t('noteCommon');
  }
  function changeResin() {
    setField('correction', String(C.RESINS[get('resin').value].correction));
    updateCorrectionInfo();
    calculate();
  }

  /* ---------- coupling system ---------- */
  function renderSystemOptions() {
    const sel = get('system');
    const current = sel.value || DEFAULTS.system;
    sel.textContent = '';
    Object.keys(C.COUPLING_SYSTEMS).forEach(key => sel.add(new Option(C.COUPLING_SYSTEMS[key].label, key)));
    sel.value = current;
  }
  function currentReagentEqs() {
    return [...document.querySelectorAll('#reagentEqs input')].map(el => el.value);
  }
  function renderReagentEqs(values) {
    const sys = C.COUPLING_SYSTEMS[get('system').value];
    const box = get('reagentEqs');
    box.textContent = '';
    sys.reagents.forEach(([id, eq], i) => {
      const wrap = document.createElement('div');
      wrap.className = 'field';
      const label = document.createElement('label');
      label.htmlFor = 'eq-' + id;
      label.textContent = t('eqOf', { name: C.REAGENTS[id].name });
      const input = document.createElement('input');
      Object.assign(input, { id: 'eq-' + id, type: 'number', min: '0', step: 'any', inputMode: 'decimal' });
      input.dataset.reagent = id;
      input.value = values && values.length === sys.reagents.length && values[i] !== '' ? values[i] : String(eq);
      input.addEventListener('input', calculate);
      wrap.append(label, input);
      box.appendChild(wrap);
    });
  }
  function changeSystem() {
    setField('aaEq', String(C.COUPLING_SYSTEMS[get('system').value].aaEq));
    renderReagentEqs(null);
    calculate();
  }

  /* ---------- mode ---------- */
  function setMode(next, recalc, carry) {
    // Carry the current result over so the other direction starts from the same point.
    if (carry !== false && next !== mode && last) {
      if (next === 'mass') setField('mass', String(+last.mass.toFixed(4)));
      else setField('scale', String(+last.scale.toFixed(4)));
    }
    mode = next;
    const isScale = next === 'scale';
    get('modeScale').classList.toggle('active', isScale);
    get('modeMass').classList.toggle('active', !isScale);
    get('modeScale').setAttribute('aria-pressed', String(isScale));
    get('modeMass').setAttribute('aria-pressed', String(!isScale));
    get('scaleGroup').hidden = !isScale;
    get('massGroup').hidden = isScale;
    if (recalc !== false) calculate();
  }

  /* ---------- calculations ---------- */
  function calculate() {
    const { errors, result } = C.massBalance({
      loading: readNum('loading'), protectedMW: readNum('protectedMW'), freeMW: readNum('freeMW'),
      correction: readNum('correction'), yieldPct: readNum('yieldPct'),
      mode, value: readNum(mode === 'scale' ? 'scale' : 'mass')
    });
    showError('error', errors.map(k => t(k)));
    last = result;
    get('copy').disabled = !result;
    const r = result || {};
    get('outMass').textContent = fmt(r.mass, 'g');
    get('outScale').textContent = fmt(r.scale, 'mmol');
    get('outPR').textContent = fmt(r.peptideResin, 'g');
    get('outFinalLoading').textContent = fmt(r.finalLoading, 'mmol/g');
    get('outTheory').textContent = fmt(r.theoretical, 'g');
    get('outFinal').textContent = fmt(r.final, 'g');
    updateSequence();
    updatePlan();
    updateCleavage();
    updateSummary();
    persist();
  }

  function updateSequence() {
    const raw = get('sequence').value;
    const custom = readCustom().map(c => ({ name: c.name, mass: Number(c.mass), bbMW: Number(c.bbMW) }));
    const valid = C.customIndex(custom);
    document.querySelectorAll('#customList .custom-row').forEach((row, i) => {
      const c = custom[i];
      row.classList.toggle('bad', !!(c.name.trim() || c.mass || c.bbMW) && !valid[c.name.trim().toLowerCase()]);
    });
    const res = C.sequenceMW(raw, { nTerm: get('nTerm').value, cTerm: get('cTerm').value, nFmoc: get('nFmoc').checked, custom });
    lastSeq = Number.isFinite(res.free) ? res : null;
    get('seqLen').textContent = res.residues.length ? res.residues.length + ' ' + t('residuesUnit') : '—';
    get('seqProt').textContent = fmt(res.protected, 'g/mol');
    get('seqFree').textContent = fmt(res.free, 'g/mol');
    const bad = [...new Set(res.invalid.map(x => x.ch))];
    showError('seqError', bad.length ? [t('seqInvalid', { list: bad.join(', ') })] : []);
    get('applySeq').disabled = !lastSeq;
  }
  function applySequenceMW() {
    if (!lastSeq) return;
    setField('protectedMW', lastSeq.protected.toFixed(2));
    setField('freeMW', lastSeq.free.toFixed(2));
    setField('numResidues', String(lastSeq.residues.length));
    calculate();
  }

  function table(head, rows, foot) {
    const cell = (tag, c) => {
      const num = typeof c === 'object' && c && c.num;
      const text = typeof c === 'object' && c ? c.text : c;
      return '<' + tag + (num ? ' class="num"' : '') + '>' + esc(text) + '</' + tag + '>';
    };
    let html = '<thead><tr>' + head.map(c => cell('th', c)).join('') + '</tr></thead><tbody>';
    html += rows.map(r => '<tr>' + r.map(c => cell('td', c)).join('') + '</tr>').join('') + '</tbody>';
    if (foot) {
      const footRows = Array.isArray(foot[0]) ? foot : [foot];
      html += '<tfoot>' + footRows.map(r => '<tr>' + r.map(c => cell('td', c)).join('') + '</tr>').join('') + '</tfoot>';
    }
    return html;
  }
  const n = (x, d) => ({ text: Number.isFinite(x) ? C.formatNumber(x, d) : '—', num: true });
  const eq = x => ({ text: Number.isFinite(x) ? String(+x.toFixed(3)) : '—', num: true });
  // Large volumes read better in litres.
  const vol = mL => Math.abs(mL) >= 1000 ? fmt(mL / 1000, 'L') : fmt(mL, 'mL');
  // Total used: switch to kg / L above 1000 g / 1000 mL, always 2 decimals.
  const amount = (value, unit) => {
    if (!Number.isFinite(value)) return '—';
    if (value >= 1000) return C.formatNumber(value / 1000, 2) + (unit === 'g' ? ' kg' : ' L');
    return C.formatNumber(value, 2) + ' ' + unit;
  };

  function updatePlan() {
    const sys = C.COUPLING_SYSTEMS[get('system').value];
    const aaEq = readNum('aaEq');
    const reagents = [...document.querySelectorAll('#reagentEqs input')].map(el => [el.dataset.reagent, el.value === '' ? NaN : Number(el.value)]);
    const nums = ['swellVol', 'swellTimes', 'coupleVol', 'deprotVol', 'deprots', 'washesCouple', 'washCoupleVol', 'washesDeprot', 'washDeprotVol'].map(readNum);
    const seqResidues = lastSeq ? lastSeq.residues : [];
    const manualCount = Math.round(readNum('numResidues'));
    const residueCount = manualCount > 0 ? manualCount : seqResidues.length;
    const valid = aaEq > 0 && reagents.every(([, eq]) => eq >= 0) && nums.every(x => x >= 0);
    showError('planError', last && !valid ? [t('errPlan')] : []);
    const ids = ['perCouplingTable', 'cycleTable', 'totalsTable'];
    if (!last || !valid || !sys) {
      lastPlan = null;
      ids.forEach(id => { get(id).innerHTML = ''; });
      get('noSeqHint').hidden = false;
      return;
    }
    const plan = C.couplingPlan({
      scale: last.scale, resinMass: last.mass, residues: seqResidues, residueCount, aaEq, reagents,
      skipFirst: get('skipFirst').checked,
      swellVol: nums[0], swellTimes: nums[1], coupleVol: nums[2], deprotVol: nums[3], deprots: nums[4],
      washesCouple: nums[5], washCoupleVol: nums[6], washesDeprot: nums[7], washDeprotVol: nums[8]
    });
    lastPlan = plan;

    const aaMmol = last.scale * aaEq;
    get('perCouplingTable').innerHTML = table(
      [t('thReagent'), { text: t('thEq'), num: true }, { text: t('thMW'), num: true }, { text: t('thMmol'), num: true }, { text: t('thGrams'), num: true }, { text: t('thVolume'), num: true }],
      [[t('fmocAA'), eq(aaEq), { text: '—', num: true }, n(aaMmol), { text: '—', num: true }, { text: '—', num: true }]]
        .concat(plan.perCoupling.map(r => [r.name, eq(r.eq), n(r.mw, 2), n(r.mmol), n(r.grams), Number.isFinite(r.mL) ? n(r.mL) : { text: '—', num: true }]))
    );

    get('noSeqHint').hidden = seqResidues.length > 0;
    get('cycleTable').innerHTML = seqResidues.length ? table(
      [{ text: t('thCycle'), num: true }, t('thResidue'), t('thBuildingBlock'), { text: t('thMW'), num: true }, { text: t('thMmol'), num: true }, { text: t('thGrams'), num: true }],
      plan.cycles.map(c => [n(c.cycle, 0), c.residue + ' (' + (c.d ? 'D-' : '') + c.code + ')', c.name, n(c.mw, 2), n(c.mmol), n(c.grams)]),
      [t('sumRow'), '', '', '', '', n(plan.aaTotalGrams)]
    ) : '';

    const rows = [];
    if (residueCount > 0) {
      rows.push([t('numResidues'), n(plan.nRes, 0)]);
      rows.push([t('couplingCycles'), n(plan.couplings, 0)]);
      if (seqResidues.length) {
        plan.aaTotals.forEach(a => rows.push([a.name + ' (×' + a.count + ')', { text: fmt(a.grams, 'g'), num: true }]));
        rows.push([t('totalAA'), { text: fmt(plan.aaTotalGrams, 'g'), num: true }]);
      }
      plan.reagentTotals.forEach(r => rows.push([r.name, { text: fmt(r.grams, 'g') + (Number.isFinite(r.mL) ? ' / ' + vol(r.mL) : ''), num: true }]));
      rows.push([t('totalSwell'), { text: vol(plan.swellDMF), num: true }]);
      rows.push([t('totalCouple'), { text: vol(plan.coupleDMF), num: true }]);
      rows.push([t('totalWashCouple'), { text: vol(plan.washCoupleDMF), num: true }]);
      rows.push([t('totalWashDeprot'), { text: vol(plan.washDeprotDMF), num: true }]);
      rows.push([t('totalPip'), { text: vol(plan.piperidineSolution), num: true }]);
      rows.push([t('totalPipNeat'), { text: vol(plan.piperidine), num: true }]);
      rows.push([t('totalDMF'), { text: vol(plan.totalDMF), num: true }]);
      get('totalsTable').innerHTML = table([t('thItem'), { text: t('thAmount'), num: true }], rows);
    } else {
      get('totalsTable').innerHTML = '';
    }
  }

  /* ---------- non-natural and custom residues ---------- */
  /* Residue buttons. Standard residues insert their one-letter code (lowercase for D),
   * non-natural ones insert [name] (with a D- prefix for D). Typing in the box still works. */
  let seqCursorTouched = false;
  function insertResidue(token) {
    const box = get('sequence');
    const value = box.value;
    const at = seqCursorTouched ? box.selectionEnd : value.length;
    box.value = value.slice(0, at) + token + value.slice(at);
    box.selectionStart = box.selectionEnd = at + token.length;
    calculate();
  }
  function deleteLastResidue() {
    const box = get('sequence');
    const at = seqCursorTouched ? box.selectionEnd : box.value.length;
    const before = box.value.slice(0, at).replace(/[\s\-.\d]+$/, '');
    const m = before.match(/\[[^\]]*\]$|.$/);
    const cut = m ? before.length - m[0].length : 0;
    box.value = before.slice(0, cut) + box.value.slice(at);
    box.selectionStart = box.selectionEnd = cut;
    calculate();
  }
  function padButton(label, title, onClick) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = label;
    btn.title = title;
    btn.addEventListener('click', onClick);
    return btn;
  }
  function renderPads() {
    const isD = () => get('padD').checked;
    const std = get('aaPad');
    std.textContent = '';
    Object.keys(C.RESIDUES).sort((x, y) => C.RESIDUES[x].code.localeCompare(C.RESIDUES[y].code)).forEach(ch => {
      std.appendChild(padButton(C.RESIDUES[ch].code, C.buildingBlock(ch).name + ' (' + ch + ')',
        () => insertResidue(isD() && ch !== 'G' ? ch.toLowerCase() : ch)));
    });
    const non = get('nonstdPad');
    non.textContent = '';
    Object.keys(C.NONSTD).forEach(key => {
      non.appendChild(padButton(C.buildingBlock(key).name, '[' + key + ']',
        () => insertResidue('[' + (isD() ? 'D-' : '') + key + ']')));
    });
  }
  function readCustom() {
    return [...document.querySelectorAll('#customList .custom-row')].map(row => ({
      name: row.querySelector('[data-k=name]').value,
      mass: row.querySelector('[data-k=mass]').value,
      bbMW: row.querySelector('[data-k=bbMW]').value
    }));
  }
  function customRow(c) {
    const row = document.createElement('div');
    row.className = 'custom-row';
    [['name', 'customName', 'text'], ['mass', 'customMass', 'number'], ['bbMW', 'customBB', 'number']].forEach(([k, labelKey, type]) => {
      const field = document.createElement('div');
      field.className = 'field';
      const label = document.createElement('label');
      label.textContent = t(labelKey);
      const input = document.createElement('input');
      input.type = type;
      input.dataset.k = k;
      input.value = c[k] || '';
      if (type === 'number') { input.step = 'any'; input.min = '0'; input.inputMode = 'decimal'; }
      else { input.autocomplete = 'off'; input.spellcheck = false; }
      input.addEventListener('input', calculate);
      label.appendChild(input);
      field.appendChild(label);
      row.appendChild(field);
    });
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'no-print';
    remove.textContent = '✕';
    remove.setAttribute('aria-label', t('removeCustom'));
    remove.addEventListener('click', () => { row.remove(); calculate(); });
    row.appendChild(remove);
    return row;
  }
  function renderCustom(list) {
    const box = get('customList');
    box.textContent = '';
    list.forEach(c => box.appendChild(customRow(c)));
  }

  /* ---------- cleavage & deprotection ---------- */
  function scavengerRow(s) {
    const row = document.createElement('div');
    row.className = 'cd-row';
    const sel = document.createElement('select');
    sel.dataset.k = 'name';
    sel.add(new Option('—', ''));
    Object.keys(C.SCAVENGERS).forEach(k => sel.add(new Option(k === 'H2O' ? 'H₂O' : k, k)));
    sel.add(new Option(t('other'), '__other'));
    sel.value = [...sel.options].some(o => o.value === s.name) ? s.name : '';
    const manual = document.createElement('input');
    manual.dataset.k = 'manual'; manual.placeholder = t('customName'); manual.value = s.manual || ''; manual.autocomplete = 'off';
    const pct = document.createElement('input');
    pct.type = 'number'; pct.dataset.k = 'pct'; pct.placeholder = '%'; pct.min = '0'; pct.step = 'any'; pct.inputMode = 'decimal'; pct.value = s.pct || '';
    const solidLbl = document.createElement('label');
    solidLbl.className = 'sc-solid';
    const solid = document.createElement('input');
    solid.type = 'checkbox'; solid.dataset.k = 'solid'; solid.checked = !!s.solid;
    solidLbl.append(solid, document.createTextNode(' ' + t('solidUnit')));
    function sync() { const other = sel.value === '__other'; manual.hidden = !other; solidLbl.hidden = !other; }
    sync();
    [sel, manual, pct].forEach(el => el.addEventListener('input', () => { sync(); calculate(); }));
    sel.addEventListener('change', () => { sync(); calculate(); });
    solid.addEventListener('change', calculate);
    row.append(sel, manual, pct, solidLbl);
    return row;
  }
  function renderScavengers(list) {
    const box = get('scavengers'); box.textContent = '';
    list.forEach(s => box.appendChild(scavengerRow(s)));
  }
  function readScavengers() {
    return [...document.querySelectorAll('#scavengers .cd-row')].map(row => ({
      name: row.querySelector('[data-k=name]').value,
      manual: row.querySelector('[data-k=manual]').value,
      pct: row.querySelector('[data-k=pct]').value,
      solid: row.querySelector('[data-k=solid]').checked
    }));
  }
  function antisolventRow(a) {
    const row = document.createElement('div');
    row.className = 'cd-row';
    const sel = document.createElement('select');
    sel.dataset.k = 'name';
    sel.add(new Option('—', ''));
    C.ANTISOLVENTS.forEach(nm => sel.add(new Option(nm, nm)));
    sel.add(new Option(t('other'), '__other'));
    sel.value = [...sel.options].some(o => o.value === a.name) ? a.name : '';
    const manual = document.createElement('input');
    manual.dataset.k = 'manual'; manual.placeholder = t('customName'); manual.value = a.manual || ''; manual.autocomplete = 'off';
    const pct = document.createElement('input');
    pct.type = 'number'; pct.dataset.k = 'pct'; pct.placeholder = '%'; pct.min = '0'; pct.step = 'any'; pct.inputMode = 'decimal'; pct.value = a.pct || '';
    function sync() { manual.hidden = sel.value !== '__other'; }
    sync();
    [sel, manual, pct].forEach(el => el.addEventListener('input', () => { sync(); calculate(); }));
    sel.addEventListener('change', () => { sync(); calculate(); });
    row.append(sel, manual, pct);
    return row;
  }
  function renderAntisolvents(list) {
    const box = get('antisolvents'); box.textContent = '';
    list.forEach(a => box.appendChild(antisolventRow(a)));
  }
  function readAntisolvents() {
    return [...document.querySelectorAll('#antisolvents .cd-row')].map(row => ({
      name: row.querySelector('[data-k=name]').value,
      manual: row.querySelector('[data-k=manual]').value,
      pct: row.querySelector('[data-k=pct]').value
    }));
  }
  function cocktailComponents() {
    const comps = [{ name: 'TFA', pct: readNum('tfaPct'), solid: false }];
    readScavengers().forEach(s => {
      if (!s.name) return;
      const other = s.name === '__other';
      const name = other ? (s.manual.trim() || t('other')) : (s.name === 'H2O' ? 'H₂O' : s.name);
      const solid = other ? s.solid : C.SCAVENGERS[s.name].solid;
      comps.push({ name, pct: s.pct === '' ? NaN : Number(s.pct), solid });
    });
    return comps;
  }
  function antisolventList() {
    return readAntisolvents().filter(a => a.name).map(a => ({
      name: a.name === '__other' ? (a.manual.trim() || t('other')) : a.name,
      pct: a.pct === '' ? NaN : Number(a.pct)
    }));
  }
  function updateCleavage() {
    const ids = ['cocktailTable', 'cdTotals'];
    if (!last) {
      ids.forEach(id => { get(id).innerHTML = ''; });
      get('cocktailSum').textContent = ''; get('antiSum').textContent = ''; get('cdError').hidden = true;
      return;
    }
    const plan = C.cleavagePlan({
      peptideResin: last.peptideResin,
      cocktailVol: readNum('cocktailVol'),
      components: cocktailComponents(),
      tfaWashes: readNum('tfaWashes'), tfaWashVol: readNum('tfaWashVol'),
      antisolvents: antisolventList(), antisolventVols: readNum('antiVols')
    });
    lastCleavage = plan;
    get('cocktailTable').innerHTML = table(
      [t('thComponent'), { text: t('percent'), num: true }, { text: t('thAmount'), num: true }],
      plan.components.map(c => [c.name, n(c.pct), { text: fmt(c.amount, c.unit), num: true }])
    );
    const sumBad = Math.abs(plan.pctSum - 100) > 0.01;
    get('cocktailSum').textContent = t('cocktailSumMsg', { sum: C.formatNumber(plan.pctSum) });
    get('cocktailSum').style.color = sumBad ? '#a42121' : '';
    const antiBad = plan.antisolvents.length && Math.abs(plan.antiPctSum - 100) > 0.01;
    get('antiSum').textContent = plan.antisolvents.length ? t('antiSumMsg', { sum: C.formatNumber(plan.antiPctSum) }) : '';
    get('antiSum').style.color = antiBad ? '#a42121' : '';
    const rows = [
      [t('cocktailVolume'), { text: vol(plan.cocktailVolume), num: true }],
      [t('tfaWashVolume'), { text: vol(plan.tfaWashVolume), num: true }],
      [t('peptideCocktailVolume'), { text: vol(plan.peptideCocktailVolume), num: true }]
    ];
    plan.antisolvents.forEach(a => rows.push([a.name + ' (' + C.formatNumber(a.pct) + '%)', { text: vol(a.volume), num: true }]));
    rows.push([t('antisolventVolume'), { text: vol(plan.antisolventVolume), num: true }]);
    rows.push([t('precipitationVolume'), { text: vol(plan.precipitationVolume), num: true }]);
    get('cdTotals').innerHTML = table([t('thItem'), { text: t('thAmount'), num: true }], rows);
  }

  /* ---------- materials summary ---------- */
  function updateSummary() {
    const tbl = get('summaryTable');
    const empty = get('summaryEmpty');
    if (!last) { tbl.innerHTML = ''; empty.hidden = true; return; }
    const mats = {};
    const order = [];
    function add(name, value, unit) {
      if (!name || !Number.isFinite(value) || value <= 0) return;
      const key = name + '\u0001' + unit;
      if (!mats[key]) { mats[key] = { name, unit, value: 0 }; order.push(key); }
      mats[key].value += value;
    }
    if (lastPlan) {
      lastPlan.aaTotals.forEach(a => add(a.name, a.grams, 'g'));
      lastPlan.reagentTotals.forEach(r => { if (Number.isFinite(r.mL)) add(r.name, r.mL, 'mL'); else add(r.name, r.grams, 'g'); });
      add(t('matDMF'), lastPlan.totalDMF, 'mL');
      add(t('matPiperidine'), lastPlan.piperidine, 'mL');
    }
    if (lastCleavage) {
      lastCleavage.components.forEach(c => add(c.name, c.amount, c.unit));
      add('TFA', lastCleavage.tfaWashVolume, 'mL');
      lastCleavage.antisolvents.forEach(a => add(a.name, a.volume, 'mL'));
    }
    const list = order.map(k => mats[k]).sort((a, b) => a.name.localeCompare(b.name));
    empty.hidden = list.length > 0 || !!(lastPlan && lastPlan.couplings > 0);
    if (!list.length) { tbl.innerHTML = ''; return; }

    const cur = prices && prices.currency ? prices.currency + ' ' : '';
    if (!prices) {
      tbl.innerHTML = table([t('thMaterial'), { text: t('thTotalUsed'), num: true }],
        list.map(m => [m.name, { text: amount(m.value, m.unit), num: true }]));
      return;
    }
    const unitLabel = { kg: 'kg', g: 'g', L: 'L', mL: 'mL' };
    let totalCost = 0, missing = 0, priced = 0;
    const rows = list.map(m => {
      const c = C.materialCost(m, prices);
      if (c && Number.isFinite(c.cost)) {
        totalCost += c.cost; priced++;
        const priceText = cur + C.formatNumber(c.price, 2) + ' /' + (unitLabel[c.priceUnit] || c.priceUnit);
        return [m.name, { text: amount(m.value, m.unit), num: true }, { text: priceText, num: true }, { text: cur + C.formatNumber(c.cost, 2), num: true }];
      }
      missing++;
      const why = c && c.needsDensity ? t('needDensity') : '—';
      return [m.name, { text: amount(m.value, m.unit), num: true }, { text: why, num: true }, { text: '—', num: true }];
    });
    const rmc = Number.isFinite(last.final) && last.final > 0 ? totalCost / last.final : NaN;
    const foot = [
      [t('totalRMC'), '', '', { text: cur + C.formatNumber(totalCost, 2), num: true }],
      [t('rmcPerG'), '', '', { text: Number.isFinite(rmc) ? cur + C.formatNumber(rmc, 2) + ' /g' : '—', num: true }]
    ];
    tbl.innerHTML = table(
      [t('thMaterial'), { text: t('thTotalUsed'), num: true }, { text: t('thPrice'), num: true }, { text: t('thCost'), num: true }],
      rows, foot);
    get('rmcNote').textContent = t('rmcNote', { priced: String(priced), missing: String(missing) });
    get('rmcNote').hidden = false;
  }

  /* ---------- prices ---------- */
  function applyPrices(text) {
    prices = text ? C.parsePrices(text) : null;
    get('priceStatus').textContent = prices ? t('pricesLoaded', { n: String(prices.entries.length) }) : '';
    get('clearPrices').hidden = !prices;
    get('rmcNote').hidden = !prices;
  }
  function loadPricesFromStore() {
    const text = load(STORE_PRICES, null);
    if (text) applyPrices(text);
  }
  function onPriceFile(ev) {
    const file = ev.target.files && ev.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const text = String(reader.result || '');
      store(STORE_PRICES, text);
      applyPrices(text);
      calculate();
    };
    reader.readAsText(file);
    ev.target.value = '';
  }
  function clearPrices() {
    try { localStorage.removeItem(STORE_PRICES); } catch (e) {}
    prices = null;
    get('priceStatus').textContent = '';
    get('clearPrices').hidden = true;
    get('rmcNote').hidden = true;
    get('rmcNote').textContent = '';
    calculate();
  }

  /* ---------- copy / reset ---------- */
  function resultsText() {
    const lines = [
      t('copyHeader', { v: C.APP_VERSION }),
      t('project') + ': ' + get('project').selectedOptions[0].text,
      t('resin') + ': ' + get('resin').selectedOptions[0].text,
      t('loading') + ': ' + get('loading').value,
      t('protectedMW') + ': ' + get('protectedMW').value,
      t('freeMW') + ': ' + get('freeMW').value,
      t('correction') + ': ' + get('correction').value,
      t('yieldPct') + ': ' + get('yieldPct').value,
      t('outMass') + ': ' + fmt(last.mass, 'g'),
      t('outScale') + ': ' + fmt(last.scale, 'mmol'),
      t('outPR') + ': ' + fmt(last.peptideResin, 'g'),
      t('outFinalLoading') + ': ' + fmt(last.finalLoading, 'mmol/g'),
      t('outTheory') + ': ' + fmt(last.theoretical, 'g'),
      t('outFinal') + ': ' + fmt(last.final, 'g')
    ];
    if (lastSeq) {
      lines.push('', t('sequence') + ': ' + lastSeq.residues.map(r => r.label).join(''),
        t('seqProt') + ': ' + fmt(lastSeq.protected, 'g/mol'),
        t('seqFree') + ': ' + fmt(lastSeq.free, 'g/mol'));
    }
    if (lastPlan) {
      lines.push('', t('system') + ': ' + get('system').selectedOptions[0].text + ' · ' + t('aaEq') + ' ' + get('aaEq').value);
      lastPlan.perCoupling.forEach(r => lines.push(r.name + ' (' + eq(r.eq).text + ' eq): ' + fmt(r.grams, 'g') + (Number.isFinite(r.mL) ? ' / ' + fmt(r.mL, 'mL') : '') + ' / ' + t('perCoupling')));
      if (lastPlan.cycles.length) lines.push(t('totalAA') + ': ' + fmt(lastPlan.aaTotalGrams, 'g'));
      lines.push(t('totalDMF') + ': ' + fmt(lastPlan.totalDMF / 1000, 'L'));
    }
    return lines.join('\n');
  }
  async function copyResults() {
    if (!last) return;
    const text = resultsText();
    try {
      await navigator.clipboard.writeText(text);
      get('copy').textContent = t('copied');
      setTimeout(() => { get('copy').textContent = t('copy'); }, 1500);
    } catch (e) {
      window.prompt(t('copyPrompt'), text);
    }
  }
  function applyDefaults() {
    Object.keys(DEFAULTS).forEach(id => setField(id, DEFAULTS[id]));
    renderCustom([]);
    renderReagentEqs(null);
    renderScavengers(DEFAULT_SCAVENGERS);
    renderAntisolvents(DEFAULT_ANTISOLVENTS);
  }
  function reset() {
    applyDefaults();
    setMode('scale', false, false);
    applyProject();
  }

  /* ---------- init ---------- */
  renderResinOptions();
  renderSystemOptions();
  renderPads();
  for (let i = 0; i <= 6; i++) get('tfaWashes').add(new Option(String(i), String(i)));
  applyDefaults();
  MB_FIELDS.concat(SEQ_FIELDS, PLAN_FIELDS, CD_FIELDS).forEach(id => get(id).addEventListener('input', calculate));
  ['nTerm', 'cTerm', 'nFmoc', 'skipFirst', 'swellTimes', 'swellVol', 'washesDeprot', 'washesCouple', 'coupleVol', 'deprotVol', 'washDeprotVol', 'washCoupleVol', 'tfaWashes'].forEach(id => get(id).addEventListener('change', calculate));
  get('resin').addEventListener('change', changeResin);
  get('system').addEventListener('change', changeSystem);
  get('project').addEventListener('change', applyProject);
  get('modeScale').addEventListener('click', () => setMode('scale'));
  get('modeMass').addEventListener('click', () => setMode('mass'));
  get('saveProject').addEventListener('click', saveProject);
  get('deleteProject').addEventListener('click', deleteProject);
  get('applySeq').addEventListener('click', applySequenceMW);
  ['click', 'keyup', 'select'].forEach(ev => get('sequence').addEventListener(ev, () => { seqCursorTouched = true; }));
  get('padBack').addEventListener('click', deleteLastResidue);
  get('padClear').addEventListener('click', () => { get('sequence').value = ''; seqCursorTouched = false; calculate(); });
  get('addCustom').addEventListener('click', () => {
    const row = customRow({});
    get('customList').appendChild(row);
    row.querySelector('input').focus();
  });
  get('reset').addEventListener('click', reset);
  get('print').addEventListener('click', () => window.print());
  get('copy').addEventListener('click', copyResults);
  get('uploadPrices').addEventListener('click', () => get('priceFile').click());
  get('priceFile').addEventListener('change', onPriceFile);
  get('clearPrices').addEventListener('click', clearPrices);
  loadPricesFromStore();

  const saved = load(STORE_STATE, null);
  renderProjectOptions(saved && saved.project);
  if (saved) {
    applySnapshot(saved);
    if (saved.sequence) get('seqBox').open = true;
  } else {
    const values = BUILTIN_PROJECTS.icr.values;
    Object.keys(values).forEach(id => setField(id, values[id]));
  }
  initText();
})();
