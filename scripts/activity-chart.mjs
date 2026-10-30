// 가입일부터 오늘까지의 기여 수를 월별로 모아 막대그래프 SVG 로 그린다.
// GitHub 기여 API(contributionsCollection)는 한 번에 1년까지만 조회되므로 1년씩 나눠 받는다.
//
// 사용: GITHUB_TOKEN=... USERNAME=HiSoo38 node scripts/activity-chart.mjs <출력 경로>
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

const token = process.env.GITHUB_TOKEN;
const username = process.env.USERNAME;
const outPath = process.argv[2] ?? "activity-all-time.svg";
if (!token || !username) throw new Error("GITHUB_TOKEN 과 USERNAME 환경변수가 필요하다");

// 다른 통계 카드(tokyonight 테마)와 같은 톤
const COLOR = {
  bg: "#1a1b27",
  border: "#2a2e42",
  title: "#c0caf5",
  text: "#a9b1d6",
  muted: "#565f89",
  grid: "#2a2e42",
  bar: "#7aa2f7",
  barPeak: "#bb9af7",
};

async function graphql(query, variables) {
  const res = await fetch("https://api.github.com/graphql", {
    method: "POST",
    headers: { Authorization: `bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query, variables }),
  });
  const json = await res.json();
  if (!res.ok || json.errors) throw new Error(JSON.stringify(json.errors ?? json));
  return json.data;
}

// 가입일 ~ 오늘을 1년 이하 구간으로 잘라 일별 기여 수를 모은다
async function fetchDailyCounts() {
  const { user } = await graphql(`query($login:String!){ user(login:$login){ createdAt } }`, { login: username });
  const start = new Date(user.createdAt);
  const end = new Date();
  const days = new Map();

  for (let from = start; from < end; ) {
    const next = new Date(from);
    next.setUTCFullYear(next.getUTCFullYear() + 1);
    const to = next < end ? next : end;
    const data = await graphql(
      `query($login:String!,$from:DateTime!,$to:DateTime!){
        user(login:$login){ contributionsCollection(from:$from,to:$to){
          contributionCalendar{ weeks{ contributionDays{ date contributionCount } } } } } }`,
      { login: username, from: from.toISOString(), to: to.toISOString() },
    );
    for (const week of data.user.contributionsCollection.contributionCalendar.weeks) {
      for (const day of week.contributionDays) days.set(day.date, day.contributionCount);
    }
    from = to;
  }
  return { start, end, days };
}

// 가입한 달부터 이번 달까지 빈 달 없이 월별 합계를 만든다
function toMonthly({ start, end, days }) {
  const months = [];
  const cursor = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), 1));
  while (cursor <= end) {
    months.push({ year: cursor.getUTCFullYear(), month: cursor.getUTCMonth() + 1, count: 0 });
    cursor.setUTCMonth(cursor.getUTCMonth() + 1);
  }
  const index = new Map(months.map((m, i) => [`${m.year}-${String(m.month).padStart(2, "0")}`, i]));
  for (const [date, count] of days) {
    const i = index.get(date.slice(0, 7));
    if (i !== undefined) months[i].count += count;
  }
  return months;
}

// 축 눈금이 보기 좋은 값(1·2·5 × 10^n)이 되도록 최대값을 올림한다
function niceMax(value) {
  if (value <= 0) return 4;
  const pow = 10 ** Math.floor(Math.log10(value));
  const step = [1, 2, 5, 10].find((s) => s * pow >= value / 4) * pow;
  return Math.ceil(value / step) * step;
}

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;");
const fmt = (n) => n.toLocaleString("en-US");
const r1 = (n) => Math.round(n * 10) / 10; // SVG 좌표는 소수 한 자리면 충분하다

// 위쪽 모서리만 둥근 막대 (아래는 기준선에 붙는다)
function barPath(x, y, w, h, r) {
  const rr = Math.min(r, w / 2, h);
  const [L, R, T, B] = [x, x + w, y, y + h].map(r1);
  return `M${L},${B}V${r1(y + rr)}Q${L},${T} ${r1(x + rr)},${T}H${r1(x + w - rr)}Q${R},${T} ${R},${r1(y + rr)}V${B}Z`;
}

function render(months) {
  const W = 860, H = 300;
  const plot = { left: 48, right: W - 24, top: 92, bottom: H - 44 };
  const plotW = plot.right - plot.left, plotH = plot.bottom - plot.top;

  const total = months.reduce((s, m) => s + m.count, 0);
  const max = niceMax(Math.max(...months.map((m) => m.count)));
  const peak = months.reduce((a, b) => (b.count > a.count ? b : a));
  const yearTotals = [...new Set(months.map((m) => m.year))].map((year) => ({
    year,
    count: months.filter((m) => m.year === year).reduce((s, m) => s + m.count, 0),
  }));

  const slot = plotW / months.length;
  const barW = Math.max(2, slot - 2); // 막대 사이 2px 간격
  const y = (v) => plot.bottom - (v / max) * plotH;
  const first = months[0], last = months.at(-1);
  const period = `${first.year}.${String(first.month).padStart(2, "0")} – ${last.year}.${String(last.month).padStart(2, "0")}`;

  const out = [];
  out.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="Segoe UI, Ubuntu, sans-serif" role="img" aria-label="${esc(`${username} 전체 기간 월별 기여 — ${period}, 총 ${fmt(total)}`)}">`);
  out.push(`<rect x="0.5" y="0.5" width="${W - 1}" height="${H - 1}" rx="6" fill="${COLOR.bg}" stroke="${COLOR.border}"/>`);

  // 제목 · 기간 · 총합
  out.push(`<text x="24" y="38" fill="${COLOR.title}" font-size="18" font-weight="600">All-time Activity</text>`);
  out.push(`<text x="24" y="62" fill="${COLOR.text}" font-size="13">${period} · <tspan fill="${COLOR.title}" font-weight="600">${fmt(total)}</tspan> contributions</text>`);

  // 연도별 합계 (오른쪽 위)
  let tx = W - 24;
  for (const { year, count } of [...yearTotals].reverse()) {
    const label = `${year}  ${fmt(count)}`;
    out.push(`<text x="${tx}" y="62" text-anchor="end" fill="${COLOR.text}" font-size="12"><tspan fill="${COLOR.muted}">${year}</tspan>  ${fmt(count)}</text>`);
    tx -= label.length * 7 + 18;
  }

  // 가로 눈금선 4칸
  for (let i = 0; i <= 4; i++) {
    const v = (max / 4) * i, gy = y(v);
    out.push(`<line x1="${plot.left}" x2="${plot.right}" y1="${gy}" y2="${gy}" stroke="${COLOR.grid}" stroke-width="1"/>`);
    out.push(`<text x="${plot.left - 8}" y="${gy + 4}" text-anchor="end" fill="${COLOR.muted}" font-size="11">${fmt(v)}</text>`);
  }

  // 월별 막대 + 연도 경계 표시
  months.forEach((m, i) => {
    const x = plot.left + i * slot + (slot - barW) / 2;
    if (m.count > 0) {
      const h = plot.bottom - y(m.count);
      const fill = m === peak ? COLOR.barPeak : COLOR.bar;
      out.push(`<path d="${barPath(x, y(m.count), barW, h, 4)}" fill="${fill}"><title>${m.year}.${String(m.month).padStart(2, "0")} — ${fmt(m.count)}</title></path>`);
    }
    if (i === 0 || m.month === 1) {
      const lx = r1(plot.left + i * slot);
      out.push(`<line x1="${lx}" x2="${lx}" y1="${plot.bottom}" y2="${plot.bottom + 6}" stroke="${COLOR.muted}"/>`);
      out.push(`<text x="${lx + 2}" y="${plot.bottom + 20}" fill="${COLOR.text}" font-size="12">${m.year}</text>`);
    }
  });

  // 가장 많았던 달에만 값 표시
  if (peak.count > 0) {
    const i = months.indexOf(peak);
    const cx = r1(plot.left + i * slot + slot / 2);
    const anchor = cx > plot.right - 60 ? "end" : cx < plot.left + 60 ? "start" : "middle";
    out.push(`<text x="${cx}" y="${y(peak.count) - 8}" text-anchor="${anchor}" fill="${COLOR.title}" font-size="12" font-weight="600">${fmt(peak.count)} (${peak.year}.${String(peak.month).padStart(2, "0")})</text>`);
  }

  out.push(`</svg>`);
  return out.join("\n");
}

const months = toMonthly(await fetchDailyCounts());
mkdirSync(dirname(outPath) || ".", { recursive: true });
writeFileSync(outPath, render(months));
console.log(`${outPath}: ${months.length}개월, 총 ${months.reduce((s, m) => s + m.count, 0)}`);
