'use client';

import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  BarElement,
  ArcElement,
  Title,
  Tooltip,
  Legend,
  Filler,
} from 'chart.js';
import { Line, Bar, Doughnut } from 'react-chartjs-2';

ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  BarElement,
  ArcElement,
  Title,
  Tooltip,
  Legend,
  Filler,
);

interface DaySeries {
  day: string;
  count: number;
}

interface LoginSeries {
  day: string;
  method: 'password' | 'huawei_sso';
  count: number;
}

interface Props {
  skillsByDay: DaySeries[];
  loginsByMethod: LoginSeries[];
  downloadsByDay: DaySeries[];
  reviewsByDay: DaySeries[];
  sourceDistribution: Array<{ type: string; count: number }>;
}

function labelsFor(series: DaySeries[]): string[] {
  return series.map((r) => r.day.slice(5));
}

const ACCENT = 'rgb(94, 90, 255)';
const EMERALD = 'rgb(63, 165, 119)';
const VIOLET = 'rgb(138, 111, 217)';
const STEEL = 'rgb(74, 111, 165)';
const WARN = 'rgb(197, 138, 46)';

export function DashboardCharts(props: Props) {
  // Build login chart: one line per method, aligned by day.
  const days = Array.from(new Set(props.loginsByMethod.map((r) => r.day))).sort();
  const password = days.map(
    (d) => props.loginsByMethod.find((r) => r.day === d && r.method === 'password')?.count ?? 0,
  );
  const sso = days.map(
    (d) => props.loginsByMethod.find((r) => r.day === d && r.method === 'huawei_sso')?.count ?? 0,
  );

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      <ChartBox title="Skill 发布趋势 (30天)">
        <Line
          data={{
            labels: labelsFor(props.skillsByDay),
            datasets: [
              {
                label: 'New skills',
                data: props.skillsByDay.map((r) => r.count),
                borderColor: ACCENT,
                backgroundColor: 'rgb(94, 90, 255, 0.12)',
                fill: true,
                tension: 0.3,
                pointRadius: 0,
              },
            ],
          }}
          options={chartOpts}
        />
      </ChartBox>
      <ChartBox title="登录趋势 (30天)">
        <Line
          data={{
            labels: days.map((d) => d.slice(5)),
            datasets: [
              {
                label: '邮箱密码',
                data: password,
                borderColor: ACCENT,
                tension: 0.3,
                pointRadius: 0,
              },
              {
                label: 'Huawei W3',
                data: sso,
                borderColor: STEEL,
                tension: 0.3,
                pointRadius: 0,
              },
            ],
          }}
          options={chartOpts}
        />
      </ChartBox>
      <ChartBox title="下载数 (30天)">
        <Bar
          data={{
            labels: labelsFor(props.downloadsByDay),
            datasets: [
              {
                label: 'Downloads',
                data: props.downloadsByDay.map((r) => r.count),
                backgroundColor: EMERALD,
                borderRadius: 4,
              },
            ],
          }}
          options={chartOpts}
        />
      </ChartBox>
      <ChartBox title="评论数 (30天)">
        <Bar
          data={{
            labels: labelsFor(props.reviewsByDay),
            datasets: [
              {
                label: 'Reviews',
                data: props.reviewsByDay.map((r) => r.count),
                backgroundColor: WARN,
                borderRadius: 4,
              },
            ],
          }}
          options={chartOpts}
        />
      </ChartBox>
      <ChartBox title="来源类型分布" small>
        <Doughnut
          data={{
            labels: props.sourceDistribution.map((s) => labelForType(s.type)),
            datasets: [
              {
                data: props.sourceDistribution.map((s) => s.count),
                backgroundColor: [STEEL, EMERALD, VIOLET],
                borderWidth: 0,
              },
            ],
          }}
          options={{
            plugins: {
              legend: { position: 'bottom' },
            },
          }}
        />
      </ChartBox>
    </div>
  );
}

function labelForType(t: string): string {
  if (t === 'internal') return '内部专用';
  if (t === 'user_uploaded') return '社区上传';
  if (t === 'external_curated') return '官方搬运';
  return t;
}

function ChartBox({
  title,
  children,
  small,
}: {
  title: string;
  children: React.ReactNode;
  small?: boolean;
}) {
  return (
    <div className="surface rounded-xl p-4">
      <h3 className="text-xs font-semibold uppercase tracking-wider text-muted">{title}</h3>
      <div className={small ? 'mt-2 h-44' : 'mt-2 h-52'}>{children}</div>
    </div>
  );
}

const chartOpts = {
  responsive: true,
  maintainAspectRatio: false,
  plugins: {
    legend: { display: true, position: 'bottom' as const, labels: { boxWidth: 10, font: { size: 11 } } },
    tooltip: { intersect: false, mode: 'index' as const },
  },
  scales: {
    x: { grid: { display: false }, ticks: { font: { size: 10 } } },
    y: { grid: { color: 'rgba(0,0,0,0.05)' }, ticks: { font: { size: 10 } } },
  },
};
