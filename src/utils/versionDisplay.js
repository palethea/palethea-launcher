const JAR_OR_ZIP_RE = /\.(?:jar(?:\.disabled)?|zip)$/i;
const MC_VERSION_RE = /\b\d+\.\d+(?:\.\d+)?\b/g;

function normalizeVersionText(value) {
  const trimmed = String(value || '').trim();
  if (!trimmed) return null;
  return trimmed;
}

function escapeRegex(value) {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function getSanitizedGameVersion(gameVersion) {
  return String(gameVersion || '').trim().replace(/^v/i, '');
}

function stripArchiveExtension(value) {
  return value.replace(JAR_OR_ZIP_RE, '');
}

function extractTrailingVersion(value) {
  const match = value.match(/(\d+(?:\.\d+){1,4}(?:[a-z]\d*)?(?:[-+._][0-9a-z]+)*)$/i);
  return match ? match[1] : null;
}

function extractVersionFromFilename(filename) {
  const base = stripArchiveExtension(normalizeVersionText(filename) || '').trim();
  if (!base) return null;

  const trailingVersion = extractTrailingVersion(base);
  if (trailingVersion) return trailingVersion;

  const bracketedVersion = base.match(/\[(\d+(?:\.\d+){1,4}(?:[a-z]\d*)?(?:[-+._][0-9a-z]+)*)\]/i);
  if (bracketedVersion?.[1]) return bracketedVersion[1];

  return null;
}

export function formatInstalledVersionLabel(version, provider, filename) {
  const raw = normalizeVersionText(version);
  const providerKey = String(provider || '').toLowerCase();
  const filenameVersion = extractVersionFromFilename(filename);

  if (!raw) {
    return filenameVersion;
  }

  if (providerKey !== 'curseforge') {
    return raw;
  }

  const base = stripArchiveExtension(raw).trim();
  if (!base) return null;

  const trailingVersion = extractTrailingVersion(base);
  if (trailingVersion) {
    return trailingVersion;
  }

  const embeddedVersions = base.match(MC_VERSION_RE);
  if (embeddedVersions?.length) {
    return embeddedVersions[embeddedVersions.length - 1];
  }

  const filenameBase = stripArchiveExtension(normalizeVersionText(filename) || '').trim().toLowerCase();
  if (filenameBase && filenameBase === base.toLowerCase()) {
    return filenameVersion;
  }

  if (base.length > 32) {
    return filenameVersion;
  }

  return base;
}

export function withVersionPrefix(label) {
  const text = normalizeVersionText(label);
  if (!text) return null;
  return text;
}

export function stripMinecraftVersionFromTitle(title, gameVersion) {
  const raw = normalizeVersionText(title);
  if (!raw) return null;

  const normalizedGameVersion = getSanitizedGameVersion(gameVersion);
  let result = raw;

  result = result.replace(/^\s*\[[^\]]*?\d+\.\d+(?:\.\d+)?[^\]]*?\]\s*/g, '');

  if (normalizedGameVersion) {
    const exactGameVersionRe = new RegExp(`\\b(?:mc\\s*)?${escapeRegex(normalizedGameVersion)}\\b`, 'ig');
    result = result.replace(exactGameVersionRe, '');
  }

  result = result.replace(/\b(?:minecraft|mc)\s*version\b/ig, '');
  result = result.replace(/[|()[\]{}_-]+/g, ' ');
  result = result.replace(/\s{2,}/g, ' ').trim();

  if (/^0+$/.test(result)) {
    return raw;
  }

  return result || raw;
}

export function stripMinecraftVersionFromNumber(versionNumber, gameVersion) {
  const raw = normalizeVersionText(versionNumber);
  if (!raw) return null;

  const normalizedGameVersion = getSanitizedGameVersion(gameVersion);
  let result = raw;

  if (normalizedGameVersion) {
    const suffixRe = new RegExp(`(?:[+._-](?:mc)?${escapeRegex(normalizedGameVersion)})+$`, 'i');
    result = result.replace(suffixRe, '');

    const infixRe = new RegExp(`([+._-])(?:mc)?${escapeRegex(normalizedGameVersion)}([+._-])`, 'ig');
    result = result.replace(infixRe, '$1');
  }

  result = result.replace(/([+._-])(?:mc)?\d+\.\d+(?:\.\d+)?$/i, '');
  result = result.replace(/[+._-]{2,}/g, '.');
  result = result.replace(/[+._-]+$/g, '');
  result = result.trim();

  if (/^0+$/.test(result)) {
    return raw;
  }

  if (/^\d+$/.test(result) && normalizedGameVersion && raw.toLowerCase().includes(normalizedGameVersion.toLowerCase())) {
    return raw;
  }

  if (!result) {
    const fallback = raw.match(MC_VERSION_RE);
    return fallback?.[0] || raw;
  }

  return result;
}
