import { diffLines } from 'diff';
import { listCommits, getFileAt } from './github.js';
import { renderVersionColumn } from './render.js';

const timeline = document.getElementById('timeline');
const minimap = document.getElementById('minimap');
const tooltip = document.getElementById('tooltip');

// Filled in renderColumns; used by the hover handlers below.
let commits = [];
let indexBySha = new Map();
let totalCommits = 0;

function parseLocation() {
  // GitHub-shaped: /:owner/:repo/blob/:ref/*path
  // Try the hash first (for embedded deploys like /timetraveller/#/owner/repo/blob/ref/path),
  // then fall back to pathname (for standalone deploys with SPA fallback).
  // Refs containing slashes (e.g. "release/v1") aren't supported here — same caveat as git-history.
  const re = /^\/([^/]+)\/([^/]+)\/blob\/([^/]+)\/(.+)$/;
  const hashPath = location.hash.replace(/^#/, '');
  const m = hashPath.match(re) || location.pathname.match(re);
  if (!m) return null;
  const [, owner, repo, ref, path] = m;
  return { owner, repo, ref, path };
}

// Pick routing mode once at startup: if the initial pathname parses, we're in standalone/SPA-fallback
// mode and should keep pushing pathnames; otherwise (embedded under a subpath, or landing page) we
// route via the hash so deep links survive on GitHub Pages without an SPA rewrite.
const usesHashRouting = !/^\/([^/]+)\/([^/]+)\/blob\/([^/]+)\/(.+)$/.test(location.pathname);

const escape = s => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// Count lines the same way `buildPrefixed` does (strip one trailing newline, then split). Mixing
// this with `diff`'s `p.count` would drift on files that don't end in a newline and silently
// misattribute every line below.
function countLines(s) {
  return s.replace(/\n$/, '').split('\n').length;
}

// For each commit, walk forward in history and tag every line of that commit's content with the
// sha that introduced it. Unchanged lines inherit blame from the previous version; added lines
// get the current sha; removed lines drop out of tracking.
function computeBlame(contents, shas) {
  const blame = [];
  blame.push(new Array(countLines(contents[0])).fill(shas[0]));
  for (let i = 1; i < contents.length; i++) {
    const parts = diffLines(contents[i - 1], contents[i]);
    const next = [];
    let oldIdx = 0;
    for (const p of parts) {
      const n = countLines(p.value);
      if (p.removed) {
        oldIdx += n;
      } else if (p.added) {
        for (let k = 0; k < n; k++) next.push(shas[i]);
      } else {
        for (let k = 0; k < n; k++) next.push(blame[i - 1][oldIdx + k]);
        oldIdx += n;
      }
    }
    blame.push(next);
  }
  return blame;
}

async function renderColumns(loc) {
  // GitHub returns newest-first. Reverse once so the rest of the rendering is straight-line
  // oldest → newest, matching what we want visually (oldest on the left, newest on the right).
  commits = (await listCommits(loc)).reverse();
  const contents = await Promise.all(commits.map(c => getFileAt(loc, c.sha)));
  const blame = computeBlame(contents, commits.map(c => c.sha));
  totalCommits = commits.length;
  indexBySha = new Map(commits.map((c, i) => [c.sha, i]));
  const columns = await Promise.all(
    commits.map((c, i) =>
      renderVersionColumn({
        prev: i > 0 ? contents[i - 1] : '',
        curr: contents[i],
        commit: c,
        path: loc.path,
        blameOld: i > 0 ? blame[i - 1] : null,
        blameNew: blame[i],
      })
    )
  );
  timeline.innerHTML = columns.join('');
  renderMinimap(commits);
  timeline.scrollLeft = timeline.scrollWidth;
  syncVerticalScroll();
  trackActiveColumn();
}

function renderMinimap(commits) {
  // No title attribute — custom hover tooltip handles the display; aria-label keeps screen readers happy.
  minimap.innerHTML = commits.map((c, i) => {
    const label = `${c.date.slice(0, 10)} · ${c.sha.slice(0, 7)} · ${c.message.split('\n')[0]}`;
    return `<button type="button" data-i="${i}" aria-label="${escape(label)}"></button>`;
  }).join('');
}

function renderLanding() {
  timeline.innerHTML = `
    <form>
      <label>
        Paste a GitHub blob URL
        <input type="url" name="url" required placeholder="https://github.com/owner/repo/blob/ref/path">
      </label>
      <button type="submit">Travel</button>
    </form>
  `;
  minimap.innerHTML = '';
}

async function run() {
  const loc = parseLocation();
  if (loc) await renderColumns(loc);
  else renderLanding();
}

function scrollArticleIntoView(article) {
  // Newest column snap-aligns to end; the rest to start.
  const isLast = article === timeline.lastElementChild;
  article.scrollIntoView({ inline: isLast ? 'end' : 'start', behavior: 'smooth' });
}

// Scroll one column's <pre> and the others follow. The guard prevents the assignment storm
// you'd otherwise get from each scroll event triggering N more.
function syncVerticalScroll() {
  const pres = document.querySelectorAll('#timeline pre');
  let active = null;
  for (const pre of pres) {
    pre.addEventListener('scroll', () => {
      if (active && active !== pre) return;
      active = pre;
      const top = pre.scrollTop;
      for (const other of pres) if (other !== pre) other.scrollTop = top;
      requestAnimationFrame(() => { active = null; });
    });
  }
}

// Light up minimap pips for whichever columns the user is currently looking at.
function trackActiveColumn() {
  const articles = [...document.querySelectorAll('#timeline > article')];
  const buttons = [...minimap.querySelectorAll('button')];
  const io = new IntersectionObserver(entries => {
    for (const entry of entries) {
      const i = articles.indexOf(entry.target);
      buttons[i].toggleAttribute('aria-current', entry.isIntersecting);
    }
  }, { root: timeline, threshold: 0.5 });
  for (const a of articles) io.observe(a);
}

minimap.addEventListener('click', e => {
  const btn = e.target.closest('button[data-i]');
  if (!btn) return;
  const i = Number(btn.dataset.i);
  scrollArticleIntoView(document.querySelectorAll('#timeline > article')[i]);
});

// Blame: click any line → jump to the column for the commit that introduced (or last had) it.
timeline.addEventListener('click', e => {
  const line = e.target.closest('.line[data-blame]');
  if (!line) return;
  const sha = line.getAttribute('data-blame');
  const target = timeline.querySelector(`article[data-sha="${sha}"]`);
  if (target) scrollArticleIntoView(target);
});

// Floating commit-info tooltip. Triggers when hovering a `.line[data-blame]` in the timeline OR
// a `#minimap button[data-i]` pip. The minimap pip for the line's commit gets the "hint" class
// only when the source is a line — pointing at a pip doesn't need to highlight itself.
let hovered = { sha: null, kind: null };
let hintedPip = null;

function setTooltipContent(commit, idx) {
  const ago = totalCommits - 1 - idx;
  const agoLabel = ago === 0 ? 'latest' : `${ago} commit${ago === 1 ? '' : 's'} ago`;
  tooltip.innerHTML =
    `<strong>${escape(commit.message.split('\n')[0])}</strong>` +
    `<small><code>${commit.sha.slice(0, 7)}</code> · ${escape(commit.authorName)} · ${agoLabel}</small>`;
  tooltip.hidden = false;
}

function positionTooltip(x, y) {
  // Place to the lower-right of the cursor; flip if it'd run off the viewport.
  const offsetX = 28;
  const offsetY = 20;
  const r = tooltip.getBoundingClientRect();
  let left = x + offsetX;
  let top = y + offsetY;
  if (left + r.width > window.innerWidth) left = x - r.width - offsetX;
  if (top + r.height > window.innerHeight) top = y - r.height - offsetY;
  tooltip.style.left = `${left}px`;
  tooltip.style.top = `${top}px`;
}

document.addEventListener('mousemove', e => {
  const line = e.target.closest('.line[data-blame]');
  const pip = !line && e.target.closest('#minimap button[data-i]');
  let kind = null, idx = null;
  if (line) {
    kind = 'line';
    idx = indexBySha.get(line.getAttribute('data-blame'));
  } else if (pip) {
    kind = 'pip';
    idx = Number(pip.dataset.i);
  }
  const sha = idx != null ? commits[idx]?.sha : null;
  if (sha !== hovered.sha || kind !== hovered.kind) {
    hovered = { sha, kind };
    if (hintedPip) { hintedPip.classList.remove('hint'); hintedPip = null; }
    if (sha) {
      setTooltipContent(commits[idx], idx);
      if (kind === 'line') {
        hintedPip = minimap.querySelector(`button[data-i="${idx}"]`);
        if (hintedPip) hintedPip.classList.add('hint');
      }
    } else {
      tooltip.hidden = true;
    }
  }
  if (sha) positionTooltip(e.clientX, e.clientY);
});

document.addEventListener('submit', e => {
  e.preventDefault();
  const url = new FormData(e.target).get('url');
  // Trust the browser's url-validation on the input. The path is what we route on.
  const targetPath = new URL(url).pathname;
  history.pushState(null, '', usesHashRouting ? `#${targetPath}` : targetPath);
  run();
});

addEventListener('popstate', run);
addEventListener('hashchange', run);

await run();
