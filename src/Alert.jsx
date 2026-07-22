import { useState } from "react";
import { C } from "./theme";
import { Card, CardHeader, Btn, Badge, SectionTitle } from "./components";

const Alert = ({ alerts = [], fleet = [] }) => {
  const [dismissed, setDismissed] = useState([]);
  const active = alerts.filter(a => !dismissed.includes(a.id));

  const coeAlerts = active.filter(a => a.type === "coe");
  const maintenanceAlerts = active.filter(a => a.type === "maintenance");
  const operationalAlerts = active.filter(a => a.type !== "coe" && a.type !== "maintenance");

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <div>
          <div style={{ fontSize: 15, fontWeight: 700, color: C.navy }}>Alerts & Notifications</div>
          <div style={{ fontSize: 11, color: C.textMuted }}>{active.length} active alerts · In-app & email notifications</div>
        </div>
      </div>

      {/* Registration Renewal Alerts */}
      <div style={{ marginBottom: 16 }}>
        <SectionTitle>🔴 Registration Renewal Alerts</SectionTitle>
        {coeAlerts.length === 0 ? (
          <Card>
            <div style={{ padding: 24, textAlign: "center", color: C.textMuted, fontSize: 12 }}>No registration alerts</div>
          </Card>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {coeAlerts.map(a => (
              <Card key={a.id}>
                <div style={{ padding: 16, display: "flex", alignItems: "center", gap: 14, borderLeft: `4px solid ${a.urgent ? C.red : C.amber}` }}>
                  <div style={{ fontSize: 28 }}>⚠️</div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 13, fontWeight: 700, color: C.navy }}>{a.plate} — {a.car}</div>
                    <div style={{ fontSize: 11, color: C.textMuted, marginTop: 3 }}>{a.msg}</div>
                    <div style={{ marginTop: 6, display: "flex", gap: 8 }}>
                      <Badge color={a.urgent ? C.red : C.amber} bg={a.urgent ? C.redFaint : C.amberFaint}>
                        {a.urgent ? "🚨 Urgent" : "⚡ Warning"} — {a.days} days remaining
                      </Badge>
                      <Badge color={C.navyMid} bg={C.bg}>In-App + Email sent</Badge>
                    </div>
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                    <Btn small primary>Renew Registration</Btn>
                    <Btn small onClick={() => setDismissed([...dismissed, a.id])}>Dismiss</Btn>
                  </div>
                </div>
              </Card>
            ))}
          </div>
        )}
      </div>

      {/* Maintenance Pending Alerts */}
      <div style={{ marginBottom: 16 }}>
        <SectionTitle>🔧 Maintenance Pending Alerts</SectionTitle>
        {maintenanceAlerts.length === 0 ? (
          <Card>
            <div style={{ padding: 24, textAlign: "center", color: C.textMuted, fontSize: 12 }}>No maintenance pending alerts</div>
          </Card>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {maintenanceAlerts.map(a => (
              <Card key={a.id}>
                <div style={{ padding: 16, display: "flex", alignItems: "center", gap: 14, borderLeft: `4px solid ${a.urgent ? C.red : C.amber}` }}>
                  <div style={{ fontSize: 28 }}>🔧</div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 13, fontWeight: 700, color: C.navy }}>{a.plate} — {a.car}</div>
                    <div style={{ fontSize: 11, color: C.textMuted, marginTop: 3 }}>{a.msg}</div>
                    <div style={{ marginTop: 6 }}>
                      <Badge color={a.urgent ? C.red : C.amber} bg={a.urgent ? C.redFaint : C.amberFaint}>
                        {a.urgent ? "🚨 Auto-releasing soon" : "⚡ Needs attention"} — day {a.days}
                      </Badge>
                    </div>
                  </div>
                  <Btn small onClick={() => setDismissed([...dismissed, a.id])}>Dismiss</Btn>
                </div>
              </Card>
            ))}
          </div>
        )}
      </div>

      {/* Operational Alerts */}
      <div style={{ marginBottom: 16 }}>
        <SectionTitle>🔔 Operational Alerts</SectionTitle>
        {operationalAlerts.length === 0 ? (
          <Card>
            <div style={{ padding: 24, textAlign: "center", color: C.textMuted, fontSize: 12 }}>No operational alerts</div>
          </Card>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {operationalAlerts.map(a => (
              <Card key={a.id}>
                <div style={{ padding: 16, display: "flex", alignItems: "center", gap: 14, borderLeft: `4px solid ${a.urgent ? C.amber : C.teal}` }}>
                  <div style={{ fontSize: 28 }}>{a.type === "return" ? "🔔" : "📋"}</div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 13, fontWeight: 700, color: C.navy }}>{a.plate} — {a.car}</div>
                    <div style={{ fontSize: 11, color: C.textMuted, marginTop: 3 }}>{a.msg}</div>
                    <div style={{ marginTop: 6 }}>
                      <Badge color={C.teal} bg={C.tealFaint}>
                        {a.days === 0 ? "Today" : a.days === 1 ? "Tomorrow" : `In ${a.days} days`}
                      </Badge>
                    </div>
                  </div>
                  <Btn small onClick={() => setDismissed([...dismissed, a.id])}>Dismiss</Btn>
                </div>
              </Card>
            ))}
          </div>
        )}
      </div>

      {/* Notification Settings */}
      <Card>
        <CardHeader title="Notification Settings" subtitle="Configure when and how alerts are sent" />
        <div style={{ padding: 16 }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
            {[
              { label: "COE Expiry — Early Warning", val: "90 days before", channel: "In-App + Email" },
              { label: "COE Expiry — Urgent Warning", val: "30 days before", channel: "In-App + Email" },
              { label: "Booking Starting Today", val: "Day of start", channel: "In-App" },
              { label: "Rental Ending Today", val: "Day of end", channel: "In-App" },
              { label: "Maintenance Pending", val: "2 days into maintenance", channel: "In-App" },
            ].map(n => (
              <div key={n.label} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 0", borderBottom: `1px solid ${C.border}` }}>
                <div>
                  <div style={{ fontSize: 12, fontWeight: 600, color: C.navy }}>{n.label}</div>
                  <div style={{ fontSize: 10.5, color: C.textMuted, marginTop: 2 }}>{n.val} · {n.channel}</div>
                </div>
                <div style={{ width: 36, height: 20, borderRadius: 10, background: C.teal, position: "relative", cursor: "pointer" }}>
                  <div style={{ width: 16, height: 16, borderRadius: "50%", background: "#fff", position: "absolute", top: 2, right: 2 }} />
                </div>
              </div>
            ))}
          </div>
        </div>
      </Card>
    </div>
  );
};

export default Alert;