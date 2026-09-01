/**
 * Build-time reader for the reviewed camera-support catalog (Lutaro #1484).
 *
 * The single source of truth is the app repo's
 * `App/CameraCore/SupportCatalog/camera-support-catalog.json`; this site consumes
 * only the deterministic export of it that `Scripts/export-support-catalog.py`
 * produces (vendored at `src/data/camera-support-catalog.json`, see the README
 * next to it). This module transforms that artifact into what `/compatibility`
 * renders. It never adds a fact: every value below either comes out of the
 * artifact or is an app-wide, camera-independent statement about Lutaro itself.
 *
 * It refuses loudly. An unknown schema version, an unknown vocabulary value or a
 * missing required display field throws, which fails `astro build` - the site
 * would rather not deploy than serve a guess about what a camera supports.
 */

export const SUPPORTED_SCHEMA_VERSION = 1;

/** Claim keys the catalog schema owns. Anything else is a refusal. */
const CLAIM_VOCABULARY = {
  usbPTP: ['supported', 'unsupported'],
  ptpIP: ['supported', 'unsupported'],
  pictureProfile: ['full', 'selectorOnly', 'none'],
  remoteShutter: ['supported', 'unsupported'],
  liveView: ['supported', 'unsupported'],
};

const PROVENANCE_VOCABULARY = ['sonyDocumentation', 'reviewedHardwareReport', 'both'];
const FIRMWARE_KINDS = ['unstated', 'minimum', 'exact'];
const CARRIERS = ['usbPTP', 'ptpIP'];

/** Fields every published entry must carry before it can be displayed. */
const REQUIRED_DISPLAY_FIELDS = [
  'bodyCode',
  'marketingName',
  'firmwareScope',
  'reviewDate',
  'sourceIssue',
];

export class CatalogError extends Error {}

const refuse = (message) => {
  throw new CatalogError(message);
};

const isPlainObject = (value) =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * Parses and validates the export artifact. Returns the artifact unchanged on
 * success - the shaping happens in `catalogView`, so a validation failure is
 * never half-applied.
 */
export function loadCatalog(raw) {
  const artifact = typeof raw === 'string' ? parseJSON(raw) : raw;
  if (!isPlainObject(artifact)) refuse('catalog top level is not a JSON object');
  if (artifact.schemaVersion !== SUPPORTED_SCHEMA_VERSION) {
    refuse(
      `unsupported schemaVersion ${JSON.stringify(artifact.schemaVersion)} ` +
        `(this site understands version ${SUPPORTED_SCHEMA_VERSION} only)`,
    );
  }
  if (!Array.isArray(artifact.entries)) refuse("catalog 'entries' is missing or not an array");
  artifact.entries.forEach((entry, index) => validateEntry(entry, `entries[${index}]`));
  const codes = artifact.entries.map((entry) => String(entry.bodyCode).trim().toUpperCase());
  // The page derives each camera's heading id from its body code.
  if (new Set(codes).size !== codes.length) refuse('duplicate body codes in the catalog');
  return artifact;
}

function parseJSON(text) {
  try {
    return JSON.parse(text);
  } catch (error) {
    return refuse(`catalog is not valid JSON: ${error.message}`);
  }
}

function validateEntry(entry, where) {
  if (!isPlainObject(entry)) refuse(`${where} is not a JSON object`);
  for (const field of REQUIRED_DISPLAY_FIELDS) {
    if (entry[field] === undefined || entry[field] === null || entry[field] === '') {
      refuse(`${where}: missing required display field '${field}'`);
    }
  }
  if (!isPlainObject(entry.firmwareScope) || !FIRMWARE_KINDS.includes(entry.firmwareScope.kind)) {
    refuse(`${where}: unknown firmwareScope kind ${JSON.stringify(entry.firmwareScope?.kind)}`);
  }
  if (entry.firmwareScope.kind !== 'unstated' && !entry.firmwareScope.value) {
    refuse(`${where}: firmwareScope '${entry.firmwareScope.kind}' requires a 'value'`);
  }
  if (!isPlainObject(entry.claims)) refuse(`${where}: 'claims' is missing or not a JSON object`);

  for (const [field, claim] of Object.entries(entry.claims)) {
    const allowed = CLAIM_VOCABULARY[field];
    if (!allowed) refuse(`${where}: unknown claim key '${field}'`);
    if (!isPlainObject(claim)) refuse(`${where}.claims.${field} is not a JSON object`);
    if (!allowed.includes(claim.value)) {
      refuse(`${where}.claims.${field}: unknown value ${JSON.stringify(claim.value)}`);
    }
    if (!PROVENANCE_VOCABULARY.includes(claim.provenance)) {
      refuse(`${where}.claims.${field}: unknown provenance ${JSON.stringify(claim.provenance)}`);
    }
  }
  if (!CARRIERS.some((carrier) => entry.claims[carrier])) {
    refuse(`${where}: no carrier claim - nothing to display`);
  }
}

/**
 * The publication gate.
 *
 * An entry is published only when a carrier claim says `supported` AND that
 * claim rests on a reviewed hardware report (on its own or alongside Sony's
 * documentation). A documentation-only entry records what Sony's tables say a
 * body *can* do; it is not evidence that Lutaro's support for that body has
 * shipped, and the site must not publish planned support as current support.
 *
 * The gate is data-driven on purpose: an entry publishes itself the moment a
 * reviewed hardware report lands in the catalog upstream, with no edit here.
 */
export function publicationDecision(entry) {
  if (CARRIERS.some((carrier) => isReviewedSupport(entry.claims[carrier]))) {
    return { published: true, status: 'published' };
  }
  // Reviewed and found not to work is a settled answer, not a pending one. The
  // page words the two differently, so the difference has to survive to it.
  const refused = CARRIERS.some(
    (carrier) =>
      entry.claims[carrier]?.value === 'unsupported' &&
      entry.claims[carrier].provenance !== 'sonyDocumentation',
  );
  return {
    published: false,
    status: refused ? 'reviewedUnsupported' : 'awaitingReview',
  };
}

/**
 * A claim only carries a green verdict when a reviewed hardware report backs
 * it. Sony's tables describe what a body can do; they are not evidence that
 * Lutaro has been run against it. Applied per claim, not per entry: an entry
 * published on a reviewed Wi-Fi route must not turn an undocumented USB route
 * green on the strength of its neighbour.
 */
function isReviewedSupport(claim) {
  return claim?.value === 'supported' && claim.provenance !== 'sonyDocumentation';
}

/**
 * How Lutaro reaches a camera on each platform, per carrier. This is a fact
 * about the APP, identical for every body, so it belongs here rather than in the
 * catalog: the catalog records whether the BODY speaks a carrier at all.
 *
 *  - Wi-Fi (Sony PTP-IP) is Lutaro's route on every platform.
 *  - USB carries Sony's vendor PTP through ImageCaptureCore on iPhone and iPad,
 *    and through Sony's Camera Remote SDK on the Mac.
 */
const PLATFORM_CARRIERS = {
  mobile: { label: 'iPhone & iPad', carriers: { ptpIP: 'Wi-Fi', usbPTP: 'USB' } },
  mac: { label: 'Mac', carriers: { ptpIP: 'Wi-Fi', usbPTP: 'USB' } },
};

/**
 * Sony's own help guide per body - presentation only, never a support claim.
 * A body with no entry here simply renders without a help-guide link.
 */
const HELP_GUIDES = {
  'ILCE-6700': 'https://helpguide.sony.net/ilc/2320/v1/en/index.html',
  'DSC-RX100M7': 'https://helpguide.sony.net/dsc/1920/v1/en/index.html',
};

const PICTURE_PROFILE_LABELS = {
  full: {
    label: 'Full',
    tone: 'yes',
    detail: 'Read and write every Picture Profile setting in a slot.',
  },
  selectorOnly: {
    label: 'Selector only',
    tone: 'partial',
    detail:
      'Lutaro can choose which Picture Profile slot the camera is using, but cannot read or change the settings inside it.',
  },
  none: {
    label: 'Unavailable',
    tone: 'no',
    detail: 'This body exposes no Picture Profile control over a remote connection.',
  },
};

const EVIDENCE_LABELS = {
  sonyDocumentation: "Sony's published command tables",
  reviewedHardwareReport: 'a reviewed report from real hardware',
  both: "Sony's published command tables and a reviewed report from real hardware",
};

// The badge carries the whole verdict; "Not reviewed" is defined once in the
// page's glossary rather than repeated under every row it applies to.
const NOT_REVIEWED = { label: 'Not reviewed', tone: 'unreviewed', detail: '' };

function platformSupport(entry, platform) {
  const { label, carriers } = PLATFORM_CARRIERS[platform];
  const routes = Object.entries(carriers)
    .filter(([carrier]) => isReviewedSupport(entry.claims[carrier]))
    .map(([, name]) => name)
    .sort();
  if (routes.length === 0) {
    const refused = Object.keys(carriers).some(
      (carrier) => entry.claims[carrier]?.value === 'unsupported',
    );
    return refused
      ? { platform: label, label: 'Not supported', tone: 'no', detail: 'No reviewed connection route.' }
      : { platform: label, ...NOT_REVIEWED };
  }
  return { platform: label, label: routes.join(' or '), tone: 'yes', detail: '' };
}

function featureSupport(entry, field, feature) {
  const claim = entry.claims[field];
  if (!claim) return { ...NOT_REVIEWED };
  return isReviewedSupport(claim)
    ? { label: 'Supported', tone: 'yes', detail: '', source: EVIDENCE_LABELS[claim.provenance] }
    : {
        label: claim.value === 'supported' ? 'Not reviewed' : 'Not supported',
        tone: claim.value === 'supported' ? 'unreviewed' : 'no',
        detail:
          claim.value === 'supported' ? '' : `This body offers no ${feature} over a remote connection.`,
        source: claim.value === 'supported' ? '' : EVIDENCE_LABELS[claim.provenance],
      };
}

function firmwareNote(scope) {
  if (scope.kind === 'minimum') return `Firmware ${scope.value} or later`;
  if (scope.kind === 'exact') return `Firmware ${scope.value}`;
  return 'Any firmware (the evidence states no version)';
}

/**
 * The provenance behind one platform row. Unioning provenance across the whole
 * entry would let a hardware-reviewed carrier lend its credibility to a
 * documentation-only one, so each row states only what its own claims rest on.
 */
function platformProvenance(entry, platform) {
  const kinds = new Set(
    Object.keys(PLATFORM_CARRIERS[platform].carriers)
      .map((carrier) => entry.claims[carrier]?.provenance)
      .filter(Boolean),
  );
  if (kinds.size === 0) return '';
  if (kinds.size > 1 || kinds.has('both')) return EVIDENCE_LABELS.both;
  return EVIDENCE_LABELS[[...kinds][0]];
}

/** One camera, shaped for the page. */
function entryView(entry) {
  const ppClaim = entry.claims.pictureProfile;
  const pictureProfile = ppClaim
    ? { ...PICTURE_PROFILE_LABELS[ppClaim.value], source: EVIDENCE_LABELS[ppClaim.provenance] }
    : { ...NOT_REVIEWED, source: '' };
  return {
    bodyCode: entry.bodyCode,
    marketingName: entry.marketingName,
    aliases: entry.aliases ?? [],
    platforms: ['mobile', 'mac'].map((platform) => ({
      ...platformSupport(entry, platform),
      source: platformProvenance(entry, platform),
    })),
    pictureProfile,
    // Creative Look and Creative Style are two different Sony features and the
    // catalog carries a claim for neither yet, so both render as "not reviewed"
    // rather than being folded into the Picture Profile verdict.
    creativeLook: { ...NOT_REVIEWED, source: '' },
    creativeStyle: { ...NOT_REVIEWED, source: '' },
    remoteShutter: featureSupport(entry, 'remoteShutter', 'remote shutter release'),
    liveView: featureSupport(entry, 'liveView', 'live view'),
    evidence: {
      firmware: firmwareNote(entry.firmwareScope),
      reviewDate: entry.reviewDate,
      sourceIssue: entry.sourceIssue,
      divergences: (entry.unresolvedDivergences ?? []).map(
        (d) => `${d.field}: conflicting evidence says ${d.value} (${EVIDENCE_LABELS[d.provenance]})`,
      ),
    },
    helpGuide: HELP_GUIDES[entry.bodyCode] ?? null,
  };
}

/**
 * The page's whole data set: validated, gated, and sorted by marketing name.
 * `withheld` is a count only - naming a body Lutaro does not yet support would
 * itself read as a support claim.
 */
export function catalogView(raw) {
  const catalog = loadCatalog(raw);
  const published = [];
  const withheld = { awaitingReview: 0, reviewedUnsupported: 0 };
  for (const entry of catalog.entries) {
    const decision = publicationDecision(entry);
    if (decision.published) published.push(entryView(entry));
    else withheld[decision.status] += 1;
  }
  published.sort((a, b) => a.marketingName.localeCompare(b.marketingName, 'en'));
  return { cameras: published, withheld };
}
