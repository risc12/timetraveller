const API = 'https://api.github.com';
const RAW = 'https://raw.githubusercontent.com';

// Every GitHub request — API or raw — funnels through here.
// Auth, retries, caching, error mapping all live in one place when we need them.
function gh(url) {
  const headers = {};
  if (url.startsWith(API)) headers.Accept = 'application/vnd.github+json';
  return fetch(url, { headers });
}

export async function listCommits({ owner, repo, ref, path }) {
  const r = await gh(
    `${API}/repos/${owner}/${repo}/commits` +
    `?path=${encodeURIComponent(path)}&sha=${encodeURIComponent(ref)}&per_page=100`
  );
  if (!r.ok) throw new Error(`${r.url} → ${r.status}`);
  const data = await r.json();
  return data.map(c => ({
    sha: c.sha,
    message: c.commit.message,
    authorName: c.commit.author.name,
    date: c.commit.author.date,
    url: c.html_url,
  }));
}

export async function getFileAt({ owner, repo, path }, sha) {
  const r = await gh(`${RAW}/${owner}/${repo}/${sha}/${path}`);
  // 404 on raw content means the file wasn't at that path at this commit — usually a rename
  // upstream of where the file got its current name. We surface that as an empty file so the
  // adjacent commit's diff naturally shows it appearing.
  if (r.status === 404) return '';
  if (!r.ok) throw new Error(`${r.url} → ${r.status}`);
  return r.text();
}
