/* SPPS Resin Calculator – UI. Calculations live in calc.js, strings in i18n.js. */
(function () {
  'use strict';
  const C = window.SPPSCalc;
  const I18N = window.SPPS_I18N;
  const get = id => document.getElementById(id);

  const STORE_STATE = 'spps.state.v1';
  const STORE_PROJECTS = 'spps.projects.v1';

  const BUILTIN_PROJECTS = {
    icr: { labelKey: 'projIcr', infoKey: 'infoIcr', values: { resin: 'rink-am', loading: '0.80', protectedMW: '3080', freeMW: '1898', yieldPct: '44', correction: '-222' } },
    custom: { labelKey: 'projCustom', infoKey: 'infoCustom', values: { resin: 'rink-am', loading: '0.80', protectedMW: '3500', freeMW: '2500', yieldPct: '85', correction: '-222' } }
  };
  const DEFAULTS = {
    scale: '100', mass: '125', sequence: '', nTerm: 'H', cTerm: 'amide', nFmoc: false,
    system: 'dic-oxyma', aaEq: '3', couplings: '1', skipFirst: false,
    deprotVol: '10', deprots: '2', washesCouple: '5', washCoupleVol: '10', washesDeprot: '5', washDeprotVol: '10'
  };
  const MB_FIELDS = ['loading', 'protectedMW', 'freeMW', 'correction', 'yieldPct', 'scale', 'mass'];
  const SEQ_FIELDS = ['sequence', 'nTerm', 'cTerm', 'nFmoc'];
  const PLAN_FIELDS = ['aaEq', 'couplings', 'skipFirst', 'deprotVol', 'deprots', 'washesCouple', 'washCoupleVol', 'washesDeprot', 'washDeprotVol'];
  const STATE_FIELDS = ['resin'].concat(MB_FIELDS, SEQ_FIELDS, ['system'], PLAN_FIELDS);

  let mode = 'scale';
  let last = null;      // last mass-balance result
  let lastSeq = null;   // last sequence MW result
  let lastPlan = null;  // last coupling plan

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
    const snap = { mode, reagentEqs: currentReagentEqs(), customResidues: readCustom() };
    STATE_FIELDS.forEach(id => { snap[id] = getField(id); });
    return snap;
  }
  function applySnapshot(snap) {
    // v8.0 had a single wash setting for both coupling and deprotection washes.
    if (snap.washes !== undefined && snap.washesCouple === undefined) {
      snap = Object.assign({}, snap, { washesCouple: snap.washes, washesDeprot: snap.washes, washCoupleVol: snap.washVol, washDeprotVol: snap.washVol });
    }
    STATE_FIELDS.forEach(id => { if (snap[id] !== undefined) setField(id, snap[id]); });
    renderCustom(snap.customResidues || []);
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
    if (foot) html += '<tfoot><tr>' + foot.map(c => cell('td', c)).join('') + '</tr></tfoot>';
    return html;
  }
  const n = (x, d) => ({ text: Number.isFinite(x) ? C.formatNumber(x, d) : '—', num: true });
  const eq = x => ({ text: Number.isFinite(x) ? String(+x.toFixed(3)) : '—', num: true });
  // Large volumes read better in litres.
  const vol = mL => Math.abs(mL) >= 1000 ? fmt(mL / 1000, 'L') : fmt(mL, 'mL');

  function updatePlan() {
    const sys = C.COUPLING_SYSTEMS[get('system').value];
    const aaEq = readNum('aaEq');
    const couplings = Math.round(readNum('couplings'));
    const reagents = [...document.querySelectorAll('#reagentEqs input')].map(el => [el.dataset.reagent, el.value === '' ? NaN : Number(el.value)]);
    const nums = ['deprotVol', 'deprots', 'washesCouple', 'washCoupleVol', 'washesDeprot', 'washDeprotVol'].map(readNum);
    const valid = aaEq > 0 && couplings >= 1 && reagents.every(([, eq]) => eq >= 0) && nums.every(x => x >= 0);
    showError('planError', last && !valid ? [t('errPlan')] : []);
    const ids = ['perCouplingTable', 'cycleTable', 'totalsTable'];
    if (!last || !valid || !sys) {
      lastPlan = null;
      ids.forEach(id => { get(id).innerHTML = ''; });
      get('noSeqHint').hidden = false;
      return;
    }
    const residues = lastSeq ? lastSeq.residues : [];
    const plan = C.couplingPlan({
      scale: last.scale, resinMass: last.mass, residues, aaEq, reagents, couplings,
      skipFirst: get('skipFirst').checked,
      deprotVol: nums[0], deprots: nums[1],
      washesCouple: nums[2], washCoupleVol: nums[3], washesDeprot: nums[4], washDeprotVol: nums[5]
    });
    lastPlan = plan;

    const aaMmol = last.scale * aaEq;
    get('perCouplingTable').innerHTML = table(
      [t('thReagent'), { text: t('thEq'), num: true }, { text: t('thMW'), num: true }, { text: t('thMmol'), num: true }, { text: t('thGrams'), num: true }, { text: t('thVolume'), num: true }],
      [[t('fmocAA'), eq(aaEq), { text: '—', num: true }, n(aaMmol), { text: '—', num: true }, { text: '—', num: true }]]
        .concat(plan.perCoupling.map(r => [r.name, eq(r.eq), n(r.mw, 2), n(r.mmol), n(r.grams), Number.isFinite(r.mL) ? n(r.mL) : { text: '—', num: true }]))
    );

    get('noSeqHint').hidden = residues.length > 0;
    get('cycleTable').innerHTML = residues.length ? table(
      [{ text: t('thCycle'), num: true }, t('thResidue'), t('thBuildingBlock'), { text: t('thMW'), num: true }, { text: t('thMmol'), num: true }, { text: t('thGrams'), num: true }],
      plan.cycles.map(c => [n(c.cycle, 0), c.residue + ' (' + (c.d ? 'D-' : '') + c.code + ')', c.name, n(c.mw, 2), n(c.mmol), n(c.grams)]),
      [t('sumRow'), '', '', '', '', n(plan.aaTotalGrams)]
    ) : '';

    const rows = [];
    if (residues.length) {
      rows.push([t('couplingCycles'), n(plan.cycles.length, 0)]);
      rows.push([t('totalAA'), { text: fmt(plan.aaTotalGrams, 'g'), num: true }]);
      plan.reagentTotals.forEach(r => rows.push([r.name, { text: fmt(r.grams, 'g') + (Number.isFinite(r.mL) ? ' / ' + vol(r.mL) : ''), num: true }]));
    }
    rows.push([t('totalPip'), { text: vol(plan.piperidineSolution), num: true }]);
    rows.push([t('totalPipNeat'), { text: vol(plan.piperidine), num: true }]);
    rows.push([t('totalWashCouple'), { text: vol(plan.washCoupleDMF), num: true }]);
    rows.push([t('totalWashDeprot'), { text: vol(plan.washDeprotDMF), num: true }]);
    rows.push([t('totalDMF'), { text: vol(plan.totalDMF), num: true }]);
    get('totalsTable').innerHTML = table([t('thItem'), { text: t('thAmount'), num: true }], rows);
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
  applyDefaults();
  MB_FIELDS.concat(SEQ_FIELDS, PLAN_FIELDS).forEach(id => get(id).addEventListener('input', calculate));
  ['nTerm', 'cTerm', 'nFmoc', 'skipFirst'].forEach(id => get(id).addEventListener('change', calculate));
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
