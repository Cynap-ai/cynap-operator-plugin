import { createServer } from 'node:http';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
/** Serve only generated pages, on loopback; never expose a workspace or follow request paths. */
export async function serveFixtures(dir) {
  const pages = new Map(readdirSync(dir).filter((name) => /^[a-z][a-z0-9-]*\.html$/.test(name)).map((name) => [`/${name}`, readFileSync(join(dir, name))]));
  const server = createServer((req, res) => {
    if (req.headers.host !== `127.0.0.1:${server.address().port}` || req.method !== 'GET') { res.writeHead(403).end(); return; }
    const body = pages.get((req.url ?? '').split('?')[0]);
    if (!body) { res.writeHead(404).end(); return; }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff' });
    res.end(body);
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  return { server, origin: `http://127.0.0.1:${server.address().port}` };
}
