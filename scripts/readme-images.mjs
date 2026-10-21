// Renders the README images from the tool's real output (test/golden/report.md), so the
// pictures can never drift from what the CLI prints. Run: npm run docs:images
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import process from 'node:process';
import { URL } from 'node:url';

const root = new URL('..', import.meta.url);
const report = readFileSync(new URL('test/golden/report.md', root), 'utf8').trimEnd().split('\n');
mkdirSync(new URL('docs/images/', root), { recursive: true });

const C = {
  bg: '#0d1117',
  bar: '#161b22',
  border: '#30363d',
  text: '#e6edf3',
  dim: '#8b949e',
  path: '#79c0ff',
  prompt: '#7ee787',
  HIGH: '#ff7b72',
  MED: '#e3b341',
  LOW: '#79c0ff',
};
const FONT = `ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, 'Liberation Mono', monospace`;
const SANS = `-apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif`;
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const span = (text, fill, weight) =>
  `<tspan fill="${fill}"${weight ? ` font-weight="${weight}"` : ''}>${esc(text)}</tspan>`;

/** One output line → coloured tspans, following the Markdown structure the CLI prints. */
function colour(line) {
  if (line.startsWith('# ')) return span(line, C.text, 700);
  if (line.startsWith('## ')) return span(line, C.path, 700);
  const m = /^(- L\d+-\d+: )\[(HIGH|MED|LOW)\] (.*) (\([^)]+\))$/.exec(line);
  if (m) {
    const [, loc, lvl, reason, ev] = m;
    return (
      span(loc, C.dim) +
      span(`[${lvl}]`, C[lvl], 700) +
      span(` ${reason} `, C.text) +
      span(ev, C.dim)
    );
  }
  if (line.startsWith('`')) return span(line, C.dim);
  return span(line, C.text);
}

// ---------- 1. Terminal: a real run, then the CI gate ----------
{
  const lines = [
    {
      raw: '$ npx risk-annotate',
      html: span('$ ', C.prompt) + span('npx risk-annotate', C.text, 700),
    },
    ...report.map((l) => ({ raw: l, html: colour(l) })),
    { raw: '', html: '' },
    {
      raw: '$ npx risk-annotate --fail-on high --format sarif > risk.sarif',
      html:
        span('$ ', C.prompt) +
        span('npx risk-annotate --fail-on high --format sarif > risk.sarif', C.text, 700),
    },
    {
      raw: 'risk-annotate: found annotations at or above HIGH',
      html: span('risk-annotate: found annotations at or above HIGH', C.HIGH),
    },
    { raw: '$ echo $?', html: span('$ ', C.prompt) + span('echo $?', C.text, 700) },
    { raw: '2', html: span('2', C.text) },
  ];
  const size = 14;
  const lh = 21;
  const charW = size * 0.6;
  const pad = 24;
  const top = 44;
  const width = Math.ceil(Math.max(...lines.map((l) => l.raw.length)) * charW + pad * 2);
  // Blank lines get half height so the real output stays faithful without looking sparse.
  let y = top + pad;
  const body = lines
    .map((l) => {
      if (l.raw === '') {
        y += lh / 2;
        return '';
      }
      const t = `<text x="${pad}" y="${y}" xml:space="preserve">${l.html}</text>`;
      y += lh;
      return t;
    })
    .filter(Boolean)
    .join('\n    ');
  const height = y - lh + pad + 6;
  writeFileSync(
    new URL('docs/images/terminal.svg', root),
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="risk-annotate output: one annotated line per risky hunk, and exit code 2 with --fail-on high">
  <rect width="${width}" height="${height}" rx="10" fill="${C.bg}" stroke="${C.border}"/>
  <path d="M0 10a10 10 0 0 1 10-10h${width - 20}a10 10 0 0 1 10 10v22H0z" fill="${C.bar}"/>
  <circle cx="20" cy="16" r="6" fill="#ff5f57"/><circle cx="40" cy="16" r="6" fill="#febc2e"/><circle cx="60" cy="16" r="6" fill="#28c840"/>
  <text x="${width / 2}" y="21" text-anchor="middle" font-family="${SANS}" font-size="12" fill="${C.dim}">risk-annotate — agent change under review</text>
  <g font-family="${FONT}" font-size="${size}">
    ${body}
  </g>
</svg>
`,
  );
}

// ---------- 2. How it helps: unordered diff in, ranked review list out ----------
{
  // Files in the order git lists them, and the tool's ranked result — both from the golden report.
  const ranked = [];
  let file = null;
  for (const l of report) {
    const h = /^## `(.+)`/.exec(l);
    if (h) file = h[1];
    const b = /^- (L\d+-\d+): \[(HIGH|MED|LOW)\] ([^;]+);.* \(([^)]+)\)$/.exec(l);
    if (b && file) ranked.push({ file, loc: b[1], lvl: b[2], why: b[3], ev: b[4] });
  }
  const gitOrder = [...ranked.map((r) => r.file)].sort();

  const W = 1180;
  const H = 120 + ranked.length * 46 + 40;
  const boxTop = 96;
  const rowH = 46;
  const left = gitOrder
    .map(
      (f, i) =>
        `<text x="56" y="${boxTop + 40 + i * rowH}" font-family="${FONT}" font-size="15" fill="${C.text}">${esc(f)}</text>`,
    )
    .join('\n  ');
  const right = ranked
    .map((r, i) => {
      const y = boxTop + 40 + i * rowH;
      return (
        `<rect x="582" y="${y - 15}" width="58" height="22" rx="4" fill="${C[r.lvl]}" fill-opacity="0.18" stroke="${C[r.lvl]}"/>` +
        `<text x="611" y="${y + 1}" text-anchor="middle" font-family="${FONT}" font-size="12" font-weight="700" fill="${C[r.lvl]}">${r.lvl}</text>` +
        `<text x="654" y="${y}" font-family="${FONT}" font-size="15" fill="${C.text}">${esc(r.file)} <tspan fill="${C.dim}">${r.loc}</tspan></text>` +
        `<text x="654" y="${y + 18}" font-family="${SANS}" font-size="12" fill="${C.dim}">${esc(r.why)} · ${esc(r.ev)}</text>`
      );
    })
    .join('\n  ');
  const boxH = ranked.length * rowH + 30;
  writeFileSync(
    new URL('docs/images/how-it-helps.svg', root),
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="A 7-file agent diff in git order becomes a ranked list: 3 HIGH, 3 MED, 1 LOW, each with a reason and evidence">
  <rect width="${W}" height="${H}" rx="12" fill="${C.bg}"/>
  <text x="40" y="52" font-family="${SANS}" font-size="22" font-weight="700" fill="${C.text}">An agent hands you ${gitOrder.length} changed files.</text>
  <text x="560" y="52" font-family="${SANS}" font-size="22" font-weight="700" fill="${C.text}">risk-annotate tells you where to look first.</text>
  <text x="40" y="78" font-family="${SANS}" font-size="14" fill="${C.dim}">The diff, in the order git shows it</text>
  <text x="560" y="78" font-family="${SANS}" font-size="14" fill="${C.dim}">Ranked by risk, each with its reason and evidence — computed locally</text>
  <rect x="40" y="${boxTop}" width="420" height="${boxH}" rx="10" fill="${C.bar}" stroke="${C.border}"/>
  <rect x="560" y="${boxTop}" width="580" height="${boxH}" rx="10" fill="${C.bar}" stroke="${C.border}"/>
  ${left}
  ${right}
  <g stroke="${C.prompt}" stroke-width="3" fill="none"><path d="M472 ${boxTop + boxH / 2}h68"/><path d="M530 ${boxTop + boxH / 2 - 9}l11 9-11 9"/></g>
</svg>
`,
  );
}

process.stdout.write('wrote docs/images/terminal.svg and docs/images/how-it-helps.svg\n');
