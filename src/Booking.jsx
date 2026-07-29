import { useState, useEffect, useRef } from "react";
import { C, mono, fmt } from "./theme";
import { Card, Btn, StatusTag, PlateBadge } from "./components";
import { STATUS_PILL_COLORS, STATUS_PILL_FAINT } from "./Fleet";
import { computeCarAvailabilityTimeline } from "./useFleetData";
import { generateInvoicePdf } from "./Invoicepdf";


// The statuses the 10-day timeline can show, in legend order. Colors come
// from Fleet.jsx's STATUS_PILL_COLORS/STATUS_PILL_FAINT (already exported
// there for exactly this reuse) so the timeline never drifts from the same
// colors used on the Fleet screen's status pills. "Upcoming" is deliberately
// excluded — it's the car's overall current status (shown elsewhere, e.g.
// Fleet), not something a single day in this per-day projection ever
// becomes: every day before a future booking's start is just "Available".
const TIMELINE_STATUSES = ["Available", "On Rental", "Maintenance", "Ending Today"];

const formatDayLabel = (dateStr) => {
  const d = new Date(dateStr + "T00:00:00");
  return d.toLocaleDateString(undefined, { day: "2-digit", month: "short" });
};

// Professional 10-day horizontal Gantt-style strip for a single car, built
// entirely from computeCarAvailabilityTimeline (useFleetData.js) — the single
// source of truth for availability. Re-renders automatically whenever the
// `car` or `bookings` props change (e.g. a new booking is added, or the car's
// derived status flips), since those come straight from the fleetData hook.
export const AvailabilityTimeline = ({ car, bookings = [] }) => {
  if (!car) return null;
  const timeline = computeCarAvailabilityTimeline(car, bookings, 10);
  const todayStr = new Date().toISOString().slice(0, 10);

  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ fontSize: 11, fontWeight: 600, color: C.textSec, marginBottom: 6 }}>
        10-Day Availability — <span style={{ ...mono, color: C.navy }}>{car.plate}</span>
      </div>
      <div style={{ display: "flex", border: `1px solid ${C.border}`, borderRadius: 8, overflow: "hidden" }}>
        {timeline.map(({ date, status }, i) => (
          <div
            key={date}
            title={`${date}: ${status}`}
            style={{
              flex: 1,
              textAlign: "center",
              padding: "8px 2px",
              background: STATUS_PILL_FAINT[status] || C.bg,
              borderRight: i < timeline.length - 1 ? `1px solid ${C.border}` : "none",
            }}
          >
            <div style={{
              width: 8, height: 8, borderRadius: "50%", margin: "0 auto 4px",
              background: STATUS_PILL_COLORS[status] || C.textMuted,
            }} />
            <div style={{
              fontSize: 9, color: date === todayStr ? C.navy : C.textMuted,
              fontWeight: date === todayStr ? 700 : 500,
            }}>
              {formatDayLabel(date)}
            </div>
          </div>
        ))}
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 10, marginTop: 8 }}>
        {TIMELINE_STATUSES.map(s => (
          <div key={s} style={{ display: "flex", alignItems: "center", gap: 4 }}>
            <div style={{ width: 8, height: 8, borderRadius: "50%", background: STATUS_PILL_COLORS[s] }} />
            <span style={{ fontSize: 10, color: C.textMuted }}>{s}</span>
          </div>
        ))}
      </div>
    </div>
  );
};

const formatDateTime = (v) => {
  if (!v) return "";
  const d = new Date(v);
  if (isNaN(d)) return v;
  return d.toLocaleString(undefined, { year: "numeric", month: "short", day: "2-digit", hour: "2-digit", minute: "2-digit" });
};

// Charge types offered in the Charges & Payment tab's "Add Charge" form.
// `taxable` drives both the Taxable/Non-Taxable badge and which VAT bucket
// the charge falls into in the invoice summary — matching the reference
// design (Parking Fine = Non-Taxable, Late Return Fee = Taxable, etc).
const CHARGE_TYPES = [
  { value: "late_return_fee", label: "Late Return Fee (auto-calculable)", taxable: true },
  { value: "fuel_shortfall", label: "Fuel Shortfall", taxable: true },
  { value: "damage_fee", label: "Damage Fee", taxable: true },
  { value: "cleaning_fee", label: "Cleaning Fee", taxable: true },
  { value: "parking_fine", label: "Parking Fine", taxable: false },
  { value: "traffic_fine", label: "Traffic Fine", taxable: false },
  { value: "other_taxable", label: "Other (Taxable)", taxable: true },
  { value: "other_non_taxable", label: "Other (Non-Taxable)", taxable: false },
];

// Single source of truth for a booking's full invoice picture — used by the
// Bookings table, and the Overview / Pricing Details / Charges & Payment
// tabs, so all three never drift from each other.
//
// Two totals matter here and they are deliberately different things:
//   - `agreementTotal`  — the original signed quote from the New Booking
//     wizard (Rental Vehicle Charge + Delivery + Collection + Additional
//     Driver + Other Charges, then VAT). This is what Pricing Details shows,
//     and per the reference design it never changes after the booking is
//     created.
//   - `finalInvoiceTotal` — the agreement total plus whatever's been added
//     afterward in Charges & Payment (taxable charges pushed back through
//     VAT, non-taxable charges added flat on top). This is the actual amount
//     owed, and what Overview's Payment Summary and the Payments section use
//     for Balance Due.
// Security Deposit is intentionally excluded from both — it's refundable,
// not a rental charge, so it's tracked as its own figure.
const computeBookingInvoice = (b) => {
  const days = (b.start && b.end) ? Math.max(0, Math.round((new Date(b.end) - new Date(b.start)) / 86400000)) : 0;
  const rateCharge = (Number(b.rate) || 0) * days;
  const deliveryCharge = Number(b.deliveryCharge) || 0;
  const collectionCharge = Number(b.collectionCharge) || 0;
  const additionalDriverCharge = Number(b.additionalDriverCharge) || 0;
  const otherCharges = Number(b.otherCharges) || 0;
  const deposit = Number(b.deductible) || 0;
  const vatPct = Number(b.vatRate) || 0;

  const agreementSubtotal = rateCharge + deliveryCharge + collectionCharge + additionalDriverCharge + otherCharges;
  const agreementVatAmount = agreementSubtotal * (vatPct / 100);
  const agreementTotal = agreementSubtotal + agreementVatAmount;

  const charges = b.charges || [];
  const taxableChargesTotal = charges.filter(c => c.taxable).reduce((s, c) => s + (Number(c.amount) || 0), 0);
  const nonTaxableChargesTotal = charges.filter(c => !c.taxable).reduce((s, c) => s + (Number(c.amount) || 0), 0);
  const taxableSubtotal = agreementSubtotal + taxableChargesTotal;
  const finalVatAmount = taxableSubtotal * (vatPct / 100);
  const finalInvoiceTotal = taxableSubtotal + finalVatAmount + nonTaxableChargesTotal;

  // Older bookings only ever had a single amountCollected value from the
  // wizard's Payment step — surface that as the first "payment" if no
  // payments array has been recorded yet, so history is never empty when
  // money has actually changed hands.
  const payments = b.payments || (Number(b.amountCollected) > 0
    ? [{ id: "seed", amount: Number(b.amountCollected), method: b.paymentMethod || "Cash", reference: b.referenceCode || "", addedAt: b.createdAt || null }]
    : []);
  const totalPaid = payments.reduce((s, p) => s + (Number(p.amount) || 0), 0);
  const balanceDue = finalInvoiceTotal - totalPaid;

  return {
    days, rateCharge, deliveryCharge, collectionCharge, additionalDriverCharge, otherCharges, deposit, vatPct,
    agreementSubtotal, agreementVatAmount, agreementTotal,
    charges, taxableChargesTotal, nonTaxableChargesTotal, taxableSubtotal, finalVatAmount, finalInvoiceTotal,
    payments, totalPaid, balanceDue,
  };
};

// "Unpaid"/"Partial"/"Paid" — a second-glance payment status pill shown next
// to the booking's rental-status pill (Active/Upcoming/etc.) in the Detail
// header, same idea as the reference design's "Partial" tag.
const paymentStatus = (paid, total) => {
  if (paid <= 0) return { label: "Unpaid", color: C.red };
  if (paid >= total && total > 0) return { label: "Paid", color: C.teal };
  return { label: "Partial", color: "#d97706" };
};

const BOOKING_DETAIL_TABS = ["Overview", "Pricing Details", "Charges & Payment", "Timeline"];
const FUEL_LEVELS = ["Full", "3/4", "1/2", "1/4", "Empty"];

// Modal wrapper around AvailabilityTimeline — same backdrop + pop pattern used
// elsewhere in the app (see Fleet.jsx's ExpenseDrawer) so it feels consistent.
const TimelineModal = ({ car, bookings, onClose }) => {
  if (!car) return null;
  return (
    <>
      <style>{`
        @keyframes bookingModalFade { from { opacity: 0; } to { opacity: 1; } }
        @keyframes bookingModalPop { from { opacity: 0; transform: translate(-50%, -50%) scale(0.96); } to { opacity: 1; transform: translate(-50%, -50%) scale(1); } }
      `}</style>
      <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(15, 23, 42, 0.22)", zIndex: 60, animation: "bookingModalFade 0.15s ease" }} />
      <div style={{
        position: "fixed", top: "50%", left: "50%", transform: "translate(-50%, -50%)",
        width: "100%", maxWidth: 520, margin: "0 14px", maxHeight: "85vh",
        background: C.surface, zIndex: 61, display: "flex", flexDirection: "column",
        border: `1px solid ${C.border}`, borderRadius: 12,
        boxShadow: "0 16px 40px rgba(15, 23, 42, 0.18)", animation: "bookingModalPop 0.18s cubic-bezier(.2,.8,.2,1)",
        overflow: "hidden",
      }}>
        <div style={{ padding: "10px 14px", display: "flex", justifyContent: "space-between", alignItems: "center", borderBottom: `1px solid ${C.border}` }}>
          <div style={{ fontSize: 13.5, fontWeight: 700, color: C.navy }}>Availability Timeline</div>
          <button onClick={onClose} aria-label="Close" style={{ background: "none", border: "none", fontSize: 14, color: C.textMuted, cursor: "pointer", lineHeight: 1, padding: 4 }}>✕</button>
        </div>
        <div style={{ padding: 14, overflowY: "auto", flex: 1 }}>
          <AvailabilityTimeline car={car} bookings={bookings} />
        </div>
      </div>
    </>
  );
};

const detailSectionLabelStyle = { fontSize: 10.5, fontWeight: 700, color: C.textMuted, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 10 };
const detailFieldLabelStyle = { fontSize: 10, fontWeight: 600, color: C.textMuted, textTransform: "uppercase", letterSpacing: 0.4, marginBottom: 3 };
const detailInputStyle = { width: "100%", padding: "8px 10px", borderRadius: 8, border: `1px solid ${C.border}`, fontSize: 12.5, fontFamily: "inherit", outline: "none", boxSizing: "border-box" };

// Visual identity (icon + accent color) for each activity type shown on the
// Timeline tab. Keys match the `type` values built in buildBookingActivityLog.
const ACTIVITY_META = {
  created: { icon: "🆕", label: "Booking Created", color: C.teal },
  updated: { icon: "✏️", label: "Booking Updated", color: "#f59e0b" },
  charge: { icon: "🧾", label: "Additional Charge Added", color: "#f97316" },
  payment: { icon: "💳", label: "Payment Recorded", color: "#16a34a" },
  returned: { icon: "🔑", label: "Vehicle Returned", color: "#0ea5e9" },
  completed: { icon: "✅", label: "Booking Completed", color: C.teal },
};

// Builds the Timeline tab's activity feed from data already on the booking
// (no separate audit-log store exists yet) — Created/Updated timestamps,
// each charge and payment, the return, and completion. There's no per-action
// user tracking in this build (no real auth — see FleetOpzApp's currentUserRole
// comment), so every entry is attributed to the app's de facto logged-in
// user. Sorted newest-first, which is how the tab renders it.
const buildBookingActivityLog = (booking, inv) => {
  const actor = "Selvakumar (Admin)";
  const events = [];

  if (booking.createdAt) {
    events.push({ type: "created", at: booking.createdAt, by: actor });
  }
  if (booking.updatedAt && booking.updatedAt !== booking.createdAt) {
    events.push({ type: "updated", at: booking.updatedAt, by: actor });
  }
  (inv.charges || []).forEach(c => {
    events.push({ type: "charge", at: c.addedAt, by: actor, detail: `${c.label} · ${fmt(Number(c.amount) || 0)}` });
  });
  (inv.payments || []).forEach(p => {
    events.push({ type: "payment", at: p.addedAt, by: actor, detail: `${fmt(Number(p.amount) || 0)} · ${p.method}` });
  });
  if (booking.returnedAt) {
    events.push({ type: "returned", at: booking.returnedAt, by: actor });
  }
  if (booking.status === "Completed") {
    events.push({ type: "completed", at: booking.completedAt || booking.returnedAt || booking.createdAt, by: actor });
  }

  return events
    .filter(e => !!e.at)
    .sort((a, b) => new Date(b.at) - new Date(a.at));
};

// Clean vertical activity timeline for the Booking Detail modal's Timeline
// tab — icon + label + who + when per entry, latest activity first.
const BookingActivityTimeline = ({ booking, inv }) => {
  const events = buildBookingActivityLog(booking, inv);

  if (events.length === 0) {
    return <div style={{ fontSize: 12.5, color: C.textMuted, padding: "10px 0" }}>No activity recorded yet.</div>;
  }

  return (
    <div>
      {events.map((ev, i) => {
        const meta = ACTIVITY_META[ev.type];
        const isLast = i === events.length - 1;
        return (
          <div key={i} style={{ display: "flex", gap: 14 }}>
            {/* Icon + connecting line */}
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", flexShrink: 0 }}>
              <div style={{
                width: 34, height: 34, borderRadius: "50%", flexShrink: 0,
                display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: 15, background: `${meta.color}1a`, border: `1px solid ${meta.color}44`,
              }}>
                {meta.icon}
              </div>
              {!isLast && <div style={{ width: 2, flex: 1, minHeight: 22, background: C.border, marginTop: 4 }} />}
            </div>

            {/* Content */}
            <div style={{ paddingBottom: isLast ? 0 : 22, flex: 1 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: C.navy }}>{meta.label}</div>
                <div style={{ fontSize: 11, color: C.textMuted, whiteSpace: "nowrap" }}>{formatDateTime(ev.at)}</div>
              </div>
              <div style={{ fontSize: 11.5, color: C.textSec, marginTop: 2 }}>by {ev.by}</div>
              {ev.detail && <div style={{ fontSize: 11.5, color: C.textMuted, marginTop: 2 }}>{ev.detail}</div>}
            </div>
          </div>
        );
      })}
    </div>
  );
};

// Full tabbed Booking Detail view — Overview / Pricing Details / Charges &
// Payment / Timeline. Opens either from clicking "View" on a row in the
// Bookings table, or automatically right after a new booking is created
// (see `detailBookingId` prop on <Booking>).
const BookingDetailModal = ({ booking, bookings, fleet, activeTab, setActiveTab, onClose, onUpdateBooking }) => {
  const [mileageIn, setMileageIn] = useState(booking.mileageIn || "");
  const [fuelIn, setFuelIn] = useState(booking.fuelIn || "Full");
  const [chargeType, setChargeType] = useState(CHARGE_TYPES[0].value);
  const [chargeAmount, setChargeAmount] = useState("");
  const [chargeNote, setChargeNote] = useState("");
  const [paymentAmount, setPaymentAmount] = useState("");
  const [paymentMethod, setPaymentMethod] = useState("Cash");

  if (!booking) return null;
  const car = fleet.find(c => c.plate === booking.plate);
  const inv = computeBookingInvoice(booking);
  const payStatus = paymentStatus(inv.totalPaid, inv.finalInvoiceTotal);
  const alreadyReturned = !!booking.mileageIn || booking.status === "Completed";
  const selectedChargeType = CHARGE_TYPES.find(t => t.value === chargeType) || CHARGE_TYPES[0];

  // Balance Due coloring, per spec: green once fully paid, orange while
  // partially paid, red while nothing's been paid against an outstanding balance.
  const balanceColor = inv.balanceDue <= 0 ? C.teal : inv.totalPaid > 0 ? "#d97706" : C.red;

  const handleMarkReturned = () => {
    if (mileageIn === "" || Number(mileageIn) < 0) {
      alert("Enter a valid Mileage In reading");
      return;
    }
    // forceCompleted mirrors the existing "Mark Done" convention elsewhere in
    // this file, rather than setting status directly — that keeps this in
    // sync with whatever automatic Upcoming/Active/Completed logic already
    // owns booking status.
    onUpdateBooking(booking.id, { mileageIn, fuelIn, forceCompleted: true, returnedAt: new Date().toISOString() });
    alert("Vehicle marked as returned.");
  };

  const handleAddCharge = () => {
    const amt = Number(chargeAmount);
    if (!chargeAmount || amt <= 0) {
      alert("Enter a charge amount greater than 0");
      return;
    }
    const newCharge = {
      id: `${Date.now()}`,
      type: selectedChargeType.value,
      label: selectedChargeType.label.replace(" (auto-calculable)", ""),
      amount: amt,
      note: chargeNote,
      taxable: selectedChargeType.taxable,
      addedAt: new Date().toISOString(),
    };
    onUpdateBooking(booking.id, { charges: [...(booking.charges || []), newCharge] });
    setChargeAmount("");
    setChargeNote("");
  };

  const handleDeleteCharge = (id) => {
    if (!window.confirm("Remove this charge?")) return;
    onUpdateBooking(booking.id, { charges: (booking.charges || []).filter(c => c.id !== id) });
  };

  const handleMarkDepositRefunded = () => {
    if (!window.confirm(`Mark the ${fmt(inv.deposit)} security deposit as refunded?`)) return;
    onUpdateBooking(booking.id, { depositRefunded: true });
  };

  const handleRecordPayment = () => {
    const amt = Number(paymentAmount);
    if (!paymentAmount || amt <= 0) {
      alert("Enter a payment amount greater than 0");
      return;
    }
    const newPayment = { id: `${Date.now()}`, amount: amt, method: paymentMethod, addedAt: new Date().toISOString() };
    onUpdateBooking(booking.id, { payments: [...inv.payments, newPayment] });
    setPaymentAmount("");
  };

  return (
    <>
      <style>{`
        @keyframes bookingDetailFade { from { opacity: 0; } to { opacity: 1; } }
        @keyframes bookingDetailPop { from { opacity: 0; transform: translate(-50%, -50%) scale(0.97); } to { opacity: 1; transform: translate(-50%, -50%) scale(1); } }
      `}</style>
      <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(15, 23, 42, 0.35)", zIndex: 200, animation: "bookingDetailFade 0.15s ease" }} />
      <div style={{
        position: "fixed", top: "50%", left: "50%", transform: "translate(-50%, -50%)",
        width: "94vw", maxWidth: 900, height: "90vh", maxHeight: 900,
        background: C.surface, zIndex: 201, display: "flex", flexDirection: "column",
        border: `1px solid ${C.border}`, borderRadius: 14,
        boxShadow: "0 24px 60px rgba(15, 23, 42, 0.25)", animation: "bookingDetailPop 0.18s cubic-bezier(.2,.8,.2,1)",
        overflow: "hidden",
      }}>
        {/* Header */}
        <div style={{ padding: "16px 22px 0", borderBottom: `1px solid ${C.border}`, flexShrink: 0 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                <span style={{ ...mono, fontSize: 15, fontWeight: 700, color: C.navy }}>{booking.id}</span>
                <StatusTag status={booking.status} />
                <span style={{
                  fontSize: 10.5, fontWeight: 700, padding: "3px 9px", borderRadius: 999,
                  border: `1px solid ${payStatus.color}`, color: payStatus.color, background: "#fff",
                }}>{payStatus.label}</span>
              </div>
              <div style={{ fontSize: 12, color: C.textMuted }}>{booking.customer} · {booking.plate}</div>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              {/* Agreement is only ever reachable from an already-created booking's
                  Detail view, so this condition is trivially true today — kept
                  explicit in case Agreement is ever surfaced somewhere pre-creation
                  (e.g. a wizard preview) later. */}
              <Btn
                disabled={!booking?.id}
                onClick={() => {
                  if (!booking?.id) return;
                  alert("Agreement PDF — coming soon");
                }}
              >📄 Agreement</Btn>
              {/* Invoice reflects the final amount owed (rental + any charges
                  added after return), so it only makes sense once the vehicle
                  has actually come back — same `alreadyReturned` flag the
                  Overview tab's "Mark as Returned" section uses. */}
              <Btn
                disabled={!alreadyReturned}
                title={!alreadyReturned ? "Available once the vehicle has been marked as returned" : undefined}
                onClick={() => {
                  if (!alreadyReturned) return;
                  generateInvoicePdf(booking, car, inv);
                }}
              >🧾 Invoice</Btn>
              <button onClick={onClose} aria-label="Close" style={{ background: "none", border: "none", fontSize: 18, color: C.textMuted, cursor: "pointer", lineHeight: 1, padding: 4 }}>✕</button>
            </div>
          </div>

          {/* Tabs */}
          <div style={{ display: "flex", gap: 18, marginTop: 14, overflowX: "auto" }}>
            {BOOKING_DETAIL_TABS.map(tab => (
              <button key={tab} onClick={() => setActiveTab(tab)} style={{
                background: "none", border: "none", cursor: "pointer", fontFamily: "inherit",
                padding: "0 0 10px", fontSize: 12.5, fontWeight: 600, whiteSpace: "nowrap",
                color: activeTab === tab ? C.teal : C.textMuted,
                borderBottom: activeTab === tab ? `2px solid ${C.teal}` : "2px solid transparent",
              }}>{tab}</button>
            ))}
          </div>
        </div>

        {/* Body */}
        <div style={{ padding: "20px 22px", overflowY: "auto", flex: 1 }}>
          {activeTab === "Overview" ? (
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
              {/* Rental Summary */}
              <div style={{ border: `1px solid ${C.border}`, borderRadius: 10, padding: "14px 16px", background: C.bg }}>
                <div style={detailSectionLabelStyle}>Rental Summary</div>
                {[
                  { label: "Booking ID", value: booking.id },
                  { label: "Booking Status", value: booking.status },
                  { label: "Rental Period", value: `${formatDateTime(booking.start)} → ${formatDateTime(booking.end)}` },
                  { label: "Pickup Date & Time", value: formatDateTime(booking.start) || "—" },
                  { label: "Return Date & Time", value: formatDateTime(booking.end) || "—" },
                  { label: "Total Rental Days", value: `${inv.days} Day${inv.days === 1 ? "" : "s"}` },
                ].map(row => (
                  <div key={row.label} style={{ display: "flex", justifyContent: "space-between", gap: 10, padding: "4px 0", fontSize: 12 }}>
                    <span style={{ color: C.textMuted }}>{row.label}</span>
                    <span style={{ color: C.navy, fontWeight: 600, textAlign: "right" }}>{row.value}</span>
                  </div>
                ))}
              </div>

              {/* Payment Summary */}
              <div style={{ border: `1px solid ${C.border}`, borderRadius: 10, padding: "14px 16px", background: C.bg }}>
                <div style={detailSectionLabelStyle}>Payment Summary</div>
                {[
                  { label: "Grand Total", value: inv.finalInvoiceTotal, color: C.navy },
                  { label: "Total Paid", value: inv.totalPaid, color: C.teal },
                  { label: "Balance Due", value: inv.balanceDue, color: balanceColor },
                ].map(row => (
                  <div key={row.label} style={{ display: "flex", justifyContent: "space-between", padding: "5px 0", fontSize: 12.5 }}>
                    <span style={{ color: C.textSec }}>{row.label}</span>
                    <span style={{ fontWeight: 700, color: row.color, textAlign: "right", ...mono }}>{fmt(row.value)}</span>
                  </div>
                ))}
              </div>

              {/* Customer Summary */}
              <div style={{ border: `1px solid ${C.border}`, borderRadius: 10, padding: "14px 16px", background: C.bg }}>
                <div style={detailSectionLabelStyle}>Customer Summary</div>
                {[
                  { label: "Customer Name", value: booking.customer || "—" },
                  { label: "Driving License No.", value: booking.license || "—" },
                  { label: "Phone Number", value: booking.contact || "—" },
                ].map(row => (
                  <div key={row.label} style={{ display: "flex", justifyContent: "space-between", gap: 10, padding: "4px 0", fontSize: 12 }}>
                    <span style={{ color: C.textMuted }}>{row.label}</span>
                    <span style={{ color: C.navy, fontWeight: 600, textAlign: "right" }}>{row.value}</span>
                  </div>
                ))}
              </div>

              {/* Vehicle Summary */}
              <div style={{ border: `1px solid ${C.border}`, borderRadius: 10, padding: "14px 16px", background: C.bg }}>
                <div style={detailSectionLabelStyle}>Vehicle Summary</div>
                {[
                  { label: "Vehicle Name", value: car?.model || booking.plate || "—" },
                  { label: "Registration Number", value: booking.plate || "—" },
                  { label: "Daily Rate", value: fmt(Number(booking.rate) || 0) },
                  { label: "Current Odometer", value: booking.mileageIn || booking.mileageOut || "—" },
                ].map(row => (
                  <div key={row.label} style={{ display: "flex", justifyContent: "space-between", gap: 10, padding: "4px 0", fontSize: 12 }}>
                    <span style={{ color: C.textMuted }}>{row.label}</span>
                    <span style={{ color: C.navy, fontWeight: 600, textAlign: "right", ...mono }}>{row.value}</span>
                  </div>
                ))}
              </div>

              {/* Vehicle Return — spans both columns */}
              <div style={{ gridColumn: "1 / -1", border: `1px solid ${C.border}`, borderRadius: 10, padding: "14px 16px" }}>
                <div style={detailSectionLabelStyle}>Vehicle Return</div>
                {alreadyReturned ? (
                  <div style={{ fontSize: 12.5, color: C.textSec }}>
                    ✅ Returned — Mileage In {booking.mileageIn || mileageIn} km · Fuel In {booking.fuelIn || fuelIn}
                  </div>
                ) : (
                  <div style={{ display: "flex", gap: 12, alignItems: "flex-end", flexWrap: "wrap" }}>
                    <div style={{ flex: "1 1 160px" }}>
                      <div style={detailFieldLabelStyle}>Mileage In (km)</div>
                      <input type="number" min="0" value={mileageIn} onChange={(e) => setMileageIn(e.target.value)} placeholder="e.g., 9450" style={detailInputStyle} />
                    </div>
                    <div style={{ flex: "1 1 140px" }}>
                      <div style={detailFieldLabelStyle}>Fuel In</div>
                      <select value={fuelIn} onChange={(e) => setFuelIn(e.target.value)} style={detailInputStyle}>
                        {FUEL_LEVELS.map(f => <option key={f} value={f}>{f}</option>)}
                      </select>
                    </div>
                    <Btn primary onClick={handleMarkReturned}>Mark Vehicle Returned</Btn>
                  </div>
                )}
              </div>

              {/* Completion Summary — full financial close-out, shown only once the rental is done */}
              {booking.status === "Completed" && (
                <div style={{ gridColumn: "1 / -1", border: `1px solid ${C.border}`, borderRadius: 10, padding: "14px 16px", background: C.bg }}>
                  <div style={detailSectionLabelStyle}>Completion Summary</div>
                  {[
                    { label: "Rental Charges", value: fmt(inv.agreementTotal) },
                    { label: "Additional Charges", value: fmt(inv.taxableChargesTotal + inv.nonTaxableChargesTotal) },
                    { label: "Payments Received", value: fmt(inv.totalPaid) },
                  ].map(row => (
                    <div key={row.label} style={{ display: "flex", justifyContent: "space-between", padding: "4px 0", fontSize: 12.5, color: C.textSec }}>
                      <span>{row.label}</span>
                      <span style={{ textAlign: "right", ...mono }}>{row.value}</span>
                    </div>
                  ))}
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "4px 0", fontSize: 12.5, color: C.textSec }}>
                    <span>Security Deposit</span>
                    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                      <span style={{ ...mono }}>{fmt(inv.deposit)} — {booking.depositRefunded ? "Refunded" : "Held"}</span>
                      {inv.deposit > 0 && !booking.depositRefunded && (
                        <button onClick={handleMarkDepositRefunded} style={{ fontSize: 11, fontWeight: 600, color: C.teal, background: "none", border: `1px solid ${C.teal}`, borderRadius: 6, padding: "3px 8px", cursor: "pointer" }}>
                          Mark Refunded
                        </button>
                      )}
                    </div>
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between", marginTop: 8, paddingTop: 10, borderTop: `1px solid ${C.border}` }}>
                    <span style={{ fontSize: 13, fontWeight: 700, color: C.navy }}>Outstanding Balance</span>
                    <span style={{ fontSize: 13, fontWeight: 700, color: balanceColor, textAlign: "right", ...mono }}>{fmt(inv.balanceDue)}</span>
                  </div>
                </div>
              )}
            </div>
          ) : activeTab === "Pricing Details" ? (
            <div style={{ border: `1px solid ${C.border}`, borderRadius: 10, padding: "16px 18px", background: C.bg, maxWidth: 480 }}>
              {[
                { label: "Rental Vehicle Charge", value: inv.rateCharge },
                { label: "Delivery Charge", value: inv.deliveryCharge },
                { label: "Collection Charge", value: inv.collectionCharge },
                { label: "Additional Driver Charge", value: inv.additionalDriverCharge },
                { label: "Other Charges", value: inv.otherCharges },
              ].filter(row => row.value > 0).map(row => (
                <div key={row.label} style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", fontSize: 12.5, color: C.textSec }}>
                  <span>{row.label}</span>
                  <span style={{ textAlign: "right", ...mono }}>{fmt(row.value)}</span>
                </div>
              ))}
              <div style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", marginTop: 4, paddingTop: 10, borderTop: `1px solid ${C.border}`, fontSize: 12.5, color: C.textSec }}>
                <span>Subtotal</span>
                <span style={{ textAlign: "right", ...mono }}>{fmt(inv.agreementSubtotal)}</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", fontSize: 12.5, color: C.textSec }}>
                <span>VAT ({inv.vatPct || 0}%)</span>
                <span style={{ textAlign: "right", ...mono }}>{fmt(inv.agreementVatAmount)}</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", marginTop: 8, paddingTop: 10, borderTop: `1px solid ${C.border}` }}>
                <span style={{ fontSize: 13.5, fontWeight: 700, color: C.navy }}>Grand Total</span>
                <span style={{ fontSize: 13.5, fontWeight: 700, color: C.teal, textAlign: "right", ...mono }}>{fmt(inv.agreementTotal)}</span>
              </div>
            </div>
          ) : activeTab === "Charges & Payment" ? (
            <>
              {/* Additional Charges */}
              <div style={{ fontSize: 11.5, color: C.textMuted, marginBottom: 14 }}>
                Added after return — flows into the Invoice only. The signed Agreement total never changes.
              </div>

              <div style={{ border: `1px solid ${C.border}`, borderRadius: 10, padding: "16px 18px", marginBottom: 16 }}>
                <div style={{ fontSize: 12.5, fontWeight: 700, color: C.navy, marginBottom: 12 }}>+ Add Charge</div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr auto", gap: 12, alignItems: "end", marginBottom: 10 }}>
                  <div>
                    <div style={detailFieldLabelStyle}>Charge Type</div>
                    <select value={chargeType} onChange={(e) => setChargeType(e.target.value)} style={detailInputStyle}>
                      {CHARGE_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                    </select>
                  </div>
                  <div>
                    <div style={detailFieldLabelStyle}>Amount</div>
                    <input type="number" min="0" value={chargeAmount} onChange={(e) => setChargeAmount(e.target.value)} placeholder="0.00" style={detailInputStyle} />
                  </div>
                  <Btn primary onClick={handleAddCharge}>+ Add</Btn>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "end", gap: 12 }}>
                  <div style={{ flex: 1 }}>
                    <div style={detailFieldLabelStyle}>Note (optional)</div>
                    <input type="text" value={chargeNote} onChange={(e) => setChargeNote(e.target.value)} placeholder="e.g., 2 hours late, or fine reference #" style={detailInputStyle} />
                  </div>
                  <div style={{ fontSize: 11, color: C.textMuted, whiteSpace: "nowrap", paddingBottom: 8 }}>
                    {selectedChargeType.taxable ? "Taxable — VAT applies" : "Non-Taxable"}
                  </div>
                </div>
              </div>

              {inv.charges.map(c => (
                <div key={c.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", border: `1px solid ${C.border}`, borderRadius: 10, padding: "12px 16px", marginBottom: 10 }}>
                  <div>
                    <div style={{ fontSize: 12.5, fontWeight: 600, color: C.navy, display: "flex", alignItems: "center", gap: 8 }}>
                      {c.label} — {fmt(Number(c.amount) || 0)}
                      <span style={{
                        fontSize: 9.5, fontWeight: 700, padding: "2px 7px", borderRadius: 999,
                        background: C.bg, color: c.taxable ? C.navy : C.textMuted, border: `1px solid ${C.border}`,
                      }}>{c.taxable ? "Taxable" : "Non-Taxable"}</span>
                    </div>
                    <div style={{ fontSize: 11, color: C.textMuted, marginTop: 2 }}>
                      {c.note ? `${c.note} · ` : ""}{c.addedAt ? formatDateTime(c.addedAt) : ""}
                    </div>
                  </div>
                  <button onClick={() => handleDeleteCharge(c.id)} style={{ background: "none", border: "none", color: C.red, cursor: "pointer", fontSize: 15 }} aria-label="Delete charge">🗑</button>
                </div>
              ))}

              <div style={{ border: `1px solid ${C.border}`, borderRadius: 10, padding: "16px 18px", background: C.bg, marginBottom: 24 }}>
                {[
                  { label: "Agreement Subtotal", value: inv.agreementSubtotal },
                  { label: "+ Additional Taxable Charges", value: inv.taxableChargesTotal },
                ].map(row => (
                  <div key={row.label} style={{ display: "flex", justifyContent: "space-between", padding: "4px 0", fontSize: 12.5, color: C.textSec }}>
                    <span>{row.label}</span>
                    <span style={{ textAlign: "right", ...mono }}>{fmt(row.value)}</span>
                  </div>
                ))}
                <div style={{ display: "flex", justifyContent: "space-between", padding: "4px 0", marginTop: 4, paddingTop: 8, borderTop: `1px solid ${C.border}`, fontSize: 12.5, fontWeight: 700, color: C.navy }}>
                  <span>Taxable Subtotal</span>
                  <span style={{ textAlign: "right", ...mono }}>{fmt(inv.taxableSubtotal)}</span>
                </div>
                {[
                  { label: `VAT (${inv.vatPct || 0}%)`, value: inv.finalVatAmount },
                  { label: "Non-Taxable Charges", value: inv.nonTaxableChargesTotal },
                ].map(row => (
                  <div key={row.label} style={{ display: "flex", justifyContent: "space-between", padding: "4px 0", fontSize: 12.5, color: C.textSec }}>
                    <span>{row.label}</span>
                    <span style={{ textAlign: "right", ...mono }}>{fmt(row.value)}</span>
                  </div>
                ))}
                <div style={{ display: "flex", justifyContent: "space-between", marginTop: 8, paddingTop: 10, borderTop: `1px solid ${C.border}` }}>
                  <span style={{ fontSize: 13.5, fontWeight: 700, color: C.navy }}>Final Invoice Total</span>
                  <span style={{ fontSize: 13.5, fontWeight: 700, color: C.teal, textAlign: "right", ...mono }}>{fmt(inv.finalInvoiceTotal)}</span>
                </div>
              </div>

              {/* Payments */}
              <div style={{ fontSize: 12.5, fontWeight: 700, color: C.navy, marginBottom: 12 }}>Payments</div>

              <div style={{ border: `1px solid ${C.border}`, borderRadius: 10, padding: "14px 16px", background: C.bg, marginBottom: 14 }}>
                <div style={{ display: "flex", justifyContent: "space-between", padding: "4px 0", fontSize: 12.5, color: C.textSec }}>
                  <span>Invoice Total</span>
                  <span style={{ textAlign: "right", ...mono }}>{fmt(inv.finalInvoiceTotal)}</span>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", padding: "4px 0", fontSize: 12.5, color: C.textSec }}>
                  <span>Total Paid</span>
                  <span style={{ textAlign: "right", ...mono }}>{fmt(inv.totalPaid)}</span>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", padding: "4px 0", fontSize: 12.5, color: C.textMuted }}>
                  <span>Security Deposit (refundable, held separately)</span>
                  <span style={{ textAlign: "right", ...mono }}>{fmt(inv.deposit)}</span>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", marginTop: 6, paddingTop: 8, borderTop: `1px solid ${C.border}` }}>
                  <span style={{ fontSize: 13, fontWeight: 700, color: C.navy }}>Balance Due</span>
                  <span style={{ fontSize: 13, fontWeight: 700, color: balanceColor, textAlign: "right", ...mono }}>{fmt(inv.balanceDue)}</span>
                </div>
              </div>

              {inv.payments.length > 0 && (
                <div style={{ marginBottom: 14 }}>
                  {inv.payments.map(p => (
                    <div key={p.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", border: `1px solid ${C.border}`, borderRadius: 10, padding: "10px 16px", marginBottom: 8 }}>
                      <div style={{ fontSize: 12.5, fontWeight: 600, color: C.navy }}>{fmt(Number(p.amount) || 0)} · {p.method}</div>
                      <div style={{ fontSize: 11, color: C.textMuted }}>{p.addedAt ? formatDateTime(p.addedAt) : ""}</div>
                    </div>
                  ))}
                </div>
              )}

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr auto", gap: 12, alignItems: "end" }}>
                <div>
                  <div style={detailFieldLabelStyle}>Amount</div>
                  <input type="number" min="0" value={paymentAmount} onChange={(e) => setPaymentAmount(e.target.value)} placeholder="0.00" style={detailInputStyle} />
                </div>
                <div>
                  <div style={detailFieldLabelStyle}>Payment Method</div>
                  <select value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value)} style={detailInputStyle}>
                    <option value="Cash">Cash</option>
                    <option value="Card">Card</option>
                    <option value="Bank Transfer">Bank Transfer</option>
                    <option value="Online">Online</option>
                  </select>
                </div>
                <Btn primary onClick={handleRecordPayment}>+ Record Payment</Btn>
              </div>
            </>
          ) : (
            <BookingActivityTimeline booking={booking} inv={inv} />
          )}
        </div>
      </div>
    </>
  );
};

const Booking = ({ bookings = [], fleet = [], onNewBooking, onAddBooking, onUpdateBooking, onDeleteBooking, detailBookingId, onDetailBookingIdHandled }) => {
  const [filter, setFilter] = useState("All");
  const [timelinePlate, setTimelinePlate] = useState(null);
  const [openDetailId, setOpenDetailId] = useState(null);
  const [activeDetailTab, setActiveDetailTab] = useState("Overview");
  const prevCountRef = useRef(bookings.length);

  // Auto-open the Booking Detail modal right after a new booking is created
  // elsewhere (the New Booking wizard, in FleetOpzApp) — it sets
  // `detailBookingId` to the new booking's id, this opens Overview for it,
  // then immediately hands control back so the same id doesn't re-trigger.
  useEffect(() => {
    if (detailBookingId) {
      setOpenDetailId(detailBookingId);
      setActiveDetailTab("Overview");
      onDetailBookingIdHandled?.();
    }
  }, [detailBookingId]);

  // A newly created booking is always visible under "All" — but if the previous filter tab
  // was e.g. "Completed" or "Upcoming", a fresh "Active" booking just silently doesn't match
  // it, and looks like it "disappeared". Snap back to "All" whenever the list grows.
  useEffect(() => {
    if (bookings.length > prevCountRef.current) {
      setFilter("All");
    }
    prevCountRef.current = bookings.length;
  }, [bookings.length]);

  const statuses = ["All", "Active", "Upcoming", "Ending Today", "Completed"];
  const filtered = filter === "All" ? bookings : bookings.filter(b => b.status === filter);
  const timelineCar = timelinePlate ? fleet.find(c => c.plate === timelinePlate) : null;
  const openDetailBooking = openDetailId ? bookings.find(b => b.id === openDetailId) : null;

  const handleDelete = (bookingId) => {
    if (window.confirm("Are you sure you want to delete this booking?")) {
      onDeleteBooking(bookingId);
    }
  };

  // "Mark Done" force-completes a booking early (e.g. the customer returned
  // the car ahead of schedule) — this is the one manual booking action the
  // workflow allows; everything else (Upcoming → Active → Ending Today →
  // Completed) happens automatically from the dates. Once the car has
  // actually moved into Maintenance off the back of this, undoing it no
  // longer makes sense in the real world, so "Mark Active" only appears in
  // the brief window before that's happened.
  const handleToggleComplete = (b) => {
    if (b.status === "Completed") {
      if (b.maintenanceTriggered) return; // car's already gone to Maintenance — no undo
      onUpdateBooking(b.id, { forceCompleted: false });
    } else {
      onUpdateBooking(b.id, { forceCompleted: true });
    }
  };

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <div>
          <div style={{ fontSize: 15, fontWeight: 700, color: C.navy }}>Bookings</div>
          <div style={{ fontSize: 11, color: C.textMuted }}>{bookings.length} total bookings</div>
        </div>
        <Btn primary onClick={onNewBooking}>＋ New Booking</Btn>
      </div>

      {/* Filter tabs */}
      <div style={{ display: "flex", gap: 6, marginBottom: 16 }}>
        {statuses.map(s => (
          <button key={s} onClick={() => setFilter(s)} style={{
            padding: "6px 14px", borderRadius: 8, fontSize: 12, fontWeight: 600,
            cursor: "pointer", border: `1px solid ${filter === s ? C.teal : C.border}`,
            background: filter === s ? C.teal : C.surface,
            color: filter === s ? "#fff" : C.textSec, fontFamily: "inherit",
          }}>{s}</button>
        ))}
      </div>

      <Card>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ background: C.bg }}>
              {["Booking ID", "Car", "Customer", "IC / Passport", "Contact", "Rental Period", "Days", "Rate", "Total", "Pickup", "Status", "Actions"].map(h => (
                <th key={h} style={{ textAlign: "left", padding: "9px 12px", fontSize: 10, fontWeight: 600, color: C.textMuted, textTransform: "uppercase", letterSpacing: 0.5, borderBottom: `1px solid ${C.border}`, whiteSpace: "nowrap" }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.map(b => {
              const { days, agreementTotal: total } = computeBookingInvoice(b);
              return (
                <tr key={b.id}
                  onClick={() => setTimelinePlate(b.plate)}
                  onMouseEnter={(e) => e.currentTarget.style.background = C.bg}
                  onMouseLeave={(e) => e.currentTarget.style.background = "transparent"}
                  style={{ borderBottom: `1px solid ${C.border}`, cursor: "pointer", background: "transparent", transition: "background 0.12s" }}>
                  <td style={{ padding: "11px 12px", ...mono, fontSize: 11, fontWeight: 700, color: C.navyMid }}>{b.id}</td>
                  <td style={{ padding: "11px 12px" }}><PlateBadge plate={b.plate} small /></td>
                  <td style={{ padding: "11px 12px", fontSize: 12, fontWeight: 600 }}>{b.customer}</td>
                  <td style={{ padding: "11px 12px", ...mono, fontSize: 10, color: C.textMuted }}>{b.ic}</td>
              
                  <td style={{ padding: "11px 12px", fontSize: 11, color: C.textSec }}>{b.contact}</td>
                  <td style={{ padding: "11px 12px", fontSize: 11, color: C.textSec, whiteSpace: "nowrap" }}>{formatDateTime(b.start)} → {formatDateTime(b.end)}</td>
                  <td style={{ padding: "11px 12px", ...mono, fontSize: 11, textAlign: "center" }}>{days}</td>
                  <td style={{ padding: "11px 12px", ...mono, fontSize: 11 }}>AED {b.rate}/d</td>
                  <td style={{ padding: "11px 12px", ...mono, fontSize: 12, fontWeight: 700, color: C.teal }}>{fmt(total)}</td>
                  <td style={{ padding: "11px 12px", fontSize: 11, color: C.textMuted }}>{b.pickup}</td>
                  <td style={{ padding: "11px 12px" }}><StatusTag status={b.status} /></td>
                  <td style={{ padding: "11px 12px", display: "flex", gap: 6 }} onClick={(e) => e.stopPropagation()}>
                    <button onClick={() => { setOpenDetailId(b.id); setActiveDetailTab("Overview"); }}
                      style={{ padding: "4px 8px", fontSize: 10, background: "none", border: "none", color: C.teal, cursor: "pointer", fontWeight: 600 }}>
                      View
                    </button>
                    <button onClick={() => handleDelete(b.id)}
                      style={{ padding: "4px 8px", fontSize: 10, background: "none", border: "none", color: C.red, cursor: "pointer", fontWeight: 600 }}>
                      Delete
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {filtered.length === 0 && (
          <div style={{ padding: 40, textAlign: "center", color: C.textMuted, fontSize: 13 }}>No bookings with status "{filter}"</div>
        )}
      </Card>

      {timelineCar && (
        <TimelineModal car={timelineCar} bookings={bookings} onClose={() => setTimelinePlate(null)} />
      )}

      {openDetailBooking && (
        <BookingDetailModal
          booking={openDetailBooking}
          bookings={bookings}
          fleet={fleet}
          activeTab={activeDetailTab}
          setActiveTab={setActiveDetailTab}
          onClose={() => setOpenDetailId(null)}
          onUpdateBooking={onUpdateBooking}
        />
      )}
    </div>
  );
};

export default Booking;