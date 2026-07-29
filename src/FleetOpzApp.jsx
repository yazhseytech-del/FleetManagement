import { useState } from "react";
import { C } from "./theme";
import { Btn, Badge, Modal, Input, Select } from "./components";
import { useFleetData, buildAvailabilityConflictMessage, findCustomerByIC, computeCarAvailabilityTimeline } from "./useFleetData";

import AddCarWizard from "./AddCarWizard";
import { generateRentalAgreementPdf } from "./rentalAgreement";

import Dashboard from "./Dashboard";
import Fleet from "./Fleet";
import Booking from "./Booking";
import Earning from "./Earning";
import Expenses from "./Expenses";
import PlReport from "./pl report";
import Alert from "./Alert";
import Settings from "./Settings";

// Shared styling for the New Booking wizard's Step 1 (Customer Details)
// fields. These are plain <input>s rather than the shared <Input> component
// because they need guaranteed native `readOnly`/`disabled` behavior when a
// field is locked after an existing-customer match — <Input>'s prop surface
// isn't available to confirm it forwards those through.
const bookingFieldLabelStyle = { fontSize: 11, fontWeight: 600, color: C.textSec, display: "block", marginBottom: 6 };
const mono = { fontFamily: "'SF Mono', 'Consolas', 'Menlo', monospace" };
const bookingFieldInputStyle = (readOnly) => ({
  width: "100%", padding: "10px 12px", borderRadius: 8, border: `1px solid ${C.border}`,
  fontSize: 12.5, fontFamily: "inherit", outline: "none", boxSizing: "border-box",
  background: readOnly ? C.bg : C.surface, color: readOnly ? C.textMuted : C.textPri,
  cursor: readOnly ? "not-allowed" : "text",
});

const CALENDAR_STATUS_BG = { Available: "#dcfce7", "On Rental": "#ffedd5", Maintenance: "#fee2e2", "Ending Today": "#ffedd5" };
const CALENDAR_STATUS_TEXT = { Available: "#166534", "On Rental": "#9a3412", Maintenance: "#991b1b", "Ending Today": "#9a3412" };
const CALENDAR_WEEKDAYS = ["S", "M", "T", "W", "T", "F", "S"];
const toISODate = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

// Compact month calendar for the New Booking wizard's Step 2 — one instance
// each for Pickup Date and Return Date (rather than one shared range-select
// calendar), so both show the car's status colors independently. Status per
// day (Available/On Rental/Maintenance) comes from computeCarAvailabilityTimeline
// (useFleetData.js), the same source AvailabilityTimeline's 10-day strip
// uses, just requested over a wider window (120 days) and read into a
// year-month grid instead of a horizontal strip. Status is shown as each
// cell's background color.
// - Pickup calendar: any "Available" day is selectable.
// - Return calendar: takes `minDate` (the chosen pickup date) — days before
//   it are disabled, and every day from minDate through the clicked day must
//   be Available for the click to be accepted (a real bookable range can't
//   cross an On Rental/Maintenance day).
const SingleDateCalendar = ({ car, bookings, label, selectedDate, minDate, onSelect, onClear }) => {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const initial = selectedDate ? new Date(selectedDate + "T00:00:00")
    : minDate ? new Date(minDate + "T00:00:00")
    : today;
  const [viewYear, setViewYear] = useState(initial.getFullYear());
  const [viewMonth, setViewMonth] = useState(initial.getMonth()); // 0-indexed
  const [dayError, setDayError] = useState("");

  if (!car) return null;

  const timeline = computeCarAvailabilityTimeline(car, bookings, 120);
  const statusByDate = {};
  timeline.forEach(({ date, status }) => { statusByDate[date] = status; });

  const isPast = (d) => d < today;
  const getStatus = (d) => (isPast(d) ? "Past" : (statusByDate[toISODate(d)] || "Available"));
  const isAvailableDay = (d) => !isPast(d) && getStatus(d) === "Available";
  const isBeforeMin = (d) => minDate && toISODate(d) < minDate;

  const canGoPrev = viewYear > today.getFullYear() || (viewYear === today.getFullYear() && viewMonth > today.getMonth());

  const goPrev = () => {
    if (!canGoPrev) return;
    const m = viewMonth === 0 ? 11 : viewMonth - 1;
    setViewYear(viewMonth === 0 ? viewYear - 1 : viewYear);
    setViewMonth(m);
  };
  const goNext = () => {
    const m = viewMonth === 11 ? 0 : viewMonth + 1;
    setViewYear(viewMonth === 11 ? viewYear + 1 : viewYear);
    setViewMonth(m);
  };
  const goToday = () => {
    setViewYear(today.getFullYear());
    setViewMonth(today.getMonth());
  };

  const firstOfMonth = new Date(viewYear, viewMonth, 1);
  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
  const leadingBlanks = firstOfMonth.getDay(); // 0 = Sunday
  const cells = [...Array(leadingBlanks).fill(null), ...Array.from({ length: daysInMonth }, (_, i) => i + 1)];

  const monthLabel = `${firstOfMonth.toLocaleDateString(undefined, { month: "long" })}, ${viewYear}`;

  const handleDayClick = (day) => {
    const d = new Date(viewYear, viewMonth, day);
    if (isBeforeMin(d)) return;
    const iso = toISODate(d);

    if (minDate) {
      // Return calendar: every day from minDate through iso must be Available.
      let cursor = new Date(minDate + "T00:00:00");
      const end = new Date(iso + "T00:00:00");
      let allAvailable = true;
      while (cursor <= end) {
        if (!isAvailableDay(cursor)) { allAvailable = false; break; }
        cursor = new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate() + 1);
      }
      if (!allAvailable) {
        setDayError("That range crosses an unavailable date — pick an earlier return date.");
        return;
      }
    } else if (!isAvailableDay(d)) {
      return;
    }
    setDayError("");
    onSelect(iso);
  };

  return (
    <div style={{ border: `1px solid ${C.border}`, borderRadius: 10, padding: "16px 18px", marginTop: 8, marginBottom: 8, background: C.surface, maxWidth: 340 }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: C.textSec, marginBottom: 10, textTransform: "uppercase", letterSpacing: 0.3 }}>{label}</div>

      {/* Header: month/year + up/down nav */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: C.navy }}>{monthLabel}</div>
        <div style={{ display: "flex", gap: 4 }}>
          <button type="button" disabled={!canGoPrev} onClick={goPrev}
            style={{ background: "none", border: "none", cursor: canGoPrev ? "pointer" : "default", opacity: canGoPrev ? 1 : 0.3, fontSize: 14, color: C.navy, padding: 4 }}>↑</button>
          <button type="button" onClick={goNext}
            style={{ background: "none", border: "none", cursor: "pointer", fontSize: 14, color: C.navy, padding: 4 }}>↓</button>
        </div>
      </div>

      {/* Legend */}
      <div style={{ display: "flex", gap: 12, marginBottom: 12, flexWrap: "wrap" }}>
        {["Available", "On Rental", "Maintenance"].map(s => (
          <div key={s} style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 10, color: C.textSec }}>
            <span style={{ width: 10, height: 10, borderRadius: 3, background: CALENDAR_STATUS_BG[s], border: `1px solid ${CALENDAR_STATUS_TEXT[s]}22`, display: "inline-block" }} />
            {s}
          </div>
        ))}
      </div>

      {/* Weekday header */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", marginBottom: 4 }}>
        {CALENDAR_WEEKDAYS.map((w, i) => (
          <div key={i} style={{ textAlign: "center", fontSize: 10, fontWeight: 600, color: C.textMuted, padding: "2px 0" }}>{w}</div>
        ))}
      </div>

      {/* Day grid */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 3 }}>
        {cells.map((day, i) => {
          if (day === null) return <div key={`b${i}`} />;
          const d = new Date(viewYear, viewMonth, day);
          const iso = toISODate(d);
          const status = getStatus(d);
          const isSelected = iso === selectedDate;
          const isToday = iso === toISODate(today);
          const belowMin = isBeforeMin(d);
          // Return calendar (minDate set): any day from minDate onward is
          // clickable — handleDayClick validates the whole range. Pickup
          // calendar (no minDate): only Available days are clickable.
          const clickable = minDate ? (!isPast(d) && !belowMin) : isAvailableDay(d);
          const dimmed = !clickable && !isSelected;
          return (
            <button
              type="button"
              key={iso}
              disabled={!clickable && !isSelected}
              onClick={() => handleDayClick(day)}
              title={status}
              style={{
                padding: "7px 0", fontSize: 12, borderRadius: 6,
                border: isSelected ? `2px solid ${C.navy}` : isToday ? `1px solid ${C.navy}` : "1px solid transparent",
                fontFamily: "inherit", cursor: clickable ? "pointer" : "default", boxSizing: "border-box",
                background: status !== "Past" ? CALENDAR_STATUS_BG[status] : "transparent",
                color: status === "Past" ? C.border : CALENDAR_STATUS_TEXT[status],
                fontWeight: isSelected ? 700 : 500,
                opacity: dimmed ? 0.4 : 1,
              }}
            >
              {day}
            </button>
          );
        })}
      </div>

      {dayError && <div style={{ fontSize: 11, color: C.red, marginTop: 10 }}>{dayError}</div>}

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 14 }}>
        <div style={{ fontSize: 11, color: C.textMuted }}>
          {selectedDate ? <>Selected: <strong style={{ color: C.navy }}>{selectedDate}</strong></> : "No date selected"}
        </div>
        <div style={{ display: "flex", gap: 14 }}>
          <button type="button" onClick={() => { onClear(); setDayError(""); }}
            style={{ background: "none", border: "none", cursor: "pointer", fontSize: 11.5, fontWeight: 600, color: C.teal, padding: 0 }}>Clear</button>
          <button type="button" onClick={goToday}
            style={{ background: "none", border: "none", cursor: "pointer", fontSize: 11.5, fontWeight: 600, color: C.teal, padding: 0 }}>Today</button>
        </div>
      </div>
    </div>
  );
};

export default function FleetOpzApp() {
  const [active, setActive] = useState("dashboard");
  const [selectedCar, setSelectedCar] = useState("All Cars");
  const [selectedRange, setSelectedRange] = useState("2026-06");
  const [showNewBooking, setShowNewBooking] = useState(false);
  const [showNewFleet, setShowNewFleet] = useState(false);
  const [showNewUser, setShowNewUser] = useState(false);
  // Set to a booking id right after Create Booking succeeds, so the
  // Bookings screen auto-opens that booking's Detail view (Overview tab).
  // Booking.jsx consumes it once and calls back to clear it — see
  // onDetailBookingIdHandled below — so it never re-triggers.
  const [detailBookingId, setDetailBookingId] = useState(null);

  // No real auth in this build — the sidebar footer identity (Selvakumar /
  // Admin) is the de facto "logged in" user. Role gates (like who can see
  // Restricted Driving Licenses) read from this rather than being hardcoded
  // in each screen, so swapping in real auth later only means changing this.
  const [currentUserRole] = useState("Admin");

  // Driving licenses blocked from being used on a new booking (active
  // criminal case, court restriction, etc). Lifted up here — rather than
  // owned by Settings — because Booking creation needs to read it too.
  const [restrictedLicenses, setRestrictedLicenses] = useState([
    { id: "RL-1001", licenseNumber: "DL-2024-88213", reason: "Criminal Case", addedDate: "2026-05-10" },
  ]);

  const addRestrictedLicense = (entry) => {
    setRestrictedLicenses(prev => [
      ...prev,
      { id: `RL-${Date.now()}`, addedDate: new Date().toISOString().slice(0, 10), ...entry },
    ]);
  };
  const updateRestrictedLicense = (id, updates) => {
    setRestrictedLicenses(prev => prev.map(r => r.id === id ? { ...r, ...updates } : r));
  };
  const deleteRestrictedLicense = (id) => {
    setRestrictedLicenses(prev => prev.filter(r => r.id !== id));
  };

  // Initialize fleet data management hook
  const fleetData = useFleetData();

  const [newBookingData, setNewBookingData] = useState({
    plate: "",
    customer: "",
    ic: "",
    contact: "",
    passport: "",
    address: "",
    // start/end stay as combined "YYYY-MM-DDTHH:MM" strings — every existing
    // consumer (submit validation, conflict check, availability timeline,
    // PDF generation) reads these, so Step 2 shows separate Date/Time inputs
    // per the Rental Period design but keeps writing into these same two
    // fields underneath rather than forking the data model.
    start: "",
    end: "",
    pickupDate: "",
    pickupTime: "",
    returnDate: "",
    returnTime: "",
    pickup: "",
    drop: "",
    mileageOut: "",
    fuelOut: "",
    rate: "",
    deductible: "",
    vatRate: "",
    // New Pricing Details charge fields — separate optional line items beyond
    // the base daily rate. deductible (Security Deposit) stays a distinct
    // field: it's refundable, not a rental charge, so it's intentionally
    // excluded from the subtotal/VAT/total math below.
    deliveryCharge: "",
    collectionCharge: "",
    additionalDriverCharge: "",
    otherCharges: "",
    additionalDrivers: [], // [{ id, name, license, licenseExpiry, contact }] — optional
    license: "",
    licenseExpiry: "",
    attachment: null,   // { name, type, size, dataUrl } once a valid file is chosen
    comments: "",
    // Payment (Step 4) fields — collected at booking time, separate from the
    // pricing breakdown computed in Step 3. amountCollected defaults to "0"
    // (nothing paid yet) rather than the full total, since staff enter what
    // was actually handed over right now.
    amountCollected: "0",
    paymentMethod: "Cash",
    referenceCode: "",
  });
  const [attachmentError, setAttachmentError] = useState("");

  // The New Booking modal is now a 2-step wizard: Step 1 is Customer Details
  // (IC-driven auto-fill), Step 2 is Booking Details (unchanged submit logic,
  // reorganized fields). Reset to 1 whenever the modal is opened or closed
  // so it never reopens mid-wizard.
  const [bookingStep, setBookingStep] = useState(1);
  const BOOKING_STEP_COUNT = 5;

  // Combines a separate date + time pair into the single "YYYY-MM-DDTHH:MM"
  // string start/end already use everywhere else. Defaults the time to
  // midnight if only a date has been picked so far, rather than leaving a
  // half-built value that new Date(...) would choke on downstream.
  const combineDateTime = (date, time) => (date ? `${date}T${time || "00:00"}` : "");

  // Result of the last IC lookup against booking history — null means "no
  // match found yet" (either the IC is incomplete, or this really is a new
  // customer). Drives the "existing customer" banner and decides whether the
  // new-customer license fields need to be filled in from scratch.
  const [matchedCustomer, setMatchedCustomer] = useState(null);

  // IC Number typing — just normalizes the value as the user types (existing
  // behavior). The lookup itself is deliberately NOT run on every keystroke;
  // see handleICBlur. Capped at 15 chars rather than 9 so a full 15-digit
  // Emirates ID (784-YYYY-NNNNNNN-N) can actually be entered — the old
  // 9-char cap silently truncated Emirates IDs before they could ever match
  // isValidEmiratesIdOrPassport's 15-digit check.
  const handleICInputChange = (e) => {
    let v = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "");
    if (v.length > 15) v = v.slice(0, 15);
    setNewBookingData(prev => ({ ...prev, ic: v }));
  };

  // IC Number → check booking history for an existing customer once the
  // staff member finishes typing it (on blur), not on every keystroke.
  //   - Match found: auto-fill customer/contact/passport/license/expiry/
  //     address from the most recent booking with that IC, and lock every
  //     field except Customer Name (which stays editable in case the name
  //     needs correcting) so the rest can't be accidentally overwritten.
  //   - No match: unlock the fields for manual entry. If a previous match
  //     had locked them (e.g. the IC was just corrected to a different,
  //     unmatched number), clear the stale auto-filled values rather than
  //     leaving the last customer's details sitting in an unlocked field.
  const handleICBlur = () => {
    const match = findCustomerByIC(fleetData.bookings, newBookingData.ic);
    setMatchedCustomer(match);
    setNewBookingData(prev => {
      if (match) {
        return {
          ...prev,
          customer: prev.customer || match.customer,
          contact: match.contact,
          passport: match.passport,
          license: match.license,
          licenseExpiry: match.licenseExpiry,
          address: match.address,
        };
      }
      if (matchedCustomer) {
        return { ...prev, contact: "", passport: "", license: "", licenseExpiry: "", address: "" };
      }
      return prev;
    });
  };

  // Step 1 → Step 2. Requires Customer Name and a valid IC/passport before
  // moving on, since Step 2's submit no longer touches these fields at all.
  const handleBookingStep1Next = () => {
    if (!newBookingData.customer.trim()) {
      alert("Customer Name is required");
      return;
    }
    if (!isValidEmiratesIdOrPassport(newBookingData.ic)) {
      alert("Enter a valid Emirates ID (15 digits, e.g. 784-1990-1234567-1) or a passport number (6-9 characters)");
      return;
    }
    setBookingStep(2);
  };

  // Step 2 → Step 3. Requires a car, a valid rental period, and both
  // locations before moving into pricing — full validation (restricted
  // license, booking conflict, negative rate, etc.) still happens once, on
  // final submit in handleNewBookingSubmit, same as before.
  const handleBookingStep2Next = () => {
    if (!newBookingData.plate) {
      alert("Please select a car");
      return;
    }
    if (!newBookingData.start || !newBookingData.end) {
      alert("Pickup Date and Return Date are required");
      return;
    }
    if (new Date(newBookingData.end) <= new Date(newBookingData.start)) {
      alert("Return Date & Time must be after the Pickup Date & Time");
      return;
    }
    if (!newBookingData.pickup.trim() || !newBookingData.drop.trim()) {
      alert("Pickup Location and Drop Location are required");
      return;
    }
    setBookingStep(3);
  };

  // Currency for the New Booking wizard's pricing step is SGD, independent
  // of the "AED"-labeled fmt() used elsewhere in the app (Earnings, P&L,
  // rental agreement PDF, etc.) — those live in files outside this task's
  // scope, so only this wizard's own pricing display uses SGD for now.
  const formatSGD = (n) => `SGD ${Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  // Set only once handleNewBookingSubmit succeeds (holds the created booking
  // + its car). The Review step's "Agreement" button stays disabled while
  // this is null and only becomes clickable once it's populated — the modal
  // stays open on Review after a successful save so the enabled button is
  // visible in the same form, instead of auto-closing/auto-downloading.
  const [createdBookingInfo, setCreatedBookingInfo] = useState(null);

  const openNewBookingModal = () => {
    setBookingStep(1);
    setShowNewBooking(true);
  };

  const closeNewBookingModal = () => {
    setShowNewBooking(false);
    setBookingStep(1);
    setNewBookingData({ plate: "", customer: "", ic: "", contact: "", passport: "", address: "", start: "", end: "", pickupDate: "", pickupTime: "", returnDate: "", returnTime: "", pickup: "", drop: "", mileageOut: "", fuelOut: "", rate: "", deductible: "", vatRate: "", deliveryCharge: "", collectionCharge: "", additionalDriverCharge: "", otherCharges: "", additionalDrivers: [], license: "", licenseExpiry: "", attachment: null, comments: "", amountCollected: "0", paymentMethod: "Cash", referenceCode: "" });
    setAttachmentError("");
    setMatchedCustomer(null);
    setCreatedBookingInfo(null);
  };

  const [newUserData, setNewUserData] = useState({
    name: "",
    email: "",
    role: "Staff"
  });

  const NAV = [
    { id: "dashboard", label: "Dashboard", icon: "📊" },
    { id: "fleet", label: "Fleet", icon: "🚗" },
    { id: "bookings", label: "Bookings", icon: "📅" },
    { id: "earnings", label: "Earnings", icon: "💰" },
    { id: "expenses", label: "Expenses", icon: "📝" },
    { id: "pl", label: "P&L", icon: "📈" },
    { id: "alerts", label: "Alerts", icon: "🔔", badge: fleetData.alerts.length },
    { id: "settings", label: "Settings", icon: "⚙️" },
  ];

  const TAB_CONTENT = {
    dashboard: (
      <Dashboard
        fleet={fleetData.fleet}
        bookings={fleetData.bookings}
        earnings={fleetData.earnings}
        expenses={fleetData.expenses}
        alerts={fleetData.alerts}
        month={selectedRange}
        calculateMetrics={fleetData.calculateMetrics}
        calculateMonthlyMetrics={fleetData.calculateMonthlyMetrics}
        calculateCarMetrics={fleetData.calculateCarMetrics}
        calculateMonthlyTarget={fleetData.calculateMonthlyTarget}
        calculateCarMonthlyTarget={fleetData.calculateCarMonthlyTarget}
        calculateMonthlyBudget={fleetData.calculateMonthlyBudget}
        getExpensesByCategory={fleetData.getExpensesByCategory}
      />
    ),
    fleet: (
      <Fleet
        fleet={fleetData.fleet}
        onAddFleet={fleetData.addFleet}  // ✅ CRITICAL FIX: Pass the actual handler that will be called by AddCarWizard
        onUpdateCar={fleetData.updateFleet}
        onDeleteCar={fleetData.deleteFleet}
        onCompleteMaintenance={fleetData.completeMaintenance}
        calculateCarMetrics={fleetData.calculateCarMetrics}
        bookings={fleetData.bookings}
        expenses={fleetData.expenses}
        onAddExpense={fleetData.addExpense}
      />
    ),
    bookings: (
      <Booking
        bookings={fleetData.bookings}
        fleet={fleetData.fleet}
        onNewBooking={openNewBookingModal}
        onAddBooking={fleetData.addBooking}
        onUpdateBooking={fleetData.updateBooking}
        onDeleteBooking={fleetData.deleteBooking}
        detailBookingId={detailBookingId}
        onDetailBookingIdHandled={() => setDetailBookingId(null)}
      />
    ),
    earnings: (
      <Earning
        earnings={fleetData.earnings}
        fleet={fleetData.fleet}
        bookings={fleetData.bookings}
        onAddEarning={fleetData.addEarning}
        onUpdateEarning={fleetData.updateEarning}
        onDeleteEarning={fleetData.deleteEarning}
        onLockEarning={fleetData.lockEarning}
      />
    ),
    expenses: (
      <Expenses
        expenses={fleetData.expenses}
        fleet={fleetData.fleet}
        onAddExpense={fleetData.addExpense}
        onUpdateExpense={fleetData.updateExpense}
        onDeleteExpense={fleetData.deleteExpense}
      />
    ),
    pl: (
      <PlReport
        fleet={fleetData.fleet}
        bookings={fleetData.bookings}
        earnings={fleetData.earnings}
        expenses={fleetData.expenses}
        calculateMetrics={fleetData.calculateMetrics}
        calculateMonthlyMetrics={fleetData.calculateMonthlyMetrics}
        calculateCarMetrics={fleetData.calculateCarMetrics}
      />
    ),
    alerts: (
      <Alert
        alerts={fleetData.alerts}
        fleet={fleetData.fleet}
      />
    ),
    settings: (
      <Settings
        onAddUser={() => setShowNewUser(true)}
        currentUserRole={currentUserRole}
        restrictedLicenses={restrictedLicenses}
        onAddRestrictedLicense={addRestrictedLicense}
        onUpdateRestrictedLicense={updateRestrictedLicense}
        onDeleteRestrictedLicense={deleteRestrictedLicense}
      />
    ),
  };

  const topbar = {
    dashboard: { title: "Fleet Dashboard", sub: `${fleetData.fleet.length} cars · ${fleetData.bookings.filter(b => b.status === "Active").length} active` },
    fleet: { title: "Fleet Management", sub: `${fleetData.fleet.length} cars registered` },
    bookings: { title: "Bookings", sub: `${fleetData.bookings.length} total bookings` },
    earnings: { title: "Actual Earnings", sub: "Locked rental income records" },
    expenses: { title: "Expense Management", sub: "Log and track running costs" },
    pl: { title: "P&L Reports", sub: "Profitability by car and fleet" },
    alerts: { title: "Alerts", sub: `${fleetData.alerts.length} active alerts` },
    settings: { title: "Settings", sub: "Company profile and users" },
  };

  const ALLOWED_ATTACHMENT_EXTENSIONS = ["jpg", "jpeg", "png", "pdf", "doc", "docx", "xls", "xlsx"];
  const MAX_ATTACHMENT_SIZE = 5 * 1024 * 1024; // 5MB

  const handleAttachmentChange = (e) => {
    const file = e.target.files[0];
    e.target.value = ""; // reset so choosing the same file again still fires onChange
    if (!file) return;

    const ext = file.name.split(".").pop().toLowerCase();
    if (!ALLOWED_ATTACHMENT_EXTENSIONS.includes(ext)) {
      setAttachmentError(`Unsupported file type ".${ext}". Allowed: JPG, JPEG, PNG, PDF, DOC, DOCX, XLS, XLSX.`);
      return;
    }
    if (file.size > MAX_ATTACHMENT_SIZE) {
      setAttachmentError(`File is too large (${(file.size / (1024 * 1024)).toFixed(1)}MB). Maximum size is 5MB.`);
      return;
    }

    setAttachmentError("");
    const reader = new FileReader();
    reader.onload = () => {
      setNewBookingData(prev => ({
        ...prev,
        attachment: { name: file.name, type: file.type, size: file.size, dataUrl: reader.result },
      }));
    };
    reader.readAsDataURL(file);
  };

  // Accepts either a 15-digit UAE Emirates ID (784-YYYY-NNNNNNN-N) or a
  // passport number (6-9 alphanumeric characters) — Dubai rentals commonly
  // serve both UAE residents and international tourists.
  const isValidEmiratesIdOrPassport = (v) => {
    const digitsOnly = v.replace(/[^0-9]/g, "");
    if (digitsOnly.length === 15) return digitsOnly.startsWith("784");
    const alnum = v.replace(/[^A-Z0-9]/gi, "");
    return /^[A-Z0-9]{6,9}$/i.test(alnum);
  };

  // Booking/Return now capture date + time (datetime-local, e.g.
  // "2026-07-21T14:30"), so format them for anything shown back to the user.
  const formatDateTime = (v) => {
    if (!v) return "";
    const d = new Date(v);
    if (isNaN(d)) return v;
    return d.toLocaleString(undefined, { year: "numeric", month: "short", day: "2-digit", hour: "2-digit", minute: "2-digit" });
  };

  const handleNewBookingSubmit = (e) => {
    e.preventDefault();
    
    if (newBookingData.contact.length !== 10) {
      alert("Contact number must be exactly 10 digits");
      return;
    }
    if (!isValidEmiratesIdOrPassport(newBookingData.ic)) {
      alert("Enter a valid Emirates ID (15 digits, e.g. 784-1990-1234567-1) or a passport number (6-9 characters)");
      return;
    }
    // Pickup/Drop Location are required — an empty or whitespace-only value
    // isn't a real location, so trim before checking.
    if (!newBookingData.pickup.trim()) {
      alert("Pickup Location is required");
      return;
    }
    if (!newBookingData.drop.trim()) {
      alert("Drop Location is required");
      return;
    }
    // Block booking outright if this driving license is on the restricted
    // list (active criminal case, court restriction, etc). Checked
    // case/whitespace-insensitively since Settings and this form both
    // uppercase on entry, but stay defensive either way.
    const normalizeLicense = (v) => (v || "").trim().toUpperCase();
    const restrictedMatch = restrictedLicenses.find(
      r => normalizeLicense(r.licenseNumber) === normalizeLicense(newBookingData.license)
    );
    if (restrictedMatch) {
      alert("This driving license has an active criminal case. Booking cannot be created.");
      return;
    }
    if (Number(newBookingData.rate) < 0) {
      alert("Daily rate cannot be negative");
      return;
    }
    // Return date/time must always be after the booking date/time.
    if (new Date(newBookingData.end) <= new Date(newBookingData.start)) {
      alert("Return Date & Time must be after the Booking Date & Time");
      return;
    }
    // The selected car must actually exist (defends against a stale dropdown
    // — e.g. it was deleted from the fleet while this modal was open). Its
    // current fleet status (Available/Upcoming/On Rental/Maintenance) is
    // NOT checked here — a car with a future booking is still bookable for
    // any date range before that booking starts. The conflict check below,
    // driven entirely by the requested dates, is the single source of truth
    // for whether this specific range is actually free.
    const selectedCar = fleetData.fleet.find(c => c.plate === newBookingData.plate);
    if (!selectedCar) {
      alert(`${newBookingData.plate} could not be found in the fleet. Please pick another car.`);
      return;
    }
    // Prevent double-booking: same car, overlapping dates.
    const conflict = fleetData.checkBookingConflict(newBookingData.plate, newBookingData.start, newBookingData.end);
    if (conflict) {
      alert(buildAvailabilityConflictMessage(conflict, newBookingData.start));
      return;
    }
    const createdBooking = fleetData.addBooking({
      ...newBookingData,
      status: "Active",
    });
    // Booking succeeded — unlock the Agreement button on this same Review
    // step instead of generating the PDF automatically. The modal stays
    // open so the user sees the button flip from disabled to enabled; they
    // download when ready, then close via the "Done" button.
    setCreatedBookingInfo({ booking: createdBooking, car: selectedCar });
  };

  const handleDownloadAgreement = () => {
    if (!createdBookingInfo) return;
    generateRentalAgreementPdf(createdBookingInfo.booking, createdBookingInfo.car);
  };

  // Called from the "Done" button that replaces "Confirm & Create Booking"
  // once a booking has been created — closes the modal and lands the user
  // on the Bookings screen with the new booking's Detail view open.
  const handleFinishBookingFlow = () => {
    const bookingId = createdBookingInfo?.booking?.id;
    closeNewBookingModal();
    if (bookingId) {
      setActive("bookings");
      setDetailBookingId(bookingId);
    }
  };

  const handleNewUserSubmit = (e) => {
    e.preventDefault();
    alert(`User added: ${newUserData.name} (${newUserData.role}) — ${newUserData.email}`);
    setNewUserData({ name: "", email: "", role: "Staff" });
    setShowNewUser(false);
  };

  // Derived pricing for Step 3 (Pricing & Charges) — recomputed from
  // newBookingData on every render since it's cheap arithmetic; nothing here
  // is written back into state until Create Booking actually submits.
  const bookingDays = (newBookingData.start && newBookingData.end)
    ? Math.max(0, Math.round((new Date(newBookingData.end) - new Date(newBookingData.start)) / 86400000))
    : 0;
  const bookingRateCharge = (Number(newBookingData.rate) || 0) * bookingDays;
  const bookingDeliveryCharge = Number(newBookingData.deliveryCharge) || 0;
  const bookingCollectionCharge = Number(newBookingData.collectionCharge) || 0;
  const bookingAdditionalDriverCharge = Number(newBookingData.additionalDriverCharge) || 0;
  const bookingOtherCharges = Number(newBookingData.otherCharges) || 0;
  // Security Deposit is refundable, not a rental charge — kept out of the
  // subtotal/VAT/total math and shown only as an informational figure
  // (Step 4 Payment, and later the Charges & Payment tab).
  const bookingDeductible = Number(newBookingData.deductible) || 0;
  const bookingVatRatePct = Number(newBookingData.vatRate) || 0;
  const bookingSubtotal = bookingRateCharge + bookingDeliveryCharge + bookingCollectionCharge + bookingAdditionalDriverCharge + bookingOtherCharges;
  const bookingVatAmount = bookingSubtotal * (bookingVatRatePct / 100);
  const bookingTotal = bookingSubtotal + bookingVatAmount;
  // Derived for Step 4 (Payment) / Step 5 (Review) — how much is still owed
  // after whatever's being collected right now. Not clamped to zero: an
  // overpayment should surface as a visibly negative balance rather than
  // being silently hidden, since that's a real number staff need to see.
  const bookingAmountCollected = Number(newBookingData.amountCollected) || 0;
  const bookingBalance = bookingTotal - bookingAmountCollected;

  return (
    <div style={{ display: "flex", minHeight: "100vh", background: C.bg, fontFamily: "'Inter', 'Segoe UI', sans-serif", fontSize: 13, color: C.textPri }}>

      {/* SIDEBAR */}
      <aside style={{ width: 220, background: C.navy, minHeight: "100vh", display: "flex", flexDirection: "column", position: "fixed", top: 0, left: 0, bottom: 0, zIndex: 100 }}>
        {/* Logo */}
        <div style={{ padding: "18px 20px 14px", borderBottom: "1px solid rgba(255,255,255,0.08)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{ width: 32, height: 32, background: C.teal, borderRadius: 8, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16 }}>🚗</div>
            <div>
              <div style={{ color: "#fff", fontWeight: 700, fontSize: 15, letterSpacing: -0.3 }}>FleetOpz</div>
              <div style={{ color: C.tealLight, fontSize: 10, fontWeight: 500, letterSpacing: 1.5, textTransform: "uppercase" }}>Car Rental SaaS</div>
            </div>
          </div>
        </div>

        {/* Nav */}
        <nav style={{ flex: 1, overflowY: "auto", paddingBottom: 10, marginTop: 6 }}>
          <div style={{ padding: "10px 20px 4px", fontSize: 9, fontWeight: 600, letterSpacing: 1.8, color: "rgba(255,255,255,0.3)", textTransform: "uppercase" }}>Operations</div>
          {NAV.slice(0, 3).map(n => (
            <div key={n.id} onClick={() => setActive(n.id)}
              style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 20px", cursor: "pointer", fontSize: 12.5, fontWeight: active === n.id ? 600 : 400, color: active === n.id ? "#fff" : "rgba(255,255,255,0.55)", background: active === n.id ? "rgba(10,140,126,0.2)" : "transparent", borderLeft: `3px solid ${active === n.id ? C.tealLight : "transparent"}`, transition: "all 0.15s" }}>
              <span style={{ width: 16, textAlign: "center" }}>{n.icon}</span>
              {n.label}
            </div>
          ))}

          <div style={{ padding: "10px 20px 4px", marginTop: 10, fontSize: 9, fontWeight: 600, letterSpacing: 1.8, color: "rgba(255,255,255,0.3)", textTransform: "uppercase" }}>Finance</div>
          {NAV.slice(3, 6).map(n => (
            <div key={n.id} onClick={() => setActive(n.id)}
              style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 20px", cursor: "pointer", fontSize: 12.5, fontWeight: active === n.id ? 600 : 400, color: active === n.id ? "#fff" : "rgba(255,255,255,0.55)", background: active === n.id ? "rgba(10,140,126,0.2)" : "transparent", borderLeft: `3px solid ${active === n.id ? C.tealLight : "transparent"}`, transition: "all 0.15s" }}>
              <span style={{ width: 16, textAlign: "center" }}>{n.icon}</span>
              {n.label}
            </div>
          ))}

          <div style={{ padding: "10px 20px 4px", marginTop: 10, fontSize: 9, fontWeight: 600, letterSpacing: 1.8, color: "rgba(255,255,255,0.3)", textTransform: "uppercase" }}>System</div>
          {NAV.slice(6).map(n => (
            <div key={n.id} onClick={() => setActive(n.id)}
              style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 20px", cursor: "pointer", fontSize: 12.5, fontWeight: active === n.id ? 600 : 400, color: active === n.id ? "#fff" : "rgba(255,255,255,0.55)", background: active === n.id ? "rgba(10,140,126,0.2)" : "transparent", borderLeft: `3px solid ${active === n.id ? C.tealLight : "transparent"}`, transition: "all 0.15s" }}>
              <span style={{ width: 16, textAlign: "center" }}>{n.icon}</span>
              <span style={{ flex: 1 }}>{n.label}</span>
              {n.badge && <span style={{ background: C.red, color: "#fff", fontSize: 9, padding: "1px 6px", borderRadius: 10, fontWeight: 700 }}>{n.badge}</span>}
            </div>
          ))}
        </nav>

        {/* User footer */}
        <div style={{ padding: "14px 20px", borderTop: "1px solid rgba(255,255,255,0.08)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{ width: 30, height: 30, borderRadius: "50%", background: C.teal, color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: 700 }}>SK</div>
            <div>
              <div style={{ color: "#fff", fontSize: 12, fontWeight: 600 }}>Selvakumar</div>
              <div style={{ color: "rgba(255,255,255,0.4)", fontSize: 10 }}>Admin</div>
            </div>
          </div>
        </div>
      </aside>

      {/* MAIN */}
      <main style={{ marginLeft: 220, flex: 1, display: "flex", flexDirection: "column" }}>
        {/* Topbar */}
        <header style={{ height: 60, background: C.surface, borderBottom: `1px solid ${C.border}`, display: "flex", alignItems: "center", padding: "0 24px", gap: 16, position: "sticky", top: 0, zIndex: 50 }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 15, fontWeight: 700, color: C.navy }}>{topbar[active]?.title}</div>
            <div style={{ fontSize: 11, color: C.textMuted }}>{topbar[active]?.sub}</div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <select value={selectedCar} onChange={e => setSelectedCar(e.target.value)}
              style={{ background: C.bg, border: `1px solid ${C.border}`, borderRadius: 8, padding: "6px 10px", fontSize: 12, color: C.textPri, fontFamily: "inherit", cursor: "pointer", outline: "none" }}>
              <option>All Cars</option>
              {fleetData.fleet.map(c => <option key={c.plate}>{c.plate}</option>)}
            </select>
            <select value={selectedRange} onChange={e => setSelectedRange(e.target.value)}
              style={{ background: C.bg, border: `1px solid ${C.border}`, borderRadius: 8, padding: "6px 10px", fontSize: 12, color: C.textPri, fontFamily: "inherit", cursor: "pointer", outline: "none" }}>
              <option value="all">All Months (YTD)</option>
              <option value="2026-01">January 2026</option>
              <option value="2026-02">February 2026</option>
              <option value="2026-03">March 2026</option>
              <option value="2026-04">April 2026</option>
              <option value="2026-05">May 2026</option>
              <option value="2026-06">June 2026</option>
              <option value="2026-07">July 2026</option>
              <option value="2026-08">August 2026</option>
              <option value="2026-09">September 2026</option>
              <option value="2026-10">October 2026</option>
              <option value="2026-11">November 2026</option>
              <option value="2026-12">December 2026</option>
            </select>
          </div>
        </header>

        {/* Content */}
        <div style={{ flex: 1, overflow: "auto", padding: "24px" }}>
          {TAB_CONTENT[active]}
        </div>
      </main>

      {/* NEW BOOKING MODAL — large, near-fullscreen 2-step wizard (custom
          overlay rather than the shared <Modal>, so it can be sized to match
          Fleet's large wizard-style modal instead of the small centered
          popup <Modal> renders elsewhere). */}
      {showNewBooking && (
        <>
          <style>{`
            @keyframes bookingWizardFade { from { opacity: 0; } to { opacity: 1; } }
            @keyframes bookingWizardPop { from { opacity: 0; transform: translate(-50%, -50%) scale(0.97); } to { opacity: 1; transform: translate(-50%, -50%) scale(1); } }
          `}</style>
          <div onClick={closeNewBookingModal} style={{ position: "fixed", inset: 0, background: "rgba(15, 23, 42, 0.35)", zIndex: 200, animation: "bookingWizardFade 0.15s ease" }} />
          <div style={{
            position: "fixed", top: "50%", left: "50%", transform: "translate(-50%, -50%)",
            width: "94vw", maxWidth: 820, height: "90vh", maxHeight: 880,
            background: C.surface, zIndex: 201, display: "flex", flexDirection: "column",
            border: `1px solid ${C.border}`, borderRadius: 14,
            boxShadow: "0 24px 60px rgba(15, 23, 42, 0.25)", animation: "bookingWizardPop 0.18s cubic-bezier(.2,.8,.2,1)",
            overflow: "hidden",
          }}>
            {/* Header */}
            <div style={{ padding: "18px 24px 16px", borderBottom: `1px solid ${C.border}`, flexShrink: 0 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                <div>
                  <div style={{ fontSize: 17, fontWeight: 700, color: C.navy }}>New Booking</div>
                  <div style={{ fontSize: 11.5, color: C.textMuted, marginTop: 2 }}>
                    Step {bookingStep} of {BOOKING_STEP_COUNT} — {["Customer Details", "Booking Details", "Pricing & Charges", "Payment", "Review & Confirm"][bookingStep - 1]}
                  </div>
                </div>
                <button onClick={closeNewBookingModal} aria-label="Close" style={{ background: "none", border: "none", fontSize: 18, color: C.textMuted, cursor: "pointer", lineHeight: 1, padding: 4 }}>✕</button>
              </div>
              <div style={{ display: "flex", gap: 6, marginTop: 14 }}>
                {Array.from({ length: BOOKING_STEP_COUNT }).map((_, i) => (
                  <div key={i} style={{ flex: 1, height: 5, borderRadius: 3, background: i < bookingStep ? C.teal : C.border }} />
                ))}
              </div>
            </div>

            {/* Body */}
            <div style={{ flex: 1, overflowY: "auto", padding: "22px 24px" }}>
              {bookingStep === 1 ? (
                <>
                  <div style={{ fontSize: 13, fontWeight: 700, color: C.navy, marginBottom: 16 }}>👤 Customer Information</div>

                  <div style={{ marginBottom: 14 }}>
                    <label style={bookingFieldLabelStyle}>IC Number <span style={{ color: C.red }}>*</span></label>
                    <input
                      type="text"
                      value={newBookingData.ic}
                      onChange={handleICInputChange}
                      onBlur={handleICBlur}
                      placeholder=" S8901234A"
                      style={bookingFieldInputStyle(false)}
                    />
                    {matchedCustomer && (
                      <div style={{ fontSize: 10.5, color: C.teal, marginTop: 5, fontWeight: 600 }}>
                        ✓ Existing customer found — details auto-filled below. Only Customer Name can be edited.
                      </div>
                    )}
                  </div>

                  <div style={{ marginBottom: 14 }}>
                    <label style={bookingFieldLabelStyle}>Customer Name <span style={{ color: C.red }}>*</span></label>
                    <input
                      type="text"
                      value={newBookingData.customer}
                      onChange={(e) => setNewBookingData({ ...newBookingData, customer: e.target.value })}
                      placeholder=" Ahmed Al Mansoori"
                      style={bookingFieldInputStyle(false)}
                    />
                  </div>

                  <div style={{ marginBottom: 14 }}>
                    <label style={bookingFieldLabelStyle}>Contact Number</label>
                    <input
                      type="text"
                      value={newBookingData.contact}
                      readOnly={!!matchedCustomer}
                      onChange={(e) => {
                        if (matchedCustomer) return;
                        const v = e.target.value.replace(/\D/g, "").slice(0, 10);
                        setNewBookingData({ ...newBookingData, contact: v });
                      }}
                      placeholder=" 9501234567"
                      style={bookingFieldInputStyle(!!matchedCustomer)}
                    />
                  </div>

                
                
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 14 }}>
                    <div>
                      <label style={bookingFieldLabelStyle}>Driving License Number</label>
                      <input
                        type="text"
                        value={newBookingData.license}
                        readOnly={!!matchedCustomer}
                        onChange={(e) => !matchedCustomer && setNewBookingData({ ...newBookingData, license: e.target.value.toUpperCase() })}
                        placeholder=" DL-2024-88213"
                        style={bookingFieldInputStyle(!!matchedCustomer)}
                      />
                      {newBookingData.license && restrictedLicenses.some(
                        r => r.licenseNumber.trim().toUpperCase() === newBookingData.license.trim().toUpperCase()
                      ) && (
                        <div style={{ fontSize: 10.5, color: C.red, marginTop: 5, fontWeight: 600 }}>
                          This driving license has an active criminal case. Booking cannot be created.
                        </div>
                      )}
                    </div>
                    <div>
                      <label style={bookingFieldLabelStyle}>License Expiry Date</label>
                      <input
                        type="date"
                        value={newBookingData.licenseExpiry}
                        disabled={!!matchedCustomer}
                        onChange={(e) => !matchedCustomer && setNewBookingData({ ...newBookingData, licenseExpiry: e.target.value })}
                        style={bookingFieldInputStyle(!!matchedCustomer)}
                      />
                    </div>
                  </div>

                  <div>
                    <label style={bookingFieldLabelStyle}>Rental / Home Address</label>
                    <input
                      type="text"
                      value={newBookingData.address}
                      readOnly={!!matchedCustomer}
                      onChange={(e) => !matchedCustomer && setNewBookingData({ ...newBookingData, address: e.target.value })}
                      placeholder=" 02-81 Pandan Gardens, Block 410, Singapore"
                      style={bookingFieldInputStyle(!!matchedCustomer)}
                    />
                  </div>
                </>
              ) : bookingStep === 2 ? (
                <>
                  <Select
                    label="Car (Plate)"
                    value={newBookingData.plate}
                    onChange={(e) => {
                      const plate = e.target.value;
                      const car = fleetData.fleet.find(c => c.plate === plate);
                      if (car && !car.targetRate) {
                        alert(`No target rental rate set for ${plate}. Please set a target rate in Fleet before booking this car.`);
                        setNewBookingData({ ...newBookingData, plate, rate: "" });
                        return;
                      }
                      setNewBookingData({ ...newBookingData, plate, rate: car ? car.targetRate : "" });
                    }}
                    options={
                      fleetData.fleet.length > 0
                        ? fleetData.fleet.map(c => ({ value: c.plate, label: c.plate }))
                        : [{ value: "", label: "No cars in fleet" }]
                    }
                  />

                  <div style={{ fontSize: 13, fontWeight: 700, color: C.navy, margin: "18px 0 14px" }}>📅 Rental Period</div>

                  {newBookingData.plate ? (
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                      <SingleDateCalendar
                        label="Pickup Date"
                        car={fleetData.fleet.find(c => c.plate === newBookingData.plate)}
                        bookings={fleetData.bookings}
                        selectedDate={newBookingData.pickupDate}
                        onSelect={(iso) => {
                          setNewBookingData(prev => {
                            // If the existing return date is now before the new
                            // pickup date, clear it — it's no longer valid.
                            const returnDate = prev.returnDate && prev.returnDate < iso ? "" : prev.returnDate;
                            return {
                              ...prev,
                              pickupDate: iso,
                              returnDate,
                              start: combineDateTime(iso, prev.pickupTime),
                              end: combineDateTime(returnDate, prev.returnTime),
                            };
                          });
                        }}
                        onClear={() => {
                          setNewBookingData(prev => ({ ...prev, pickupDate: "", returnDate: "", start: "", end: "" }));
                        }}
                      />
                      <SingleDateCalendar
                        label="Return Date"
                        car={fleetData.fleet.find(c => c.plate === newBookingData.plate)}
                        bookings={fleetData.bookings}
                        selectedDate={newBookingData.returnDate}
                        minDate={newBookingData.pickupDate}
                        onSelect={(iso) => {
                          setNewBookingData(prev => ({
                            ...prev,
                            returnDate: iso,
                            end: combineDateTime(iso, prev.returnTime),
                          }));
                        }}
                        onClear={() => {
                          setNewBookingData(prev => ({ ...prev, returnDate: "", end: "" }));
                        }}
                      />
                    </div>
                  ) : (
                    <div style={{ fontSize: 12, color: C.textMuted, padding: "10px 0" }}>Select a car above to see its availability and pick rental dates.</div>
                  )}

                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginTop: 14 }}>
                    <div>
                      <label style={bookingFieldLabelStyle}>Pickup Time</label>
                      <input
                        type="time"
                        value={newBookingData.pickupTime}
                        onChange={(e) => {
                          const pickupTime = e.target.value;
                          setNewBookingData(prev => ({ ...prev, pickupTime, start: combineDateTime(prev.pickupDate, pickupTime) }));
                        }}
                        style={bookingFieldInputStyle(false)}
                      />
                    </div>
                    <div>
                      <label style={bookingFieldLabelStyle}>Return Time</label>
                      <input
                        type="time"
                        value={newBookingData.returnTime}
                        onChange={(e) => {
                          const returnTime = e.target.value;
                          setNewBookingData(prev => ({ ...prev, returnTime, end: combineDateTime(prev.returnDate, returnTime) }));
                        }}
                        style={bookingFieldInputStyle(false)}
                      />
                    </div>
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginTop: 14 }}>
                    <Input
                      label="Pickup Location"
                      value={newBookingData.pickup}
                      onChange={(e) => setNewBookingData({ ...newBookingData, pickup: e.target.value })}
                      placeholder="e.g., Dubai Marina"
                    />
                    <Input
                      label="Drop Location"
                      value={newBookingData.drop}
                      onChange={(e) => setNewBookingData({ ...newBookingData, drop: e.target.value })}
                      placeholder="e.g., Downtown Dubai"
                    />
                  </div>

                  <div style={{ fontSize: 13, fontWeight: 700, color: C.navy, margin: "18px 0 14px" }}>⛽ Vehicle Condition at Pickup</div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 14 }}>
                    <div>
                      <label style={bookingFieldLabelStyle}>Mileage Out (km)</label>
                      <input
                        type="number"
                        min="0"
                        value={newBookingData.mileageOut}
                        onChange={(e) => {
                          const v = e.target.value;
                          if (v !== "" && Number(v) < 0) return;
                          setNewBookingData({ ...newBookingData, mileageOut: v });
                        }}
                        placeholder="e.g., 9210"
                        style={bookingFieldInputStyle(false)}
                      />
                    </div>
                    <Select
                      label="Fuel Out"
                      value={newBookingData.fuelOut}
                      onChange={(e) => setNewBookingData({ ...newBookingData, fuelOut: e.target.value })}
                      options={[
                        { value: "", label: "Select fuel level" },
                        { value: "Empty", label: "Empty" },
                        { value: "1/4", label: "1/4" },
                        { value: "1/2", label: "1/2" },
                        { value: "3/4", label: "3/4" },
                        { value: "Full", label: "Full" },
                      ]}
                    />
                  </div>

                  <Input
                    label="Daily Rate (SGD)"
                    type="number"
                    min="0"
                    value={newBookingData.rate}
                    onChange={(e) => {
                      const v = e.target.value;
                      if (v !== "" && Number(v) < 0) return;
                      setNewBookingData({ ...newBookingData, rate: v });
                    }}
                    placeholder="Select a car to auto-fill"
                  />

                  {/* Additional Drivers — optional, one or more people besides the
                      main customer who are permitted to drive during this rental.
                      Any per-driver fee is a separate manual line (Step 3's
                      Additional Driver Charge) — not tied to how many are listed here. */}
                  <div style={{ marginTop: 18, marginBottom: 14 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                      <div style={{ fontSize: 13, fontWeight: 700, color: C.navy }}>🧑‍🤝‍🧑 Additional Drivers <span style={{ fontWeight: 400, color: C.textMuted, fontSize: 11 }}>(optional)</span></div>
                      <button
                        type="button"
                        onClick={() => setNewBookingData({
                          ...newBookingData,
                          additionalDrivers: [...newBookingData.additionalDrivers, { id: `${Date.now()}`, name: "", license: "", licenseExpiry: "", contact: "" }],
                        })}
                        style={{ fontSize: 11.5, fontWeight: 600, color: C.teal, background: "none", border: `1px solid ${C.teal}`, borderRadius: 7, padding: "5px 10px", cursor: "pointer" }}
                      >
                        + Add Driver
                      </button>
                    </div>

                    {newBookingData.additionalDrivers.map((driver, idx) => (
                      <div key={driver.id} style={{ border: `1px solid ${C.border}`, borderRadius: 10, padding: "12px 14px", marginBottom: 10, background: C.bg }}>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                          <div style={{ fontSize: 11.5, fontWeight: 700, color: C.textSec }}>Driver {idx + 1}</div>
                          <button
                            type="button"
                            onClick={() => setNewBookingData({ ...newBookingData, additionalDrivers: newBookingData.additionalDrivers.filter(d => d.id !== driver.id) })}
                            style={{ fontSize: 10.5, fontWeight: 600, color: C.red, background: "none", border: "none", cursor: "pointer" }}
                          >
                            Remove
                          </button>
                        </div>
                        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                          <div>
                            <label style={bookingFieldLabelStyle}>Name</label>
                            <input
                              type="text"
                              value={driver.name}
                              onChange={(e) => setNewBookingData({
                                ...newBookingData,
                                additionalDrivers: newBookingData.additionalDrivers.map(d => d.id === driver.id ? { ...d, name: e.target.value } : d),
                              })}
                              placeholder="Driver's full name"
                              style={bookingFieldInputStyle(false)}
                            />
                          </div>
                          <div>
                            <label style={bookingFieldLabelStyle}>Driving License No.</label>
                            <input
                              type="text"
                              value={driver.license}
                              onChange={(e) => setNewBookingData({
                                ...newBookingData,
                                additionalDrivers: newBookingData.additionalDrivers.map(d => d.id === driver.id ? { ...d, license: e.target.value } : d),
                              })}
                              placeholder="License number"
                              style={bookingFieldInputStyle(false)}
                            />
                          </div>
                          <div>
                            <label style={bookingFieldLabelStyle}>License Expiry Date</label>
                            <input
                              type="date"
                              value={driver.licenseExpiry}
                              onChange={(e) => setNewBookingData({
                                ...newBookingData,
                                additionalDrivers: newBookingData.additionalDrivers.map(d => d.id === driver.id ? { ...d, licenseExpiry: e.target.value } : d),
                              })}
                              style={bookingFieldInputStyle(false)}
                            />
                          </div>
                          <div>
                            <label style={bookingFieldLabelStyle}>Contact Number</label>
                            <input
                              type="text"
                              value={driver.contact}
                              onChange={(e) => setNewBookingData({
                                ...newBookingData,
                                additionalDrivers: newBookingData.additionalDrivers.map(d => d.id === driver.id ? { ...d, contact: e.target.value } : d),
                              })}
                              placeholder="Phone number"
                              style={bookingFieldInputStyle(false)}
                            />
                          </div>
                        </div>
                      </div>
                    ))}

                    {newBookingData.additionalDrivers.length === 0 && (
                      <div style={{ fontSize: 11.5, color: C.textMuted }}>No additional drivers added.</div>
                    )}
                  </div>

                  {/* File Attachment */}
                  <div style={{ marginBottom: 14 }}>
                    <label style={{ fontSize: 11, fontWeight: 600, color: C.textSec, display: "block", marginBottom: 6 }}>
                      File Attachment <span style={{ fontWeight: 400, color: C.textMuted }}>( image or document, max 5MB)</span>
                    </label>

                    {!newBookingData.attachment ? (
                      <input
                        type="file"
                        accept=".jpg,.jpeg,.png,.pdf,.doc,.docx,.xls,.xlsx"
                        onChange={handleAttachmentChange}
                        style={{ fontSize: 12, fontFamily: "inherit", width: "100%" }}
                      />
                    ) : (
                      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: 8, border: `1px solid ${C.border}`, borderRadius: 8, background: C.bg }}>
                        {newBookingData.attachment.type.startsWith("image/") ? (
                          <img src={newBookingData.attachment.dataUrl} alt="attachment preview" style={{ width: 40, height: 40, objectFit: "cover", borderRadius: 6, border: `1px solid ${C.border}` }} />
                        ) : (
                          <div style={{ width: 40, height: 40, borderRadius: 6, background: C.tealFaint, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18, flexShrink: 0 }}>📄</div>
                        )}
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 12, fontWeight: 600, color: C.navy, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{newBookingData.attachment.name}</div>
                          <div style={{ fontSize: 10, color: C.textMuted }}>{(newBookingData.attachment.size / 1024).toFixed(0)} KB</div>
                        </div>
                        <button type="button" onClick={() => setNewBookingData({ ...newBookingData, attachment: null })}
                          style={{ background: "none", border: "none", color: C.red, cursor: "pointer", fontSize: 11, fontWeight: 600, flexShrink: 0 }}>
                          Remove
                        </button>
                      </div>
                    )}

                    {attachmentError && (
                      <div style={{ fontSize: 11, color: C.red, marginTop: 6 }}>{attachmentError}</div>
                    )}
                  </div>

                  {/* Comments */}
                  <div>
                    <label style={{ fontSize: 11, fontWeight: 600, color: C.textSec, display: "block", marginBottom: 6 }}>Comments</label>
                    <textarea
                      value={newBookingData.comments}
                      onChange={(e) => setNewBookingData({ ...newBookingData, comments: e.target.value })}
                      placeholder="Any notes about the attachment "
                      rows={3}
                      style={{ width: "100%", padding: "10px 12px", borderRadius: 8, border: `1px solid ${C.border}`, fontSize: 12, fontFamily: "inherit", outline: "none", resize: "vertical", boxSizing: "border-box" }}
                    />
                  </div>
                </>
              ) : bookingStep === 3 ? (
                <>
                  <div style={{ fontSize: 13, fontWeight: 700, color: C.navy, marginBottom: 16 }}>🧾 Itemized Charges</div>

                  <div style={{ marginBottom: 14 }}>
                    <label style={bookingFieldLabelStyle}>Rate Charge (Daily, {bookingDays} day{bookingDays === 1 ? "" : "s"}) — auto</label>
                    <input type="text" readOnly value={formatSGD(bookingRateCharge)} style={bookingFieldInputStyle(true)} />
                  </div>

                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 14 }}>
                    <div>
                      <label style={bookingFieldLabelStyle}>Delivery Charge</label>
                      <input
                        type="number" min="0"
                        value={newBookingData.deliveryCharge}
                        onChange={(e) => {
                          const v = e.target.value;
                          if (v !== "" && Number(v) < 0) return;
                          setNewBookingData({ ...newBookingData, deliveryCharge: v });
                        }}
                        placeholder="0"
                        style={bookingFieldInputStyle(false)}
                      />
                    </div>
                    <div>
                      <label style={bookingFieldLabelStyle}>Collection Charge</label>
                      <input
                        type="number" min="0"
                        value={newBookingData.collectionCharge}
                        onChange={(e) => {
                          const v = e.target.value;
                          if (v !== "" && Number(v) < 0) return;
                          setNewBookingData({ ...newBookingData, collectionCharge: v });
                        }}
                        placeholder="0"
                        style={bookingFieldInputStyle(false)}
                      />
                    </div>
                    <div>
                      <label style={bookingFieldLabelStyle}>Additional Driver Charge</label>
                      <input
                        type="number" min="0"
                        value={newBookingData.additionalDriverCharge}
                        onChange={(e) => {
                          const v = e.target.value;
                          if (v !== "" && Number(v) < 0) return;
                          setNewBookingData({ ...newBookingData, additionalDriverCharge: v });
                        }}
                        placeholder="0"
                        style={bookingFieldInputStyle(false)}
                      />
                    </div>
                    <div>
                      <label style={bookingFieldLabelStyle}>Other Charges</label>
                      <input
                        type="number" min="0"
                        value={newBookingData.otherCharges}
                        onChange={(e) => {
                          const v = e.target.value;
                          if (v !== "" && Number(v) < 0) return;
                          setNewBookingData({ ...newBookingData, otherCharges: v });
                        }}
                        placeholder="0"
                        style={bookingFieldInputStyle(false)}
                      />
                    </div>
                  </div>

                  <div style={{ marginBottom: 14 }}>
                    <label style={bookingFieldLabelStyle}>Security Deposit (refundable — not a rental charge)</label>
                    <input
                      type="number"
                      min="0"
                      value={newBookingData.deductible}
                      onChange={(e) => {
                        const v = e.target.value;
                        if (v !== "" && Number(v) < 0) return;
                        setNewBookingData({ ...newBookingData, deductible: v });
                      }}
                      placeholder="0"
                      style={bookingFieldInputStyle(false)}
                    />
                  </div>

                  <div style={{ marginBottom: 20 }}>
                    <label style={bookingFieldLabelStyle}>VAT Rate (%)</label>
                    <input
                      type="number"
                      min="0"
                      step="0.1"
                      value={newBookingData.vatRate}
                      onChange={(e) => {
                        const v = e.target.value;
                        if (v !== "" && Number(v) < 0) return;
                        setNewBookingData({ ...newBookingData, vatRate: v });
                      }}
                      placeholder="e.g., 9"
                      style={bookingFieldInputStyle(false)}
                    />
                  </div>

                  {/* Calculated amount summary — Security Deposit intentionally
                      excluded, since it's refundable and not part of the rental total */}
                  <div style={{ border: `1px solid ${C.border}`, borderRadius: 10, padding: "16px 18px", background: C.bg }}>
                    {[
                      { label: "Rental Vehicle Charge", value: bookingRateCharge },
                      { label: "Delivery Charge", value: bookingDeliveryCharge },
                      { label: "Collection Charge", value: bookingCollectionCharge },
                      { label: "Additional Driver Charge", value: bookingAdditionalDriverCharge },
                      { label: "Other Charges", value: bookingOtherCharges },
                    ].filter(row => row.value > 0 || row.label === "Rental Vehicle Charge").map(row => (
                      <div key={row.label} style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", fontSize: 12.5, color: C.textSec }}>
                        <span>{row.label}</span>
                        <span style={mono}>{formatSGD(row.value)}</span>
                      </div>
                    ))}
                    <div style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", marginTop: 4, paddingTop: 10, borderTop: `1px solid ${C.border}`, fontSize: 12.5, color: C.textSec }}>
                      <span>Subtotal</span>
                      <span style={mono}>{formatSGD(bookingSubtotal)}</span>
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", fontSize: 12.5, color: C.textSec }}>
                      <span>VAT ({bookingVatRatePct || 0}%)</span>
                      <span style={mono}>{formatSGD(bookingVatAmount)}</span>
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between", marginTop: 8, paddingTop: 10, borderTop: `1px solid ${C.border}` }}>
                      <span style={{ fontSize: 13.5, fontWeight: 700, color: C.navy }}>Grand Total</span>
                      <span style={{ fontSize: 13.5, fontWeight: 700, color: C.teal, ...mono }}>{formatSGD(bookingTotal)}</span>
                    </div>
                  </div>
                </>
              ) : bookingStep === 4 ? (
                <>
                  <div style={{ fontSize: 13, fontWeight: 700, color: C.navy, marginBottom: 16 }}>💳 Payment</div>

                  {/* Total Rental Amount / Security Deposit — read-only, carried over from Step 3 */}
                  <div style={{ border: `1px solid ${C.border}`, borderRadius: 10, padding: "14px 16px", background: C.bg, marginBottom: 18 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", padding: "4px 0" }}>
                      <span style={{ fontSize: 13, fontWeight: 700, color: C.navy }}>Total Rental Amount</span>
                      <span style={{ fontSize: 13, fontWeight: 700, color: C.navy, ...mono }}>{formatSGD(bookingTotal)}</span>
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between", padding: "4px 0" }}>
                      <span style={{ fontSize: 12.5, color: C.textSec }}>Security Deposit</span>
                      <span style={{ fontSize: 12.5, color: C.textSec, ...mono }}>{formatSGD(bookingDeductible)}</span>
                    </div>
                  </div>

                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 14 }}>
                    <div>
                      <label style={bookingFieldLabelStyle}>Amount Collected Now</label>
                      <input
                        type="number"
                        min="0"
                        value={newBookingData.amountCollected}
                        onChange={(e) => {
                          const v = e.target.value;
                          if (v !== "" && Number(v) < 0) return;
                          setNewBookingData({ ...newBookingData, amountCollected: v });
                        }}
                        placeholder="0"
                        style={bookingFieldInputStyle(false)}
                      />
                    </div>
                    <div>
                      <label style={bookingFieldLabelStyle}>Payment Method</label>
                      <select
                        value={newBookingData.paymentMethod}
                        onChange={(e) => setNewBookingData({ ...newBookingData, paymentMethod: e.target.value })}
                        style={bookingFieldInputStyle(false)}
                      >
                        <option value="Cash">Cash</option>
                        <option value="Card">Card</option>
                        <option value="Bank Transfer">Bank Transfer</option>
                        <option value="Online">Online</option>
                      </select>
                    </div>
                  </div>

                  <div style={{ marginBottom: 20 }}>
                    <label style={bookingFieldLabelStyle}>Reference / Auth Code</label>
                    <input
                      type="text"
                      value={newBookingData.referenceCode}
                      onChange={(e) => setNewBookingData({ ...newBookingData, referenceCode: e.target.value })}
                      placeholder="Optional — transaction/auth reference"
                      style={bookingFieldInputStyle(false)}
                    />
                  </div>

                  <div style={{ border: `1px solid ${C.tealFaint}`, borderRadius: 10, padding: "14px 16px", background: C.tealFaint, display: "flex", justifyContent: "space-between" }}>
                    <span style={{ fontSize: 13, fontWeight: 600, color: C.navy }}>Balance after this payment</span>
                    <span style={{ fontSize: 13, fontWeight: 700, color: C.teal, ...mono }}>{formatSGD(bookingBalance)}</span>
                  </div>
                </>
              ) : (
                <>
                  <div style={{ fontSize: 13, fontWeight: 700, color: C.navy, marginBottom: 16 }}>✅ Review & Confirm</div>

                  {(() => {
                    const reviewCar = fleetData.fleet.find(c => c.plate === newBookingData.plate);
                    return (
                      <>
                        <div style={{ marginBottom: 14 }}>
                          <div style={{ fontSize: 11, fontWeight: 600, color: C.textSec, marginBottom: 4 }}>👤 Customer</div>
                          <div style={{ fontSize: 13, fontWeight: 700, color: C.navy }}>{newBookingData.customer || "—"}</div>
                          <div style={{ fontSize: 12, color: C.textMuted }}>{newBookingData.contact || "—"}</div>
                        </div>

                        <div style={{ marginBottom: 14 }}>
                          <div style={{ fontSize: 11, fontWeight: 600, color: C.textSec, marginBottom: 4 }}>🚗 Vehicle</div>
                          <div style={{ fontSize: 13, fontWeight: 700, color: C.navy }}>{newBookingData.plate || "—"}</div>
                          <div style={{ fontSize: 12, color: C.textMuted }}>
                            {[reviewCar?.model, reviewCar?.color].filter(Boolean).join(" · ") || "—"}
                          </div>
                        </div>

                        <div style={{ marginBottom: 18 }}>
                          <div style={{ fontSize: 11, fontWeight: 600, color: C.textSec, marginBottom: 4 }}>📅 Rental</div>
                          <div style={{ fontSize: 12.5, color: C.navy }}>{formatDateTime(newBookingData.start) || "—"}</div>
                          <div style={{ fontSize: 12.5, color: C.textMuted, margin: "2px 0" }}>↓</div>
                          <div style={{ fontSize: 12.5, color: C.navy }}>{formatDateTime(newBookingData.end) || "—"}</div>
                          <div style={{ fontSize: 11.5, color: C.textMuted, marginTop: 4 }}>{bookingDays} Day{bookingDays === 1 ? "" : "s"} · Daily</div>
                        </div>

                        <div style={{ border: `1px solid ${C.border}`, borderRadius: 10, padding: "16px 18px", background: C.bg }}>
                          <div style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", fontSize: 12.5, color: C.textSec }}>
                            <span>Total</span>
                            <span style={mono}>{formatSGD(bookingTotal)}</span>
                          </div>
                          <div style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", fontSize: 12.5, color: C.textSec }}>
                            <span>Paid Now</span>
                            <span style={mono}>{formatSGD(bookingAmountCollected)}</span>
                          </div>
                          <div style={{ display: "flex", justifyContent: "space-between", marginTop: 8, paddingTop: 10, borderTop: `1px solid ${C.border}` }}>
                            <span style={{ fontSize: 13.5, fontWeight: 700, color: C.navy }}>Balance</span>
                            <span style={{ fontSize: 13.5, fontWeight: 700, color: C.teal, ...mono }}>{formatSGD(bookingBalance)}</span>
                          </div>
                        </div>
                      </>
                    );
                  })()}
                </>
              )}
            </div>

            {/* Footer */}
            <div style={{ padding: "14px 24px", borderTop: `1px solid ${C.border}`, display: "flex", justifyContent: "space-between", gap: 10, flexShrink: 0 }}>
              <Btn onClick={bookingStep === 1 ? closeNewBookingModal : () => setBookingStep(bookingStep - 1)}>
                {createdBookingInfo ? "Cancel" : (bookingStep === 1 ? "Cancel" : "← Back")}
              </Btn>
              {bookingStep === 1 ? (
                <Btn primary onClick={handleBookingStep1Next}>Next →</Btn>
              ) : bookingStep < BOOKING_STEP_COUNT ? (
                <Btn primary onClick={() => setBookingStep(bookingStep + 1)}>Next →</Btn>
              ) : createdBookingInfo ? (
                <div style={{ display: "flex", gap: 10 }}>
                  <Btn primary onClick={handleDownloadAgreement}>📄 Agreement</Btn>
                  <Btn onClick={handleFinishBookingFlow}>Done</Btn>
                </div>
              ) : (
                <Btn primary onClick={handleNewBookingSubmit}>Confirm & Create Booking</Btn>
              )}
            </div>
          </div>
        </>
      )}

      {/* NEW USER MODAL */}
      <Modal
        open={showNewUser}
        title="Add New User"
        onClose={() => setShowNewUser(false)}
        onSubmit={handleNewUserSubmit}
        submitText="Add User"
      >
        <Input
          label="Full Name"
          value={newUserData.name}
          onChange={(e) => setNewUserData({ ...newUserData, name: e.target.value })}
          placeholder="e.g., Nur Aisyah"
        />
        <Input
          label="Email"
          type="email"
          value={newUserData.email}
          onChange={(e) => setNewUserData({ ...newUserData, email: e.target.value })}
          placeholder="e.g., aisyah@dubaidrive.ae"
        />
        <Select
          label="Role"
          value={newUserData.role}
          onChange={(e) => setNewUserData({ ...newUserData, role: e.target.value })}
          options={[
            { value: "Admin", label: "Admin" },
            { value: "Staff", label: "Staff" }
          ]}
        />
      </Modal>
    </div>
  );
}