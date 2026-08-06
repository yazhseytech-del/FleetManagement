import { useState, useRef, useEffect } from "react";
import { C } from "./theme";
import { Btn, Badge, Modal, Input, Select, StatusTag } from "./components";
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
import UserManagement from "./UserManagement";

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

const CALENDAR_STATUS_BG = { Available: "#dcfce7", "On Rental": "#ffedd5", "Ending Today": "#ffedd5" };
const CALENDAR_STATUS_TEXT = { Available: "#166534", "On Rental": "#9a3412", "Ending Today": "#9a3412" };
const CALENDAR_WEEKDAYS = ["S", "M", "T", "W", "T", "F", "S"];
const toISODate = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

// Step 1 (Customer Details) option lists for Customer Type and Driving
// Experience — both plain selects, same field style as everything else on
// that step.
const CUSTOMER_TYPES = ["Local", "Foreigner"];

// Age band shown as a read-only indicator next to the Age input on Step 1 —
// Under 24 / 24–59 / 60+. Purely informational for now (e.g. flags a young
// or senior driver for staff attention); it doesn't gate submission or alter
// pricing, since no specific rule for each band was provided.
const getAgeGroup = (age) => {
  const n = Number(age);
  if (age === "" || age === null || age === undefined || isNaN(n)) return "";
  if (n < 24) return "Under 24";
  if (n <= 59) return "24–59";
  return "60+";
};

const HOUR_OPTIONS_12 = Array.from({ length: 12 }, (_, i) => String(i + 1).padStart(2, "0"));
const MINUTE_OPTIONS_60 = Array.from({ length: 60 }, (_, i) => String(i).padStart(2, "0"));

// "HH:MM" (24h) <-> { hour: "01".."12", minute: "00".."59", ampm } — every
// other consumer of pickupTime/returnTime (combineDateTime, booking.start/end,
// conflict checks, PDF generation) keeps reading/writing the same 24h string;
// only the on-screen control changes to 12-hour AM/PM.
const to12h = (hhmm) => {
  if (!hhmm) return { hour: "12", minute: "00", ampm: "AM" };
  const [hStr, mStr] = hhmm.split(":");
  const h24 = parseInt(hStr, 10) || 0;
  const ampm = h24 >= 12 ? "PM" : "AM";
  let h12 = h24 % 12;
  if (h12 === 0) h12 = 12;
  return { hour: String(h12).padStart(2, "0"), minute: mStr || "00", ampm };
};
const to24h = (hour12, minute, ampm) => {
  let h = parseInt(hour12, 10) % 12;
  if (ampm === "PM") h += 12;
  return `${String(h).padStart(2, "0")}:${minute}`;
};

// 12-hour Pickup/Return Time control — three selects (Hour/Minute/AM-PM) in
// place of the browser's native <input type="time">, whose AM/PM-vs-24h
// display depends on OS/browser locale rather than anything HTML lets us
// force. Same label, same grid cell, same field width as before — only the
// control itself changes.
const TimeInput12h = ({ value, onChange, style }) => {
  const { hour, minute, ampm } = to12h(value);
  const set = (nextHour, nextMinute, nextAmpm) => onChange(to24h(nextHour, nextMinute, nextAmpm));
  return (
    <div style={{ display: "flex", gap: 6 }}>
      <select value={hour} onChange={(e) => set(e.target.value, minute, ampm)} style={{ ...style, flex: 1 }}>
        {HOUR_OPTIONS_12.map(h => <option key={h} value={h}>{h}</option>)}
      </select>
      <select value={minute} onChange={(e) => set(hour, e.target.value, ampm)} style={{ ...style, flex: 1 }}>
        {MINUTE_OPTIONS_60.map(m => <option key={m} value={m}>{m}</option>)}
      </select>
      <select value={ampm} onChange={(e) => set(hour, minute, e.target.value)} style={{ ...style, flex: "0 0 68px" }}>
        <option value="AM">AM</option>
        <option value="PM">PM</option>
      </select>
    </div>
  );
};

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
  // Maintenance is not a booking-flow concept — any day the underlying
  // timeline marks as Maintenance is just treated as unavailable, same as
  // On Rental, so no Maintenance-specific status/color/label exists here.
  const getStatus = (d) => {
    if (isPast(d)) return "Past";
    const raw = statusByDate[toISODate(d)] || "Available";
    return raw === "Maintenance" ? "On Rental" : raw;
  };
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
    <div style={{ border: `1px solid ${C.border}`, borderRadius: 8, padding: "8px 10px", marginTop: 4, marginBottom: 4, background: C.surface, maxWidth: 250 }}>
      <div style={{ fontSize: 10, fontWeight: 700, color: C.textSec, marginBottom: 6, textTransform: "uppercase", letterSpacing: 0.3 }}>{label}</div>

      {/* Header: month/year + up/down nav */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
        <div style={{ fontSize: 11.5, fontWeight: 700, color: C.navy }}>{monthLabel}</div>
        <div style={{ display: "flex", gap: 2 }}>
          <button type="button" disabled={!canGoPrev} onClick={goPrev}
            style={{ background: "none", border: "none", cursor: canGoPrev ? "pointer" : "default", opacity: canGoPrev ? 1 : 0.3, fontSize: 11, color: C.navy, padding: 2 }}>↑</button>
          <button type="button" onClick={goNext}
            style={{ background: "none", border: "none", cursor: "pointer", fontSize: 11, color: C.navy, padding: 2 }}>↓</button>
        </div>
      </div>

      {/* Legend */}
      <div style={{ display: "flex", gap: 8, marginBottom: 6, flexWrap: "wrap" }}>
        {["Available", "On Rental"].map(s => (
          <div key={s} style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 9, color: C.textSec }}>
            <span style={{ width: 8, height: 8, borderRadius: 2, background: CALENDAR_STATUS_BG[s], border: `1px solid ${CALENDAR_STATUS_TEXT[s]}22`, display: "inline-block" }} />
            {s}
          </div>
        ))}
      </div>

      {/* Weekday header */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", marginBottom: 2 }}>
        {CALENDAR_WEEKDAYS.map((w, i) => (
          <div key={i} style={{ textAlign: "center", fontSize: 9, fontWeight: 600, color: C.textMuted, padding: "1px 0" }}>{w}</div>
        ))}
      </div>

      {/* Day grid */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 2 }}>
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
                padding: "4px 0", fontSize: 10.5, borderRadius: 4,
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

      {dayError && <div style={{ fontSize: 10, color: C.red, marginTop: 6 }}>{dayError}</div>}

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 8 }}>
        <div style={{ fontSize: 10, color: C.textMuted }}>
          {selectedDate ? <>Selected: <strong style={{ color: C.navy }}>{selectedDate}</strong></> : "No date selected"}
        </div>
        <div style={{ display: "flex", gap: 10 }}>
          <button type="button" onClick={() => { onClear(); setDayError(""); }}
            style={{ background: "none", border: "none", cursor: "pointer", fontSize: 10.5, fontWeight: 600, color: C.teal, padding: 0 }}>Clear</button>
          <button type="button" onClick={goToday}
            style={{ background: "none", border: "none", cursor: "pointer", fontSize: 10.5, fontWeight: 600, color: C.teal, padding: 0 }}>Today</button>
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
  // Set to the booking's id while the New Booking wizard is reused to edit
  // an existing booking (opened via Booking.jsx's Edit button) — null means
  // the wizard is in normal create mode. Read throughout the wizard to swap
  // labels/behavior (title, submit label, skip the Payment step, update
  // instead of create on submit) without forking into a second component.
  const [editingBookingId, setEditingBookingId] = useState(null);
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

  // System users shown on the User Management screen. Lifted up here (same
  // pattern as restrictedLicenses above) so it's easy to wire into real auth
  // later without moving state around again. Permissions are NOT stored per
  // user — they live in rolePermissions below and are looked up by u.role.
  const [users, setUsers] = useState([
    { id: 1, name: "Administrator", email: "admin@fleetopz.com", role: "Admin", status: "Active", lastLogin: "15/08/2026 10:30 AM", isYou: true },
    { id: 2, name: "Ramesh Kumar", email: "ramesh@fleetopz.com", role: "Staff", status: "Active", lastLogin: "15/08/2026 09:15 AM" },
    { id: 3, name: "Sunitha", email: "sunitha@fleetopz.com", role: "Staff", status: "Inactive", lastLogin: "12/08/2026 04:45 PM" },
    { id: 4, name: "Manoj", email: "manoj@fleetopz.com", role: "Staff", status: "Active", lastLogin: "15/08/2026 08:20 AM" },
  ]);
  const addUser = (u) => setUsers(prev => [...prev, { id: Date.now(), status: "Active", lastLogin: "—", ...u }]);
  const updateUser = (id, updates) => setUsers(prev => prev.map(u => u.id === id ? { ...u, ...updates } : u));
  const deleteUser = (id) => setUsers(prev => prev.filter(u => u.id !== id));

  // Role-based permissions — one shared permission grid per role rather
  // than per user. Editing a role here (via the Role & Permission tab)
  // applies to every user currently assigned that role.
  const [rolePermissions, setRolePermissions] = useState({
    Admin: { Dashboard: { view: true, create: true, edit: true, delete: true }, Fleet: { view: true, create: true, edit: true, delete: true }, Bookings: { view: true, create: true, edit: true, delete: true }, Earnings: { view: true, create: true, edit: true, delete: true }, Expenses: { view: true, create: true, edit: true, delete: true }, "P&L": { view: true, create: true, edit: true, delete: true }, Alerts: { view: true, create: true, edit: true, delete: true } },
    Staff: { Dashboard: { view: true, create: false, edit: false, delete: false }, Fleet: { view: true, create: false, edit: false, delete: false }, Bookings: { view: true, create: true, edit: true, delete: false }, Earnings: { view: false, create: false, edit: false, delete: false }, Expenses: { view: true, create: true, edit: false, delete: false }, "P&L": { view: false, create: false, edit: false, delete: false }, Alerts: { view: true, create: false, edit: false, delete: false } },
  });
  const toggleRolePermission = (role, module, action) => {
    setRolePermissions(prev => ({
      ...prev,
      [role]: {
        ...prev[role],
        [module]: { ...prev[role]?.[module], [action]: !prev[role]?.[module]?.[action] },
      },
    }));
  };

  // Initialize fleet data management hook
  const fleetData = useFleetData();

  // ── Topbar: notifications + profile dropdown ────────────────────────────
  const [notifMenuOpen, setNotifMenuOpen] = useState(false);
  const [profileMenuOpen, setProfileMenuOpen] = useState(false);
  const notifMenuRef = useRef(null);
  const profileMenuRef = useRef(null);

  // Close either dropdown when clicking anywhere outside of it.
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (notifMenuRef.current && !notifMenuRef.current.contains(e.target)) setNotifMenuOpen(false);
      if (profileMenuRef.current && !profileMenuRef.current.contains(e.target)) setProfileMenuOpen(false);
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Search box shown in the topbar while on the User Management screen —
  // filters the users list passed down to it.
  const [userTopbarSearch, setUserTopbarSearch] = useState("");

  // Company Profile — opened from the profile dropdown. Persisted the same
  // way as the rest of the app's data (localStorage via useFleetData's
  // loadPersisted/savePersisted helpers), so it survives refreshes too.
  const [showCompanyProfileModal, setShowCompanyProfileModal] = useState(false);
  const [companyProfileEditing, setCompanyProfileEditing] = useState(false);
  const [companyProfile, setCompanyProfile] = useState(() => {
    try {
      const raw = window.localStorage.getItem("fleetopz:companyProfile");
      if (raw) return JSON.parse(raw);
    } catch (_) { /* fall through to default */ }
    return {
      name: "FleetOpz Car Rental",
      logo: "",
      email: "info@fleetopz.com",
      phone: "+65 9123 4567",
      address: "Blk 20 Clementi Avenue 3, #05-12, Singapore 129905",
      currency: "SGD (Singapore Dollar)",
      timezone: "(GMT+08:00) Singapore",
      gstNumber: "20-1234567-K",
      businessRegNumber: "202012345K",
      dateFormat: "DD/MM/YYYY",
    };
  });
  const [companyProfileDraft, setCompanyProfileDraft] = useState(companyProfile);
  const openCompanyProfile = () => { setCompanyProfileDraft(companyProfile); setCompanyProfileEditing(false); setShowCompanyProfileModal(true); setProfileMenuOpen(false); };
  const saveCompanyProfile = () => {
    setCompanyProfile(companyProfileDraft);
    try { window.localStorage.setItem("fleetopz:companyProfile", JSON.stringify(companyProfileDraft)); } catch (_) {}
    setCompanyProfileEditing(false);
  };
  const handleLogoChange = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setCompanyProfileDraft(prev => ({ ...prev, logo: reader.result }));
    reader.readAsDataURL(file);
  };

  // Settings — opened from the profile dropdown. Backed by fleetData's
  // notificationSettings / systemPreferences (persisted, and actually wired
  // into generateAlerts()) — this modal edits drafts of both, saved per
  // section via the two "Save Changes" buttons in the mockup.
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [notifDraft, setNotifDraft] = useState(fleetData.notificationSettings);
  const [prefsDraft, setPrefsDraft] = useState(fleetData.systemPreferences);
  const openSettings = () => {
    setNotifDraft(fleetData.notificationSettings);
    setPrefsDraft(fleetData.systemPreferences);
    setShowSettingsModal(true);
    setProfileMenuOpen(false);
  };
  const saveNotificationDraft = () => {
    fleetData.updateNotificationSettings("email", notifDraft.email);
    fleetData.updateNotificationSettings("system", notifDraft.system);
    fleetData.updateNotificationSettings("reminders", notifDraft.reminders);
  };
  const savePreferencesDraft = () => {
    fleetData.updateSystemPreferences("general", prefsDraft.general);
    fleetData.updateSystemPreferences("bookingDefaults", prefsDraft.bookingDefaults);
    fleetData.updateSystemPreferences("customerSettings", prefsDraft.customerSettings);
    fleetData.updateSystemPreferences("fleetSettings", prefsDraft.fleetSettings);
  };

  // Change Password — opened from the profile dropdown.
  const [showChangePasswordModal, setShowChangePasswordModal] = useState(false);
  const [passwordForm, setPasswordForm] = useState({ current: "", next: "", confirm: "" });
  const openChangePassword = () => { setPasswordForm({ current: "", next: "", confirm: "" }); setShowChangePasswordModal(true); setProfileMenuOpen(false); };
  const submitChangePassword = () => {
    if (!passwordForm.current.trim() || !passwordForm.next.trim() || !passwordForm.confirm.trim()) {
      alert("Please fill in all password fields.");
      return;
    }
    if (passwordForm.next.length < 6) {
      alert("New password must be at least 6 characters.");
      return;
    }
    if (passwordForm.next !== passwordForm.confirm) {
      alert("New password and confirmation do not match.");
      return;
    }
    alert("Password updated successfully.");
    setPasswordForm({ current: "", next: "", confirm: "" });
    setShowChangePasswordModal(false);
  };

  // Logout — uses the app's real auth (AuthContext). Confirming clears the
  // saved token/user via logout(), and main.jsx's existing user-check
  // automatically swaps back to the Login screen once `user` becomes null —
  // no separate placeholder screen needed here.
 
  const handleLogout = () => {
    setProfileMenuOpen(false);
    if (window.confirm("Log out of FleetOpz?")) {
      logout();
    }
  };

  // Bookings fed into the New/Edit Booking wizard's availability calendars —
  // excludes the booking currently being edited (if any), so re-opening a
  // booking for edits doesn't show its own already-booked dates as
  // unavailable/conflicting with itself. Real conflicts against every OTHER
  // booking still show normally.
  const calendarBookings = editingBookingId
    ? fleetData.bookings.filter(b => b.id !== editingBookingId)
    : fleetData.bookings;

  const [newBookingData, setNewBookingData] = useState({
    plate: "",
    customer: "",
    ic: "",
    contact: "",
    passport: "",
    address: "",
    // Step 1 additions: Customer Type, Age, Driving Experience. Age drives
    // no other logic yet (see the Age input's own comment) — it's just
    // captured on the booking, same as everything else on this step.
    customerType: "Local",
    age: "",
    drivingExperience: "",
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
    rate: "",
    deductible: "",
    vatRate: "",
    // New Pricing Details charge fields — separate optional line items beyond
    // the base daily rate. deductible (Security Deposit) stays a distinct
    // field: it's refundable, not a rental charge, so it's intentionally
    // excluded from the subtotal/VAT/total math below.
    deliveryCharge: "",
    collectionCharge: "",
    // Additional Driver Charge — a plain fixed field, same shape as Delivery/
    // Collection/Other Charges. Only shown once at least one Additional
    // Driver has been added (see Step 3 below), so adding a driver is what
    // surfaces this field for staff to fill in.
    additionalDriverCharge: "",
    otherCharges: "",
    // Kept only for backward compatibility with bookings that already carry
    // itemized charges from before this field existed — there's no UI in
    // this wizard to add to it anymore. computeBookingInvoice (Booking.jsx)
    // still reads it, e.g. when editing an older booking.
    charges: [],
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
    // Payment Date/Time for the Advance — defaults to right now
    // (still fully editable) so this money's place in Payment History is
    // accurate even if entered/backdated later.
    amountCollectedDate: new Date().toISOString().slice(0, 10),
    amountCollectedTime: new Date().toTimeString().slice(0, 5),
    // Vehicle Handover fields — captured from Step 5 (Review) while editing
    // an existing booking, not at creation time. startingMileage/fuelLevel
    // are auto-filled (see openEditBookingModal) from the same car's most
    // recent completed booking's Mileage In/Fuel In, but stay editable.
    startingMileage: "",
    fuelLevel: "",
    vehicleCondition: "",
  });
  const [attachmentError, setAttachmentError] = useState("");

  // The New Booking modal is now a 2-step wizard: Step 1 is Customer Details
  // (IC-driven auto-fill), Step 2 is Booking Details (unchanged submit logic,
  // reorganized fields). Reset to 1 whenever the modal is opened or closed
  // so it never reopens mid-wizard.
  const [bookingStep, setBookingStep] = useState(1);
  const BOOKING_STEP_COUNT = 5;
  const BOOKING_STEP_LABELS = ["Customer Details", "Booking Details", "Pricing & Charges", "Payment", "Review & Confirm"];

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
    // Instant availability check — applies the same way for New and Edit
    // Booking (excludeBookingId is undefined when creating new, so nothing
    // is excluded there). Blocks moving on rather than letting staff fill in
    // Pricing/Payment/Review for a car+date range that's already taken.
    const conflict = fleetData.checkBookingConflict(newBookingData.plate, newBookingData.start, newBookingData.end, editingBookingId);
    if (conflict) {
      alert(buildAvailabilityConflictMessage(conflict, newBookingData.start));
      return;
    }
    setBookingStep(3);
  };

  // Currency for the New Booking wizard's pricing step is SGD.
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

  // Finds the given car's most recent returned booking (any booking with a
  // Mileage In on file, excluding the one currently being edited) and hands
  // back its Mileage In / Fuel In — used to auto-fill the next booking's
  // Starting Mileage / Fuel Level in the Vehicle Handover section below.
  // "Most recent" is by actual return time (falling back to when it was
  // marked returned) so a car with several past rentals always pulls from
  // the latest one, not just whichever happens to sort first in the array.
  const getPreviousMileageFuel = (plate, excludeBookingId) => {
    const candidates = fleetData.bookings.filter(b =>
      b.plate === plate && b.id !== excludeBookingId && b.mileageIn
    );
    if (candidates.length === 0) return null;
    candidates.sort((a, b) =>
      new Date(b.actualReturnAt || b.returnedAt || 0) - new Date(a.actualReturnAt || a.returnedAt || 0)
    );
    return { mileage: candidates[0].mileageIn, fuel: candidates[0].fuelIn || "" };
  };

  // Opens the same wizard pre-filled with an existing booking's data, for
  // editing — reverses the New Booking mapping (pickupDate/pickupTime/
  // returnDate/returnTime are split back out of start/end, same fields the
  // wizard's date/time pickers write into). Payment fields stay at their
  // defaults since Step 4 is read-only in edit mode — see BOOKING_STEP_COUNT
  // usages below — actual payments are recorded from Booking.jsx instead.
  //
  // Starting Mileage / Fuel Level for the Vehicle Handover section (Step 5):
  // if this booking already has its own values saved (e.g. re-opening Edit
  // after a Complete Handover attempt failed validation), those win; otherwise
  // they're auto-filled from the same car's last returned booking via
  // getPreviousMileageFuel — either way they stay fully editable.
  const openEditBookingModal = (booking) => {
    const previous = booking.startingMileage
      ? null
      : getPreviousMileageFuel(booking.plate, booking.id);
    setEditingBookingId(booking.id);
    setNewBookingData({
      plate: booking.plate || "",
      customer: booking.customer || "",
      ic: booking.ic || "",
      contact: booking.contact || "",
      passport: booking.passport || "",
      address: booking.address || "",
      customerType: booking.customerType || "Local",
      age: booking.age || "",
      drivingExperience: booking.drivingExperience ?? "",
      start: booking.start || "",
      end: booking.end || "",
      pickupDate: booking.start ? booking.start.slice(0, 10) : "",
      pickupTime: booking.start ? booking.start.slice(11, 16) : "",
      returnDate: booking.end ? booking.end.slice(0, 10) : "",
      returnTime: booking.end ? booking.end.slice(11, 16) : "",
      pickup: booking.pickup || "",
      drop: booking.drop || "",
      rate: booking.rate ?? "",
      deductible: booking.deductible ?? "",
      vatRate: booking.vatRate ?? "",
      deliveryCharge: booking.deliveryCharge ?? "",
      collectionCharge: booking.collectionCharge ?? "",
      additionalDriverCharge: booking.additionalDriverCharge ?? "",
      otherCharges: booking.otherCharges ?? "",
      charges: booking.charges || [],
      additionalDrivers: booking.additionalDrivers || [],
      license: booking.license || "",
      licenseExpiry: booking.licenseExpiry || "",
      attachment: booking.attachment || null,
      comments: booking.comments || "",
      amountCollected: "0",
      paymentMethod: "Cash",
      referenceCode: "",
      amountCollectedDate: new Date().toISOString().slice(0, 10),
      amountCollectedTime: new Date().toTimeString().slice(0, 5),
      startingMileage: booking.startingMileage || previous?.mileage || "",
      fuelLevel: booking.fuelLevel || previous?.fuel || "",
      vehicleCondition: booking.vehicleCondition || "",
    });
    setMatchedCustomer(null);
    setBookingStep(1);
    setShowNewBooking(true);
  };

  const closeNewBookingModal = () => {
    setShowNewBooking(false);
    setBookingStep(1);
    setEditingBookingId(null);
    setNewBookingData({ plate: "", customer: "", ic: "", contact: "", passport: "", address: "", customerType: "Local", age: "", drivingExperience: "", start: "", end: "", pickupDate: "", pickupTime: "", returnDate: "", returnTime: "", pickup: "", drop: "", rate: "", deductible: "", vatRate: "", deliveryCharge: "", collectionCharge: "", additionalDriverCharge: "", otherCharges: "", charges: [], additionalDrivers: [], license: "", licenseExpiry: "", attachment: null, comments: "", amountCollected: "0", paymentMethod: "Cash", referenceCode: "", amountCollectedDate: new Date().toISOString().slice(0, 10), amountCollectedTime: new Date().toTimeString().slice(0, 5), startingMileage: "", fuelLevel: "", vehicleCondition: "" });
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
    { id: "userManagement", label: "User Management", icon: "👤" },
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
        onEditBooking={openEditBookingModal}
        selectedCar={selectedCar}
        selectedRange={selectedRange}
        onPaymentReceived={(entry) => { if (fleetData.notificationSettings.email.paymentReceived) fleetData.addManualAlert(entry); }}
        onBookingCancelled={(entry) => { if (fleetData.notificationSettings.email.bookingCancellation) fleetData.addManualAlert(entry); }}
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
        onMarkRead={fleetData.markAlertRead}
        onMarkAllRead={fleetData.markAllAlertsRead}
        onNavigate={(screenLabel) => setActive(NAV.find(n => n.label === screenLabel)?.id || "dashboard")}
        onOpenSettings={openSettings}
      />
    ),
    userManagement: (
      <UserManagement
        users={users}
        onAddUser={addUser}
        onUpdateUser={updateUser}
        onDeleteUser={deleteUser}
        currentUserRole={currentUserRole}
        rolePermissions={rolePermissions}
        onToggleRolePermission={toggleRolePermission}
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
    userManagement: { title: "User Management", sub: "Manage system users, roles, permissions and audit logs" },
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
      if (fleetData.notificationSettings.system.restrictedDriverAttempt) {
        fleetData.addManualAlert({
          type: "restrictedDriverAttempt",
          plate: newBookingData.plate || "",
          car: fleetData.fleet.find(c => c.plate === newBookingData.plate) ? `${fleetData.fleet.find(c => c.plate === newBookingData.plate).make} ${fleetData.fleet.find(c => c.plate === newBookingData.plate).model}` : "",
          msg: `Booking attempt blocked — restricted license "${newBookingData.license}" (${newBookingData.customer || "unknown customer"})`,
          urgent: true,
        });
      }
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

    // Edit mode — update the existing booking instead of creating a new one.
    // Skips the conflict check entirely when car/dates are unchanged from
    // the original (the booking already legitimately owns that slot), and
    // re-runs it only when the car or dates were actually edited. Payment
    // fields are never touched here — Step 4 is read-only while editing, and
    // real payments are recorded from Booking.jsx's Pricing & Payment tab.
    if (editingBookingId) {
      const original = fleetData.bookings.find(b => b.id === editingBookingId);
      const carOrDatesChanged = !original
        || original.plate !== newBookingData.plate
        || original.start !== newBookingData.start
        || original.end !== newBookingData.end;
      if (carOrDatesChanged) {
        const conflict = fleetData.checkBookingConflict(newBookingData.plate, newBookingData.start, newBookingData.end, editingBookingId);
        if (conflict) {
          alert(buildAvailabilityConflictMessage(conflict, newBookingData.start));
          return;
        }
      }
      const { amountCollected, paymentMethod, referenceCode, amountCollectedDate, amountCollectedTime, ...editableFields } = newBookingData;
      fleetData.updateBooking(editingBookingId, {
        ...editableFields,
        ageGroup: getAgeGroup(newBookingData.age),
      });
      closeNewBookingModal();
      setActive("bookings");
      setDetailBookingId(editingBookingId);
      return;
    }

    // Prevent double-booking: same car, overlapping dates.
    const conflict = fleetData.checkBookingConflict(newBookingData.plate, newBookingData.start, newBookingData.end);
    if (conflict) {
      alert(buildAvailabilityConflictMessage(conflict, newBookingData.start));
      return;
    }
    // Advance is the first payment on this booking — same rule
    // as Record Payment later (Booking.jsx): it can never exceed what's owed.
    const amountCollectedNow = Number(newBookingData.amountCollected) || 0;
    if (amountCollectedNow > bookingTotal) {
      alert(`Advance exceeds the Grand Total (${formatSGD(bookingTotal)}). Enter ${formatSGD(bookingTotal)} or less.`);
      return;
    }
    if (amountCollectedNow > 0 && (!newBookingData.amountCollectedDate || !newBookingData.amountCollectedTime)) {
      alert("Enter the Payment Date & Time for the Advance");
      return;
    }
    // Built explicitly here, once, as the booking's first Payment History
    // entry — computeBookingInvoice (Booking.jsx) then treats `payments` as
    // the sole source of truth, so recording a later payment via Record
    // Payment only ever appends to this array and never re-derives or
    // duplicates this entry.
    const initialPayments = amountCollectedNow > 0
      ? [{
          id: "initial",
          amount: amountCollectedNow,
          method: newBookingData.paymentMethod,
          reference: newBookingData.referenceCode || "",
          addedAt: `${newBookingData.amountCollectedDate}T${newBookingData.amountCollectedTime}`,
        }]
      : [];
    const createdBooking = fleetData.addBooking({
      ...newBookingData,
      ageGroup: getAgeGroup(newBookingData.age),
      // Confirmed, not Active — this booking can be made well ahead of the
      // rental and every detail here stays editable (via Booking.jsx) right
      // up until the pickup day. It only becomes Active, and only gets its
      // Rental Agreement, once Vehicle Handover is completed below.
      status: "Confirmed",
      createdAt: new Date().toISOString(),
      payments: initialPayments,
    });
    // Booking succeeded — the modal stays open on Review so staff see the
    // confirmation; there's no Agreement to download yet, since the
    // agreement is only generated once Vehicle Handover happens — from the
    // Edit Booking flow's Review step (see handleCompleteHandover).
    setCreatedBookingInfo({ booking: createdBooking, car: selectedCar });
    if (fleetData.notificationSettings.email.bookingConfirmation) {
      const c = fleetData.fleet.find(f => f.plate === createdBooking.plate);
      fleetData.addManualAlert({
        type: "bookingConfirmation",
        plate: createdBooking.plate,
        car: c ? `${c.make} ${c.model}` : "",
        msg: `Booking confirmed for ${createdBooking.customer}`,
        urgent: false,
      });
    }
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

  // Vehicle Handover — now lives inside Step 5 (Review) of the Edit Booking
  // flow itself, rather than a separate modal. Validates Starting Mileage /
  // Fuel Level, flips the booking to Active, and generates the Rental
  // Agreement immediately (no extra click needed) — same fields/behavior the
  // old standalone handover modal used, just triggered from here instead.
  // Completed/Closed status derivation and payment logic are untouched.
  const handleCompleteHandover = () => {
    if (!editingBookingId) return;
    if (newBookingData.startingMileage === "" || Number(newBookingData.startingMileage) < 0) {
      alert("Enter a valid Starting Mileage");
      return;
    }
    if (!newBookingData.fuelLevel) {
      alert("Select the Fuel Level");
      return;
    }
    const original = fleetData.bookings.find(b => b.id === editingBookingId);
    const car = fleetData.fleet.find(c => c.plate === newBookingData.plate);
    const updates = {
      status: "Active",
      startingMileage: newBookingData.startingMileage,
      fuelLevel: newBookingData.fuelLevel,
      vehicleCondition: newBookingData.vehicleCondition,
      handoverAt: new Date().toISOString(),
    };
    fleetData.updateBooking(editingBookingId, updates);
    // The Rental Agreement is generated right here, for the first time —
    // never at booking creation — since it needs the mileage/fuel/condition
    // just captured above. Built from the merged booking locally since
    // updateBooking's state update isn't synchronous.
    generateRentalAgreementPdf({ ...original, ...updates }, car);
    closeNewBookingModal();
    setActive("bookings");
    setDetailBookingId(editingBookingId);
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
  // Itemized charges added via "+ Add Charge" below — taxable ones go
  // through VAT with everything else, non-taxable ones are added flat on
  // top, matching how computeBookingInvoice treats origin: "booking" charges
  // once the booking is actually created.
  const bookingCharges = newBookingData.charges || [];
  const bookingChargesTaxableTotal = bookingCharges.filter(c => c.taxable).reduce((s, c) => s + (Number(c.amount) || 0), 0);
  const bookingChargesNonTaxableTotal = bookingCharges.filter(c => !c.taxable).reduce((s, c) => s + (Number(c.amount) || 0), 0);
  const bookingFixedSubtotal = bookingRateCharge + bookingDeliveryCharge + bookingCollectionCharge + bookingAdditionalDriverCharge + bookingOtherCharges;
  const bookingTaxableBase = bookingFixedSubtotal + bookingChargesTaxableTotal;
  const bookingSubtotal = bookingFixedSubtotal + bookingChargesTaxableTotal + bookingChargesNonTaxableTotal;
  const bookingVatAmount = bookingTaxableBase * (bookingVatRatePct / 100);
  const bookingTotal = bookingTaxableBase + bookingVatAmount + bookingChargesNonTaxableTotal;
  // Derived for Step 4 (Payment) / Step 5 (Review) — how much is still owed
  // after whatever's being collected right now. Clamped at 0 to match
  // Balance Due everywhere else in the app (Booking.jsx); overpayment itself
  // is blocked at submit time (see handleSubmitBooking) rather than shown
  // here as a negative number.
  const bookingAmountCollected = Number(newBookingData.amountCollected) || 0;
  const bookingBalance = Math.max(0, bookingTotal - bookingAmountCollected);

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
            {active === "userManagement" && (
              <input
                type="text"
                value={userTopbarSearch}
                onChange={(e) => setUserTopbarSearch(e.target.value)}
                placeholder="Search users..."
                style={{ background: C.bg, border: `1px solid ${C.border}`, borderRadius: 8, padding: "7px 12px", fontSize: 12, color: C.textPri, fontFamily: "inherit", outline: "none", width: 200 }}
              />
            )}
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

            {/* Notification bell — badge shows unread alert count, click jumps to Alerts screen */}
            <div ref={notifMenuRef} style={{ position: "relative" }}>
              <div
                onClick={() => setActive("alerts")}
                title="Alerts"
                style={{ width: 34, height: 34, borderRadius: "50%", background: C.bg, border: `1px solid ${C.border}`, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", fontSize: 15, position: "relative" }}
              >
                🔔
                {fleetData.alerts.filter(a => !a.read).length > 0 && (
                  <span style={{ position: "absolute", top: -4, right: -4, background: C.red, color: "#fff", fontSize: 9, fontWeight: 700, borderRadius: 10, minWidth: 16, height: 16, display: "flex", alignItems: "center", justifyContent: "center", padding: "0 3px" }}>
                    {fleetData.alerts.filter(a => !a.read).length}
                  </span>
                )}
              </div>
            </div>

            {/* Profile dropdown */}
            <div ref={profileMenuRef} style={{ position: "relative" }}>
              <div
                onClick={() => setProfileMenuOpen(o => !o)}
                style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", padding: "4px 8px 4px 4px", borderRadius: 20, border: `1px solid ${profileMenuOpen ? C.border : "transparent"}` }}
              >
                <div style={{ width: 30, height: 30, borderRadius: "50%", background: C.teal, color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 700 }}>A</div>
                <div style={{ lineHeight: 1.2 }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: C.navy }}>Administrator</div>
                  <div style={{ fontSize: 10, color: C.textMuted }}>Super Admin</div>
                </div>
                <span style={{ fontSize: 10, color: C.textMuted, marginLeft: 2 }}>▾</span>
              </div>

              {profileMenuOpen && (
                <div style={{ position: "absolute", top: "calc(100% + 8px)", right: 0, width: 210, background: C.surface, border: `1px solid ${C.border}`, borderRadius: 10, boxShadow: "0 10px 30px rgba(0,0,0,0.12)", overflow: "hidden", zIndex: 200 }}>
                  {[
                    { label: "Company Profile", sub: "View and edit company details", icon: "🏢", onClick: openCompanyProfile },
                    { label: "Settings", sub: "System settings and preferences", icon: "⚙️", onClick: openSettings },
                    { label: "Alerts", sub: "View all system alerts", icon: "🔔", onClick: () => { setActive("alerts"); setProfileMenuOpen(false); } },
                    { label: "Change Password", sub: "", icon: "🔑", onClick: openChangePassword },
                    { label: "Logout", sub: "", icon: "🚪", onClick: handleLogout, danger: true },
                  ].map((item, i, arr) => (
                    <div key={item.label}>
                      <div
                        onClick={item.onClick}
                        style={{ display: "flex", alignItems: "flex-start", gap: 10, padding: "10px 14px", cursor: "pointer", background: "transparent" }}
                        onMouseEnter={(e) => e.currentTarget.style.background = C.bg}
                        onMouseLeave={(e) => e.currentTarget.style.background = "transparent"}
                      >
                        <span style={{ fontSize: 14, marginTop: 1 }}>{item.icon}</span>
                        <div>
                          <div style={{ fontSize: 12.5, fontWeight: 600, color: item.danger ? C.red : C.navy }}>{item.label}</div>
                          {item.sub && <div style={{ fontSize: 10, color: C.textMuted, marginTop: 1 }}>{item.sub}</div>}
                        </div>
                      </div>
                      {i < arr.length - 1 && i === 2 && <div style={{ borderTop: `1px solid ${C.border}`, margin: "4px 0" }} />}
                    </div>
                  ))}
                </div>
              )}
            </div>
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
                <div style={{ fontSize: 17, fontWeight: 700, color: C.navy }}>{editingBookingId ? `Edit Booking — ${editingBookingId}` : "New Booking"}</div>
                <button onClick={closeNewBookingModal} aria-label="Close" style={{ background: "none", border: "none", fontSize: 18, color: C.textMuted, cursor: "pointer", lineHeight: 1, padding: 4 }}>✕</button>
              </div>
              <div style={{ display: "flex", alignItems: "center", marginTop: 16 }}>
                {BOOKING_STEP_LABELS.flatMap((label, i) => {
                  const stepNum = i + 1;
                  const isActive = stepNum === bookingStep;
                  const stepEl = (
                    <div key={`step-${stepNum}`} style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
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
                        {label}
                      </div>
                    </div>
                  );
                  const connectorEl = stepNum < BOOKING_STEP_COUNT
                    ? <div key={`connector-${stepNum}`} style={{ flex: 1, height: 2, background: C.border, margin: "0 10px", minWidth: 12 }} />
                    : null;
                  return connectorEl ? [stepEl, connectorEl] : [stepEl];
                })}
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
                        placeholder="DL-2024-88213"
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
                      <label style={bookingFieldLabelStyle}>Customer Type</label>
                      <select
                        value={newBookingData.customerType}
                        onChange={(e) => setNewBookingData({ ...newBookingData, customerType: e.target.value })}
                        style={bookingFieldInputStyle(false)}
                      >
                        {CUSTOMER_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                      </select>
                    </div>
                  </div>

                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 14 }}>
                    <div>
                      <label style={bookingFieldLabelStyle}>Age</label>
                      <input
                        type="number"
                        min="0"
                        value={newBookingData.age}
                        onChange={(e) => {
                          const v = e.target.value;
                          if (v !== "" && Number(v) < 0) return;
                          setNewBookingData({ ...newBookingData, age: v });
                        }}
                        placeholder="e.g., 32"
                        style={bookingFieldInputStyle(false)}
                      />
                      {newBookingData.age !== "" && (
                        <div style={{ fontSize: 10.5, color: C.textMuted, marginTop: 5, fontWeight: 600 }}>
                          Age Group: {getAgeGroup(newBookingData.age)}
                        </div>
                      )}
                    </div>
                    <div>
                      <label style={bookingFieldLabelStyle}>Driving Experience (years)</label>
                      <input
                        type="number"
                        min="0"
                        value={newBookingData.drivingExperience}
                        onChange={(e) => {
                          const v = e.target.value;
                          if (v !== "" && Number(v) < 0) return;
                          setNewBookingData({ ...newBookingData, drivingExperience: v });
                        }}
                        placeholder="e.g., 5"
                        style={bookingFieldInputStyle(false)}
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

                  {/* Derived directly from fleetData.fleet + the currently selected
                      plate on every render (no separate state to fall out of sync) —
                      so it always reflects the live status and swaps instantly when
                      a different car is picked. */}
                  {newBookingData.plate && (() => {
                    const car = fleetData.fleet.find(c => c.plate === newBookingData.plate);
                    return car ? (
                      <div style={{ display: "flex", alignItems: "center", gap: 8, margin: "-8px 0 16px" }}>
                        <span style={{ fontSize: 11, color: C.textMuted }}>Current Status:</span>
                        <StatusTag status={car.status} />
                      </div>
                    ) : null;
                  })()}

                  <div style={{ fontSize: 13, fontWeight: 700, color: C.navy, margin: "18px 0 14px" }}>📅 Rental Period</div>

                  {newBookingData.plate ? (
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                      <SingleDateCalendar
                        label="Pickup Date"
                        car={fleetData.fleet.find(c => c.plate === newBookingData.plate)}
                        bookings={calendarBookings}
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
                        bookings={calendarBookings}
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

                  {/* Instant availability check — re-evaluates on every
                      render, so it reacts immediately to a plate or date
                      change rather than waiting for Next/Submit. excludeBookingId
                      is editingBookingId (undefined when creating new), so a
                      booking never conflicts with its own current dates. */}
                  {(() => {
                    if (!newBookingData.plate || !newBookingData.start || !newBookingData.end) return null;
                    if (new Date(newBookingData.end) <= new Date(newBookingData.start)) return null;
                    const conflict = fleetData.checkBookingConflict(newBookingData.plate, newBookingData.start, newBookingData.end, editingBookingId);
                    if (!conflict) return null;
                    return (
                      <div style={{ marginTop: 12, padding: "10px 12px", borderRadius: 8, border: `1px solid ${C.red}55`, background: `${C.red}0f`, fontSize: 11.5, color: C.red, fontWeight: 600 }}>
                        ⚠️ {buildAvailabilityConflictMessage(conflict, newBookingData.start)}
                      </div>
                    );
                  })()}

                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginTop: 14 }}>
                    <div>
                      <label style={bookingFieldLabelStyle}>Pickup Time</label>
                      <TimeInput12h
                        value={newBookingData.pickupTime}
                        onChange={(pickupTime) => {
                          setNewBookingData(prev => ({ ...prev, pickupTime, start: combineDateTime(prev.pickupDate, pickupTime) }));
                        }}
                        style={bookingFieldInputStyle(false)}
                      />
                    </div>
                    <div>
                      <label style={bookingFieldLabelStyle}>Return Time</label>
                      <TimeInput12h
                        value={newBookingData.returnTime}
                        onChange={(returnTime) => {
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
                      placeholder="Dubai Marina"
                    />
                    <Input
                      label="Drop Location"
                      value={newBookingData.drop}
                      onChange={(e) => setNewBookingData({ ...newBookingData, drop: e.target.value })}
                      placeholder="Downtown Dubai"
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
                      Adding at least one driver here surfaces the Additional
                      Driver Charge field further down in Step 3 (Pricing &
                      Charges) — a single manual fee amount, not per-driver. */}
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
                            onClick={() => {
                              const remaining = newBookingData.additionalDrivers.filter(d => d.id !== driver.id);
                              setNewBookingData({
                                ...newBookingData,
                                additionalDrivers: remaining,
                                // No drivers left — clear the charge too, since
                                // the field itself disappears below.
                                additionalDriverCharge: remaining.length === 0 ? "" : newBookingData.additionalDriverCharge,
                              });
                            }}
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
                  <div style={{ fontSize: 13, fontWeight: 700, color: C.navy, marginBottom: 16 }}>🧾 Pricing & Charges</div>

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
                    {/* Only shown once at least one Additional Driver has been
                        added in Step 2 — adding a driver is what surfaces
                        this field, since there's no charge to enter otherwise. */}
                    {newBookingData.additionalDrivers.length > 0 && (
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
                    )}
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

                  {editingBookingId ? (
                    <div style={{ fontSize: 12, color: C.textMuted, border: `1px solid ${C.border}`, borderRadius: 10, padding: "14px 16px", background: C.bg }}>
                      Payments aren't recorded here while editing — record or view payments from the booking's <b>Pricing & Payment</b> tab instead.
                    </div>
                  ) : (
                    <>
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 14 }}>
                        <div>
                          <label style={bookingFieldLabelStyle}>Rental Amount</label>
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
                        <div>
                          <label style={bookingFieldLabelStyle}>Payment Date</label>
                          <input
                            type="date"
                            value={newBookingData.amountCollectedDate}
                            onChange={(e) => setNewBookingData({ ...newBookingData, amountCollectedDate: e.target.value })}
                            style={bookingFieldInputStyle(false)}
                          />
                        </div>
                        <div>
                          <label style={bookingFieldLabelStyle}>Payment Time</label>
                          <input
                            type="time"
                            value={newBookingData.amountCollectedTime}
                            onChange={(e) => setNewBookingData({ ...newBookingData, amountCollectedTime: e.target.value })}
                            style={bookingFieldInputStyle(false)}
                          />
                        </div>
                      </div>

                      <div style={{ marginBottom: 20 }}>
                        <label style={bookingFieldLabelStyle}>Transaction ID</label>
                        <input
                          type="text"
                          value={newBookingData.referenceCode}
                          onChange={(e) => setNewBookingData({ ...newBookingData, referenceCode: e.target.value })}
                          placeholder="Optional — Transaction ID/ Payment reference"
                          style={bookingFieldInputStyle(false)}
                        />
                      </div>

                      <div style={{ border: `1px solid ${C.tealFaint}`, borderRadius: 10, padding: "14px 16px", background: C.tealFaint, display: "flex", justifyContent: "space-between" }}>
                        <span style={{ fontSize: 13, fontWeight: 600, color: C.navy }}>Balance after this payment</span>
                        <span style={{ fontSize: 13, fontWeight: 700, color: C.teal, ...mono }}>{formatSGD(bookingBalance)}</span>
                      </div>
                    </>
                  )}
                </>
              ) : (
                <>
                  {createdBookingInfo ? (
                    <div style={{ border: `1px solid ${C.tealFaint}`, borderRadius: 10, padding: "14px 16px", background: C.tealFaint, marginBottom: 16 }}>
                      <div style={{ fontSize: 13, fontWeight: 700, color: C.navy, marginBottom: 4 }}>✅ Booking Confirmed</div>
                      <div style={{ fontSize: 11.5, color: C.textSec }}>
                        This booking is saved as <b>Confirmed</b> and every detail stays editable until the rental starts.
                        On the pickup day, open <b>Edit</b> on this booking and complete <b>Vehicle Handover</b> in the Review
                        step to record mileage, fuel, and condition — that's what generates the Rental Agreement and moves
                        this booking to Active.
                      </div>
                    </div>
                  ) : (
                    <div style={{ fontSize: 13, fontWeight: 700, color: C.navy, marginBottom: 16 }}>{editingBookingId ? "✅ Review & Save Changes" : "✅ Review & Confirm"}</div>
                  )}

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

                        {editingBookingId ? (
                          <div style={{ border: `1px solid ${C.border}`, borderRadius: 10, padding: "16px 18px", background: C.bg, display: "flex", justifyContent: "space-between" }}>
                            <span style={{ fontSize: 13.5, fontWeight: 700, color: C.navy }}>Agreement Total</span>
                            <span style={{ fontSize: 13.5, fontWeight: 700, color: C.teal, ...mono }}>{formatSGD(bookingTotal)}</span>
                          </div>
                        ) : (
                          <div style={{ border: `1px solid ${C.border}`, borderRadius: 10, padding: "16px 18px", background: C.bg }}>
                            <div style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", fontSize: 12.5, color: C.textSec }}>
                              <span>Total</span>
                              <span style={mono}>{formatSGD(bookingTotal)}</span>
                            </div>
                            <div style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", fontSize: 12.5, color: C.textSec }}>
                              <span>Rental Amount</span>
                              <span style={mono}>{formatSGD(bookingAmountCollected)}</span>
                            </div>
                            <div style={{ display: "flex", justifyContent: "space-between", marginTop: 8, paddingTop: 10, borderTop: `1px solid ${C.border}` }}>
                              <span style={{ fontSize: 13.5, fontWeight: 700, color: C.navy }}>Balance</span>
                              <span style={{ fontSize: 13.5, fontWeight: 700, color: C.teal, ...mono }}>{formatSGD(bookingBalance)}</span>
                            </div>
                          </div>
                        )}

                        {/* Vehicle Handover — lives in Step 5 (Review) of the Edit
                            Booking flow, above the Save Changes footer. Only shown
                            while editing an existing booking that hasn't been handed
                            over yet; once handoverAt is set, this collapses to a
                            simple confirmation line instead (booking is already
                            Active and the Agreement already generated). Completing
                            this doesn't use the Save Changes button below — it's
                            its own action (handleCompleteHandover) that updates the
                            booking, flips it to Active, and immediately generates
                            the Rental Agreement. */}
                        {editingBookingId && (() => {
                          const editingBooking = fleetData.bookings.find(b => b.id === editingBookingId);
                          const alreadyHandedOver = !!editingBooking?.handoverAt;
                          return alreadyHandedOver ? (
                            <div style={{ marginTop: 18, border: `1px solid ${C.tealFaint}`, borderRadius: 10, padding: "14px 16px", background: C.tealFaint }}>
                              <div style={{ fontSize: 13, fontWeight: 700, color: C.navy }}>✅ Vehicle Handover completed</div>
                              <div style={{ fontSize: 11.5, color: C.textSec, marginTop: 2 }}>
                                {formatDateTime(editingBooking.handoverAt)} — booking is Active and the Rental Agreement has been generated.
                              </div>
                            </div>
                          ) : (
                            <div style={{ marginTop: 18, border: `1px solid ${C.border}`, borderRadius: 10, padding: "16px 18px" }}>
                              <div style={{ fontSize: 13, fontWeight: 700, color: C.navy, marginBottom: 4 }}>🔑 Vehicle Handover</div>
                              <div style={{ fontSize: 11.5, color: C.textMuted, marginBottom: 16 }}>
                                When the customer arrives for pickup, record the starting mileage, fuel, and condition below.
                                Completing this moves the booking to Active and generates the Rental Agreement.
                              </div>
                              <div style={{ marginBottom: 14 }}>
                                <label style={bookingFieldLabelStyle}>Starting Mileage (km) <span style={{ color: C.red }}>*</span></label>
                                <input
                                  type="number"
                                  min="0"
                                  value={newBookingData.startingMileage}
                                  onChange={(e) => {
                                    const v = e.target.value;
                                    if (v !== "" && Number(v) < 0) return;
                                    setNewBookingData({ ...newBookingData, startingMileage: v });
                                  }}
                                  placeholder="9210"
                                  style={bookingFieldInputStyle(false)}
                                />
                              </div>
                              <div style={{ marginBottom: 14 }}>
                                <label style={bookingFieldLabelStyle}>Fuel Level <span style={{ color: C.red }}>*</span></label>
                                <select
                                  value={newBookingData.fuelLevel}
                                  onChange={(e) => setNewBookingData({ ...newBookingData, fuelLevel: e.target.value })}
                                  style={bookingFieldInputStyle(false)}
                                >
                                  <option value="">Select fuel level</option>
                                  <option value="Empty">Empty</option>
                                  <option value="1/4">1/4</option>
                                  <option value="1/2">1/2</option>
                                  <option value="3/4">3/4</option>
                                  <option value="Full">Full</option>
                                </select>
                              </div>
                              <div style={{ marginBottom: 16 }}>
                                <label style={bookingFieldLabelStyle}>Vehicle Condition</label>
                                <textarea
                                  value={newBookingData.vehicleCondition}
                                  onChange={(e) => setNewBookingData({ ...newBookingData, vehicleCondition: e.target.value })}
                                  placeholder="Note any existing scratches, dents, or issues before handing over the keys"
                                  rows={3}
                                  style={{ width: "100%", padding: "10px 12px", borderRadius: 8, border: `1px solid ${C.border}`, fontSize: 12, fontFamily: "inherit", outline: "none", resize: "vertical", boxSizing: "border-box" }}
                                />
                              </div>
                              <Btn primary onClick={handleCompleteHandover}>✅ Complete Handover</Btn>
                            </div>
                          );
                        })()}
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
                <Btn primary onClick={handleFinishBookingFlow}>Done</Btn>
              ) : (
                <Btn primary onClick={handleNewBookingSubmit}>{editingBookingId ? "Save Changes" : "Confirm & Create Booking"}</Btn>
              )}
            </div>
          </div>
        </>
      )}

      {/* COMPANY PROFILE MODAL */}
      {showCompanyProfileModal && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 300, padding: 20 }}
          onClick={() => setShowCompanyProfileModal(false)}>
          <div onClick={(e) => e.stopPropagation()} style={{ width: "100%", maxWidth: 640, maxHeight: "90vh", overflowY: "auto", background: C.surface, borderRadius: 14, border: `1px solid ${C.border}`, padding: 24 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 18 }}>
              <div>
                <div style={{ fontSize: 15, fontWeight: 700, color: C.navy }}>Company Profile</div>
                <div style={{ fontSize: 11, color: C.textMuted }}>Update your company information and preferences</div>
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                {!companyProfileEditing ? (
                  <Btn small primary onClick={() => setCompanyProfileEditing(true)}>✏️ Edit Profile</Btn>
                ) : (
                  <>
                    <Btn small onClick={() => { setCompanyProfileDraft(companyProfile); setCompanyProfileEditing(false); }}>Cancel</Btn>
                    <Btn small primary onClick={saveCompanyProfile}>Save Changes</Btn>
                  </>
                )}
                <Btn small onClick={() => setShowCompanyProfileModal(false)}>✕</Btn>
              </div>
            </div>

            <div style={{ display: "flex", gap: 20, marginBottom: 20 }}>
              <div style={{ flexShrink: 0, textAlign: "center" }}>
                <div style={{ width: 96, height: 96, borderRadius: 10, border: `1px dashed ${C.border}`, display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden", background: C.bg, marginBottom: 8 }}>
                  {companyProfileDraft.logo
                    ? <img src={companyProfileDraft.logo} alt="Company logo" style={{ width: "100%", height: "100%", objectFit: "contain" }} />
                    : <span style={{ fontSize: 28 }}>🚗</span>}
                </div>
                {companyProfileEditing && (
                  <label style={{ fontSize: 10.5, color: C.teal, fontWeight: 600, cursor: "pointer" }}>
                    Change Logo
                    <input type="file" accept="image/*" onChange={handleLogoChange} style={{ display: "none" }} />
                  </label>
                )}
              </div>
              <div style={{ flex: 1, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
                {[
                  ["name", "Company Name"], ["email", "Email"], ["phone", "Phone"],
                  ["address", "Address"], ["currency", "Currency"], ["timezone", "Timezone"],
                  ["gstNumber", "GST / Tax Number"], ["businessRegNumber", "Business Registration Number"], ["dateFormat", "Date Format"],
                ].map(([key, label]) => (
                  <div key={key} style={key === "address" ? { gridColumn: "1 / -1" } : undefined}>
                    <label style={bookingFieldLabelStyle}>{label}</label>
                    {companyProfileEditing ? (
                      <input
                        value={companyProfileDraft[key]}
                        onChange={(e) => setCompanyProfileDraft({ ...companyProfileDraft, [key]: e.target.value })}
                        style={bookingFieldInputStyle(false)}
                      />
                    ) : (
                      <div style={{ fontSize: 12.5, color: C.textPri, padding: "10px 0" }}>{companyProfile[key] || "—"}</div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* SETTINGS MODAL — Notifications + System Preferences */}
      {showSettingsModal && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 300, padding: 20 }}
          onClick={() => setShowSettingsModal(false)}>
          <div onClick={(e) => e.stopPropagation()} style={{ width: "100%", maxWidth: 920, maxHeight: "90vh", overflowY: "auto", background: C.surface, borderRadius: 14, border: `1px solid ${C.border}`, padding: 24 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
              <div style={{ fontSize: 15, fontWeight: 700, color: C.navy }}>Settings</div>
              <Btn small onClick={() => setShowSettingsModal(false)}>✕</Btn>
            </div>

            {/* Notifications */}
            <div style={{ marginBottom: 28 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 12 }}>
                <div>
                  <div style={{ fontSize: 13.5, fontWeight: 700, color: C.navy }}>Notifications</div>
                  <div style={{ fontSize: 11, color: C.textMuted }}>Configure email and system notification settings</div>
                </div>
                <Btn small primary onClick={saveNotificationDraft}>Save Changes</Btn>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 20 }}>
                <div>
                  <div style={{ fontSize: 11, fontWeight: 700, color: C.textSec, marginBottom: 8, textTransform: "uppercase", letterSpacing: 0.5 }}>Email Notifications</div>
                  {[
                    ["bookingConfirmation", "Booking Confirmation"],
                    ["bookingCancellation", "Booking Cancellation"],
                    ["paymentReceived", "Payment Received"],
                    ["maintenanceReminder", "Maintenance Reminder"],
                    ["insuranceExpiry", "Insurance Expiry"],
                    ["coeExpiry", "COE Expiry"],
                    ["vehicleReturnReminder", "Vehicle Return Reminder"],
                    ["customerPaymentReminder", "Customer Payment Reminder"],
                  ].map(([key, label]) => (
                    <label key={key} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: C.textPri, padding: "5px 0", cursor: "pointer" }}>
                      <input
                        type="checkbox"
                        checked={!!notifDraft.email[key]}
                        onChange={(e) => setNotifDraft({ ...notifDraft, email: { ...notifDraft.email, [key]: e.target.checked } })}
                      />
                      {label}
                    </label>
                  ))}
                </div>
                <div>
                  <div style={{ fontSize: 11, fontWeight: 700, color: C.textSec, marginBottom: 8, textTransform: "uppercase", letterSpacing: 0.5 }}>System Alerts</div>
                  {[
                    ["lowVehicleAvailability", "Low Vehicle Availability"],
                    ["overdueReturn", "Overdue Return"],
                    ["pendingPayments", "Pending Payments"],
                    ["restrictedDriverAttempt", "Restricted Driver Attempt"],
                    ["failedLoginAttempts", "Failed Login Attempts"],
                  ].map(([key, label]) => (
                    <label key={key} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: C.textPri, padding: "5px 0", cursor: "pointer" }}>
                      <input
                        type="checkbox"
                        checked={!!notifDraft.system[key]}
                        onChange={(e) => setNotifDraft({ ...notifDraft, system: { ...notifDraft.system, [key]: e.target.checked } })}
                      />
                      {label}
                    </label>
                  ))}
                </div>
                <div>
                  <div style={{ fontSize: 11, fontWeight: 700, color: C.textSec, marginBottom: 8, textTransform: "uppercase", letterSpacing: 0.5 }}>Reminder Timing</div>
                  {[
                    ["maintenanceReminderDays", "Maintenance Reminder"],
                    ["insuranceReminderDays", "Insurance Reminder"],
                    ["coeReminderDays", "COE Reminder"],
                    ["paymentReminderDays", "Payment Reminder"],
                  ].map(([key, label]) => (
                    <div key={key} style={{ marginBottom: 10 }}>
                      <label style={{ fontSize: 11, color: C.textMuted, display: "block", marginBottom: 3 }}>{label}</label>
                      <select
                        value={notifDraft.reminders[key]}
                        onChange={(e) => setNotifDraft({ ...notifDraft, reminders: { ...notifDraft.reminders, [key]: Number(e.target.value) } })}
                        style={bookingFieldInputStyle(false)}
                      >
                        {[7, 15, 30, 60, 90].map(d => <option key={d} value={d}>{d} Days Before</option>)}
                      </select>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* System Preferences */}
            <div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 12 }}>
                <div>
                  <div style={{ fontSize: 13.5, fontWeight: 700, color: C.navy }}>System Preferences</div>
                  <div style={{ fontSize: 11, color: C.textMuted }}>Configure general system preferences and default settings</div>
                </div>
                <Btn small primary onClick={savePreferencesDraft}>Save Changes</Btn>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 20 }}>
                <div>
                  <div style={{ fontSize: 11, fontWeight: 700, color: C.textSec, marginBottom: 8, textTransform: "uppercase", letterSpacing: 0.5 }}>General Settings</div>
                  {[["currency", "Company Currency"], ["timezone", "Timezone"], ["dateFormat", "Date Format"], ["language", "Language"]].map(([key, label]) => (
                    <div key={key} style={{ marginBottom: 10 }}>
                      <label style={{ fontSize: 11, color: C.textMuted, display: "block", marginBottom: 3 }}>{label}</label>
                      <input
                        value={prefsDraft.general[key]}
                        onChange={(e) => setPrefsDraft({ ...prefsDraft, general: { ...prefsDraft.general, [key]: e.target.value } })}
                        style={bookingFieldInputStyle(false)}
                      />
                    </div>
                  ))}
                </div>
                <div>
                  <div style={{ fontSize: 11, fontWeight: 700, color: C.textSec, marginBottom: 8, textTransform: "uppercase", letterSpacing: 0.5 }}>Booking Defaults</div>
                  {[["defaultRentalDuration", "Default Rental Duration"], ["gracePeriod", "Grace Period"]].map(([key, label]) => (
                    <div key={key} style={{ marginBottom: 10 }}>
                      <label style={{ fontSize: 11, color: C.textMuted, display: "block", marginBottom: 3 }}>{label}</label>
                      <input
                        value={prefsDraft.bookingDefaults[key]}
                        onChange={(e) => setPrefsDraft({ ...prefsDraft, bookingDefaults: { ...prefsDraft.bookingDefaults, [key]: e.target.value } })}
                        style={bookingFieldInputStyle(false)}
                      />
                    </div>
                  ))}
                  {[["lateReturnCharge", "Late Return Charge"], ["securityDepositRequired", "Security Deposit Required"], ["autoGenerateBookingNo", "Auto-Generate Booking No."]].map(([key, label]) => (
                    <label key={key} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: C.textPri, padding: "5px 0", cursor: "pointer" }}>
                      <input
                        type="checkbox"
                        checked={!!prefsDraft.bookingDefaults[key]}
                        onChange={(e) => setPrefsDraft({ ...prefsDraft, bookingDefaults: { ...prefsDraft.bookingDefaults, [key]: e.target.checked } })}
                      />
                      {label}
                    </label>
                  ))}
                </div>
                <div>
                  <div style={{ fontSize: 11, fontWeight: 700, color: C.textSec, marginBottom: 8, textTransform: "uppercase", letterSpacing: 0.5 }}>Customer Settings</div>
                  {[
                    ["allowDuplicatePhoneNumber", "Allow Duplicate Phone Number"],
                    ["requireDrivingLicense", "Require Driving License"],
                    ["requireICPassport", "Require IC / Passport"],
                    ["autoMarkCustomerActive", "Auto Mark Customer Active"],
                  ].map(([key, label]) => (
                    <div key={key} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "6px 0" }}>
                      <span style={{ fontSize: 12, color: C.textPri }}>{label}</span>
                      <div
                        onClick={() => setPrefsDraft({ ...prefsDraft, customerSettings: { ...prefsDraft.customerSettings, [key]: !prefsDraft.customerSettings[key] } })}
                        style={{ width: 36, height: 20, borderRadius: 10, background: prefsDraft.customerSettings[key] ? C.teal : C.border, position: "relative", cursor: "pointer", flexShrink: 0 }}
                      >
                        <div style={{ width: 16, height: 16, borderRadius: "50%", background: "#fff", position: "absolute", top: 2, left: prefsDraft.customerSettings[key] ? 18 : 2, transition: "left 0.15s" }} />
                      </div>
                    </div>
                  ))}
                </div>
                <div>
                  <div style={{ fontSize: 11, fontWeight: 700, color: C.textSec, marginBottom: 8, textTransform: "uppercase", letterSpacing: 0.5 }}>Fleet Settings</div>
                  <div style={{ marginBottom: 10 }}>
                    <label style={{ fontSize: 11, color: C.textMuted, display: "block", marginBottom: 3 }}>Default Vehicle Status</label>
                    <select
                      value={prefsDraft.fleetSettings.defaultVehicleStatus}
                      onChange={(e) => setPrefsDraft({ ...prefsDraft, fleetSettings: { ...prefsDraft.fleetSettings, defaultVehicleStatus: e.target.value } })}
                      style={bookingFieldInputStyle(false)}
                    >
                      <option>Available</option>
                      <option>Maintenance</option>
                    </select>
                  </div>
                  <div style={{ fontSize: 10.5, color: C.textMuted, lineHeight: 1.5 }}>
                    Maintenance / Insurance / COE reminder timing is set above under Notifications → Reminder Timing.
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* CHANGE PASSWORD MODAL */}
      <Modal
        open={showChangePasswordModal}
        title="Change Password"
        onClose={() => setShowChangePasswordModal(false)}
        onSubmit={submitChangePassword}
        submitText="Update Password"
      >
        <Input
          label="Current Password"
          type="password"
          value={passwordForm.current}
          onChange={(e) => setPasswordForm({ ...passwordForm, current: e.target.value })}
          placeholder="Enter current password"
        />
        <Input
          label="New Password"
          type="password"
          value={passwordForm.next}
          onChange={(e) => setPasswordForm({ ...passwordForm, next: e.target.value })}
          placeholder="At least 6 characters"
        />
        <Input
          label="Confirm New Password"
          type="password"
          value={passwordForm.confirm}
          onChange={(e) => setPasswordForm({ ...passwordForm, confirm: e.target.value })}
          placeholder="Re-enter new password"
        />
      </Modal>

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