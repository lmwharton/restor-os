# TPA & Insurance Carrier Guidelines — Water Damage Restoration

> Research summary for AI pipeline and scope validation. Sources: R&R Magazine, The DYOJO, Mikey's Board (contractor forums), TPA websites, industry publications.

## Major TPAs (Third Party Administrators)

| TPA | Notes |
|-----|-------|
| **Accuserve** (formerly CodeBlue + MADSKY + AccuWin) | Unified Jan 2023. Full-range: water, roofing, window, general repair. 27-point algorithm for contractor selection. |
| **Alacrity Solutions** | Nationwide network. Annual contractor audits. Certificate of Satisfaction with workmanship warranty. |
| **Crawford Contractor Connection** | Largest independently-managed network (~6,000 contractors, ~500K assignments/year). 5-year workmanship warranty. |
| **Sedgwick** | 2,000+ locations. High bar for network admission. |
| **BrightServe** | Meets/exceeds industry standards for contractor qualification. |

## Are Guidelines Publicly Available?

**No.** TPA program guidelines are proprietary:
- Embedded in contractor Service Level Agreements (SLAs)
- Carrier-specific (same TPA may enforce different rules per carrier)
- Industry terms: "ACE guidelines," "program outlines," "carrier-specific rules"
- **Brett (co-founder) said he can provide his carrier guideline docs** — this is the best path

## Common TPA Rules (Stricter than S500)

### Response Time SLAs
- Contact policyholder within 1-2 hours
- On-site within 4-24 hours (some require 2-hour for emergency water)
- Failure to meet SLA = loss of assignment or network standing

### Equipment Sizing
- TPAs may **downgrade equipment sizes** in review (XL dehu → Large, etc.)
- Standard ratio: ~1 XL dehu per 7-8 air movers per ~1,000 SF (TPAs challenge this)
- Must justify equipment size with room measurements and S500 calculations

### Line Item Restrictions
- Certain items **auto-rejected** by TPA review systems — require adjuster override with F9 notes + photos
- Commonly contested: emergency/after-hours charges, trip charges, monitoring time limits
- Some TPAs have "pre-approved" line item lists — anything outside requires manual approval

### Documentation Requirements
- **Daily moisture readings** required to justify each equipment day
- Photo documentation of every affected area — before/during/after
- Estimate upload deadlines: often 24-48 hours after inspection
- Room-by-room breakdown required (no bundled estimates)

### Common Rejection Triggers
1. Equipment larger than reviewer deems necessary
2. Drying days not supported by moisture logs
3. Line items without photo documentation
4. Missing room-by-room breakdown
5. Vague or bundled line items
6. After-hours/emergency charges (carrier-dependent)
7. Antimicrobial application without Cat 2/3 documentation

### Fee Structure
- TPA referral fee: **5-20%** off contractor's invoice (typical: 5-6%)
- Comes directly off top-line revenue before costs

## Carrier-Specific Notes

### State Farm
- Premier Service Program — voluntary preferred contractor network
- Pre-approves emergency mitigation (no permission needed to start)
- Uses managed repair networks (Contractor Connection, Accuserve)
- Thorough documentation requirements

### USAA
- Preferred vendor lists but policyholders can choose own contractor
- Generally faster payment through TPA path
- High service standards (military customer base)

### Universal Carrier Requirements
- **IICRC S500 compliance** is the baseline across ALL carriers
- Required certifications: WRT, ASD, AMRT
- Background checks, licenses, proof of insurance
- OSHA respirator fit test compliance

## Implications for Crewmatic AI Pipeline

### V1 (launch)
- S500/OSHA justifications on every line item (universal, not carrier-specific)
- Room-by-room breakdown (required by all TPAs)
- Photo-backed scope (all TPAs require photo evidence per line item)
- Proper equipment sizing based on room measurements

### V2 (carrier-aware scoping)
- **Pre-validation against known rejection patterns:**
  - Flag equipment sizing that TPAs typically downgrade
  - Warn when line items lack photo documentation
  - Alert if drying days aren't supported by moisture readings
  - Flag antimicrobial without Cat 2/3 classification
- Carrier-specific rule sets (requires Brett's guideline docs)
- Auto-generate F9 notes (justification notes) for items likely to be challenged
- Response time tracking vs SLA deadlines

### V3 (rejection predictor)
- AI predicts which line items will be rejected by which TPA
- Suggests pre-emptive documentation/justification for high-risk items
- Learns from submission outcomes across all Crewmatic users (network effect moat)

## Sources

- [THE DYOJO — Insurance claims program (TPA) work](https://www.thedyojo.com/blog/program-tpa-work-for-insurance-claims)
- [R&R Magazine — For Restoration Contractors, Apprehension is the "A" in TPA](https://www.randrmagonline.com/articles/90826-for-restoration-contractors-apprehension-is-the-a-in-tpa)
- [R&R Magazine — The Stranglehold of a TPA on the Restoration Industry](https://www.randrmagonline.com/articles/90724-the-stranglehold-of-a-tpa-on-the-restoration-and-remediation-industry)
- [R&R Magazine — HELP! Claims Review Shredded My Estimate](https://www.randrmagonline.com/articles/88728-help-claims-review-shredded-my-estimate-the-intentional-restorer-vol-2-with-video)
- [R&R Magazine — 10 Commandments of Xactimate Estimating Success](https://www.randrmagonline.com/articles/88186-the-10-commandments-of-xactimate-estimating-success)
- [Mikey's Board — CODE BLUE discussions](https://mikeysboard.com/threads/code-blue-out-of-their-minds.276330/)
- [Alacrity Solutions](https://www.alacritysolutions.com/solutions/network-solutions/mitigation/)
- [Crawford Contractor Connection](https://www.crawco.com/services/managed-repair)
- [Sedgwick](https://www.sedgwick.com/solutions/property/repair-restoration-mitigation/)
- [Accuserve](https://www.accuserve.com/blog/accuwin-codeblue-and-madsky-unite-as-accuserve)
- [State Farm Premier Service Program](https://www.statefarm.com/claims/home-and-property/premier-service)
