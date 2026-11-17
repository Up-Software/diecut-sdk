# Die Cut Templates Node.js/TypeScript Library (unofficial)

[![npm version](https://img.shields.io/npm/v/@up-software/diecut-sdk)](https://www.npmjs.com/package/@up-software/diecut-sdk)
[![CI](https://github.com/Up-Software/diecut-sdk/actions/workflows/ci.yml/badge.svg)](https://github.com/Up-Software/diecut-sdk/actions/workflows/ci.yml)
[![license](https://img.shields.io/npm/l/@up-software/diecut-sdk)](LICENSE)

This library provides convenient access to the Dielines API and the Dieline Dimensions API from server-side TypeScript or JavaScript.

- **Dielines API**: generates custom dielines (PDF/DXF/SVG), 3D mockups and nesting layouts (sheet nesting) from the Die Cut Templates template catalog.
- **Dieline Dimensions API**: returns only the flat dimensions (width/height and, optionally, area) of a dieline's parts, without generating any file. Designed for quoting tools and configurators.

> **Disclaimer:** This is an unofficial client. It is not affiliated with or endorsed by Die Cut Templates; the name is used only to describe compatibility with their APIs.

## Table of contents

- [Documentation](#documentation)
- [Installation](#installation)
- [Usage](#usage)
- [Configuration](#configuration)
- [Environments](#environments)
- [Dieline templates](#dieline-templates)
- [Pagination](#pagination)
- [Dielines](#dielines)
- [Fluent, immutable resources](#fluent-immutable-resources)
- [3D mockups](#3d-mockups)
- [Nesting](#nesting)
- [Credits](#credits)
- [Dieline Dimensions API](#dieline-dimensions-api)
- [Handling errors](#handling-errors)
- [Retries and timeouts](#retries-and-timeouts)
- [TypeScript](#typescript)
- [Requirements](#requirements)
- [Versioning](#versioning)
- [Contributing](#contributing)
- [License](#license)

## Documentation

The full API reference lives at <https://www.diecuttemplates.com/docs>. This README only covers how to use the SDK.

## Installation

```sh
npm install @up-software/diecut-sdk
```

## Usage

The SDK does not read any environment variables: pass the API keys explicitly. The Dielines API and the Dieline Dimensions API use separate keys.

```ts
import { DiecutTemplatesSDK } from '@up-software/diecut-sdk';

const sdk = new DiecutTemplatesSDK({
  dielinesApiKey: process.env['DIELINES_API_KEY'],
  dimensionsApiKey: process.env['DIMENSIONS_API_KEY'],
  environment: 'sandbox', // 'production' (default) or 'sandbox'
});

const groups = await sdk.dielines.listTemplateGroups();
const parts = await sdk.dimensions.calculateParts('becf-11101', { variables: { unit: 'mm' } });
```

`sdk.dielines` and `sdk.dimensions` are created lazily. Accessing one without having passed its API key throws an `Error` that names the missing option.

You can also use the clients directly:

```ts
import { DielinesClient, DimensionsClient } from '@up-software/diecut-sdk';

const dielines = new DielinesClient({ apiKey: process.env['DIELINES_API_KEY']! });
const dimensions = new DimensionsClient({ apiKey: process.env['DIMENSIONS_API_KEY']! });
```

The examples below assume `dielines` and `dimensions` are clients created this way (or `sdk.dielines` / `sdk.dimensions`).

## Configuration

`DielinesClient` and `DimensionsClient` accept the same options:

| Option                 | Type                        | Default            | Description                                                                  |
| ---------------------- | --------------------------- | ------------------ | ---------------------------------------------------------------------------- |
| `apiKey`               | `string`                    | required           | API key, sent as `Authorization: Bearer <apiKey>`.                           |
| `environment`          | `'production' \| 'sandbox'` | `'production'`     | Selects the base URL when `baseUrl` is not set.                              |
| `baseUrl`              | `string`                    | from `environment` | Explicit base URL. Takes precedence over `environment`.                      |
| `timeoutMs`            | `number`                    | `30000`            | Per-request timeout in milliseconds.                                         |
| `fetchImpl`            | `typeof fetch`              | `globalThis.fetch` | Custom `fetch` implementation (for example, a mock in tests).                |
| `minRequestIntervalMs` | `number`                    | `1000`             | Minimum time between request starts of one client; `0` disables the limiter. |
| `maxRetries`           | `number`                    | `2`                | Retries on HTTP 429; `0` disables retries.                                   |

The API version header is set by the SDK (`Dielines-Api-Version: 1.0` or `Dimensions-Api-Version: 1.0`) and cannot be configured.

`DiecutTemplatesSDK` accepts only `dielinesApiKey`, `dimensionsApiKey` and `environment`. Use the clients directly if you need `baseUrl`, `timeoutMs`, `fetchImpl`, `minRequestIntervalMs` or `maxRetries`.

## Environments

Both APIs share the same two base URLs, and the same API key works in both environments.

| Environment | Base URL                                  |
| ----------- | ----------------------------------------- |
| Production  | `https://api.diecuttemplates.com`         |
| Sandbox     | `https://sandbox.api.diecuttemplates.com` |

```ts
new DielinesClient({ apiKey, environment: 'sandbox' });
new DielinesClient({ apiKey, baseUrl: 'https://sandbox.api.diecuttemplates.com' }); // equivalent
```

The `PRODUCTION_BASE_URL` and `SANDBOX_BASE_URL` constants are exported as well.

In sandbox, `createDieline` never consumes quota. The demo template `becf-11101` does not consume quota in any environment.

## Dieline templates

```ts
const groups = await dielines.listTemplateGroups();
const template = await dielines.getTemplate('becf-10301', 'mm'); // unit: 'mm' | 'in'
```

`listTemplates` returns a paginated catalog. `groupId` is the slug of a group returned by `listTemplateGroups()` (for example `cartons_tuck_end_boxes`). `pageSize` accepts 1 to 100. With `expand: true` the items are full templates and `unit` is required.

```ts
const page = await dielines.listTemplates({
  groupId: 'cartons_tuck_end_boxes',
  page: 1,
  pageSize: 50,
});
console.log(page.total, page.dielineTemplates[0].id, page.hasNextPage);

const full = await dielines.listTemplates({
  groupId: 'cartons_tuck_end_boxes',
  expand: true,
  unit: 'mm',
});
```

## Pagination

`iterateTemplates` walks all pages of a query and yields one template at a time. It always starts at page 1 (any `page` you pass is ignored) and uses `pageSize: 100` unless you set one.

```ts
for await (const template of dielines.iterateTemplates({ groupId: 'cartons_tuck_end_boxes' })) {
  console.log(template.id, template.standardCodes);
}
```

`listAllTemplates` collects every item into an array:

```ts
const all = await dielines.listAllTemplates({ groupId: 'cartons_tuck_end_boxes' });
```

`listDielines` and `list3DMockups` are paginated with `page` and `pageSize` (the API default page size is 100) and return a single page; they have no auto-pagination helper. Each page exposes `links` and `hasNextPage` so you can loop yourself:

```ts
let page = 1;
for (;;) {
  const result = await dielines.listDielines('becf-10301', { page });
  // ...use result.dielines
  if (!result.hasNextPage) break;
  page += 1;
}
```

## Dielines

`createDieline` generates a dieline in `'pdf'`, `'dxf'` or `'svg'` format.

```ts
const dieline = await dielines.createDieline('becf-10301', {
  format: 'pdf',
  area: true,
  variables: {
    unit: 'in',
    material: 0.11,
    length: 4.25,
    width: 3.0,
    height: 5.0,
    top_tuck_flap: 0.53,
  },
});

console.log(dieline.url); // downloadable PDF
console.log(dieline.artworkDimensions); // { unit: 'mm', width: 723.06, height: 502.44 }
```

When `area: true` is requested, `dieline.area` holds the total area (`{ unit, value }`). For multi-part dielines, `dieline.partAreas` also breaks it down by part id (for example `{ 'inner-tray': { unit: 'mm2', value: 96574.47 } }`, with numeric values); it is `undefined` otherwise.

Other optional parameters are `pdfHeader` and `dimensionTexts`. To list the dielines already generated from a template:

```ts
const page = await dielines.listDielines('becf-10301', { page: 1, pageSize: 50 });
console.log(page.total, page.dielines.length);
```

### Fluent, immutable resources

Resources returned with a `links` array (`Dieline`, `ThreeDMockup` and `NestingTemplate`) expose convenience methods that reuse the resource's own id:

```ts
// Instead of dielines.create3DMockup(dieline.id, { ... }):
const mockup = await dieline.create3DMockup({ file, fileName: 'artwork.png' });

// Instead of dielines.listNestingTemplates(dieline.id):
const { nestingTemplates } = await dieline.listNestingTemplates();

// Instead of dielines.createNesting(dieline.id, nestingTemplates[0].id, { ... }):
const nesting = await nestingTemplates[0].createNesting({
  format: 'pdf',
  variables: { unit: 'mm', sheetWidth: 1000, sheetHeight: 700 },
});
```

A `Dieline` also has `calculateNestingEfficiencies(params)`, and a `ThreeDMockup` has `update(params)` and `delete()`. Each method maps to a `rel` in the resource's `links`; it is not a generic request builder.

Every object returned by `DielinesClient` is frozen with `Object.freeze`, so reassigning a property throws a `TypeError` in strict mode. `DimensionsClient` responses carry no `links`, so they have no such methods.

## 3D mockups

`create3DMockup` and `update3DMockup` accept the artwork as a `Buffer` or a `Blob` (PNG, JPEG, JPG, SVG or PDF).

```ts
import { readFile } from 'node:fs/promises';

const file = await readFile('./artwork.png');

const mockup = await dielines.create3DMockup(dieline.id, {
  file,
  fileName: 'artwork.png',
  contentType: 'image/png',
  name: 'My design',
  outsideDesign: true,
  substrate: 'white_sbs',
});

console.log(mockup.url);

await dielines.update3DMockup(dieline.id, mockup.id, { substrate: 'kraft_brown' });
const mockups = await dielines.list3DMockups(dieline.id, { page: 1, pageSize: 100 });
console.log(mockups.threeDMockups.length);
await dielines.delete3DMockup(dieline.id, mockup.id);
```

For multi-part boxes, pass `partSubstrates` as a map of part number to substrate key (an empty string means plain material):

```ts
await dielines.update3DMockup(dieline.id, mockup.id, {
  partSubstrates: { '1': 'corrugated_brown', '2': 'white_sbs' },
});
```

To discover the parts a dieline accepts, read `dieline.substrateParts`. Each entry is `{ part, name, param }`; `part: null` is the main material (param `substrate`):

```ts
console.log(dieline.substrateParts); // [{ part: null, name: 'Material', param: 'substrate' }]
```

The response key `3d_mockups` is exposed as `threeDMockups`.

## Nesting

```ts
const nestingTemplates = await dielines.listNestingTemplates(dieline.id);

const efficiencies = await dielines.calculateNestingEfficiencies(dieline.id, {
  variables: {
    unit: 'mm',
    sheetWidth: 1000,
    sheetHeight: 700,
    sheetMarginTop: 15,
    sheetMarginBottom: 20,
    sheetMarginSide: 10,
  },
});
// efficiencies.efficiencies['<id>'] is null when a template has no calculable efficiency

const nesting = await dielines.createNesting(dieline.id, nestingTemplates.nestingTemplates[0].id, {
  format: 'pdf',
  variables: { unit: 'mm', sheetWidth: 1000, sheetHeight: 700, numX: 3, numY: 2 },
});
console.log(nesting.url);
```

## Credits

- `createDieline` consumes 1 credit of the monthly plan per unique combination of dimensions. Requesting another `format` for the same dimensions is free.
- Template listing and lookup, 3D mockups, and nesting operations do not consume quota.
- Sandbox requests and the demo template `becf-11101` never consume quota.
- `calculateParts` (Dieline Dimensions API) consumes 1 Dimensions API credit per request. Per the API documentation, identical requests repeated within 7 days are not charged again.

To check your balance without spending anything, call `getCredits()` on either client (`GET /credits` for Dielines, `GET /dimensions/credits` for Dimensions):

```ts
const credits = await dielines.getCredits();
console.log(credits.available, credits.expiresAt, credits.borrowable);

if (credits.unlimited) {
  // `available: 0` does not mean "empty" for unlimited accounts.
}
```

`borrowed` and `borrowable` are only present for the Dielines product.

Check the [official documentation](https://www.diecuttemplates.com/docs) for current pricing.

## Dieline Dimensions API

```ts
const result = await dimensions.calculateParts('becf-11a02', {
  variables: { unit: 'mm', material: 0.5, length: 200, width: 100, height: 40 },
  area: true,
});

for (const part of result.parts) {
  console.log(part.name, part.boundingBox.width, part.boundingBox.height, part.area?.value);
}
```

`DimensionsClient` also provides `listTemplateGroups()`, `getTemplate(id, unit = 'mm')` and `getCredits()`.

## Handling errors

Every non-2xx response is thrown as a subclass of `DiecutApiError`:

| Class                   | HTTP status              | Extra properties                                         |
| ----------------------- | ------------------------ | -------------------------------------------------------- |
| `DiecutValidationError` | 400                      | `errors`: list of `{ message, suggestion? }`             |
| `DiecutAuthError`       | 401, 403                 | none                                                     |
| `DiecutNotFoundError`   | 404                      | none                                                     |
| `DiecutRateLimitError`  | 429 (after retries)      | `retryAfterMs`: delay requested by `Retry-After`, if any |
| `DiecutApiError`        | any other non-2xx status | none                                                     |

All of them extend `Error` and carry `status` (HTTP status code), `body` (parsed JSON body, or `{ message: statusText }` if it was not JSON), `message`, and `requestId` (read from the `x-request-id` response header when present).

```ts
import {
  DiecutApiError,
  DiecutAuthError,
  DiecutNotFoundError,
  DiecutRateLimitError,
  DiecutValidationError,
} from '@up-software/diecut-sdk';

try {
  await dielines.createDieline('becf-10301', {
    format: 'pdf',
    variables: { unit: 'mm', length: 1, width: 999, height: 1 },
  });
} catch (error) {
  if (error instanceof DiecutValidationError) {
    console.error(error.message);
    for (const issue of error.errors) {
      console.error('-', issue.message, issue.suggestion);
    }
  } else if (error instanceof DiecutAuthError) {
    console.error('Auth error:', error.status, error.message);
  } else if (error instanceof DiecutNotFoundError) {
    console.error('Not found:', error.message);
  } else if (error instanceof DiecutRateLimitError) {
    console.error('Rate limited, retry after (ms):', error.retryAfterMs);
  } else if (error instanceof DiecutApiError) {
    console.error('API error:', error.status, error.body, error.requestId);
  } else {
    throw error;
  }
}
```

Client-side argument checks (for example `listTemplates` with an invalid `pageSize`, or `expand: true` without `unit`) throw a plain `Error` before any request is made.

## Retries and timeouts

The API allows 1 request per second. To stay within that limit, each client instance spaces its requests at least `minRequestIntervalMs` apart (default `1000`, measured between request starts). Concurrent calls are queued, not fired together. Set `minRequestIntervalMs: 0` to disable the limiter.

If the API still answers HTTP 429, the SDK retries up to `maxRetries` times (default `2`; `0` disables retries). It waits for the `Retry-After` header (seconds or HTTP-date) when present and valid, and otherwise uses an exponential backoff starting at 1 second (1 s, 2 s, 4 s, ...). A `Retry-After` longer than 60 seconds is not waited for: the error is thrown right away so your code decides when to try again. Retries go through the rate limiter too. When 429 persists, a `DiecutRateLimitError` is thrown with `retryAfterMs`. Only 429 responses are retried: other statuses and network errors are thrown immediately.

The limiter coordinates requests only within one client instance (one process). If several clients or processes share the same API key, they do not see each other's requests and rely on the 429 retry.

```ts
const dielines = new DielinesClient({ apiKey, minRequestIntervalMs: 1500, maxRetries: 3 });
```

Each request has a timeout of 30 seconds by default, configurable with `timeoutMs`. When it is exceeded the request is aborted and a plain `Error` is thrown with a message starting `The diecuttemplates.com API request exceeded the timeout of ...`.

```ts
const dielines = new DielinesClient({ apiKey, timeoutMs: 60_000 });
```

## TypeScript

The package ships its own type declarations. All request and response types are exported, for example `Dieline`, `DielineTemplate`, `DielineTemplateSummary`, `DielineTemplateListPage`, `ListTemplatesParams`, `ThreeDMockup`, `NestingTemplate`, `Nesting`, `PartListResult`, `DielineFormat`, `Unit` and `Substrate`, along with the client config types `DielinesClientConfig`, `DimensionsClientConfig` and `DiecutTemplatesSDKConfig`.

`listTemplates`, `iterateTemplates` and `listAllTemplates` are overloaded on `expand`:

```ts
const summaries = await dielines.listTemplates({ groupId: 'cartons_tuck_end_boxes' });
// DielineTemplateListPage<DielineTemplateSummary>

const templates = await dielines.listTemplates({
  groupId: 'cartons_tuck_end_boxes',
  expand: true,
  unit: 'mm',
});
// DielineTemplateListPage<DielineTemplate>

const items = await dielines.listAllTemplates({ expand: true, unit: 'in' });
// DielineTemplate[]
```

Passing `expand: true` without `unit` is a compile-time error. Numeric fields that the public documentation shows sometimes as strings and sometimes as numbers (such as `material`) are normalized to `number`.

## Requirements

- Node.js 20 or later.
- No runtime dependencies. The SDK uses the runtime's native `fetch`, `FormData`, `Blob` and `AbortController`.

## Versioning

This package follows [SemVer](https://semver.org/). While the version is `0.x`, minor releases may include breaking changes; pin the version you depend on.

## Contributing

Issues and pull requests are welcome.

```sh
npm install
npm run build
npm test
npm run test:coverage
```

`npm run test:coverage` enforces the coverage thresholds configured in `vitest.config.mts` and writes an `lcov` report to `coverage/`. CI runs the build and the test suite with coverage on Node.js 20, 22 and 24 for every push to `main` and every pull request.

### Releasing

Releases are automated with [release-please](https://github.com/googleapis/release-please) and follow [Conventional Commits](https://www.conventionalcommits.org/):

1. Every merge to `main` updates a release pull request that bumps `version` in `package.json` and adds the new entries to [`CHANGELOG.md`](CHANGELOG.md). While the version is `0.x`, `fix:` bumps the patch version and `feat:` or a breaking change bumps the minor version.
2. Merging the release pull request creates the tag (for example `v0.2.0`) and the GitHub release.
3. The `Release` workflow then checks that the tag matches `package.json`, builds, runs the tests and publishes to npm. Pre-release versions such as `v0.2.0-beta.1` are published under the `next` dist-tag. A version that is already on npm is skipped.

Publishing uses [npm trusted publishing](https://docs.npmjs.com/trusted-publishers), so no npm token is stored in the repository, and every release includes a [provenance attestation](https://docs.npmjs.com/generating-provenance-statements).

## License

[MIT](LICENSE)
