import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import test from 'node:test';

import { CatalogError, catalogView, loadCatalog, publicationDecision } from './camera-catalog.mjs';

const ARTIFACT = readFileSync(
  fileURLToPath(new URL('../data/camera-support-catalog.json', import.meta.url)),
  'utf8',
);

/** A minimal entry that passes the gate; tests mutate a clone of it. */
const reviewedEntry = () => ({
  bodyCode: 'ILCE-9999',
  marketingName: 'a9999',
  aliases: [],
  firmwareScope: { kind: 'unstated' },
  reviewDate: '2026-09-01',
  sourceIssue: 1484,
  claims: {
    usbPTP: { value: 'supported', provenance: 'both' },
    pictureProfile: { value: 'full', provenance: 'reviewedHardwareReport' },
  },
  unresolvedDivergences: [],
});

const wrap = (...entries) => ({ schemaVersion: 1, entries });

test('the checked-in export artifact validates', () => {
  assert.doesNotThrow(() => loadCatalog(ARTIFACT));
});

test('an unknown schema version is refused', () => {
  assert.throws(() => loadCatalog({ schemaVersion: 2, entries: [] }), CatalogError);
});

test('a missing required display field is refused', () => {
  for (const field of ['bodyCode', 'marketingName', 'firmwareScope', 'reviewDate', 'sourceIssue']) {
    const entry = reviewedEntry();
    delete entry[field];
    assert.throws(() => loadCatalog(wrap(entry)), CatalogError, `expected a refusal for ${field}`);
  }
});

test('an unknown claim key, claim value, or provenance is refused', () => {
  const unknownKey = reviewedEntry();
  unknownKey.claims.nightVision = { value: 'supported', provenance: 'both' };
  assert.throws(() => loadCatalog(wrap(unknownKey)), CatalogError);

  const unknownValue = reviewedEntry();
  unknownValue.claims.pictureProfile.value = 'partial';
  assert.throws(() => loadCatalog(wrap(unknownValue)), CatalogError);

  const unknownProvenance = reviewedEntry();
  unknownProvenance.claims.usbPTP.provenance = 'forumPost';
  assert.throws(() => loadCatalog(wrap(unknownProvenance)), CatalogError);
});

test('an unknown or incomplete firmware scope is refused', () => {
  const unknownKind = reviewedEntry();
  unknownKind.firmwareScope = { kind: 'approximately' };
  assert.throws(() => loadCatalog(wrap(unknownKind)), CatalogError);

  const missingValue = reviewedEntry();
  missingValue.firmwareScope = { kind: 'minimum' };
  assert.throws(() => loadCatalog(wrap(missingValue)), CatalogError);
});

test('an entry with no carrier claim is refused', () => {
  const entry = reviewedEntry();
  delete entry.claims.usbPTP;
  assert.throws(() => loadCatalog(wrap(entry)), CatalogError);
});

test('a documentation-only entry is withheld, a hardware-reviewed one publishes', () => {
  const documented = reviewedEntry();
  documented.claims.usbPTP.provenance = 'sonyDocumentation';
  assert.equal(publicationDecision(documented).published, false);

  assert.equal(publicationDecision(reviewedEntry()).published, true);

  const reportOnly = reviewedEntry();
  reportOnly.claims.usbPTP.provenance = 'reviewedHardwareReport';
  assert.equal(publicationDecision(reportOnly).published, true);
});

test('a reviewed but unsupported carrier does not publish an entry', () => {
  const entry = reviewedEntry();
  entry.claims.usbPTP = { value: 'unsupported', provenance: 'reviewedHardwareReport' };
  const decision = publicationDecision(entry);
  assert.equal(decision.published, false);
  // Settled "does not work", not "not looked at yet" - the page words them apart.
  assert.equal(decision.status, 'reviewedUnsupported');
  const view = catalogView(wrap(entry));
  assert.equal(view.withheld, 1);
  assert.equal(view.documented.length, 0, 'a settled "no" is not a pending review');
});

test('a documentation-only carrier never earns a supported route badge', () => {
  // Published on the strength of reviewed Wi-Fi; USB rests on Sony's tables
  // alone and must not ride along as a green route.
  const entry = reviewedEntry();
  entry.claims.ptpIP = { value: 'supported', provenance: 'reviewedHardwareReport' };
  entry.claims.usbPTP = { value: 'supported', provenance: 'sonyDocumentation' };
  const [camera] = catalogView(wrap(entry)).cameras;
  for (const platform of camera.platforms) {
    assert.equal(platform.label, 'Wi-Fi', platform.platform);
  }
});

test('an unsupported feature reads as a sentence, not a mangled verb phrase', () => {
  const entry = reviewedEntry();
  entry.claims.remoteShutter = { value: 'unsupported', provenance: 'reviewedHardwareReport' };
  const [camera] = catalogView(wrap(entry)).cameras;
  assert.equal(camera.remoteShutter.label, 'Not supported');
  assert.equal(
    camera.remoteShutter.detail,
    'This body offers no remote shutter release over a remote connection.',
  );
});

test('a documentation-only feature claim is not presented as supported', () => {
  const entry = reviewedEntry();
  entry.claims.liveView = { value: 'supported', provenance: 'sonyDocumentation' };
  const [camera] = catalogView(wrap(entry)).cameras;
  assert.equal(camera.liveView.label, 'Not reviewed');
});

test('provenance is stated per row, never unioned across the entry', () => {
  const entry = reviewedEntry();
  entry.claims.usbPTP = { value: 'supported', provenance: 'reviewedHardwareReport' };
  entry.claims.pictureProfile = { value: 'selectorOnly', provenance: 'sonyDocumentation' };
  const [camera] = catalogView(wrap(entry)).cameras;
  assert.match(camera.platforms[0].source, /reviewed report from real hardware/);
  assert.equal(camera.pictureProfile.source, "Sony's published command tables");
});

test('duplicate body codes are refused - the page derives heading ids from them', () => {
  const first = reviewedEntry();
  const second = { ...reviewedEntry(), bodyCode: 'ilce-9999' };
  assert.throws(() => loadCatalog(wrap(first, second)), CatalogError);
});

test('the RX100 VII stays out of the verified list while its support is documented only', () => {
  const view = catalogView(ARTIFACT);
  assert.ok(
    !view.cameras.some((camera) => camera.bodyCode === 'DSC-RX100M7'),
    'RX100 VII must not appear as verified until a reviewed hardware report lands',
  );
  const rx100 = view.documented.find((camera) => camera.bodyCode === 'DSC-RX100M7');
  assert.ok(rx100, 'it belongs in the Sony-documented list instead');
  assert.deepEqual(rx100.documented, ['USB cable']);
  assert.equal(rx100.pictureProfile, 'Selector only');
  assert.equal(view.withheld, 0);
});

test('a documented entry carries no platform rows or supported badges', () => {
  // The shape itself is the guard: nothing in it can render as a Lutaro verdict.
  const entry = reviewedEntry();
  entry.claims.usbPTP.provenance = 'sonyDocumentation';
  entry.claims.pictureProfile.provenance = 'sonyDocumentation';
  const [camera] = catalogView(wrap(entry)).documented;
  assert.equal(camera.platforms, undefined);
  assert.equal(camera.remoteShutter, undefined);
  assert.deepEqual(camera.documented, ['USB cable']);
});

test('a documented entry states only the carriers Sony actually covers', () => {
  const entry = reviewedEntry();
  entry.claims.usbPTP = { value: 'supported', provenance: 'sonyDocumentation' };
  entry.claims.ptpIP = { value: 'unsupported', provenance: 'sonyDocumentation' };
  const [camera] = catalogView(wrap(entry)).documented;
  assert.deepEqual(camera.documented, ['USB cable']);
  assert.deepEqual(camera.excluded, ['Wi-Fi']);

  // An ABSENT claim stays absent - never rendered as a documented exclusion.
  const silent = reviewedEntry();
  silent.claims.usbPTP.provenance = 'sonyDocumentation';
  const [quiet] = catalogView(wrap(silent)).documented;
  assert.deepEqual(quiet.excluded, []);
});

test('the a6700 publishes with both platforms and full Picture Profile support', () => {
  const view = catalogView(ARTIFACT);
  const a6700 = view.cameras.find((camera) => camera.bodyCode === 'ILCE-6700');
  assert.ok(a6700, 'the reviewed a6700 entry must be published');
  assert.equal(a6700.pictureProfile.label, 'Full');
  assert.deepEqual(
    a6700.platforms.map((p) => [p.platform, p.label]),
    [
      ['iPhone & iPad', 'USB or Wi-Fi'],
      ['Mac', 'USB or Wi-Fi'],
    ],
  );
  assert.match(a6700.platforms[0].source, /reviewed report from real hardware/);
  assert.equal(a6700.evidence.reviewDate, '2026-09-01');
});

test('selector-only is a distinct verdict from full, not a flavour of it', () => {
  const entry = reviewedEntry();
  entry.claims.pictureProfile.value = 'selectorOnly';
  const [camera] = catalogView(wrap(entry)).cameras;
  assert.equal(camera.pictureProfile.label, 'Selector only');
  assert.equal(camera.pictureProfile.tone, 'partial');
  assert.match(camera.pictureProfile.detail, /cannot read or change the settings inside it/);
});

test('an absent claim reads as not reviewed, never as unsupported', () => {
  const [camera] = catalogView(wrap(reviewedEntry())).cameras;
  for (const field of ['creativeLook', 'creativeStyle', 'remoteShutter', 'liveView']) {
    assert.equal(camera[field].label, 'Not reviewed', field);
    assert.equal(camera[field].tone, 'unreviewed', field);
  }
});

test('Creative Look and Creative Style stay separate verdicts', () => {
  const [camera] = catalogView(wrap(reviewedEntry())).cameras;
  assert.notEqual(camera.creativeLook, camera.creativeStyle);
});

test('unresolved divergences survive into the evidence note', () => {
  const entry = reviewedEntry();
  entry.unresolvedDivergences = [
    { field: 'pictureProfile', value: 'selectorOnly', provenance: 'sonyDocumentation' },
  ];
  const [camera] = catalogView(wrap(entry)).cameras;
  assert.equal(camera.evidence.divergences.length, 1);
  assert.match(camera.evidence.divergences[0], /pictureProfile/);
});

test('cameras are sorted by marketing name', () => {
  const zeta = { ...reviewedEntry(), bodyCode: 'ILCE-1', marketingName: 'Zeta' };
  const alpha = { ...reviewedEntry(), bodyCode: 'ILCE-2', marketingName: 'Alpha' };
  const view = catalogView(wrap(zeta, alpha));
  assert.deepEqual(
    view.cameras.map((c) => c.marketingName),
    ['Alpha', 'Zeta'],
  );
});
