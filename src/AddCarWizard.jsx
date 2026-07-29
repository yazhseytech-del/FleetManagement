import { useState } from "react";
import { C, mono, fmt, totalInv, generateTargetOptions } from "./theme";
import { Btn, Input } from "./components";

const STEPS = ["Purchase Details", "Investment Summary", "System Suggestions", "Confirm"];

// Maintenance % and the rental price band are no longer collected from the
// user in this wizard — they're fixed system fallbacks so generateTargetOptions
// still has a rate range and maintenance assumption to work with.
const DEFAULT_MAINT_PCT = 7.5;
const DEFAULT_MIN_RATE = 70;
const DEFAULT_MAX_RATE = 110;

const emptyCar = () => ({
  plate: "",
  make: "",
  model: "",
  year: "",
  color: "",
  purchase: "",
  insurance: "",
  reg: "",
  otherCharges: "",
  purchaseDate: "",
  coe: "",
 
});

// Full onboarding flow for a new car: enter what it cost, let the system total
// the investment automatically, then pick one of 3 system-generated targets
// (maintenance % and rental price band are fixed system defaults, no longer
// entered by the user). Finishing hands a complete car record — including the
// chosen target — up to the parent, which is the only thing that actually
// gets saved to fleet data.
const AddCarWizard = ({ onComplete, onClose }) => {
  const [step, setStep] = useState(0);
  const [car, setCar] = useState(emptyCar());
  const [options, setOptions] = useState(null);
  const [chosen, setChosen] = useState(null);

  const setField = (key, value) => setCar(c => ({ ...c, [key]: value }));

  const investment =
    (parseFloat(car.purchase) || 0) +
    (parseFloat(car.insurance) || 0) +
    (parseFloat(car.reg) || 0) +
    (parseFloat(car.otherCharges) || 0);

  const canProceedStep0 = car.plate && car.make && car.model && car.year && car.purchase && car.coe;

  const handleGenerate = () => {
    // theme.js's generateTargetOptions now targets a CAGR per tier (Conservative/
    // Balanced/Aggressive anchored around 11%), compounded over the years left to
    // COE expiry, so it needs purchaseDate as well as coe to work out that horizon.
    // Maintenance % and the rental rate band are no longer entered by the user —
    // fixed defaults stand in for them here.
    const opts = generateTargetOptions({
      investment,
      purchaseDate: car.purchaseDate,
      coe: car.coe,
      maintPct: DEFAULT_MAINT_PCT,
      minRate: DEFAULT_MIN_RATE,
      maxRate: DEFAULT_MAX_RATE,
    });
    setOptions(opts);
    setChosen(null);
    setStep(2);
  };

  const handleFinish = () => {
    const finalCar = {
      ...car,
      purchase: parseFloat(car.purchase),
      insurance: parseFloat(car.insurance) || 0,
      reg: parseFloat(car.reg) || 0,
      otherCharges: parseFloat(car.otherCharges) || 0,
      year: parseInt(car.year),
      purchaseDate: car.purchaseDate,
      coe: car.coe,
      
      maint: DEFAULT_MAINT_PCT,
      minRate: DEFAULT_MIN_RATE,
      maxRate: DEFAULT_MAX_RATE,
      targetRate: chosen.rate,
      runningDaysTarget: chosen.runningDays,
      profitPctTarget: chosen.profitPct,
      status: "Available",
    };
    onComplete(finalCar);
  };

  return (
    <>
      <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 200 }} />
      <div style={{ position: "fixed", top: "50%", left: "50%", transform: "translate(-50%, -50%)", background: C.surface, borderRadius: 12, boxShadow: "0 20px 60px rgba(0,0,0,0.15)", zIndex: 201, width: 560, maxHeight: "90vh", overflowY: "auto" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "20px 24px", borderBottom: `1px solid ${C.border}` }}>
          <div>
            <div style={{ fontSize: 15, fontWeight: 700, color: C.navy }}>Add New Car</div>
            <div style={{ fontSize: 10.5, color: C.textMuted, marginTop: 2 }}>Step {step + 1} of {STEPS.length} · {STEPS[step]}</div>
          </div>
          <div onClick={onClose} style={{ cursor: "pointer", fontSize: 18, color: C.textMuted }}>✕</div>
        </div>

        {/* Step progress dots */}
        <div style={{ display: "flex", gap: 4, padding: "12px 24px 0" }}>
          {STEPS.map((s, i) => (
            <div key={s} style={{ flex: 1, height: 4, borderRadius: 2, background: i <= step ? C.teal : C.border }} />
          ))}
        </div>

        <div style={{ padding: "20px 24px" }}>
          {/* STEP 0 — Purchase Details */}
          {step === 0 && (
            <div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <Input label="Car Number" value={car.plate} onChange={e => setField("plate", e.target.value)} placeholder="e.g., SBJ 4488 F" />
                <Input label="Year" type="number" value={car.year} onChange={e => setField("year", e.target.value)} placeholder="e.g., 2024" />
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <Input label="Make" value={car.make} onChange={e => setField("make", e.target.value)} placeholder="e.g., Toyota" />
                <Input label="Model" value={car.model} onChange={e => setField("model", e.target.value)} placeholder="e.g., Corolla" />
              </div>
              <Input label="Colour" value={car.color} onChange={e => setField("color", e.target.value)} placeholder="e.g., Silver" />
              
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <Input label="Purchase Price (SGD)" type="number" value={car.purchase} onChange={e => setField("purchase", e.target.value)} placeholder="e.g., 26000" />
                <Input label="Insurance (SGD)" type="number" value={car.insurance} onChange={e => setField("insurance", e.target.value)} placeholder="e.g., 1200" />
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <Input label="Registration (SGD)" type="number" value={car.reg} onChange={e => setField("reg", e.target.value)} placeholder="e.g., 1300" />
                <Input label="Other Charges (SGD)" type="number" value={car.otherCharges} onChange={e => setField("otherCharges", e.target.value)} placeholder="e.g., 200" />
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <Input label="Purchase Date" type="date" value={car.purchaseDate} onChange={e => setField("purchaseDate", e.target.value)} />
                <Input label="COE Expiry Date" type="date" value={car.coe} onChange={e => setField("coe", e.target.value)} />
              </div>
            </div>
          )}

          {/* STEP 1 — Investment Summary (auto-calculated) */}
          {step === 1 && (
            <div>
              <div style={{ fontSize: 11, color: C.textMuted, marginBottom: 12 }}>System auto-calculated from what you entered — nothing to fill in here.</div>
              {[
                ["Purchase Price", car.purchase],
                ["Insurance", car.insurance || 0],
                ["Registration", car.reg || 0],
                ["Other Charges", car.otherCharges || 0],
              ].map(([l, v]) => (
                <div key={l} style={{ display: "flex", justifyContent: "space-between", padding: "9px 0", borderBottom: `1px solid ${C.border}`, fontSize: 12 }}>
                  <span style={{ color: C.textMuted }}>{l}</span>
                  <span style={{ ...mono, fontWeight: 600 }}>{fmt(parseFloat(v) || 0)}</span>
                </div>
              ))}
              <div style={{ display: "flex", justifyContent: "space-between", padding: "12px 0", fontSize: 14, fontWeight: 700 }}>
                <span style={{ color: C.navy }}>Total Investment</span>
                <span style={{ ...mono, color: C.teal, fontSize: 18 }}>{fmt(investment)}</span>
              </div>
            </div>
          )}

          {/* STEP 2 — System Suggestions */}
          {step === 2 && options && (
            <div>
              <div style={{ fontSize: 11, color: C.textMuted, marginBottom: 12 }}>Pick the target that fits — each tier targets a different annual return (CAGR) compounded over the car's remaining COE runway; higher-return tiers assume fewer running days per month.</div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
                {options.map(o => {
                  const isBalanced = /balanced/i.test(o.label);
                  const isChosen = chosen?.label === o.label;
                  return (
                    <div key={o.label}
                      onClick={() => setChosen(o)}
                      style={{
                        position: "relative",
                        border: `2px solid ${isChosen ? C.teal : C.border}`,
                        background: isChosen ? C.tealFaint : C.surface,
                        borderRadius: 10, padding: 12, cursor: "pointer", textAlign: "center",
                      }}>
                      {isBalanced && (
                        <div style={{ position: "absolute", top: -10, left: "50%", transform: "translateX(-50%)", background: C.amber, color: "#fff", fontSize: 8.5, fontWeight: 700, padding: "2px 8px", borderRadius: 10, whiteSpace: "nowrap" }}>
                          ⭐ Recommended
                        </div>
                      )}
                      <div style={{ fontSize: 10, fontWeight: 700, color: C.textMuted, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 4, marginTop: isBalanced ? 4 : 0 }}>{o.label}</div>
                      <div style={{ fontSize: 10, fontWeight: 600, color: C.tealLight, marginBottom: 8 }}>{o.cagr}% CAGR</div>
                      <div style={{ ...mono, fontSize: 18, fontWeight: 700, color: C.navy }}>SGD {o.rate}</div>
                      <div style={{ fontSize: 9.5, color: C.textMuted, marginBottom: 8 }}>per day</div>
                      <div style={{ fontSize: 11, color: C.textSec, marginBottom: 3 }}>{o.runningDays} days/mo</div>
                      <div style={{ fontSize: 9.5, color: C.textMuted, marginTop: 6 }}>Target Monthly Income</div>
                      <div style={{ ...mono, fontSize: 12, fontWeight: 700, color: C.teal, marginBottom: 3 }}>{fmt(o.monthlyIncome)}</div>
                      <div style={{ ...mono, fontSize: 13, fontWeight: 700, color: o.profitPct >= 0 ? C.green : C.red }}>{o.profitPct}% profit</div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* STEP 3 — Confirm */}
          {step === 3 && chosen && (
            <div>
              <div style={{ padding: 14, background: C.greenFaint, borderRadius: 8, borderLeft: `3px solid ${C.green}`, marginBottom: 14 }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: C.green }}>✓ {chosen.label} target selected</div>
                <div style={{ fontSize: 10.5, color: C.textMuted, marginTop: 3 }}>This car will be added with status "Available"</div>
              </div>
              {[
                ["Car", `${car.make} ${car.model} (${car.plate})`],
                ["Total Investment", fmt(investment)],
                ["Selected Target", chosen.label],
                ["Target CAGR", `${chosen.cagr}%`],
                ["Expected Monthly Income", fmt(chosen.monthlyIncome)],
                ["Target Rate", `SGD ${chosen.rate}/day`],
                ["Avg Running Days", `${chosen.runningDays} days/month`],
                ["Expected Profit", `${chosen.profitPct}%`],
              ].map(([l, v]) => (
                <div key={l} style={{ display: "flex", justifyContent: "space-between", padding: "8px 0", borderBottom: `1px solid ${C.border}`, fontSize: 12 }}>
                  <span style={{ color: C.textMuted }}>{l}</span>
                  <span style={{ fontWeight: 600, color: C.navy }}>{v}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div style={{ display: "flex", gap: 8, justifyContent: "space-between", padding: "18px 24px", borderTop: `1px solid ${C.border}` }}>
          <div>
            {step > 0 && <Btn secondary onClick={() => setStep(step - 1)}>Back</Btn>}
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <Btn secondary onClick={onClose}>Cancel</Btn>
            {step === 0 && <Btn primary onClick={() => setStep(1)} disabled={!canProceedStep0} style={{ opacity: canProceedStep0 ? 1 : 0.5 }}>Next</Btn>}
            {step === 1 && <Btn primary onClick={handleGenerate}>Generate Suggestions</Btn>}
            {step === 2 && <Btn primary onClick={() => setStep(3)} disabled={!chosen} style={{ opacity: chosen ? 1 : 0.5 }}>Next</Btn>}
            {step === 3 && <Btn primary onClick={handleFinish}>Add Car</Btn>}
          </div>
        </div>
      </div>
    </>
  );
};

export default AddCarWizard;