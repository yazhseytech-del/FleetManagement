// import { useState, useMemo, useEffect } from "react";
// import { C, mono, fmt } from "./theme";
// import { Card, Btn, StatusTag, Modal, Input, Select } from "./components";
// import { computeBookingInvoice } from "./useFleetData";

// // ── PROFILE OVERLAY ──────────────────────────────────────────────────────────
// // Per useFleetData.js: "Booking history is the only 'customer database' this
// // app has — no separate customers table." Name/Phone/Address/License/Driving
// // Experience/Customer Type for an existing customer always come straight from
// // their most recent booking, same as the New Booking wizard's IC lookup does.
// //
// // The reference design also shows Email, Date of Birth and Nationality, none
// // of which the booking form collects, plus an "Add New Customer" action for
// // registering someone before their first booking exists. Rather than forking
// // a second, competing source of truth for customer identity, this is a thin
// // keyed-by-IC overlay for just those extras (+ a placeholder record for a
// // customer added here with zero bookings so far). It's persisted the same
// // way useFleetData persists everything else — namespaced localStorage key,
// // safe JSON load/save.
// const PROFILE_STORAGE_KEY = "fleetopz:customerProfiles";

// const loadProfiles = () => {
//   try {
//     const raw = window.localStorage.getItem(PROFILE_STORAGE_KEY);
//     return raw ? JSON.parse(raw) : {};
//   } catch (err) {
//     console.error("Customer: failed to load customerProfiles from localStorage", err);
//     return {};
//   }
// };

// const saveProfiles = (profiles) => {
//   try {
//     window.localStorage.setItem(PROFILE_STORAGE_KEY, JSON.stringify(profiles));
//   } catch (err) {
//     console.error("Customer: failed to save customerProfiles to localStorage", err);
//   }
// };

// // ── FORMATTING HELPERS ───────────────────────────────────────────────────────
// const formatDate = (v) => {
//   if (!v) return "—";
//   const d = new Date(v);
//   if (isNaN(d)) return "—";
//   return d.toLocaleDateString(undefined, { day: "2-digit", month: "2-digit", year: "numeric" });
// };

// const initials = (name) => (name || "?").trim().split(/\s+/).slice(0, 2).map(w => w[0]?.toUpperCase() || "").join("") || "?";

// // Deterministic pastel avatar color from the IC/name so a given customer's
// // initials always render in the same color between renders/pages, without
// // needing to store a color anywhere.
// const AVATAR_PALETTE = [
//   { bg: "#dbeafe", fg: "#1d4ed8" }, // blue
//   { bg: "#ede9fe", fg: "#6d28d9" }, // purple
//   { bg: "#fce7f3", fg: "#be185d" }, // pink
//   { bg: "#d1fae5", fg: "#047857" }, // teal/green
//   { bg: "#fef3c7", fg: "#b45309" }, // amber
//   { bg: "#e0f2fe", fg: "#0369a1" }, // sky
// ];
// const avatarColorFor = (key) => {
//   let hash = 0;
//   for (let i = 0; i < key.length; i++) hash = (hash * 31 + key.charCodeAt(i)) >>> 0;
//   return AVATAR_PALETTE[hash % AVATAR_PALETTE.length];
// };

// const STATUS_COLORS = { Active: C.green, Inactive: C.red };

// // A customer counts as "Inactive" only once there's been no activity — no
// // currently Active/Upcoming/Ending Today booking, and their last booking's
// // end date is more than 6 months old. Mirrors how the booking module itself
// // only ever treats dormancy, never a single missed day, as a status change.
// const INACTIVITY_WINDOW_DAYS = 180;

// // ── CUSTOMER AGGREGATION ─────────────────────────────────────────────────────
// // Builds one row per unique IC/ID Number out of booking history (+ any
// // profile-only customers added via "Add New Customer" that have no bookings
// // yet). This is the single place that decides what a "customer" is — the
// // table, the stat cards, and the detail panel all read from this same list
// // so their numbers can never disagree with each other.
// const buildCustomerDirectory = (bookings, profiles) => {
//   const byIc = {};
//   bookings.forEach(b => {
//     if (!b.ic) return;
//     (byIc[b.ic] = byIc[b.ic] || []).push(b);
//   });
//   Object.keys(profiles).forEach(ic => { byIc[ic] = byIc[ic] || []; });

//   const todayMonth = new Date().toISOString().slice(0, 7);

//   return Object.keys(byIc).map(ic => {
//     const profile = profiles[ic] || {};
//     const all = byIc[ic];
//     const active = all.filter(b => !b.cancelled);
//     // Most-recent-first — every "current" field (name, phone, address,
//     // license, etc.) reads from all[0] once sorted, same rule the New
//     // Booking wizard's IC lookup already uses (findCustomerByIC).
//     const byRecency = [...all].sort((a, b) => new Date(b.start || b.createdAt || 0) - new Date(a.start || a.createdAt || 0));
//     const latest = byRecency[0] || {};
//     const earliest = [...all].sort((a, b) => new Date(a.start || a.createdAt || 0) - new Date(b.start || b.createdAt || 0))[0];

//     let pendingAmount = 0;
//     let pendingBookings = 0;
//     let lastPayment = null;
//     active.forEach(b => {
//       const inv = computeBookingInvoice(b);
//       if (inv.balanceDue > 0) { pendingAmount += inv.balanceDue; pendingBookings++; }
//       inv.payments.forEach(p => {
//         if (!lastPayment || new Date(p.addedAt || 0) > new Date(lastPayment.addedAt || 0)) lastPayment = p;
//       });
//     });

//     const hasLiveBooking = active.some(b => ["Active", "Upcoming", "Ending Today"].includes(b.status));
//     const lastActivityDate = active.reduce((max, b) => {
//       const d = new Date(b.actualReturnAt || b.end || b.start || 0);
//       return d > max ? d : max;
//     }, new Date(0));
//     const daysSinceActivity = (Date.now() - lastActivityDate.getTime()) / 86400000;
//     const status = all.length === 0 ? "Active" // freshly added, no history yet to judge dormancy from
//       : (hasLiveBooking || daysSinceActivity <= INACTIVITY_WINDOW_DAYS) ? "Active" : "Inactive";

//     const isNewThisMonth = earliest ? (earliest.start || earliest.createdAt || "").startsWith(todayMonth) : false;

//     return {
//       ic,
//       customer: latest.customer || profile.customer || "Unnamed Customer",
//       contact: latest.contact || profile.contact || "",
//       email: profile.email || "",
//       dob: profile.dob || "",
//       nationality: profile.nationality || "",
//       customerType: latest.customerType || profile.customerType || "Local",
//       address: latest.address || profile.address || "",
//       drivingExperience: latest.drivingExperience || profile.drivingExperience || "",
//       license: latest.license || "",
//       licenseExpiry: latest.licenseExpiry || "",
//       status,
//       isRepeat: active.length >= 2,
//       isNewThisMonth,
//       totalBookings: active.length,
//       pendingAmount,
//       pendingBookings,
//       lastPayment,
//       lastBookingDate: latest.start || null,
//       lastBookingId: latest.id || null,
//       lastUpdated: latest.updatedAt || latest.createdAt || latest.start || null,
//       createdDate: earliest ? (earliest.createdAt || earliest.start) : profile.createdAt,
//       bookings: byRecency,
//       hasBookings: all.length > 0,
//     };
//   }).sort((a, b) => new Date(b.lastUpdated || 0) - new Date(a.lastUpdated || 0));
// };

// const PAGE_SIZE = 8;

// // Small metric card used across the top row — mirrors the 5-card layout in
// // the reference design (icon left, big number, small delta line beneath).
// const StatCard = ({ icon, iconBg, label, value, delta, deltaColor, danger, action }) => (
//   <div style={{
//     background: C.surface, border: `1px solid ${danger ? C.red : C.border}`, borderRadius: 12,
//     padding: "16px 18px", display: "flex", flexDirection: "column", gap: 10, position: "relative", flex: 1, minWidth: 0,
//   }}>
//     <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
//       <div style={{ width: 44, height: 44, borderRadius: "50%", background: iconBg, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18, flexShrink: 0 }}>{icon}</div>
//       <div style={{ fontSize: 12, fontWeight: 600, color: C.textSec }}>{label}</div>
//     </div>
//     <div style={{ fontSize: 24, fontWeight: 700, color: C.navy, ...mono }}>{value}</div>
//     <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
//       <div style={{ fontSize: 11, fontWeight: 600, color: deltaColor || C.textMuted }}>{delta}</div>
//       {action}
//     </div>
//   </div>
// );

// export default function Customer({ bookings = [], onViewBooking }) {
//   const [profiles, setProfiles] = useState(loadProfiles);
//   useEffect(() => { saveProfiles(profiles); }, [profiles]);

//   const [search, setSearch] = useState("");
//   const [statusFilter, setStatusFilter] = useState("All");
//   const [showFilters, setShowFilters] = useState(false);
//   const [typeFilter, setTypeFilter] = useState("All");
//   const [repeatOnly, setRepeatOnly] = useState(false);
//   const [pendingOnly, setPendingOnly] = useState(false);
//   const [page, setPage] = useState(1);
//   const [selectedIc, setSelectedIc] = useState(null);
//   const [showAddCustomer, setShowAddCustomer] = useState(false);
//   const [showAllBookings, setShowAllBookings] = useState(false);
//   const [editingProfile, setEditingProfile] = useState(false);

//   const [newCustomerData, setNewCustomerData] = useState({
//     customer: "", ic: "", contact: "", email: "", dob: "", nationality: "",
//     customerType: "Local", address: "",
//   });
//   const [profileDraft, setProfileDraft] = useState({ email: "", dob: "", nationality: "" });

//   const directory = useMemo(() => buildCustomerDirectory(bookings, profiles), [bookings, profiles]);

//   const metrics = useMemo(() => {
//     const total = directory.length;
//     const activeCount = directory.filter(c => c.status === "Active").length;
//     const newThisMonth = directory.filter(c => c.isNewThisMonth).length;
//     const repeatCount = directory.filter(c => c.isRepeat).length;
//     const pendingCount = directory.filter(c => c.pendingAmount > 0).length;
//     const pendingBookingsTotal = directory.reduce((s, c) => s + c.pendingBookings, 0);
//     const pct = (n) => total ? `${((n / total) * 100).toFixed(1)}% of total` : "—";
//     return { total, activeCount, newThisMonth, repeatCount, pendingCount, pendingBookingsTotal, pct };
//   }, [directory]);

//   const filtered = useMemo(() => {
//     const q = search.trim().toLowerCase();
//     return directory.filter(c => {
//       if (statusFilter !== "All" && c.status !== statusFilter) return false;
//       if (typeFilter !== "All" && c.customerType !== typeFilter) return false;
//       if (repeatOnly && !c.isRepeat) return false;
//       if (pendingOnly && !(c.pendingAmount > 0)) return false;
//       if (q && !(c.customer.toLowerCase().includes(q) || c.ic.toLowerCase().includes(q) || (c.contact || "").includes(q) || (c.email || "").toLowerCase().includes(q))) return false;
//       return true;
//     });
//   }, [directory, search, statusFilter, typeFilter, repeatOnly, pendingOnly]);

//   const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
//   const pageSafe = Math.min(page, totalPages);
//   const pageRows = filtered.slice((pageSafe - 1) * PAGE_SIZE, pageSafe * PAGE_SIZE);

//   const selected = directory.find(c => c.ic === selectedIc) || pageRows[0] || filtered[0] || null;

//   useEffect(() => { setPage(1); }, [search, statusFilter, typeFilter, repeatOnly, pendingOnly]);
//   useEffect(() => { setShowAllBookings(false); setEditingProfile(false); }, [selectedIc]);

//   const openProfileEditor = (c) => {
//     setProfileDraft({ email: c.email, dob: c.dob, nationality: c.nationality });
//     setEditingProfile(true);
//   };
//   const saveProfileEditor = () => {
//     setProfiles(prev => ({ ...prev, [selected.ic]: { ...prev[selected.ic], ...profileDraft } }));
//     setEditingProfile(false);
//   };

//   const handleAddCustomer = () => {
//     if (!newCustomerData.customer.trim()) { alert("Full Name is required"); return; }
//     if (!newCustomerData.ic.trim()) { alert("IC Number is required"); return; }
//     if (directory.some(c => c.ic === newCustomerData.ic.trim())) { alert("A customer with this IC Number already exists."); return; }
//     const ic = newCustomerData.ic.trim();
//     setProfiles(prev => ({
//       ...prev,
//       [ic]: { ...newCustomerData, ic, createdAt: new Date().toISOString() },
//     }));
//     setNewCustomerData({ customer: "", ic: "", contact: "", email: "", dob: "", nationality: "", customerType: "Local", address: "" });
//     setShowAddCustomer(false);
//     setSelectedIc(ic);
//   };

//   const fieldRow = (label, value, mine) => (
//     <div style={{ display: "flex", justifyContent: "space-between", padding: "8px 0", borderBottom: `1px solid ${C.bg}`, gap: 12 }}>
//       <span style={{ fontSize: 11.5, color: C.textMuted, flexShrink: 0 }}>{label}</span>
//       <span style={{ fontSize: 12, color: C.textPri, fontWeight: 500, textAlign: "right" }}>{mine || value || "—"}</span>
//     </div>
//   );

//   return (
//     <div>
//       {/* Header */}
//       <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 18 }}>
//         <div>
//           <div style={{ fontSize: 15, fontWeight: 700, color: C.navy }}>Customer Management</div>
//           <div style={{ fontSize: 11, color: C.textMuted, marginTop: 2 }}>Manage all customers. Customer details are updated automatically from Bookings.</div>
//         </div>
//         <Btn primary onClick={() => setShowAddCustomer(true)}>＋ Add New Customer</Btn>
//       </div>

//       {/* Stat cards */}
//       <div style={{ display: "flex", gap: 14, marginBottom: 18, flexWrap: "wrap" }}>
//         <StatCard icon="👥" iconBg="#dbeafe" label="Total Customers" value={metrics.total}
//           delta={`+${metrics.newThisMonth} this month`} deltaColor={C.green} />
//         <StatCard icon="🙂" iconBg="#dcfce7" label="Active Customers" value={metrics.activeCount}
//           delta={metrics.pct(metrics.activeCount)} deltaColor={C.green} />
//         <StatCard icon="📅" iconBg="#fef3c7" label="New This Month" value={metrics.newThisMonth}
//           delta="vs last month" deltaColor={C.textMuted} />
//         <StatCard icon="📈" iconBg="#ede9fe" label="Repeat Customers" value={metrics.repeatCount}
//           delta={metrics.pct(metrics.repeatCount)} deltaColor={C.teal} />
//         <StatCard icon="💲" iconBg="#fee2e2" label="Payment Pending Customers" value={metrics.pendingCount} danger
//           delta={metrics.pct(metrics.pendingCount)} deltaColor={C.red}
//           action={<Btn onClick={() => { setPendingOnly(true); setStatusFilter("All"); }}>View All</Btn>} />
//       </div>

//       {/* Payment pending banner */}
//       {metrics.pendingCount > 0 && (
//         <div style={{
//           display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12,
//           background: "#fffbeb", border: `1px solid #fde68a`, borderRadius: 10, padding: "12px 16px", marginBottom: 18,
//         }}>
//           <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
//             <span style={{ fontSize: 16 }}>⚠️</span>
//             <div>
//               <div style={{ fontSize: 12.5, fontWeight: 700, color: "#92400e" }}>Payment Pending Summary</div>
//               <div style={{ fontSize: 11.5, color: "#92400e" }}>{metrics.pendingCount} customers have pending payments for {metrics.pendingBookingsTotal} bookings.</div>
//             </div>
//           </div>
//           <Btn onClick={() => { setPendingOnly(true); setStatusFilter("All"); }}>View Pending Customers</Btn>
//         </div>
//       )}

//       {/* Main two-column layout */}
//       <div style={{ display: "grid", gridTemplateColumns: "1fr 360px", gap: 16, alignItems: "start" }}>
//         {/* Customer list */}
//         <Card>
//           <div style={{ display: "flex", gap: 10, marginBottom: 14, flexWrap: "wrap" }}>
//             <input
//               value={search}
//               onChange={(e) => setSearch(e.target.value)}
//               placeholder="Search by name, IC number, phone, email..."
//               style={{ flex: 1, minWidth: 220, padding: "9px 12px", borderRadius: 8, border: `1px solid ${C.border}`, fontSize: 12.5, fontFamily: "inherit", outline: "none" }}
//             />
//             <div style={{ position: "relative" }}>
//               <Btn onClick={() => setShowFilters(v => !v)}>▾ Filters</Btn>
//               {showFilters && (
//                 <div style={{ position: "absolute", top: "110%", right: 0, background: C.surface, border: `1px solid ${C.border}`, borderRadius: 10, padding: 14, width: 220, boxShadow: "0 8px 24px rgba(15,23,42,0.12)", zIndex: 10 }}>
//                   <div style={{ fontSize: 10.5, fontWeight: 700, color: C.textSec, textTransform: "uppercase", letterSpacing: 0.4, marginBottom: 8 }}>Customer Type</div>
//                   <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} style={{ width: "100%", padding: "7px 8px", borderRadius: 6, border: `1px solid ${C.border}`, fontSize: 12, marginBottom: 12, fontFamily: "inherit" }}>
//                     <option value="All">All</option>
//                     <option value="Local">Local</option>
//                     <option value="Foreigner">Foreigner</option>
//                   </select>
//                   <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: C.textPri, marginBottom: 8, cursor: "pointer" }}>
//                     <input type="checkbox" checked={repeatOnly} onChange={(e) => setRepeatOnly(e.target.checked)} />
//                     Repeat customers only
//                   </label>
//                   <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: C.textPri, cursor: "pointer" }}>
//                     <input type="checkbox" checked={pendingOnly} onChange={(e) => setPendingOnly(e.target.checked)} />
//                     Payment pending only
//                   </label>
//                 </div>
//               )}
//             </div>
//             <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}
//               style={{ padding: "9px 12px", borderRadius: 8, border: `1px solid ${C.border}`, fontSize: 12.5, fontFamily: "inherit", outline: "none" }}>
//               <option value="All">Status: All</option>
//               <option value="Active">Status: Active</option>
//               <option value="Inactive">Status: Inactive</option>
//             </select>
//           </div>

//           <table style={{ width: "100%", borderCollapse: "collapse" }}>
//             <thead>
//               <tr style={{ borderBottom: `1px solid ${C.border}` }}>
//                 {["Customer", "IC Number", "Phone", "Status", "Pending", "Bookings", "Last Booking", ""].map(h => (
//                   <th key={h} style={{ textAlign: "left", padding: "8px 12px", fontSize: 10.5, fontWeight: 700, color: C.textMuted, textTransform: "uppercase", letterSpacing: 0.3 }}>{h}</th>
//                 ))}
//               </tr>
//             </thead>
//             <tbody>
//               {pageRows.map(c => {
//                 const av = avatarColorFor(c.ic || c.customer);
//                 const isSelected = selected?.ic === c.ic;
//                 return (
//                   <tr key={c.ic} onClick={() => setSelectedIc(c.ic)}
//                     style={{ borderBottom: `1px solid ${C.bg}`, cursor: "pointer", background: isSelected ? C.tealFaint : "transparent" }}>
//                     <td style={{ padding: "10px 12px" }}>
//                       <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
//                         <div style={{ width: 32, height: 32, borderRadius: "50%", background: av.bg, color: av.fg, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11.5, fontWeight: 700, flexShrink: 0 }}>{initials(c.customer)}</div>
//                         <div style={{ minWidth: 0 }}>
//                           <div style={{ fontSize: 12.5, fontWeight: 600, color: C.navy, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{c.customer}</div>
//                           <div style={{ fontSize: 10.5, color: C.textMuted }}>{c.email || c.ic}</div>
//                         </div>
//                       </div>
//                     </td>
//                     <td style={{ padding: "10px 12px", fontSize: 11.5, color: C.textSec, ...mono }}>{c.ic}</td>
//                     <td style={{ padding: "10px 12px", fontSize: 11.5, color: C.textSec }}>{c.contact || "—"}</td>
//                     <td style={{ padding: "10px 12px" }}>
//                       <span style={{ fontSize: 10.5, fontWeight: 700, padding: "3px 10px", borderRadius: 999, background: `${STATUS_COLORS[c.status]}18`, color: STATUS_COLORS[c.status] }}>{c.status}</span>
//                     </td>
//                     <td style={{ padding: "10px 12px", fontSize: 12, fontWeight: 700, ...mono, color: c.pendingAmount > 0 ? C.red : C.green }}>{fmt(c.pendingAmount)}</td>
//                     <td style={{ padding: "10px 12px", fontSize: 11.5, color: C.textSec, textAlign: "center" }}>{c.pendingBookings}</td>
//                     <td style={{ padding: "10px 12px", fontSize: 11.5, color: C.textSec }}>{formatDate(c.lastBookingDate)}</td>
//                     <td style={{ padding: "10px 12px", color: C.textMuted }}>›</td>
//                   </tr>
//                 );
//               })}
//               {pageRows.length === 0 && (
//                 <tr><td colSpan={8} style={{ padding: "28px 12px", textAlign: "center", fontSize: 12, color: C.textMuted }}>No customers match your filters.</td></tr>
//               )}
//             </tbody>
//           </table>

//           {/* Pagination */}
//           <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 14 }}>
//             <div style={{ fontSize: 11, color: C.textMuted }}>
//               Showing {filtered.length === 0 ? 0 : (pageSafe - 1) * PAGE_SIZE + 1} to {Math.min(pageSafe * PAGE_SIZE, filtered.length)} of {filtered.length} customers
//             </div>
//             <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
//               <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={pageSafe === 1}
//                 style={{ width: 26, height: 26, borderRadius: 6, border: `1px solid ${C.border}`, background: C.surface, cursor: pageSafe === 1 ? "default" : "pointer", opacity: pageSafe === 1 ? 0.4 : 1 }}>‹</button>
//               {Array.from({ length: Math.min(totalPages, 5) }, (_, i) => i + 1).map(n => (
//                 <button key={n} onClick={() => setPage(n)}
//                   style={{ width: 26, height: 26, borderRadius: 6, border: `1px solid ${n === pageSafe ? C.navy : C.border}`, background: n === pageSafe ? C.navy : C.surface, color: n === pageSafe ? "#fff" : C.textSec, fontSize: 11.5, fontWeight: 600, cursor: "pointer" }}>{n}</button>
//               ))}
//               {totalPages > 5 && <span style={{ fontSize: 11, color: C.textMuted }}>…</span>}
//               <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={pageSafe === totalPages}
//                 style={{ width: 26, height: 26, borderRadius: 6, border: `1px solid ${C.border}`, background: C.surface, cursor: pageSafe === totalPages ? "default" : "pointer", opacity: pageSafe === totalPages ? 0.4 : 1 }}>›</button>
//             </div>
//           </div>

//           {/* Statuses guide */}
//           <div style={{ marginTop: 16, paddingTop: 14, borderTop: `1px solid ${C.bg}`, display: "flex", flexWrap: "wrap", gap: 16, fontSize: 10.5, color: C.textMuted }}>
//             <span><b style={{ color: C.green }}>●</b> Active — booking within the last {INACTIVITY_WINDOW_DAYS / 30}mo, or a live booking</span>
//             <span><b style={{ color: C.red }}>●</b> Inactive — no recent activity</span>
//             <span><b style={{ color: C.green }}>0.00</b> — no pending amount</span>
//             <span><b style={{ color: C.red }}>Red amount</b> — payment pending</span>
//           </div>
//         </Card>

//         {/* Customer detail panel */}
//         <Card>
//           {!selected ? (
//             <div style={{ padding: "20px 4px", fontSize: 12, color: C.textMuted, textAlign: "center" }}>Select a customer to view details.</div>
//           ) : (
//             <div>
//               <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 14 }}>
//                 <div style={{ fontSize: 14, fontWeight: 700, color: C.navy }}>Customer Details</div>
//                 <span style={{ fontSize: 10.5, fontWeight: 700, padding: "3px 10px", borderRadius: 999, background: `${STATUS_COLORS[selected.status]}18`, color: STATUS_COLORS[selected.status] }}>{selected.status}</span>
//               </div>

//               {selected.hasBookings && (
//                 <div style={{ background: C.tealFaint, border: `1px solid ${C.tealLight}55`, borderRadius: 8, padding: "10px 12px", fontSize: 11, color: C.textSec, marginBottom: 14 }}>
//                   ℹ️ Name, phone, address and license details are managed in Bookings — any changes made there are reflected here automatically. Email, Date of Birth and Nationality are editable here directly.
//                 </div>
//               )}

//               {editingProfile ? (
//                 <div style={{ marginBottom: 14 }}>
//                   <Input label="Email" type="email" value={profileDraft.email} onChange={(e) => setProfileDraft({ ...profileDraft, email: e.target.value })} placeholder="e.g., ravi.kumar@email.com" />
//                   <Input label="Date of Birth" type="date" value={profileDraft.dob} onChange={(e) => setProfileDraft({ ...profileDraft, dob: e.target.value })} />
//                   <Input label="Nationality" value={profileDraft.nationality} onChange={(e) => setProfileDraft({ ...profileDraft, nationality: e.target.value })} placeholder="e.g., Singaporean" />
//                   <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
//                     <Btn primary onClick={saveProfileEditor}>Save</Btn>
//                     <Btn onClick={() => setEditingProfile(false)}>Cancel</Btn>
//                   </div>
//                 </div>
//               ) : (
//                 <div style={{ marginBottom: 4 }}>
//                   {fieldRow("Full Name", selected.customer)}
//                   {fieldRow("IC Number", selected.ic)}
//                   {fieldRow("Phone Number", selected.contact)}
//                   {fieldRow("Email", selected.email)}
//                   {fieldRow("Date of Birth", selected.dob && formatDate(selected.dob))}
//                   {fieldRow("Nationality", selected.nationality)}
//                   {fieldRow("Customer Type", selected.customerType)}
//                   {fieldRow("Address", selected.address)}
//                   {fieldRow("Driving Experience", selected.drivingExperience)}
//                   {fieldRow("License Number", selected.license)}
//                   {fieldRow("License Expiry", selected.licenseExpiry && formatDate(selected.licenseExpiry))}
//                   {fieldRow("Created Date", formatDate(selected.createdDate))}
//                   <div style={{ display: "flex", justifyContent: "space-between", padding: "8px 0", gap: 12 }}>
//                     <span style={{ fontSize: 11.5, color: C.textMuted }}>Last Updated</span>
//                     <span style={{ fontSize: 12, color: C.textPri, textAlign: "right" }}>
//                       {formatDate(selected.lastUpdated)}{" "}
//                       {selected.lastBookingId && (
//                         <span onClick={() => onViewBooking?.(selected.lastBookingId)} style={{ color: C.teal, fontWeight: 600, cursor: onViewBooking ? "pointer" : "default" }}>
//                           (via Booking {selected.lastBookingId})
//                         </span>
//                       )}
//                     </span>
//                   </div>
//                   <div style={{ marginTop: 8 }}>
//                     <Btn onClick={() => openProfileEditor(selected)}>✎ Edit Contact Details</Btn>
//                   </div>
//                 </div>
//               )}

//               {/* Payment summary */}
//               <div style={{ marginTop: 16, border: `1px solid ${selected.pendingAmount > 0 ? "#fecaca" : C.border}`, background: selected.pendingAmount > 0 ? "#fef2f2" : C.bg, borderRadius: 10, padding: "14px 16px" }}>
//                 <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
//                   <div style={{ fontSize: 12.5, fontWeight: 700, color: selected.pendingAmount > 0 ? C.red : C.navy }}>Payment Summary</div>
//                   {selected.hasBookings && <Btn onClick={() => setShowAllBookings(v => !v)}>{showAllBookings ? "Hide" : "View All"} Bookings</Btn>}
//                 </div>
//                 <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, fontSize: 11.5 }}>
//                   <div>
//                     <div style={{ color: C.textMuted, marginBottom: 2 }}>Total Pending Amount</div>
//                     <div style={{ fontSize: 15, fontWeight: 700, ...mono, color: selected.pendingAmount > 0 ? C.red : C.green }}>{fmt(selected.pendingAmount)}</div>
//                   </div>
//                   <div>
//                     <div style={{ color: C.textMuted, marginBottom: 2 }}>Pending Bookings</div>
//                     <div style={{ fontSize: 15, fontWeight: 700, color: C.navy }}>{selected.pendingBookings}</div>
//                   </div>
//                   <div>
//                     <div style={{ color: C.textMuted, marginBottom: 2 }}>Last Payment</div>
//                     <div style={{ fontSize: 13, fontWeight: 700, ...mono, color: C.navy }}>{selected.lastPayment ? fmt(Number(selected.lastPayment.amount) || 0) : "—"}</div>
//                     {selected.lastPayment?.addedAt && <div style={{ fontSize: 10, color: C.textMuted }}>{formatDate(selected.lastPayment.addedAt)}</div>}
//                   </div>
//                 </div>
//                 <div style={{ fontSize: 10, color: C.textMuted, marginTop: 10 }}>Pending amount includes unpaid balance from bookings.</div>
//               </div>

//               {showAllBookings && (
//                 <div style={{ marginTop: 12, maxHeight: 220, overflowY: "auto" }}>
//                   {selected.bookings.map(b => {
//                     const inv = computeBookingInvoice(b);
//                     return (
//                       <div key={b.id} onClick={() => onViewBooking?.(b.id)}
//                         style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 4px", borderBottom: `1px solid ${C.bg}`, cursor: onViewBooking ? "pointer" : "default" }}>
//                         <div>
//                           <div style={{ fontSize: 11.5, fontWeight: 700, color: C.navyMid, ...mono }}>{b.id}</div>
//                           <div style={{ fontSize: 10, color: C.textMuted }}>{formatDate(b.start)} → {formatDate(b.end)}</div>
//                         </div>
//                         <div style={{ textAlign: "right" }}>
//                           <div style={{ fontSize: 11.5, fontWeight: 700, ...mono, color: inv.balanceDue > 0 ? C.red : C.green }}>{fmt(inv.balanceDue)}</div>
//                           <StatusTag status={b.status} />
//                         </div>
//                       </div>
//                     );
//                   })}
//                 </div>
//               )}
//             </div>
//           )}
//         </Card>
//       </div>

//       {/* Add New Customer modal — creates a profile-only record (no bookings
//           yet). If this IC is later used on a real booking, that booking's
//           data (name/phone/address/license/etc.) takes over as the current
//           values, same as any other customer; this overlay only ever supplies
//           Email/DOB/Nationality afterward. */}
//       <Modal
//         open={showAddCustomer}
//         title="Add New Customer"
//         onClose={() => setShowAddCustomer(false)}
//         onSubmit={handleAddCustomer}
//         submitText="Add Customer"
//       >
//         <Input label="Full Name" value={newCustomerData.customer} onChange={(e) => setNewCustomerData({ ...newCustomerData, customer: e.target.value })} placeholder="e.g., Ravi Kumar" />
//         <Input label="IC Number" value={newCustomerData.ic} onChange={(e) => setNewCustomerData({ ...newCustomerData, ic: e.target.value.toUpperCase() })} placeholder="e.g., S1234567A" />
//         <Input label="Phone Number" value={newCustomerData.contact} onChange={(e) => setNewCustomerData({ ...newCustomerData, contact: e.target.value })} placeholder="e.g., 9123 4567" />
//         <Input label="Email" type="email" value={newCustomerData.email} onChange={(e) => setNewCustomerData({ ...newCustomerData, email: e.target.value })} placeholder="e.g., ravi.kumar@email.com" />
//         <Input label="Date of Birth" type="date" value={newCustomerData.dob} onChange={(e) => setNewCustomerData({ ...newCustomerData, dob: e.target.value })} />
//         <Input label="Nationality" value={newCustomerData.nationality} onChange={(e) => setNewCustomerData({ ...newCustomerData, nationality: e.target.value })} placeholder="e.g., Singaporean" />
//         <Select label="Customer Type" value={newCustomerData.customerType} onChange={(e) => setNewCustomerData({ ...newCustomerData, customerType: e.target.value })}
//           options={[{ value: "Local", label: "Local" }, { value: "Foreigner", label: "Foreigner" }]} />
//         <Input label="Address" value={newCustomerData.address} onChange={(e) => setNewCustomerData({ ...newCustomerData, address: e.target.value })} placeholder="e.g., 12, Jalan Bukit Merah, #04-15" />
//       </Modal>
//     </div>
//   );
// }