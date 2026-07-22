import { useState } from "react";
import { C } from "./theme";
import { Card, CardHeader, Btn, Badge, Input, Select } from "./components";

const FIELD_DEFS = [
  { key: "companyName", label: "Company Name", type: "text" },
  { key: "currency",    label: "Currency",      type: "select", opts: [
      { value: "SGD", label: "SGD (Singapore Dollar)" },
      { value: "MYR", label: "MYR (Malaysian Ringgit)" },
      { value: "USD", label: "USD (US Dollar)" },
    ] },
  { key: "timezone",    label: "Timezone",      type: "select", opts: [
      { value: "SGT", label: "SGT (UTC+8)" },
      { value: "MYT", label: "MYT (UTC+8)" },
      { value: "UTC", label: "UTC" },
    ] },
  { key: "maintPct",    label: "Default Maintenance %", type: "text" },
  { key: "coeEarly",    label: "COE Alert — Early",     type: "text" },
  { key: "coeUrgent",   label: "COE Alert — Urgent",    type: "text" },
];

const DEFAULT_PROFILE = {
  companyName: "SG Wheels Pte Ltd",
  currency: "SGD",
  timezone: "SGT",
  maintPct: "7.5%",
  coeEarly: "90 days",
  coeUrgent: "30 days",
};

const currencyLabel = (v) => ({ SGD: "SGD (Singapore Dollar)", MYR: "MYR (Malaysian Ringgit)", USD: "USD (US Dollar)" }[v] || v);
const timezoneLabel = (v) => ({ SGT: "SGT (UTC+8)", MYT: "MYT (UTC+8)", UTC: "UTC" }[v] || v);

const EMPTY_LICENSE_DRAFT = { licenseNumber: "", reason: "" };

// Admin-only: manage the list of driving license numbers that are blocked
// from being used on a new booking (e.g. active criminal case, court order).
// Visibility of this whole card is gated on currentUserRole === "Admin" —
// Staff never see it mounted at all, not just visually hidden.
const RestrictedLicenses = ({ licenses, onAdd, onUpdate, onDelete }) => {
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [draft, setDraft] = useState(EMPTY_LICENSE_DRAFT);

  const startAdd = () => { setDraft(EMPTY_LICENSE_DRAFT); setEditingId(null); setAdding(true); };
  const startEdit = (l) => { setDraft({ licenseNumber: l.licenseNumber, reason: l.reason }); setEditingId(l.id); setAdding(true); };
  const cancel = () => { setAdding(false); setEditingId(null); setDraft(EMPTY_LICENSE_DRAFT); };

  const save = () => {
    const licenseNumber = draft.licenseNumber.trim().toUpperCase();
    const reason = draft.reason.trim();
    if (!licenseNumber || !reason) {
      alert("Please enter both a license number and a reason.");
      return;
    }
    if (editingId) {
      onUpdate(editingId, { licenseNumber, reason });
    } else {
      onAdd({ licenseNumber, reason });
    }
    cancel();
  };

  const handleDelete = (l) => {
    if (window.confirm(`Remove restriction on license "${l.licenseNumber}"?`)) {
      onDelete(l.id);
    }
  };

  return (
    <Card>
      <CardHeader title="Restricted Driving Licenses" right={
        !adding && <Btn small primary onClick={startAdd}>＋ Add Restriction</Btn>
      } />
      <div style={{ padding: 16 }}>
        <div style={{ fontSize: 11, color: C.textMuted, marginBottom: 12 }}>
          Licenses listed here are blocked from being used on a new booking.
        </div>

        {adding && (
          <div style={{ border: `1px solid ${C.border}`, borderRadius: 8, padding: 12, marginBottom: 14, background: C.bg }}>
            <Input
              label="Driving License Number"
              value={draft.licenseNumber}
              onChange={e => setDraft(d => ({ ...d, licenseNumber: e.target.value.toUpperCase() }))}
              placeholder="e.g., DL-2024-88213"
            />
            <Input
              label="Reason"
              value={draft.reason}
              onChange={e => setDraft(d => ({ ...d, reason: e.target.value }))}
              placeholder="e.g., Criminal Case, Court Restriction"
            />
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 4 }}>
              <Btn small onClick={cancel}>Cancel</Btn>
              <Btn small primary onClick={save}>{editingId ? "Save Changes" : "Add"}</Btn>
            </div>
          </div>
        )}

        {licenses.length === 0 && !adding ? (
          <div style={{ padding: "16px 0", textAlign: "center", color: C.textMuted, fontSize: 12 }}>No restricted licenses</div>
        ) : (
          licenses.map(l => (
            <div key={l.id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 0", borderBottom: `1px solid ${C.border}` }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: C.navy, fontFamily: "monospace" }}>{l.licenseNumber}</div>
                <div style={{ fontSize: 10.5, color: C.textMuted }}>{l.reason}</div>
              </div>
              <Badge color={C.red} bg="#fdecea">Restricted</Badge>
              <button onClick={() => startEdit(l)}
                style={{ padding: "4px 8px", fontSize: 10, background: "none", border: "none", color: C.teal, cursor: "pointer", fontWeight: 600 }}>
                Edit
              </button>
              <button onClick={() => handleDelete(l)}
                style={{ padding: "4px 8px", fontSize: 10, background: "none", border: "none", color: C.red, cursor: "pointer", fontWeight: 600 }}>
                Delete
              </button>
            </div>
          ))
        )}
      </div>
    </Card>
  );
};

const Settings = ({
  onAddUser,
  currentUserRole = "Staff",
  restrictedLicenses = [],
  onAddRestrictedLicense = () => {},
  onUpdateRestrictedLicense = () => {},
  onDeleteRestrictedLicense = () => {},
}) => {
  const isAdmin = currentUserRole === "Admin";
  const [profile, setProfile] = useState(DEFAULT_PROFILE);
  const [draft, setDraft] = useState(DEFAULT_PROFILE);
  const [editing, setEditing] = useState(false);

  const startEdit = () => { setDraft(profile); setEditing(true); };
  const cancelEdit = () => { setDraft(profile); setEditing(false); };
  const saveEdit = () => { setProfile(draft); setEditing(false); };
  const setField = (key, value) => setDraft(d => ({ ...d, [key]: value }));

  return (
    <div>
      <div style={{ fontSize: 15, fontWeight: 700, color: C.navy, marginBottom: 4 }}>Settings</div>
      <div style={{ fontSize: 11, color: C.textMuted, marginBottom: 16 }}>Company profile, users, and system configuration</div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
        <Card>
          <CardHeader title="Company Profile" right={
            editing
              ? <div style={{ display: "flex", gap: 8 }}>
                  <Btn small onClick={cancelEdit}>Cancel</Btn>
                  <Btn small primary onClick={saveEdit}>Save</Btn>
                </div>
              : <Btn small primary onClick={startEdit}>Edit Profile</Btn>
          } />
          <div style={{ padding: 16 }}>
            {!editing ? (
              FIELD_DEFS.map(f => (
                <div key={f.key} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "9px 0", borderBottom: `1px solid ${C.border}`, fontSize: 12 }}>
                  <span style={{ color: C.textMuted }}>{f.label}</span>
                  <span style={{ fontWeight: 600, color: C.navy }}>
                    {f.key === "currency" ? currencyLabel(profile[f.key]) : f.key === "timezone" ? timezoneLabel(profile[f.key]) : profile[f.key]}
                  </span>
                </div>
              ))
            ) : (
              <div>
                {FIELD_DEFS.map(f => (
                  f.type === "select"
                    ? <Select key={f.key} label={f.label} value={draft[f.key]} onChange={e => setField(f.key, e.target.value)} options={f.opts} />
                    : <Input key={f.key} label={f.label} value={draft[f.key]} onChange={e => setField(f.key, e.target.value)} />
                ))}
              </div>
            )}
          </div>
        </Card>

        <Card>
          <CardHeader title="User Management" right={<Btn small primary onClick={onAddUser}>＋ Add User</Btn>} />
          <div style={{ padding: 16 }}>
            {[
              { name: "Selvakumar", role: "Admin", email: "selva@sgwheels.com" },
              { name: "Kavivarthini", role: "Admin", email: "kavi@sgwheels.com" },
              { name: "Rajan Pillai", role: "Staff", email: "rajan@sgwheels.com" },
              { name: "Li Wei", role: "Staff", email: "liwei@sgwheels.com" },
            ].map(u => (
              <div key={u.name} style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 0", borderBottom: `1px solid ${C.border}` }}>
                <div style={{ width: 32, height: 32, borderRadius: "50%", background: u.role === "Admin" ? C.navy : C.teal, color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 700, flexShrink: 0 }}>
                  {u.name[0]}
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: C.navy }}>{u.name}</div>
                  <div style={{ fontSize: 10.5, color: C.textMuted }}>{u.email}</div>
                </div>
                <Badge color={u.role === "Admin" ? C.navy : C.teal} bg={u.role === "Admin" ? C.bg : C.tealFaint}>{u.role}</Badge>
              </div>
            ))}
          </div>
        </Card>

        {isAdmin && (
          <RestrictedLicenses
            licenses={restrictedLicenses}
            onAdd={onAddRestrictedLicense}
            onUpdate={onUpdateRestrictedLicense}
            onDelete={onDeleteRestrictedLicense}
          />
        )}
      </div>
    </div>
  );
};

export default Settings;