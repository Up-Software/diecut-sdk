'use strict';

// Runtime smoke test of the built package (dist/) against a local HTTP server.
//
// The unit test suite needs Node.js 20 or later (vitest), so this script is what checks that the
// published code works on the oldest supported runtime (Node.js 18). It only uses Node.js built-ins
// and exercises the runtime APIs the SDK relies on: the global fetch, FormData, Blob and
// AbortController, plus the rate limiter and the 429 retry.
//
// Usage: npm run build && node scripts/runtime-smoke.cjs

const assert = require('node:assert/strict');
const http = require('node:http');
const path = require('node:path');

const sdk = require(path.join(__dirname, '..', 'dist', 'index.js'));

const requests = [];
let throttledOnce = false;

const server = http.createServer((req, res) => {
  const chunks = [];
  req.on('data', (chunk) => chunks.push(chunk));
  req.on('end', () => {
    const body = Buffer.concat(chunks).toString('utf8');
    requests.push({ method: req.method, url: req.url, headers: req.headers, body, at: Date.now() });
    const send = (status, payload, headers = {}) => {
      res.writeHead(status, { 'content-type': 'application/json', ...headers });
      res.end(JSON.stringify(payload));
    };

    if (req.url === '/dieline-template-groups') {
      return send(200, {
        dieline_template_group_list: {
          dieline_template_groups: [{ id: 'cartons_tuck_end_boxes', name: 'Tuck End Boxes' }],
        },
      });
    }
    if (req.url === '/dieline-templates/becf-11101/dielines') {
      return send(201, {
        dieline: {
          id: 'dl_1',
          dieline_template_id: 'becf-11101',
          format: 'svg',
          url: 'https://example.com/d.svg',
          part_areas: { lid: { value: '100.5', unit: 'mm2' } },
        },
      });
    }
    if (req.url === '/dielines/dl_1/3d-mockups') {
      return send(201, { '3d_mockup': { id: 'm_1', dieline_id: 'dl_1' } });
    }
    if (req.url === '/credits') {
      if (!throttledOnce) {
        throttledOnce = true;
        return send(429, { message: 'Too many requests' }, { 'retry-after': '0' });
      }
      return send(200, { credits: { product: 'dielines', available: 5, unlimited: false } });
    }
    if (req.url === '/dieline-templates/mm/slow') {
      setTimeout(() => send(200, {}), 500);
      return undefined;
    }
    return send(404, { message: 'Not found' }, { 'x-request-id': 'req_404' });
  });
});

async function main() {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const client = new sdk.DielinesClient({ apiKey: 'test-key', baseUrl, minRequestIntervalMs: 0 });

  // GET with authentication and API version headers.
  const groups = await client.listTemplateGroups();
  assert.equal(groups[0].id, 'cartons_tuck_end_boxes');
  assert.equal(requests[0].headers.authorization, 'Bearer test-key');
  assert.equal(requests[0].headers['dielines-api-version'], '1.0');

  // JSON POST and response mapping.
  const dieline = await client.createDieline('becf-11101', {
    format: 'svg',
    variables: { unit: 'mm', length: 100 },
  });
  assert.equal(dieline.id, 'dl_1');
  assert.deepEqual(dieline.partAreas, { lid: { value: 100.5, unit: 'mm2' } });
  assert.equal(JSON.parse(requests[1].body).format, 'svg');

  // Multipart POST built with the global FormData and Blob.
  await client.create3DMockup('dl_1', {
    file: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'),
    fileName: 'artwork.svg',
    contentType: 'image/svg+xml',
    partSubstrates: { 1: 'corrugated_brown' },
  });
  const multipart = requests[2];
  assert.match(multipart.headers['content-type'], /^multipart\/form-data; boundary=/);
  assert.match(multipart.body, /name="file"; filename="artwork\.svg"/);
  assert.match(multipart.body, /name="part_substrates\[1\]"/);

  // 429 retried with Retry-After, then success.
  const credits = await client.getCredits();
  assert.equal(credits.available, 5);
  assert.equal(requests.filter((r) => r.url === '/credits').length, 2);

  // Error mapping.
  await assert.rejects(client.getTemplate('missing', 'mm'), (error) => {
    assert.ok(error instanceof sdk.DiecutNotFoundError);
    assert.equal(error.requestId, 'req_404');
    return true;
  });

  // Timeout through AbortController.
  const timed = new sdk.DielinesClient({
    apiKey: 'k',
    baseUrl,
    timeoutMs: 50,
    minRequestIntervalMs: 0,
  });
  await assert.rejects(timed.getTemplate('slow', 'mm'), /exceeded the timeout of 50ms/);

  // Client-side rate limiter with its default interval.
  const limited = new sdk.DielinesClient({ apiKey: 'k', baseUrl });
  const before = requests.length;
  await Promise.all([limited.listTemplateGroups(), limited.listTemplateGroups()]);
  const [first, second] = requests.slice(before);
  assert.ok(second.at - first.at >= 900, `requests were ${second.at - first.at} ms apart`);

  console.log(`Runtime smoke test passed on Node.js ${process.version}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => server.close());
