import { useState } from "react";
import { C } from "./theme";
import { Card, Btn, Badge } from "./components";

// ---- Per-type presentation: icon + accent colors shown on each alert row. ----
const TYPE_META = {
  coe:                     { icon: "🚗", fg: C.amber || "#d97706", bg: C.amberFaint || "#fef3e2", label: "Registration Renewal" },
  insurance:               { icon: "🛡️", fg: C.amber || "#d97706", bg: C.amberFaint || "#fef3e2", label: "Insurance Renewal" },
  maintenance:             { icon: "🔧", fg: "#7c3aed",            bg: "#f5f3ff",                  label: "Maintenance Due" },
  lowfuel:                 { icon: "⛽", fg: "#d97706",            bg: "#fef3e2",                  label: "Low Fuel Level" },
  lowavail:                { icon: "🚗", fg: "#d97706",            bg: "#fef3e2",                  label: "Low Availability" },
  return:                  { icon: "🚗", fg: C.red || "#dc2626",   bg: C.redFaint || "#fee2e2",    label: "Vehicle Return Due" },
  overdue:                 { icon: "🚗", fg: C.red || "#dc2626",   bg: C.redFaint || "#fee2e2",    label: "Overdue Return" },
  booking:                 { icon: "📋", fg: "#2563eb",            bg: "#eff6ff",                  label: "New Booking" },
  pending:                 { icon: "💳", fg: "#2563eb",            bg: "#eff6ff",                  label: "Pending Payment" },
  bookingConfirmation:     { icon: "✅", fg: "#16a34a",            bg: "#f0fdf4",                  label: "Booking Confirmed" },
  bookingCancellation:     { icon: "❌", fg: C.red || "#dc2626",   bg: C.redFaint || "#fee2e2",    label: "Booking Cancelled" },
  paymentReceived:         { icon: "💰", fg: "#16a34a",            bg: "#f0fdf4",                  label: "Payment Received" },
  restrictedDriverAttempt: { icon: "🚫", fg: C.red || "#dc2626",   bg: C.redFaint || "#fee2e2",    label: "Restricted Driver" },
  failedLogin:             { icon: "🔒", fg: C.red || "#dc2626",   bg: C.redFaint || "#fee2e2",    label: "Failed Login" },
};

// Which screen an alert type should navigate to — passed up via onNavigate(screenName).
const TYPE_SCREEN = {
  coe: "Fleet", insurance: "Fleet", maintenance: "Fleet", lowavail: "Fleet", lowfuel: "Fleet",
  return: "Bookings", overdue: "Bookings", booking: "Bookings", pending: "Bookings",
  bookingConfirmation: "Bookings", bookingCancellation: "Bookings", paymentReceived: "Bookings",
  restrictedDriverAttempt: "User Management", failedLogin: "User Management",
};

// Alert types whose detail panel shows booking/customer info instead of the
// simpler vehicle/fleet view.
const BOOKING_TYPES = new Set([
  "return", "overdue", "booking", "pending",
  "bookingConfirmation", "bookingCancellation", "paymentReceived",
]);

const formatTimestamp = (iso) => {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  const dateStr = d.toLocaleDateString("en-SG", { day: "2-digit", month: "short", year: "numeric" });
  const timeStr = d.toLocaleTimeString("en-SG", { hour: "2-digit", minute: "2-digit" });
  return `${dateStr} · ${timeStr}`;
};

const formatDate = (iso) => {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-SG", { day: "2-digit", month: "short", year: "numeric" });
};

const isToday = (iso) => {
  if (!iso) return false;
  const d = new Date(iso);
  if (isNaN(d.getTime())) return false;
  return d.toDateString() === new Date().toDateString();
};

const money = (v) => (v === undefined || v === null || v === "" ? null : `SGD ${Number(v).toFixed(2)}`);

// ---- small building blocks for the detail panel ----
const Field = ({ label, value, highlight }) => {
  if (value === undefined || value === null || value === "") return null;
  return (
    <div>
      <div style={{ fontSize: 10.5, color: C.textMuted, marginBottom: 3 }}>{label}</div>
      <div style={{ fontSize: 13, fontWeight: 600, color: highlight ? (C.red || "#dc2626") : C.navy }}>{value}</div>
    </div>
  );
};

const InfoCard = ({ title, children }) => {
  const kids = Array.isArray(children) ? children.filter(Boolean) : [children];
  if (kids.every((k) => k === null || k === false)) return null;
  return (
    <div style={{ marginBottom: 16 }}>
      {title && <div style={{ fontSize: 12.5, fontWeight: 700, color: C.navy, marginBottom: 10 }}>{title}</div>}
      <div style={{ border: `1px solid ${C.border || "#e5e7eb"}`, borderRadius: 10, padding: 16, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
        {children}
      </div>
    </div>
  );
};

const IconButton = ({ children, onClick, title }) => (
  <button
    onClick={onClick}
    title={title}
    style={{ width: 34, height: 34, borderRadius: 8, border: `1px solid ${C.border || "#e5e7eb"}`, background: "#fff", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 15 }}
  >
    {children}
  </button>
);

// ---- slide-over detail panel ----
const DetailPanel = ({ alert: a, onClose, onMarkRead, onDelete, onNavigate }) => {
  if (!a) return null;
  const meta = TYPE_META[a.type] || { icon: "🔔", fg: C.teal, bg: C.tealFaint || "#f0fdfa", label: "Alert" };
  const screen = TYPE_SCREEN[a.type] || "Dashboard";
  const isBooking = BOOKING_TYPES.has(a.type);
  const returnIsToday = isToday(a.expectedReturn);
  const dueField = a.dueDate || a.expiryDate;

  return (
    <>
      <div
        onClick={onClose}
        style={{ position: "fixed", inset: 0, background: "rgba(15, 23, 42, 0.35)", zIndex: 40 }}
      />
      <div
        style={{
          position: "fixed", top: 0, right: 0, bottom: 0, width: "min(480px, 100vw)",
          background: "#fff", zIndex: 41, boxShadow: "-8px 0 24px rgba(0,0,0,0.12)",
          display: "flex", flexDirection: "column",
        }}
      >
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, padding: "16px 20px 0" }}>
          {!a.read && <Btn small onClick={() => onMarkRead?.(a.id)}>✓ Mark as read</Btn>}
          {onDelete && <IconButton title="Delete" onClick={() => onDelete(a.id)}>🗑️</IconButton>}
          <IconButton title="Close" onClick={onClose}>✕</IconButton>
        </div>

        <div style={{ padding: "12px 24px 24px", overflowY: "auto", flex: 1 }}>
          <div style={{ display: "flex", alignItems: "flex-start", gap: 14, marginBottom: 20 }}>
            <div style={{ width: 52, height: 52, borderRadius: "50%", background: meta.bg, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 24, flexShrink: 0 }}>
              {meta.icon}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <Badge color={a.read ? C.textMuted : C.teal} bg={a.read ? "#f3f4f6" : (C.tealFaint || "#f0fdfa")}>
                {a.read ? "Read" : "Unread"}
              </Badge>
              <div style={{ fontSize: 18, fontWeight: 700, color: C.navy, marginTop: 8 }}>
                {a.title || meta.label}
              </div>
              <div style={{ fontSize: 13, color: C.textMuted, marginTop: 4 }}>{a.msg}</div>
              <div style={{ fontSize: 11, color: C.textMuted, marginTop: 8 }}>{formatTimestamp(a.timestamp)}</div>
            </div>
          </div>

          {isBooking ? (
            <>
              <InfoCard title="Booking Details">
                <Field label="Booking No." value={a.bookingNo} />
                <Field label="Pickup Date & Time" value={a.pickupAt ? formatTimestamp(a.pickupAt) : null} />
                <Field label="Customer" value={a.customer} />
                <Field
                  label="Expected Return"
                  value={a.expectedReturn ? `${formatDate(a.expectedReturn)}${returnIsToday ? " (Today)" : ""}` : null}
                  highlight={returnIsToday}
                />
                <Field label="Vehicle" value={a.car ? `${a.car}${a.plate ? `  ${a.plate}` : ""}` : null} />
                <Field label="Status" value={a.status} />
              </InfoCard>

              {(a.urgent || returnIsToday) && (
                <div
                  style={{
                    display: "flex", gap: 10, alignItems: "flex-start",
                    background: C.redFaint || "#fee2e2", borderRadius: 10, padding: 12,
                    marginBottom: 16, fontSize: 12, color: C.red || "#dc2626",
                  }}
                >
                  <span>⚠️</span>
                  <span>Please ensure the vehicle is returned on time to avoid late return charges.</span>
                </div>
              )}

              <InfoCard title="Rental Summary">
                <Field label="Rental Duration" value={a.rentalDuration ? `${a.rentalDuration} Days` : null} />
                <Field label="Total Amount" value={money(a.totalAmount)} />
                <Field label="Paid Amount" value={money(a.paidAmount)} />
                <Field label="Balance Due" value={money(a.balanceDue)} highlight={Number(a.balanceDue) > 0} />
              </InfoCard>

              {(a.customerPhone || a.customerEmail) && (
                <div style={{ marginBottom: 8 }}>
                  <div style={{ fontSize: 12.5, fontWeight: 700, color: C.navy, marginBottom: 10 }}>Customer Contact</div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 8, fontSize: 12.5, color: C.navy }}>
                    {a.customerPhone && <div>📞 {a.customerPhone}</div>}
                    {a.customerEmail && <div>✉️ {a.customerEmail}</div>}
                  </div>
                </div>
              )}
            </>
          ) : (
            <InfoCard title="Vehicle Details">
              <Field label="Vehicle" value={a.car} />
              <Field label="Plate" value={a.plate} />
              <Field
                label={a.type === "maintenance" ? "Due Date" : a.type === "lowfuel" ? "Fuel Level" : "Expiry Date"}
                value={a.type === "lowfuel" ? (a.fuelLevel !== undefined ? `${a.fuelLevel}%` : null) : (dueField ? formatDate(dueField) : null)}
              />
              <Field label="Status" value={a.status} />
              <Field label="Available Vehicles" value={a.availableCount} />
              <Field label="Driver" value={a.driver} />
            </InfoCard>
          )}
        </div>

        <div style={{ display: "flex", gap: 10, padding: 20, borderTop: `1px solid ${C.border || "#e5e7eb"}` }}>
          <button
            onClick={() => onNavigate?.(screen)}
            style={{ flex: 1, padding: "10px 16px", borderRadius: 8, border: "none", background: C.teal || "#0f766e", color: "#fff", fontSize: 13, fontWeight: 600, cursor: "pointer" }}
          >
            {isBooking ? "↗ View Booking" : `↗ Go to ${screen}`}
          </button>
        </div>
      </div>
    </>
  );
};

// ---- main alerts page: tabbed list + slide-over detail ----
// Owns its own read/unread/delete state so it works fully on its own; the
// on* props are still called (if passed) so a parent can persist changes.
const Alert = ({ alerts: initialAlerts = [], onMarkRead, onMarkAllRead, onNavigate, onOpenSettings, onDeleteAlert, onAlertsChange }) => {
  const [alerts, setAlerts] = useState(initialAlerts);
  const [tab, setTab] = useState("all");
  const [selectedId, setSelectedId] = useState(null);

  const unread = alerts.filter((a) => !a.read);
  const read = alerts.filter((a) => a.read);
  const visible = tab === "unread" ? unread : tab === "read" ? read : alerts;
  const selected = alerts.find((a) => a.id === selectedId) || null;

  // Applies a state update locally and notifies the parent (if it's
  // listening) so any external badge/count stays in sync too.
  const applyUpdate = (updater) => {
    setAlerts((prev) => {
      const next = updater(prev);
      onAlertsChange?.(next);
      return next;
    });
  };

  const markRead = (id) => {
    applyUpdate((prev) => prev.map((a) => (a.id === id ? { ...a, read: true } : a)));
    onMarkRead?.(id);
  };

  const markAllRead = (ids) => {
    const idSet = new Set(ids);
    applyUpdate((prev) => prev.map((a) => (idSet.has(a.id) ? { ...a, read: true } : a)));
    onMarkAllRead?.(ids);
  };

  const deleteAlert = (id) => {
    applyUpdate((prev) => prev.filter((a) => a.id !== id));
    setSelectedId((cur) => (cur === id ? null : cur));
    onDeleteAlert?.(id);
  };

  const tabs = [
    { key: "all", label: "All", count: alerts.length },
    { key: "unread", label: "Unread", count: unread.length },
    { key: "read", label: "Read", count: read.length },
  ];

  const renderRow = (a) => {
    const meta = TYPE_META[a.type] || { icon: "🔔", fg: C.teal, bg: C.tealFaint || "#f0fdfa", label: "Alert" };
    return (
      <div
        key={a.id}
        onClick={() => setSelectedId(a.id)}
        style={{
          display: "flex", gap: 14, alignItems: "flex-start", padding: 16, cursor: "pointer",
          background: a.read ? "transparent" : (C.tealFaint || "#f0fdfa"),
          borderBottom: `1px solid ${C.border || "#f1f5f9"}`,
        }}
      >
        <div style={{ width: 40, height: 40, borderRadius: "50%", background: meta.bg, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18, flexShrink: 0 }}>
          {meta.icon}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: C.navy }}>{a.title || meta.label}</div>
            <div style={{ fontSize: 10.5, color: C.textMuted, whiteSpace: "nowrap" }}>{formatTimestamp(a.timestamp)}</div>
          </div>
          <div style={{ fontSize: 12, color: C.textMuted, marginTop: 3 }}>{a.msg}</div>
        </div>
        {!a.read && <div title="Unread" style={{ width: 8, height: 8, borderRadius: "50%", background: C.red || "#dc2626", marginTop: 6, flexShrink: 0 }} />}
      </div>
    );
  };

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <div>
          <div style={{ fontSize: 15, fontWeight: 700, color: C.navy }}>Alerts & Notifications</div>
          <div style={{ fontSize: 11, color: C.textMuted }}>
            {alerts.length} active alerts · {unread.length} unread · In-app & email notifications
          </div>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <Btn small onClick={() => markAllRead(unread.map((a) => a.id))} disabled={unread.length === 0}>
            ✓ Mark All as Read
          </Btn>
          <Btn small onClick={() => onOpenSettings?.()}>⚙ Notification Settings</Btn>
        </div>
      </div>

      <Card>
        <div style={{ display: "flex", gap: 4, padding: "10px 14px 0" }}>
          {tabs.map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              style={{
                border: "none", background: "none", cursor: "pointer",
                padding: "8px 12px", fontSize: 12.5, fontWeight: 600,
                color: tab === t.key ? (C.teal || "#0f766e") : C.textMuted,
                borderBottom: `2px solid ${tab === t.key ? (C.teal || "#0f766e") : "transparent"}`,
              }}
            >
              {t.label} ({t.count})
            </button>
          ))}
        </div>
        <div>
          {visible.length === 0 ? (
            <div style={{ padding: 32, textAlign: "center", color: C.textMuted, fontSize: 12 }}>No alerts</div>
          ) : (
            visible.map(renderRow)
          )}
        </div>
      </Card>

      {selected && (
        <DetailPanel
          alert={selected}
          onClose={() => setSelectedId(null)}
          onMarkRead={markRead}
          onDelete={deleteAlert}
          onNavigate={onNavigate}
        />
      )}
    </div>
  );
};

export default Alert;