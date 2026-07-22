import { C, mono, fmt, totalInv, daysUntil } from "./theme";
import { Badge, StatusTag, PlateBadge, Card, CardHeader, Btn, KpiCard, Ring, PLRow } from "./components";

const Dashboard = ({ fleet, bookings, earnings, expenses, alerts, month, calculateMetrics, calculateMonthlyMetrics, calculateCarMetrics, getExpensesByCategory, calculateMonthlyTarget, calculateCarMonthlyTarget, calculateMonthlyBudget }) => {
  const metrics = calculateMetrics();
  const currentMonth = month || "2026-06"; // driven by the month dropdown in the topbar
  const isAllMonths = currentMonth === "all";

  const months = ["2026-01", "2026-02", "2026-03", "2026-04", "2026-05", "2026-06", "2026-07", "2026-08", "2026-09", "2026-10", "2026-11", "2026-12"];
  const monthLabels = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const currentMonthIdx = months.indexOf(currentMonth);
  const currentMonthLabel = isAllMonths ? "YTD" : (currentMonthIdx >= 0 ? monthLabels[currentMonthIdx] : currentMonth);

  // When "All Months" is selected, roll every month's numbers up into one YTD view instead
  // of a single month's slice.
  const monthMetrics = isAllMonths
    ? {
        monthlyEarnings: metrics.totalEarnings,
        monthlyExpenses: metrics.totalExpenses,
        monthlyProfit: metrics.netProfit,
        monthlyBookings: metrics.totalBookings,
        monthlyCustomers: metrics.uniqueCustomers,
      }
    : calculateMonthlyMetrics(currentMonth);

  // Monthly target is derived automatically from each car's remaining investment to recover,
  // its remaining COE runway, and its maintenance cost as of this month — not a fixed manual number.
  // For "All Months", it's the sum of every month's target so far THIS YEAR — up to the current
  // real-world month, not the full year (the dropdown lists Jan-Dec so future months can be
  // previewed individually, but "YTD" must stop at today, or it double-counts months that
  // haven't happened yet).
  const TODAY_MONTH = "2026-06"; // keep in sync with the fixed "today" reference in theme.js
  const ytdMonths = months.filter(m => m <= TODAY_MONTH);
  const monthlyTarget = isAllMonths
    ? ytdMonths.reduce((sum, m) => sum + calculateMonthlyTarget(m), 0)
    : calculateMonthlyTarget(currentMonth);
  const targetPercentage = monthlyTarget > 0 ? Math.round((monthMetrics.monthlyEarnings / monthlyTarget) * 100) : 0;

  // Monthly operating budget is derived automatically from each car's own maintenance %,
  // instead of a flat manual percentage of total fleet investment.
  const monthlyBudget = isAllMonths
    ? ytdMonths.reduce((sum, m) => sum + calculateMonthlyBudget(m), 0)
    : calculateMonthlyBudget(currentMonth);

  // Calculate YTD metrics
  const ytdMetrics = {
    income: earnings.reduce((sum, e) => sum + (e.total || 0), 0),
    expenses: expenses.reduce((sum, e) => sum + (e.amount || 0), 0),
    get profit() { return this.income - this.expenses; },
  };

  // Calculate per-car metrics for table
  const carMetricsForTable = fleet.map(car => {
    const metrics = calculateCarMetrics(car.plate);
    return { ...car, ...metrics };
  });

  // Calculate fleet recovery
  const totalFleetInvestment = fleet.reduce((sum, car) => sum + totalInv(car), 0);
  const totalFleetRecovered = earnings.reduce((sum, e) => sum + (e.total || 0), 0);
  const fleetRecoveryPct = totalFleetInvestment > 0 ? Math.round((totalFleetRecovered / totalFleetInvestment) * 100) : 0;

  // Expense breakdown by category — YTD uses every logged expense, otherwise just this month's
  const expensesByCategory = isAllMonths
    ? expenses.reduce((acc, e) => { acc[e.category] = (acc[e.category] || 0) + (e.amount || 0); return acc; }, {})
    : getExpensesByCategory(currentMonth);
  const totalExpensesMonth = Object.values(expensesByCategory).reduce((sum, amt) => sum + amt, 0);
  const expenseCategoryArray = Object.entries(expensesByCategory)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 5)
    .map(([category, amount]) => ({
      category,
      amount,
      pct: totalExpensesMonth > 0 ? Math.round((amount / totalExpensesMonth) * 100) : 0,
    }));

  // Active bookings
  const activeBookings = bookings.filter(b => b.status === "Active" || b.status === "Ending Today");

  // Recent alerts
  const recentAlerts = alerts;

  // Monthly earnings data for chart (Jan-Dec)
  const allEarnings = earnings.filter(e => e.start?.startsWith("2026"));

  const monthlyActual = months.map(month => {
    const monthTotal = allEarnings
      .filter(e => e.start?.startsWith(month))
      .reduce((sum, e) => sum + (e.total || 0), 0);
    const monthTarget = calculateMonthlyTarget(month);
    return monthTotal > 0 && monthTarget > 0 ? Math.round((monthTotal / monthTarget) * 100) : 0;
  });

  return (
    <div>
      {/* KPI Strip */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(5,1fr)", gap: 12, marginBottom: 20 }}>
        <KpiCard 
          label="Total Fleet" 
          value={metrics.totalFleet.toString()} 
          sub="Cars registered" 
          badge={`↑ ${metrics.activeFleet} active`}
          badgeColor={C.green} 
          badgeBg={C.greenFaint} 
          accent={C.teal} 
        />
        <KpiCard 
          label={`${currentMonthLabel} Earnings`}
          value={fmt(monthMetrics.monthlyEarnings)} 
          sub={`Target: ${fmt(Math.round(monthlyTarget))}`}
          badge={`${targetPercentage}% of target`}
          badgeColor={targetPercentage >= 80 ? C.green : targetPercentage >= 60 ? C.amber : C.red} 
          badgeBg={targetPercentage >= 80 ? C.greenFaint : targetPercentage >= 60 ? C.amberFaint : C.redFaint} 
          accent={C.green} 
        />
        <KpiCard 
          label="Active Rentals" 
          value={bookings.filter(b => b.status === "Active").length.toString()}
          sub={`${metrics.availableFleet} cars available`}
          badge={`${Math.round((metrics.activeFleet / metrics.totalFleet) * 100)}% occupancy`}
          badgeColor={C.green} 
          badgeBg={C.greenFaint} 
          accent={C.navyMid} 
        />
        <KpiCard 
          label={`${currentMonthLabel} Expenses`}
          value={fmt(monthMetrics.monthlyExpenses)} 
          sub={`Budget: ${fmt(Math.round(monthlyBudget))}`}
          badge={monthMetrics.monthlyExpenses < monthlyBudget ? "Under budget" : "Over budget"}
          badgeColor={monthMetrics.monthlyExpenses < monthlyBudget ? C.green : C.red} 
          badgeBg={monthMetrics.monthlyExpenses < monthlyBudget ? C.greenFaint : C.redFaint} 
          accent={C.amber} 
        />
        <KpiCard 
          label="COE Alerts" 
          value={alerts.filter(a => a.type === "coe").length.toString()}
          sub="Expiring soon"
          badge={alerts.filter(a => a.urgent).length > 0 ? "Action needed" : "OK"}
          badgeColor={alerts.filter(a => a.urgent).length > 0 ? C.red : C.green}
          badgeBg={alerts.filter(a => a.urgent).length > 0 ? C.redFaint : C.greenFaint}
          accent={C.red} 
        />
      </div>

      {/* Row 1 */}
      <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr", gap: 16, marginBottom: 16 }}>
        {/* Monthly Chart */}
        <Card>
          <CardHeader title="Monthly Earnings vs Target" subtitle="Jan – Jun 2026 · All Cars"
            right={<Badge>YTD: {fmt(ytdMetrics.income)}</Badge>} />
          <div style={{ padding: "16px 18px" }}>
            <div style={{ display: "flex", alignItems: "flex-end", gap: 8, height: 120, marginBottom: 8 }}>
              {monthLabels.map((m, i) => (
                <div key={m} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 3 }}>
                  <div style={{ display: "flex", gap: 2, alignItems: "flex-end", width: "100%", height: 100 }}>
                    <div style={{ flex: 1, height: `${100}%`, background: C.navyMid, opacity: 0.2, borderRadius: "3px 3px 0 0" }} />
                    <div style={{ flex: 1, height: `${monthlyActual[i]}%`, background: i === currentMonthIdx ? C.tealLight : C.teal, borderRadius: "3px 3px 0 0" }} />
                  </div>
                  <div style={{ fontSize: 9, color: i === currentMonthIdx ? C.teal : C.textMuted, fontWeight: i === currentMonthIdx ? 700 : 400 }}>{m}</div>
                </div>
              ))}
            </div>
            <div style={{ display: "flex", gap: 16, marginBottom: 12 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 10, color: C.textMuted }}>
                <div style={{ width: 8, height: 8, borderRadius: 2, background: C.teal }} /> Actual
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 10, color: C.textMuted }}>
                <div style={{ width: 8, height: 8, borderRadius: 2, background: C.navyMid, opacity: 0.4 }} /> Target
              </div>
            </div>
            <div style={{ borderTop: `1px solid ${C.border}`, paddingTop: 12, display: "flex", justifyContent: "space-between" }}>
              <div>
                <div style={{ fontSize: 10, color: C.textMuted }}>YTD Net P&L</div>
                <div style={{ ...mono, fontSize: 14, fontWeight: 700, color: ytdMetrics.profit >= 0 ? C.green : C.red }}>
                  {ytdMetrics.profit >= 0 ? "+" : "−"}{fmt(Math.abs(ytdMetrics.profit))}
                </div>
              </div>
              <div style={{ textAlign: "right" }}>
                <div style={{ fontSize: 10, color: C.textMuted }}>Fleet Recovery</div>
                <div style={{ ...mono, fontSize: 14, fontWeight: 700, color: C.navy }}>{fleetRecoveryPct}%</div>
              </div>
            </div>
          </div>
        </Card>

        {/* Active Bookings */}
        <Card>
          <CardHeader title="Active Bookings" subtitle={`Today · ${activeBookings.length} active`} right={<Badge>{activeBookings.length}</Badge>} />
          <div style={{ padding: "8px 18px 16px", maxHeight: 260, overflowY: "auto" }}>
            {activeBookings.length === 0 ? (
              <div style={{ padding: "20px", textAlign: "center", color: C.textMuted, fontSize: 12 }}>No active bookings</div>
            ) : (
              activeBookings.map(b => {
                const days = Math.round((new Date(b.end) - new Date(b.start)) / 86400000);
                return (
                  <div key={b.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 0", borderBottom: `1px solid ${C.border}` }}>
                    <div style={{ width: 7, height: 7, borderRadius: "50%", flexShrink: 0,
                      background: b.status === "Active" ? C.teal : b.status === "Ending Today" ? C.amber : C.navyMid }} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 12, fontWeight: 600, color: C.navy, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{b.customer}</div>
                      <div style={{ fontSize: 10, color: C.textMuted, marginTop: 1, display: "flex", alignItems: "center", gap: 4 }}>
                        <PlateBadge plate={b.plate} small /> {b.start.slice(5)} – {b.end.slice(5)}
                      </div>
                    </div>
                    <div style={{ ...mono, fontSize: 12, fontWeight: 700, color: C.teal, flexShrink: 0 }}>{fmt(b.rate * days)}</div>
                  </div>
                );
              })
            )}
          </div>
        </Card>

        {/* Alerts */}
        <Card>
          <CardHeader title="Alerts" subtitle="Requires attention"
            right={<Badge color={C.red} bg={C.redFaint}>{alerts.length}</Badge>} />
          <div style={{ padding: "8px 18px 16px", maxHeight: 260, overflowY: "auto" }}>
            {recentAlerts.length === 0 ? (
              <div style={{ padding: "20px", textAlign: "center", color: C.textMuted, fontSize: 12 }}>No active alerts</div>
            ) : (
              recentAlerts.map(a => (
                <div key={a.id} style={{ display: "flex", alignItems: "flex-start", gap: 10, padding: "10px 0", borderBottom: `1px solid ${C.border}` }}>
                  <div style={{ fontSize: 18, flexShrink: 0 }}>{a.type === "coe" ? "⚠️" : a.type === "return" ? "🔔" : "📋"}</div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 12, fontWeight: 600, color: C.navy }}>
                      {a.type === "coe" ? `COE Expiry — ${a.plate}` : a.type === "return" ? "Return Today" : "Booking"}
                    </div>
                    <div style={{ fontSize: 10.5, color: C.textMuted, marginTop: 2 }}>{a.msg}</div>
                  </div>
                  <div style={{ ...mono, fontSize: 11, fontWeight: 700, padding: "3px 7px", borderRadius: 6, flexShrink: 0, alignSelf: "center",
                    background: a.urgent ? C.redFaint : C.amberFaint, color: a.urgent ? C.red : C.amber }}>
                    {a.days === 0 ? "Today" : `${a.days}d`}
                  </div>
                </div>
              ))
            )}
          </div>
        </Card>
      </div>

      {/* Row 2: Fleet Table + Recovery Rings */}
      <div style={{ display: "grid", gridTemplateColumns: "3fr 2fr", gap: 16, marginBottom: 16 }}>
        <Card>
          <CardHeader title="Fleet Overview" subtitle={`All ${fleet.length} registered cars`} right={<Btn small>View Fleet →</Btn>} />
          <div style={{ maxHeight: 340, overflowY: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ background: C.bg }}>
                {["Plate","Car","Status","Investment","COE Expiry","Month Earned","Recovery"].map(h => (
                  <th key={h} style={{ textAlign: "left", padding: "8px 12px", fontSize: 10, fontWeight: 600, color: C.textMuted, textTransform: "uppercase", letterSpacing: 0.6, borderBottom: `1px solid ${C.border}`, position: "sticky", top: 0, background: C.bg }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {carMetricsForTable.map((c) => {
                const d = daysUntil(c.coe);
                return (
                  <tr key={c.plate} style={{ borderBottom: `1px solid ${C.border}` }}>
                    <td style={{ padding: "10px 12px" }}><PlateBadge plate={c.plate} /></td>
                    <td style={{ padding: "10px 12px" }}>
                      <div style={{ fontSize: 12, fontWeight: 600 }}>{c.make}</div>
                      <div style={{ fontSize: 10, color: C.textMuted }}>{c.model}</div>
                    </td>
                    <td style={{ padding: "10px 12px" }}><StatusTag status={c.status} /></td>
                    <td style={{ padding: "10px 12px", ...mono, fontSize: 11 }}>{fmt(c.investment)}</td>
                    <td style={{ padding: "10px 12px", fontSize: 11, color: d < 30 ? C.red : d < 90 ? C.amber : C.textMuted, fontWeight: d < 90 ? 700 : 400 }}>
                      {c.coe} {d < 30 ? "⚠" : d < 90 ? "⚡" : ""}
                    </td>
                    <td style={{ padding: "10px 12px", ...mono, fontSize: 12, fontWeight: 700, color: C.green }}>{fmt(c.earnings)}</td>
                    <td style={{ padding: "10px 12px", display: "flex", alignItems: "center", gap: 8 }}>
                      <div style={{ width: 40, height: 4, background: C.bg, borderRadius: 2, overflow: "hidden" }}>
                        <div style={{ width: `${c.recoveryPct}%`, height: "100%", background: c.recoveryPct >= 50 ? C.green : c.recoveryPct >= 25 ? C.amber : C.red }} />
                      </div>
                      <span style={{ ...mono, fontSize: 10, fontWeight: 700, minWidth: 25 }}>{c.recoveryPct}%</span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          </div>
        </Card>

        <Card>
          <CardHeader title="Recovery Progress" />
          <div style={{ padding: 16 }}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 14, maxHeight: 260, overflowY: "auto" }}>
              {fleet.map(car => {
                const carMetrics = calculateCarMetrics(car.plate);
                return (
                  <Ring 
                    key={car.plate}
                    pct={carMetrics.recoveryPct} 
                    color={carMetrics.recoveryPct >= 50 ? C.green : carMetrics.recoveryPct >= 25 ? C.amber : C.red}
                    plate={car.plate} 
                    model={car.model}
                    note={`COE: ${daysUntil(car.coe)}d`}
                    noteColor={daysUntil(car.coe) < 30 ? C.red : undefined}
                  />
                );
              })}
            </div>
            <div style={{ background: C.bg, borderRadius: 8, padding: 12 }}>
              <div style={{ fontSize: 10, color: C.textMuted, fontWeight: 600, textTransform: "uppercase", letterSpacing: 0.6, marginBottom: 6 }}>Fleet Total Recovery</div>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <div style={{ flex: 1, height: 10, background: C.border, borderRadius: 5, overflow: "hidden" }}>
                  <div style={{ width: `${fleetRecoveryPct}%`, height: "100%", background: `linear-gradient(90deg, ${C.teal}, ${C.tealLight})`, borderRadius: 5 }} />
                </div>
                <span style={{ ...mono, fontSize: 13, fontWeight: 700, color: C.navy }}>{fleetRecoveryPct}%</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", marginTop: 6, fontSize: 10, color: C.textMuted }}>
                <span>Recovered: <b style={{ color: C.teal }}>{fmt(totalFleetRecovered)}</b></span>
                <span>Total: <b style={{ color: C.navy }}>{fmt(totalFleetInvestment)}</b></span>
              </div>
            </div>
          </div>
        </Card>
      </div>

      {/* Row 3: Target vs Actual + Expense Breakdown + P&L */}
      <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr", gap: 16 }}>
        {/* Target vs Actual — per car */}
        <Card>
          <CardHeader
            title={`Target vs Actual — ${currentMonthLabel}`}
            subtitle="Per car rental performance"
            right={
              <div style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 10.5, color: C.textMuted }}>
                <div style={{ width: 12, height: 2, background: C.amber, borderRadius: 1 }} />
                Target
              </div>
            }
          />
          <div style={{ padding: 16, maxHeight: 340, overflowY: "auto" }}>
            {(() => {
              // Compute actual + target for every car first so they can share one
              // horizontal scale — this is what makes the target tick land at each
              // car's own target dollar amount (not always the track's right edge),
              // matching the reference layout where higher-target cars' ticks sit
              // further along the bar.
              const rows = fleet.map(car => {
                const carActual = isAllMonths
                  ? earnings.filter(e => e.plate === car.plate).reduce((s, e) => s + (e.total || 0), 0)
                  : earnings.filter(e => e.plate === car.plate && e.start?.startsWith(currentMonth)).reduce((s, e) => s + (e.total || 0), 0);
                // Target comes straight from the car's own saved target (set when the
                // car was added, or via "Set Target") — target income = targetRate ×
                // runningDaysTarget. Never a guess.
                const hasTarget = !!(car.targetRate && car.runningDaysTarget);
                const monthlyTarget = hasTarget ? car.targetRate * car.runningDaysTarget : 0;
                const carTarget = isAllMonths ? monthlyTarget * months.length : monthlyTarget;
                const pct = carTarget > 0 ? Math.round((carActual / carTarget) * 100) : 0;
                return { car, carActual, carTarget, hasTarget, pct };
              });
              // Shared scale = the largest target or actual across the list, with a
              // little headroom, so every row's bar/tick is comparable at a glance.
              const scaleMax = Math.max(1, ...rows.map(r => Math.max(r.carTarget, r.carActual))) * 1.08;

              return rows.map(({ car, hasTarget, carTarget, carActual, pct }) => {
                const pctColor = pct >= 80 ? C.green : pct >= 50 ? C.amber : C.red;
                const targetTickPos = hasTarget ? Math.min((carTarget / scaleMax) * 100, 100) : 0;
                const actualFillPos = hasTarget ? Math.min((carActual / scaleMax) * 100, 100) : 0;
                return (
                  <div key={car.plate} style={{ marginBottom: 14 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", marginBottom: 5 }}>
                      <div>
                        <div style={{ ...mono, fontSize: 11, fontWeight: 700, color: C.navy }}>{car.plate}</div>
                        <div style={{ fontSize: 10, color: C.textMuted }}>{car.model}</div>
                      </div>
                      {hasTarget ? (
                        pct > 100 ? (
                          <div style={{ ...mono, fontSize: 12, fontWeight: 700, color: C.green }}>100%+ ✓</div>
                        ) : (
                          <div style={{ ...mono, fontSize: 13, fontWeight: 700, color: pctColor }}>{pct}%</div>
                        )
                      ) : (
                        <div style={{ fontSize: 9.5, color: C.amber, fontWeight: 600 }}>⚠ No target</div>
                      )}
                    </div>
                    <div style={{ position: "relative", height: 7, background: C.bg, borderRadius: 4, overflow: "hidden" }}>
                      {hasTarget && (
                        <div style={{ width: `${actualFillPos}%`, height: "100%", background: pctColor, borderRadius: 4 }} />
                      )}
                      {/* Target tick — placed at this car's own target amount on the shared scale */}
                      {hasTarget && (
                        <div style={{ position: "absolute", top: -1, bottom: -1, left: `${targetTickPos}%`, width: 2, background: C.amber }} />
                      )}
                    </div>
                  </div>
                );
              });
            })()}
          </div>
        </Card>

        {/* Expense Breakdown */}
        <Card>
          <CardHeader title={`Expense Breakdown — ${currentMonthLabel} 2026`} subtitle="By category" right={<Badge>{fmt(totalExpensesMonth)}</Badge>} />
          <div style={{ padding: 16 }}>
            {expenseCategoryArray.length === 0 ? (
              <div style={{ textAlign: "center", color: C.textMuted, fontSize: 12, padding: "20px" }}>No expenses recorded</div>
            ) : (
              <>
                <svg width="100%" height={110} viewBox="0 0 110 110" style={{ display: "block", margin: "0 auto 12px" }}>
                  {expenseCategoryArray.reduce((acc, seg, i, arr) => {
                    const circ = 2 * Math.PI * 38;
                    const offset = -acc.offset;
                    const colors = [C.teal, C.navyMid, C.amber, C.green, C.textMuted];
                    const dash = circ * seg.pct / 100;
                    acc.els.push(
                      <circle key={i} cx={55} cy={55} r={38} fill="none" stroke={colors[i] || C.textMuted} strokeWidth={18}
                        strokeDasharray={`${dash} ${circ}`} strokeDashoffset={offset} transform="rotate(-90 55 55)" />
                    );
                    acc.offset -= dash;
                    return acc;
                  }, { els: [], offset: 0 }).els}
                  <circle cx={55} cy={55} r={27} fill="white" />
                  <text x={55} y={52} textAnchor="middle" fontFamily="'Courier New',monospace" fontSize={9} fontWeight={700} fill={C.navy}>{fmt(totalExpensesMonth)}</text>
                  <text x={55} y={62} textAnchor="middle" fontFamily="inherit" fontSize={7} fill={C.textMuted}>total</text>
                </svg>
                {expenseCategoryArray.map((e, i) => {
                  const colors = [C.teal, C.navyMid, C.amber, C.green, C.textMuted];
                  return (
                    <div key={e.category} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 7 }}>
                      <div style={{ width: 9, height: 9, borderRadius: 2, background: colors[i] || C.textMuted, flexShrink: 0 }} />
                      <div style={{ fontSize: 11, color: C.textSec, flex: 1 }}>{e.category}</div>
                      <div style={{ width: 40, height: 4, background: C.bg, borderRadius: 2, overflow: "hidden" }}>
                        <div style={{ width: `${e.pct}%`, height: "100%", background: colors[i] || C.textMuted, borderRadius: 2 }} />
                      </div>
                      <div style={{ ...mono, fontSize: 11, fontWeight: 600, minWidth: 50, textAlign: "right" }}>{fmt(e.amount)}</div>
                    </div>
                  );
                })}
              </>
            )}
          </div>
        </Card>

        {/* P&L Summary */}
        <Card>
          <CardHeader title="P&L Summary" subtitle={`${currentMonthLabel} 2026 · Fleet`} />
          <div style={{ padding: 16 }}>
            <PLRow label="Total Rental Income" value={`+${fmt(monthMetrics.monthlyEarnings)}`} positive={true} />
            <PLRow label="Total Expenses" value={`−${fmt(monthMetrics.monthlyExpenses)}`} positive={false} />
            <PLRow label={`Net P&L — ${currentMonthLabel}`} value={`${monthMetrics.monthlyProfit >= 0 ? "+" : "−"}${fmt(Math.abs(monthMetrics.monthlyProfit))}`} positive={monthMetrics.monthlyProfit >= 0} bold divider />
            <div style={{ marginTop: 12, padding: 10, background: monthMetrics.monthlyProfit >= 0 ? C.greenFaint : C.redFaint, borderRadius: 8, borderLeft: `3px solid ${monthMetrics.monthlyProfit >= 0 ? C.green : C.red}` }}>
              <div style={{ fontSize: 10, color: monthMetrics.monthlyProfit >= 0 ? C.green : C.red, fontWeight: 700 }}>
                {monthMetrics.monthlyProfit >= 0 ? "↑" : "↓"} Profitable
              </div>
              <div style={{ fontSize: 10, color: C.textMuted, marginTop: 2 }}>This month's performance</div>
            </div>
            <div style={{ marginTop: 10, padding: 10, background: C.bg, borderRadius: 8 }}>
              <div style={{ fontSize: 10, color: C.textMuted, marginBottom: 4, fontWeight: 600 }}>YTD Progress</div>
              <PLRow label="Total Income YTD" value={fmt(ytdMetrics.income)} />
              <PLRow label="Total Expense YTD" value={fmt(ytdMetrics.expenses)} positive={false} />
              <PLRow label="Net YTD" value={`${ytdMetrics.profit >= 0 ? "+" : "−"}${fmt(Math.abs(ytdMetrics.profit))}`} positive={ytdMetrics.profit >= 0} bold divider />
            </div>
          </div>
        </Card>

      </div>
    </div>
  );
};

export default Dashboard;