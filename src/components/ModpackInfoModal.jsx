import { useState, useEffect, useCallback, useMemo, memo } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { ExternalLink, RotateCcw } from 'lucide-react';
import {
  getEmbedVideoUrl,
  isVideoFileUrl
} from '../utils/markdownEmbeds';
import { stripMinecraftVersionFromNumber, stripMinecraftVersionFromTitle } from '../utils/versionDisplay';
import ProjectDetailsEntityModal from './ProjectDetailsEntityModal';
import './ModVersionModal.css';

const VERSION_TYPE_ORDER = { release: 0, beta: 1, alpha: 2 };

const normalizeProvider = (provider) => {
  const value = String(provider || '').trim().toLowerCase();
  if (value === 'curseforge') return 'curseforge';
  return 'modrinth';
};

const formatNumber = (num) => {
  const value = Number(num || 0);
  if (value >= 1000000) return `${(value / 1000000).toFixed(1)}M`;
  if (value >= 1000) return `${(value / 1000).toFixed(1)}K`;
  return `${Math.max(0, Math.floor(value))}`;
};

const formatDate = (dateStr) => {
  if (!dateStr) return 'Unknown';
  const date = new Date(dateStr);
  if (Number.isNaN(date.getTime())) return 'Unknown';
  return date.toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric'
  });
};

const toGalleryMediaItem = (item, fallbackPoster) => {
  const sourceUrl = String(item?.url || '').trim();
  const thumbnailUrl = String(item?.thumbnail_url || '').trim() || null;
  const title = item?.title || '';
  const description = item?.description || '';

  const embedUrl = getEmbedVideoUrl(sourceUrl || thumbnailUrl || '');
  if (embedUrl) {
    return {
      type: 'embed-video',
      url: sourceUrl,
      embedUrl,
      thumbnailUrl: thumbnailUrl || fallbackPoster || null,
      title,
      description
    };
  }

  if (isVideoFileUrl(sourceUrl)) {
    return {
      type: 'video',
      url: sourceUrl,
      thumbnailUrl: thumbnailUrl || fallbackPoster || null,
      title,
      description
    };
  }

  if (sourceUrl) {
    return {
      type: 'image',
      url: sourceUrl,
      thumbnailUrl,
      title,
      description
    };
  }

  if (thumbnailUrl) {
    return {
      type: 'image',
      url: thumbnailUrl,
      thumbnailUrl,
      title,
      description
    };
  }

  return null;
};

const getPrimaryGameVersionLabel = (version) => {
  return (version?.game_versions || []).find((entry) => /\d+\.\d+/.test(String(entry || ''))) || null;
};

const getLoaderSummaryLabel = (version) => {
  const loaders = Array.from(new Set((version?.loaders || []).filter(Boolean)));
  if (loaders.length === 0) return null;
  if (loaders.length <= 2) return loaders.join(' + ');
  return `${loaders.slice(0, 2).join(' + ')} +${loaders.length - 2}`;
};

function ModpackInfoModal({
  instance,
  iconUrl,
  onClose,
  onShowNotification,
  onInstancesRefresh,
  onQueueDownload,
  onUpdateDownloadStatus,
  onDequeueDownload
}) {
  const [project, setProject] = useState(null);
  const [versions, setVersions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [selectedVersionId, setSelectedVersionId] = useState('');
  const [installedVersionId, setInstalledVersionId] = useState(String(instance?.modpack_version_id || ''));
  const [switchingVersion, setSwitchingVersion] = useState(false);
  const [switchProgress, setSwitchProgress] = useState(0);
  const [switchStage, setSwitchStage] = useState('');

  const provider = normalizeProvider(instance?.modpack_provider);

  const loadData = useCallback(async () => {
    if (!instance?.modpack_project_id) {
      setError('Missing modpack project id on this instance.');
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      if (provider === 'curseforge') {
        const [cfProject, cfVersions] = await Promise.all([
          invoke('get_curseforge_modpack', { projectId: instance.modpack_project_id }),
          invoke('get_curseforge_modpack_versions', { projectId: instance.modpack_project_id })
        ]);

        const sortedVersions = [...(cfVersions || [])].sort((a, b) => {
          const left = VERSION_TYPE_ORDER[String(a?.version_type || 'release').toLowerCase()] ?? 99;
          const right = VERSION_TYPE_ORDER[String(b?.version_type || 'release').toLowerCase()] ?? 99;
          if (left !== right) return left - right;
          return String(b?.date_published || '').localeCompare(String(a?.date_published || ''));
        });

        const resolvedUrl = instance.modpack_url || cfProject.website_url || null;
        setProject({
          ...cfProject,
          provider_label: 'CurseForge',
          website_url: resolvedUrl,
          body: cfProject.body || cfProject.description || '',
          game_versions: [],
          loaders: []
        });
        setVersions(sortedVersions);
      } else {
        const [mrProject, mrVersions] = await Promise.all([
          invoke('get_modrinth_project', { projectId: instance.modpack_project_id }),
          invoke('get_modrinth_versions', {
            projectId: instance.modpack_project_id,
            gameVersion: null,
            loader: null
          })
        ]);

        const sortedVersions = [...(mrVersions || [])].sort((a, b) => {
          const left = VERSION_TYPE_ORDER[String(a?.version_type || 'release').toLowerCase()] ?? 99;
          const right = VERSION_TYPE_ORDER[String(b?.version_type || 'release').toLowerCase()] ?? 99;
          if (left !== right) return left - right;
          return String(b?.date_published || '').localeCompare(String(a?.date_published || ''));
        });

        const resolvedUrl = instance.modpack_url
          || `https://modrinth.com/modpack/${mrProject.slug || mrProject.project_id || instance.modpack_project_id}`;

        setProject({
          ...mrProject,
          provider_label: 'Modrinth',
          website_url: resolvedUrl
        });
        setVersions(sortedVersions);
      }
    } catch (loadError) {
      console.error('Failed to load modpack details:', loadError);
      setError(`Failed to load modpack details: ${loadError}`);
      setProject(null);
      setVersions([]);
    } finally {
      setLoading(false);
    }
  }, [instance, provider]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  useEffect(() => {
    if (!switchingVersion) {
      setSwitchProgress(0);
      setSwitchStage('');
      return undefined;
    }

    let unlistenPromise;
    const bind = async () => {
      unlistenPromise = listen('download-progress', (event) => {
        const payload = event?.payload || {};
        const stage = payload.stage || '';
        const rawProgress = typeof payload.percentage === 'number'
          ? payload.percentage
          : (typeof payload.progress === 'number' ? payload.progress : null);
        if (typeof rawProgress === 'number') {
          const clamped = Math.max(0, Math.min(100, rawProgress));
          setSwitchProgress(clamped);
        }
        if (stage) {
          setSwitchStage(stage);
        }
      });
    };

    bind();
    return () => {
      if (unlistenPromise) {
        unlistenPromise.then((fn) => fn()).catch(() => {});
      }
    };
  }, [switchingVersion]);

  useEffect(() => {
    setInstalledVersionId(String(instance?.modpack_version_id || ''));
  }, [instance?.id, instance?.modpack_version_id]);

  useEffect(() => {
    if (!versions.length) {
      setSelectedVersionId('');
      return;
    }
    const current = String(installedVersionId || '');
    const hasCurrent = versions.some((version) => String(version?.id || '') === current);
    if (hasCurrent) {
      setSelectedVersionId(current);
      return;
    }
    setSelectedVersionId(String(versions[0]?.id || ''));
  }, [versions, installedVersionId]);

  const galleryItems = useMemo(() => {
    if (!project) return [];
    if (Array.isArray(project.gallery) && project.gallery.length > 0) {
      return project.gallery
        .map((item) => toGalleryMediaItem(item, project.icon_url || iconUrl || null))
        .filter(Boolean);
    }
    if (project.icon_url) {
      return [{
        type: 'image',
        url: project.icon_url,
        title: project.title || project.name || 'Modpack icon'
      }];
    }
    return [];
  }, [project, iconUrl]);

  const compatibilityVersions = useMemo(() => {
    if (Array.isArray(project?.game_versions) && project.game_versions.length > 0) {
      return [...project.game_versions].reverse();
    }
    const merged = new Set();
    versions.forEach((version) => {
      (version.game_versions || []).forEach((gameVersion) => merged.add(gameVersion));
    });
    return Array.from(merged).reverse();
  }, [project?.game_versions, versions]);

  const platformLoaders = useMemo(() => {
    if (Array.isArray(project?.loaders) && project.loaders.length > 0) {
      return project.loaders;
    }
    const merged = new Set();
    versions.forEach((version) => {
      (version.loaders || []).forEach((loaderName) => merged.add(loaderName));
    });
    return Array.from(merged);
  }, [project?.loaders, versions]);

  const handleOpenSource = useCallback(async () => {
    const url = project?.website_url || instance?.modpack_url;
    if (!url) return;
    try {
      await invoke('open_url', { url });
    } catch (openError) {
      console.error('Failed to open source page:', openError);
      if (onShowNotification) {
        onShowNotification(`Failed to open source page: ${openError}`, 'error');
      }
    }
  }, [instance?.modpack_url, onShowNotification, project?.website_url]);

  const handleOpenSourceGallery = useCallback(async () => {
    let url = project?.website_url || instance?.modpack_url;
    if (!url) return;
    if (provider === 'curseforge') {
      const trimmed = url.replace(/\/+$/, '');
      url = trimmed.endsWith('/gallery') ? trimmed : `${trimmed}/gallery`;
    }
    try {
      await invoke('open_url', { url });
    } catch (openError) {
      console.error('Failed to open gallery page:', openError);
      if (onShowNotification) {
        onShowNotification(`Failed to open source page: ${openError}`, 'error');
      }
    }
  }, [instance?.modpack_url, onShowNotification, project?.website_url, provider]);

  const selectedVersion = useMemo(
    () => versions.find((version) => String(version?.id || '') === String(selectedVersionId || '')) || null,
    [selectedVersionId, versions]
  );

  const installedVersionIndex = useMemo(
    () => versions.findIndex((version) => String(version?.id || '') === String(installedVersionId || '')),
    [installedVersionId, versions]
  );

  const selectedVersionIndex = useMemo(
    () => versions.findIndex((version) => String(version?.id || '') === String(selectedVersionId || '')),
    [selectedVersionId, versions]
  );

  const canSwitchVersion = Boolean(
    selectedVersion
      && String(selectedVersion.id || '') !== String(installedVersionId || '')
      && !switchingVersion
      && !loading
  );
  const reinstallTargetVersionId = useMemo(
    () => String(installedVersionId || selectedVersion?.id || versions[0]?.id || ''),
    [installedVersionId, selectedVersion?.id, versions]
  );
  const canReinstallCurrent = Boolean(
    reinstallTargetVersionId
      && !switchingVersion
      && !loading
  );

  const switchActionLabel = useMemo(() => {
    if (!selectedVersion) return 'Switch Version';
    if (String(selectedVersion.id || '') === String(installedVersionId || '')) return 'Current Version';
    if (installedVersionIndex >= 0 && selectedVersionIndex >= 0) {
      if (selectedVersionIndex < installedVersionIndex) return 'Update to Selected';
      if (selectedVersionIndex > installedVersionIndex) return 'Downgrade to Selected';
    }
    return 'Switch to Selected';
  }, [installedVersionId, installedVersionIndex, selectedVersion, selectedVersionIndex]);

  const handleSwitchVersion = useCallback(async () => {
    if (!canSwitchVersion || !selectedVersion) return;
    const taskId = `instance-switch-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const taskName = `${switchActionLabel.replace('Selected', '').trim()} ${instance.name}`;
    setSwitchingVersion(true);
    setSwitchProgress(0);
    setSwitchStage('Preparing modpack switch...');

    if (onQueueDownload) {
      onQueueDownload({
        id: taskId,
        name: taskName,
        icon: iconUrl || '/minecraft_logo.png',
        status: 'Preparing...',
        progress: 0,
        kind: 'instance-setup',
        instanceId: instance.id,
        trackBackendProgress: true
      });
    }
    if (onUpdateDownloadStatus) {
      onUpdateDownloadStatus(taskId, {
        status: 'Downloading modpack version...',
        progress: 0,
        kind: 'instance-setup',
        instanceId: instance.id,
        trackBackendProgress: true
      });
    }

    try {
      await invoke('switch_instance_modpack_version', {
        instanceId: instance.id,
        targetVersionId: selectedVersion.id
      });
      setInstalledVersionId(String(selectedVersion.id));
      if (onInstancesRefresh) {
        await onInstancesRefresh();
      }
      if (onShowNotification) {
        onShowNotification(
          `Switched ${instance.name} to ${selectedVersion.name || selectedVersion.version_number || selectedVersion.id}`,
          'success'
        );
      }
      if (onUpdateDownloadStatus) {
        onUpdateDownloadStatus(taskId, {
          status: 'Modpack version switched',
          progress: 100,
          stageLabel: 'Modpack version switched',
          trackBackendProgress: false
        });
      }
      if (onDequeueDownload) {
        setTimeout(() => onDequeueDownload(taskId), 600);
      }
    } catch (switchError) {
      console.error('Failed to switch modpack version:', switchError);
      if (onShowNotification) {
        onShowNotification(`Failed to switch version: ${switchError}`, 'error');
      }
      if (onUpdateDownloadStatus) {
        onUpdateDownloadStatus(taskId, {
          status: `Failed: ${switchError}`,
          stageLabel: 'Modpack switch failed',
          trackBackendProgress: false
        });
      }
      if (onDequeueDownload) {
        setTimeout(() => onDequeueDownload(taskId), 1200);
      }
    } finally {
      setSwitchingVersion(false);
    }
  }, [
    canSwitchVersion,
    iconUrl,
    instance?.id,
    instance?.name,
    onDequeueDownload,
    onInstancesRefresh,
    onQueueDownload,
    onShowNotification,
    onUpdateDownloadStatus,
    selectedVersion,
    switchActionLabel
  ]);

  const handleReinstallCurrent = useCallback(async () => {
    if (!canReinstallCurrent) return;
    const targetVersionId = reinstallTargetVersionId;
    const taskId = `instance-reinstall-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const taskName = `Reinstall ${instance.name}`;
    setSwitchingVersion(true);
    setSwitchProgress(0);
    setSwitchStage('Preparing reinstall...');

    if (onQueueDownload) {
      onQueueDownload({
        id: taskId,
        name: taskName,
        icon: iconUrl || '/minecraft_logo.png',
        status: 'Preparing...',
        progress: 0,
        kind: 'instance-setup',
        instanceId: instance.id,
        trackBackendProgress: true
      });
    }
    if (onUpdateDownloadStatus) {
      onUpdateDownloadStatus(taskId, {
        status: 'Reinstalling modpack...',
        progress: 0,
        kind: 'instance-setup',
        instanceId: instance.id,
        trackBackendProgress: true
      });
    }

    try {
      await invoke('switch_instance_modpack_version', {
        instanceId: instance.id,
        targetVersionId,
        forceReinstall: true
      });
      if (onInstancesRefresh) {
        await onInstancesRefresh();
      }
      if (onShowNotification) {
        onShowNotification(
          `Reinstalled ${instance.name} (${targetVersionId})`,
          'success'
        );
      }
      if (onUpdateDownloadStatus) {
        onUpdateDownloadStatus(taskId, {
          status: 'Modpack reinstalled',
          progress: 100,
          stageLabel: 'Modpack reinstalled',
          trackBackendProgress: false
        });
      }
      if (onDequeueDownload) {
        setTimeout(() => onDequeueDownload(taskId), 600);
      }
    } catch (switchError) {
      console.error('Failed to reinstall modpack version:', switchError);
      if (onShowNotification) {
        onShowNotification(`Failed to reinstall modpack: ${switchError}`, 'error');
      }
      if (onUpdateDownloadStatus) {
        onUpdateDownloadStatus(taskId, {
          status: `Failed: ${switchError}`,
          stageLabel: 'Modpack reinstall failed',
          trackBackendProgress: false
        });
      }
      if (onDequeueDownload) {
        setTimeout(() => onDequeueDownload(taskId), 1200);
      }
    } finally {
      setSwitchingVersion(false);
    }
  }, [
    canReinstallCurrent,
    reinstallTargetVersionId,
    instance.id,
    instance.name,
    onQueueDownload,
    onUpdateDownloadStatus,
    iconUrl,
    onInstancesRefresh,
    onShowNotification,
    onDequeueDownload
  ]);

  const modalTitle = project?.title || instance?.modpack_title || 'Modpack';
  const modalAuthor = project?.author || instance?.modpack_author || 'Unknown creator';
  const modalDownloads = formatNumber(project?.downloads || 0);
  const sourceUrl = project?.website_url || instance?.modpack_url || null;
  const providerDisplay = project?.provider_label || (provider === 'curseforge' ? 'CurseForge' : 'Modrinth');

  const versionsContent = loading ? (
    <div className="versions-loading">
      <div className="spinner small"></div>
    </div>
  ) : versions.length === 0 ? (
    <div className="empty-state mini">No versions found</div>
  ) : (
    <div className="versions-small-list">
      {versions.map((version) => {
        const isInstalled = String(installedVersionId || '') === String(version?.id || '');
        const isSelected = String(selectedVersionId || '') === String(version?.id || '');
        const versionType = String(version?.version_type || 'release').toLowerCase();
        const gameVersionLabel = getPrimaryGameVersionLabel(version);
        const loaderLabel = getLoaderSummaryLabel(version);
        const rawTitle = version.name || version.version_number || 'Unnamed version';
        const cleanTitle = stripMinecraftVersionFromTitle(rawTitle, gameVersionLabel) || rawTitle;
        const rawVersion = version.version_number || version.id;
        const cleanVersion = stripMinecraftVersionFromNumber(rawVersion, gameVersionLabel) || rawVersion;
        return (
          <div
            key={version.id}
            className={`version-mini-item ${isInstalled ? 'installed' : ''} ${isSelected ? 'selected' : ''}`}
            onClick={() => {
              if (!switchingVersion) {
                setSelectedVersionId(String(version.id || ''));
              }
            }}
          >
            <div className="mini-item-top">
              <div className="mini-title-block">
                <span className="mini-name" title={rawTitle}>{cleanTitle}</span>
                <span className="mini-number" title={rawVersion}>{cleanVersion}</span>
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
  );

  return (
    <ProjectDetailsEntityModal
      onClose={onClose}
      loading={loading}
      error={error}
      header={{
        iconUrl: project?.icon_url || iconUrl || null,
        fallback: 'PK',
        title: modalTitle,
        author: modalAuthor,
        downloadsText: `${modalDownloads} downloads`,
        description: project?.description || ''
      }}
      platformLabel={providerDisplay}
      details={{
        author: modalAuthor,
        downloadsText: `${modalDownloads} downloads`,
        projectId: instance?.modpack_project_id || 'unknown'
      }}
      loaders={platformLoaders}
      compatibilityVersions={compatibilityVersions}
      categories={project?.categories || []}
      descriptionMarkdown={project?.body || project?.description || ''}
      descriptionEmptyText="No description provided."
      galleryItems={galleryItems}
      galleryEmptyText="No gallery media available."
      galleryNotice={provider === 'curseforge' ? {
        text: 'Some CurseForge gallery media (especially videos) is web-only and may not be available in the API response.',
        buttonLabel: 'Open Full Gallery',
        onClick: handleOpenSourceGallery,
        disabled: !sourceUrl
      } : null}
      showDependenciesTab={false}
      versionsLabel="Available Versions"
      versionsTag={project?.provider_label || instance?.modpack_provider || 'Source'}
      versionsContent={versionsContent}
      footerContent={(
        <>
          {switchingVersion && (
            <div className="modpack-switch-inline-progress">
              <div className="modpack-switch-inline-stage">{switchStage || 'Switching modpack version...'}</div>
              <div className="modpack-switch-inline-bar">
                <div className="modpack-switch-inline-fill" style={{ width: `${switchProgress}%` }} />
              </div>
            </div>
          )}
          <button className="modrinth-link-btn" onClick={handleOpenSource} disabled={!sourceUrl}>
            <ExternalLink size={14} />
            <span>{provider === 'curseforge' ? 'View on CurseForge' : 'View on Modrinth'}</span>
          </button>
          <button className="reinstall-btn" onClick={handleReinstallCurrent} disabled={!canReinstallCurrent}>
            <RotateCcw size={14} />
            <span>{switchingVersion ? 'Applying...' : 'Reinstall Current'}</span>
          </button>
          <button className="modpack-switch-btn" onClick={handleSwitchVersion} disabled={!canSwitchVersion}>
            <span>{switchingVersion ? 'Applying...' : switchActionLabel}</span>
          </button>
          <button className="btn-secondary" onClick={onClose}>Close</button>
        </>
      )}
    />
  );
}

export default memo(ModpackInfoModal);
