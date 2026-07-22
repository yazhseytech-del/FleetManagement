import { useState } from "react";
import { C, mono, fmt, totalInv } from "./theme";
import { Card, CardHeader, Btn, StatusTag, PlateBadge, KpiCard, MiniBar, PLRow } from "./components";

const PlReport = ({ fleet = [], bookings = [], earnings = [], expenses = [], calculateMetrics, calculateMonthlyMetrics, calculateCarMetrics }) => {
  const [view, setView] = useState("fleet");
  const [selectedCar, setSelectedCar] = useState(fleet.length > 0 ? fleet[0].plate : "");
  const [month, setMonth] = useState("2026-06");

  const monthLabel = {
    "2026-01": "January",
    "2026-02": "February",
    "2026-03": "March",
    "2026-04": "April",
    "2026-05": "May",
    "2026-06": "June",
    "2026-07": "July",
    "2026-08": "August",
    "2026-09": "September",
    "2026-10": "October",
    "2026-11": "November",
    "2026-12": "December",
  }[month] || month;

  const monthMetrics = calculateMonthlyMetrics(month);
  const metrics = calculateMetrics();

  // Calculate YTD
  const ytdMetrics = {
    income: earnings.reduce((s, e) => s + (e.total || 0), 0),
    expenses: expenses.reduce((s, e) => s + (e.amount || 0), 0),
    get profit() { return this.income - this.expenses; },
  };

  const MonthSelect = (
    <select value={month} onChange={e => setMonth(e.target.value)}
      style={{ padding: "8px 12px", borderRadius: 8, border: `1px solid ${C.border}`, fontFamily: "inherit", fontSize: 13, color: C.textPri, background: C.surface, outline: "none" }}>
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
  );

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <div>
          <div style={{ fontSize: 15, fontWeight: 700, color: C.navy }}>P&L Reports</div>
          <div style={{ fontSize: 11, color: C.textMuted }}>Profit & Loss by car or fleet</div>
        </div>
        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
          {MonthSelect}
          {["fleet", "per-car", "utilization"].map(v => (
            <button key={v} onClick={() => setView(v)} style={{
              padding: "6px 14px", borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: "pointer",
              border: `1px solid ${view === v ? C.teal : C.border}`,
              background: view === v ? C.teal : C.surface,
              color: view === v ? "#fff" : C.textSec, fontFamily: "inherit",
            }}>{v === "fleet" ? "Fleet Level" : v === "per-car" ? "Per Car" : "Utilization"}</button>
          ))}
          <Btn small>⬇ Export</Btn>
        </div>
      </div>

      {view === "fleet" ? (
        <div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 12, marginBottom: 16 }}>
            <KpiCard 
              label={`${monthLabel} Income`}
              value={fmt(monthMetrics.monthlyEarnings)}
              sub="All completed & active"
              accent={C.teal}
              badge={`${monthMetrics.monthlyBookings} bookings`}
              badgeColor={C.teal}
              badgeBg={C.tealFaint}
            />
            <KpiCard 
              label={`${monthLabel} Expenses`}
              value={fmt(monthMetrics.monthlyExpenses)}
              sub="All categories"
              accent={C.red}
              badge={`${expenses.filter(e => e.date?.startsWith(month)).length} items`}
              badgeColor={C.red}
              badgeBg={C.redFaint}
            />
            <KpiCard 
              label="Net P&L"
              value={fmt(monthMetrics.monthlyProfit)}
              sub="Income – Expenses"
              accent={C.green}
              badge={monthMetrics.monthlyProfit >= 0 ? "Profitable" : "Loss"}
              badgeColor={C.green}
              badgeBg={C.greenFaint}
            />
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
            <Card>
              <CardHeader title={`Fleet P&L — ${monthLabel}`} />
              <div style={{ padding: 16 }}>
                <PLRow label="Total Rental Income" value={`+${fmt(monthMetrics.monthlyEarnings)}`} positive={true} />
                <PLRow label="Total Expenses" value={`−${fmt(monthMetrics.monthlyExpenses)}`} positive={false} />
                <PLRow label={`Net P&L — ${monthLabel}`} value={`${monthMetrics.monthlyProfit >= 0 ? "+" : "−"}${fmt(Math.abs(monthMetrics.monthlyProfit))}`} positive={monthMetrics.monthlyProfit >= 0} bold divider />
                <div style={{ marginTop: 12 }}>
                  <PLRow label="YTD Income" value={fmt(ytdMetrics.income)} positive={true} />
                  <PLRow label="YTD Expenses" value={fmt(ytdMetrics.expenses)} positive={false} />
                  <PLRow label="YTD Net P&L" value={fmt(ytdMetrics.profit)} positive={ytdMetrics.profit >= 0} bold divider />
                </div>
              </div>
            </Card>

            <Card>
              <CardHeader title={`Per-Car Income — ${monthLabel}`} />
              <div style={{ padding: 16, maxHeight: 340, overflowY: "auto" }}>
                {fleet.map(c => {
                  const carEarnings = earnings.filter(e => e.plate === c.plate && e.start?.startsWith(month)).reduce((s, e) => s + (e.total || 0), 0);
                  const carExpenses = expenses.filter(e => e.plate === c.plate && e.date?.startsWith(month)).reduce((s, e) => s + (e.amount || 0), 0);
                  const net = carEarnings - carExpenses;
                  return (
                    <div key={c.plate} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 0", borderBottom: `1px solid ${C.border}` }}>
                      <PlateBadge plate={c.plate} small />
                      <div style={{ flex: 1, fontSize: 11, color: C.textMuted }}>{c.make} {c.model}</div>
                      <div style={{ ...mono, fontSize: 11, color: C.teal, minWidth: 55 }}>{carEarnings ? fmt(carEarnings) : "–"}</div>
                      <div style={{ ...mono, fontSize: 11, color: C.red, minWidth: 55 }}>{carExpenses ? `−${fmt(carExpenses)}` : "–"}</div>
                      <div style={{ ...mono, fontSize: 12, fontWeight: 700, color: net >= 0 ? C.green : C.red, minWidth: 55 }}>{net ? (net > 0 ? "+" : "") + fmt(net) : "–"}</div>
                    </div>
                  );
                })}
              </div>
            </Card>
          </div>
        </div>
      ) : view === "utilization" ? (
        <div>
          <Card>
            <CardHeader title={`Car Utilization — ${monthLabel}`} subtitle="Target vs actual running days per car" />
            <div style={{ padding: 16 }}>
              {fleet.length === 0 ? (
                <div style={{ textAlign: "center", color: C.textMuted, fontSize: 12, padding: 20 }}>No cars registered</div>
              ) : (
                fleet.map(c => {
                  const carBookings = bookings.filter(b => b.plate === c.plate && b.start?.startsWith(month));
                  const actualDays = carBookings.reduce((sum, b) => sum + Math.max(0, Math.round((new Date(b.end) - new Date(b.start)) / 86400000)), 0);
                  const targetDays = c.runningDaysTarget || 0;
                  const hasTarget = !!c.runningDaysTarget;
                  const pct = targetDays > 0 ? Math.round((actualDays / targetDays) * 100) : 0;
                  const color = pct >= 90 ? C.green : pct >= 60 ? C.amber : C.red;
                  return (
                    <div key={c.plate} style={{ marginBottom: 16, paddingBottom: 14, borderBottom: `1px solid ${C.border}` }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                          <PlateBadge plate={c.plate} small />
                          <span style={{ fontSize: 11, color: C.textMuted }}>{c.make} {c.model}</span>
                        </div>
                        {hasTarget ? (
                          <div style={{ display: "flex", gap: 16, alignItems: "baseline" }}>
                            <span style={{ fontSize: 10, color: C.textMuted }}>Target: <b style={{ ...mono, color: C.navy }}>{targetDays}d</b></span>
                            <span style={{ fontSize: 10, color: C.textMuted }}>Actual: <b style={{ ...mono, color: C.navy }}>{actualDays}d</b></span>
                            <span style={{ ...mono, fontSize: 13, fontWeight: 700, color }}>{pct}%</span>
                          </div>
                        ) : (
                          <span style={{ fontSize: 10, color: C.amber, fontWeight: 600 }}>⚠ No target set</span>
                        )}
                      </div>
                      {hasTarget && <MiniBar pct={Math.min(pct, 100)} color={color} />}
                    </div>
                  );
                })
              )}
            </div>
          </Card>
        </div>
      ) : (
        <div>
          <div style={{ marginBottom: 16 }}>
            <select value={selectedCar} onChange={e => setSelectedCar(e.target.value)}
              style={{ padding: "8px 12px", borderRadius: 8, border: `1px solid ${C.border}`, fontFamily: "inherit", fontSize: 13, color: C.textPri, background: C.surface, outline: "none" }}>
              {fleet.map(c => <option key={c.plate} value={c.plate}>{c.plate} — {c.make} {c.model}</option>)}
            </select>
          </div>
          {(() => {
            const car = fleet.find(c => c.plate === selectedCar);
            if (!car) return <div>No car selected</div>;

            const carEarnings = earnings.filter(e => e.plate === selectedCar && e.start?.startsWith(month)).reduce((s, e) => s + (e.total || 0), 0);
            const carExpenses = expenses.filter(e => e.plate === selectedCar && e.date?.startsWith(month)).reduce((s, e) => s + (e.amount || 0), 0);
            const net = carEarnings - carExpenses;
            const inv = totalInv(car);
            const totalCarEarnings = earnings.filter(e => e.plate === selectedCar).reduce((s, e) => s + (e.total || 0), 0);
            const recovery = inv > 0 ? Math.round((totalCarEarnings / inv) * 100) : 0;
            const monthBookings = bookings.filter(b => b.plate === selectedCar && b.start?.startsWith(month));

            return (
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
                <Card>
                  <CardHeader title={`P&L — ${car.make} ${car.model}`} subtitle={selectedCar}
                    right={<StatusTag status={car.status} />} />
                  <div style={{ padding: 16 }}>
                    <PLRow label={`Rental Income (${monthLabel})`} value={carEarnings ? `+${fmt(carEarnings)}` : "–"} positive={carEarnings > 0} />
                    <PLRow label={`Expenses (${monthLabel})`} value={carExpenses ? `−${fmt(carExpenses)}` : "–"} positive={carExpenses === 0} />
                    <PLRow label={`Net P&L (${monthLabel})`} value={net ? (net > 0 ? "+" : "") + fmt(net) : "–"} positive={net >= 0} bold divider />
                    <div style={{ marginTop: 12 }}>
                      <PLRow label="Total Investment" value={fmt(inv)} />
                      <PLRow label="Total Recovered" value={fmt(totalCarEarnings)} positive={true} />
                      <PLRow label="Recovery Progress" value={`${recovery}%`} bold divider />
                    </div>
                    <div style={{ marginTop: 12 }}>
                      <MiniBar pct={recovery} color={recovery >= 50 ? C.green : recovery >= 25 ? C.teal : C.amber} />
                    </div>
                  </div>
                </Card>
                <Card>
                  <CardHeader title="Booking History" subtitle={`${selectedCar} · ${monthLabel}`} />
                  <div style={{ padding: 16 }}>
                    {monthBookings.length === 0 ? (
                      <div style={{ color: C.textMuted, fontSize: 12 }}>No bookings recorded for {monthLabel}.</div>
                    ) : (
                      monthBookings.map(b => {
                        const days = Math.round((new Date(b.end) - new Date(b.start)) / 86400000);
                        return (
                          <div key={b.id} style={{ padding: "10px 0", borderBottom: `1px solid ${C.border}` }}>
                            <div style={{ display: "flex", justifyContent: "space-between" }}>
                              <div style={{ fontSize: 12, fontWeight: 600, color: C.navy }}>{b.customer}</div>
                              <div style={{ ...mono, fontSize: 12, fontWeight: 700, color: C.teal }}>{fmt(b.rate * days)}</div>
                            </div>
                            <div style={{ display: "flex", justifyContent: "space-between", marginTop: 3 }}>
                              <div style={{ fontSize: 10.5, color: C.textMuted }}>{b.start} → {b.end} · {days} days @ SGD {b.rate}/d</div>
                              <StatusTag status={b.status} />
                            </div>
                          </div>
                        );
                      })
                    )}
                  </div>
                </Card>
              </div>
            );
          })()}
        </div>
      )}
    </div>
  );
};

export default PlReport;