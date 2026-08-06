import { useState, useEffect, useMemo, useRef } from "react";
import { C, mono, fmt } from "./theme";
import { Card, Btn, StatusTag, PlateBadge } from "./components";
import { STATUS_PILL_COLORS, STATUS_PILL_FAINT } from "./Fleet";

// Booking-status colors for the status filter pills below — reuses Fleet's
// STATUS_PILL_COLORS/STATUS_PILL_FAINT (Upcoming, Ending Today, etc. already
// match 1:1) and adds the two booking-only statuses Fleet doesn't have.
const BOOKING_STATUS_COLORS = { ...STATUS_PILL_COLORS, Active: C.teal, Completed: C.green, Closed: C.navy };
const getBookingStatusPillColor = (status) => BOOKING_STATUS_COLORS[status] || C.navy;
import { computeCarAvailabilityTimeline, isBookingClosedOut } from "./useFleetData";
import { generateInvoicePdf } from "./invoicePdf";
import { generateRentalAgreementPdf } from "./rentalAgreement";


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

// Vehicle Handover is tracked by its own timestamp (handoverAt), separate
// from the Upcoming/Active/Ending Today/Completed status pill above — that
// pill is derived purely from dates elsewhere (useFleetData.js) and flips to
// Active on the pickup date/time regardless of whether handover actually
// happened. handoverAt is what actually gates the Rental Agreement and the
// Starting Mileage/Fuel/Condition capture, so it's checked directly rather
// than trying to read handover state off the status label.
const hasHandedOver = (b) => !!b.handoverAt;
// True once the pickup date/time has arrived but handover still hasn't
// happened — used to surface an "Awaiting Handover" flag so staff notice
// the status pill already reads Active even though the rental hasn't
// actually been handed over (no Agreement, no mileage/fuel on file yet).
const isAwaitingHandover = (b) => !hasHandedOver(b) && b.start && new Date() >= new Date(b.start) && !isBookingClosedOut(b.status);

// Charge types for itemized post-return charges (Pricing & Payment tab's
// Additional Charges — origin: "return" in computeBookingInvoice below).
// Not currently used by the New Booking wizard (FleetOpzApp.jsx), which only
// has the 4 plain fixed charge fields (Delivery/Collection/Additional
// Driver/Other). `taxable` drives both the Taxable/Non-Taxable badge and
// which VAT bucket the charge falls into in the invoice summary — matching
// the reference design (Parking Fine = Non-Taxable, Fuel Shortfall = Taxable, etc).
export const CHARGE_TYPES = [
  { value: "fuel_shortfall", label: "Fuel Shortfall", taxable: true },
  { value: "damage_fee", label: "Damage Fee", taxable: true },
  { value: "cleaning_fee", label: "Cleaning Fee", taxable: true },
  { value: "parking_fine", label: "Parking Fine", taxable: false },
  { value: "traffic_fine", label: "Traffic Fine", taxable: false },
  { value: "other_taxable", label: "Other (Taxable)", taxable: true },
  { value: "other_non_taxable", label: "Other (Non-Taxable)", taxable: false },
];

// Single source of truth for a booking's full invoice picture — used by the
// Bookings table, and the Overview / Pricing & Payment tabs, so both never
// drift from each other.
//
// Two totals matter here and they are deliberately different things:
//   - `agreementTotal`  — the signed quote: Rental Vehicle Charge + Delivery
//     + Collection + Additional Driver + Other Charges + any itemized
//     charges added in the New Booking wizard's Pricing & Charges step
//     (origin: "booking"), then VAT. This is what Pricing & Payment's
//     Pricing Summary section shows, and it never changes after the booking
//     is created — everything in it was itemized before the agreement was signed.
//   - `finalInvoiceTotal` — the agreement total plus whatever's been added
//     afterward in Pricing & Payment (origin: "return" — taxable charges
//     pushed back through VAT, non-taxable charges added flat on top). This
//     is the actual amount owed, and what Overview's Payment Summary and the
//     Payments section use for Balance Due.
// Security Deposit is intentionally excluded from both — it's refundable,
// not a rental charge, so it's tracked as its own figure.
const computeBookingInvoice = (b) => {
  // Once a vehicle is actually returned, actualReturnAt reflects when it
  // really came back (early or late) — the invoice should bill for that,
  // not the originally planned end date/time.
  const effectiveEnd = b.actualReturnAt || b.end;
  const days = (b.start && effectiveEnd) ? Math.max(0, Math.round((new Date(effectiveEnd) - new Date(b.start)) / 86400000)) : 0;
  const rateCharge = (Number(b.rate) || 0) * days;
  const deliveryCharge = Number(b.deliveryCharge) || 0;
  const collectionCharge = Number(b.collectionCharge) || 0;
  const additionalDriverCharge = Number(b.additionalDriverCharge) || 0;
  const otherCharges = Number(b.otherCharges) || 0;
  const deposit = Number(b.deductible) || 0;
  const vatPct = Number(b.vatRate) || 0;

  // Charges are split by when they were itemized. `origin: "booking"` ones
  // came from the New Booking wizard's Pricing & Charges step — they're part
  // of what's signed, so they're baked into the Agreement Total below right
  // alongside the 4 fixed fields. Everything else (added later, in Charges &
  // Payment after return) keeps only ever affecting the Final Invoice Total,
  // never the Agreement Total — same behavior as before this split existed.
  const charges = b.charges || [];
  const bookingCharges = charges.filter(c => c.origin === "booking");
  const postCharges = charges.filter(c => c.origin !== "booking");

  const bookingChargesTaxableTotal = bookingCharges.filter(c => c.taxable).reduce((s, c) => s + (Number(c.amount) || 0), 0);
  const bookingChargesNonTaxableTotal = bookingCharges.filter(c => !c.taxable).reduce((s, c) => s + (Number(c.amount) || 0), 0);

  const fixedChargesSubtotal = rateCharge + deliveryCharge + collectionCharge + additionalDriverCharge + otherCharges;
  // Taxable base for the signed Agreement Total: fixed fields + taxable
  // booking-time charges go through VAT together; non-taxable booking-time
  // charges are added flat on top, same treatment postCharges get below.
  const agreementTaxableBase = fixedChargesSubtotal + bookingChargesTaxableTotal;
  const agreementVatAmount = agreementTaxableBase * (vatPct / 100);
  const agreementSubtotal = fixedChargesSubtotal + bookingChargesTaxableTotal + bookingChargesNonTaxableTotal;
  const agreementTotal = agreementTaxableBase + agreementVatAmount + bookingChargesNonTaxableTotal;

  const taxableChargesTotal = postCharges.filter(c => c.taxable).reduce((s, c) => s + (Number(c.amount) || 0), 0);
  const nonTaxableChargesTotal = postCharges.filter(c => !c.taxable).reduce((s, c) => s + (Number(c.amount) || 0), 0);
  const taxableSubtotal = agreementTaxableBase + taxableChargesTotal;
  const finalVatAmount = taxableSubtotal * (vatPct / 100);
  const finalInvoiceTotal = taxableSubtotal + finalVatAmount + bookingChargesNonTaxableTotal + nonTaxableChargesTotal;

  // `payments` is the single source of truth for money received on this
  // booking, and it's built explicitly — with "Amount Collected Now"
  // already included as its first entry — the moment the booking is
  // created (see FleetOpzApp.jsx's handleSubmitBooking). Recording a
  // payment later in Pricing & Payment simply appends to this same array,
  // so there's never a separate seeding step here that could double up
  // with a manually recorded payment.
  // The fallback below exists only for bookings created before `payments`
  // existed as a field — it never fires for a booking that already has a
  // `payments` array (even an empty one), so it can't create a duplicate.
  const payments = b.payments || (Number(b.amountCollected) > 0
    ? [{ id: "legacy-seed", amount: Number(b.amountCollected), method: b.paymentMethod || "Cash", reference: b.referenceCode || "", addedAt: b.amountCollectedAt || b.createdAt || null }]
    : []);
  const totalPaid = payments.reduce((s, p) => s + (Number(p.amount) || 0), 0);
  // Balance Due must never go negative — once payments cover the invoice in
  // full, it stops at 0. handleRecordPayment blocks overpayment at entry so
  // totalPaid should never legitimately exceed finalInvoiceTotal; this clamp
  // is just a safety net (e.g. for pre-existing/legacy data).
  // Security Deposit (`deposit`, above) is intentionally never added into
  // totalPaid or balanceDue — it's refundable and tracked as its own figure,
  // never part of what's "owed" on the rental invoice.
  const balanceDue = Math.max(0, finalInvoiceTotal - totalPaid);

  return {
    days, rateCharge, deliveryCharge, collectionCharge, additionalDriverCharge, otherCharges, deposit, vatPct,
    agreementSubtotal, agreementVatAmount, agreementTotal,
    charges, bookingCharges, postCharges,
    taxableChargesTotal, nonTaxableChargesTotal, taxableSubtotal, finalVatAmount, finalInvoiceTotal,
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

const BOOKING_DETAIL_TABS = ["Overview", "Pricing & Payment", "Timeline"];
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

const detailFieldLabelStyle = { fontSize: 10, fontWeight: 600, color: C.textMuted, textTransform: "uppercase", letterSpacing: 0.4, marginBottom: 3 };
const detailInputStyle = { width: "100%", padding: "8px 10px", borderRadius: 8, border: `1px solid ${C.border}`, fontSize: 12.5, fontFamily: "inherit", outline: "none", boxSizing: "border-box" };

// Section heading used across the Booking Detail modal — plain bold title,
// no badge/number. Styles only the heading itself; the section's
// content/cards below it are untouched. `size` lets the tighter two-column
// Pricing & Payment layout use a slightly smaller heading.
const SectionHeading = ({ children, size = "md", style }) => (
  <div style={{ fontSize: size === "sm" ? 12.5 : 13.5, fontWeight: 700, color: C.navy, marginBottom: size === "sm" ? 8 : 10, ...style }}>
    {children}
  </div>
);


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
  if (isBookingClosedOut(booking.status)) {
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

// Full tabbed Booking Detail view — Overview / Pricing & Payment / Timeline.
// Opens either from clicking "View" on a row in the Bookings table, or
// automatically right after a new booking is created (see `detailBookingId`
// prop on <Booking>).
const BookingDetailModal = ({ booking, bookings, fleet, activeTab, setActiveTab, onClose, onUpdateBooking, onEditBooking, onPaymentReceived }) => {
  const [mileageIn, setMileageIn] = useState(booking.mileageIn || "");
  const [fuelIn, setFuelIn] = useState(booking.fuelIn || "Full");
  // Fuel Charge is entered manually by staff at return time — there's no
  // fuel-price/tank-size field in the fleet data model to derive a rate
  // from, so this is a plain amount field, same as any other post-return
  // charge amount (Damage Fee, Cleaning Fee, etc).
  const [fuelCharge, setFuelCharge] = useState("");
  // Defaults to right now (still fully editable) so an on-time return needs
  // no changes, but an early or late return can be corrected before confirming.
  const [actualReturnDate, setActualReturnDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [actualReturnTime, setActualReturnTime] = useState(() => new Date().toTimeString().slice(0, 5));
  const [paymentAmount, setPaymentAmount] = useState("");
  const [paymentMethod, setPaymentMethod] = useState("Cash");
  // Defaults to right now (still fully editable) — same pattern as
  // actualReturnDate/actualReturnTime above, so a payment recorded on the
  // spot needs no changes, but a backdated/late-logged payment can be corrected.
  const [paymentDate, setPaymentDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [paymentTime, setPaymentTime] = useState(() => new Date().toTimeString().slice(0, 5));

  if (!booking) return null;
  const car = fleet.find(c => c.plate === booking.plate);
  const inv = computeBookingInvoice(booking);
  const payStatus = paymentStatus(inv.totalPaid, inv.finalInvoiceTotal);
  const alreadyReturned = !!booking.mileageIn || isBookingClosedOut(booking.status);

  // Balance Due coloring, per spec: green once fully paid, orange while
  // partially paid, red while nothing's been paid against an outstanding balance.
  const balanceColor = inv.balanceDue <= 0 ? C.teal : inv.totalPaid > 0 ? "#d97706" : C.red;

  const handleConfirmReturn = () => {
    if (mileageIn === "" || Number(mileageIn) < 0) {
      alert("Enter a valid Mileage In reading");
      return;
    }
    if (!actualReturnDate || !actualReturnTime) {
      alert("Enter the Actual Return Date & Time");
      return;
    }
    if (fuelCharge !== "" && Number(fuelCharge) < 0) {
      alert("Fuel Charge cannot be negative");
      return;
    }
    const actualReturnAt = `${actualReturnDate}T${actualReturnTime}`;

    // Fuel Charge is whatever amount staff entered above (comparing Starting
    // Fuel at Handover against the Ending Fuel just entered is on them — no
    // rate is assumed here). Added as an itemized, taxable "return" charge —
    // same shape as any other post-return charge (see CHARGE_TYPES), so it
    // flows into finalInvoiceTotal/balanceDue through computeBookingInvoice
    // automatically rather than needing separate math anywhere else in the app.
    const fuelChargeAmount = Number(fuelCharge) || 0;
    const charges = fuelChargeAmount > 0
      ? [...(booking.charges || []), {
          id: `fuel-${Date.now()}`,
          type: "fuel_shortfall",
          label: `Fuel Charge (${booking.fuelLevel || "?"} -> ${fuelIn})`,
          amount: fuelChargeAmount,
          taxable: true,
          origin: "return",
          addedAt: new Date().toISOString(),
        }]
      : (booking.charges || []);

    // forceCompleted mirrors the existing "Mark Done" convention elsewhere in
    // this file, rather than setting status directly — that keeps this in
    // sync with whatever automatic Upcoming/Active/Completed logic already
    // owns booking status. The car goes straight to Available once this
    // fires — useFleetData.js no longer has any automatic Maintenance path.
    onUpdateBooking(booking.id, {
      mileageIn, fuelIn, actualReturnAt, charges,
      forceCompleted: true,
      returnedAt: new Date().toISOString(),
    });

    // onUpdateBooking's state update isn't synchronous, so build the
    // post-return booking locally to invoice off the actual return date
    // (and the Fuel Charge just computed) immediately rather than waiting a
    // render behind.
    const returnedBooking = { ...booking, mileageIn, fuelIn, actualReturnAt, charges };
    const finalInv = computeBookingInvoice(returnedBooking);
    generateInvoicePdf(returnedBooking, car, finalInv);
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
    // Balance Due never goes negative (see computeBookingInvoice), so an
    // overpayment is blocked right here at entry rather than silently
    // accepted and clamped away — the person gets a clear error instead of
    // money quietly vanishing from the numbers.
    if (amt > inv.balanceDue) {
      alert(`Amount exceeds the Balance Due (${fmt(inv.balanceDue)}). Enter ${fmt(inv.balanceDue)} or less.`);
      return;
    }
    if (!paymentDate || !paymentTime) {
      alert("Enter the payment date & time");
      return;
    }
    const newPayment = {
      id: `${Date.now()}`,
      amount: amt,
      method: paymentMethod,
      addedAt: `${paymentDate}T${paymentTime}`,
    };
    onUpdateBooking(booking.id, { payments: [...inv.payments, newPayment] });
    const carLabel = fleet.find(c => c.plate === booking.plate);
    onPaymentReceived?.({
      type: "paymentReceived",
      plate: booking.plate,
      car: carLabel ? `${carLabel.make} ${carLabel.model}` : "",
      msg: `${fmt(amt)} received from ${booking.customer} via ${paymentMethod}`,
      urgent: false,
    });
    setPaymentAmount("");
    setPaymentDate(new Date().toISOString().slice(0, 10));
    setPaymentTime(new Date().toTimeString().slice(0, 5));
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
              <Btn onClick={() => onEditBooking?.(booking)}>✏️ Edit</Btn>
              {/* Agreement needs the mileage/fuel/condition captured at
                  Vehicle Handover, so it only makes sense once handoverAt is
                  set — see hasHandedOver above. */}
              <Btn
                disabled={!hasHandedOver(booking)}
                title={!hasHandedOver(booking) ? "Available once Vehicle Handover is completed" : undefined}
                onClick={() => {
                  if (!hasHandedOver(booking)) return;
                  generateRentalAgreementPdf(booking, car);
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

          {isAwaitingHandover(booking) && (
            <div style={{ margin: "10px 0 0", padding: "8px 12px", borderRadius: 8, border: `1px solid #f59e0b55`, background: "#f59e0b14", fontSize: 11.5, color: "#92400e", fontWeight: 600 }}>
              ⏳ Awaiting Vehicle Handover — the pickup date has arrived but mileage, fuel, and condition haven't been recorded yet, so no Rental Agreement exists for this booking.
            </div>
          )}

          {/* Tabs — same numbered circle-badge + connector style as the
              New Booking wizard's step header. These stay freely clickable
              (not a linear progress gate) since Overview/Pricing
              Details/Pricing & Payment/Timeline aren't sequential steps. */}
          <div style={{ display: "flex", alignItems: "center", marginTop: 14, paddingBottom: 14, overflowX: "auto" }}>
            {BOOKING_DETAIL_TABS.flatMap((tab, i) => {
              const stepNum = i + 1;
              const isActive = tab === activeTab;
              const tabEl = (
                <button key={`tab-${tab}`} onClick={() => setActiveTab(tab)} style={{
                  background: "none", border: "none", cursor: "pointer", fontFamily: "inherit", padding: 0,
                  display: "flex", alignItems: "center", gap: 8, flexShrink: 0,
                }}>
                  <div style={{
                    width: 26, height: 26, borderRadius: "50%", flexShrink: 0,
                    display: "flex", alignItems: "center", justifyContent: "center",
                    fontSize: 12, fontWeight: 700,
                    background: isActive ? C.teal : C.bg,
                    color: isActive ? "#fff" : C.textMuted,
                    border: isActive ? "none" : `1px solid ${C.border}`,
                  }}>
                    {stepNum}
                  </div>
                  <div style={{ fontSize: 13.5, fontWeight: isActive ? 700 : 500, color: isActive ? C.navy : C.textMuted, whiteSpace: "nowrap" }}>
                    {tab}
                  </div>
                </button>
              );
              const connectorEl = stepNum < BOOKING_DETAIL_TABS.length
                ? <div key={`connector-${stepNum}`} style={{ flex: 1, height: 2, background: C.border, margin: "0 10px", minWidth: 12 }} />
                : null;
              return connectorEl ? [tabEl, connectorEl] : [tabEl];
            })}
          </div>
        </div>

        {/* Body */}
        <div style={{ padding: "16px 22px", overflowY: "auto", flex: 1 }}>
          {activeTab === "Overview" ? (
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              {/* Rental Summary */}
              <div style={{ border: `1px solid ${C.border}`, borderRadius: 10, padding: "10px 14px", background: C.bg }}>
                <SectionHeading size="sm">Rental Summary</SectionHeading>
                {[
                  { label: "Booking ID", value: booking.id },
                  { label: "Booking Status", value: booking.status },
                  { label: "Rental Period", value: `${formatDateTime(booking.start)} → ${formatDateTime(booking.end)}` },
                  { label: "Pickup Date & Time", value: formatDateTime(booking.start) || "—" },
                  { label: "Return Date & Time", value: formatDateTime(booking.end) || "—" },
                  { label: "Total Rental Days", value: `${inv.days} Day${inv.days === 1 ? "" : "s"}` },
                ].map(row => (
                  <div key={row.label} style={{ display: "flex", justifyContent: "space-between", gap: 10, padding: "3px 0", fontSize: 12 }}>
                    <span style={{ color: C.textMuted }}>{row.label}</span>
                    <span style={{ color: C.navy, fontWeight: 600, textAlign: "right" }}>{row.value}</span>
                  </div>
                ))}
                {/* Vehicle Handover is now completed from the Edit Booking flow
                    (Step 5 — Review), not a button here — this row just reflects
                    whatever state that flow has produced. */}
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, padding: "3px 0", fontSize: 12 }}>
                  <span style={{ color: C.textMuted }}>Vehicle Handover</span>
                  {hasHandedOver(booking) ? (
                    <span style={{ color: C.navy, fontWeight: 600, textAlign: "right" }}>✅ {formatDateTime(booking.handoverAt)}</span>
                  ) : !isBookingClosedOut(booking.status) ? (
                    <span style={{ color: "#92400e", fontWeight: 600, textAlign: "right", fontSize: 11 }}>⏳ Complete via Edit</span>
                  ) : (
                    <span style={{ color: C.navy, fontWeight: 600, textAlign: "right" }}>⏳ Pending</span>
                  )}
                </div>
              </div>

              {/* Payment Summary */}
              <div style={{ border: `1px solid ${C.border}`, borderRadius: 10, padding: "10px 14px", background: C.bg }}>
                <SectionHeading size="sm">Payment Summary</SectionHeading>
                {[
                  { label: "Grand Total", value: inv.finalInvoiceTotal, color: C.navy },
                  { label: "Total Paid", value: inv.totalPaid, color: C.teal },
                  { label: "Balance Due", value: inv.balanceDue, color: balanceColor },
                ].map(row => (
                  <div key={row.label} style={{ display: "flex", justifyContent: "space-between", padding: "3px 0", fontSize: 12.5 }}>
                    <span style={{ color: C.textSec }}>{row.label}</span>
                    <span style={{ fontWeight: 700, color: row.color, textAlign: "right", ...mono }}>{fmt(row.value)}</span>
                  </div>
                ))}
                {/* Kept visually separate — Security Deposit is refundable and
                    never part of Grand Total / Total Paid / Balance Due. */}
                <div style={{ display: "flex", justifyContent: "space-between", padding: "3px 0", marginTop: 4, paddingTop: 6, borderTop: `1px dashed ${C.border}`, fontSize: 11, color: C.textMuted }}>
                  <span>Security Deposit (refundable)</span>
                  <span style={{ textAlign: "right", ...mono }}>{fmt(inv.deposit)}</span>
                </div>
              </div>

              {/* Customer Summary */}
              <div style={{ border: `1px solid ${C.border}`, borderRadius: 10, padding: "10px 14px", background: C.bg }}>
                <SectionHeading size="sm">Customer Summary</SectionHeading>
                {[
                  { label: "Customer Name", value: booking.customer || "—" },
                  { label: "Driving License No.", value: booking.license || "—" },
                  { label: "Phone Number", value: booking.contact || "—" },
                ].map(row => (
                  <div key={row.label} style={{ display: "flex", justifyContent: "space-between", gap: 10, padding: "3px 0", fontSize: 12 }}>
                    <span style={{ color: C.textMuted }}>{row.label}</span>
                    <span style={{ color: C.navy, fontWeight: 600, textAlign: "right" }}>{row.value}</span>
                  </div>
                ))}
              </div>

              {/* Vehicle Summary */}
              <div style={{ border: `1px solid ${C.border}`, borderRadius: 10, padding: "10px 14px", background: C.bg }}>
                <SectionHeading size="sm">Vehicle Summary</SectionHeading>
                {[
                  { label: "Vehicle Name", value: car?.model || booking.plate || "—" },
                  { label: "Registration Number", value: booking.plate || "—" },
                  { label: "Daily Rate", value: fmt(Number(booking.rate) || 0) },
                  { label: "Starting Mileage", value: booking.startingMileage ? `${booking.startingMileage} km` : "—" },
                  { label: "Fuel Level at Pickup", value: booking.fuelLevel || "—" },
                  { label: "Current Odometer", value: booking.mileageIn || booking.startingMileage || "—" },
                ].map(row => (
                  <div key={row.label} style={{ display: "flex", justifyContent: "space-between", gap: 10, padding: "3px 0", fontSize: 12 }}>
                    <span style={{ color: C.textMuted }}>{row.label}</span>
                    <span style={{ color: C.navy, fontWeight: 600, textAlign: "right", ...mono }}>{row.value}</span>
                  </div>
                ))}
              </div>

              {/* Vehicle Condition at Pickup — the note captured during Vehicle
                  Handover, shown only once it exists. */}
              {booking.vehicleCondition && (
                <div style={{ gridColumn: "1 / -1", border: `1px solid ${C.border}`, borderRadius: 10, padding: "10px 14px" }}>
                  <SectionHeading size="sm">Vehicle Condition at Pickup</SectionHeading>
                  <div style={{ fontSize: 12.5, color: C.textSec, whiteSpace: "pre-wrap" }}>{booking.vehicleCondition}</div>
                </div>
              )}

              {/* Vehicle Return — spans both columns */}
              <div style={{ gridColumn: "1 / -1", border: `1px solid ${C.border}`, borderRadius: 10, padding: "10px 14px" }}>
                <SectionHeading size="sm">Vehicle Return</SectionHeading>
                {alreadyReturned ? (
                  <div style={{ fontSize: 12.5, color: C.textSec }}>
                    ✅ Returned{booking.actualReturnAt ? ` ${new Date(booking.actualReturnAt).toLocaleString()}` : ""} — Mileage In {booking.mileageIn || mileageIn} km · Fuel In {booking.fuelIn || fuelIn}
                    {(() => {
                      const recordedFuelCharge = (booking.charges || []).find(c => c.type === "fuel_shortfall");
                      return recordedFuelCharge ? ` · Fuel Charge ${fmt(Number(recordedFuelCharge.amount) || 0)}` : "";
                    })()}
                  </div>
                ) : (
                  <div style={{ display: "flex", gap: 12, alignItems: "flex-end", flexWrap: "wrap" }}>
                    <div style={{ flex: "1 1 140px" }}>
                      <div style={detailFieldLabelStyle}>Actual Return Date</div>
                      <input type="date" value={actualReturnDate} onChange={(e) => setActualReturnDate(e.target.value)} style={detailInputStyle} />
                    </div>
                    <div style={{ flex: "1 1 110px" }}>
                      <div style={detailFieldLabelStyle}>Actual Return Time</div>
                      <input type="time" value={actualReturnTime} onChange={(e) => setActualReturnTime(e.target.value)} style={detailInputStyle} />
                    </div>
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
                    <div style={{ flex: "1 1 160px" }}>
                      <div style={detailFieldLabelStyle}>Fuel Charge</div>
                      <input
                        type="number"
                        min="0"
                        value={fuelCharge}
                        onChange={(e) => setFuelCharge(e.target.value)}
                        placeholder="0.00"
                        style={detailInputStyle}
                      />
                    </div>
                    <Btn primary onClick={handleConfirmReturn}>Confirm Return & Generate Invoice</Btn>
                    <div style={{ flex: "1 1 100%", fontSize: 11, color: C.textMuted }}>
                      Starting Fuel (at Handover): <strong style={{ color: C.navy }}>{booking.fuelLevel || "—"}</strong> · compare against Fuel In above to decide the Fuel Charge. Any amount entered here is added to the invoice and Balance Due on confirm.
                    </div>
                  </div>
                )}
              </div>

              {/* Completion Summary — full financial close-out, shown once the rental is done (Completed or its fully-paid successor, Closed) */}
              {isBookingClosedOut(booking.status) && (
                <div style={{ gridColumn: "1 / -1", border: `1px solid ${C.border}`, borderRadius: 10, padding: "10px 14px", background: C.bg }}>
                  <SectionHeading size="sm">Completion Summary</SectionHeading>
                  {[
                    { label: "Rental Charges", value: fmt(inv.agreementTotal) },
                    { label: "Additional Charges", value: fmt(inv.taxableChargesTotal + inv.nonTaxableChargesTotal) },
                    { label: "Payments Received", value: fmt(inv.totalPaid) },
                  ].map(row => (
                    <div key={row.label} style={{ display: "flex", justifyContent: "space-between", padding: "3px 0", fontSize: 12.5, color: C.textSec }}>
                      <span>{row.label}</span>
                      <span style={{ textAlign: "right", ...mono }}>{row.value}</span>
                    </div>
                  ))}
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "3px 0", fontSize: 12.5, color: C.textSec }}>
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
                  <div style={{ display: "flex", justifyContent: "space-between", marginTop: 6, paddingTop: 8, borderTop: `1px solid ${C.border}` }}>
                    <span style={{ fontSize: 13, fontWeight: 700, color: C.navy }}>Outstanding Balance</span>
                    <span style={{ fontSize: 13, fontWeight: 700, color: balanceColor, textAlign: "right", ...mono }}>{fmt(inv.balanceDue)}</span>
                  </div>
                </div>
              )}
            </div>
          ) : activeTab === "Pricing & Payment" ? (
            <>
              <div style={{ fontSize: 11.5, color: C.textMuted, marginBottom: 14 }}>
                Post-return charges flow into the Invoice only — the signed Agreement total never changes.
              </div>

              {/* Single-page, two-column layout: Pricing Summary + Additional
                  Charges on the left, Payment Summary / Balance Due / Record
                  Payment on the right — kept together so nothing here needs
                  its own scroll. */}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>
                {/* LEFT: agreement Pricing Summary + post-return Additional Charges */}
                <div>
                  <SectionHeading size="sm">Pricing Summary</SectionHeading>
                  <div style={{ border: `1px solid ${C.border}`, borderRadius: 10, padding: "12px 14px", background: C.bg, marginBottom: 16 }}>
                    {[
                      { label: "Rental Vehicle Charge", value: inv.rateCharge },
                      { label: "Delivery Charge", value: inv.deliveryCharge },
                      { label: "Collection Charge", value: inv.collectionCharge },
                      { label: "Additional Driver Charge", value: inv.additionalDriverCharge },
                      { label: "Other Charges", value: inv.otherCharges },
                    ].filter(row => row.value > 0).map(row => (
                      <div key={row.label} style={{ display: "flex", justifyContent: "space-between", padding: "4px 0", fontSize: 12, color: C.textSec }}>
                        <span>{row.label}</span>
                        <span style={{ textAlign: "right", ...mono }}>{fmt(row.value)}</span>
                      </div>
                    ))}
                    {/* Itemized charges added at booking time (New Booking
                        wizard's Pricing & Charges step) — part of the signed
                        agreement, so they belong in this breakdown rather
                        than the Additional Charges list below. */}
                    {inv.bookingCharges.map(c => (
                      <div key={c.id} style={{ display: "flex", justifyContent: "space-between", padding: "4px 0", fontSize: 12, color: C.textSec }}>
                        <span>{c.label}{c.note ? ` (${c.note})` : ""}</span>
                        <span style={{ textAlign: "right", ...mono }}>{fmt(Number(c.amount) || 0)}</span>
                      </div>
                    ))}
                    <div style={{ display: "flex", justifyContent: "space-between", padding: "4px 0", marginTop: 4, paddingTop: 6, borderTop: `1px solid ${C.border}`, fontSize: 12, color: C.textSec }}>
                      <span>Subtotal</span>
                      <span style={{ textAlign: "right", ...mono }}>{fmt(inv.agreementSubtotal)}</span>
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between", padding: "4px 0", fontSize: 12, color: C.textSec }}>
                      <span>VAT ({inv.vatPct || 0}%)</span>
                      <span style={{ textAlign: "right", ...mono }}>{fmt(inv.agreementVatAmount)}</span>
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between", marginTop: 6, paddingTop: 8, borderTop: `1px solid ${C.border}` }}>
                      <span style={{ fontSize: 13, fontWeight: 700, color: C.navy }}>Agreement Total</span>
                      <span style={{ fontSize: 13, fontWeight: 700, color: C.teal, textAlign: "right", ...mono }}>{fmt(inv.agreementTotal)}</span>
                    </div>
                  </div>

                
                </div>

                {/* RIGHT: Payment Summary, Balance Due, and Record Payment */}
                <div>
                  <SectionHeading size="sm">Payment Summary</SectionHeading>

                  <div style={{ border: `1px solid ${C.border}`, borderRadius: 10, padding: "14px 16px", background: C.bg, marginBottom: 14 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", padding: "4px 0", fontSize: 12, color: C.textSec }}>
                      <span>Grand Total</span>
                      <span style={{ textAlign: "right", ...mono }}>{fmt(inv.finalInvoiceTotal)}</span>
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between", padding: "4px 0", fontSize: 12, color: C.textSec }}>
                      <span>Total Paid</span>
                      <span style={{ textAlign: "right", ...mono }}>{fmt(inv.totalPaid)}</span>
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between", marginTop: 6, paddingTop: 8, borderTop: `1px solid ${C.border}` }}>
                      <span style={{ fontSize: 13, fontWeight: 700, color: C.navy }}>Balance Due</span>
                      <span style={{ fontSize: 13, fontWeight: 700, color: balanceColor, textAlign: "right", ...mono }}>{fmt(inv.balanceDue)}</span>
                    </div>
                    {/* Deliberately separated from the Grand Total/Total Paid/Balance
                        Due block above by its own border — Security Deposit is
                        refundable, not a rental charge, and never factors into
                        that math (see computeBookingInvoice). */}
                    <div style={{ display: "flex", justifyContent: "space-between", padding: "4px 0", marginTop: 8, paddingTop: 8, borderTop: `1px dashed ${C.border}`, fontSize: 11.5, color: C.textMuted }}>
                      <span>Security Deposit (refundable, held separately)</span>
                      <span style={{ textAlign: "right", ...mono }}>{fmt(inv.deposit)}</span>
                    </div>
                  </div>

                  {inv.payments.length > 0 && (
                    <div style={{ marginBottom: 14, maxHeight: 180, overflowY: "auto" }}>
                      {inv.payments.map(p => (
                        <div key={p.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", border: `1px solid ${C.border}`, borderRadius: 10, padding: "8px 12px", marginBottom: 6 }}>
                          <div style={{ fontSize: 12, fontWeight: 600, color: C.navy }}>{fmt(Number(p.amount) || 0)} · {p.method}</div>
                          <div style={{ fontSize: 10.5, color: C.textMuted }}>{p.addedAt ? formatDateTime(p.addedAt) : ""}</div>
                        </div>
                      ))}
                    </div>
                  )}

                  <SectionHeading size="sm">Record Payment</SectionHeading>
                  {inv.balanceDue <= 0 ? (
                    <div style={{
                      border: `1px solid ${C.teal}`, borderRadius: 10, padding: "12px 14px",
                      background: `${C.teal}0f`, fontSize: 12.5, fontWeight: 600, color: C.teal,
                    }}>
                      ✓ Balance fully paid — no further payment can be recorded.
                    </div>
                  ) : (
                    <>
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 10 }}>
                        <div>
                          <div style={detailFieldLabelStyle}>Amount</div>
                          <input type="number" min="0" max={inv.balanceDue || undefined} value={paymentAmount} onChange={(e) => setPaymentAmount(e.target.value)} placeholder="0.00" style={detailInputStyle} />
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
                        <div>
                          <div style={detailFieldLabelStyle}>Date</div>
                          <input type="date" value={paymentDate} onChange={(e) => setPaymentDate(e.target.value)} style={detailInputStyle} />
                        </div>
                        <div>
                          <div style={detailFieldLabelStyle}>Time</div>
                          <input type="time" value={paymentTime} onChange={(e) => setPaymentTime(e.target.value)} style={detailInputStyle} />
                        </div>
                      </div>
                      <div style={{ fontSize: 11, color: C.textMuted, marginTop: -4, marginBottom: 10 }}>
                        Balance Due: <span style={{ fontWeight: 700, color: balanceColor }}>{fmt(inv.balanceDue)}</span>
                      </div>
                      <div style={{ width: "100%" }}>
                        <Btn primary onClick={handleRecordPayment}>+ Record Payment</Btn>
                      </div>
                    </>
                  )}
                </div>
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

const Booking = ({ bookings = [], fleet = [], onNewBooking, onAddBooking, onUpdateBooking, onDeleteBooking, detailBookingId, onDetailBookingIdHandled, onEditBooking, selectedCar = "All Cars", selectedRange = "all", onBookingCancelled, onPaymentReceived }) => {
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

  const statuses = ["All", "Active", "Upcoming", "Ending Today", "Completed", "Closed"];

  // Topbar Car / Month filters (FleetOpzApp header) scope the whole page —
  // status pills and counts below are computed from this scoped set, so
  // "15 total bookings" narrows along with the dropdowns instead of ignoring
  // them. Car matches by plate; Month matches the booking's Pickup
  // (start) date falling in that calendar month ("all" = every month, YTD).
  const scopedBookings = useMemo(() => {
    return bookings.filter(b => {
      if (selectedCar !== "All Cars" && b.plate !== selectedCar) return false;
      if (selectedRange !== "all" && !(b.start || "").startsWith(selectedRange)) return false;
      return true;
    });
  }, [bookings, selectedCar, selectedRange]);

  // Status pill counts (Active / Upcoming / Ending Today / Completed) — computed
  // from the scoped bookings list so the numbers on the pills don't shift as the
  // active filter changes, matching Fleet's status-pill behavior.
  const statusCounts = useMemo(() => {
    const counts = {};
    scopedBookings.forEach(b => { counts[b.status] = (counts[b.status] || 0) + 1; });
    return counts;
  }, [scopedBookings]);

  const filtered = filter === "All" ? scopedBookings : scopedBookings.filter(b => b.status === filter);
  const timelineCar = timelinePlate ? fleet.find(c => c.plate === timelinePlate) : null;
  const openDetailBooking = openDetailId ? bookings.find(b => b.id === openDetailId) : null;

  const handleDelete = (bookingId) => {
    if (window.confirm("Are you sure you want to delete this booking?")) {
      const cancelled = bookings.find(b => b.id === bookingId);
      onDeleteBooking(bookingId);
      if (cancelled) {
        const c = fleet.find(f => f.plate === cancelled.plate);
        onBookingCancelled?.({
          type: "bookingCancellation",
          plate: cancelled.plate,
          car: c ? `${c.make} ${c.model}` : "",
          msg: `Booking for ${cancelled.customer} was cancelled`,
          urgent: false,
        });
      }
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
    if (isBookingClosedOut(b.status)) {
      // Once fully paid (Closed) or already released to Maintenance, this is
      // a one-way door — reverting would skip the lifecycle backwards, which
      // the workflow never allows.
      if (b.status === "Closed" || b.maintenanceTriggered) return;
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
          <div style={{ fontSize: 11, color: C.textMuted }}>{scopedBookings.length} total bookings</div>
        </div>
        <Btn primary onClick={onNewBooking}>＋ New Booking</Btn>
      </div>

      {/* Status filter pills — click a status to show only that status, click All to reset.
          Same design/colors/interaction as the Fleet page's status filter pills. */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 16 }}>
        {[["All", scopedBookings.length], ...statuses.filter(s => s !== "All").map(s => [s, statusCounts[s] || 0])].map(([label, count]) => {
          const isActive = filter === label;
          const dotColor = label === "All" ? C.navy : getBookingStatusPillColor(label);
          return (
            <button key={label} onClick={() => setFilter(label)} style={{
              display: "flex", alignItems: "center", gap: 7, padding: "7px 14px", borderRadius: 999,
              border: `1.5px solid ${isActive ? dotColor : C.border}`,
              background: isActive ? `${dotColor}14` : C.surface,
              color: isActive ? dotColor : C.textSec,
              fontSize: 12.5, fontWeight: 700, cursor: "pointer", transition: "all 0.12s",
            }}>
              {label !== "All" && <span style={{ width: 7, height: 7, borderRadius: "50%", background: dotColor, flexShrink: 0 }} />}
              {label}
              <span style={{
                fontSize: 11, fontWeight: 700, padding: "1px 7px", borderRadius: 999,
                background: isActive ? C.surface : C.bg, color: isActive ? dotColor : C.textMuted,
              }}>
                {count}
              </span>
            </button>
          );
        })}
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
                  <td style={{ padding: "11px 12px" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                      <StatusTag status={b.status} />
                      {isAwaitingHandover(b) && (
                        <span title="Pickup date has arrived but Vehicle Handover hasn't been completed" style={{ fontSize: 9.5, fontWeight: 700, color: "#92400e", background: "#f59e0b1f", border: "1px solid #f59e0b55", borderRadius: 999, padding: "2px 6px", whiteSpace: "nowrap" }}>
                        ⏳ Awaiting Handover
                        </span>
                      )}
                    </div>
                  </td>
                  <td style={{ padding: "11px 12px", display: "flex", gap: 6 }} onClick={(e) => e.stopPropagation()}>
                    <button onClick={() => { setOpenDetailId(b.id); setActiveDetailTab("Overview"); }}
                      style={{ padding: "4px 8px", fontSize: 10, background: "none", border: "none", color: C.teal, cursor: "pointer", fontWeight: 600 }}>
                      View
                    </button>
                    <button onClick={() => onEditBooking?.(b)}
                      style={{ padding: "4px 8px", fontSize: 10, background: "none", border: "none", color: C.teal, cursor: "pointer", fontWeight: 600 }}>
                      Edit
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
          onEditBooking={onEditBooking}
          onPaymentReceived={onPaymentReceived}
        />
      )}
    </div>
  );
};

export default Booking;