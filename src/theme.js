// ── DESIGN TOKENS ────────────────────────────────────────────────────────────
// Palette direction: "coastal atelier" — deep slate-teal and dusty sea-blue,
// warm clay and sand, sage, a warm off-white ground, and one true black used
// sparingly for high-emphasis moments. Sourced from a beach-toned gradient
// (stacked circles: espresso brown → clay → dusty teal → sea-foam → white)
// and a material flat-lay (slate-teal glass, charcoal, teal-green, greige,
// cream, eucalyptus, and matte black). Every key name below is unchanged from
// before — only the values moved — so nothing downstream needs to change.
export const C = {
  navy:        "#172c30",   // deep slate-teal — primary structural dark
  navyMid:     "#1f3d45",   // charcoal-teal — secondary structural dark
  black:       "#0A0E0F",   // true near-black — reserved for high-emphasis accents only (see usage note below)
  teal:        "#2F7A72",   // moodboard teal-green — primary brand color
  tealLight:   "#7FA6AC",   // dusty sea-blue — secondary teal
  tealFaint:   "#E6EEEC",   // pale sea-foam wash
  amber:       "#B9905A",   // warm clay/sand — replaces the old bright orange-amber
  amberFaint:  "#F5EDE2",   // warm sand wash
  red:         "#A85A4C",   // muted brick/terracotta — never neon
  redFaint:    "#F6E7E3",   // pale blush wash
  green:       "#7C9473",   // sage — success, more organic than the old bright green
  greenFaint:  "#EAF0E4",   // pale sage wash
bg:          "#EAEAEA",   // bright studio silver-grey (replaces #eee7f7d1)
  surface:     "#FFFEFB",   // warm white card surface (pops beautifully against the studio grey)
  border:      "#DEDACE",   // soft warm border
  linen:       "#F2E9E4",   // soft warm border
  textPri:     "#12181A",   // dark charcoal — primary reading text (darkened from #1E2A2C)
  textSec:     "#3F4B4F",   // darker slate text (darkened from #57666B)
  textMuted:   "#726E64",   // darker warm grey text (darkened from #98948A)
};

// C.black is intentionally not wired into every component — it's the one
// deliberate risk in this palette (the "sunglasses" note), meant for a single
// signature use per screen: e.g. a plate badge, a primary CTA, or a divider
// that needs to read as ink rather than navy. Reach for it sparingly.

export const mono = { fontFamily: "'JetBrains Mono', 'Courier New', monospace" };

// ── HELPERS ──────────────────────────────────────────────────────────────────
export const fmt = (n) => `SGD ${n.toLocaleString()}`;
export const totalInv = (c) => c.purchase + c.insurance + c.reg + (c.otherCharges || 0);
// NOTE: `coe` (a car's registration/ownership-renewal expiry date) is a Singapore-era field
// name kept as-is for data compatibility with existing fleet records. Every user-facing
// label has been renamed to "Registration Expiry" — see Fleet.jsx / Alert.jsx.
export const daysUntil = (d) => Math.ceil((new Date(d) - new Date("2026-06-27")) / 86400000);

// ── DAILY RATE BANDS (SGD/day) ──────────────────────────────────────────────
// Reference ranges so daily rates can be set sensibly per vehicle category
// instead of being an arbitrary number. Used as suggested min/max guardrails
// wherever a target or booking rate is entered.
// NOTE: these min/max figures were originally tuned for AED/Dubai pricing and
// haven't been re-checked against SGD/Singapore market rates — treat them as
// placeholders to revisit, not verified numbers.
export const RATE_BANDS = [
  { category: "Economy",     min: 90,  max: 150 },
  { category: "Compact/Sedan", min: 130, max: 220 },
  { category: "SUV",         min: 220, max: 450 },
  { category: "Luxury",      min: 450, max: 1200 },
  { category: "Exotic/Sports", min: 1200, max: 4000 },
];

// Suggests a market category (and its SGD/day band) from a car's target
// or asking rate, so the UI can flag "this looks low/high for its class".
export const suggestRateBand = (dailyRate) => {
  const rate = Number(dailyRate) || 0;
  return RATE_BANDS.find(b => rate >= b.min && rate <= b.max)
    || (rate > 0 ? RATE_BANDS[RATE_BANDS.length - 1] : RATE_BANDS[0]);
};

// ── TARGET RATE SUGGESTIONS (3-tier) ────────────────────────────────────────
// Given the car's total investment, when its COE runs out, and a maintenance %,
// generate 3 target options — Conservative / Balanced / Aggressive — each built
// around a target CAGR compounded over the years left to COE expiry:
//   1. TotalInvestment = investment + maintenance (maintPct % of investment)
//   2. YearsToExpiry    = (COE expiry date − purchase date) / 365
//   3. FV(tier)          = TotalInvestment × (1 + CAGR(tier)) ^ YearsToExpiry
//   4. TargetMonthlyIncome(tier) = FV(tier) / (YearsToExpiry × 12)
//   5. DailyRate(tier)   = TargetMonthlyIncome(tier) / DaysRentedPerMonth(tier)
//   6. Profit%(tier)     = (FV(tier) / TotalInvestment − 1) × 100
// Balanced is anchored at 11% CAGR — the actual investment goal — with
// Conservative/Aggressive as symmetric ±3pt offsets. Days/month assumed per
// tier fall as the tier gets more aggressive (25 → 22 → 18), so rate, and FV
// both rise Conservative → Balanced → Aggressive by construction — no
// clamping or reordering pass needed.
const CAGR_ANCHOR = 0.11;
const CAGR_OFFSET = 0.03;

const TIERS = [
  { label: "Conservative", cagr: CAGR_ANCHOR - CAGR_OFFSET, daysPerMonth: 25 },
  { label: "Balanced", cagr: CAGR_ANCHOR, daysPerMonth: 22 },
  { label: "Aggressive", cagr: CAGR_ANCHOR + CAGR_OFFSET, daysPerMonth: 18 },
];

const MS_PER_DAY = 1000 * 60 * 60 * 24;

// investment: purchase + insurance + registration + other charges (maintenance
//             is folded in below, via maintPct).
// purchaseDate / coe: date strings. purchaseDate falls back to today if missing
//             so older records without one still generate options.
// minRate / maxRate: no longer drive the math directly — rate is now purely a
//             function of the CAGR/FV formula above. Kept in the signature in
//             case you want to flag "this lands outside your stated band".
export const generateTargetOptions = ({ investment, purchaseDate, coe, maintPct, minRate, maxRate }) => {
  const maintenanceCost = investment * ((maintPct || 0) / 100);
  const totalInvestment = investment + maintenanceCost;

  const start = purchaseDate ? new Date(purchaseDate) : new Date();
  const end = new Date(coe);
  const rawDays = (end - start) / MS_PER_DAY;
  // Guard against a missing/past COE date collapsing the horizon to zero or negative.
  const daysToExpiry = Number.isFinite(rawDays) && rawDays > 30 ? rawDays : 30;
  const yearsToExpiry = daysToExpiry / 365;
  const monthsToExpiry = yearsToExpiry * 12;

  return TIERS.map(({ label, cagr, daysPerMonth }) => {
    const fv = totalInvestment * Math.pow(1 + cagr, yearsToExpiry);
    const monthlyIncome = fv / monthsToExpiry;
    const rate = monthlyIncome / daysPerMonth;
    const profitPct = (fv / totalInvestment - 1) * 100;

    return {
      label,
      rate: Math.round(rate),
      runningDays: daysPerMonth,
      monthlyIncome: Math.round(monthlyIncome),
      profitPct: Math.round(profitPct * 10) / 10,
      cagr: Math.round(cagr * 1000) / 10, // e.g. 0.11 -> 11 (%)
    };
  });
};