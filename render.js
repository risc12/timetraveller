import { getSingletonHighlighter } from 'shiki';
import { diffLines } from 'diff';

const LANG_BY_EXT = {
  ts: 'typescript', tsx: 'tsx', js: 'javascript', jsx: 'jsx', mjs: 'javascript', cjs: 'javascript',
  py: 'python', rs: 'rust', go: 'go', zig: 'zig', c: 'c', h: 'c', cc: 'cpp', cpp: 'cpp', hpp: 'cpp',
  java: 'java', kt: 'kotlin', swift: 'swift', rb: 'ruby', php: 'php', cs: 'csharp',
  md: 'markdown', json: 'json', yml: 'yaml', yaml: 'yaml', toml: 'toml',
  html: 'html', css: 'css', scss: 'scss', sh: 'shell', bash: 'shell', sql: 'sql',
};

function langFor(path) {
  const ext = path.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1];
  return LANG_BY_EXT[ext] ?? 'text';
}

// Walk the diff chunks once, emit lines with +/-/space prefix and parallel tag + blame arrays.
// The prefix is what makes the Shiki transformer's job trivial; the tags drive the diff CSS;
// the blames drive the click-to-jump-to-the-commit-that-introduced-this-line behavior.
//
// For each line we emit:
//   '+' (added in this commit) → blame = current commit's sha (= blameNew[newIdx])
//   ' ' (unchanged)            → blame = blameNew[newIdx] (precomputed walk down the history)
//   '-' (removed in this commit, shown for context) → blame = blameOld[oldIdx]
function buildPrefixed(prev, curr, blameOld, blameNew) {
  const parts = diffLines(prev, curr);
  const lines = [];
  const tags = [];
  const blames = [];
  let oldIdx = 0;
  let newIdx = 0;
  for (const part of parts) {
    const chunkLines = part.value.replace(/\n$/, '').split('\n');
    const tag = part.added ? 'add' : part.removed ? 'remove' : null;
    const prefix = part.added ? '+' : part.removed ? '-' : ' ';
    for (const l of chunkLines) {
      lines.push(prefix + l);
      tags.push(tag);
      if (part.added) {
        blames.push(blameNew[newIdx]);
        newIdx++;
      } else if (part.removed) {
        blames.push(blameOld ? blameOld[oldIdx] : null);
        oldIdx++;
      } else {
        blames.push(blameNew[newIdx]);
        oldIdx++;
        newIdx++;
      }
    }
  }
  return { source: lines.join('\n'), tags, blames };
}

// preprocess: strip the prefix so the grammar sees clean source.
// line: stamp data-diff and data-blame so CSS can color and JS can route clicks.
function diffTransformer(tags, blames) {
  return {
    name: 'timetraveller-diff',
    preprocess(code) {
      return code.split('\n').map(l => l.slice(1)).join('\n');
    },
    line(node, idx) {
      const tag = tags[idx - 1];
      const blame = blames[idx - 1];
      if (tag) node.properties['data-diff'] = tag;
      if (blame) node.properties['data-blame'] = blame;
    },
  };
}

let hlPromise;
function getHL() {
  hlPromise ??= getSingletonHighlighter({ themes: ['github-light', 'github-dark'], langs: [] });
  return hlPromise;
}

const escape = s => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// Shiki's tokenizer is synchronous and runs on the main thread, so very large files
// (think 10k+ lines × 100 commits) pin the browser for minutes. For these outliers
// we drop highlighting and render as plaintext — diff/blame coloring still works.
const HIGHLIGHT_MAX_BYTES = 200_000;
const HIGHLIGHT_MAX_LINES = 5_000;

export async function renderVersionColumn({ prev, curr, commit, path, blameOld, blameNew }) {
  const hl = await getHL();
  let lang = langFor(path);
  const tooBig = curr.length > HIGHLIGHT_MAX_BYTES || curr.split('\n').length > HIGHLIGHT_MAX_LINES;
  if (tooBig) lang = 'text';
  if (lang !== 'text' && !hl.getLoadedLanguages().includes(lang)) {
    try {
      await hl.loadLanguage(lang);
    } catch {
      // Grammar bundle failed to load (e.g. esm.sh hiccup); render as plaintext.
      lang = 'text';
    }
  }
  const { source, tags, blames } = buildPrefixed(prev, curr, blameOld, blameNew);
  const code = hl.codeToHtml(source, {
    lang,
    // Dual themes with defaultColor:false emit both as CSS variables; style.css picks per scheme.
    themes: { light: 'github-light', dark: 'github-dark' },
    defaultColor: false,
    transformers: [diffTransformer(tags, blames)],
  });
  return `<article data-sha="${escape(commit.sha)}">
    <header>
      <a href="${escape(commit.url)}" target="_blank" rel="noopener">${commit.sha.slice(0, 7)}</a>
      <time datetime="${escape(commit.date)}">${commit.date.slice(0, 10)}</time>
      <address>${escape(commit.authorName)}</address>
      <p>${escape(commit.message.split('\n')[0])}</p>
    </header>
    ${code}
  </article>`;
}
