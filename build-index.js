#!/usr/bin/env node
// Build a static, self-contained HTML site from the workspace's qualified-<runId>.json reports,
// grouped by track. Writes:
//   <site>/index.html         landing page listing the tracks that have reports
//   <site>/<track>.html       per-track reader (index rail + report content), like the review page
// Pure file I/O (no network, no claude.ai), so it is safe to run headless/scheduled/forked.
// Reads WORK_ROOT/research-agent-data; writes to CIP_SITE_DIR (default WORK_ROOT/docs) so a
// GitHub Pages "/docs" source serves it. Each page is a complete HTML document with everything
// inlined, so it works on any static host with no assets or build step.
//
// Usage:
//   node <S>/build-index.js            (reads ./research-agent-data, writes ./docs)
//   CIP_WORKDIR=/path CIP_SITE_DIR=/path/docs node <S>/build-index.js
import fs from 'node:fs'
import path from 'node:path'

const WORK_ROOT = process.env.CIP_WORKDIR || process.cwd()
const SITE_DIR = process.env.CIP_SITE_DIR || path.join(WORK_ROOT, 'docs')

const TRACK_LABEL = { partner: 'Partner', customer: 'Customer', prospect: 'Prospect' }
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))
const host = u => { try { return new URL(u).hostname.replace(/^www\./, '') } catch { return 'source' } }
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const fmtDate = d => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(d || '')); return m ? `${+m[3]} ${MONTHS[+m[2] - 1]} ${m[1]}` : String(d || '') }
const CONF = { high: 0, medium: 1, low: 2 }
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`

const CSS = `
  :root{--paper:#eef0f3;--surface:#fff;--ink:#1b202b;--muted:#5c6675;--faint:#8b93a1;
    --line:#e2e5ea;--rail:#1c2431;--rail-fg:#d5dbe5;--rail-muted:#8b95a5;--rail-line:#2c3644;
    --accent:#127d84;--accent-ink:#0b5257;--t1:#a83226;--t2:#b9622b;--t3:#8a7a2f;--t4:#5d7f6a;--t5:#647089;--maxread:66ch}
  *{box-sizing:border-box}
  body{margin:0;background:var(--paper);color:var(--ink);font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;-webkit-font-smoothing:antialiased;line-height:1.55}
  a{color:var(--accent-ink)}
  .app{display:grid;grid-template-columns:290px 1fr;min-height:100vh}
  .rail{background:var(--rail);color:var(--rail-fg);padding:1.5rem 1.15rem;position:sticky;top:0;align-self:start;height:100vh;overflow-y:auto}
  .brand-link{display:inline-block;color:var(--rail-muted);text-decoration:none;font-size:.8rem;margin-bottom:1rem}
  .brand-link:hover{color:var(--rail-fg)}
  .brand{font-family:Iowan Old Style,"Palatino Linotype",Georgia,serif;font-size:1.28rem;font-weight:600;color:#fff;text-wrap:balance}
  .brand-sub{font-size:.72rem;text-transform:uppercase;letter-spacing:.13em;color:var(--rail-muted);margin-top:.35rem}
  .rail-label{font-size:.68rem;text-transform:uppercase;letter-spacing:.14em;color:var(--rail-muted);margin:1.8rem 0 .6rem}
  .reports{display:flex;flex-direction:column;gap:.35rem}
  .rpt{all:unset;display:grid;grid-template-columns:1fr auto;gap:.15rem .5rem;align-items:baseline;padding:.7rem .8rem;border-radius:9px;cursor:pointer;border:1px solid transparent;transition:background .15s,border-color .15s}
  .rpt:hover{background:#232d3b}
  .rpt:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
  .rpt.active{background:#26313f;border-color:var(--rail-line)}
  .rpt.active .rpt-date{color:#fff}
  .rpt-date{font-weight:600;font-size:.95rem;color:var(--rail-fg)}
  .rpt-key{grid-column:1/-1;font-family:ui-monospace,"SF Mono",Menlo,Consolas,monospace;font-size:.7rem;color:var(--rail-muted);font-variant-numeric:tabular-nums}
  .rpt-cadence{font-size:.66rem;text-transform:uppercase;letter-spacing:.1em;padding:.12rem .45rem;border-radius:999px;border:1px solid var(--rail-line);color:var(--rail-fg)}
  .rpt-cadence.monthly{color:#e6cfa0;border-color:#5a4c2f}
  .rpt-count{grid-column:1/-1;font-size:.76rem;color:var(--rail-muted);font-variant-numeric:tabular-nums}
  .reader{padding:2.6rem clamp(1.1rem,4vw,3.2rem) 4rem}
  .rpt-head{border-bottom:1px solid var(--line);padding-bottom:1.4rem;margin-bottom:1.9rem}
  .cadence-tag{display:inline-block;font-size:.7rem;text-transform:uppercase;letter-spacing:.16em;color:var(--accent-ink);font-weight:600;margin-bottom:.5rem}
  .rpt-head h1{font-family:Iowan Old Style,"Palatino Linotype",Georgia,serif;font-weight:600;font-size:clamp(1.6rem,3.4vw,2.35rem);margin:0;letter-spacing:-.01em;text-wrap:balance}
  .rpt-meta{margin-top:.55rem;color:var(--muted);font-size:.9rem;font-variant-numeric:tabular-nums}
  .section-label{font-size:.72rem;text-transform:uppercase;letter-spacing:.14em;color:var(--faint);margin:2.2rem 0 .9rem;font-weight:600}
  .highlights{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:.55rem}
  .highlights li{background:var(--surface);border:1px solid var(--line);border-left:3px solid var(--accent);border-radius:8px;padding:.7rem .95rem;font-size:.96rem;max-width:var(--maxread);text-wrap:pretty}
  .signals{display:flex;flex-direction:column;gap:1rem}
  .sig{background:var(--surface);border:1px solid var(--line);border-radius:12px;padding:1.15rem 1.3rem;position:relative;overflow:hidden}
  .sig::before{content:"";position:absolute;left:0;top:0;bottom:0;width:4px;background:var(--tier-c,var(--t5))}
  .sig h3{font-family:Iowan Old Style,"Palatino Linotype",Georgia,serif;font-weight:600;font-size:1.14rem;margin:0 0 .7rem;line-height:1.3;max-width:var(--maxread);text-wrap:balance}
  .meta{display:flex;flex-wrap:wrap;align-items:center;gap:.4rem .55rem;margin-bottom:.9rem}
  .tier{font-size:.72rem;font-weight:700;color:#fff;background:var(--tier-c,var(--t5));padding:.14rem .5rem;border-radius:5px;letter-spacing:.03em}
  .acct{font-weight:650}
  .cat{font-size:.76rem;color:var(--muted);border:1px solid var(--line);padding:.1rem .5rem;border-radius:999px;background:#f3f5f8}
  .conf{font-size:.78rem;color:var(--muted);display:inline-flex;align-items:center;gap:.3rem}
  .dot{width:.5rem;height:.5rem;border-radius:50%;display:inline-block;box-shadow:inset 0 0 0 1.5px var(--muted)}
  .conf.high .dot{background:var(--accent);box-shadow:none}
  .sig-date{margin-left:auto;font-size:.8rem;color:var(--faint);font-variant-numeric:tabular-nums;white-space:nowrap}
  .row{margin:.35rem 0;max-width:var(--maxread);text-wrap:pretty}
  .row .lbl{font-weight:650;color:var(--ink)}
  .src{font-size:.82rem;color:var(--muted);margin-top:.75rem}
  .src a{text-decoration:none;border-bottom:1px solid #bfe0e2}
  .src a:hover{border-bottom-color:var(--accent)}
  .prov{color:var(--faint)}
  details{margin-top:.7rem;max-width:var(--maxread)}
  summary{cursor:pointer;color:var(--accent-ink);font-size:.85rem;font-weight:600;width:max-content}
  summary:focus-visible{outline:2px solid var(--accent);outline-offset:3px;border-radius:3px}
  details p{margin:.6rem 0 0;color:#3c4658;font-size:.93rem}
  .quiet{color:var(--muted);font-style:italic}
  .tier-1{--tier-c:var(--t1)}.tier-2{--tier-c:var(--t2)}.tier-3{--tier-c:var(--t3)}.tier-4{--tier-c:var(--t4)}.tier-5{--tier-c:var(--t5)}
  /* landing */
  .landing{max-width:900px;margin:0 auto;padding:clamp(2.5rem,7vw,5rem) 1.4rem 4rem}
  .landing h1{font-family:Iowan Old Style,"Palatino Linotype",Georgia,serif;font-weight:600;font-size:clamp(2rem,5vw,2.9rem);margin:0;letter-spacing:-.015em}
  .landing .lead{color:var(--muted);margin:.6rem 0 2.4rem;font-size:1.05rem}
  .cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:1rem}
  .tcard{display:block;text-decoration:none;color:inherit;background:var(--surface);border:1px solid var(--line);border-radius:14px;padding:1.4rem 1.5rem;transition:border-color .15s,transform .15s}
  .tcard:hover{border-color:var(--accent);transform:translateY(-2px)}
  .tcard h2{font-family:Iowan Old Style,"Palatino Linotype",Georgia,serif;font-weight:600;margin:0 0 .5rem;font-size:1.4rem}
  .tcard .stat{color:var(--muted);font-size:.9rem;font-variant-numeric:tabular-nums}
  .tcard .go{margin-top:1rem;color:var(--accent-ink);font-weight:600;font-size:.9rem}
  .foot{max-width:900px;margin:2.5rem auto 0;padding:0 1.4rem;color:var(--faint);font-size:.8rem}
  @media (max-width:760px){.app{grid-template-columns:1fr}.rail{position:static;height:auto;padding:1.1rem}.reports{flex-direction:row;overflow-x:auto;gap:.5rem;padding-bottom:.3rem}.rpt{min-width:9.5rem}.sig-date{margin-left:0}}
  @media (prefers-reduced-motion:reduce){*{transition:none!important}}
`

const CLIENT_JS = `
const esc=s=>String(s==null?"":s).replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
const plural=(n,w)=>n+" "+w+(n===1?"":"s");
function signalCard(s){return \`<article class="sig tier-\${s.t}"><h3>\${esc(s.h)}</h3>
  <div class="meta"><span class="tier">T\${s.t}</span><span class="acct">\${esc(s.a)}</span>
  <span class="cat">\${esc(s.c)}</span><span class="conf \${s.cf}"><span class="dot"></span>\${esc(s.cf)}</span>
  <span class="sig-date">\${esc(s.d)}</span></div>
  <p class="row"><span class="lbl">Why it matters.</span> \${esc(s.w)}</p>
  <p class="row"><span class="lbl">Recommended action.</span> \${esc(s.ac)}</p>
  <div class="src">Source: <a href="\${esc(s.su)}" target="_blank" rel="noopener">\${esc(s.sh)}</a>
  <span class="prov">· \${esc(s.sn)} · \${esc(s.sp)} · Group \${s.sg} · \${esc(s.sgn)}</span></div>
  <details><summary>Read more</summary><p>\${esc(s.dt)}</p></details></article>\`}
function renderReport(r){
  const hi=r.highlights.length?\`<div class="section-label">Highlights</div><ul class="highlights">\${r.highlights.map(h=>\`<li>\${esc(h)}</li>\`).join("")}</ul>\`:"";
  const sigs=r.signals.length?\`<div class="section-label">\${plural(r.signals.length,"signal")}</div><div class="signals">\${r.signals.map(signalCard).join("")}</div>\`:\`<p class="quiet">No material signals this run.</p>\`;
  return \`<header class="rpt-head"><div class="cadence-tag">\${esc(r.cadence)} report</div>
    <h1>\${esc(TRACK)} intelligence · \${esc(r.date)}</h1>
    <div class="rpt-meta">\${plural(r.signals.length,"signal")} across \${plural(r.accounts,"account")} · <span style="font-family:ui-monospace,monospace">\${esc(r.id)}</span></div></header>\${hi}\${sigs}\`}
const nav=document.getElementById("reports"),reader=document.getElementById("reader");
nav.innerHTML=REPORTS.map((r,i)=>\`<button class="rpt\${i===0?" active":""}" data-i="\${i}" role="tab" aria-selected="\${i===0}">
  <span class="rpt-date">\${esc(r.date)}</span><span class="rpt-cadence \${r.cadence}">\${esc(r.cadence)}</span>
  <span class="rpt-key">\${esc(r.id)}</span><span class="rpt-count">\${plural(r.signals.length,"signal")} · \${plural(r.accounts,"account")}</span></button>\`).join("");
function select(i){reader.innerHTML=renderReport(REPORTS[i]);window.scrollTo({top:0});[...nav.children].forEach((b,j)=>{b.classList.toggle("active",j===i);b.setAttribute("aria-selected",j===i)})}
nav.addEventListener("click",e=>{const b=e.target.closest(".rpt");if(b)select(+b.dataset.i)});
select(0);
`

const doc = (title, body) => `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title>
<style>${CSS}</style></head><body>${body}</body></html>`

function trackPage(track, reports) {
  const label = TRACK_LABEL[track] || track
  const body = `<div class="app">
    <aside class="rail"><a class="brand-link" href="./index.html">&larr; All tracks</a>
      <div class="brand">${esc(label)} intelligence</div>
      <div class="brand-sub">Commercial Intelligence Program</div>
      <div class="rail-label">Reports</div>
      <nav class="reports" id="reports" aria-label="Reports"></nav></aside>
    <main class="reader" id="reader" aria-live="polite"></main></div>
    <script>const TRACK=${JSON.stringify(label)};const REPORTS=${JSON.stringify(reports)};${CLIENT_JS}</script>`
  return doc(`${label} intelligence · CIP reports`, body)
}

function landing(summaries, generatedAt) {
  const cards = summaries.map(s => `<a class="tcard" href="./${esc(s.track)}.html">
    <h2>${esc(s.label)}</h2>
    <div class="stat">${plural(s.reportCount, 'report')} · ${plural(s.signalTotal, 'signal')}</div>
    <div class="stat">Latest: ${esc(s.latest)}</div>
    <div class="go">View reports &rarr;</div></a>`).join('')
  const body = `<div class="landing"><h1>Commercial Intelligence Program</h1>
    <p class="lead">Weekly and monthly partner, customer, and prospect signal reports.</p>
    <div class="cards">${cards || '<p class="quiet">No reports yet.</p>'}</div></div>
    <div class="foot">Generated ${esc(generatedAt)} · ChronosHub internal</div>`
  return doc('Commercial Intelligence Program', body)
}

// ---- collect qualified files ----
// One workspace per track: gather from WORK_ROOT/research-agent-data AND from any immediate
// subfolder's research-agent-data (e.g. WORK_ROOT/partner/research-agent-data). Grouping is by
// the `track` field inside each file, so folder names don't matter and two tracks can share the
// same run key without colliding (they live in separate folders).
const dataDirs = []
const rootData = path.join(WORK_ROOT, 'research-agent-data')
if (fs.existsSync(rootData)) dataDirs.push(rootData)
if (fs.existsSync(WORK_ROOT)) for (const e of fs.readdirSync(WORK_ROOT, { withFileTypes: true })) {
  if (!e.isDirectory()) continue
  const d = path.join(WORK_ROOT, e.name, 'research-agent-data')
  if (fs.existsSync(d)) dataDirs.push(d)
}
if (!dataDirs.length) { console.error(`No research-agent-data under ${WORK_ROOT} or its subfolders. Run a report first.`); process.exit(1) }
const byTrack = {}
for (const dd of dataDirs) for (const f of fs.readdirSync(dd).filter(f => /^qualified-.*\.json$/.test(f))) {
  let j; try { j = JSON.parse(fs.readFileSync(path.join(dd, f), 'utf8')) } catch { continue }
  const runId = f.replace(/^qualified-|\.json$/g, '')
  const track = j.track || 'partner'
  const sorted = (j.signals || []).slice().sort((a, b) =>
    a.tier - b.tier || (CONF[a.confidence] ?? 3) - (CONF[b.confidence] ?? 3) || String(a.accountName).localeCompare(String(b.accountName)))
  const signals = sorted.map(s => ({
    h: s.whatChanged, a: s.accountName, c: s.category, t: s.tier, cf: s.confidence,
    sh: host(s.sourceUrl), su: s.sourceUrl, sn: String(s.sourceName || '').replace(/\s*\(own\)\s*$/, ''),
    sp: s.sourceGroup === 1 ? 'Primary' : 'Secondary', sg: s.sourceGroup, sgn: s.sourceGroupName,
    d: fmtDate(s.date), w: s.whyItMatters, ac: s.recommendedAction, dt: s.detail,
  }))
  const t12 = signals.filter(s => s.t <= 2)
  const highlights = (signals.length <= 3 ? signals : t12.length > 3 ? t12.slice(0, 5) : signals.slice(0, 3)).map(s => s.h)
    ; (byTrack[track] ||= []).push({
      id: runId, date: fmtDate(runId.slice(0, 10)), cadence: runId.slice(11) || 'report',
      accounts: new Set(sorted.map(s => s.accountName)).size, signals, highlights,
    })
}
for (const t in byTrack) byTrack[t].sort((a, b) => b.id.localeCompare(a.id))

// ---- write ----
fs.mkdirSync(SITE_DIR, { recursive: true })
fs.writeFileSync(path.join(SITE_DIR, '.nojekyll'), '')   // serve files as-is (skip GitHub Pages Jekyll processing)
const generatedAt = new Date().toISOString().slice(0, 10)
const summaries = []
for (const track of Object.keys(byTrack).sort()) {
  const reports = byTrack[track]
  fs.writeFileSync(path.join(SITE_DIR, `${track}.html`), trackPage(track, reports))
  summaries.push({
    track, label: TRACK_LABEL[track] || track, reportCount: reports.length,
    signalTotal: reports.reduce((n, r) => n + r.signals.length, 0), latest: reports[0]?.date || '-',
  })
  console.log(`wrote ${path.join(SITE_DIR, `${track}.html`)} (${reports.length} report(s))`)
}
fs.writeFileSync(path.join(SITE_DIR, 'index.html'), landing(summaries, generatedAt))
console.log(`wrote ${path.join(SITE_DIR, 'index.html')} (${summaries.length} track(s))`)
