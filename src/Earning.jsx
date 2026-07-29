import { C, mono, fmt } from "./theme";
import { Card, CardHeader, Btn, Badge, PlateBadge, KpiCard } from "./components";

const Earning = ({ earnings = [], fleet = [], bookings = [], onAddEarning, onUpdateEarning, onDeleteEarning, onLockEarning }) => {
  // Calculate metrics for current data
  const total = earnings.reduce((s, e) => s + (e.total || 0), 0);
  const locked = earnings.filter(e => e.locked).reduce((s, e) => s + (e.total || 0), 0);
  const pending = total - locked;

  // When a booking completes, automatically create an earning record
  const handleCompleteBooking = (bookingId) => {
    const booking = bookings.find(b => b.id === bookingId);
    if (booking && !earnings.find(e => e.bookingId === bookingId)) {
      const days = Math.round((new Date(booking.end) - new Date(booking.start)) / 86400000);
      const earningTotal = booking.rate * days;
      onAddEarning({
        bookingId: bookingId,
        plate: booking.plate,
        customer: booking.customer,
        start: booking.start,
        end: booking.end,
        days: days,
        rate: booking.rate,
        total: earningTotal,
        locked: false,
      });
    }
  };

  const handleLock = (earningId) => {
    onUpdateEarning(earningId, { locked: true });
  };

  const handleDelete = (earningId) => {
    if (window.confirm("Are you sure you want to delete this earning? This cannot be undone if locked.")) {
      onDeleteEarning(earningId);
    }
  };

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <div>
          <div style={{ fontSize: 15, fontWeight: 700, color: C.navy }}>Actual Earnings</div>
          <div style={{ fontSize: 11, color: C.textMuted }}>Auto-fed from completed bookings · Locked records are non-editable</div>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <Btn small>⬇ Export</Btn>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 12, marginBottom: 16 }}>
        <KpiCard 
          label="Total Earned" 
          value={fmt(total)} 
          sub={`${earnings.length} records`}
          accent={C.teal}  
          badge={earnings.length + " records"} 
          badgeColor={C.teal} 
          badgeBg={C.tealFaint} 
        />
        <KpiCard 
          label="Locked & Confirmed" 
          value={fmt(locked)} 
          sub={`${earnings.filter(e => e.locked).length} locked`}
          accent={C.green} 
          badge="Audit-safe" 
          badgeColor={C.green} 
          badgeBg={C.greenFaint} 
        />
        <KpiCard 
          label="Pending Lock" 
          value={fmt(pending)} 
          sub={`${earnings.filter(e => !e.locked).length} pending`}
          accent={C.amber} 
          badge="Awaiting lock" 
          badgeColor={C.amber} 
          badgeBg={C.amberFaint} 
        />
      </div>

      <Card>
        <CardHeader title="Earnings Records" subtitle="Auto-generated from bookings on completion" />
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ background: C.bg }}>
              {["Ref", "Booking", "Car", "Customer", "Period", "Days", "Rate/Day", "Total", "Status", "Actions"].map(h => (
                <th key={h} style={{ textAlign: "left", padding: "9px 12px", fontSize: 10, fontWeight: 600, color: C.textMuted, textTransform: "uppercase", letterSpacing: 0.5, borderBottom: `1px solid ${C.border}`, whiteSpace: "nowrap" }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {earnings.map(e => (
              <tr key={e.id} style={{ borderBottom: `1px solid ${C.border}`, background: e.locked ? C.greenFaint + "55" : "transparent" }}>
                <td style={{ padding: "11px 12px", ...mono, fontSize: 11, fontWeight: 700, color: C.navyMid }}>{e.id}</td>
                <td style={{ padding: "11px 12px", ...mono, fontSize: 11, color: C.textMuted }}>{e.bookingId || "–"}</td>
                <td style={{ padding: "11px 12px" }}><PlateBadge plate={e.plate} small /></td>
                <td style={{ padding: "11px 12px", fontSize: 12, fontWeight: 600 }}>{e.customer}</td>
                <td style={{ padding: "11px 12px", fontSize: 11, color: C.textSec, whiteSpace: "nowrap" }}>{e.start} → {e.end}</td>
                <td style={{ padding: "11px 12px", ...mono, fontSize: 11, textAlign: "center" }}>{e.days}</td>
                <td style={{ padding: "11px 12px", ...mono, fontSize: 11 }}>SGD {e.rate}/d</td>
                <td style={{ padding: "11px 12px", ...mono, fontSize: 13, fontWeight: 700, color: C.green }}>{fmt(e.total)}</td>
                <td style={{ padding: "11px 12px" }}>
                  {e.locked
                    ? <Badge color={C.green} bg={C.greenFaint}>🔒 Locked</Badge>
                    : <Badge color={C.amber} bg={C.amberFaint}>⏳ Pending</Badge>}
                </td>
                <td style={{ padding: "11px 12px", display: "flex", gap: 6 }}>
                  {!e.locked && (
                    <button onClick={() => handleLock(e.id)}
                      style={{ padding: "4px 8px", fontSize: 10, background: "none", border: "none", color: C.green, cursor: "pointer", fontWeight: 600 }}>
                      Lock
                    </button>
                  )}
                 <button onClick={() => handleDelete(e.id)}
  style={{ padding: "4px 8px", fontSize: 10, background: "none", border: "none", color: C.red, cursor: "pointer", fontWeight: 600 }}>
  Delete
</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {earnings.length === 0 && (
          <div style={{ padding: 40, textAlign: "center", color: C.textMuted, fontSize: 13 }}>No earnings records yet</div>
        )}
        <div style={{ padding: "12px 18px", borderTop: `1px solid ${C.border}`, display: "flex", justifyContent: "flex-end", gap: 24 }}>
          <div style={{ fontSize: 11, color: C.textMuted }}>Total: <span style={{ ...mono, fontWeight: 700, color: C.green, fontSize: 14 }}>{fmt(total)}</span></div>
        </div>
      </Card>

      <div style={{ marginTop: 12, padding: 12, background: C.amberFaint, borderRadius: 8, borderLeft: `3px solid ${C.amber}`, fontSize: 11, color: C.textMuted }}>
        <span style={{ fontWeight: 700, color: C.amber }}>Immutability Rule:</span> Once an earning record is locked, it cannot be edited or deleted by any user. This ensures financial audit integrity.
      </div>
    </div>
  );
};

export default Earning;