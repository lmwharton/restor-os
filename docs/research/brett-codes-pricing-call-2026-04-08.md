# Brett Call: Codes, Pricing & Estimating Strategy
> Date: 2026-04-08 | Participants: Lakshman, Brett, Alex

## Key Decisions

### 1. Two Code Systems — Toggle in Product
- **Insurance/restoration work:** Use Xactimate codes. No alternative exists. ~90% of contractors use it.
- **Non-insurance/remodeling work:** Create Crewmatic's own code system. More readable, encodes more info than Xactimate.
- **UI:** Toggle to switch between Xactimate codes and Crewmatic codes when generating a scope.

### 2. V1 = Codes Only, No Pricing
- Generate line items with codes + descriptions + quantities + citations
- Contractor manually enters into Xactimate for pricing (insurance work)
- Contractor uses Crewmatic's own estimate output for non-insurance work
- Brett quote: "at a minimum, we can just create the exactimate codes and not even put the pricing"

### 3. Xactimate Pricing is Legally Off-Limits
- Codes are public knowledge (not proprietary) — safe to use
- Pricing is Verisk's proprietary data — cannot copy, redistribute, or display
- Verisk builds pricing from: contractor-submitted estimates by region + inflation adjustments
- Brett: "Claude's telling me we can copy all of the codes, but we can't copy their pricing"

### 4. Brett Designing Crewmatic Code System
- Brett will work with Claude to design Crewmatic-native codes tonight
- Goals: more readable than Xactimate, encode what was done + where + material
- Example from his estimate: `DEMO-FLR-TILE` = "Demo floor tile" — immediately readable
- Brett: "I kind of like the way it laid it out. It literally says what I'm doing, where it's at, and what the material was"

### 5. Xactimate Code Export Coming
- Brett offered to export Xactimate codes to Excel and send them
- Will provide real code structure with all activity types and selectors

### 6. RSMeans Not Useful for Restoration
- Brett confirms: "they're not going to have restoration pricing — dehumidifiers, air movers, equipment"
- RSMeans only covers construction/renovation — maybe V2+ partnership for GC work

### 7. The "5-Minute Quote" Vision
- Brett is already nearly able to: arrive at site → take 5 photos → voice scope → Claude generates estimate → send to customer from truck
- This works for remodeling/GC work TODAY (using Claude directly)
- For insurance work, still need Xactimate step — but the scope + documentation can be instant
- Brett: "if I had all these tools at my fingertips, and the worst thing I had to do was go on exactimate and type in 15 line items and quantities that already auto-populated for me, it wouldn't be the worst thing"

### 8. Some Contractors Refuse Xactimate
- ~10% of restoration contractors don't use Xactimate
- They send their own line items + pricing → insurance pushes back → becomes 2-3 week argument → eventually gets resolved
- Crewmatic needs to serve these contractors too → Crewmatic codes as alternative

## How Xactimate Pricing Actually Works (Brett's Explanation)
- Contractors CAN change pricing per code in Xactimate
- Most contractors don't — they don't know how, or think insurance will reject it
- Xactimate says they update prices monthly based on what contractors charge regionally
- Brett: "Not every contractor will do that because they don't really know how to do it. It's kind of difficult to do and they don't make it obvious"
- Result: Xactimate prices tend to be below-market because contractors don't update them and carrier data dominates

## The GC Work Tension (Alex's Point)
- Simple GC quoting (photos + voice → estimate in 5 min) is the "magical" use case
- Doesn't need Xactimate at all — just Crewmatic codes + pricing
- Alex: "I'm not trying to throw a wrench, but in my mind it was all about making estimating easier for small contractors"
- Brett acknowledges but they've already committed to the restoration path
- Both can coexist: restoration (Xactimate) + GC work (Crewmatic codes)

## Alex's Strategic Input (Third Co-founder)

### "Who does the product serve?" — Fundamental question
- Alex pushes: the product serves **contractors**, not insurance carriers
- Insurance companies won't like Crewmatic helping contractors maximize bills / create supplements
- But ~50% of contractors aren't on TPA programs — they're independent
- Build for contractors first, then create a tailored version for insurance companies later

### TPA Programs — Important Industry Context
- **Alacrity, Code Blue, Cedric's** — Third Party Administrators (TPAs) that assign contractors to jobs
- TPAs are middlemen: carrier → TPA → contractor
- TPAs review estimates BEFORE they reach the adjuster — they can cut line items
- Some carriers mandate specific software: **State Farm requires "Fire and Ice"**
- Brett's contact at Alacrity advised: **target regional insurance carriers first** (Frankenmuth Mutual, etc.), not State Farm/Allstate

### GTM Discussion
- Alex wants to focus on go-to-market before building more features
- Suggestion: daily 1-hour co-working call (Lakshman, Brett, Alex)
- Alex raises the GC work angle again: "5-minute quote from truck" is the magic moment
- The tension: insurance restoration = big gigs but complex. GC work = simpler but smaller revenue.
- Consensus: build for contractors first, insurance partnerships later

### Pricing Strategy (Longer-term Vision from Call)
- Brett + Alex discuss building Crewmatic's own pricing database long-term
- Formula: material cost + labor hours + equipment rental → multiplied by cost-of-living factor per zip code
- Be transparent about how pricing is derived (unlike Xactimate's black box)
- Xactimate weaknesses to exploit: black box pricing, infrequent updates, regional not local (zip-code level)
- Allow contractors to adjust pricing → aggregate data over time → build the moat
- Alex cautions: don't compete head-on with Verisk's pricing moat yet — they can easily open-source their algorithm to crush you
- Better approach: build the workflow, accumulate data naturally, pricing moat emerges from scale

### Insurance Company Angle (V2+)
- Crewmatic could offer a "carrier version" with supplement/maximize features removed
- Add features for insurance-side review and compliance
- Two-sided product: contractor version (maximize scope) + carrier version (verify scope)

## Action Items
- [ ] Brett: Design Crewmatic code system with Claude (tonight)
- [ ] Brett: Export Xactimate codes to Excel and send to Lakshman
- [ ] Lakshman: Build scope_codes DB table + seed migration
- [ ] Lakshman: Design Crewmatic code format (after Brett's input)
- [ ] Future: Toggle in UI between Xactimate and Crewmatic code modes
- [ ] Alex + Brett: Reconnect on GTM strategy, website, first 10 customers
- [ ] All three: Set up daily 1-hour co-working call cadence
