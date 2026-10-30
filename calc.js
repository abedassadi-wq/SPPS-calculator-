/* SPPS Resin Calculator – pure calculation module.
 * Shared by the page (window.SPPSCalc), the service worker (self.SPPSCalc)
 * and the Node test suite (module.exports). No DOM access here. */
(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.SPPSCalc = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const APP_VERSION = '8.1';

  // Average masses (g/mol)
  const H2O = 18.0153;
  const NH3 = 17.0305;
  const HCL = 36.4609;
  const FMOC = 222.2387;   // Fmoc (C15H11O2) replacing H: net C15H10O2
  const ACETYL = 42.0367;  // Ac replacing H: net C2H2O
  const AMIDE_TERMINUS = NH3;              // C-terminal -NH2 + N-terminal H
  const ACID_TERMINUS = H2O;               // -OH + N-terminal H

  // Default resin MW corrections (g/mol), relative to the protected peptide MW
  // as entered (see README for the convention behind each value).
  const RESINS = {
    'rink-am':   { correction: -222, family: 'fmoc-amide', label: 'Rink Amide Resin AM (Fmoc)' },
    'rink-mbha': { correction: -222, family: 'fmoc-amide', label: 'Rink Amide MBHA Resin (Fmoc)' },
    'rink-peg':  { correction: -222, family: 'fmoc-amide', label: 'Rink Amide PS-PEG Resin (Fmoc)' },
    'sieber':    { correction: -222, family: 'fmoc-amide', label: 'Sieber Amide Resin (Fmoc)' },
    'wang':      { correction: -18.02, family: 'wang', label: 'Wang Resin' },
    'ctc':       { correction: -36.46, family: 'ctc', label: '2-Chlorotrityl Chloride Resin' },
    'custom':    { correction: 0, family: 'custom', label: 'Other / Custom Resin' }
  };

  // Residue masses (average, g/mol) and standard Fmoc/tBu side-chain protection.
  // pg = mass added by the side-chain protecting group (group minus the H it replaces).
  const PG = {
    tBu: 56.1063, OtBu: 56.1063, Boc: 100.1158, Trt: 242.3144, Pbf: 252.3298,
    Mtt: 256.3410, ivDde: 206.2808, Alloc: 84.0734
  };
  const RESIDUES = {
    G: { code: 'Gly', mass: 57.0513 },
    A: { code: 'Ala', mass: 71.0779 },
    S: { code: 'Ser', mass: 87.0773, pg: 'tBu' },
    P: { code: 'Pro', mass: 97.1167 },
    V: { code: 'Val', mass: 99.1311 },
    T: { code: 'Thr', mass: 101.1039, pg: 'tBu' },
    C: { code: 'Cys', mass: 103.1429, pg: 'Trt' },
    L: { code: 'Leu', mass: 113.1576 },
    I: { code: 'Ile', mass: 113.1576 },
    N: { code: 'Asn', mass: 114.1026, pg: 'Trt' },
    D: { code: 'Asp', mass: 115.0874, pg: 'OtBu' },
    Q: { code: 'Gln', mass: 128.1292, pg: 'Trt' },
    K: { code: 'Lys', mass: 128.1723, pg: 'Boc' },
    E: { code: 'Glu', mass: 129.1140, pg: 'OtBu' },
    M: { code: 'Met', mass: 131.1961 },
    H: { code: 'His', mass: 137.1393, pg: 'Trt' },
    F: { code: 'Phe', mass: 147.1739 },
    R: { code: 'Arg', mass: 156.1857, pg: 'Pbf' },
    Y: { code: 'Tyr', mass: 163.1733, pg: 'tBu' },
    W: { code: 'Trp', mass: 186.2099, pg: 'Boc' }
  };

  // Coupling reagents. density in g/mL for liquids (volume is reported too).
  const REAGENTS = {
    DIC:      { name: 'DIC', mw: 126.20, density: 0.806 },
    Oxyma:    { name: 'Oxyma Pure', mw: 142.11 },
    HOBt:     { name: 'HOBt (anhydrous)', mw: 135.12 },
    HATU:     { name: 'HATU', mw: 380.23 },
    HBTU:     { name: 'HBTU', mw: 379.25 },
    HCTU:     { name: 'HCTU', mw: 413.69 },
    PyBOP:    { name: 'PyBOP', mw: 520.39 },
    DIPEA:    { name: 'DIPEA', mw: 129.24, density: 0.742 },
    NMM:      { name: 'NMM', mw: 101.15, density: 0.92 },
    Collidine:{ name: '2,4,6-Collidine', mw: 121.18, density: 0.917 }
  };

  const COUPLING_SYSTEMS = {
    'dic-oxyma':   { label: 'DIC / Oxyma', aaEq: 3, reagents: [['DIC', 3], ['Oxyma', 3]] },
    'dic-hobt':    { label: 'DIC / HOBt', aaEq: 3, reagents: [['DIC', 3], ['HOBt', 3]] },
    'hatu-dipea':  { label: 'HATU / DIPEA', aaEq: 3, reagents: [['HATU', 2.9], ['DIPEA', 6]] },
    'hbtu-dipea':  { label: 'HBTU / DIPEA', aaEq: 3, reagents: [['HBTU', 2.9], ['DIPEA', 6]] },
    'hctu-dipea':  { label: 'HCTU / DIPEA', aaEq: 3, reagents: [['HCTU', 2.9], ['DIPEA', 6]] },
    'pybop-dipea': { label: 'PyBOP / DIPEA', aaEq: 3, reagents: [['PyBOP', 3], ['DIPEA', 6]] }
  };

  const isPos = x => typeof x === 'number' && Number.isFinite(x) && x > 0;

  /* Mass balance.
   * input: { loading, protectedMW, freeMW, correction, yieldPct, mode: 'scale'|'mass', value }
   * returns { errors: [errorKey...], result: {...}|null } */
  function massBalance(input) {
    const { loading, protectedMW, freeMW, correction, yieldPct, mode, value } = input;
    const errors = [];
    if (!isPos(loading)) errors.push('errLoading');
    if (!isPos(protectedMW)) errors.push('errProtectedMW');
    if (!isPos(freeMW)) errors.push('errFreeMW');
    if (!Number.isFinite(correction)) errors.push('errCorrection');
    if (!(yieldPct >= 0 && yieldPct <= 100)) errors.push('errYield');
    if (!isPos(value)) errors.push('errInput');
    if (Number.isFinite(protectedMW) && Number.isFinite(correction) && protectedMW + correction < 0) errors.push('errNegative');
    if (errors.length) return { errors, result: null };

    const scale = mode === 'mass' ? value * loading : value;
    const mass = mode === 'mass' ? value : value / loading;
    const contribution = scale * (protectedMW + correction) / 1000;
    const peptideResin = mass + contribution;
    const theoretical = scale * freeMW / 1000;
    const final = theoretical * yieldPct / 100;
    // Effective (substituted) loading of the finished peptide-resin
    const finalLoading = scale / peptideResin;
    return { errors, result: { scale, mass, contribution, peptideResin, theoretical, final, finalLoading } };
  }

  /* Adaptive rounding: more decimals for small numbers so mg-scale work stays readable. */
  function decimalsFor(x) {
    const a = Math.abs(x);
    if (a === 0 || a >= 10) return 2;
    if (a >= 1) return 3;
    if (a >= 0.1) return 4;
    return 5;
  }
  function formatNumber(x, decimals) {
    if (!Number.isFinite(x)) return '—';
    const d = decimals == null ? decimalsFor(x) : decimals;
    return x.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
  }

  /* Non-natural residues, written in brackets in a sequence, e.g. "H[Aib]EGT". Masses are in-chain
   * residue masses; pg is the side-chain protecting group of the usual Fmoc building block. */
  const NONSTD = {
    'Aib':        { code: 'Aib', mass: 85.1045 },
    'Abu':        { code: 'Abu', mass: 85.1045 },
    'Nle':        { code: 'Nle', mass: 113.1576 },
    'Tle':        { code: 'Tle', mass: 113.1576 },
    'Ahx':        { code: 'Ahx', mass: 113.1576 },
    'bAla':       { code: 'β-Ala', mass: 71.0779, aliases: ['βAla', 'β-Ala', 'beta-Ala'] },
    'Sar':        { code: 'Sar', mass: 71.0779 },
    'Orn':        { code: 'Orn', mass: 114.1457, pg: 'Boc' },
    'Dab':        { code: 'Dab', mass: 100.1191, pg: 'Boc' },
    'Dap':        { code: 'Dap', mass: 86.0925, pg: 'Boc' },
    'Cha':        { code: 'Cha', mass: 153.2215 },
    '1Nal':       { code: '1-Nal', mass: 197.2325, aliases: ['1-Nal'] },
    '2Nal':       { code: '2-Nal', mass: 197.2325, aliases: ['2-Nal', 'Nal'] },
    'Phg':        { code: 'Phg', mass: 133.1473 },
    'Hyp':        { code: 'Hyp', mass: 113.1146, pg: 'tBu' },
    'Cit':        { code: 'Cit', mass: 157.1704 },
    'Pen':        { code: 'Pen', mass: 131.1961, pg: 'Trt' },
    'Lys(Mtt)':   { code: 'Lys', mass: 128.1723, pg: 'Mtt' },
    'Lys(ivDde)': { code: 'Lys', mass: 128.1723, pg: 'ivDde' },
    'Lys(Alloc)': { code: 'Lys', mass: 128.1723, pg: 'Alloc' }
  };

  // Case-insensitive lookup for bracket contents: non-natural keys and aliases, plus three-letter standard codes.
  const BRACKET_INDEX = {};
  Object.keys(NONSTD).forEach(key => {
    [key].concat(NONSTD[key].aliases || []).forEach(name => { BRACKET_INDEX[name.toLowerCase()] = NONSTD[key]; });
  });
  Object.keys(RESIDUES).forEach(ch => { BRACKET_INDEX[RESIDUES[ch].code.toLowerCase()] = RESIDUES[ch]; });

  function info(def, d, label) {
    const pgMass = def.pg ? PG[def.pg] : 0;
    return {
      label, code: def.code, d, mass: def.mass, pg: def.pg || null, pgMass,
      bbName: 'Fmoc-' + (d ? 'D-' : '') + def.code + (def.pg ? '(' + def.pg + ')' : '') + '-OH'
    };
  }

  /* Custom residues: [{ name, mass (in-chain, unprotected), bbMW (Fmoc building block) }].
   * The side-chain protection mass is whatever the building block carries beyond Fmoc-X-OH. */
  function customIndex(custom) {
    const index = {};
    (custom || []).forEach(c => {
      const name = String(c.name || '').trim();
      if (!name || !(c.mass > 0) || !(c.bbMW > 0)) return;
      const pgMass = c.bbMW - c.mass - H2O - FMOC;
      if (pgMass < -0.5) return; // building block lighter than Fmoc-X-OH: inconsistent entry
      index[name.toLowerCase()] = { name, mass: c.mass, pgMass: Math.max(0, pgMass), bbMW: c.bbMW };
    });
    return index;
  }

  /* Resolve one token: a one-letter code (lowercase = D-isomer) or the contents of [brackets]. */
  function resolveToken(text, bracket, customIdx) {
    if (!bracket) {
      const up = text.toUpperCase();
      if (!RESIDUES[up]) return null;
      const d = text !== up && up !== 'G';
      return info(RESIDUES[up], d, text);
    }
    let name = text.trim();
    let d = false;
    if (/^D-/i.test(name)) { d = true; name = name.slice(2); }
    const label = '[' + text.trim() + ']';
    const c = customIdx[name.toLowerCase()];
    if (c) {
      return { label, code: c.name, d, mass: c.mass, pg: null, pgMass: c.pgMass, bbName: 'Fmoc-' + (d ? 'D-' : '') + c.name + '-OH', custom: true };
    }
    const def = BRACKET_INDEX[name.toLowerCase()];
    return def ? info(def, d, label) : null;
  }

  /* Sequence parsing: one-letter codes and [bracketed] non-natural or custom residues.
   * Whitespace, digits, dashes and dots outside brackets are ignored. */
  function parseSequence(raw, custom) {
    const customIdx = customIndex(custom);
    const residues = [];
    const invalid = [];
    const re = /\[([^\]]*)\]|([A-Za-z])|([\s\-.\d]+)|(.)/g;
    const str = String(raw || '');
    let m;
    while ((m = re.exec(str))) {
      if (m[3]) continue;
      const bracket = m[1] !== undefined;
      const text = bracket ? m[1] : (m[2] || m[4]);
      const r = m[4] ? null : resolveToken(text, bracket, customIdx);
      if (r) residues.push(r);
      else invalid.push({ ch: bracket ? '[' + text + ']' : text, pos: m.index + 1 });
    }
    return { residues, invalid };
  }

  /* Peptide MW from sequence.
   * opts: { nTerm: 'H'|'Ac', cTerm: 'acid'|'amide', nFmoc: boolean (keep N-terminal Fmoc in protected MW), custom } */
  function sequenceMW(raw, opts) {
    const o = Object.assign({ nTerm: 'H', cTerm: 'amide', nFmoc: false }, opts);
    const { residues, invalid } = parseSequence(raw, o.custom);
    if (!residues.length || invalid.length) return { residues, invalid, free: NaN, protected: NaN };
    let free = residues.reduce((s, r) => s + r.mass, 0);
    free += o.cTerm === 'acid' ? ACID_TERMINUS : AMIDE_TERMINUS;
    if (o.nTerm === 'Ac') free += ACETYL;
    let prot = free + residues.reduce((s, r) => s + r.pgMass, 0);
    if (o.nFmoc && o.nTerm !== 'Ac') prot += FMOC;
    return { residues, invalid, free, protected: prot };
  }

  /* Fmoc-AA-OH building block for a residue: a parsed residue, a one-letter code or a bracket name. */
  function buildingBlock(residue, custom) {
    let r = residue;
    if (typeof residue === 'string') {
      const parsed = parseSequence(residue.length > 1 && residue[0] !== '[' ? '[' + residue + ']' : residue, custom);
      if (parsed.residues.length !== 1 || parsed.invalid.length) return null;
      r = parsed.residues[0];
    }
    return { name: r.bbName, mw: r.mass + H2O + FMOC + r.pgMass };
  }

  /* Reagent amounts for one coupling at a given scale (mmol). */
  function reagentAmount(id, eq, scaleMmol) {
    const r = REAGENTS[id];
    const mmol = scaleMmol * eq;
    const grams = mmol * r.mw / 1000;
    const mL = r.density ? grams / r.density : NaN;
    return { id, name: r.name, mw: r.mw, eq, mmol, grams, mL };
  }

  /* Full coupling plan. Couplings run C→N, so cycle 1 is the C-terminal residue.
   * opts: { scale, resinMass, residues (parsed), aaEq, reagents: [[id, eq]...], couplings (per residue),
   *         skipFirst (first residue pre-loaded on resin), deprotVol, deprots,
   *         washCoupleVol, washesCouple (after every coupling), washDeprotVol, washesDeprot (after every deprotection) } */
  function couplingPlan(opts) {
    const o = Object.assign({
      aaEq: 3, couplings: 1, skipFirst: false, deprotVol: 10, deprots: 2,
      washCoupleVol: 10, washesCouple: 5, washDeprotVol: 10, washesDeprot: 5
    }, opts);
    const order = o.residues.slice().reverse();
    const cycles = [];
    order.forEach((r, i) => {
      if (o.skipFirst && i === 0) return;
      const bb = buildingBlock(r);
      const mmol = o.scale * o.aaEq * o.couplings;
      cycles.push({ cycle: cycles.length + 1, residue: r.label, code: r.code, d: r.d, name: bb.name, mw: bb.mw, mmol, grams: mmol * bb.mw / 1000 });
    });
    const n = cycles.length;
    const perCoupling = o.reagents.map(([id, eq]) => reagentAmount(id, eq, o.scale));
    const reagentTotals = perCoupling.map(r => Object.assign({}, r, {
      mmol: r.mmol * n * o.couplings, grams: r.grams * n * o.couplings, mL: r.mL * n * o.couplings
    }));
    // Deprotections = one per coupling cycle, plus the initial Fmoc removal of the resin/first residue.
    const deprotCycles = n + 1;
    const piperidineSolution = o.resinMass * o.deprotVol * o.deprots * deprotCycles; // mL of 20% piperidine/DMF
    const washCoupleDMF = o.resinMass * o.washCoupleVol * o.washesCouple * n * o.couplings;
    const washDeprotDMF = o.resinMass * o.washDeprotVol * o.washesDeprot * deprotCycles;
    const washDMF = washCoupleDMF + washDeprotDMF;
    return {
      cycles,
      perCoupling,
      reagentTotals,
      aaTotalGrams: cycles.reduce((s, c) => s + c.grams, 0),
      deprotCycles,
      piperidineSolution,
      piperidine: piperidineSolution * 0.2,
      washCoupleDMF,
      washDeprotDMF,
      washDMF,
      totalDMF: washDMF + piperidineSolution * 0.8
    };
  }

  return {
    APP_VERSION, RESINS, RESIDUES, NONSTD, PG, REAGENTS, COUPLING_SYSTEMS,
    constants: { H2O, NH3, HCL, FMOC, ACETYL },
    massBalance, formatNumber, decimalsFor, customIndex, parseSequence, sequenceMW, buildingBlock, reagentAmount, couplingPlan
  };
});
