import { useState } from "react";
import { C } from "./theme";
import { Card, CardHeader, Btn, Badge, Modal, Input, Select } from "./components";

// ── STATIC REFERENCE DATA ───────────────────────────────────────────────────
// Role metadata (icon/description) for the Role & Permission tab's role
// selector. Keys match user.role values exactly ("Admin" / "Staff") so no
// case-mapping is needed anywhere permissions are looked up.
const ROLE_META = [
  { id: "Admin", name: "Admin", desc: "Full system access", icon: "👑" },
  { id: "Staff", name: "Staff", desc: "Daily rental operations", icon: "🧑" },
];

// Canonical module list — mirrors FleetOpzApp's real NAV items. Single
// source of truth for the role permission matrix.
const PERMISSION_MODULE_NAMES = ["Dashboard", "Fleet", "Bookings", "Earnings", "Expenses", "P&L", "Alerts"];
const PERMISSION_ACTIONS = ["view", "create", "edit", "delete"];

const emptyPermissions = () =>
  PERMISSION_MODULE_NAMES.reduce((acc, m) => {
    acc[m] = { view: false, create: false, edit: false, delete: false };
    return acc;
  }, {});

const fullPermissions = () =>
  PERMISSION_MODULE_NAMES.reduce((acc, m) => {
    acc[m] = { view: true, create: true, edit: true, delete: true };
    return acc;
  }, {});

// Fallback used only if this component is ever rendered without a
// rolePermissions prop wired in — keeps it functional standalone.
const DEFAULT_ROLE_PERMISSIONS = { Admin: fullPermissions(), Staff: emptyPermissions() };

// Each entry carries both a sortable/filterable ISO datetime and a
// display-formatted label, plus the columns shown in the Audit Logs table:
// user, module, action (drives the colored badge), description, IP address.
const DEFAULT_AUDIT_LOGS = [
  { id: 1, dateTime: "2026-08-15T13:15:00", dateTimeLabel: "15/08/2026 01:15 PM", user: "Administrator", module: "Fleet",           action: "Added",   description: "Added new vehicle SGX1234",              ip: "192.168.1.10" },
  { id: 2, dateTime: "2026-08-15T12:40:00", dateTimeLabel: "15/08/2026 12:40 PM", user: "Ramesh Kumar",  module: "Bookings",        action: "Created", description: "Created booking BK-1021 for Vikram",     ip: "192.168.1.20" },
  { id: 3, dateTime: "2026-08-15T11:00:00", dateTimeLabel: "15/08/2026 11:00 AM", user: "Administrator", module: "Customers",       action: "Added",   description: "Added restricted driver DL-2024-88215",  ip: "192.168.1.10" },
  { id: 4, dateTime: "2026-08-15T10:20:00", dateTimeLabel: "15/08/2026 10:20 AM", user: "Sunitha",       module: "Customers",       action: "Updated", description: "Updated customer profile - Ashik",       ip: "192.168.1.22" },
  { id: 5, dateTime: "2026-08-15T09:30:00", dateTimeLabel: "15/08/2026 09:30 AM", user: "Administrator", module: "User Management", action: "Added",   description: "Added new staff user - Manoj",            ip: "192.168.1.10" },
  { id: 6, dateTime: "2026-08-15T09:05:00", dateTimeLabel: "15/08/2026 09:05 AM", user: "Ramesh Kumar",  module: "Bookings",        action: "Updated", description: "Updated booking BK-1018 status",          ip: "192.168.1.20" },
  { id: 7, dateTime: "2026-08-15T08:45:00", dateTimeLabel: "15/08/2026 08:45 AM", user: "Administrator", module: "Login",           action: "Login",   description: "User logged in",                         ip: "192.168.1.10" },
];

// Colors for the ACTION badge in the Audit Logs table.
const AUDIT_ACTION_STYLES = {
  Added:   { color: C.green,   bg: C.greenFaint },
  Created: { color: "#2563eb", bg: "#eaf1ff" },
  Updated: { color: C.amber,   bg: C.amberFaint },
  Login:   { color: "#6d5bd0", bg: "#efeafb" },
  Deleted: { color: C.red,     bg: C.redFaint },
};

// ── SMALL PRESENTATIONAL PIECES ─────────────────────────────────────────────
const StatusDot = ({ active }) => (
  <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 11.5, fontWeight: 600, color: active ? C.green : C.red }}>
    <span style={{ width: 6, height: 6, borderRadius: "50%", background: active ? C.green : C.red, display: "inline-block" }} />
    {active ? "Active" : "Inactive"}
  </span>
);

const RolePill = ({ role }) => (
  <Badge color={role === "Admin" ? "#6d5bd0" : "#2563eb"} bg={role === "Admin" ? "#efeafb" : "#eaf1ff"}>{role}</Badge>
);

const ActionBadge = ({ action }) => {
  const style = AUDIT_ACTION_STYLES[action] || { color: C.textMuted, bg: C.bg };
  return <Badge color={style.color} bg={style.bg}>{action}</Badge>;
};

const TabButton = ({ label, icon, active, onClick }) => (
  <div
    onClick={onClick}
    style={{
      display: "flex", alignItems: "center", gap: 8, padding: "11px 16px", fontSize: 13, fontWeight: 600,
      color: active ? C.teal : C.textMuted, cursor: "pointer",
      borderBottom: `2px solid ${active ? C.teal : "transparent"}`, marginBottom: -1,
    }}
  >
    <span>{icon}</span>{label}
  </div>
);

// Pill-style toggle switch used across the Role & Permission matrix — a
// clearer "on/off" affordance than a plain checkbox for editing permissions.
const ToggleSwitch = ({ checked, onChange, disabled }) => (
  <button
    type="button"
    onClick={disabled ? undefined : onChange}
    aria-pressed={checked}
    disabled={disabled}
    style={{
      width: 36, height: 20, borderRadius: 999, border: "none", padding: 0,
      background: checked ? C.teal : "#d7dce3", position: "relative", flexShrink: 0,
      cursor: disabled ? "not-allowed" : "pointer", opacity: disabled ? 0.55 : 1,
      transition: "background 0.15s ease",
    }}
  >
    <span
      style={{
        position: "absolute", top: 2, left: checked ? 18 : 2, width: 16, height: 16, borderRadius: "50%",
        background: "#fff", boxShadow: "0 1px 3px rgba(15,23,42,0.35)", transition: "left 0.15s ease",
      }}
    />
  </button>
);

// Image-1 style bottom stat card: icon in a soft circle, title + subtitle,
// one big number, and a "View all" link — used for the Users / Role &
// Permission / Audit Logs summary cards under the Users tab.
const StatCard = ({ icon, iconBg, iconColor, title, subtitle, value, valueLabel, linkText, onLinkClick }) => (
  <Card>
    <div style={{ padding: 20 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16 }}>
        <div style={{ width: 44, height: 44, borderRadius: 12, background: iconBg, color: iconColor, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 19, flexShrink: 0 }}>{icon}</div>
        <div>
          <div style={{ fontSize: 14, fontWeight: 700, color: C.navy }}>{title}</div>
          <div style={{ fontSize: 11, color: C.textMuted }}>{subtitle}</div>
        </div>
      </div>
      <div style={{ fontSize: 30, fontWeight: 700, color: C.navy, letterSpacing: -0.5, marginBottom: 2 }}>{value}</div>
      <div style={{ fontSize: 11, color: C.textMuted, marginBottom: 14 }}>{valueLabel}</div>
      <div onClick={onLinkClick} style={{ fontSize: 12.5, fontWeight: 700, color: C.teal, cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 4 }}>{linkText} →</div>
    </div>
  </Card>
);

const EMPTY_USER_DRAFT = () => ({ name: "", email: "", role: "Staff", password: "" });

// ── MAIN MODULE ──────────────────────────────────────────────────────────────
const UserManagement = ({
  users = [],
  onAddUser = () => {},
  onUpdateUser = () => {},
  onDeleteUser = () => {},
  currentUserRole = "Staff",
  // Permissions now live on the ROLE, not the user. rolePermissions is
  // { [roleName]: { [module]: { view, create, edit, delete } } }, and
  // onToggleRolePermission(role, module, action) flips one cell. Editing a
  // role's permissions here immediately applies to every user with that role.
  rolePermissions = DEFAULT_ROLE_PERMISSIONS,
  onToggleRolePermission = () => {},
}) => {
  const [tab, setTab] = useState("users");
  const [selectedRole, setSelectedRole] = useState("Admin");

  // Audit Logs tab — filters + pagination, all applied client-side over
  // DEFAULT_AUDIT_LOGS. Any filter change resets back to page 1.
  const [logDateFrom, setLogDateFrom] = useState("");
  const [logDateTo, setLogDateTo] = useState("");
  const [logUserFilter, setLogUserFilter] = useState("All Users");
  const [logModuleFilter, setLogModuleFilter] = useState("All Modules");
  const [logActionFilter, setLogActionFilter] = useState("All Actions");
  const [logSearch, setLogSearch] = useState("");
  const [logPage, setLogPage] = useState(1);
  const [logPageSize, setLogPageSize] = useState(10);

  // Single modal + draft used for both Add and Edit — editingId is null in
  // Add mode, or the user's id in Edit mode.
  const [showUserModal, setShowUserModal] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [draft, setDraft] = useState(EMPTY_USER_DRAFT());

  const openAddUser = () => { setDraft(EMPTY_USER_DRAFT()); setEditingId(null); setShowUserModal(true); };
  const openEditUser = (u) => {
    setDraft({
      name: u.name || "",
      email: u.email || "",
      role: u.role || "Staff",
      password: "",
    });
    setEditingId(u.id);
    setShowUserModal(true);
  };
  const closeUserModal = () => { setShowUserModal(false); setEditingId(null); setDraft(EMPTY_USER_DRAFT()); };

  const submitUserModal = () => {
    if (!draft.name.trim() || !draft.email.trim()) {
      alert("Please enter a name and email.");
      return;
    }
    // Password is required when creating a user, optional when editing —
    // leaving it blank on Edit keeps the user's current password.
    if (!editingId && !draft.password.trim()) {
      alert("Please set a password for this user.");
      return;
    }
    if (editingId) {
      const { password, ...rest } = draft;
      onUpdateUser(editingId, password.trim() ? { ...rest, password } : rest);
    } else {
      onAddUser({ ...draft });
    }
    closeUserModal();
  };

  const handleDeleteUser = (u) => {
    if (window.confirm(`Remove user "${u.name}"?`)) onDeleteUser(u.id);
  };

  const roleCounts = ROLE_META.reduce((acc, r) => {
    acc[r.id] = users.filter(u => u.role === r.id).length;
    return acc;
  }, {});

  // Total permissions currently granted — now summed across role
  // definitions rather than per-user, since permissions are role-based.
  const totalPermissionsGranted = Object.values(rolePermissions).reduce(
    (sum, modules) => sum + Object.values(modules || {}).reduce(
      (s, actions) => s + Object.values(actions).filter(Boolean).length, 0
    ), 0
  );

  // ── Audit Logs: filter dropdown options, derived from the log data itself ──
  const logUserOptions = ["All Users", ...Array.from(new Set(DEFAULT_AUDIT_LOGS.map(l => l.user)))];
  const logModuleOptions = ["All Modules", ...Array.from(new Set(DEFAULT_AUDIT_LOGS.map(l => l.module)))];
  const logActionOptions = ["All Actions", ...Array.from(new Set(DEFAULT_AUDIT_LOGS.map(l => l.action)))];

  const filteredLogs = DEFAULT_AUDIT_LOGS.filter(log => {
    if (logUserFilter !== "All Users" && log.user !== logUserFilter) return false;
    if (logModuleFilter !== "All Modules" && log.module !== logModuleFilter) return false;
    if (logActionFilter !== "All Actions" && log.action !== logActionFilter) return false;
    const logDate = log.dateTime.slice(0, 10);
    if (logDateFrom && logDate < logDateFrom) return false;
    if (logDateTo && logDate > logDateTo) return false;
    if (logSearch.trim()) {
      const q = logSearch.trim().toLowerCase();
      const haystack = `${log.user} ${log.module} ${log.action} ${log.description} ${log.ip}`.toLowerCase();
      if (!haystack.includes(q)) return false;
    }
    return true;
  });

  const logTotalPages = Math.max(1, Math.ceil(filteredLogs.length / logPageSize));
  const currentLogPage = Math.min(logPage, logTotalPages);
  const pagedLogs = filteredLogs.slice((currentLogPage - 1) * logPageSize, (currentLogPage - 1) * logPageSize + logPageSize);

  const clearLogFilters = () => {
    setLogDateFrom(""); setLogDateTo(""); setLogUserFilter("All Users");
    setLogModuleFilter("All Modules"); setLogActionFilter("All Actions"); setLogSearch(""); setLogPage(1);
  };

  const exportLogs = () => {
    const header = ["Date & Time", "User", "Module", "Action", "Description", "IP Address"];
    const rows = filteredLogs.map(l => [l.dateTimeLabel, l.user, l.module, l.action, l.description, l.ip]);
    const csv = [header, ...rows].map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "audit-logs.csv";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <div>
      <div style={{ fontSize: 15, fontWeight: 700, color: C.navy, marginBottom: 4 }}>User Management</div>
      <div style={{ fontSize: 11, color: C.textMuted, marginBottom: 18 }}>Manage system users, role permissions and audit logs</div>

      {/* Image-1 style summary cards */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 18, marginBottom: 20 }}>
        <StatCard
          icon="👥" iconBg={C.tealFaint} iconColor={C.teal}
          title="Users" subtitle="Manage system users"
          value={users.length} valueLabel="Total Users"
          linkText="View all users" onLinkClick={() => setTab("users")}
        />
        <StatCard
          icon="🛡️" iconBg="#efeafb" iconColor="#6d5bd0"
          title="Role & Permission" subtitle="Manage roles and permissions"
          value={totalPermissionsGranted} valueLabel="Total Permissions Granted"
          linkText="Manage role & permissions" onLinkClick={() => setTab("permissions")}
        />
        <StatCard
          icon="📄" iconBg="#EEF2FF" iconColor="#4F46E5"
          title="Audit Logs" subtitle="View system activity logs"
          value={DEFAULT_AUDIT_LOGS.length} valueLabel="Recent Activity Entries"
          linkText="View all logs" onLinkClick={() => setTab("logs")}
        />
      </div>

      {/* Tabs */}
      <div style={{ display: "flex", gap: 4, borderBottom: `1px solid ${C.border}`, marginBottom: 18 }}>
        <TabButton label="Users" icon="👥" active={tab === "users"} onClick={() => setTab("users")} />
        <TabButton label="Role & Permission" icon="🛡️" active={tab === "permissions"} onClick={() => setTab("permissions")} />
        <TabButton label="Audit Logs" icon="📄" active={tab === "logs"} onClick={() => setTab("logs")} />
      </div>

      {/* USERS TAB */}
      {tab === "users" && (
        <Card style={{ marginBottom: 20 }}>
          <CardHeader title="Users" subtitle="View and manage system users"
            right={<Btn primary onClick={openAddUser}>＋ Add New User</Btn>} />
          <div style={{ padding: "4px 18px 4px" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr>
                  {["Name", "Email", "Role", "Status", "Last Login", "Actions"].map(h => (
                    <th key={h} style={{ textAlign: "left", fontSize: 10.5, letterSpacing: 0.5, color: C.textMuted, textTransform: "uppercase", fontWeight: 700, padding: "10px 8px", borderBottom: `1px solid ${C.border}` }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {users.map(u => (
                  <tr key={u.id}>
                    <td style={{ padding: "12px 8px", borderBottom: `1px solid ${C.border}`, fontSize: 13 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                        <div style={{ width: 30, height: 30, borderRadius: "50%", background: u.role === "Admin" ? C.navy : C.teal, color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 700, flexShrink: 0 }}>
                          {u.name[0]}
                        </div>
                        <span style={{ fontWeight: 600, color: C.navy }}>{u.name}</span>
                        {u.isYou && <span style={{ background: C.tealFaint, color: C.teal, fontSize: 10, fontWeight: 700, padding: "1px 7px", borderRadius: 20 }}>You</span>}
                      </div>
                    </td>
                    <td style={{ padding: "12px 8px", borderBottom: `1px solid ${C.border}`, fontSize: 12.5, color: C.textSec }}>{u.email}</td>
                    <td style={{ padding: "12px 8px", borderBottom: `1px solid ${C.border}` }}><RolePill role={u.role} /></td>
                    <td style={{ padding: "12px 8px", borderBottom: `1px solid ${C.border}` }}><StatusDot active={u.status === "Active"} /></td>
                    <td style={{ padding: "12px 8px", borderBottom: `1px solid ${C.border}`, fontSize: 12, color: C.textMuted }}>{u.lastLogin}</td>
                    <td style={{ padding: "12px 8px", borderBottom: `1px solid ${C.border}` }}>
                      <div style={{ display: "flex", gap: 6 }}>
                        <button onClick={() => openEditUser(u)} title="Edit" style={{ width: 28, height: 28, borderRadius: 6, border: `1px solid ${C.tealFaint}`, background: "#fff", color: C.teal, cursor: "pointer" }}>✎</button>
                        <button onClick={() => handleDeleteUser(u)} title="Delete" style={{ width: 28, height: 28, borderRadius: 6, border: `1px solid ${C.redFaint}`, background: "#fff", color: C.red, cursor: "pointer" }}>🗑</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "14px 8px", fontSize: 11.5, color: C.textMuted }}>
              <span>Showing 1 to {users.length} of {users.length} entries</span>
            </div>
          </div>
        </Card>
      )}

      {/* ROLE & PERMISSION TAB — pick a role on the left, toggle its
          module × action permissions on the right. Every user assigned to
          that role picks up the change immediately, since permissions are
          looked up by role rather than stored per user. */}
      {tab === "permissions" && (
        <div style={{ display: "grid", gridTemplateColumns: "260px 1fr", gap: 18, alignItems: "start" }}>
          <Card>
            <CardHeader title="Roles" subtitle="Select a role to edit" />
            <div style={{ padding: 10 }}>
              {ROLE_META.map(r => {
                const active = r.id === selectedRole;
                return (
                  <div
                    key={r.id}
                    onClick={() => setSelectedRole(r.id)}
                    style={{
                      display: "flex", alignItems: "center", gap: 12, padding: "12px 10px", borderRadius: 10,
                      cursor: "pointer", marginBottom: 6,
                      background: active ? C.tealFaint : "transparent",
                      border: `1px solid ${active ? C.teal : "transparent"}`,
                    }}
                  >
                    <div style={{ width: 36, height: 36, borderRadius: 9, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16, flexShrink: 0, background: r.id === "Admin" ? "#efeafb" : "#eaf1ff", color: r.id === "Admin" ? "#6d5bd0" : "#2563eb" }}>{r.icon}</div>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 700, color: C.navy }}>{r.name}</div>
                      <div style={{ fontSize: 11, color: C.textMuted }}>{roleCounts[r.id] || 0} user{roleCounts[r.id] === 1 ? "" : "s"}</div>
                    </div>
                  </div>
                );
              })}
            </div>
          </Card>

          <Card>
            <CardHeader
              title={`${selectedRole} Permissions`}
              subtitle={ROLE_META.find(r => r.id === selectedRole)?.desc || "Toggle what this role can access"}
            />
            <div style={{ padding: 18 }}>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr>
                    {["Module", "View", "Create", "Edit", "Delete"].map((h, i) => (
                      <th key={h} style={{ textAlign: i === 0 ? "left" : "center", fontSize: 10, color: C.textMuted, textTransform: "uppercase", fontWeight: 700, padding: "8px 10px", borderBottom: `1px solid ${C.border}` }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {PERMISSION_MODULE_NAMES.map((m, idx) => (
                    <tr key={m} style={{ borderTop: idx === 0 ? "none" : `1px solid ${C.border}` }}>
                      <td style={{ padding: "12px 10px", fontSize: 13, fontWeight: 600, color: C.navy }}>{m}</td>
                      {PERMISSION_ACTIONS.map(action => (
                        <td key={action} style={{ padding: "12px 10px", textAlign: "center" }}>
                          <ToggleSwitch
                            checked={!!rolePermissions[selectedRole]?.[m]?.[action]}
                            onChange={() => onToggleRolePermission(selectedRole, m, action)}
                          />
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </div>
      )}

      {/* AUDIT LOGS TAB */}
      {tab === "logs" && (
        <Card>
          <CardHeader
            title="Audit Logs"
            subtitle="View all system activities and user action logs"
            right={<Btn onClick={exportLogs}>⬇ Export ▾</Btn>}
          />

          {/* Filter toolbar */}
          <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 10, padding: "0 18px 16px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6, border: `1px solid ${C.border}`, borderRadius: 8, padding: "6px 10px", background: "#fff" }}>
              <span style={{ fontSize: 13 }}>📅</span>
              <input
                type="date"
                value={logDateFrom}
                onChange={e => { setLogDateFrom(e.target.value); setLogPage(1); }}
                style={{ border: "none", outline: "none", fontSize: 12.5, color: C.textPri, background: "transparent" }}
              />
              <span style={{ fontSize: 12, color: C.textMuted }}>–</span>
              <input
                type="date"
                value={logDateTo}
                onChange={e => { setLogDateTo(e.target.value); setLogPage(1); }}
                style={{ border: "none", outline: "none", fontSize: 12.5, color: C.textPri, background: "transparent" }}
              />
            </div>

            <select
              value={logUserFilter}
              onChange={e => { setLogUserFilter(e.target.value); setLogPage(1); }}
              style={{ fontSize: 12.5, fontWeight: 600, color: C.textPri, background: "#fff", border: `1px solid ${C.border}`, borderRadius: 8, padding: "8px 10px", cursor: "pointer", outline: "none" }}
            >
              {logUserOptions.map(o => <option key={o} value={o}>{o}</option>)}
            </select>

            <select
              value={logModuleFilter}
              onChange={e => { setLogModuleFilter(e.target.value); setLogPage(1); }}
              style={{ fontSize: 12.5, fontWeight: 600, color: C.textPri, background: "#fff", border: `1px solid ${C.border}`, borderRadius: 8, padding: "8px 10px", cursor: "pointer", outline: "none" }}
            >
              {logModuleOptions.map(o => <option key={o} value={o}>{o}</option>)}
            </select>

            <select
              value={logActionFilter}
              onChange={e => { setLogActionFilter(e.target.value); setLogPage(1); }}
              style={{ fontSize: 12.5, fontWeight: 600, color: C.textPri, background: "#fff", border: `1px solid ${C.border}`, borderRadius: 8, padding: "8px 10px", cursor: "pointer", outline: "none" }}
            >
              {logActionOptions.map(o => <option key={o} value={o}>{o}</option>)}
            </select>

            <div style={{ display: "flex", alignItems: "center", gap: 6, border: `1px solid ${C.border}`, borderRadius: 8, padding: "8px 10px", background: "#fff", flex: "1 1 180px", minWidth: 160 }}>
              <input
                type="text"
                value={logSearch}
                onChange={e => { setLogSearch(e.target.value); setLogPage(1); }}
                placeholder="Search logs..."
                style={{ border: "none", outline: "none", fontSize: 12.5, color: C.textPri, background: "transparent", width: "100%" }}
              />
              <span style={{ fontSize: 13, color: C.textMuted }}>🔍</span>
            </div>

            <button
              onClick={clearLogFilters}
              style={{ fontSize: 12.5, fontWeight: 700, color: C.teal, background: "#fff", border: `1px solid ${C.tealFaint}`, borderRadius: 8, padding: "8px 14px", cursor: "pointer", whiteSpace: "nowrap" }}
            >
              Clear Filters
            </button>
          </div>

          <div style={{ padding: "0 18px" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr>
                  {["Date & Time", "User", "Module", "Action", "Description", "IP Address"].map(h => (
                    <th key={h} style={{ textAlign: "left", fontSize: 10.5, letterSpacing: 0.5, color: C.textMuted, textTransform: "uppercase", fontWeight: 700, padding: "10px 8px", borderBottom: `1px solid ${C.border}` }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {pagedLogs.map(log => (
                  <tr key={log.id}>
                    <td style={{ padding: "12px 8px", borderBottom: `1px solid ${C.border}`, fontSize: 12.5, color: C.textPri, whiteSpace: "nowrap" }}>{log.dateTimeLabel}</td>
                    <td style={{ padding: "12px 8px", borderBottom: `1px solid ${C.border}`, fontSize: 12.5, fontWeight: 600, color: C.navy }}>{log.user}</td>
                    <td style={{ padding: "12px 8px", borderBottom: `1px solid ${C.border}`, fontSize: 12.5, color: C.textSec }}>{log.module}</td>
                    <td style={{ padding: "12px 8px", borderBottom: `1px solid ${C.border}` }}><ActionBadge action={log.action} /></td>
                    <td style={{ padding: "12px 8px", borderBottom: `1px solid ${C.border}`, fontSize: 12.5, color: C.textSec }}>{log.description}</td>
                    <td style={{ padding: "12px 8px", borderBottom: `1px solid ${C.border}`, fontSize: 12.5, color: C.textMuted }}>{log.ip}</td>
                  </tr>
                ))}
                {pagedLogs.length === 0 && (
                  <tr>
                    <td colSpan={6} style={{ padding: "24px 8px", textAlign: "center", fontSize: 12.5, color: C.textMuted }}>No logs match these filters.</td>
                  </tr>
                )}
              </tbody>
            </table>

            {/* Footer: entry count + pagination + page size */}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10, padding: "14px 8px" }}>
              <span style={{ fontSize: 11.5, color: C.textMuted }}>
                {filteredLogs.length === 0
                  ? "Showing 0 of 0 entries"
                  : `Showing ${(currentLogPage - 1) * logPageSize + 1} to ${Math.min(currentLogPage * logPageSize, filteredLogs.length)} of ${filteredLogs.length} entries`}
              </span>

              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <button
                  onClick={() => setLogPage(p => Math.max(1, p - 1))}
                  disabled={currentLogPage === 1}
                  style={{ width: 28, height: 28, borderRadius: 6, border: `1px solid ${C.border}`, background: "#fff", color: currentLogPage === 1 ? C.textMuted : C.textPri, cursor: currentLogPage === 1 ? "not-allowed" : "pointer" }}
                >‹</button>
                {Array.from({ length: logTotalPages }, (_, i) => i + 1).map(p => (
                  <button
                    key={p}
                    onClick={() => setLogPage(p)}
                    style={{
                      width: 28, height: 28, borderRadius: 6, border: `1px solid ${p === currentLogPage ? C.teal : C.border}`,
                      background: p === currentLogPage ? C.teal : "#fff", color: p === currentLogPage ? "#fff" : C.textPri,
                      fontWeight: 700, fontSize: 12, cursor: "pointer",
                    }}
                  >{p}</button>
                ))}
                <button
                  onClick={() => setLogPage(p => Math.min(logTotalPages, p + 1))}
                  disabled={currentLogPage === logTotalPages}
                  style={{ width: 28, height: 28, borderRadius: 6, border: `1px solid ${C.border}`, background: "#fff", color: currentLogPage === logTotalPages ? C.textMuted : C.textPri, cursor: currentLogPage === logTotalPages ? "not-allowed" : "pointer" }}
                >›</button>

                <select
                  value={logPageSize}
                  onChange={e => { setLogPageSize(Number(e.target.value)); setLogPage(1); }}
                  style={{ marginLeft: 6, fontSize: 12, fontWeight: 600, color: C.textPri, background: "#fff", border: `1px solid ${C.border}`, borderRadius: 6, padding: "5px 8px", cursor: "pointer", outline: "none" }}
                >
                  {[10, 25, 50].map(n => <option key={n} value={n}>{n} / page</option>)}
                </select>
              </div>
            </div>
          </div>
        </Card>
      )}

      {/* ADD / EDIT USER MODAL — permissions aren't set here anymore; the
          user just gets a role, and that role's permissions (edited in the
          Role & Permission tab) apply automatically. */}
      <Modal open={showUserModal} title={editingId ? "Edit User" : "Add New User"} onClose={closeUserModal} onSubmit={submitUserModal} submitText={editingId ? "Save Changes" : "Add User"}>
        <Input label="Full Name" value={draft.name} onChange={e => setDraft(d => ({ ...d, name: e.target.value }))} placeholder="e.g., Nur Aisyah" />
        <Input label="Email" type="email" value={draft.email} onChange={e => setDraft(d => ({ ...d, email: e.target.value }))} placeholder="e.g., aisyah@fleetopz.com" />
        <Input
          label={editingId ? "Password" : "Password *"}
          type="password"
          value={draft.password}
          onChange={e => setDraft(d => ({ ...d, password: e.target.value }))}
          placeholder={editingId ? "Leave blank to keep current password" : "Set a password"}
        />
        <Select label="Role" value={draft.role} onChange={e => setDraft(d => ({ ...d, role: e.target.value }))}
          options={ROLE_META.map(r => ({ value: r.id, label: r.name }))} />
        <div style={{ marginTop: 6, marginBottom: 4 }}>
          <label style={{ display: "block", fontSize: 12, fontWeight: 600, marginBottom: 8, color: C.textPri }}>Permissions</label>
          <div style={{ border: `1px solid ${C.border}`, borderRadius: 8, padding: 12, fontSize: 11.5, color: C.textMuted, lineHeight: 1.5 }}>
            This user inherits permissions from the <strong style={{ color: C.navy }}>{draft.role}</strong> role.
            Manage what that role can access under the <strong style={{ color: C.navy }}>Role & Permission</strong> tab —
            changes there apply to every user with this role.
          </div>
        </div>
      </Modal>
    </div>
  );
};

export default UserManagement;