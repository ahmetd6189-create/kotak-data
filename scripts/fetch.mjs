// Kotak TV - mac verisi toplayici. GitHub Actions icinde calisir, telefona anahtar gitmez.
import { writeFile, mkdir } from "node:fs/promises";

const LEAGUES = [
  { code: "tur.1", id: "superlig",  name: "Süper Lig",            country: "TR", tier: 1 },
  { code: "tur.2", id: "1lig",      name: "TFF 1. Lig",           country: "TR", tier: 1 },
  { code: "eng.1", id: "premier",   name: "Premier Lig",          country: "EN", tier: 1 },
  { code: "esp.1", id: "laliga",    name: "La Liga",              country: "ES", tier: 1 },
  { code: "ita.1", id: "seriea",    name: "Serie A",              country: "IT", tier: 1 },
  { code: "ger.1", id: "bundesliga",name: "Bundesliga",           country: "DE", tier: 1 },
  { code: "fra.1", id: "ligue1",    name: "Ligue 1",              country: "FR", tier: 1 },
  { code: "uefa.champions",   id: "ucl",  name: "Şampiyonlar Ligi", country: "EU", tier: 0 },
  { code: "uefa.europa",      id: "uel",  name: "Avrupa Ligi",      country: "EU", tier: 0 },
  { code: "uefa.europa.conf", id: "uecl", name: "Konferans Ligi",   country: "EU", tier: 0 },
];
const BASE = "https://site.api.espn.com/apis/site/v2/sports/soccer";
const DAYS_BACK = 1, DAYS_FWD = 7;

const ymd = d => d.toISOString().slice(0, 10).replace(/-/g, "");
const now = new Date();
const range = `${ymd(new Date(now.getTime() - DAYS_BACK * 864e5))}-${ymd(new Date(now.getTime() + DAYS_FWD * 864e5))}`;

async function getJson(url) {
  const r = await fetch(url, { headers: { Accept: "application/json", "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36" } });
  if (!r.ok) { const body = (await r.text().catch(() => "")).slice(0, 160).replace(/\s+/g, " "); throw new Error(`${r.status} ${url} :: ${body}`); }
  return r.json();
}
// Once tarih araligi dener; olmazsa gun gun ceker (ESPN bazen araligi reddediyor).
async function scoreboard(code) {
  try { return (await getJson(`${BASE}/${code}/scoreboard?dates=${range}&limit=300`)).events || []; }
  catch (e) { status.rangeError = status.rangeError || e.message; }
  const all = [];
  for (let i = -DAYS_BACK; i <= DAYS_FWD; i++) {
    try { all.push(...((await getJson(`${BASE}/${code}/scoreboard?dates=${ymd(new Date(now.getTime() + i * 864e5))}`)).events || [])); }
    catch (e) { status.dayErrors = (status.dayErrors || 0) + 1; }
  }
  const seen = new Set(); return all.filter(ev => !seen.has(ev.id) && seen.add(ev.id));
}

const fixtures = [], standings = {}, teams = {}, status = { updated: now.toISOString(), leagues: {} };

for (const lg of LEAGUES) {
  try {
    const events = await scoreboard(lg.code);
    let n = 0;
    for (const ev of events) {
      const c = ev.competitions?.[0]; if (!c) continue;
      const home = c.competitors?.find(x => x.homeAway === "home"), away = c.competitors?.find(x => x.homeAway === "away");
      if (!home || !away) continue;
      for (const t of [home, away]) if (t.team?.id) teams[t.team.id] = { name: t.team.displayName, short: t.team.shortDisplayName, abbr: t.team.abbreviation, logo: t.team.logo || `https://a.espncdn.com/i/teamlogos/soccer/500/${t.team.id}.png` };
      const st = ev.status?.type || {};
      fixtures.push({
        id: ev.id, league: lg.id, date: ev.date,
        home: { id: home.team?.id, name: home.team?.displayName, score: home.score },
        away: { id: away.team?.id, name: away.team?.displayName, score: away.score },
        state: st.state, detail: st.shortDetail, clock: ev.status?.displayClock,
        venue: c.venue?.fullName, tv: (c.broadcasts || []).flatMap(b => b.names || []),
      });
      n++;
    }
    status.leagues[lg.id] = { ok: true, matches: n };
    if (n === 0) { try { const tl = await getJson(`${BASE}/${lg.code}/teams`); const ts = tl.sports?.[0]?.leagues?.[0]?.teams || []; status.leagues[lg.id].teams = ts.length; for (const x of ts) if (x.team?.id) teams[x.team.id] = { name: x.team.displayName, short: x.team.shortDisplayName, abbr: x.team.abbreviation, logo: x.team.logos?.[0]?.href || `https://a.espncdn.com/i/teamlogos/soccer/500/${x.team.id}.png` }; } catch (e) { status.leagues[lg.id].teams = `hata: ${e.message}`; } }
    try {
      const sd = await getJson(`https://site.api.espn.com/apis/v2/sports/soccer/${lg.code}/standings`);
      const rows = [];
      const walk = g => { for (const e of g.standings?.entries || []) {
        const s = Object.fromEntries((e.stats || []).map(x => [x.name, x.value]));
        rows.push({ id: e.team?.id, name: e.team?.displayName, logo: e.team?.logos?.[0]?.href, rank: s.rank, gp: s.gamesPlayed, w: s.wins, d: s.ties, l: s.losses, gf: s.pointsFor, ga: s.pointsAgainst, gd: s.pointDifferential, pts: s.points });
      } for (const ch of g.children || []) walk(ch); };
      walk(sd);
      const uniq = new Map(); for (const r of rows) if (r.id && !uniq.has(r.id)) uniq.set(r.id, r);
      const table = [...uniq.values()].sort((a, b) => (a.rank ?? 99) - (b.rank ?? 99));
      standings[lg.id] = table;
      status.leagues[lg.id].standings = table.length;
    } catch (e) { status.leagues[lg.id].standings = `hata: ${e.message}`; }
  } catch (e) { status.leagues[lg.id] = { ok: false, error: e.message }; }
}

// TFF 1. Lig ESPN'de yok -> API-Football (lig id 204). Anahtar sadece GitHub Secrets'ta.
const AF = "https://v3.football.api-sports.io";
async function af(path) {
  const r = await fetch(`${AF}/${path}`, { headers: { "x-apisports-key": process.env.APIFOOTBALL_KEY } });
  const j = await r.json();
  status.afRemaining = r.headers.get("x-ratelimit-requests-remaining");
  if (j.errors && Object.keys(j.errors).length) throw new Error(JSON.stringify(j.errors));
  return j.response || [];
}
const afState = s => (["1H","2H","HT","ET","BT","P","LIVE","INT"].includes(s) ? "in" : (["FT","AET","PEN","AWD","WO"].includes(s) ? "post" : "pre"));
if (process.env.APIFOOTBALL_KEY && (status.leagues["1lig"]?.matches || 0) === 0) {
  try {
    const from = new Date(now.getTime() - DAYS_BACK * 864e5).toISOString().slice(0, 10), to = new Date(now.getTime() + DAYS_FWD * 864e5).toISOString().slice(0, 10);
    let fx = [];
    try { fx = await af(`fixtures?league=204&season=2025&from=${from}&to=${to}`); status.leagues["1lig"].afMode = "league"; }
    catch (e) { status.leagues["1lig"].afLeagueError = e.message; for (let i = -DAYS_BACK; i <= DAYS_FWD; i++) { const d = new Date(now.getTime() + i * 864e5).toISOString().slice(0, 10); try { fx.push(...(await af(`fixtures?date=${d}`)).filter(f => f.league?.id === 204)); } catch {} } status.leagues["1lig"].afMode = "date"; }
    let n = 0;
    for (const f of fx) {
      const h = f.teams?.home, a = f.teams?.away; if (!h || !a) continue;
      teams["af-" + h.id] = { name: h.name, short: h.name, logo: h.logo }; teams["af-" + a.id] = { name: a.name, short: a.name, logo: a.logo };
      const st = f.fixture?.status || {};
      fixtures.push({ id: "af-" + f.fixture.id, league: "1lig", date: f.fixture.date, home: { id: "af-" + h.id, name: h.name, score: f.goals?.home ?? "" }, away: { id: "af-" + a.id, name: a.name, score: f.goals?.away ?? "" }, state: afState(st.short), detail: st.long || "", clock: st.elapsed ? `${st.elapsed}'` : "", venue: f.fixture?.venue?.name || "", tv: [], source: "apifootball" });
      n++;
    }
    status.leagues["1lig"].afMatches = n;
    const sd = await af("standings?league=204&season=2025");
    const rows = (sd[0]?.league?.standings || []).flat();
    if (rows.length) {
      standings["1lig"] = rows.map(r => ({ id: "af-" + r.team.id, name: r.team.name, logo: r.team.logo, rank: r.rank, gp: r.all?.played, w: r.all?.win, d: r.all?.draw, l: r.all?.lose, gf: r.all?.goals?.for, ga: r.all?.goals?.against, gd: r.goalsDiff, pts: r.points }));
      status.leagues["1lig"].standings = rows.length;
    }
  } catch (e) { status.leagues["1lig"].afError = e.message; }
}

// API-Football (varsa): sadece guncel sezonun acik olup olmadigini test eder, veri yazmaz.
if (process.env.APIFOOTBALL_KEY) {
  try {
    const r = await fetch(`https://v3.football.api-sports.io/fixtures?date=${now.toISOString().slice(0, 10)}`, { headers: { "x-apisports-key": process.env.APIFOOTBALL_KEY } });
    const j = await r.json();
    const errs = j.errors && Object.keys(j.errors).length ? j.errors : null;
    status.apifootball = errs ? { currentSeason: false, errors: errs } : { currentSeason: (j.results || 0) > 0, results: j.results, remaining: r.headers.get("x-ratelimit-requests-remaining") };
  } catch (e) { status.apifootball = { error: e.message }; }
} else status.apifootball = "anahtar yok";

fixtures.sort((a, b) => a.date.localeCompare(b.date));
await mkdir("data", { recursive: true });
await writeFile("data/fixtures.json", JSON.stringify({ updated: status.updated, leagues: LEAGUES.map(({ code, ...l }) => l), matches: fixtures }));
await writeFile("data/standings.json", JSON.stringify({ updated: status.updated, tables: standings }));
await writeFile("data/teams.json", JSON.stringify(teams));
await writeFile("data/status.json", JSON.stringify(status, null, 2));
console.log(JSON.stringify(status, null, 2));
