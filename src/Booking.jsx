import { useState, useEffect, useRef } from "react";
import { C, mono, fmt } from "./theme";
import { Card, Btn, StatusTag, PlateBadge } from "./components";
import { STATUS_PILL_COLORS, STATUS_PILL_FAINT } from "./Fleet";
import { computeCarAvailabilityTimeline } from "./useFleetData";

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

const Booking = ({ bookings = [], fleet = [], onNewBooking, onAddBooking, onUpdateBooking, onDeleteBooking }) => {
  const [filter, setFilter] = useState("All");
  const [timelinePlate, setTimelinePlate] = useState(null);
  const prevCountRef = useRef(bookings.length);

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
              const days = Math.round((new Date(b.end) - new Date(b.start)) / 86400000);
              const total = b.rate * days;
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
                   
                    {!(b.status === "Completed" && b.maintenanceTriggered) && (
                      <button onClick={() => handleToggleComplete(b)}
                        style={{ padding: "4px 8px", fontSize: 10, background: "none", border: "none", color: C.teal, cursor: "pointer", fontWeight: 600 }}>
                        Mark {b.status === "Completed" ? "Active" : "Done"}
                      </button>
                    )}
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
    </div>
  );
};

export default Booking;