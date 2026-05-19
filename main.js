import { listCommits, getFileAt } from './github.js';
import { renderVersionColumn } from './render.js';

const timeline = document.getElementById('timeline');
const minimap = document.getElementById('minimap');

function parseLocation(pathname) {
  // GitHub-shaped: /:owner/:repo/blob/:ref/*path
  // Refs containing slashes (e.g. "release/v1") aren't supported here — same caveat as git-history.
  const m = pathname.match(/^\/([^/]+)\/([^/]+)\/blob\/([^/]+)\/(.+)$/);
  if (!m) return null;
  const [, owner, repo, ref, path] = m;
  return { owner, repo, ref, path };
}

const escape = s => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

async function renderColumns(loc) {
  // GitHub returns newest-first. Reverse once so the rest of the rendering is straight-line
  // oldest → newest, matching what we want visually (oldest on the left, newest on the right).
  const commits = (await listCommits(loc)).reverse();
  const contents = await Promise.all(commits.map(c => getFileAt(loc, c.sha)));
  const columns = await Promise.all(
    commits.map((c, i) =>
      renderVersionColumn(i > 0 ? contents[i - 1] : '', contents[i], c, loc.path)
    )
  );
  timeline.innerHTML = columns.join('');
  renderMinimap(commits);
  timeline.scrollLeft = timeline.scrollWidth;
  syncVerticalScroll();
  trackActiveColumn();
}

function renderMinimap(commits) {
  minimap.innerHTML = commits.map((c, i) => {
    const tooltip = `${c.date.slice(0, 10)} · ${c.sha.slice(0, 7)} · ${c.message.split('\n')[0]}`;
    return `<button type="button" data-i="${i}" title="${escape(tooltip)}" aria-label="${escape(tooltip)}"></button>`;
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
  const loc = parseLocation(location.pathname);
  if (loc) await renderColumns(loc);
  else renderLanding();
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
  const articles = document.querySelectorAll('#timeline > article');
  const last = i === articles.length - 1;
  // Newest column snap-aligns to end; the rest to start.
  articles[i].scrollIntoView({ inline: last ? 'end' : 'start', behavior: 'smooth' });
});

document.addEventListener('submit', e => {
  e.preventDefault();
  const url = new FormData(e.target).get('url');
  // Trust the browser's url-validation on the input. The path is what we route on.
  history.pushState(null, '', new URL(url).pathname);
  run();
});

addEventListener('popstate', run);

await run();
