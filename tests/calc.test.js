// Run with: node --test
const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../calc.js');

const close = (actual, expected, tol = 0.01) =>
  assert.ok(Math.abs(actual - expected) <= tol, `expected ${expected}, got ${actual}`);

const ICR = { loading: 0.8, protectedMW: 3080, freeMW: 1898, correction: -222, yieldPct: 44 };

test('mass balance, scale → resin (ICR preset)', () => {
  const { errors, result } = C.massBalance({ ...ICR, mode: 'scale', value: 100 });
  assert.deepEqual(errors, []);
  close(result.mass, 125);
  close(result.peptideResin, 125 + 100 * (3080 - 222) / 1000);
  close(result.theoretical, 189.8);
  close(result.final, 83.512);
  close(result.finalLoading, 100 / result.peptideResin, 1e-9);
});

test('mass balance, resin → scale is the inverse', () => {
  const { result } = C.massBalance({ ...ICR, mode: 'mass', value: 125 });
  close(result.scale, 100);
});

test('mass balance validation', () => {
  assert.deepEqual(C.massBalance({ ...ICR, loading: 0, mode: 'scale', value: 1 }).errors, ['errLoading']);
  assert.deepEqual(C.massBalance({ ...ICR, yieldPct: 101, mode: 'scale', value: 1 }).errors, ['errYield']);
  assert.deepEqual(C.massBalance({ ...ICR, correction: -4000, mode: 'scale', value: 1 }).errors, ['errNegative']);
  assert.deepEqual(C.massBalance({ ...ICR, mode: 'scale', value: NaN }).errors, ['errInput']);
});

test('resin default corrections', () => {
  assert.equal(C.RESINS['rink-am'].correction, -222);
  close(C.RESINS.wang.correction, -C.constants.H2O);
  close(C.RESINS.ctc.correction, -C.constants.HCL);
});

test('adaptive number formatting', () => {
  assert.equal(C.formatNumber(1234.567), '1,234.57');
  assert.equal(C.formatNumber(2.5), '2.500');
  assert.equal(C.formatNumber(0.1234), '0.1234');
  assert.equal(C.formatNumber(0.01234), '0.01234');
  assert.equal(C.formatNumber(NaN), '—');
});

test('sequence parsing ignores spacing and flags unknown codes', () => {
  const r = C.parseSequence('AC-GLY 12 ');
  assert.deepEqual(r.residues.map(x => x.label), ['A', 'C', 'G', 'L', 'Y']);
  assert.deepEqual(C.parseSequence('GXB').invalid.map(x => x.ch), ['X', 'B']);
  assert.deepEqual(C.parseSequence('A[Foo]').invalid.map(x => x.ch), ['[Foo]']);
});

test('lowercase letters are D-amino acids with the same mass', () => {
  const r = C.parseSequence('aG');
  assert.equal(r.residues[0].d, true);
  assert.equal(C.buildingBlock(r.residues[0]).name, 'Fmoc-D-Ala-OH');
  close(C.sequenceMW('aaa').free, C.sequenceMW('AAA').free, 1e-9);
  assert.equal(C.parseSequence('g').residues[0].d, false); // glycine is achiral
});

test('non-natural residues in brackets', () => {
  const r = C.parseSequence('H[3Pal]E[d-2Nal][Tyr(2-Boc-ea)][sar][Thp][7MeTrp][Pen][Lys(Ac)]');
  assert.deepEqual(r.invalid, []);
  assert.deepEqual(r.residues.map(x => x.code), ['His', '3-Pal', 'Glu', '2-Nal', 'Tyr(2-ea)', 'Sar', 'Thp', '7-MeTrp', 'Pen', 'Lys(Ac)']);
  assert.equal(r.residues[3].d, true);
  assert.equal(C.buildingBlock(r.residues[3]).name, 'Fmoc-D-2-Nal-OH');
  // Catalogue MWs of the Fmoc building blocks
  close(C.buildingBlock('Pen').mw, 613.77, 0.02);
  close(C.buildingBlock('Sar').mw, 311.33);
  close(C.buildingBlock('3Pal').mw, 388.42);
  close(C.buildingBlock('2Nal').mw, 437.49);
  close(C.buildingBlock('Thp').mw, 367.40);
  close(C.buildingBlock('7MeTrp').mw, 440.48);
  close(C.buildingBlock('Lys(Ac)').mw, 410.46);
  close(C.buildingBlock('Tyr(2-Boc-ea)').mw, 546.61);
  assert.equal(C.buildingBlock('Lys(Ac)').name, 'Fmoc-Lys(Ac)-OH');
  assert.equal(C.buildingBlock('Pen').name, 'Fmoc-Pen(Trt)-OH');
  // Thpgly is kept as an alias of the corrected Thp residue
  close(C.buildingBlock('Thpgly').mw, 367.40);
  // Only the agreed list is built in
  assert.deepEqual(Object.keys(C.NONSTD), ['Pen', 'Sar', '3Pal', '2Nal', 'Thp', '7MeTrp', 'Lys(Ac)', 'Tyr(2-Boc-ea)']);
  assert.equal(C.parseSequence('[Aib]').invalid.length, 1);
  // Boc on Tyr(2-ea) counts towards the protected MW only
  const s = C.sequenceMW('[Tyr(2-Boc-ea)]', { cTerm: 'acid' });
  close(s.protected - s.free, C.PG.Boc);
  // Lys(Ac): the acetyl is permanent, so it is in both free and protected MW
  const k = C.sequenceMW('[Lys(Ac)]', { cTerm: 'acid' });
  close(k.protected - k.free, 0, 1e-9);
});

test('icotrokinra (CAS 2763602-16-8) linear mass', () => {
  // N-acetyl, C-terminal amide, cyclic (1->6) disulfide between the two Pen residues.
  const seq = '[Pen]NT[7MeTrp][Lys(Ac)][Pen][Tyr(2-Boc-ea)][2Nal][Thp]EN[3Pal][Sar]';
  const r = C.sequenceMW(seq, { nTerm: 'Ac', cTerm: 'amide' });
  assert.equal(r.residues.length, 13);
  assert.deepEqual(r.invalid, []);
  const disulfide = r.free - 2 * 1.00794;
  // Reference average MW of C90H120N20O22S2 is 1898.19
  close(disulfide, 1898.19, 0.1);
});

test('custom residues', () => {
  const custom = [{ name: 'Xyz', mass: 200, bbMW: 500 }];
  const s = C.sequenceMW('G[Xyz]', { custom, cTerm: 'acid' });
  close(s.free, 57.0513 + 200 + 18.0153, 1e-6);
  close(s.protected - s.free, 500 - 200 - C.constants.H2O - C.constants.FMOC, 1e-6);
  close(C.buildingBlock('Xyz', custom).mw, 500, 1e-9);
  // A building block lighter than Fmoc-X-OH is rejected
  assert.equal(C.parseSequence('[Bad]', [{ name: 'Bad', mass: 200, bbMW: 300 }]).invalid.length, 1);
});

test('sequence MW: known peptides (average mass)', () => {
  // Gly-Gly free acid: 132.12
  close(C.sequenceMW('GG', { cTerm: 'acid' }).free, 132.12);
  // Oxytocin linear precursor CYIQNCPLG-NH2 (reduced): 1009.19
  close(C.sequenceMW('CYIQNCPLG', { cTerm: 'amide' }).free, 1009.19, 0.05);
  // Acetylation adds 42.04
  const plain = C.sequenceMW('AKA').free;
  close(C.sequenceMW('AKA', { nTerm: 'Ac' }).free - plain, 42.04);
});

test('sequence MW: protected mass adds side-chain groups and optional Fmoc', () => {
  const base = C.sequenceMW('RK', { cTerm: 'acid' });
  close(base.protected - base.free, C.PG.Pbf + C.PG.Boc);
  const withFmoc = C.sequenceMW('RK', { cTerm: 'acid', nFmoc: true });
  close(withFmoc.protected - base.protected, C.constants.FMOC);
  assert.ok(Number.isNaN(C.sequenceMW('').free));
  assert.ok(Number.isNaN(C.sequenceMW('AXA').free));
});

test('Fmoc building blocks match catalogue MWs', () => {
  close(C.buildingBlock('G').mw, 297.31);
  close(C.buildingBlock('R').mw, 648.77, 0.02);
  close(C.buildingBlock('K').mw, 468.54, 0.02);
  close(C.buildingBlock('C').mw, 585.71, 0.02);
  assert.equal(C.buildingBlock('R').name, 'Fmoc-Arg(Pbf)-OH');
  assert.equal(C.buildingBlock('X'), null);
});

test('reagent amounts include volume for liquids', () => {
  const dic = C.reagentAmount('DIC', 3, 10);
  close(dic.mmol, 30);
  close(dic.grams, 3.786);
  close(dic.mL, 3.786 / 0.806);
  assert.ok(Number.isNaN(C.reagentAmount('Oxyma', 3, 10).mL));
});

test('coupling plan runs C → N and totals reagents', () => {
  const plan = C.couplingPlan({
    scale: 1, resinMass: 2, residues: C.parseSequence('AGK').residues, aaEq: 4,
    reagents: [['DIC', 4], ['Oxyma', 4]],
    swellVol: 6, swellTimes: 3, coupleVol: 10, deprotVol: 10, deprots: 2,
    washCoupleVol: 10, washesCouple: 5, washDeprotVol: 8, washesDeprot: 3
  });
  assert.deepEqual(plan.cycles.map(c => c.residue), ['K', 'G', 'A']);
  assert.equal(plan.couplings, 3);          // one coupling per residue
  assert.equal(plan.deprotCycles, 4);       // + initial Fmoc removal
  close(plan.cycles[0].mmol, 4);            // scale × aaEq, no couplings multiplier
  close(plan.reagentTotals[0].mmol, 4 * 3); // per coupling × 3 couplings
  // 4 deprotections, 2 treatments × 10 mL/g × 2 g
  close(plan.piperidineSolution, 4 * 2 * 10 * 2);
  close(plan.piperidine, plan.piperidineSolution * 0.2);
  // 3 couplings × 5 washes × 10 mL/g × 2 g, and 4 deprotections × 3 washes × 8 mL/g × 2 g
  close(plan.washCoupleDMF, 3 * 5 * 10 * 2);
  close(plan.washDeprotDMF, 4 * 3 * 8 * 2);
  close(plan.washDMF, plan.washCoupleDMF + plan.washDeprotDMF);
  // resin swelling: 3 swells × 6 mL/g × 2 g
  close(plan.swellDMF, 3 * 6 * 2);
  // 3 couplings × 10 mL/g × 2 g of DMF to dissolve the AA and activator
  close(plan.coupleDMF, 3 * 10 * 2);
  close(plan.totalDMF, plan.swellDMF + plan.coupleDMF + plan.washDMF + plan.piperidineSolution * 0.8);
});

test('coupling plan can use a manual residue count with no sequence', () => {
  const plan = C.couplingPlan({
    scale: 1, resinMass: 2, residues: [], residueCount: 10, aaEq: 3,
    reagents: [['DIC', 3], ['HOBt', 3]], swellVol: 6, swellTimes: 3
  });
  assert.equal(plan.nRes, 10);
  assert.equal(plan.couplings, 10);
  assert.equal(plan.deprotCycles, 11);
  assert.deepEqual(plan.aaTotals, []);           // no per-AA breakdown without a sequence
  close(plan.reagentTotals[0].grams, C.reagentAmount('DIC', 3, 1).grams * 10);
  close(plan.swellDMF, 3 * 6 * 2);
});

test('coupling plan totals each amino acid', () => {
  const plan = C.couplingPlan({ scale: 1, resinMass: 1, residues: C.parseSequence('AGKAG').residues, aaEq: 3, reagents: [['DIC', 3], ['HOBt', 3]] });
  const ala = plan.aaTotals.find(a => a.name === 'Fmoc-Ala-OH');
  const gly = plan.aaTotals.find(a => a.name === 'Fmoc-Gly-OH');
  assert.equal(ala.count, 2);
  assert.equal(gly.count, 2);
  close(ala.mmol, 2 * 3);            // 2 Ala cycles × scale 1 × 3 eq
  close(ala.grams, 2 * C.buildingBlock('A').mw * 3 / 1000);
  // sorted and summing to the lump total
  assert.deepEqual(plan.aaTotals.map(a => a.name), ['Fmoc-Ala-OH', 'Fmoc-Gly-OH', 'Fmoc-Lys(Boc)-OH']);
  close(plan.aaTotals.reduce((s, a) => s + a.grams, 0), plan.aaTotalGrams);
});

test('coupling plan can skip a pre-loaded first residue', () => {
  const plan = C.couplingPlan({ scale: 1, resinMass: 1, residues: C.parseSequence('AGK').residues, reagents: [], skipFirst: true });
  assert.deepEqual(plan.cycles.map(c => c.residue), ['G', 'A']);
  assert.equal(plan.cycles[0].cycle, 1);
});

test('cleavage & deprotection plan', () => {
  const p = C.cleavagePlan({
    peptideResin: 100, cocktailVol: 7,
    components: [{ name: 'TFA', pct: 92.5, solid: false }, { name: 'H2O', pct: 2.5, solid: false }, { name: 'Phenol', pct: 5, solid: true }],
    tfaWashes: 2, tfaWashVol: 1.5,
    antisolvents: [{ name: 'MTBE', pct: 70 }, { name: 'Heptane', pct: 30 }], antisolventVols: 3
  });
  close(p.cocktailVolume, 700);               // 7 mL/g × 100 g
  close(p.components[0].amount, 647.5);        // TFA 92.5% of 700 mL
  assert.equal(p.components[0].unit, 'mL');
  const phenol = p.components.find(c => c.name === 'Phenol');
  close(phenol.amount, 35);                    // 5% of 700 → 35 g (solid)
  assert.equal(phenol.unit, 'g');
  close(p.pctSum, 100);
  close(p.tfaWashVolume, 300);                 // 2 × 1.5 × 100
  close(p.peptideCocktailVolume, 1000);        // 700 + 300
  close(p.antisolventVolume, 3000);            // 3 × 1000
  close(p.antisolvents[0].volume, 2100);       // MTBE 70%
  close(p.antisolvents[1].volume, 900);        // Heptane 30%
  close(p.precipitationVolume, 4000);          // 1000 + 3000
  assert.equal(C.SCAVENGERS.DTT.solid, true);
  assert.equal(C.SCAVENGERS.TIS.solid, false);
});

test('price parsing and material cost', () => {
  const csv = [
    'material,cas,price_per_kg,density_g_per_ml,currency',
    'Fmoc-Ala-OH,35661-39-3,120,,USD',
    'DMF,68-12-2,3.5,,USD',
    'TFA,76-05-1,25,,USD',
    'Mystuff,,,0.9,USD',           // liquid with explicit density but no price
    'Customliq,,10,0.8,USD'
  ].join('\n');
  const prices = C.parsePrices(csv);
  assert.equal(prices.currency, 'USD');
  // solid: 186.8 g -> 0.1868 kg * 120
  close(C.materialCost({ name: 'Fmoc-Ala-OH', value: 186.8, unit: 'g' }, prices).cost, 22.416);
  // liquid via built-in density: name has a "(total)" tag that is stripped
  close(C.materialCost({ name: 'DMF (total)', value: 54450, unit: 'mL' }, prices).cost, 54.45 * 0.944 * 3.5, 0.01);
  // TFA built-in density 1.489
  close(C.materialCost({ name: 'TFA', value: 1480, unit: 'mL' }, prices).cost, 1.48 * 1.489 * 25, 0.01);
  // custom liquid with density from the file
  close(C.materialCost({ name: 'Customliq', value: 1000, unit: 'mL' }, prices).cost, 1 * 0.8 * 10, 1e-9);
  // no price -> null
  assert.equal(C.materialCost({ name: 'Mystuff', value: 100, unit: 'mL' }, prices), null);
  // priced liquid with no known density -> needsDensity
  const noDens = C.parsePrices('material,price_per_kg\nWeird,5');
  const r = C.materialCost({ name: 'Weird', value: 100, unit: 'mL' }, noDens);
  assert.equal(r.needsDensity, true);
  assert.ok(Number.isNaN(r.cost));
  // name normalisation
  assert.equal(C.normalizeMaterial('Piperidine (neat)'), 'piperidine');
  assert.equal(C.densityOf('H₂O'), 1.0);
});
