import { useState, useEffect } from "react";
import { FLEET as INITIAL_FLEET, BOOKINGS as INITIAL_BOOKINGS, EARNINGS as INITIAL_EARNINGS, EXPENSES as INITIAL_EXPENSES, ALERTS as INITIAL_ALERTS } from "./data";
import { totalInv, daysUntil } from "./theme";

// Desired profit margin layered on top of breakeven costs when deriving the monthly target.
// Breakeven = money needed just to recover the car and cover its maintenance; the target
// aims a bit higher so the business is actually profitable, not just breaking even.
const TARGET_MARGIN_PCT = 15;

// ── LOCAL PERSISTENCE ────────────────────────────────────────────────────────
// Without this, every refresh/reload wiped anything the user added, because state
// lived only in memory and re-initialized from the static sample data in data.js.
// We namespace keys so this app's data doesn't collide with anything else on the domain.
const STORAGE_PREFIX = "fleetopz:";

const loadPersisted = (key, fallback) => {
  try {
    const raw = window.localStorage.getItem(STORAGE_PREFIX + key);
    if (raw === null) return fallback;
    return JSON.parse(raw);
  } catch (err) {
    console.error(`FleetOpz: failed to load "${key}" from localStorage`, err);
    return fallback;
  }
};

const savePersisted = (key, value) => {
  try {
    window.localStorage.setItem(STORAGE_PREFIX + key, JSON.stringify(value));
  } catch (err) {
    console.error(`FleetOpz: failed to save "${key}" to localStorage`, err);
  }
};

// A car should never sit in "Maintenance" for more than this many days before
// being auto-released back to "Available" (see the effect below). Exported so
// anything projecting future availability (e.g. the Booking module's 10-day
// timeline) uses the exact same window instead of a second hardcoded number.
export const MAINTENANCE_MAX_DAYS = 3;

// Normalizes any date-ish value (a plain "YYYY-MM-DD" or a full datetime
// string/timestamp) down to its calendar date. Needed because booking.start
// and booking.end carry a specific pickup/return time — comparing those
// directly against a plain todayStr as strings is unreliable (e.g. a booking
// starting today at 12:29 pm would string-compare as "later" than today's
// bare date and get misread as Upcoming instead of Active). Falls back to a
// straight slice if the value isn't parseable, rather than throwing.
const toDateStr = (v) => {
  const d = new Date(v);
  return isNaN(d) ? String(v).slice(0, 10) : d.toISOString().slice(0, 10);
};

// ── INVOICE CALC ─────────────────────────────────────────────────────────────
// Single source of truth for a booking's full invoice picture — used by the
// Bookings table/detail view, and by computeBookingStatus below to decide
// whether a Completed booking has been fully paid off (→ Closed).
//
// Two totals matter here and they are deliberately different things:
//   - `agreementTotal`  — the signed quote: Rental Vehicle Charge + Delivery
//     + Collection + Additional Driver + Other Charges + any itemized
//     charges added in the New Booking wizard's Pricing & Charges step
//     (origin: "booking"), then VAT. This is what Pricing Details shows, and
//     it never changes after the booking is created — everything in it was
//     itemized before the agreement was signed.
//   - `finalInvoiceTotal` — the agreement total plus whatever's been added
//     afterward in Charges & Payment (origin: "return" — taxable charges
//     pushed back through VAT, non-taxable charges added flat on top). This
//     is the actual amount owed, and what Overview's Payment Summary and the
//     Payments section use for Balance Due.
// Security Deposit is intentionally excluded from both — it's refundable,
// not a rental charge, so it's tracked as its own figure.
export const computeBookingInvoice = (b) => {
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
  // Kept in sync with Booking.jsx's copy of this function — see that file's
  // comment for the full rationale.
  const charges = b.charges || [];
  const bookingCharges = charges.filter(c => c.origin === "booking");
  const postCharges = charges.filter(c => c.origin !== "booking");

  const bookingChargesTaxableTotal = bookingCharges.filter(c => c.taxable).reduce((s, c) => s + (Number(c.amount) || 0), 0);
  const bookingChargesNonTaxableTotal = bookingCharges.filter(c => !c.taxable).reduce((s, c) => s + (Number(c.amount) || 0), 0);

  const fixedChargesSubtotal = rateCharge + deliveryCharge + collectionCharge + additionalDriverCharge + otherCharges;
  const agreementTaxableBase = fixedChargesSubtotal + bookingChargesTaxableTotal;
  const agreementVatAmount = agreementTaxableBase * (vatPct / 100);
  const agreementSubtotal = fixedChargesSubtotal + bookingChargesTaxableTotal + bookingChargesNonTaxableTotal;
  const agreementTotal = agreementTaxableBase + agreementVatAmount + bookingChargesNonTaxableTotal;

  const taxableChargesTotal = postCharges.filter(c => c.taxable).reduce((s, c) => s + (Number(c.amount) || 0), 0);
  const nonTaxableChargesTotal = postCharges.filter(c => !c.taxable).reduce((s, c) => s + (Number(c.amount) || 0), 0);
  const taxableSubtotal = agreementTaxableBase + taxableChargesTotal;
  const finalVatAmount = taxableSubtotal * (vatPct / 100);
  const finalInvoiceTotal = taxableSubtotal + finalVatAmount + bookingChargesNonTaxableTotal + nonTaxableChargesTotal;

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
    charges, bookingCharges, postCharges,
    taxableChargesTotal, nonTaxableChargesTotal, taxableSubtotal, finalVatAmount, finalInvoiceTotal,
    payments, totalPaid, balanceDue,
  };
};

// A booking is "closed out" once it's reached either terminal status —
// Completed (returned, balance may still be pending) or Closed (returned AND
// fully paid). Anything that should react to a booking being done — earnings
// generation, releasing the car — needs both, not just a literal "Completed"
// check, since a booking that's paid in full at return time goes straight to
// Closed and would otherwise never match "Completed".
export const isBookingClosedOut = (status) => status === "Completed" || status === "Closed";

// ── STATUS DERIVATION ────────────────────────────────────────────────────────
// Booking status is derived from today's date vs start/end, instead of being a
// static field that only changes when someone clicks a button. "Cancelled" is
// one status nothing can infer from dates, so it stays a manual flag — and so
// does "forceCompleted", which lets staff close a booking early (car returned
// ahead of schedule) without needing every other status to become manual too.
// Exported so any screen that needs "what would this booking's status be on
// date X" (not just today) can reuse this exact logic — e.g. the Booking
// module's forward-looking availability timeline calls this once per day.
//
// Reaching a completed state still works exactly as before (return date
// passed, or staff force-completed/confirmed the return) — that part is
// unchanged. What's new: a completed booking advances one step further, from
// "Completed" to "Closed", once it's fully paid (including any charges added
// after return). Any pending balance keeps it sitting in "Completed".
export const computeBookingStatus = (booking, todayStr) => {
  if (booking.cancelled) return "Cancelled";

  const resolveCompletion = () => {
    const { balanceDue } = computeBookingInvoice(booking);
    return balanceDue <= 0 ? "Closed" : "Completed";
  };

  if (booking.forceCompleted) return resolveCompletion();
  if (!booking.start || !booking.end) return booking.status || "Active";
  const startStr = toDateStr(booking.start);
  const endStr = toDateStr(booking.end);
  if (todayStr < startStr) return "Upcoming";
  if (todayStr === endStr) return "Ending Today";
  if (todayStr > endStr) return resolveCompletion();
  return "Active"; // start <= today < end
};

// A car's status is fully derived — Maintenance is the one state that can't
// be inferred from bookings alone (it's a manual/automatic flag set when a
// rental completes, and cleared when maintenance is completed), everything
// else follows directly from the car's own bookings:
//   Maintenance   → only ever set manually (e.g. directly on fleet data); nothing
//                   in this app moves a car into Maintenance automatically anymore
//   Ending Today  → has a booking whose derived status is "Ending Today"
//   On Rental     → has a booking whose derived status is "Active"
//   Upcoming      → has a future booking ("Upcoming") and nothing above applies
//   Available     → none of the above
const computeFleetStatus = (car, bookingsWithStatus) => {
  if (car.status === "Maintenance") return "Maintenance";
  const carBookings = bookingsWithStatus.filter(b => b.plate === car.plate);
  if (carBookings.some(b => b.status === "Ending Today")) return "Ending Today";
  if (carBookings.some(b => b.status === "Active")) return "On Rental";
  if (carBookings.some(b => b.status === "Upcoming")) return "Upcoming";
  return "Available";
};

// Projects a car's availability forward day-by-day (used by the Booking
// module's 10-day timeline). Everything it relies on (computeBookingStatus,
// MAINTENANCE_MAX_DAYS) is the exact same logic "today" status already uses,
// just replayed once per day instead of once for today. No new status rules
// are introduced here — but note "Upcoming" is deliberately NOT one of this
// projection's day statuses. computeBookingStatus only ever returns
// "Upcoming" for a day strictly before a booking's start (i.e. a day the
// booking does not actually occupy), so treating it as an occupied/
// unavailable day here was the bug: it made every day between now and a
// future booking's start look reserved. "Upcoming" remains valid everywhere
// else (the car's overall current status, the booking table's status
// column) — it's just not a per-day timeline state:
//   Maintenance   → projected using the car's maintenanceStartDate + MAINTENANCE_MAX_DAYS,
//                   for a car manually placed into Maintenance (nothing automatic sets this)
//   Ending Today  → a booking's computeBookingStatus for that day is "Ending Today"
//   On Rental     → a booking's computeBookingStatus for that day is "Active"
//   Available     → none of the above (including every day before a future
//                   booking's start — the car is genuinely free until then)
// Exported so Booking.jsx renders from this, rather than re-deriving statuses itself.
export const computeCarAvailabilityTimeline = (car, bookings, days = 10, fromDateStr) => {
  const start = fromDateStr ? new Date(fromDateStr) : new Date();
  const carBookings = bookings.filter(b => b.plate === car.plate && !b.cancelled);

  // Same auto-release window the maintenance effect uses — projected forward
  // instead of checked against "today", so future days past the release date
  // correctly fall through to the booking-derived statuses below.
  const maintenanceEndStr = car.status === "Maintenance" && car.maintenanceStartDate
    ? new Date(new Date(car.maintenanceStartDate).getTime() + MAINTENANCE_MAX_DAYS * 86400000).toISOString().slice(0, 10)
    : null;

  const timeline = [];
  for (let i = 0; i < days; i++) {
    const dateStr = new Date(start.getTime() + i * 86400000).toISOString().slice(0, 10);

    let status;
    if (maintenanceEndStr && dateStr < maintenanceEndStr) {
      status = "Maintenance";
    } else {
      const statusesOnDay = carBookings.map(b => computeBookingStatus(b, dateStr));
      if (statusesOnDay.includes("Ending Today")) status = "Ending Today";
      else if (statusesOnDay.includes("Active")) status = "On Rental";
      else status = "Available"; // includes days before a future booking's start
    }

    timeline.push({ date: dateStr, status });
  }
  return timeline;
};

// Overlap check for double-booking prevention: two rental periods for the
// same car clash if one starts before the other ends and ends after the
// other starts. End date is treated as a same-day turnover (checkout in the
// morning, new pickup that evening is allowed) — a common car-rental convention.
const rangesOverlap = (aStart, aEnd, bStart, bEnd) => aStart < bEnd && aEnd > bStart;

// Checks every non-cancelled booking for the same plate for a date clash.
// Pass excludeBookingId when checking an edit to a booking against itself.
// When more than one existing booking overlaps the requested range, the
// NEAREST one (earliest start) is returned — that's the one that actually
// determines "the last available date" the validation message below needs,
// since it's the first thing blocking the requested range.
const findOverlappingBooking = (bookings, plate, start, end, excludeBookingId) => {
  if (!start || !end) return null;
  const newStart = new Date(start).getTime();
  const newEnd = new Date(end).getTime();
  const conflicts = bookings.filter(b =>
    b.plate === plate &&
    b.id !== excludeBookingId &&
    !b.cancelled &&
    b.start && b.end &&
    rangesOverlap(newStart, newEnd, new Date(b.start).getTime(), new Date(b.end).getTime())
  );
  if (conflicts.length === 0) return null;
  return conflicts.reduce((nearest, b) =>
    new Date(b.start).getTime() < new Date(nearest.start).getTime() ? b : nearest
  );
};

// Adds/subtracts whole days to a "YYYY-MM-DD" string, staying in plain
// calendar-date land (no time-of-day/timezone drift).
const addDaysToDateStr = (dateStr, n) =>
  new Date(new Date(dateStr + "T00:00:00").getTime() + n * 86400000).toISOString().slice(0, 10);

// Fixed en-US, no-year format ("Aug 1") so the validation message reads the
// same regardless of the browser's locale — matches the style used in the
// example the message is modeled on.
const formatShortDate = (dateStr) =>
  new Date(dateStr + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" });

// Builds the specific, actionable conflict message for the booking form —
// built entirely from the nearest conflicting booking findOverlappingBooking
// already found, so this is presentation only, not a second source of truth
// for what conflicts. Two shapes:
//   - requested start is BEFORE the conflict's start (a partial overlap,
//     e.g. requesting Jul 22–Aug 3 against an Aug 1–Aug 12 booking): tell
//     the person the last date they can still book through.
//   - requested start is ON/AFTER the conflict's start (the car is already
//     out for the whole requested window): tell them when it frees up next.
export const buildAvailabilityConflictMessage = (conflict, requestedStart) => {
  const conflictStartStr = toDateStr(conflict.start);
  const conflictEndStr = toDateStr(conflict.end);
  const requestedStartStr = toDateStr(requestedStart);

  if (requestedStartStr < conflictStartStr) {
    const lastAvailable = addDaysToDateStr(conflictStartStr, -1);
    return `This vehicle is available only until ${formatShortDate(lastAvailable)}. An existing booking starts on ${formatShortDate(conflictStartStr)}. Please select an end date on or before ${formatShortDate(lastAvailable)} or choose another vehicle.`;
  }

  const nextAvailable = addDaysToDateStr(conflictEndStr, 1);
  return `This vehicle is booked from ${formatShortDate(conflictStartStr)} to ${formatShortDate(conflictEndStr)}. It will be available again from ${formatShortDate(nextAvailable)}. Please choose a different start date or another vehicle.`;
};

// IC/ID Number → most recent past customer record with that exact IC, if any.
// Booking history is the only "customer database" this app has (per product
// decision — no separate customers table), so this scans `bookings` rather
// than introducing a new data source. Matches on the normalized (uppercase,
// alphanumeric-only) IC the same way handleICChange in FleetOpzApp.jsx
// normalizes before calling this, so callers don't need to normalize twice.
// Returns null (not undefined) when nothing matches, so callers can rely on
// `match?.field` without worrying about the distinction.
export const findCustomerByIC = (bookings, ic) => {
  const normalized = (ic || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (!normalized) return null;

  // Sort newest-first (by start date) so if the same IC appears on multiple
  // past bookings under slightly different details, the most recent one wins
  // — that's the version of the customer's info most likely still accurate.
  const matches = bookings
    .filter(b => (b.ic || "").toUpperCase().replace(/[^A-Z0-9]/g, "") === normalized)
    .sort((a, b) => new Date(b.start) - new Date(a.start));

  if (matches.length === 0) return null;

  const latest = matches[0];
  return {
    customer: latest.customer || "",
    contact: latest.contact || "",
    passport: latest.passport || "",
    license: latest.license || "",
    licenseExpiry: latest.licenseExpiry || "",
    address: latest.address || "",
  };
};

export const useFleetData = () => {
  const [fleet, setFleet] = useState(() => loadPersisted("fleet", INITIAL_FLEET));
  const [bookings, setBookings] = useState(() => loadPersisted("bookings", INITIAL_BOOKINGS));
  const [earnings, setEarnings] = useState(() => loadPersisted("earnings", INITIAL_EARNINGS));
  const [expenses, setExpenses] = useState(() => loadPersisted("expenses", INITIAL_EXPENSES));

  // Persist to localStorage whenever any collection changes, so data survives
  // refreshes, tab closes, and revisits — not just the lifetime of the component.
  useEffect(() => { savePersisted("fleet", fleet); }, [fleet]);
  useEffect(() => { savePersisted("bookings", bookings); }, [bookings]);
  useEffect(() => { savePersisted("earnings", earnings); }, [earnings]);
  useEffect(() => { savePersisted("expenses", expenses); }, [expenses]);

  const todayStr = new Date().toISOString().split("T")[0];

  // Every consumer of this hook (Dashboard, Fleet, Booking, Alerts, P&L, ...)
  // reads `bookings` / `fleet` from its return value below — so deriving the
  // live status here, once, is what makes "add a booking" ripple everywhere:
  // the booking's own status, the car's status, KPI counts, alerts, and the
  // P&L all recompute from these same derived arrays on every render.
  const bookingsWithStatus = bookings.map(b => ({ ...b, status: computeBookingStatus(b, todayStr) }));
  const fleetWithStatus = fleet.map(c => ({ ...c, status: computeFleetStatus(c, bookingsWithStatus) }));

  // Whenever a booking's derived status becomes "Completed" and it doesn't yet
  // have a matching earning record, auto-create one (unlocked, pending review).
  // This replaces the old dead handleCompleteBooking in Earning.jsx, which was
  // never wired to anything.
  useEffect(() => {
    const completedIds = bookings
      .filter(b => computeBookingStatus(b, todayStr) === "Completed")
      .map(b => b.id);
    if (completedIds.length === 0) return;

    setEarnings(prev => {
      const existingBookingIds = new Set(prev.map(e => e.bookingId));
      const missing = bookings.filter(b => completedIds.includes(b.id) && !existingBookingIds.has(b.id));
      if (missing.length === 0) return prev;

      let nextNum = Math.max(...prev.map(e => parseInt(e.id.slice(3)) || 0), 0);
      const newRecords = missing.map(b => {
        nextNum += 1;
        const days = Math.round((new Date(b.end) - new Date(b.start)) / 86400000);
        return {
          id: `ER-${String(nextNum).padStart(3, "0")}`,
          bookingId: b.id,
          plate: b.plate,
          customer: b.customer,
          start: b.start,
          end: b.end,
          days,
          rate: b.rate,
          total: b.rate * days,
          locked: false,
        };
      });
      return [...prev, ...newRecords];
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bookings]);

  // A car goes straight back to "Available" once one of its bookings'
  // derived status becomes "Completed" (whether that's because the end date
  // passed, or because staff force-completed it early / confirmed a return).
  // The automatic "Maintenance" flow has been removed entirely — nothing
  // moves a car into Maintenance automatically anymore. maintenanceTriggered
  // just prevents this effect from re-firing once a booking's already been
  // handled.
  useEffect(() => {
    const newlyCompleted = bookings.filter(
      b => computeBookingStatus(b, todayStr) === "Completed" && !b.maintenanceTriggered
    );
    if (newlyCompleted.length === 0) return;

    const platesToRelease = new Set(newlyCompleted.map(b => b.plate));

    setFleet(prev => prev.map(c =>
      platesToRelease.has(c.plate)
        ? { ...c, status: "Available", maintenanceStartDate: null, maintenanceCompletedAt: todayStr, maintenanceAutoReleased: false }
        : c
    ));
    setBookings(prev => prev.map(b =>
      newlyCompleted.some(nb => nb.id === b.id) ? { ...b, maintenanceTriggered: true } : b
    ));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bookings]);

  // ── FLEET OPERATIONS ──────────────────────────────────────────────────────
  const addFleet = (car) => {
    const newCar = {
      ...car,
      purchase: parseFloat(car.purchase),
      insurance: parseFloat(car.insurance),
      reg: parseFloat(car.reg),
      otherCharges: parseFloat(car.otherCharges || 0),
      maint: parseFloat(car.maint),
    };
    setFleet(prev => [...prev, newCar]);
  };

  const updateFleet = (plate, updates) => {
    setFleet(prev => prev.map(c => c.plate === plate ? { ...c, ...updates } : c));
  };

  const deleteFleet = (plate) => {
    setFleet(prev => prev.filter(c => c.plate !== plate));
  };

  // Exposed to the booking form so it can block double-bookings before
  // calling addBooking. Returns the clashing booking, or null if the dates
  // are free for that car. Pass excludeBookingId when validating an edit.
  const checkBookingConflict = (plate, start, end, excludeBookingId) =>
    findOverlappingBooking(bookings, plate, start, end, excludeBookingId);

  // ── BOOKING OPERATIONS ────────────────────────────────────────────────────
  const addBooking = (booking) => {
    // Computed from `bookings` (already in scope) rather than inside the
    // setBookings updater — the updater only runs when React flushes the
    // state update, which is NOT synchronous with this call. Building
    // newBooking here means it's ready immediately for the caller to use
    // (e.g. FleetOpzApp.jsx passes the returned booking straight into
    // generateRentalAgreementPdf right after calling addBooking).
    const nextId = `BK-${String(Math.max(...bookings.map(b => parseInt(b.id.slice(3))), 0) + 1).padStart(3, "0")}`;
    const newBooking = {
      ...booking,
      id: nextId,
      rate: parseFloat(booking.rate),
      status: booking.status || "Active",
    };
    setBookings(prev => [...prev, newBooking]);
    return newBooking;
  };

  const updateBooking = (bookingId, updates) => {
    setBookings(prev => prev.map(b => b.id === bookingId ? { ...b, ...updates } : b));
  };

  const deleteBooking = (bookingId) => {
    setBookings(prev => prev.filter(b => b.id !== bookingId));
  };

  // ── EARNINGS OPERATIONS ───────────────────────────────────────────────────
  const addEarning = (earning) => {
    setEarnings(prev => {
      const nextId = `ER-${String(Math.max(...prev.map(e => parseInt(e.id.slice(3))), 0) + 1).padStart(3, "0")}`;
      const newEarning = {
        ...earning,
        id: nextId,
        total: parseFloat(earning.total),
      };
      return [...prev, newEarning];
    });
  };

  const updateEarning = (earningId, updates) => {
    setEarnings(prev => prev.map(e => e.id === earningId ? { ...e, ...updates } : e));
  };

  const deleteEarning = (earningId) => {
    setEarnings(prev => prev.filter(e => e.id !== earningId));
  };

  // Auto-lock earnings when booking is completed
  const lockEarning = (bookingId) => {
    const earning = earnings.find(e => e.bookingId === bookingId);
    if (earning) {
      updateEarning(earning.id, { locked: true });
    }
  };

  // ── EXPENSE OPERATIONS ────────────────────────────────────────────────────
  const addExpense = (expense) => {
    setExpenses(prev => {
      const nextId = `EX-${String(Math.max(...prev.map(e => parseInt(e.id.slice(3))), 0) + 1).padStart(3, "0")}`;
      const newExpense = {
        ...expense,
        id: nextId,
        amount: parseFloat(expense.amount),
      };
      return [...prev, newExpense];
    });
  };

  const updateExpense = (expenseId, updates) => {
    setExpenses(prev => prev.map(e => e.id === expenseId ? { ...e, ...updates } : e));
  };

  const deleteExpense = (expenseId) => {
    setExpenses(prev => prev.filter(e => e.id !== expenseId));
  };

  // ── CALCULATIONS ──────────────────────────────────────────────────────────
  const calculateMetrics = () => {
    const totalFleet = fleetWithStatus.length;
    const activeFleet = fleetWithStatus.filter(c => c.status === "On Rental").length;
    const availableFleet = fleetWithStatus.filter(c => c.status === "Available").length;
    const bookedCars = new Set(bookingsWithStatus.filter(b => b.status === "Active" || b.status === "Upcoming").map(b => b.plate)).size;

    const totalBookings = bookings.length;
    const uniqueCustomers = new Set(bookings.map(b => b.customer)).size;

    const totalEarnings = earnings.reduce((sum, e) => sum + (e.total || 0), 0);
    const lockedEarnings = earnings.filter(e => e.locked).reduce((sum, e) => sum + (e.total || 0), 0);
    const pendingEarnings = earnings.filter(e => !e.locked).reduce((sum, e) => sum + (e.total || 0), 0);

    const totalExpenses = expenses.reduce((sum, e) => sum + (e.amount || 0), 0);

    const netProfit = totalEarnings - totalExpenses;

    // The 6 automatic fleet/booking buckets for the dashboard — every one of
    // these is re-derived from fleetWithStatus / bookingsWithStatus above, so
    // they always reflect today's date with no manual bookkeeping.
    const fleetStatusCounts = {
      Available: fleetWithStatus.filter(c => c.status === "Available").length,
      Upcoming: fleetWithStatus.filter(c => c.status === "Upcoming").length,
      "On Rental": fleetWithStatus.filter(c => c.status === "On Rental").length,
      "Ending Today": fleetWithStatus.filter(c => c.status === "Ending Today").length,
      Maintenance: fleetWithStatus.filter(c => c.status === "Maintenance").length,
    };
    const bookingStatusCounts = {
      Upcoming: bookingsWithStatus.filter(b => b.status === "Upcoming").length,
      Active: bookingsWithStatus.filter(b => b.status === "Active").length,
      "Ending Today": bookingsWithStatus.filter(b => b.status === "Ending Today").length,
      Completed: bookingsWithStatus.filter(b => b.status === "Completed").length,
      Cancelled: bookingsWithStatus.filter(b => b.status === "Cancelled").length,
    };

    return {
      totalFleet,
      activeFleet,
      availableFleet,
      bookedCars,
      totalBookings,
      uniqueCustomers,
      totalEarnings,
      lockedEarnings,
      pendingEarnings,
      totalExpenses,
      netProfit,
      // Dashboard's 6 required buckets:
      availableCount: fleetStatusCounts.Available,
      upcomingCount: fleetStatusCounts.Upcoming,
      onRentalCount: fleetStatusCounts["On Rental"],
      endingTodayCount: fleetStatusCounts["Ending Today"],
      completedCount: bookingStatusCounts.Completed,
      maintenanceCount: fleetStatusCounts.Maintenance,
      fleetStatusCounts,
      bookingStatusCounts,
    };
  };

  const calculateMonthlyMetrics = (month) => {
    const monthEarnings = earnings.filter(e => e.start?.startsWith(month)).reduce((sum, e) => sum + (e.total || 0), 0);
    const monthExpenses = expenses.filter(e => e.date?.startsWith(month)).reduce((sum, e) => sum + (e.amount || 0), 0);
    const monthBookings = bookings.filter(b => b.start?.startsWith(month)).length;
    const monthCustomers = new Set(bookings.filter(b => b.start?.startsWith(month)).map(b => b.customer)).size;

    return {
      monthlyEarnings: monthEarnings,
      monthlyExpenses: monthExpenses,
      monthlyProfit: monthEarnings - monthExpenses,
      monthlyBookings: monthBookings,
      monthlyCustomers: monthCustomers,
    };
  };

  const calculateCarMetrics = (plate) => {
    const carEarnings = earnings.filter(e => e.plate === plate).reduce((sum, e) => sum + (e.total || 0), 0);
    const carExpenses = expenses.filter(e => e.plate === plate).reduce((sum, e) => sum + (e.amount || 0), 0);
    const carBookings = bookings.filter(b => b.plate === plate).length;
    const car = fleet.find(c => c.plate === plate);
    const totalInv = car ? (car.purchase + car.insurance + car.reg) : 0;
    const recoveryPct = totalInv > 0 ? Math.round((carEarnings / totalInv) * 100) : 0;

    return {
      earnings: carEarnings,
      expenses: carExpenses,
      profit: carEarnings - carExpenses,
      bookings: carBookings,
      investment: totalInv,
      recoveryPct: recoveryPct,
    };
  };

  // Per-car monthly revenue TARGET for a given month — derived from:
  //  1) how much of its purchase+insurance+reg cost was still unrecovered as of that month,
  //     spread over the months it had left before its COE expiry at that point in time
  //  2) its own maintenance-budget-per-month (annual maint % of investment, ÷ 12)
  //  3) a profit margin on top, so "target" means "profitable", not just "breakeven"
  const carMonthlyTarget = (car, month) => {
    const refDate = `${month}-28`; // a stable "as-of" day within the given month
    const inv = totalInv(car);
    const carEarningsToDate = earnings
      .filter(e => e.plate === car.plate && e.start && e.start.slice(0, 7) <= month)
      .reduce((s, e) => s + (e.total || 0), 0);
    const remainingInv = Math.max(inv - carEarningsToDate, 0);
    const daysLeft = Math.ceil((new Date(car.coe) - new Date(refDate)) / 86400000);
    const monthsLeft = Math.max(daysLeft / 30, 1); // never divide by 0 or a negative
    const monthlyDepreciation = remainingInv / monthsLeft;
    const monthlyMaint = (inv * (car.maint || 0) / 100) / 12;
    const breakeven = monthlyDepreciation + monthlyMaint;
    return breakeven * (1 + TARGET_MARGIN_PCT / 100);
  };

  // Fleet-wide monthly target for a given month (e.g. "2026-06") — sum of every car's own target.
  const calculateMonthlyTarget = (month) => {
    const total = fleet.reduce((sum, car) => sum + carMonthlyTarget(car, month), 0);
    return Math.round(total);
  };

  // A single car's monthly target, rounded — used by the Target vs Actual card.
  const calculateCarMonthlyTarget = (plate, month) => {
    const car = fleet.find(c => c.plate === plate);
    if (!car) return 0;
    return Math.round(carMonthlyTarget(car, month));
  };

  // Monthly operating BUDGET for a given month — the expected running cost baseline for the
  // whole fleet, built from each car's own annual maintenance % of its investment, ÷ 12.
  // Maintenance % doesn't change month to month, but the parameter is kept so this has the
  // same shape as calculateMonthlyTarget and can be extended later (e.g. once fleet records
  // track when a car joined, to exclude cars not yet owned in a given month).
  const calculateMonthlyBudget = (month) => {
    const total = fleet.reduce((sum, car) => sum + (totalInv(car) * (car.maint || 0) / 100) / 12, 0);
    return Math.round(total);
  };

  const getExpensesByCategory = (month) => {
    const monthExpenses = expenses.filter(e => e.date?.startsWith(month));
    const byCategory = {};

    monthExpenses.forEach(e => {
      byCategory[e.category] = (byCategory[e.category] || 0) + (e.amount || 0);
    });

    return byCategory;
  };

  const generateAlerts = () => {
    const alerts = [];
    const today = new Date().toISOString().split("T")[0];
    let alertId = 1;

    // Vehicle registration renewal alerts (car.coe holds the renewal/expiry
    // date field name — kept for data compatibility, relabeled everywhere in the UI)
    fleet.forEach(car => {
      const coeDate = new Date(car.coe);
      const today_date = new Date(today);
      const daysUntil = Math.ceil((coeDate - today_date) / (1000 * 60 * 60 * 24));

      if (daysUntil <= 90) {
        alerts.push({
          id: alertId++,
          type: "coe",
          plate: car.plate,
          car: `${car.make} ${car.model}`,
          msg: `Vehicle registration renewal due ${car.coe}`,
          days: Math.max(0, daysUntil),
          urgent: daysUntil <= 30,
        });
      }
    });

    // Maintenance pending alerts — a car that's been sitting in "Maintenance"
    // for 2+ days without being completed. It will auto-release at day 3
    // regardless (see the effect above), but this flags it before that happens.
    fleet.forEach(car => {
      if (car.status !== "Maintenance" || !car.maintenanceStartDate) return;
      const daysIn = Math.floor((new Date(today) - new Date(car.maintenanceStartDate)) / (1000 * 60 * 60 * 24));
      if (daysIn >= 2) {
        alerts.push({
          id: alertId++,
          type: "maintenance",
          plate: car.plate,
          car: `${car.make} ${car.model}`,
          msg: `In maintenance for ${daysIn} day${daysIn === 1 ? "" : "s"} — update or complete maintenance`,
          days: daysIn,
          urgent: daysIn >= 3,
        });
      }
    });

    // Booking return today alerts
    bookingsWithStatus.forEach(b => {
      const endDate = new Date(b.end).toISOString().split("T")[0];
      if (endDate === today && (b.status === "Active" || b.status === "Ending Today")) {
        alerts.push({
          id: alertId++,
          type: "return",
          plate: b.plate,
          car: fleet.find(c => c.plate === b.plate)?.make + " " + fleet.find(c => c.plate === b.plate)?.model,
          msg: `${b.customer} — Return by 6 PM`,
          days: 0,
          urgent: true,
        });
      }
    });

    // Upcoming booking alerts
    const tomorrow = new Date(new Date().getTime() + 86400000).toISOString().split("T")[0];
    bookings.forEach(b => {
      const startDate = new Date(b.start).toISOString().split("T")[0];
      if (startDate === tomorrow && (b.status === "Upcoming" || b.status === "Active")) {
        alerts.push({
          id: alertId++,
          type: "booking",
          plate: b.plate,
          car: fleet.find(c => c.plate === b.plate)?.make + " " + fleet.find(c => c.plate === b.plate)?.model,
          msg: `${b.customer} booking starts tomorrow`,
          days: 1,
          urgent: false,
        });
      }
    });

    return alerts;
  };

  // Wipes saved data and restores the original sample data — handy if local
  // storage gets into a bad state or the user just wants a clean slate.
  const resetData = () => {
    setFleet(INITIAL_FLEET);
    setBookings(INITIAL_BOOKINGS);
    setEarnings(INITIAL_EARNINGS);
    setExpenses(INITIAL_EXPENSES);
  };

  return {
    // Data
    fleet: fleetWithStatus,
    bookings: bookingsWithStatus,
    earnings,
    expenses,
    alerts: generateAlerts(),
    resetData,

    // Fleet operations
    addFleet,
    updateFleet,
    deleteFleet,

    // Booking operations
    addBooking,
    updateBooking,
    deleteBooking,
    checkBookingConflict,

    // Earnings operations
    addEarning,
    updateEarning,
    deleteEarning,
    lockEarning,

    // Expense operations
    addExpense,
    updateExpense,
    deleteExpense,

    // Calculations
    calculateMetrics,
    calculateMonthlyMetrics,
    calculateCarMetrics,
    calculateMonthlyTarget,
    calculateCarMonthlyTarget,
    calculateMonthlyBudget,
    getExpensesByCategory,
  };
};