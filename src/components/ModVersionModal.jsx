import { useState, useEffect, useCallback, useMemo, useRef, memo } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { save } from '@tauri-apps/plugin-dialog';
import { ExternalLink, RotateCcw, Trash2 } from 'lucide-react';
import ProjectDetailsEntityModal from './ProjectDetailsEntityModal';
import { stripMinecraftVersionFromNumber, stripMinecraftVersionFromTitle } from '../utils/versionDisplay';
import './ModVersionModal.css';

const getFullSizeUrl = (img) => {
  if (img?.raw_url) {
    return img.raw_url;
  }
  const url = img?.url || img?.thumbnailUrl || '';
  if (!url) return '';
  const clean = url.split('?')[0];
  return clean.replace(/_\d+\.(webp|png|jpg|jpeg|gif)$/i, '.$1');
};

const MODAL_CLOSE_ANIMATION_MS = 220;

const LOADER_CATEGORIES = [
  'fabric',
  'forge',
  'neoforge',
  'quilt',
  'bukkit',
  'folia',
  'paper',
  'spigot',
  'sponge',
  'bungeecord',
  'velocity',
  'waterfall',
  'purpur',
  'rift',
  'liteloader',
  'modloader',
  'risugamis-modloader'
];

const formatCategory = (cat) => {
  if (!cat) return '';
  const specialCases = {
    worldgen: 'World Generation',
    'vanilla-like': 'Vanilla-like',
    'core-shaders': 'Core Shaders',
    'game-mechanics': 'Game Mechanics'
  };
  if (specialCases[String(cat).toLowerCase()]) return specialCases[String(cat).toLowerCase()];
  return String(cat)
    .split(/[_-]/)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ');
};

const filterContentCategories = (categories) => {
  if (!categories) return [];
  return categories.filter((cat) => !LOADER_CATEGORIES.includes(String(cat).toLowerCase()));
};

const isCurseForgeProjectId = (value) => /^\d+$/.test(String(value || '').trim());

const getCurseForgeSectionForType = (projectType) => {
  const normalized = String(projectType || '').toLowerCase();
  if (normalized === 'modpack') return 'modpacks';
  if (normalized === 'world') return 'worlds';
  if (normalized === 'resourcepack') return 'texture-packs';
  if (normalized === 'shader') return 'shaders';
  if (normalized === 'datapack') return 'data-packs';
  return 'mc-mods';
};

const normalizeLoaderToken = (value) => {
  const input = String(value || '').trim().toLowerCase();
  if (!input) return '';
  const compact = input.replace(/[^a-z0-9]/g, '');
  if (compact.includes('neoforge')) return 'neoforge';
  if (compact.includes('fabric')) return 'fabric';
  if (compact.includes('quilt')) return 'quilt';
  if (compact.includes('forge')) return 'forge';
  if (compact.includes('vanilla')) return 'vanilla';
  return compact;
};

const normalizeGameVersionToken = (value) => String(value || '').trim().toLowerCase().replace(/^v/, '');

const parseVersionParts = (value) => {
  const match = String(value || '').match(/\d+(?:\.\d+){1,3}/);
  if (!match) return null;
  return match[0].split('.').map((part) => Number(part));
};

const compareVersionParts = (left, right) => {
  const maxLength = Math.max(left.length, right.length);
  for (let i = 0; i < maxLength; i += 1) {
    const leftPart = left[i] ?? 0;
    const rightPart = right[i] ?? 0;
    if (leftPart > rightPart) return 1;
    if (leftPart < rightPart) return -1;
  }
  return 0;
};

const sameVersionPrefix = (left, right, depth) => {
  for (let i = 0; i < depth; i += 1) {
    if ((left[i] ?? null) !== (right[i] ?? null)) return false;
  }
  return true;
};

const getPatchPart = (parts) => (Array.isArray(parts) ? (parts[2] ?? 0) : 0);

const compareParsedVersionParts = (leftParts, rightParts) => {
  if (!leftParts && !rightParts) return 0;
  if (!leftParts) return -1;
  if (!rightParts) return 1;
  return compareVersionParts(leftParts, rightParts);
};

const getTokenCompatibilityScore = (entry, requestedGameVersion) => {
  const token = normalizeGameVersionToken(entry);
  if (!token) return 0;

  const targetParts = parseVersionParts(requestedGameVersion);
  if (!targetParts) {
    return token === requestedGameVersion ? 1000 : 0;
  }

  const rangeMatch = token.match(/(\d+(?:\.\d+){1,3})\s*[-–—]\s*(\d+(?:\.\d+){1,3})/);
  if (rangeMatch) {
    const startParts = parseVersionParts(rangeMatch[1]);
    const endParts = parseVersionParts(rangeMatch[2]);
    if (startParts && endParts) {
      const inRange = compareVersionParts(targetParts, startParts) >= 0 && compareVersionParts(targetParts, endParts) <= 0;
      if (inRange) {
        return 5000 + getPatchPart(endParts);
      }
      if (sameVersionPrefix(targetParts, endParts, 2) && compareVersionParts(targetParts, endParts) > 0) {
        return 4000 + getPatchPart(endParts);
      }
      return 0;
    }
  }

  const tokenParts = parseVersionParts(token);
  if (!tokenParts) return 0;

  if (compareVersionParts(targetParts, tokenParts) === 0) {
    return 4900 + getPatchPart(tokenParts);
  }

  if (tokenParts.length <= 2 && sameVersionPrefix(targetParts, tokenParts, tokenParts.length)) {
    return 3500;
  }

  if (sameVersionPrefix(targetParts, tokenParts, 2)) {
    if (compareVersionParts(targetParts, tokenParts) > 0) {
      return 4000 + getPatchPart(tokenParts);
    }
    return 3000 + getPatchPart(tokenParts);
  }

  if (sameVersionPrefix(targetParts, tokenParts, 1)) {
    return 1000;
  }

  return 0;
};

const getVersionCompatibilityScore = (versionGameVersions, requestedGameVersion) => {
  const target = normalizeGameVersionToken(requestedGameVersion);
  if (!target) return Number.MAX_SAFE_INTEGER;
  if (!Array.isArray(versionGameVersions) || versionGameVersions.length === 0) return 1;
  return versionGameVersions.reduce((best, entry) => {
    const score = getTokenCompatibilityScore(entry, target);
    return Math.max(best, score);
  }, 0);
};

const hasDirectVersionMatch = (versionGameVersions, requestedGameVersion) => {
  const target = normalizeGameVersionToken(requestedGameVersion);
  if (!target) return false;
  if (!Array.isArray(versionGameVersions) || versionGameVersions.length === 0) return false;
  return versionGameVersions.some((entry) => getTokenCompatibilityScore(entry, target) >= 4900);
};

const isLoaderSensitiveProjectType = (projectType) => {
  const normalized = String(projectType || '').toLowerCase();
  return normalized === 'mod' || normalized === 'modpack';
};

const matchesRequestedGameVersion = (versionGameVersions, requestedGameVersion) => {
  return getVersionCompatibilityScore(versionGameVersions, requestedGameVersion) > 0;
};

const matchesRequestedLoader = (versionLoaders, requestedLoader, projectType) => {
  if (!isLoaderSensitiveProjectType(projectType)) return true;
  const target = normalizeLoaderToken(requestedLoader);
  if (!target || target === 'vanilla') return true;
  if (!Array.isArray(versionLoaders) || versionLoaders.length === 0) return true;
  const normalized = versionLoaders.map((entry) => normalizeLoaderToken(entry)).filter(Boolean);
  return normalized.includes(target);
};

const getPrimaryGameVersionLabel = (version, fallbackGameVersion) => {
  const entries = (version?.game_versions || []).filter((entry) => /\d+\.\d+/.test(String(entry || '')));
  if (entries.length === 0) return fallbackGameVersion || null;

  const target = normalizeGameVersionToken(fallbackGameVersion);
  const best = entries.reduce((currentBest, entry) => {
    const score = getTokenCompatibilityScore(entry, target);
    const parts = parseVersionParts(entry);
    if (!currentBest) {
      return { entry, score, parts };
    }
    if (score > currentBest.score) {
      return { entry, score, parts };
    }
    if (score === currentBest.score && compareParsedVersionParts(parts, currentBest.parts) > 0) {
      return { entry, score, parts };
    }
    return currentBest;
  }, null);

  return best?.entry || entries[0] || fallbackGameVersion || null;
};

const getLoaderSummaryLabel = (version, fallbackLoader) => {
  const loaders = Array.from(new Set((version?.loaders || []).filter(Boolean)));
  if (loaders.length === 0) return fallbackLoader || null;
  if (loaders.length <= 2) return loaders.join(' + ');
  return `${loaders.slice(0, 2).join(' + ')} +${loaders.length - 2}`;
};

const extractSemanticVersion = (value) => {
  const input = String(value || '');
  const match = input.match(/\d+\.\d+(?:\.\d+){0,2}(?:[-+._][0-9a-z]+)*/i);
  return match ? match[0] : null;
};

const resolveDisplayVersionNumber = ({ rawVersion, cleanVersion, cleanTitle, rawTitle }) => {
  const normalizedClean = String(cleanVersion || '').trim();
  const fallbackFromTitle = extractSemanticVersion(cleanTitle) || extractSemanticVersion(rawTitle);

  if (!normalizedClean) {
    return fallbackFromTitle || String(rawVersion || '').trim();
  }

  if (/^\d+$/.test(normalizedClean) && fallbackFromTitle) {
    return fallbackFromTitle;
  }

  return normalizedClean;
};

const sanitizeDisplayTitle = (value, fallbackValue = '') => {
  const fallback = String(fallbackValue || '').trim();
  let text = String(value || '').trim();
  if (!text) return fallback;

  text = text.replace(/[\s\-–—:|]+$/g, '').trim();
  text = text.replace(/\b(?:for|on|with|mc|minecraft)\s*$/i, '').trim();
  text = text.replace(/[\s\-–—:|]+$/g, '').trim();

  return text || fallback;
};

const buildVersionSubtitle = ({
  rawVersion,
  rawTitle,
  cleanTitle,
  displayVersionNumber,
  gameVersionLabel
}) => {
  const rawVersionText = String(rawVersion || '').trim();
  const titleText = String(cleanTitle || rawTitle || '').trim();
  const baseVersionText = String(displayVersionNumber || '').trim();
  const hasGameVersion = Boolean(gameVersionLabel && String(gameVersionLabel).trim());
  const gamePrefix = hasGameVersion ? `[${String(gameVersionLabel).trim()}] ` : '';

  if (/^\d+$/.test(rawVersionText) && titleText) {
    return `${gamePrefix}${titleText}`.trim();
  }

  if (!baseVersionText && titleText) {
    return `${gamePrefix}${titleText}`.trim();
  }

  const normalizedGame = normalizeGameVersionToken(gameVersionLabel);
  const alreadyContainsGame = normalizedGame && normalizeGameVersionToken(baseVersionText).includes(normalizedGame);
  if (hasGameVersion && !alreadyContainsGame) {
    return `${gamePrefix}${baseVersionText}`.trim();
  }

  return baseVersionText || titleText;
};

function ModVersionModal({
  project: initialProject,
  projectId,
  gameVersion,
  loader,
  onSelect,
  onClose,
  installedMod,
  onUninstall,
  onReinstall
}) {
  const [project, setProject] = useState(initialProject);
  const [versions, setVersions] = useState([]);
  const [showAllVersions, setShowAllVersions] = useState(false);
  const [dependencies, setDependencies] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadingDeps, setLoadingDeps] = useState(false);
  const [error, setError] = useState(null);
  const [isClosing, setIsClosing] = useState(false);
  const closeTimeoutRef = useRef(null);

  const requestClose = useCallback(() => {
    if (isClosing) return;
    setIsClosing(true);
    if (closeTimeoutRef.current) {
      clearTimeout(closeTimeoutRef.current);
    }
    closeTimeoutRef.current = setTimeout(() => {
      onClose();
    }, MODAL_CLOSE_ANIMATION_MS);
  }, [isClosing, onClose]);

  useEffect(() => () => {
    if (closeTimeoutRef.current) {
      clearTimeout(closeTimeoutRef.current);
    }
  }, []);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const targetId = projectId || initialProject?.project_id || initialProject?.slug;
      const preferredProvider = String(
        initialProject?.provider_label
        || initialProject?.provider
        || installedMod?.provider
        || ''
      ).toLowerCase();
      const useCurseForge = preferredProvider.includes('curseforge') || isCurseForgeProjectId(targetId);

      if (useCurseForge) {
        const [cfProject, cfVersions] = await Promise.all([
          invoke('get_curseforge_modpack', { projectId: String(targetId) }),
          invoke('get_curseforge_modpack_versions', { projectId: String(targetId) })
        ]);

        const sortedResults = [...(cfVersions || [])].sort((a, b) => {
          const typeOrder = { release: 0, beta: 1, alpha: 2 };
          const left = typeOrder[String(a?.version_type || 'release').toLowerCase()] ?? 99;
          const right = typeOrder[String(b?.version_type || 'release').toLowerCase()] ?? 99;
          if (left !== right) return left - right;
          return new Date(b.date_published) - new Date(a.date_published);
        });

        const resolvedProjectType = String(
          initialProject?.project_type || cfProject?.project_type || 'mod'
        ).toLowerCase();
        const compatibleResults = sortedResults.filter((version) => (
          matchesRequestedGameVersion(version?.game_versions, gameVersion)
          && matchesRequestedLoader(version?.loaders, loader, resolvedProjectType)
        ));

        const derivedLoaders = Array.from(new Set(
          compatibleResults.flatMap((version) => Array.isArray(version.loaders) ? version.loaders : [])
        ));
        const derivedGameVersions = Array.from(new Set(
          compatibleResults
            .flatMap((version) => Array.isArray(version.game_versions) ? version.game_versions : [])
            .filter((entry) => /\d+\.\d+/.test(String(entry)))
        ));

        setProject((prev) => ({
          ...initialProject,
          ...prev,
          ...cfProject,
          provider_label: 'CurseForge',
          project_type: resolvedProjectType,
          loaders: derivedLoaders,
          game_versions: derivedGameVersions
        }));
        setVersions(sortedResults);
        setDependencies([]);
        setLoadingDeps(false);
      } else {
        const fullProject = await invoke('get_modrinth_project', { projectId: targetId });

        setProject((prev) => {
          const currentAuthor = prev?.author || initialProject?.author;
          const newAuthor = (fullProject.author && fullProject.author !== '' && fullProject.author !== 'Unknown' && fullProject.author !== 'Unknown Creator')
            ? fullProject.author
            : (currentAuthor && currentAuthor !== 'Unknown Creator' ? currentAuthor : 'Unknown Creator');

          const allCategories = prev?.categories || initialProject?.categories || fullProject.categories || [];
          return {
            ...initialProject,
            ...prev,
            ...fullProject,
            author: newAuthor,
            provider_label: 'Modrinth',
            categories: allCategories.length > 0 ? allCategories : (fullProject.categories || [])
          };
        });

        let loaderFilter = loader?.toLowerCase() || null;
        const projectType = (fullProject.project_type || '').toLowerCase();
        if (projectType === 'resourcepack' || projectType === 'shader' || projectType === 'datapack') {
          loaderFilter = null;
        }

        const results = await invoke('get_modrinth_versions', {
          projectId: targetId,
          gameVersion,
          loader: loaderFilter
        });

        const sortedResults = results.sort((a, b) => {
          const typeOrder = { release: 0, beta: 1, alpha: 2 };
          if (typeOrder[a.version_type] !== typeOrder[b.version_type]) {
            return typeOrder[a.version_type] - typeOrder[b.version_type];
          }
          return new Date(b.date_published) - new Date(a.date_published);
        });
        setVersions(sortedResults);

        if (sortedResults.length > 0) {
          const latestVersion = sortedResults[0];
          if (latestVersion.dependencies && latestVersion.dependencies.length > 0) {
            setLoadingDeps(true);
            try {
              const projectIds = latestVersion.dependencies
                .map((dep) => dep.project_id)
                .filter(Boolean);

              if (projectIds.length > 0) {
                const depProjects = await invoke('get_modrinth_projects', { projectIds });
                const enrichedDeps = depProjects.map((depProject) => {
                  const depInfo = latestVersion.dependencies.find((dep) => dep.project_id === (depProject.project_id || depProject.id));
                  return { ...depProject, dependency_type: depInfo?.dependency_type };
                });
                setDependencies(enrichedDeps);
              } else {
                setDependencies([]);
              }
            } catch (depErr) {
              console.error('Failed to load dependencies:', depErr);
            } finally {
              setLoadingDeps(false);
            }
          } else {
            setDependencies([]);
          }
        } else {
          setDependencies([]);
        }
      }
    } catch (err) {
      console.error('Failed to load mod data:', err);
      setError('Failed to fetch project data');
    }
    setLoading(false);
  }, [projectId, initialProject, gameVersion, loader, installedMod]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  useEffect(() => {
    setShowAllVersions(false);
  }, [projectId, gameVersion, loader, initialProject?.project_id, initialProject?.slug]);

  const formatDate = useCallback((dateStr) => {
    const date = new Date(dateStr);
    return date.toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    });
  }, []);

  const formatNumber = useCallback((num) => {
    if (num >= 1000000) return `${(num / 1000000).toFixed(1)}M`;
    if (num >= 1000) return `${(num / 1000).toFixed(1)}K`;
    return `${num}`;
  }, []);

  const handleCopyImage = useCallback(async (galleryImg) => {
    try {
      const fullUrl = getFullSizeUrl(galleryImg);
      const response = await fetch(fullUrl, { referrerPolicy: 'no-referrer' });
      const blob = await response.blob();

      if (!window.ClipboardItem) {
        throw new Error('ClipboardItem not supported');
      }

      const item = new ClipboardItem({ [blob.type]: blob });
      await navigator.clipboard.write([item]);
    } catch (err) {
      console.error('Failed to copy image:', err);
    }
  }, []);

  const handleSaveImage = useCallback(async (galleryImg) => {
    try {
      const fullUrl = getFullSizeUrl(galleryImg);
      const url = new URL(fullUrl);
      const originalFilename = url.pathname.split('/').pop() || 'image.png';
      const filePath = await save({
        defaultPath: originalFilename,
        filters: [{ name: 'Image', extensions: ['png', 'jpg', 'jpeg', 'webp'] }]
      });
      if (filePath) {
        await invoke('save_remote_file', { url: fullUrl, path: filePath });
      }
    } catch (err) {
      console.error('Failed to save image:', err);
    }
  }, []);

  const handleOpenProjectPage = useCallback(() => {
    const slug = project?.slug || project?.project_id || projectId;
    if (!slug) return;
    const provider = String(project?.provider_label || '').toLowerCase();
    if (provider === 'curseforge') {
      const section = getCurseForgeSectionForType(project?.project_type);
      const url = project?.website_url || `https://www.curseforge.com/minecraft/${section}/${slug}`;
      invoke('open_url', { url });
    } else {
      const type = project?.project_type || 'mod';
      invoke('open_url', { url: `https://modrinth.com/${type}/${slug}` });
    }
  }, [project, projectId]);

  const compatibilityVersions = (
    (project?.game_versions && project.game_versions.length > 0)
      ? project.game_versions
      : Array.from(new Set(versions.flatMap((version) => version?.game_versions || []).filter((value) => /\d+\.\d+/.test(String(value))))
      )
  ).slice().reverse();
  const providerLabel = project?.provider_label || 'Modrinth';
  const resolvedProjectType = String(project?.project_type || initialProject?.project_type || 'mod').toLowerCase();
  const compatibilityMeta = useMemo(() => {
    const loaderFiltered = versions.filter((version) => (
      matchesRequestedLoader(version?.loaders, loader, resolvedProjectType)
    ));
    const scored = loaderFiltered
      .map((version) => ({
        version,
        score: getVersionCompatibilityScore(version?.game_versions, gameVersion)
      }))
      .filter((item) => item.score > 0);

    if (scored.length === 0) {
      return {
        bestScore: 0,
        bestVersions: [],
        hasAnyDirectMatch: false
      };
    }

    const bestScore = scored.reduce((best, item) => Math.max(best, item.score), 0);
    const bestVersions = scored.filter((item) => item.score === bestScore).map((item) => item.version);
    const hasAnyDirectMatch = scored.some((item) => hasDirectVersionMatch(item.version?.game_versions, gameVersion));

    return {
      bestScore,
      bestVersions,
      hasAnyDirectMatch
    };
  }, [versions, gameVersion, loader, resolvedProjectType]);
  const filteredVersions = useMemo(() => {
    if (showAllVersions) return versions;
    return compatibilityMeta.bestVersions;
  }, [versions, showAllVersions, compatibilityMeta]);
  const showFallbackNotice = !showAllVersions
    && filteredVersions.length > 0
    && compatibilityMeta.bestScore > 0
    && compatibilityMeta.bestScore < 4900
    && !compatibilityMeta.hasAnyDirectMatch;
  const installedVersion = useMemo(() => {
    const target = String(installedMod?.version_id || '').trim();
    if (!target) return null;
    return versions.find((version) => String(version?.id || '').trim() === target) || null;
  }, [installedMod?.version_id, versions]);
  const hiddenVersionCount = Math.max(0, versions.length - filteredVersions.length);
  const categories = filterContentCategories(project?.categories || []);
  const loaders = (project?.loaders && project.loaders.length > 0)
    ? project.loaders
    : Array.from(new Set(versions.flatMap((version) => version?.loaders || [])));
  const galleryItems = (project?.gallery || []).map((img) => ({
    type: 'image',
    url: img?.url || '',
    thumbnailUrl: img?.url || '',
    raw_url: img?.raw_url || null,
    title: img?.title || '',
    description: img?.description || ''
  }));

  const versionsContent = loading ? (
    <div className="versions-loading">
      <div className="spinner small"></div>
    </div>
  ) : versions.length === 0 ? (
    <div className="empty-state mini">No versions found</div>
  ) : (
    <div className="versions-small-list-wrap">
      {versions.length > 0 && (
        <div className="versions-filter-toggle-row">
          <button
            type="button"
            className="versions-filter-toggle"
            onClick={() => setShowAllVersions((prev) => !prev)}
          >
            {showAllVersions
              ? 'Show compatible only'
              : (hiddenVersionCount > 0 ? `Show all versions (+${hiddenVersionCount})` : 'Show all versions')}
          </button>
        </div>
      )}
      {showFallbackNotice && (
        <div className="versions-compat-note" role="status">
          No version is marked specifically for Minecraft {gameVersion}. Showing the newest likely-compatible version instead.
        </div>
      )}
      {filteredVersions.length === 0 ? (
        <div className="empty-state mini">No versions found for this Minecraft/loader combo</div>
      ) : (
      <div className="versions-small-list">
      {filteredVersions.map((version) => {
        const isInstalled = installedMod?.version_id === version.id;
        const versionType = String(version?.version_type || 'release').toLowerCase();
        const gameVersionLabel = getPrimaryGameVersionLabel(version, gameVersion);
        const loaderLabel = getLoaderSummaryLabel(version, loader);
        const rawTitle = version.name || version.version_number || version.id;
        const strippedTitle = stripMinecraftVersionFromTitle(rawTitle, gameVersionLabel || gameVersion) || rawTitle;
        const cleanTitle = sanitizeDisplayTitle(strippedTitle, rawTitle);
        const rawVersion = version.version_number || version.id;
        const cleanVersion = stripMinecraftVersionFromNumber(rawVersion, gameVersionLabel || gameVersion) || rawVersion;
        const displayVersionNumber = resolveDisplayVersionNumber({
          rawVersion,
          cleanVersion,
          cleanTitle,
          rawTitle
        });
        const displaySubtitle = buildVersionSubtitle({
          rawVersion,
          rawTitle,
          cleanTitle,
          displayVersionNumber,
          gameVersionLabel
        });
        return (
          <div
            key={version.id}
            className={`version-mini-item ${isInstalled ? 'installed' : ''}`}
            onClick={() => onSelect(version)}
          >
            <div className="mini-item-top">
              <div className="mini-title-block">
                <span className="mini-name" title={rawTitle}>{cleanTitle}</span>
                <span className="mini-number" title={displaySubtitle}>{displaySubtitle}</span>
              </div>
              <div className="mini-item-tags">
                <span className={`version-type-pill ${versionType}`}>{versionType}</span>
              </div>
            </div>
            <div className="mini-item-bottom">
              <div className="mini-meta-row">
                {gameVersionLabel && <span className="mini-meta-chip">{gameVersionLabel}</span>}
                {loaderLabel && <span className="mini-meta-chip">{loaderLabel}</span>}
              </div>
              <span className="mini-date">{formatDate(version.date_published)}</span>
            </div>
          </div>
        );
      })}
      </div>
      )}
    </div>
  );

  return (
    <ProjectDetailsEntityModal
      onClose={requestClose}
      isClosing={isClosing}
      loading={loading}
      error={error}
      header={{
        iconUrl: project?.icon_url || null,
        fallback: 'PK',
        title: project?.title || 'Loading...',
        author: project?.author || initialProject?.author || 'Unknown Creator',
        downloadsText: `${formatNumber(project?.downloads || 0)} downloads`,
        description: project?.description || ''
      }}
      platformLabel={providerLabel}
      details={{
        author: project?.author || initialProject?.author || 'Unknown Creator',
        downloadsText: `${formatNumber(project?.downloads || 0)} downloads`,
        projectId: project?.project_id || projectId || 'unknown'
      }}
      loaders={loaders}
      compatibilityVersions={compatibilityVersions}
      categories={categories}
      mapCategoryLabel={formatCategory}
      descriptionMarkdown={project?.body || ''}
      descriptionEmptyText="No description provided."
      galleryItems={galleryItems}
      galleryEmptyText="No gallery images available."
      dependencies={dependencies}
      dependenciesLoading={loadingDeps}
      dependenciesEmptyText="No dependencies listed for the latest version."
      showDependenciesTab={providerLabel === 'Modrinth'}
      onOpenDependencyExternal={(dep) => {
        const type = dep.project_type || 'mod';
        const slug = dep.slug || dep.project_id || dep.id;
        invoke('open_url', { url: `https://modrinth.com/${type}/${slug}` });
      }}
      versionsLabel="Compatible Versions"
      versionsTag={gameVersion}
      versionsContent={versionsContent}
      footerContent={(
        <>
          <button className="modrinth-link-btn" onClick={handleOpenProjectPage}>
            <ExternalLink size={14} />
            <span>{providerLabel === 'CurseForge' ? 'View on CurseForge' : 'View on Modrinth'}</span>
          </button>
          {installedMod && (
            <button
              className="reinstall-btn"
              onClick={() => {
                if (!installedVersion || !onReinstall) return;
                onReinstall({
                  project,
                  version: installedVersion,
                  installedItem: installedMod
                });
              }}
              disabled={!installedVersion}
              title={installedVersion ? 'Reinstall installed version' : 'Installed version is not in the current version list'}
            >
              <RotateCcw size={14} />
              <span>Reinstall</span>
            </button>
          )}
          {installedMod && typeof onUninstall === 'function' && (
            <button className="uninstall-btn" onClick={() => onUninstall(installedMod)}>
              <Trash2 size={14} />
              <span>Uninstall</span>
            </button>
          )}
          <button className="btn-secondary" onClick={requestClose}>Cancel</button>
        </>
      )}
      galleryActions={{
        onCopy: handleCopyImage,
        onSave: handleSaveImage
      }}
    />
  );
}

export default memo(ModVersionModal);
