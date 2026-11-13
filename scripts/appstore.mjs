// App Store Connect: push Docket's listing (apps/mobile/store/listing.json) and screenshots
// (assets/store) to the app record, so a release only needs the build upload and "Submit".
//
//   node scripts/appstore.mjs status                [--bundle-id <id>]
//   node scripts/appstore.mjs metadata [--dry-run]  category, age rating, names, texts, URLs
//   node scripts/appstore.mjs screenshots [--dry-run]  replaces the iPhone 6.9" and iPad 13" sets
//
// Env: ASC_KEY_ID, ASC_ISSUER_ID, ASC_KEY_PATH (App Store Connect API key, App Manager or
// Admin), DOCKET_SITE_URL (server that hosts /privacy.html and /support.html). The app record
// itself has to be created once on the website; the API can't create apps.
import { createHash, createPrivateKey, createSign } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const command = args[0];
const dryRun = args.includes('--dry-run');
const flag = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const appJson = JSON.parse(readFileSync(join(root, 'apps/mobile/app.json'), 'utf8')).expo;
const bundleId = flag('--bundle-id') ?? appJson.ios.bundleIdentifier;
const listing = JSON.parse(readFileSync(join(root, 'apps/mobile/store/listing.json'), 'utf8'));
/** App Store locale → screenshot language in assets/store. */
const shotLang = { 'zh-Hans': 'zh', 'en-US': 'en' };

// --- API -------------------------------------------------------------------------------------

const { ASC_KEY_ID: kid, ASC_ISSUER_ID: iss, ASC_KEY_PATH: keyPath } = process.env;
if (!kid || !iss || !keyPath) {
  console.error('Set ASC_KEY_ID, ASC_ISSUER_ID and ASC_KEY_PATH (e.g. `set -a; . ./.env.release; set +a`).');
  process.exit(1);
}
const key = createPrivateKey(readFileSync(keyPath));
function token() {
  const b64u = (v) => Buffer.from(v).toString('base64url');
  const now = Math.floor(Date.now() / 1000);
  const head = b64u(JSON.stringify({ alg: 'ES256', kid, typ: 'JWT' }));
  const body = b64u(JSON.stringify({ iss, iat: now, exp: now + 1100, aud: 'appstoreconnect-v1' }));
  const sig = createSign('SHA256').update(`${head}.${body}`).sign({ key, dsaEncoding: 'ieee-p1363' });
  return `${head}.${body}.${b64u(sig)}`;
}

async function api(method, path, body) {
  const writes = method !== 'GET';
  if (writes && dryRun) {
    console.log(
      `  [dry-run] ${method} ${path}${body ? ` ${JSON.stringify(body.data?.attributes ?? {})}` : ''}`,
    );
    return { data: { id: 'dry-run', attributes: {} } };
  }
  const res = await fetch(`https://api.appstoreconnect.apple.com${path}`, {
    method,
    headers: { Authorization: `Bearer ${token()}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  const json = text ? JSON.parse(text) : {};
  if (!res.ok) {
    const detail = (json.errors ?? []).map((e) => `${e.title}: ${e.detail ?? ''}`).join('; ');
    throw new Error(`${method} ${path} → ${res.status} ${detail}`);
  }
  return json;
}
const get = (path) => api('GET', path);
const rel = (type, id) => ({ data: { type, id } });

async function findApp() {
  const res = await get(
    `/v1/apps?filter[bundleId]=${encodeURIComponent(bundleId)}&fields[apps]=name,bundleId`,
  );
  const app = res.data.find((a) => a.attributes.bundleId === bundleId);
  if (!app) {
    console.error(
      `No App Store Connect app for ${bundleId}. Create it once at appstoreconnect.apple.com → Apps → +.`,
    );
    process.exit(2);
  }
  return app;
}

/** The app info being edited (not the live one). */
async function editableAppInfo(appId) {
  const infos = (await get(`/v1/apps/${appId}/appInfos`)).data;
  const live = ['READY_FOR_DISTRIBUTION', 'READY_FOR_SALE', 'REPLACED_WITH_NEW_INFO'];
  return infos.find((i) => !live.includes(i.attributes.state ?? i.attributes.appStoreState)) ?? infos[0];
}

async function editableVersion(appId, create) {
  const versions = (await get(`/v1/apps/${appId}/appStoreVersions?filter[platform]=IOS&limit=20`)).data;
  const editable = ['PREPARE_FOR_SUBMISSION', 'DEVELOPER_REJECTED', 'REJECTED', 'METADATA_REJECTED'];
  const version = versions.find((v) =>
    editable.includes(v.attributes.appStoreState ?? v.attributes.appVersionState),
  );
  if (version || !create) return version;
  console.log(`creating version ${appJson.version}`);
  return (
    await api('POST', '/v1/appStoreVersions', {
      data: {
        type: 'appStoreVersions',
        attributes: { platform: 'IOS', versionString: appJson.version },
        relationships: { app: rel('apps', appId) },
      },
    })
  ).data;
}

// --- commands ---------------------------------------------------------------------------------

async function status() {
  const app = await findApp();
  console.log(`app: ${app.attributes.name} (${bundleId})`);
  const info = await editableAppInfo(app.id);
  console.log(`app info: ${info.attributes.state ?? info.attributes.appStoreState}`);
  const locs = (await get(`/v1/appInfos/${info.id}/appInfoLocalizations`)).data;
  console.log(`  names: ${locs.map((l) => `${l.attributes.locale}=${l.attributes.name}`).join(', ')}`);
  const versions = (await get(`/v1/apps/${app.id}/appStoreVersions?filter[platform]=IOS&limit=5`)).data;
  for (const v of versions)
    console.log(
      `version ${v.attributes.versionString}: ${v.attributes.appStoreState ?? v.attributes.appVersionState}`,
    );
  const builds = (await get(`/v1/builds?filter[app]=${app.id}&limit=5&sort=-uploadedDate`)).data;
  for (const b of builds) console.log(`build ${b.attributes.version}: ${b.attributes.processingState}`);
}

async function metadata() {
  const site = process.env.DOCKET_SITE_URL?.replace(/\/$/, '');
  if (!site) throw new Error('Set DOCKET_SITE_URL to the server hosting /privacy.html and /support.html.');
  const app = await findApp();
  const info = await editableAppInfo(app.id);

  console.log('category');
  await api('PATCH', `/v1/appInfos/${info.id}`, {
    data: {
      type: 'appInfos',
      id: info.id,
      relationships: { primaryCategory: rel('appCategories', listing.primaryCategory) },
    },
  });

  console.log('age rating: no objectionable content');
  const rating = (await get(`/v1/appInfos/${info.id}/ageRatingDeclaration`)).data;
  const none = [
    'alcoholTobaccoOrDrugUseOrReferences',
    'contests',
    'gamblingSimulated',
    'gunsOrOtherWeapons',
    'horrorOrFearThemes',
    'matureOrSuggestiveThemes',
    'medicalOrTreatmentInformation',
    'profanityOrCrudeHumor',
    'sexualContentGraphicAndNudity',
    'sexualContentOrNudity',
    'violenceCartoonOrFantasy',
    'violenceRealistic',
    'violenceRealisticProlongedGraphicOrSadistic',
  ];
  const no = [
    'gambling',
    'unrestrictedWebAccess',
    'lootBox',
    'messagingAndChat',
    'parentalControls',
    'ageAssurance',
    'userGeneratedContent',
    'advertising',
    'healthOrWellnessTopics',
  ];
  const attrs = {};
  // Only fields Apple currently has (the questionnaire changes over time).
  for (const k of none) if (k in rating.attributes) attrs[k] = 'NONE';
  for (const k of no) if (k in rating.attributes) attrs[k] = false;
  await api('PATCH', `/v1/ageRatingDeclarations/${rating.id}`, {
    data: { type: 'ageRatingDeclarations', id: rating.id, attributes: attrs },
  });

  const infoLocs = (await get(`/v1/appInfos/${info.id}/appInfoLocalizations`)).data;
  for (const [locale, l] of Object.entries(listing.locales)) {
    console.log(`name and subtitle: ${locale}`);
    const attributes = { name: l.name, subtitle: l.subtitle, privacyPolicyUrl: `${site}/privacy.html` };
    const existing = infoLocs.find((x) => x.attributes.locale === locale);
    if (existing)
      await api('PATCH', `/v1/appInfoLocalizations/${existing.id}`, {
        data: { type: 'appInfoLocalizations', id: existing.id, attributes },
      });
    else
      await api('POST', '/v1/appInfoLocalizations', {
        data: {
          type: 'appInfoLocalizations',
          attributes: { locale, ...attributes },
          relationships: { appInfo: rel('appInfos', info.id) },
        },
      });
  }

  const version = await editableVersion(app.id, true);
  await api('PATCH', `/v1/appStoreVersions/${version.id}`, {
    data: { type: 'appStoreVersions', id: version.id, attributes: { copyright: listing.copyright } },
  });
  const versionLocs =
    version.id === 'dry-run'
      ? []
      : (await get(`/v1/appStoreVersions/${version.id}/appStoreVersionLocalizations`)).data;
  for (const [locale, l] of Object.entries(listing.locales)) {
    console.log(`description and keywords: ${locale}`);
    const attributes = {
      description: l.description,
      keywords: l.keywords,
      promotionalText: l.promotionalText,
      supportUrl: `${site}/support.html`,
    };
    const existing = versionLocs.find((x) => x.attributes.locale === locale);
    if (existing)
      await api('PATCH', `/v1/appStoreVersionLocalizations/${existing.id}`, {
        data: { type: 'appStoreVersionLocalizations', id: existing.id, attributes },
      });
    else
      await api('POST', '/v1/appStoreVersionLocalizations', {
        data: {
          type: 'appStoreVersionLocalizations',
          attributes: { locale, ...attributes },
          relationships: { appStoreVersion: rel('appStoreVersions', version.id) },
        },
      });
  }
}

async function upload(setId, file) {
  const bytes = readFileSync(file);
  const created = (
    await api('POST', '/v1/appScreenshots', {
      data: {
        type: 'appScreenshots',
        attributes: { fileName: basename(file), fileSize: statSync(file).size },
        relationships: { appScreenshotSet: rel('appScreenshotSets', setId) },
      },
    })
  ).data;
  if (dryRun) return;
  for (const op of created.attributes.uploadOperations) {
    const headers = Object.fromEntries((op.requestHeaders ?? []).map((h) => [h.name, h.value]));
    const res = await fetch(op.url, {
      method: op.method,
      headers,
      body: bytes.subarray(op.offset, op.offset + op.length),
    });
    if (!res.ok) throw new Error(`upload ${basename(file)} → ${res.status}`);
  }
  await api('PATCH', `/v1/appScreenshots/${created.id}`, {
    data: {
      type: 'appScreenshots',
      id: created.id,
      attributes: { uploaded: true, sourceFileChecksum: createHash('md5').update(bytes).digest('hex') },
    },
  });
}

async function screenshots() {
  const app = await findApp();
  const version = await editableVersion(app.id, false);
  if (!version) throw new Error('No editable App Store version; run `metadata` first.');
  const locs = (await get(`/v1/appStoreVersions/${version.id}/appStoreVersionLocalizations`)).data;
  for (const loc of locs) {
    const lang = shotLang[loc.attributes.locale];
    if (!lang) continue;
    const sets = (await get(`/v1/appStoreVersionLocalizations/${loc.id}/appScreenshotSets`)).data;
    for (const [displayType, files] of Object.entries(listing.screenshots)) {
      console.log(`${loc.attributes.locale} ${displayType}`);
      let set = sets.find((s) => s.attributes.screenshotDisplayType === displayType);
      if (set) {
        for (const shot of (await get(`/v1/appScreenshotSets/${set.id}/appScreenshots`)).data)
          await api('DELETE', `/v1/appScreenshots/${shot.id}`);
      } else {
        set = (
          await api('POST', '/v1/appScreenshotSets', {
            data: {
              type: 'appScreenshotSets',
              attributes: { screenshotDisplayType: displayType },
              relationships: { appStoreVersionLocalization: rel('appStoreVersionLocalizations', loc.id) },
            },
          })
        ).data;
      }
      for (const name of files)
        await upload(set.id, join(root, 'assets/store', name.replace('{lang}', lang)));
    }
  }
}

const commands = { status, metadata, screenshots };
if (!commands[command]) {
  console.error('usage: node scripts/appstore.mjs status|metadata|screenshots [--dry-run]');
  process.exit(1);
}
await commands[command]();
