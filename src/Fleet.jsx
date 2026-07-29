import { useState, useMemo } from "react";
import { C, mono, fmt, totalInv, daysUntil, generateTargetOptions } from "./theme";
import { Card, CardHeader, Btn, StatusTag, PlateBadge, SectionTitle } from "./components";
import AddCarWizard from "./AddCarWizard";


// ─────────────────────────────────────────────────────────────────────────
// Expense taxonomy — shared between the Add Expense form and Expense History
// ─────────────────────────────────────────────────────────────────────────
const EXPENSE_CATEGORIES = ["Repair", "Insurance", "Road Tax", "Fuel", "Cleaning", "Parking", "Tyres", "Accessories", "Other"];
// Maintenance Budget is auto-derived from these three "wear & upkeep" categories only —
// everything else (Insurance, Road Tax, Fuel, Cleaning, Parking, Other) still counts
// toward Total Expenses but not toward the Maintenance Budget figure.
const MAINTENANCE_CATEGORIES = ["Repair", "Tyres", "Accessories"];

const CATEGORY_META = {
  Repair: { icon: "🔧", color: C.red },
  Insurance: { icon: "🛡", color: C.teal },
  "Road Tax": { icon: "📋", color: C.navy },
  Fuel: { icon: "⛽", color: C.amber },
  Cleaning: { icon: "🧽", color: C.teal },
  Parking: { icon: "🅿", color: C.navy },
  Tyres: { icon: "🛞", color: C.red },
  Accessories: { icon: "✨", color: C.amber },
  Other: { icon: "📎", color: C.textMuted },
};

// ─────────────────────────────────────────────────────────────────────────
// Financial math — kept in one place so every consumer (summary tiles,
// pulse strip, status pill) reads from the same numbers.
// ─────────────────────────────────────────────────────────────────────────
const parseDateSafe = (s) => {
  if (!s) return null;
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
};

const getBookingDays = (b) => {
  if (b.days != null && !isNaN(Number(b.days))) return Number(b.days);
  const s = parseDateSafe(b.start || b.startDate || b.from);
  const e = parseDateSafe(b.end || b.endDate || b.to);
  if (!s || !e) return 0;
  const diff = Math.round((e - s) / 86400000);
  return diff > 0 ? diff : diff === 0 ? 1 : 0;
};

const getBookingRevenue = (b) => {
  if (b.amount != null && !isNaN(Number(b.amount))) return Number(b.amount);
  if (b.total != null && !isNaN(Number(b.total))) return Number(b.total);
  return (Number(b.rate) || 0) * getBookingDays(b);
};

const isCancelled = (b) => ["cancelled", "canceled"].includes(String(b.status || "").toLowerCase());

function computeCarFinancials(car, bookings, expenses) {
  const inv = totalInv(car);

  const carBookings = bookings.filter((b) => b.plate === car.plate && !isCancelled(b));
  const bookingRevenue = carBookings.reduce((sum, b) => sum + getBookingRevenue(b), 0);
  const totalBookings = carBookings.length;
  const rentalDays = carBookings.reduce((sum, b) => sum + getBookingDays(b), 0);

  const carExpenses = expenses
    .filter((e) => e.plate === car.plate)
    .sort((a, b) => (parseDateSafe(b.date) || 0) - (parseDateSafe(a.date) || 0));
 const maintenanceBudget = carExpenses.reduce(
  (sum, e) => sum + (Number(e.amount) || 0),
  0
);
 const netProfit = bookingRevenue - maintenanceBudget;
 const roi = inv > 0 ? (netProfit / inv) * 100 : 0;

  return { inv, bookingRevenue, totalBookings, rentalDays,  maintenanceBudget, netProfit, roi, carExpenses };
}

// ─────────────────────────────────────────────────────────────────────────
// Shared bits of the details page UI
// ─────────────────────────────────────────────────────────────────────────

const fieldStyle = {
  width: "100%", padding: "7px 9px", borderRadius: 7, border: `1px solid ${C.border}`,
  fontFamily: "inherit", fontSize: 12, outline: "none", boxSizing: "border-box", background: C.surface, color: C.textPri,
};

// Compact row for details modal
const CompactRow = ({ label, value, valueColor, bold, useMono = true }) => (
  <div style={{
    display: "flex", justifyContent: "space-between", alignItems: "center",
    padding: "8px 0",
    borderBottom: `1px solid ${C.border}`,
    fontSize: 12,
  }}>
    <span style={{ color: C.textMuted, fontWeight: 500, fontSize: 11 }}>{label}</span>
    <span style={{ ...(useMono ? mono : {}), fontWeight: bold ? 700 : 600, color: valueColor || C.textPri, fontSize: 12 }}>
      {value}
    </span>
  </div>
);

// Right-side slide-over drawer for logging a new expense. Rendered via a fixed
// backdrop + panel so opening/closing it never navigates away from the details page.
const ExpenseDrawer = ({ car, onAddExpense, onClose }) => {
  const [category, setCategory] = useState(EXPENSE_CATEGORIES[0]);
  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [error, setError] = useState("");

  const handleSave = () => {
    const amt = parseFloat(amount);
    if (!description.trim()) { setError("Add a short description for this expense."); return; }
    if (!amt || amt <= 0) { setError("Enter an amount greater than 0."); return; }
    if (!date) { setError("Pick a date for this expense."); return; }
    if (typeof onAddExpense !== "function") { setError("Expense saving isn't wired up yet."); return; }

    onAddExpense({ plate: car.plate, category, description: description.trim(), amount: amt, date });
    onClose(); // save closes the drawer immediately; the page re-renders with fresh totals from props
  };

  return (
    <>
      <style>{`
        @keyframes fleetModalFade { from { opacity: 0; } to { opacity: 1; } }
        @keyframes fleetModalPop { from { opacity: 0; transform: translate(-50%, -50%) scale(0.96); } to { opacity: 1; transform: translate(-50%, -50%) scale(1); } }
      `}</style>
      {/* Light backdrop — keeps the Fleet Details page visible behind the modal */}
      <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(15, 23, 42, 0.22)", zIndex: 60, animation: "fleetModalFade 0.15s ease" }} />
      <div style={{
        position: "fixed", top: "50%", left: "50%", transform: "translate(-50%, -50%)",
        width: "100%", maxWidth: 380, margin: "0 14px", maxHeight: "85vh",
        background: C.surface, zIndex: 61, display: "flex", flexDirection: "column",
        border: `1px solid ${C.border}`, borderRadius: 12,
        boxShadow: "0 16px 40px rgba(15, 23, 42, 0.18)", animation: "fleetModalPop 0.18s cubic-bezier(.2,.8,.2,1)",
        overflow: "hidden",
      }}>
        <div style={{ padding: "10px 14px", display: "flex", justifyContent: "space-between", alignItems: "center", borderBottom: `1px solid ${C.border}` }}>
          <div style={{ fontSize: 13.5, fontWeight: 700, color: C.navy }}>Add Expense</div>
          <button onClick={onClose} aria-label="Close" style={{ background: "none", border: "none", fontSize: 14, color: C.textMuted, cursor: "pointer", lineHeight: 1, padding: 4 }}>✕</button>
        </div>

        <div style={{ padding: 12, overflowY: "auto", flex: 1 }}>
          <div style={{ marginBottom: 8 }}>
            <div style={{ fontSize: 10, color: C.textMuted, fontWeight: 600, marginBottom: 3 }}>Category</div>
            <select value={category} onChange={(e) => setCategory(e.target.value)} style={{ ...fieldStyle, cursor: "pointer" }}>
              {EXPENSE_CATEGORIES.map((c) => (
                <option key={c} value={c}>{CATEGORY_META[c].icon} {c}</option>
              ))}
            </select>
          </div>
          <div style={{ marginBottom: 8 }}>
            <div style={{ fontSize: 10, color: C.textMuted, fontWeight: 600, marginBottom: 3 }}>Description</div>
            <input type="text" value={description} onChange={(e) => setDescription(e.target.value)}
              placeholder="Enter description" style={fieldStyle} />
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 8 }}>
            <div>
              <div style={{ fontSize: 10, color: C.textMuted, fontWeight: 600, marginBottom: 3 }}>Amount (SGD)</div>
              <input type="number" min="0" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)}
                placeholder="0.00" style={{ ...fieldStyle, fontFamily: mono.fontFamily }} />
            </div>
            <div>
              <div style={{ fontSize: 10, color: C.textMuted, fontWeight: 600, marginBottom: 3 }}>Date</div>
              <input type="date" value={date} onChange={(e) => setDate(e.target.value)} style={fieldStyle} />
            </div>
          </div>

          {error && <div style={{ fontSize: 10.5, color: C.red, marginBottom: 8 }}>{error}</div>}

          <Btn primary small onClick={handleSave} style={{ width: "100%" }}>Save Expense</Btn>
        </div>
      </div>
    </>
  );
};

// ─────────────────────────────────────────────────────────────────────────
// Compact Vehicle Details Modal — overlays on top of Fleet list
// ─────────────────────────────────────────────────────────────────────────
const VehicleDetailsModal = ({ car, bookings, expenses, onAddExpense, onUpdateCar, onCompleteMaintenance, onDelete, onClose }) => {
  const fin = useMemo(() => computeCarFinancials(car, bookings, expenses), [car, bookings, expenses]);
  const d = daysUntil(car.coe);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const recoveryPct = fin.inv > 0 ? Math.min((fin.bookingRevenue / fin.inv) * 100, 100) : 0;
  const profitColor = fin.netProfit > 0 ? C.green : fin.netProfit < 0 ? C.red : C.amber;
  const inMaintenance = car.status === "Maintenance";
  const maintDaysIn = inMaintenance && car.maintenanceStartDate
    ? Math.floor((new Date() - new Date(car.maintenanceStartDate)) / 86400000)
    : null;

  return (
    <>
      <style>{`
        @keyframes detailsFade { from { opacity: 0; } to { opacity: 1; } }
        @keyframes detailsSlide { from { opacity: 0; transform: translateY(-20px); } to { opacity: 1; transform: translateY(0); } }
      `}</style>
      {/* Backdrop */}
      <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(15, 23, 42, 0.3)", zIndex: 40, animation: "detailsFade 0.15s ease" }} />
      
      {/* Modal */}
      <div style={{
        position: "fixed", top: "55%", left: "50%", transform: "translate(-50%, -50%)",
        width: "100%", maxWidth: 520, margin: "0 14px", maxHeight: "75vh",
        background: C.surface, zIndex: 41, display: "flex", flexDirection: "column",
        border: `1px solid ${C.border}`, borderRadius: 14,
        boxShadow: "0 20px 60px rgba(15, 23, 42, 0.25)", animation: "detailsSlide 0.2s cubic-bezier(.2,.8,.2,1)",
        overflow: "hidden",
      }}>
        {/* Header */}
        <div style={{ padding: "14px 16px", display: "flex", justifyContent: "space-between", alignItems: "center", borderBottom: `1px solid ${C.border}`, flexShrink: 0 }}>
          <div>
            <div style={{ fontSize: 14, fontWeight: 700, color: C.navy }}>{car.make} {car.model}</div>
            <div style={{ fontSize: 11, color: C.textMuted, marginTop: 2 }}>{car.plate}</div>
          </div>
          <button onClick={onClose} aria-label="Close" style={{ background: "none", border: "none", fontSize: 18, color: C.textMuted, cursor: "pointer", lineHeight: 1, padding: 4 }}>✕</button>
        </div>

        {/* Scrollable Content */}
        <div style={{ padding: "8px 12px", overflowY: "auto", flex: 1, fontSize: 12 }}>
          
          {/* Status & Registration Alert */}
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12, paddingBottom: 12, borderBottom: `1px solid ${C.border}` }}>
            <StatusTag status={toFleetPageStatus(car.status)} />
            {inMaintenance ? (
              <div style={{
                fontSize: 10.5, fontWeight: 600, padding: "6px 10px", borderRadius: 8,
                background: maintDaysIn >= 2 ? C.redFaint : C.amberFaint,
                color: maintDaysIn >= 2 ? C.red : C.amber,
              }}>
                🔧 Day {maintDaysIn + 1} of 3 in maintenance{maintDaysIn >= 2 ? " — auto-release soon" : ""}
              </div>
            ) : (
              <div style={{
                fontSize: 10.5, fontWeight: 600, padding: "6px 10px", borderRadius: 8,
                background: d < 30 ? C.redFaint : d < 90 ? C.amberFaint : C.greenFaint,
                color: d < 30 ? C.red : d < 90 ? C.amber : C.green,
              }}>
                {d < 30 ? "⚠" : d < 90 ? "⚡" : "✓"} Reg. Expiry: {car.coe}
              </div>
            )}
          </div>

          {/* Vehicle Details */}
          <div style={{ marginBottom: 12 }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: C.navy, textTransform: "uppercase", marginBottom: 8 }}>Vehicle</div>
            <CompactRow label="Make" value={car.make} useMono={false} />
            <CompactRow label="Model" value={car.model} useMono={false} />
            <CompactRow label="Year" value={car.year} useMono={false} />
            <CompactRow label="Colour" value={car.color} useMono={false} />
          </div>

          {/* Investment */}
          <div style={{ marginBottom: 12 }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: C.navy, textTransform: "uppercase", marginBottom: 8 }}>Investment</div>
            <CompactRow label="Purchase" value={fmt(car.purchase)} />
            <CompactRow label="Insurance" value={fmt(car.insurance)} />
            <CompactRow label="Registration" value={fmt(car.reg)} />
            <CompactRow label="Other Charges" value={fmt(car.otherCharges || 0)} />
            <CompactRow label="Total" value={fmt(fin.inv)} valueColor={C.green} bold />
          </div>

          {/* Financial Summary — Simplified */}
       <div style={{ marginBottom: 12 }}>
  <div style={{ fontSize: 10, fontWeight: 700, color: C.navy, textTransform: "uppercase", marginBottom: 8 }}>
    Financial Summary
  </div>

  <CompactRow label="Total Investment" value={fmt(fin.inv)} valueColor={C.navy} bold />
  <CompactRow label="Booking Revenue" value={fmt(fin.bookingRevenue)} valueColor={C.green} />
  <CompactRow label="Maintenance Cost" value={fmt(fin.maintenanceBudget)} valueColor={C.amber} />
  <CompactRow label="Net Profit" value={fmt(fin.netProfit)} valueColor={profitColor} bold />
  <CompactRow label="ROI" value={`${fin.roi.toFixed(2)}%`} valueColor={profitColor} bold />
</div>

          {/* Performance Metrics */}
          <div style={{ marginBottom: 12 }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: C.navy, textTransform: "uppercase", marginBottom: 8 }}>Performance</div>
            <CompactRow label="Rental Days" value={`${fin.rentalDays}d`} useMono={false} />
            <CompactRow label="Total Bookings" value={fin.totalBookings} useMono={false} />
            <CompactRow label="Recovery %" value={`${recoveryPct.toFixed(0)}%`} useMono={false} />
            
            {/* Recovery Progress Bar */}
            <div style={{ marginTop: 8 }}>
              <div style={{ position: "relative", height: 6, background: C.bg, borderRadius: 3, overflow: "hidden" }}>
                <div style={{ width: `${recoveryPct}%`, height: "100%", background: C.teal, borderRadius: 3 }} />
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 9, color: C.textMuted, marginTop: 4 }}>
                <span>{fmt(fin.bookingRevenue)}</span>
                <span>Target: {fmt(fin.inv)}</span>
              </div>
            </div>
          </div>

          {/* Action Buttons */}
          <div style={{ marginTop: 12, display: "flex", gap: 8 }}>
            <Btn small onClick={() => setDrawerOpen(true)} style={{ flex: 1, background: C.greenFaint, color: C.green, border: `1px solid ${C.green}` }}>
              + Add Expense
            </Btn>
            {inMaintenance && (
              <Btn small onClick={() => onCompleteMaintenance && onCompleteMaintenance(car.plate)}
                style={{ background: C.tealFaint, color: C.teal, border: `1px solid ${C.teal}`, fontWeight: 700 }}>
                ✓ Complete Maintenance
              </Btn>
            )}
            <Btn small>Edit</Btn>
            <Btn small onClick={onDelete} style={{ background: C.redFaint, color: C.red, border: `1px solid ${C.red}` }}>Delete</Btn>
          </div>
        </div>
      </div>

      {drawerOpen && (
        <ExpenseDrawer car={car} onAddExpense={onAddExpense} onClose={() => setDrawerOpen(false)} />
      )}
    </>
  );
};

// Helper function to categorize COE status
const getCOEStatus = (daysRemaining) => {
  if (daysRemaining < 0) return "Expired";
  if (daysRemaining <= 30) return "Expiring in 30 Days";
  if (daysRemaining <= 90) return "Expiring in 90 Days";
  if (daysRemaining <= 180) return "Expiring in 180 Days";
  return "Active";
};

// Accent color for each fleet status, used by the status filter pills.
// Exported so other screens (e.g. the Booking module's availability timeline)
// render the same four statuses with the exact same colors instead of
// maintaining a second color mapping that could drift out of sync.
export const STATUS_PILL_COLORS = {
  Available: C.green,
  Maintenance: C.amber,
  Upcoming: C.tealLight,
  "On Rental": C.teal,
  "Ending Today": C.red,
  Rented: C.teal,
  Booked: C.teal,
  Inactive: C.textMuted,
};
export const STATUS_PILL_FAINT = {
  Available: C.greenFaint,
  Maintenance: C.amberFaint,
  Upcoming: C.tealFaint,
  "On Rental": C.tealFaint,
  "Ending Today": C.redFaint,
  Rented: C.tealFaint,
  Booked: C.tealFaint,
  Inactive: C.bg,
};
const getStatusPillColor = (status) => STATUS_PILL_COLORS[status] || C.navy;
const getStatusPillFaint = (status) => STATUS_PILL_FAINT[status] || C.tealFaint;

// Fleet page only ever needs to distinguish Available / On Rental / Maintenance.
// "Upcoming" and "Ending Today" are booking-level nuances the Dashboard and
// Booking module still rely on — the underlying car.status (and everything
// computeFleetStatus/Dashboard/Booking derive from it) is untouched. This is
// purely a presentation-layer remap applied right before this page renders a
// status pill or filters by status:
//   Upcoming      → Available    (car is free until the future booking starts)
//   Ending Today  → On Rental    (still out until the day ends)
//   everything else passes through unchanged
const FLEET_PAGE_STATUS_MAP = {
  Upcoming: "Available",
  "Ending Today": "On Rental",
};
const toFleetPageStatus = (status) => FLEET_PAGE_STATUS_MAP[status] || status;

// ─────────────────────────────────────────────────────────────────────────
// Fleet — table/filter list + modal details overlay
// ─────────────────────────────────────────────────────────────────────────
const Fleet = ({ fleet = [], onAddFleet, onUpdateCar, onDeleteCar, onCompleteMaintenance, calculateCarMetrics, bookings = [], expenses = [], onAddExpense }) => {
  const [selected, setSelected] = useState(null);
  const [wizardOpen, setWizardOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedPlate, setSelectedPlate] = useState("All Plates");
  const [coeFilter, setCoeFilter] = useState("All Registration");
  const [statusPillFilter, setStatusPillFilter] = useState("All");
  const [sortField, setSortField] = useState(null);   // 'plate' | 'purchaseDate' | 'coe'
  const [sortDir, setSortDir] = useState("asc");

  // Generate unique plates from fleet (automatically updates when fleet changes)
  const uniquePlates = useMemo(() => {
    return fleet.map(c => c.plate).sort();
  }, [fleet]);

  // Status pill counts (Available / Maintenance / etc.) — computed from the
  // full fleet so the numbers on the pills don't shift as other filters change.
  const statusCounts = useMemo(() => {
    const counts = {};
    fleet.forEach(c => { const s = toFleetPageStatus(c.status); counts[s] = (counts[s] || 0) + 1; });
    return counts;
  }, [fleet]);
  const statusPillOptions = useMemo(() => {
    return Object.keys(statusCounts).sort();
  }, [statusCounts]);

  // Combined filtering logic
  const filteredFleet = useMemo(() => {
    return fleet.filter(car => {
      // Search filter across 6 fields
      const searchLower = searchTerm.toLowerCase();
      const matchesSearch =
        car.plate.toLowerCase().includes(searchLower) ||
        car.make.toLowerCase().includes(searchLower) ||
        car.model.toLowerCase().includes(searchLower) ||
        car.year.toString().includes(searchLower) ||
        car.color.toLowerCase().includes(searchLower) ||
        toFleetPageStatus(car.status).toLowerCase().includes(searchLower);

      // Plate filter
      const matchesPlate = selectedPlate === "All Plates" || car.plate === selectedPlate;

      // Status pill filter (All / Available / Maintenance / ...)
      const matchesStatusPill = statusPillFilter === "All" || toFleetPageStatus(car.status) === statusPillFilter;

      // Registration expiry filter (car.coe field kept for data compatibility)
      let matchesCOE = true;
      if (coeFilter !== "All Registration") {
        const daysRemaining = daysUntil(car.coe);
        const coeStatus = getCOEStatus(daysRemaining);
        matchesCOE = coeStatus === coeFilter;
      }

      return matchesSearch && matchesPlate && matchesStatusPill && matchesCOE;
    });
  }, [fleet, searchTerm, selectedPlate, statusPillFilter, coeFilter]);

  // Sort layered on top of the filter — sorts whatever filteredFleet currently
  // contains, so filter + sort compose cleanly instead of fighting each other.
  const sortedFleet = useMemo(() => {
    if (!sortField) return filteredFleet;
    const dir = sortDir === "asc" ? 1 : -1;
    const arr = [...filteredFleet];
    arr.sort((a, b) => {
      if (sortField === "plate") return a.plate.localeCompare(b.plate) * dir;
      // purchaseDate / coe are 'YYYY-MM-DD' strings — Date works, but missing
      // purchaseDate on older records shouldn't crash the sort, just sink to one end.
      const aVal = new Date(a[sortField] || 0).getTime();
      const bVal = new Date(b[sortField] || 0).getTime();
      return (aVal - bVal) * dir;
    });
    return arr;
  }, [filteredFleet, sortField, sortDir]);

  // Get selected car from sorted fleet
  const car = selected !== null ? sortedFleet[selected] : null;

  const handleSort = (field) => {
    if (sortField === field) {
      setSortDir(d => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortField(field);
      setSortDir("asc");
    }
  };

  const handleWizardComplete = (carData) => {
    onAddFleet(carData);
    setWizardOpen(false);
  };

  const handleDelete = (plate) => {
    if (window.confirm("Are you sure you want to delete this car? This action cannot be undone.")) {
      onDeleteCar(plate);
      setSelected(null);
    }
  };

  return (
    <div>
      {/* Header with Add New Car Button */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <div>
          <div style={{ fontSize: 15, fontWeight: 700, color: C.navy }}>Fleet Management</div>
          <div style={{ fontSize: 11, color: C.textMuted }}>{fleet.length} cars registered · Click a row to view details</div>
        </div>
        <Btn primary onClick={() => setWizardOpen(true)}>+ Add New Car</Btn>
      </div>

      {/* Status filter pills — click a status to show only that status, click All to reset */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 16 }}>
        {[["All", fleet.length], ...statusPillOptions.map(s => [s, statusCounts[s]])].map(([label, count]) => {
          const isActive = statusPillFilter === label;
          const dotColor = label === "All" ? C.navy : getStatusPillColor(label);
          return (
            <button key={label} onClick={() => setStatusPillFilter(label)} style={{
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

      {/* Add Car Wizard Modal */}
      {wizardOpen && (
        <AddCarWizard onComplete={handleWizardComplete} onClose={() => setWizardOpen(false)} />
      )}

      {/* Filter and Search Section */}
      <Card style={{ marginBottom: 16 }}>
        <div style={{ padding: 16 }}>
          <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr", gap: 12 }}>
            {/* Search Box */}
            <div>
              <label style={{ fontSize: 10, color: C.textMuted, fontWeight: 600, display: "block", marginBottom: 6 }}>
                Search Vehicles
              </label>
              <input
                type="text"
                placeholder="Search by plate, make, model, year, colour, or status..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                style={{
                  width: "100%",
                  padding: "10px 12px",
                  borderRadius: 8,
                  border: `1px solid ${C.border}`,
                  fontSize: 13,
                  fontFamily: "inherit",
                  outline: "none",
                  boxSizing: "border-box",
                  transition: "border-color 0.2s",
                }}
                onFocus={(e) => e.target.style.borderColor = C.teal}
                onBlur={(e) => e.target.style.borderColor = C.border}
              />
            </div>

            {/* Plate Filter */}
            <div>
              <label style={{ fontSize: 10, color: C.textMuted, fontWeight: 600, display: "block", marginBottom: 6 }}>
                Filter by Plate
              </label>
              <select
                value={selectedPlate}
                onChange={(e) => setSelectedPlate(e.target.value)}
                style={{
                  width: "100%",
                  padding: "10px 12px",
                  borderRadius: 8,
                  border: `1px solid ${C.border}`,
                  fontSize: 13,
                  fontFamily: "inherit",
                  background: C.surface,
                  cursor: "pointer",
                  outline: "none",
                  color: C.textPri,
                }}
              >
                <option value="All Plates">All Plates ({fleet.length})</option>
                {uniquePlates.map((plate) => (
                  <option key={plate} value={plate}>
                    {plate}
                  </option>
                ))}
              </select>
            </div>

            {/* Registration Expiry Filter */}
            <div>
              <label style={{ fontSize: 10, color: C.textMuted, fontWeight: 600, display: "block", marginBottom: 6 }}>
                Filter by  Status
              </label>
              <select
                value={coeFilter}
                onChange={(e) => setCoeFilter(e.target.value)}
                style={{
                  width: "100%",
                  padding: "10px 12px",
                  borderRadius: 8,
                  border: `1px solid ${C.border}`,
                  fontSize: 13,
                  fontFamily: "inherit",
                  background: C.surface,
                  cursor: "pointer",
                  outline: "none",
                  color: C.textPri,
                }}
              >
                <option value="All Registration">All </option>
                <option value="Active">Active</option>
                <option value="Expiring in 180 Days">Expiring in 180 Days</option>
                <option value="Expiring in 90 Days">Expiring in 90 Days</option>
                <option value="Expiring in 30 Days">Expiring in 30 Days</option>
                <option value="Expired">Expired</option>
              </select>
            </div>
          </div>

          {/* Filter Status */}
          {(searchTerm || selectedPlate !== "All Plates" || coeFilter !== "All Registration") && (
            <div style={{ marginTop: 12, padding: 10, background: C.bg, borderRadius: 6, fontSize: 12, color: C.textMuted, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
              <div>
                Showing <span style={{ fontWeight: 700, color: C.navy }}>{filteredFleet.length}</span> of{" "}
                <span style={{ fontWeight: 700, color: C.navy }}>{fleet.length}</span> vehicles
                {searchTerm && <span> • Search: "{searchTerm}"</span>}
                {selectedPlate !== "All Plates" && <span> • Plate: {selectedPlate}</span>}
                {coeFilter !== "All Registration" && <span> • Registration: {coeFilter}</span>}
              </div>
              <Btn small onClick={() => { setSearchTerm(""); setSelectedPlate("All Plates"); setCoeFilter("All Registration"); }} style={{ flexShrink: 0 }}>
                Clear All
              </Btn>
            </div>
          )}
        </div>
      </Card>

      {/* Fleet Table */}
      <Card>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ background: C.bg }}>
              {[
                { label: "Plate", field: "plate" },
                { label: "Make / Model", field: null },
                { label: "Year", field: null },
                { label: "Colour", field: null },
                { label: "Investment (SGD)", field: null },
                { label: "Purchase Date", field: "purchaseDate" },
                { label: "Reg. Expiry", field: "coe" },
                { label: "Maint %", field: null },
                { label: "Status", field: null },
                { label: "", field: null },
              ].map(({ label, field }) => {
                const isActive = field && sortField === field;
                return (
                  <th key={label || "actions"}
                    onClick={field ? () => handleSort(field) : undefined}
                    style={{
                      textAlign: "left", padding: "9px 12px", fontSize: 10, fontWeight: 600,
                      color: isActive ? C.navy : C.textMuted, textTransform: "uppercase", letterSpacing: 0.5,
                      borderBottom: `1px solid ${C.border}`, whiteSpace: "nowrap",
                      cursor: field ? "pointer" : "default", userSelect: "none",
                    }}>
                    {label}
                    {field && (
                      <span style={{ marginLeft: 4, opacity: isActive ? 1 : 0.35 }}>
                        {isActive ? (sortDir === "asc" ? "▲" : "▼") : "⇅"}
                      </span>
                    )}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {sortedFleet.map((c, i) => {
              const inv = totalInv(c);
              const d = daysUntil(c.coe);
              return (
                <tr key={c.plate} onClick={() => setSelected(i)}
                  onMouseEnter={(e) => e.currentTarget.style.background = C.bg}
                  onMouseLeave={(e) => e.currentTarget.style.background = "transparent"}
                  style={{ borderBottom: `1px solid ${C.border}`, cursor: "pointer", background: "transparent", transition: "background 0.12s" }}>
                  <td style={{ padding: "11px 12px" }}><PlateBadge plate={c.plate} /></td>
                  <td style={{ padding: "11px 12px" }}>
                    <div style={{ fontSize: 12, fontWeight: 600 }}>{c.make}</div>
                    <div style={{ fontSize: 10, color: C.textMuted }}>{c.model}</div>
                  </td>
                  <td style={{ padding: "11px 12px", fontSize: 12 }}>{c.year}</td>
                  <td style={{ padding: "11px 12px" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <div style={{ width: 10, height: 10, borderRadius: "50%", background: { Silver: "#C0C0C0", White: "#F5F5F5", Blue: "#4472C4", Black: "#222", Red: "#D64045", Grey: "#888" }[c.color] || "#aaa", border: `1px solid ${C.border}` }} />
                      <span style={{ fontSize: 12 }}>{c.color}</span>
                    </div>
                  </td>
                  <td style={{ padding: "11px 12px", ...mono, fontSize: 11 }}>{fmt(inv)}</td>
                  <td style={{ padding: "11px 12px", fontSize: 11, color: C.textSec }}>{c.purchaseDate || "—"}</td>
                  <td style={{ padding: "11px 12px", fontSize: 11, color: d < 30 ? C.red : d < 90 ? C.amber : C.textMuted, fontWeight: d < 90 ? 700 : 400 }}>
                    {c.coe} {d < 30 ? "⚠" : d < 90 ? "⚡" : ""}
                  </td>
                  <td style={{ padding: "11px 12px", ...mono, fontSize: 11 }}>{c.maint}%</td>
                  <td style={{ padding: "11px 12px" }}><StatusTag status={toFleetPageStatus(c.status)} /></td>
                  <td style={{ padding: "11px 12px" }}>
                    <span style={{ fontSize: 11, color: C.teal, fontWeight: 600 }}>Details →</span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {sortedFleet.length === 0 && (
          <div style={{ padding: 40, textAlign: "center", color: C.textMuted, fontSize: 13 }}>
            {fleet.length === 0 ? "No cars registered yet" : "No vehicles match your filters"}
          </div>
        )}
      </Card>

      {/* Vehicle Details Modal Overlay */}
      {car && (
        <VehicleDetailsModal
          car={car}
          bookings={bookings}
          expenses={expenses}
          onAddExpense={onAddExpense}
          onUpdateCar={onUpdateCar}
          onCompleteMaintenance={onCompleteMaintenance}
          onDelete={() => handleDelete(car.plate)}
          onClose={() => setSelected(null)}
        />
      )}
    </div>
  );
};

export default Fleet;