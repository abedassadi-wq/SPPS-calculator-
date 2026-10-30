# SPPS Resin Calculator

Offline web app (PWA) for solid-phase peptide synthesis planning. No account, no server: everything runs in the browser and works offline once loaded. English and Hebrew UI.

## What it calculates

1. **Mass balance**: synthesis scale ↔ initial dry resin, theoretical peptide–resin mass, peptide–resin loading, theoretical and expected final unprotected peptide.
2. **Peptide MW from sequence** (optional): protected (Fmoc/tBu) and unprotected MW from the one-letter sequence, with N-terminal (H / Ac) and C-terminal (amide / acid) options.
3. **Coupling plan**: Fmoc-AA, coupling reagent and base amounts per coupling and per residue, plus piperidine and DMF totals for the whole campaign. Washes after coupling and after Fmoc removal are set separately (number of washes and mL/g for each).

Projects can be saved in the browser (localStorage). The last inputs are restored automatically. Results can be copied or printed to PDF.

## Formulas

```
Scale (mmol)                 = Initial dry resin (g) × Loading (mmol/g)
Theoretical peptide–resin (g) = Resin (g) + Scale (mmol) × [Protected MW + Resin MW correction] ÷ 1000
Peptide–resin loading         = Scale (mmol) ÷ Theoretical peptide–resin (g)
Expected final peptide (g)    = Scale (mmol) × Unprotected MW × Yield (%) ÷ 100000
```

## Resin MW correction defaults

The correction is the net mass change on attaching the peptide, relative to the protected-peptide MW as you define it. All values are editable.

| Resin | Default (g/mol) | Basis |
|---|---|---|
| Rink Amide (AM, MBHA, PS-PEG), Sieber | −222 | Removal of the resin's Fmoc group. If the protected MW is defined as the C-terminal amide, subtract a further 17.03 (NH₃): ≈ −239.27 |
| Wang | −18.02 | Ester bond, loss of H₂O; protected MW as free C-terminal acid |
| 2-Chlorotrityl chloride | −36.46 | Loss of HCl; protected MW as free acid, loading for the chloride form |
| Custom | 0 | Enter your own |

## Sequence MW conventions

Average residue masses. Side-chain protection: Ser/Thr/Tyr(tBu), Asp/Glu(OtBu), Lys/Trp(Boc), Asn/Gln/His/Cys(Trt), Arg(Pbf). Fmoc-AA building-block MWs are derived from the same data (e.g. Fmoc-Arg(Pbf)-OH 648.78).

### Sequence notation

- One-letter codes, N → C. Spaces, digits, dashes and dots are ignored.
- **Lowercase letter = D-amino acid** (same mass; the building block becomes Fmoc-D-…-OH).
- **Non-natural residues in square brackets**, case-insensitive, optional `D-` prefix: `H[3Pal]E[Tyr(2-Boc-ea)][D-2Nal]G`.
- Or tap the residue buttons under the sequence box (standard residues by three-letter code, non-natural residues by building block). The "D-isomer" switch inserts the D form.

Built-in non-natural residues (bracket name → building block):

| Name | Building block | MW |
|---|---|---|
| `[Pen]` | Fmoc-Pen(Trt)-OH | 613.76 |
| `[Sar]` | Fmoc-Sar-OH | 311.33 |
| `[3Pal]` | Fmoc-3-Pal-OH (3-pyridylalanine) | 388.42 |
| `[2Nal]` | Fmoc-2-Nal-OH (2-naphthylalanine) | 437.49 |
| `[Thpgly]` | Fmoc-Thpgly-OH (tetrahydropyran-4-yl glycine) | 381.42 |
| `[7MeTrp]` | Fmoc-7-MeTrp-OH (7-methyltryptophan) | 440.49 |
| `[Tyr(2-Boc-ea)]` | Fmoc-Tyr(2-Boc-ea)-OH (O-(2-Boc-aminoethyl)tyrosine) | 546.61 |

Three-letter codes of the standard residues also work in brackets, e.g. `[Ala]`.

**Custom residues**: enter a name, the in-chain residue mass (unprotected) and the MW of the Fmoc building block as purchased. The side-chain protection mass is the difference `building block − residue − H₂O − Fmoc`, so the protected MW and the coupling table both follow from those two numbers.

## Development

- `calc.js`: all calculations (no DOM), shared by the page, the service worker and the tests.
- `i18n.js`: English and Hebrew strings.
- `app.js`, `index.html`, `styles.css`: UI.
- `service-worker.js`: offline cache, named after `APP_VERSION` in `calc.js`. **Bump `APP_VERSION` on every release** so installed apps pick up the new files.

Run the tests (Node 18+):

```
node --test
```

Run locally:

```
python3 -m http.server 8000
```
