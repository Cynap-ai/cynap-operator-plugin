// Shared browser response for loopback consent callbacks. No callback data belongs in the page.
// build-copy-proxy.mjs packages this module beside the generated operator proxy.
/** @param {import('node:http').ServerResponse} response @param {boolean} approved */
export function sendApprovalLanding(response, approved) {
  const heading = approved ? 'Approved.' : 'Approval could not be completed.';
  const message = approved
    ? 'You can close this tab and return to your terminal.'
    : 'You can close this tab and return to your terminal for details.';
  response.writeHead(200, {
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'no-store',
    'Referrer-Policy': 'no-referrer',
    'X-Content-Type-Options': 'nosniff',
  });
  response.end(`<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${heading} | Cynap</title></head>
<body style="font-family:system-ui,sans-serif;text-align:center;padding:3rem 1rem">
<main><h1>${heading}</h1><p>${message}</p></main>
</body></html>`);
}
