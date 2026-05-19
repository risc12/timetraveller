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

// Walk the diff chunks once, emit lines with +/-/space prefix and a parallel tag array.
// The prefix is what makes the Shiki transformer's job trivial; the tags drive the CSS.
function buildPrefixed(prev, curr) {
  const parts = diffLines(prev, curr);
  const lines = [];
  const tags = [];
  for (const part of parts) {
    const chunkLines = part.value.replace(/\n$/, '').split('\n');
    const prefix = part.added ? '+' : part.removed ? '-' : ' ';
    const tag = part.added ? 'add' : part.removed ? 'remove' : null;
    for (const l of chunkLines) {
      lines.push(prefix + l);
      tags.push(tag);
    }
  }
  return { source: lines.join('\n'), tags };
}

// preprocess: strip the prefix so the grammar sees clean source.
// line: stamp data-diff so CSS can color it.
function diffTransformer(tags) {
  return {
    name: 'timetraveller-diff',
    preprocess(code) {
      return code.split('\n').map(l => l.slice(1)).join('\n');
    },
    line(node, idx) {
      const tag = tags[idx - 1];
      if (tag) node.properties['data-diff'] = tag;
    },
  };
}

let hlPromise;
function getHL() {
  hlPromise ??= getSingletonHighlighter({ themes: ['github-light', 'github-dark'], langs: [] });
  return hlPromise;
}

const escape = s => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export async function renderVersionColumn(prev, curr, commit, path) {
  const hl = await getHL();
  const lang = langFor(path);
  if (lang !== 'text' && !hl.getLoadedLanguages().includes(lang)) {
    await hl.loadLanguage(lang);
  }
  const { source, tags } = buildPrefixed(prev, curr);
  const code = hl.codeToHtml(source, {
    lang,
    // Dual themes with defaultColor:false emit both as CSS variables; style.css picks per scheme.
    themes: { light: 'github-light', dark: 'github-dark' },
    defaultColor: false,
    transformers: [diffTransformer(tags)],
  });
  return `<article>
    <header>
      <a href="${escape(commit.url)}" target="_blank" rel="noopener">${commit.sha.slice(0, 7)}</a>
      <time datetime="${escape(commit.date)}">${commit.date.slice(0, 10)}</time>
      <address>${escape(commit.authorName)}</address>
      <p>${escape(commit.message.split('\n')[0])}</p>
    </header>
    ${code}
  </article>`;
}
