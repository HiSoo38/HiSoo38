// 가입일부터 오늘까지의 기여 전체를 3D 잔디 한 장(profile-night-view.svg)으로 그린다.
//
// 그리기는 yoshi389111/github-profile-3d-contrib 의 코드를 그대로 쓰고, 이 스크립트는 데이터만 바꾼다.
//   - 원본은 contributionsCollection 을 1년치만 조회하므로, 가입한 해부터 올해까지 연도별로 받아 하나로 합친다.
//   - 색 단계(contributionLevel)는 해마다 따로 매겨져 오므로, 합친 전체 기간 기준 사분위로 다시 매긴다.
//   - 칸 너비를 주 수에 맞추는 부분은 워크플로에서 원본 create-3d-contrib.ts 한 줄을 고쳐 해결한다.
//
// 사용: GITHUB_TOKEN=... USERNAME=HiSoo38 node scripts/3d-contrib-all-time.cjs <원본 dist0/src 경로> <출력 폴더>
const { mkdirSync, writeFileSync } = require('node:fs');
const path = require('node:path');

const [libDir, outDir = 'profile-3d-contrib'] = process.argv.slice(2);
const token = process.env.GITHUB_TOKEN;
const userName = process.env.USERNAME;
if (!libDir || !token || !userName) {
    throw new Error('원본 dist0/src 경로 인자와 GITHUB_TOKEN · USERNAME 환경변수가 필요하다');
}

const lib = (name) => require(path.resolve(libDir, name));
const client = lib('github-graphql');
const aggregate = lib('aggregate-user-info');
const template = lib('color-template');
const create = lib('create-svg');

const LEVELS = ['NONE', 'FIRST_QUARTILE', 'SECOND_QUARTILE', 'THIRD_QUARTILE', 'FOURTH_QUARTILE'];

async function fetchCreatedAt() {
    const res = await fetch('https://api.github.com/graphql', {
        method: 'POST',
        headers: { Authorization: `bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: 'query($l:String!){ user(login:$l){ createdAt } }', variables: { l: userName } }),
    });
    const json = await res.json();
    if (!res.ok || json.errors) throw new Error(JSON.stringify(json.errors ?? json));
    return json.data.user.createdAt.slice(0, 10);
}

// 연도별 응답을 원본이 받는 응답 하나의 모양으로 합친다
function mergeResponses(responses, from, to) {
    const collections = responses.map((r) => {
        if (!r.data) throw new Error(JSON.stringify(r.errors ?? r));
        return r.data.user.contributionsCollection;
    });

    const byDate = new Map();
    for (const c of collections) {
        for (const week of c.contributionCalendar.weeks) {
            for (const day of week.contributionDays) {
                const date = day.date.slice(0, 10);
                if (date >= from && date <= to) byDate.set(date, { ...day });
            }
        }
    }
    const days = [...byDate.values()].sort((a, b) => (a.date < b.date ? -1 : 1));

    // GitHub 과 같은 방식: 0 이 아닌 날들의 사분위로 1~4 단계
    const counts = days.map((d) => d.contributionCount).filter((n) => n > 0).sort((a, b) => a - b);
    const q = (p) => counts[Math.floor((counts.length - 1) * p)] ?? 0;
    const [q1, q2, q3] = [q(0.25), q(0.5), q(0.75)];
    for (const d of days) {
        const n = d.contributionCount;
        d.contributionLevel = LEVELS[n === 0 ? 0 : n <= q1 ? 1 : n <= q2 ? 2 : n <= q3 ? 3 : 4];
    }

    const sum = (key) => collections.reduce((s, c) => s + c[key], 0);
    const latest = responses[responses.length - 1];
    return {
        data: {
            user: {
                repositories: latest.data.user.repositories,
                contributionsCollection: {
                    contributionCalendar: {
                        isHalloween: false,
                        totalContributions: days.reduce((s, d) => s + d.contributionCount, 0),
                        weeks: [{ contributionDays: days }],
                    },
                    commitContributionsByRepository: collections.flatMap((c) => c.commitContributionsByRepository),
                    totalCommitContributions: sum('totalCommitContributions'),
                    totalIssueContributions: sum('totalIssueContributions'),
                    totalPullRequestContributions: sum('totalPullRequestContributions'),
                    totalPullRequestReviewContributions: sum('totalPullRequestReviewContributions'),
                    totalRepositoryContributions: sum('totalRepositoryContributions'),
                },
            },
        },
    };
}

(async () => {
    const from = await fetchCreatedAt();
    const to = new Date().toISOString().slice(0, 10);

    const responses = [];
    for (let year = Number(from.slice(0, 4)); year <= Number(to.slice(0, 4)); year++) {
        responses.push(await client.fetchData(token, userName, 100, year));
    }
    const userInfo = aggregate.aggregateUserInfo(mergeResponses(responses, from, to));

    mkdirSync(outDir, { recursive: true });
    writeFileSync(path.join(outDir, 'profile-night-view.svg'), create.createSvg(userInfo, template.NightViewSettings, true));
    console.log(`${outDir}/profile-night-view.svg: ${from} ~ ${to}, ${userInfo.totalContributions} contributions`);
})().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
