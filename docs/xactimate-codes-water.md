# Xactimate Line Item Codes — Water Damage Restoration

> Reference database for AI Photo Scope pipeline. Sources: Reets Drying Academy, Xactware official docs, Xact Mitigation Consultants, Cleanfax, Injectidry, Claims Delegates.

## Code Structure

Format: `CATEGORY` + `SELECTOR` (e.g., `WTRDRYWLF`)
- Category = 3-letter prefix (WTR, HMR, CLN, etc.)
- Selector = operation suffix
- Unit types: SF (sq ft), LF (linear ft), EA (each), HR (hour), DA (day), WK (week), SY (sq yard)

---

## WTR — Water Extraction & Remediation (Primary Category)

### Water Extraction

| Code | Description | Unit |
|------|-------------|------|
| WTREXT | Water extraction - carpet wand on carpet | Per app |
| WTREXTH | Water extraction - hard surface | Per app |
| WTREXTA | Water extraction - after hours | Per app |
| WTREXTG | Water extraction - Category 2 (gray water) | Per app |
| WTREXTS | Water extraction - Category 3 (black water) | Per app |

### Drywall Removal

| Code | Description | Unit |
|------|-------------|------|
| WTRDRYW | Drywall removal, bagging, discard, cleanup | SF |
| WTRDRYWI | Drywall removal - flood cut 4" | SF |
| WTRDRYWLF | Drywall removal - 2' flood cut | LF |
| WTRDRYWLS | Drywall removal - Category 3 | LF |
| WTRDRYWLA | Drywall removal - after hours | LF |

### Insulation

| Code | Description | Unit |
|------|-------------|------|
| WTRINS | Insulation removal and bagging | Per app |
| WTRINSC | Insulation removal - confined space | Per app |

### Flooring Removal

| Code | Description | Unit |
|------|-------------|------|
| WTRFC | Flooring removal - general | Per app |
| WTRFCC | Flooring removal - carpet | Per app |
| WTRFCT | Flooring removal - tile | Per app |
| WTRFCV | Flooring removal - vinyl | Per app |
| WTRFCW | Flooring removal - wood | Per app |
| WTRFCL | Flooring removal - laminate | Per app |
| WTRFCS | Flooring removal - Category 3 | Per app |

### Trim & Baseboard

| Code | Description | Unit |
|------|-------------|------|
| WTRTRI | Trim removal (no bagging) | Per app |
| WTRTRIM | Trim removal with bagging | Per app |
| WTRBASE | Baseboard removal | Per app |

### Antimicrobial / Cleaning

| Code | Description | Unit |
|------|-------------|------|
| WTRGRM | Antimicrobial application | Per app |
| WTRGRMA | Antimicrobial - after hours | Per app |
| WTRGRMB | Antimicrobial - botanical | Per app |
| WTRGRMBIO | Antimicrobial - spore-based | Per app |

### Drying Equipment (per 24-hour period)

| Code | Description | Unit | Notes |
|------|-------------|------|-------|
| WTRDRY | Air mover | EA/day | ~$25/day |
| WTRDRY+ | Air mover - axial variant | EA/day | |
| WTRDHM | Dehumidifier - standard/regular (64-65 pints/day) | EA/day | |
| WTRDHM> | Dehumidifier - Large (70-100 pints/day) | EA/day | |
| WTRDHM>> | Dehumidifier - Extra Large (124-145 pints/day) | EA/day | |
| WTRDHM>>> | Dehumidifier - XXL (161-170 pints/day) | EA/day | |
| WTRNAFAN | Air filtration device / air scrubber | DA | ~$71.54/day |

### Equipment Monitoring & Labor

| Code | Description | Unit |
|------|-------------|------|
| WTREQ | Equipment monitoring labor | HR |

### Specialty Drying Systems

| Code | Description | Unit |
|------|-------------|------|
| WTRWALLD | Wall drying system (Injectidry) | Per app |
| WTRWFI | Floor drying package (Injectidry) | Per app |
| WTRWFDAD | Floor drying - additional (>400 SF) | Per app |
| WTRWALL | Wall & ceiling drying package | Per app |

### PPE & Safety

| Code | Description | Unit |
|------|-------------|------|
| WTRPPE | PPE (general, includes N-95) | Per app |
| WTRPPEM | N-95 mask PPE (individual) | EA |

### Furniture & Contents

| Code | Description | Unit |
|------|-------------|------|
| WTRBLK | Block and pad (furniture protection) | Per room |

### Specialty Operations

| Code | Description | Unit |
|------|-------------|------|
| WTRBLAST | Dry ice/soda blasting - exposed flooring/walls | Per app |
| WTRBLAS2 | Dry ice/sand blasting - framing w/sheathing | Per app |
| WTRTUBD | Tub detachment | EA |
| WTRCABLOW | Cabinet removal/disposal | LF |
| WTRCABLWD | Cabinet detachment for on-site reset | LF |
| WTRCABLDS | Cabinet detachment w/lower positioning & shoring | LF |

---

## HMR — Hazardous Material Remediation

| Code | Description | Unit |
|------|-------------|------|
| HMRASBTPA | Asbestos air clearance test - base charge | EA |
| HMRASBTPAS | Asbestos air clearance test - per sample | EA |
| HMRDIS | Building disinfection via fog | SF |

---

## HEPA Vacuuming

| Code | Description | Unit |
|------|-------------|------|
| HEPAFSH | HEPA vacuuming - exposed framing w/sheathing (floors) | SF |
| HEPAWSH | HEPA vacuuming - exposed framing w/sheathing (walls) | SF |
| HBAGG | Plastic glove bags for hazmat cleanup | EA |

---

## Other Categories Commonly Used in Water Damage Scopes

| Category | Prefix | Common Use |
|----------|--------|------------|
| CLN | CLN | Cleaning services |
| CON | CON | Content manipulation (move out/reset) |
| DMO | DMO | General demolition |
| DRY | DRY | Drywall replacement/repair |
| PNT | PNT | Painting |
| FCC/FCT/FCV/FCW | FC* | Floor covering by type |
| PLM | PLM | Plumbing |
| TMP | TMP | Temporary repairs |
| LAB | LAB | Labor / supervision |
| SCF | SCF | Scaffolding |
| FEE | FEE | Permits and fees |
| ELE | ELE | Electrical |

---

## Typical Water Damage Scope — Line Item Order

Based on sample Xactimate estimates, a typical room-by-room scope follows this order:

1. Muck-out / flood loss cleanup (SF)
2. Tear out flooring — non-salvageable (SF)
3. Tear out wet drywall — flood cut height (LF)
4. Tear out baseboard (LF)
5. Tear out and bag wet insulation (SF)
6. Apply antimicrobial agent to surfaces (SF)
7. HEPA vacuum stud cavities (SF)
8. Clean stud wall — heavy (SF)
9. Seal walls/ceiling with antimicrobial coating (SF)
10. Replace insulation (SF)
11. Replace drywall — hung, taped, floated (SF)
12. Texture drywall (SF)
13. Seal/prime then paint — 3 coats (SF)
14. Replace baseboard (LF)
15. Paint baseboard — 2 coats (LF)
16. Replace flooring (SF)
17. Floor preparation for new flooring (SF)
18. Masking/floor protection (LF/SF)
19. Final cleaning — construction, residential (SF)

**Equipment (separate section, per 24hr):**
20. Air movers — qty x days (EA)
21. Dehumidifiers — qty x days, specify size (EA)
22. Air scrubber/negative air — days (DA)
23. Equipment monitoring labor (HR)

**Non-obvious items (Brett's "money" items):**
24. Equipment decontamination
25. HEPA filter replacement
26. PPE / Tyvek suit
27. Floor protection
28. Containment barrier
29. Zipper door
30. Ceiling fixture removal/reset (fans, lights)
31. Consumables (poly sheeting, tape, antimicrobial)

---

## Estimate Format (for PDF Export)

### Columns in a standard Xactimate estimate:

| Column | Description |
|--------|-------------|
| DESCRIPTION | Plain-text description of work |
| QTY | Quantity with unit (SF, LF, EA, HR, DA) |
| UNIT PRICE | Cost per unit from regional price list |
| TAX | Sales tax on materials |
| O&P | Overhead & Profit (typically 10% + 10% = 20%) |
| RCV | Replacement Cost Value (full, undepreciated) |
| DEPREC. | Depreciation |
| ACV | Actual Cash Value (RCV - depreciation) |

### Header fields:
- Company name, estimator, license
- Insured name, property address
- Claim number, policy number
- Type of loss, date of loss
- Price list code (regional, e.g., CASO8X_SEP18)

### Notes:
- Prices are regional and updated monthly by Xactware
- Crewmatic V1 outputs line items WITHOUT pricing (contractor imports into their own Xactimate for pricing)
- V2: integrate regional price lists for estimate totals

---

## ESX File Format

- Container: ZIP-compressed archive (rename .esx to .zip to extract)
- Internal format: XML files
- Contains: claim metadata, sketches, line items, photos, notes
- Proprietary schema (not publicly documented by Xactware)
- Some third-party tools (magicplan, Docusketch) can generate ESX files
- V2 consideration for Crewmatic

---

## Sources

- [Reets Drying Academy — Xactimate Line Items for Water Mitigation](https://reetsdryingacademy.com/blog/xactimate-line-items-for-water-mitigation/)
- [Xactware — Category Codes](https://xactware.helpdocs.io/l/enUS/article/gb9lf49tdw-category-codes-in-xactimate-online)
- [Xactware — Sketch Variables](https://xactware.helpdocs.io/l/enUS/article/q7rfy2iviv-variables-and-category-codes-in-xactimate-online)
- [Xact Mitigation Consultants — WTR Cheat Sheet PDF](https://assets.website-files.com/65f0b16dfb58332c74479e54/65f79cd6f9ed005fb38a99f4_Water_Codes_-_Cheat_Sheet.pdf)
- [Cleanfax — Missing Line Items / 2020 Code Changes](https://cleanfax.com/missing-line-items/)
- [Injectidry — Xactimate Codes](https://www.injectidry.com/faqs/xactimate-codes/)
- [Claims Delegates — Water Damage Codes](https://www.claimsdelegates.com/1000-an-hour-five-xactimate-water-damage-codes/)
- [World Estimating — Water Damage Xactimate PDF](https://worldestimating.com/wp-content/uploads/2021/06/Water-Damage-Xactimate.pdf)
- [Empire Estimators — Sample Estimates](https://www.empireestimators.com/xactimate-estimate-examples/)
- [Docusketch — How to Read an Xactimate Estimate](https://www.docusketch.com/post/how-to-read-an-xactimate-estimate)
- [UpHelp — Sample Xactimate Estimate PDF](https://uphelp.org/wp-content/uploads/2020/09/rra-_uphelp_sample_xactimate_estimate.pdf)
