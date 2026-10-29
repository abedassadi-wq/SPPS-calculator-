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

  const APP_VERSION = '8.0';

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
  const PG = { tBu: 56.1063, OtBu: 56.1063, Boc: 100.1158, Trt: 242.3144, Pbf: 252.3298 };
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

  /* Sequence parsing: one-letter codes; whitespace, digits, dashes and dots are ignored. */
  function parseSequence(raw) {
    const residues = [];
    const invalid = [];
    String(raw || '').toUpperCase().replace(/[\s\-.\d]/g, '').split('').forEach((ch, i) => {
      if (RESIDUES[ch]) residues.push(ch);
      else invalid.push({ ch, pos: i + 1 });
    });
    return { residues, invalid };
  }

  /* Peptide MW from sequence.
   * opts: { nTerm: 'H'|'Ac', cTerm: 'acid'|'amide', nFmoc: boolean (keep N-terminal Fmoc in protected MW) } */
  function sequenceMW(raw, opts) {
    const o = Object.assign({ nTerm: 'H', cTerm: 'amide', nFmoc: false }, opts);
    const { residues, invalid } = parseSequence(raw);
    if (!residues.length || invalid.length) return { residues, invalid, free: NaN, protected: NaN };
    let free = residues.reduce((s, ch) => s + RESIDUES[ch].mass, 0);
    free += o.cTerm === 'acid' ? ACID_TERMINUS : AMIDE_TERMINUS;
    if (o.nTerm === 'Ac') free += ACETYL;
    let prot = free + residues.reduce((s, ch) => s + (RESIDUES[ch].pg ? PG[RESIDUES[ch].pg] : 0), 0);
    if (o.nFmoc && o.nTerm !== 'Ac') prot += FMOC;
    return { residues, invalid, free, protected: prot };
  }

  /* Fmoc-AA-OH building block for a residue letter. */
  function buildingBlock(ch) {
    const r = RESIDUES[ch];
    if (!r) return null;
    const pg = r.pg ? PG[r.pg] : 0;
    const name = 'Fmoc-' + r.code + (r.pg ? '(' + r.pg + ')' : '') + '-OH';
    return { name, mw: r.mass + H2O + FMOC + pg };
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
   * opts: { scale, resinMass, residues, aaEq, reagents: [[id, eq]...], couplings (per residue),
   *         skipFirst (first residue pre-loaded on resin), washVol, washes, deprotVol, deprots } */
  function couplingPlan(opts) {
    const o = Object.assign({ aaEq: 3, couplings: 1, skipFirst: false, washVol: 10, washes: 5, deprotVol: 10, deprots: 2 }, opts);
    const order = o.residues.slice().reverse();
    const cycles = [];
    order.forEach((ch, i) => {
      if (o.skipFirst && i === 0) return;
      const bb = buildingBlock(ch);
      const mmol = o.scale * o.aaEq * o.couplings;
      cycles.push({ cycle: cycles.length + 1, residue: ch, name: bb.name, mw: bb.mw, mmol, grams: mmol * bb.mw / 1000 });
    });
    const n = cycles.length;
    const perCoupling = o.reagents.map(([id, eq]) => reagentAmount(id, eq, o.scale));
    const reagentTotals = perCoupling.map(r => Object.assign({}, r, {
      mmol: r.mmol * n * o.couplings, grams: r.grams * n * o.couplings, mL: r.mL * n * o.couplings
    }));
    // Deprotections = one per coupling cycle, plus the initial Fmoc removal of the resin/first residue.
    const deprotCycles = n + 1;
    const piperidineSolution = o.resinMass * o.deprotVol * o.deprots * deprotCycles; // mL of 20% piperidine/DMF
    const washDMF = o.resinMass * o.washVol * o.washes * (n * o.couplings + deprotCycles); // washes after each step
    return {
      cycles,
      perCoupling,
      reagentTotals,
      aaTotalGrams: cycles.reduce((s, c) => s + c.grams, 0),
      piperidineSolution,
      piperidine: piperidineSolution * 0.2,
      washDMF,
      totalDMF: washDMF + piperidineSolution * 0.8
    };
  }

  return {
    APP_VERSION, RESINS, RESIDUES, PG, REAGENTS, COUPLING_SYSTEMS,
    constants: { H2O, NH3, HCL, FMOC, ACETYL },
    massBalance, formatNumber, decimalsFor, parseSequence, sequenceMW, buildingBlock, reagentAmount, couplingPlan
  };
});
