import { useState } from "react";
import { C } from "./theme";
import { Btn, Badge, Modal, Input, Select } from "./components";
import { useFleetData, buildAvailabilityConflictMessage } from "./useFleetData";
import AddCarWizard from "./AddCarWizard";

import Dashboard from "./Dashboard";
import Fleet from "./Fleet";
import Booking, { AvailabilityTimeline } from "./Booking";
import Earning from "./Earning";
import Expenses from "./Expenses";
import PlReport from "./pl report";
import Alert from "./Alert";
import Settings from "./Settings";

export default function FleetOpzApp() {
  const [active, setActive] = useState("dashboard");
  const [selectedCar, setSelectedCar] = useState("All Cars");
  const [selectedRange, setSelectedRange] = useState("2026-06");
  const [showNewBooking, setShowNewBooking] = useState(false);
  const [showNewFleet, setShowNewFleet] = useState(false);
  const [showNewUser, setShowNewUser] = useState(false);

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
    start: "",
    end: "",
    pickup: "",
    drop: "",
    rate: "",
    attachment: null,   // { name, type, size, dataUrl } once a valid file is chosen
    comments: "",
  });
  const [attachmentError, setAttachmentError] = useState("");

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
        onNewBooking={() => setShowNewBooking(true)}
        onAddBooking={fleetData.addBooking}
        onUpdateBooking={fleetData.updateBooking}
        onDeleteBooking={fleetData.deleteBooking}
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
    fleetData.addBooking({
      ...newBookingData,
      status: "Active",
    });
    alert(`Booking created for ${newBookingData.customer} on ${newBookingData.plate}`);
    setNewBookingData({ plate: "", customer: "", ic: "",  contact: "", start: "", end: "", pickup: "", drop: "", rate: "", attachment: null, comments: "" });
    setAttachmentError("");
    setShowNewBooking(false);
  };

  const handleNewUserSubmit = (e) => {
    e.preventDefault();
    alert(`User added: ${newUserData.name} (${newUserData.role}) — ${newUserData.email}`);
    setNewUserData({ name: "", email: "", role: "Staff" });
    setShowNewUser(false);
  };

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

      {/* NEW BOOKING MODAL */}
      <Modal
        open={showNewBooking}
        title="New Booking"
        onClose={() => setShowNewBooking(false)}
        onSubmit={handleNewBookingSubmit}
        submitText="Create Booking"
      >
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
        {newBookingData.plate && (
          <AvailabilityTimeline
            car={fleetData.fleet.find(c => c.plate === newBookingData.plate)}
            bookings={fleetData.bookings}
          />
        )}
        <Input
          label="Customer Name"
          value={newBookingData.customer}
          onChange={(e) => setNewBookingData({ ...newBookingData, customer: e.target.value })}
          placeholder="e.g., Ahmed Al Mansoori"
        />
         <Input
          label="IC Number"
          value={newBookingData.ic}
          onChange={(e) => {
            let v = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "");
            if (v.length > 9) v = v.slice(0, 9);
            setNewBookingData({ ...newBookingData, ic: v });
          }}
          placeholder="e.g., S8901234A"
        />
        <Input
          label="Contact Number"
          value={newBookingData.contact}
          onChange={(e) => {
            const v = e.target.value.replace(/\D/g, "").slice(0, 10);
            setNewBookingData({ ...newBookingData, contact: v });
          }}
          placeholder="e.g., 0501234567"
        />
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <Input
            label="Start Date & Time"
            type="datetime-local"
            value={newBookingData.start}
            onChange={(e) => setNewBookingData({ ...newBookingData, start: e.target.value })}
          />
          <Input
            label="End Date & Time"
            type="datetime-local"
            value={newBookingData.end}
            onChange={(e) => setNewBookingData({ ...newBookingData, end: e.target.value })}
          />
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
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
        <Input
          label="Daily Rate (AED)"
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

          <div style={{ marginTop: 10 }}>
            <Input
              label="Driving License Number"
              value={newBookingData.license}
              onChange={(e) => setNewBookingData({ ...newBookingData, license: e.target.value.toUpperCase() })}
              placeholder="e.g., DL-2024-88213"
            />
            {newBookingData.license && restrictedLicenses.some(
              r => r.licenseNumber.trim().toUpperCase() === newBookingData.license.trim().toUpperCase()
            ) && (
              <div style={{ fontSize: 11, color: C.red, marginTop: -8, fontWeight: 600 }}>
                This driving license has an active criminal case. Booking cannot be created.
              </div>
            )}
          </div>
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