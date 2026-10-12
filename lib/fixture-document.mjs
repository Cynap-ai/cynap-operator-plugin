import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { buildViewCsp } from './fixture-policy.generated.mjs';
export function inertJson(value) {
  return JSON.stringify(value).replace(/[<>&\u2028\u2029]/g, (char) => `\\u${char.charCodeAt(0).toString(16).padStart(4, '0')}`);
}
export function fixtureDocument(payload) {
  const host = readFileSync(new URL('./fixture-host.generated.mjs', import.meta.url), 'utf8');
  const script = `${host}\nCynapFixtureHost.mountFixture(${inertJson(payload)});`;
  if (/<\/script/i.test(script)) throw new Error('Host program contains a script closing sequence');
  // srcdoc inherits its parent's CSP. Admit exact bundle script digests too, never unsafe-inline.
  // The outer document contains only the host script; bundle bytes remain inert data there.
  const scripts = [script, ...[...payload.html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script\s*>/gi)].map((match) => match[1])];
  const digests = scripts.map((text) => `'sha256-${createHash('sha256').update(text).digest('base64')}'`).join(' ');
  const csp = buildViewCsp().replace("script-src 'self' 'unsafe-inline'", `script-src ${digests}`).replace("frame-src 'none'", "frame-src 'self'");
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${csp}"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Fixture render</title><style>:root{--spacing:0.25rem}body{margin:0}#view{box-sizing:border-box;max-width:100%;padding:calc(var(--spacing) * 6) calc(var(--spacing) * 8) calc(var(--spacing) * 12)}</style></head><body><header>Fixture render, nothing was written</header><p id="notice"></p><aside id="errors"></aside><main id="view"></main><script>${script}</script></body></html>`;
}
