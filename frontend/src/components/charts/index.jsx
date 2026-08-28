import { useEffect, useState } from 'react';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { EmptyState, TableWrap, Td, Th } from '../ui/index.jsx';

/**
 * Charts.
 *
 * Three rules applied throughout:
 *
 * 1. Colours are read from the CSS theme variables, not hardcoded, so charts
 *    re-theme with the rest of the app instead of staying dark in light mode.
 * 2. Series are distinguished by line STYLE as well as hue, so they remain
 *    readable without colour.
 * 3. Every chart ships a keyboard-reachable table of the same data. A chart on
 *    its own is invisible to a screen reader.
 */

/** Read a theme token's current value. Re-read on theme change, never cached. */
function useThemeColors() {
  const read = () => {
    if (typeof window === 'undefined') return {};
    const s = getComputedStyle(document.documentElement);
    const get = (name, fallback) => s.getPropertyValue(name).trim() || fallback;
    return {
      brand: get('--rai-brand', '#0ea5e9'),
      low: get('--rai-low', '#16a34a'),
      medium: get('--rai-medium', '#f59e0b'),
      high: get('--rai-high', '#dc2626'),
      escalated: get('--rai-escalated', '#38bdf8'),
      grid: get('--rai-border', '#334155'),
      text: get('--rai-fg-muted', '#cbd5e1'),
      surface: get('--rai-surface', '#111827'),
    };
  };

  const [colors, setColors] = useState(read);

  useEffect(() => {
    const update = () => setColors(read());
    // The theme toggle flips a class on <html>; watch for it rather than
    // requiring every chart's parent to pass the theme down.
    const observer = new MutationObserver(update);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    media.addEventListener('change', update);
    return () => {
      observer.disconnect();
      media.removeEventListener('change', update);
    };
  }, []);

  return colors;
}

const tooltipStyle = (c) => ({
  contentStyle: {
    background: c.surface,
    border: `1px solid ${c.grid}`,
    borderRadius: 6,
    fontSize: 12,
    color: c.text,
  },
  labelStyle: { color: c.text },
  cursor: { fill: c.grid, fillOpacity: 0.2 },
});

const axisProps = (c) => ({
  stroke: c.grid,
  tick: { fill: c.text, fontSize: 11 },
  tickLine: false,
});

/** Accessible equivalent of a chart. Collapsed by default so it does not
 *  compete visually, but always in the DOM and reachable by keyboard. */
function DataTable({ caption, columns, rows }) {
  return (
    <details className="mt-2 group">
      <summary className="cursor-pointer text-xs text-fg-muted hover:text-fg">
        View data as table
      </summary>
      <TableWrap className="mt-2">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr>
            {columns.map((c) => (
              <Th key={c}>{c}</Th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i}>
              {row.map((cell, j) => (
                <Td key={j} className="font-mono text-xs">
                  {cell}
                </Td>
              ))}
            </tr>
          ))}
        </tbody>
      </TableWrap>
    </details>
  );
}

/**
 * Risk distribution. A horizontal bar, not a pie: three categories being
 * compared by magnitude is exactly what bars are for, and a pie would make
 * "5 vs 6" a guess.
 */
export function RiskDistributionChart({ data = [] }) {
  const c = useThemeColors();
  const total = data.reduce((s, d) => s + d.open, 0);

  if (!total) {
    return <EmptyState title="No customers at risk" description="Run a simulator scenario to generate incident data." />;
  }

  const fill = { HIGH: c.high, MEDIUM: c.medium, LOW: c.low };

  return (
    <div>
      <ResponsiveContainer width="100%" height={160}>
        <BarChart data={data} layout="vertical" margin={{ left: 8, right: 16, top: 4, bottom: 4 }}>
          <CartesianGrid horizontal={false} stroke={c.grid} strokeOpacity={0.4} />
          <XAxis type="number" allowDecimals={false} {...axisProps(c)} />
          <YAxis type="category" dataKey="level" width={64} {...axisProps(c)} />
          <Tooltip {...tooltipStyle(c)} formatter={(v) => [v, 'Open cases']} />
          <Bar dataKey="open" radius={[0, 4, 4, 0]} barSize={22}>
            {data.map((d) => (
              <Cell key={d.level} fill={fill[d.level]} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
      <DataTable
        caption="Open customer cases by risk level"
        columns={['Risk level', 'Open', 'Total']}
        rows={data.map((d) => [d.level, d.open, d.total])}
      />
    </div>
  );
}

/**
 * Resolution trend. Solid vs dashed distinguishes the series, so the chart
 * still reads correctly in greyscale or for a colour-blind viewer.
 */
export function ResolutionTrendChart({ data = [] }) {
  const c = useThemeColors();
  if (!data.length) return <EmptyState title="No activity yet" description="Resolution history will appear here." />;

  return (
    <div>
      <ResponsiveContainer width="100%" height={220}>
        <LineChart data={data} margin={{ left: 0, right: 12, top: 8, bottom: 4 }}>
          <CartesianGrid stroke={c.grid} strokeOpacity={0.4} vertical={false} />
          <XAxis dataKey="date" tickFormatter={(d) => d.slice(5)} {...axisProps(c)} minTickGap={16} />
          <YAxis allowDecimals={false} width={32} {...axisProps(c)} />
          <Tooltip {...tooltipStyle(c)} />
          <Legend wrapperStyle={{ fontSize: 12, color: c.text }} />
          <Line
            type="monotone"
            dataKey="resolved"
            name="Resolved"
            stroke={c.low}
            strokeWidth={2}
            dot={false}
          />
          <Line
            type="monotone"
            dataKey="escalated"
            name="Escalated"
            stroke={c.escalated}
            strokeWidth={2}
            strokeDasharray="5 3"
            dot={false}
          />
          <Line
            type="monotone"
            dataKey="atRisk"
            name="New at risk"
            stroke={c.medium}
            strokeWidth={2}
            strokeDasharray="2 3"
            dot={false}
          />
        </LineChart>
      </ResponsiveContainer>
      <DataTable
        caption="Resolution activity by day"
        columns={['Date', 'Resolved', 'Escalated', 'New at risk']}
        rows={data.map((d) => [d.date, d.resolved, d.escalated, d.atRisk])}
      />
    </div>
  );
}

/** Cumulative tickets avoided — an area, because the story is accumulation. */
export function TicketsAvoidedChart({ data = [] }) {
  const c = useThemeColors();
  if (!data.length) return <EmptyState title="No data yet" description="Resolve an incident to start the count." />;

  return (
    <div>
      <ResponsiveContainer width="100%" height={200}>
        <AreaChart data={data} margin={{ left: 0, right: 12, top: 8, bottom: 4 }}>
          <defs>
            <linearGradient id="avoidedFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={c.brand} stopOpacity={0.35} />
              <stop offset="100%" stopColor={c.brand} stopOpacity={0.02} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke={c.grid} strokeOpacity={0.4} vertical={false} />
          <XAxis dataKey="date" tickFormatter={(d) => d.slice(5)} {...axisProps(c)} minTickGap={16} />
          <YAxis allowDecimals={false} width={32} {...axisProps(c)} />
          <Tooltip {...tooltipStyle(c)} formatter={(v) => [v, 'Cumulative']} />
          <Area
            type="monotone"
            dataKey="cumulativeAvoided"
            name="Tickets avoided"
            stroke={c.brand}
            strokeWidth={2}
            fill="url(#avoidedFill)"
          />
        </AreaChart>
      </ResponsiveContainer>
      <DataTable
        caption="Cumulative estimated tickets avoided"
        columns={['Date', 'Resolved that day', 'Cumulative']}
        rows={data.map((d) => [d.date, d.resolved, d.cumulativeAvoided])}
      />
    </div>
  );
}

/** Generic category bar, used for incident type and resolution mix. */
export function CategoryBarChart({ data = [], label = 'Count', color = 'brand' }) {
  const c = useThemeColors();
  if (!data.length) return <EmptyState title="No data yet" />;

  return (
    <div>
      <ResponsiveContainer width="100%" height={Math.max(140, data.length * 34)}>
        <BarChart data={data} layout="vertical" margin={{ left: 8, right: 16, top: 4, bottom: 4 }}>
          <CartesianGrid horizontal={false} stroke={c.grid} strokeOpacity={0.4} />
          <XAxis type="number" allowDecimals={false} {...axisProps(c)} />
          <YAxis
            type="category"
            dataKey="name"
            width={130}
            {...axisProps(c)}
            tickFormatter={(v) => String(v).replace(/_/g, ' ').toLowerCase()}
          />
          <Tooltip {...tooltipStyle(c)} formatter={(v) => [v, label]} />
          <Bar dataKey="value" fill={c[color] ?? c.brand} radius={[0, 4, 4, 0]} barSize={18} />
        </BarChart>
      </ResponsiveContainer>
      <DataTable
        caption={label}
        columns={['Category', label]}
        rows={data.map((d) => [String(d.name).replace(/_/g, ' '), d.value])}
      />
    </div>
  );
}
