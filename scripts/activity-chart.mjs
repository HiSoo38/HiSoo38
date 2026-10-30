// 가입일부터 오늘까지의 기여를 한 장의 SVG 로 그린다.
//   - 위: 요약 숫자 4칸 (총 기여 · 활동한 날 · 최장 연속 기여 · 가장 많았던 달)
//   - 아래: 연도별 잔디 달력을 최신 연도부터 한 줄씩 쌓는다
// GitHub 기여 API(contributionsCollection)는 한 번에 1년까지만 조회되므로 1년씩 나눠 받는다.
//
// 사용: GITHUB_TOKEN=... USERNAME=HiSoo38 node scripts/activity-chart.mjs <출력 경로>
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { pathToFileURL } from "node:url";

// 다른 통계 카드(tokyonight 테마)와 같은 톤, 잔디 색은 GitHub 다크 테마 단계
const COLOR = {
  bg: "#1a1b27",
  border: "#2a2e42",
  tile: "#202233",
  title: "#c0caf5",
  text: "#a9b1d6",
  muted: "#565f89",
  levels: ["#2a2e42", "#0e4429", "#006d32", "#26a641", "#39d353"],
};

const CELL = 11; // 잔디 한 칸 크기
const GAP = 3; // 칸 사이 간격
const STEP = CELL + GAP;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;");
const fmt = (n) => n.toLocaleString("en-US");
const ymd = (d) => d.toISOString().slice(0, 10);
const dotted = (date) => date.slice(0, 10).replace(/-/g, ".");

async function graphql(token, query, variables) {
  const res = await fetch("https://api.github.com/graphql", {
    method: "POST",
    headers: { Authorization: `bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query, variables }),
  });
  const json = await res.json();
  if (!res.ok || json.errors) throw new Error(JSON.stringify(json.errors ?? json));
  return json.data;
}

// 가입일 ~ 오늘을 1년 이하 구간으로 잘라 일별 기여 수(Map<"YYYY-MM-DD", count>)를 모은다
export async function fetchDailyCounts(token, username) {
  const { user } = await graphql(token, `query($login:String!){ user(login:$login){ createdAt } }`, { login: username });
  const start = new Date(user.createdAt);
  const end = new Date();
  const days = new Map();

  for (let from = start; from < end; ) {
    const next = new Date(from);
    next.setUTCFullYear(next.getUTCFullYear() + 1);
    const to = next < end ? next : end;
    const data = await graphql(
      token,
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
  return { start: ymd(start), end: ymd(end), days };
}

// 가입일 ~ 오늘의 모든 날짜를 빠짐없이 나열한다 (API 에 없는 날은 0)
function listDays({ start, end, days }) {
  const list = [];
  for (let d = new Date(`${start}T00:00:00Z`); ymd(d) <= end; d.setUTCDate(d.getUTCDate() + 1)) {
    const date = ymd(d);
    list.push({ date, count: days.get(date) ?? 0 });
  }
  return list;
}

function summarize(list) {
  const total = list.reduce((s, d) => s + d.count, 0);
  const activeDays = list.filter((d) => d.count > 0).length;

  let streak = { length: 0 }, run = 0;
  list.forEach((d, i) => {
    run = d.count > 0 ? run + 1 : 0;
    if (run > streak.length) streak = { length: run, from: list[i - run + 1].date, to: d.date };
  });

  const byMonth = new Map();
  for (const d of list) byMonth.set(d.date.slice(0, 7), (byMonth.get(d.date.slice(0, 7)) ?? 0) + d.count);
  const [bestMonth, bestCount] = [...byMonth].reduce((a, b) => (b[1] > a[1] ? b : a), ["", 0]);

  return { total, activeDays, streak, bestMonth, bestCount };
}

// GitHub 처럼 0 이 아닌 날들의 사분위로 색 단계를 나눈다
function levelOf(nonZeroSorted) {
  const q = (p) => nonZeroSorted[Math.floor((nonZeroSorted.length - 1) * p)] ?? 0;
  const [q1, q2, q3] = [q(0.25), q(0.5), q(0.75)];
  return (count) => (count === 0 ? 0 : count <= q1 ? 1 : count <= q2 ? 2 : count <= q3 ? 3 : 4);
}

export function render(username, data) {
  const list = listDays(data);
  const s = summarize(list);
  const level = levelOf(list.filter((d) => d.count > 0).map((d) => d.count).sort((a, b) => a - b));
  const years = [...new Set(list.map((d) => Number(d.date.slice(0, 4))))].sort((a, b) => b - a);
  const period = `${dotted(data.start)} – ${dotted(data.end)}`;

  const W = 860;
  const PAD = 24;
  const gridLeft = PAD + 64; // 왼쪽 연도 라벨 자리
  const tilesTop = 84, tilesH = 64;
  const monthsTop = tilesTop + tilesH + 34;
  const yearsTop = monthsTop + 10;
  const yearH = 7 * STEP + 16;
  const legendTop = yearsTop + years.length * yearH + 4;
  const H = legendTop + 28;

  const out = [];
  out.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="Segoe UI, Ubuntu, sans-serif" role="img" aria-label="${esc(`${username} 전체 기간 기여 — ${period}, 총 ${fmt(s.total)}`)}">`);
  out.push(`<rect x="0.5" y="0.5" width="${W - 1}" height="${H - 1}" rx="6" fill="${COLOR.bg}" stroke="${COLOR.border}"/>`);

  // 제목 · 기간
  out.push(`<text x="${PAD}" y="40" fill="${COLOR.title}" font-size="18" font-weight="600">All-time Activity</text>`);
  out.push(`<text x="${PAD}" y="64" fill="${COLOR.text}" font-size="13">${period}</text>`);

  // 요약 숫자 4칸
  const tiles = [
    ["Total Contributions", fmt(s.total), "since joining"],
    ["Active Days", fmt(s.activeDays), `of ${fmt(list.length)} days`],
    ["Longest Streak", `${fmt(s.streak.length)} days`, s.streak.length ? `${dotted(s.streak.from)} – ${dotted(s.streak.to).slice(5)}` : "—"],
    ["Best Month", s.bestCount ? fmt(s.bestCount) : "0", s.bestCount ? s.bestMonth.replace("-", ".") : "—"],
  ];
  const tileGap = 12;
  const tileW = (W - PAD * 2 - tileGap * (tiles.length - 1)) / tiles.length;
  tiles.forEach(([label, value, sub], i) => {
    const x = PAD + i * (tileW + tileGap);
    out.push(`<rect x="${x}" y="${tilesTop}" width="${tileW}" height="${tilesH}" rx="6" fill="${COLOR.tile}"/>`);
    out.push(`<text x="${x + 14}" y="${tilesTop + 20}" fill="${COLOR.muted}" font-size="11">${label}</text>`);
    out.push(`<text x="${x + 14}" y="${tilesTop + 44}" fill="${COLOR.title}" font-size="20" font-weight="600">${esc(value)}</text>`);
    out.push(`<text x="${x + tileW - 14}" y="${tilesTop + 44}" text-anchor="end" fill="${COLOR.muted}" font-size="11">${esc(sub)}</text>`);
  });

  // 월 라벨 — 모든 연도 줄이 1월 1일이 속한 주부터 시작하므로 맨 위에 한 번만 그린다.
  // 해마다 1월 1일 요일이 달라 실제 칸과 최대 한 칸 어긋날 수 있지만 라벨 위치로는 충분하다.
  MONTHS.forEach((m, i) => {
    const dayOfYear = (Date.UTC(2001, i, 1) - Date.UTC(2001, 0, 1)) / 864e5;
    out.push(`<text x="${gridLeft + Math.floor(dayOfYear / 7) * STEP}" y="${monthsTop}" fill="${COLOR.muted}" font-size="11">${m}</text>`);
  });

  // 연도별 잔디 (최신 연도가 위)
  const byYear = new Map(years.map((y) => [y, []]));
  for (const d of list) byYear.get(Number(d.date.slice(0, 4))).push(d);
  years.forEach((year, row) => {
    const top = yearsTop + row * yearH;
    const days = byYear.get(year);
    const yearTotal = days.reduce((a, d) => a + d.count, 0);
    out.push(`<text x="${PAD}" y="${top + 3 * STEP + 6}" fill="${COLOR.title}" font-size="14" font-weight="600">${year}</text>`);
    out.push(`<text x="${PAD}" y="${top + 4 * STEP + 10}" fill="${COLOR.muted}" font-size="11">${fmt(yearTotal)}</text>`);

    const jan1 = Date.UTC(year, 0, 1);
    const jan1Weekday = new Date(jan1).getUTCDay();
    for (const d of days) {
      const offset = (Date.parse(`${d.date}T00:00:00Z`) - jan1) / 864e5 + jan1Weekday;
      const x = gridLeft + Math.floor(offset / 7) * STEP;
      const y = top + (offset % 7) * STEP;
      const title = d.count ? `<title>${dotted(d.date)} — ${fmt(d.count)}</title>` : "";
      out.push(`<rect x="${x}" y="${y}" width="${CELL}" height="${CELL}" rx="2" fill="${COLOR.levels[level(d.count)]}">${title}</rect>`);
    }
  });

  // 색 단계 범례
  const legendRight = W - PAD;
  const legendX = legendRight - 30 - COLOR.levels.length * STEP;
  out.push(`<text x="${legendX - 8}" y="${legendTop + 10}" text-anchor="end" fill="${COLOR.muted}" font-size="11">Less</text>`);
  COLOR.levels.forEach((c, i) => out.push(`<rect x="${legendX + i * STEP}" y="${legendTop}" width="${CELL}" height="${CELL}" rx="2" fill="${c}"/>`));
  out.push(`<text x="${legendRight}" y="${legendTop + 10}" text-anchor="end" fill="${COLOR.muted}" font-size="11">More</text>`);

  out.push(`</svg>`);
  return out.join("\n");
}

// 직접 실행할 때만 API 를 불러 파일로 쓴다 (render 는 다른 곳에서 가져다 시험할 수 있게 export)
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const token = process.env.GITHUB_TOKEN;
  const username = process.env.USERNAME;
  const outPath = process.argv[2] ?? "activity-all-time.svg";
  if (!token || !username) throw new Error("GITHUB_TOKEN 과 USERNAME 환경변수가 필요하다");

  const data = await fetchDailyCounts(token, username);
  mkdirSync(dirname(outPath) || ".", { recursive: true });
  writeFileSync(outPath, render(username, data));
  console.log(`${outPath}: ${data.start} ~ ${data.end}, 총 ${[...data.days.values()].reduce((a, b) => a + b, 0)}`);
}
