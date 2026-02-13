import { useState, useEffect, useCallback, useLayoutEffect, useRef, useMemo, memo } from 'react';
import { createPortal } from 'react-dom';
import { invoke } from '@tauri-apps/api/core';
import { open } from '@tauri-apps/plugin-dialog';
import { Plus, Trash2, X, Check, FolderOpen, ArrowLeft, Upload, Code, Loader2, ListFilterPlus } from 'lucide-react';
import ConfirmModal from './ConfirmModal';
import TabLoadingState from './TabLoadingState';
import WorldDatapacks from './WorldDatapacks';
import SubTabs from './SubTabs';
import FilterModal from './FilterModal';
import ModVersionModal from './ModVersionModal';
import useModrinthSearch from '../hooks/useModrinthSearch';
import { maybeShowCurseForgeBlockedDownloadModal } from '../utils/curseforgeInstallError';
import './ScreenshotContextMenu.css';

const CURSEFORGE_WORLD_CATEGORIES = [
  { id: 'group-categories', label: 'Categories', isSection: true },
  { id: 'cf-world-adventure', label: 'Adventure', queryValue: 'adventure' },
  { id: 'cf-world-creation', label: 'Creation', queryValue: 'creation' },
  { id: 'cf-world-game-map', label: 'Game Map', queryValue: 'game-map' },
  { id: 'cf-world-modded-world', label: 'Modded World', queryValue: 'modded-world' },
  { id: 'cf-world-parkour', label: 'Parkour', queryValue: 'parkour' },
  { id: 'cf-world-puzzle', label: 'Puzzle', queryValue: 'puzzle' },
  { id: 'cf-world-survival', label: 'Survival', queryValue: 'survival' }
];

const resolveSelectedCategoryQueryValues = (options, selectedIds) => {
  const values = [];
  for (const id of selectedIds || []) {
    const match = (options || []).find((option) => option.id === id);
    const rawValue = match?.queryValue ?? id;
    const entries = Array.isArray(rawValue) ? rawValue : [rawValue];
    for (const entry of entries) {
      const normalized = String(entry || '').trim();
      if (!normalized || values.includes(normalized)) continue;
      values.push(normalized);
    }
  }
  return values;
};

function InstanceWorlds({
  instance,
  onShowNotification,
  onShowConfirm,
  isScrolled,
  onQueueDownload,
  onDequeueDownload,
  onUpdateDownloadStatus
}) {
  const [worlds, setWorlds] = useState([]);
  const [loading, setLoading] = useState(true);
  const [deleteConfirm, setDeleteConfirm] = useState({ show: false, world: null });
  const [selectedWorld, setSelectedWorld] = useState(null);
  const [worldContextMenu, setWorldContextMenu] = useState(null);
  const [renameModal, setRenameModal] = useState({ show: false, world: null, newName: '' });
  const [activeSubTab, setActiveSubTab] = useState('worlds');
  const [showAddWorldModal, setShowAddWorldModal] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedWorlds, setSelectedWorlds] = useState([]);
  const [deleteSelectedConfirmOpen, setDeleteSelectedConfirmOpen] = useState(false);
  const [datapacksRefreshNonce, setDatapacksRefreshNonce] = useState(0);
  const [showAddDatapackModal, setShowAddDatapackModal] = useState(false);
  const [datapackShareCodeInput, setDatapackShareCodeInput] = useState('');
  const [applyingDatapackCode, setApplyingDatapackCode] = useState(false);
  const [datapackApplyProgress, setDatapackApplyProgress] = useState(0);
  const [datapackApplyStatus, setDatapackApplyStatus] = useState('');
  const [findSearchInput, setFindSearchInput] = useState('');
  const [findSearchQuery, setFindSearchQuery] = useState('');
  const [selectedFindCategories, setSelectedFindCategories] = useState([]);
  const [appliedFindCategories, setAppliedFindCategories] = useState([]);
  const [isFindFilterModalOpen, setIsFindFilterModalOpen] = useState(false);
  const [versionModal, setVersionModal] = useState({ show: false, project: null });
  const [hasCurseForgeKey, setHasCurseForgeKey] = useState(false);
  const [checkingCurseForgeKey, setCheckingCurseForgeKey] = useState(true);
  const [installingWorldProjectId, setInstallingWorldProjectId] = useState(null);
  const worldContextMenuRef = useRef(null);
  const searchInputRef = useRef(null);
  const findSearchInputRef = useRef(null);
  const isDatapacksMode = activeSubTab === 'datapacks-installed' || activeSubTab === 'datapacks-find';

  const effectiveFindCategoryValues = useMemo(
    () => resolveSelectedCategoryQueryValues(CURSEFORGE_WORLD_CATEGORIES, appliedFindCategories),
    [appliedFindCategories]
  );

  const {
    searchResults: searchedWorlds,
    popularItems: popularWorlds,
    searching: searchingWorlds,
    loadingPopular: loadingPopularWorlds,
    loadingMore: loadingMoreWorlds,
    canLoadMore: canLoadMoreWorlds,
    searchError: findWorldsError,
    handleSearch: searchWorlds,
    loadPopularItems: loadPopularWorlds,
    loadMore: loadMoreWorlds,
    resetFeed: resetWorldFinderFeed
  } = useModrinthSearch({
    provider: 'curseforge',
    projectType: 'world',
    gameVersion: instance.version_id,
    loader: null,
    categories: effectiveFindCategoryValues,
    query: findSearchQuery,
    withPopular: true,
    searchEmptyQuery: false
  });

  const hasAppliedFindWorldSearch = findSearchQuery.trim().length > 0 || appliedFindCategories.length > 0;
  const displayFindWorlds = hasAppliedFindWorldSearch ? searchedWorlds : popularWorlds;

  const filteredWorlds = worlds.filter((world) => {
    if (!searchQuery.trim()) return true;
    const query = searchQuery.trim().toLowerCase();
    const worldName = (world.name || '').toLowerCase();
    const folderName = (world.folder_name || '').toLowerCase();
    return worldName.includes(query) || folderName.includes(query);
  });

  const allFilteredSelected = filteredWorlds.length > 0
    && filteredWorlds.every((world) => selectedWorlds.includes(world.folder_name));

  const handleToggleSelectWorld = (folderName) => {
    setSelectedWorlds((prev) => (
      prev.includes(folderName)
        ? prev.filter((name) => name !== folderName)
        : [...prev, folderName]
    ));
  };

  const handleSelectAll = () => {
    if (allFilteredSelected) {
      const visibleSet = new Set(filteredWorlds.map((world) => world.folder_name));
      setSelectedWorlds((prev) => prev.filter((name) => !visibleSet.has(name)));
      return;
    }

    setSelectedWorlds((prev) => {
      const next = new Set(prev);
      filteredWorlds.forEach((world) => next.add(world.folder_name));
      return Array.from(next);
    });
  };

  const loadWorlds = useCallback(async () => {
    try {
      const w = await invoke('get_instance_worlds', { instanceId: instance.id });
      setWorlds(w);
    } catch (error) {
      console.error('Failed to load worlds:', error);
    }
    setLoading(false);
  }, [instance.id]);

  const executeFindWorldSearch = useCallback((queryOverride = findSearchInput, categoriesOverride = selectedFindCategories) => {
    if (!hasCurseForgeKey) return;
    const nextQuery = String(queryOverride || '');
    const nextCategories = Array.isArray(categoriesOverride) ? categoriesOverride : selectedFindCategories;
    const categoryQueryValues = resolveSelectedCategoryQueryValues(CURSEFORGE_WORLD_CATEGORIES, nextCategories);
    setFindSearchQuery(nextQuery);
    setAppliedFindCategories(nextCategories);

    if (nextQuery.trim() === '' && nextCategories.length === 0) {
      loadPopularWorlds();
      return;
    }

    searchWorlds(0, nextQuery, categoryQueryValues);
  }, [findSearchInput, selectedFindCategories, hasCurseForgeKey, loadPopularWorlds, searchWorlds]);

  const handleApplyFindCategories = useCallback((nextCategories) => {
    const normalized = Array.isArray(nextCategories) ? nextCategories : [];
    setSelectedFindCategories(normalized);
    executeFindWorldSearch(findSearchInput, normalized);
  }, [executeFindWorldSearch, findSearchInput]);

  const handleRequestInstallWorld = useCallback((project) => {
    const resolvedProjectId = String(project?.project_id || project?.id || '').trim();
    if (!resolvedProjectId) {
      onShowNotification?.('Failed to open world details: Missing CurseForge project ID.', 'error');
      return;
    }

    setVersionModal({
      show: true,
      project: {
        ...project,
        project_id: resolvedProjectId,
        provider_label: 'CurseForge',
        project_type: 'world'
      }
    });
  }, [onShowNotification]);

  const handleInstallCurseForgeWorld = useCallback(async (project, selectedVersion = null) => {
    const resolvedProjectId = String(project?.project_id || project?.id || '').trim();
    if (!resolvedProjectId) {
      onShowNotification?.('Failed to install world: Missing CurseForge project ID.', 'error');
      return;
    }

    const downloadId = `cf-world-${instance.id}-${resolvedProjectId}`;
    if (onQueueDownload) {
      onQueueDownload({
        id: downloadId,
        name: project.title || project.name || `World ${resolvedProjectId}`,
        icon: project.icon_url || null,
        status: 'Preparing...'
      });
    }

    setInstallingWorldProjectId(resolvedProjectId);
    let installSucceeded = false;
    try {
      onUpdateDownloadStatus?.(downloadId, 'Fetching version...');

      let resolvedVersion = selectedVersion;
      if (!resolvedVersion) {
        const cfVersions = await invoke('get_curseforge_modpack_versions', { projectId: resolvedProjectId });
        if (!Array.isArray(cfVersions) || cfVersions.length === 0) {
          throw new Error('No downloadable world files were returned by CurseForge for this project.');
        }

        const sortedVersions = [...cfVersions].sort(
          (a, b) => new Date(b.date_published) - new Date(a.date_published)
        );
        resolvedVersion = sortedVersions.find((version) =>
          Array.isArray(version?.files) && version.files.some((file) => String(file?.filename || '').toLowerCase().endsWith('.zip'))
        ) || sortedVersions[0];
      }

      if (!resolvedVersion) {
        throw new Error('No downloadable world files were returned by CurseForge for this project.');
      }

      const file = resolvedVersion?.files?.find((candidate) => String(candidate?.filename || '').toLowerCase().endsWith('.zip'))
        || resolvedVersion?.files?.find((candidate) => candidate?.primary)
        || resolvedVersion?.files?.[0];
      if (!file) {
        throw new Error('Selected CurseForge world version has no downloadable file.');
      }

      onUpdateDownloadStatus?.(downloadId, 'Downloading...');

      await invoke('install_curseforge_world', {
        instanceId: instance.id,
        projectId: resolvedProjectId,
        fileId: String(resolvedVersion.id),
        filename: file.filename || `${resolvedProjectId}-${resolvedVersion.id}.zip`,
        fileUrl: file.url || null,
        name: project.title || project.name || null
      });

      await loadWorlds();
      onUpdateDownloadStatus?.(downloadId, 'Installed');
      onShowNotification?.(`Imported ${project.title || project.name || 'world'} successfully`, 'success');
      installSucceeded = true;
    } catch (error) {
      console.error('Failed to install CurseForge world:', error);
      onUpdateDownloadStatus?.(downloadId, 'Error');
      const handledCurseForgeRestriction = await maybeShowCurseForgeBlockedDownloadModal({
        error,
        provider: 'curseforge',
        project,
        projectId: resolvedProjectId,
        onShowConfirm,
        onShowNotification
      });
      if (!handledCurseForgeRestriction) {
        onShowNotification?.(`Failed to install world: ${error}`, 'error');
      }
    } finally {
      setInstallingWorldProjectId(null);
      if (onDequeueDownload) {
        setTimeout(() => onDequeueDownload(downloadId, installSucceeded), 1000);
      }
    }
  }, [instance.id, loadWorlds, onQueueDownload, onUpdateDownloadStatus, onShowNotification, onShowConfirm, onDequeueDownload]);

  useEffect(() => {
    loadWorlds();

    const handleClick = () => {
      setWorldContextMenu(null);
    };
    window.addEventListener('click', handleClick);
    return () => window.removeEventListener('click', handleClick);
  }, [instance.id, loadWorlds]);

  useEffect(() => {
    let mounted = true;
    const loadCurseForgeKeyStatus = async () => {
      setCheckingCurseForgeKey(true);
      try {
        const hasKey = await invoke('has_curseforge_api_key');
        if (mounted) {
          setHasCurseForgeKey(Boolean(hasKey));
        }
      } catch (error) {
        console.error('Failed to check CurseForge key status:', error);
        if (mounted) {
          setHasCurseForgeKey(false);
        }
      } finally {
        if (mounted) {
          setCheckingCurseForgeKey(false);
        }
      }
    };
    loadCurseForgeKeyStatus();
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    if (activeSubTab !== 'find') return;
    if (checkingCurseForgeKey || !hasCurseForgeKey) return;
    if (findSearchQuery.trim() !== '' || appliedFindCategories.length > 0) return;
    loadPopularWorlds();
  }, [activeSubTab, checkingCurseForgeKey, hasCurseForgeKey, findSearchQuery, appliedFindCategories.length, loadPopularWorlds]);

  useEffect(() => {
    setFindSearchInput('');
    setFindSearchQuery('');
    setSelectedFindCategories([]);
    setAppliedFindCategories([]);
    resetWorldFinderFeed();
  }, [instance.id, resetWorldFinderFeed]);

  useLayoutEffect(() => {
    if (!worldContextMenu || !worldContextMenuRef.current) return;

    const rect = worldContextMenuRef.current.getBoundingClientRect();
    const margin = 8;
    const maxX = Math.max(margin, window.innerWidth - rect.width - margin);
    const maxY = Math.max(margin, window.innerHeight - rect.height - margin);
    const clampedX = Math.min(Math.max(worldContextMenu.x, margin), maxX);
    const clampedY = Math.min(Math.max(worldContextMenu.y, margin), maxY);

    if (clampedX !== worldContextMenu.x || clampedY !== worldContextMenu.y || !worldContextMenu.positioned) {
      setWorldContextMenu(prev => {
        if (!prev) return prev;
        return {
          ...prev,
          x: clampedX,
          y: clampedY,
          positioned: true
        };
      });
    }
  }, [worldContextMenu]);

  const handleOpenFolder = async () => {
    try {
      await invoke('open_instance_folder', {
        instanceId: instance.id,
        folderType: 'saves'
      });
    } catch (error) {
      console.error('Failed to open folder:', error);
      if (onShowNotification) {
        onShowNotification(`Failed to open worlds folder: ${error}`, 'error');
      }
    }
  };

  const handleImportDatapackFile = async () => {
    if (!selectedWorld?.folder_name) return;

    try {
      const selected = await open({
        multiple: true,
        filters: [{
          name: 'Datapacks',
          extensions: ['zip']
        }]
      });

      if (selected && selected.length > 0) {
        for (const path of selected) {
          await invoke('import_instance_file', {
            instanceId: instance.id,
            sourcePath: path,
            folderType: 'datapacks',
            worldName: selectedWorld.folder_name
          });
        }

        setDatapacksRefreshNonce((prev) => prev + 1);
        onShowNotification?.(`Imported ${selected.length} datapack${selected.length > 1 ? 's' : ''}`, 'success');
      }
    } catch (error) {
      console.error('Failed to import datapacks:', error);
      onShowNotification?.(`Failed to import datapacks: ${error}`, 'error');
    }
  };

  const handleApplyDatapackCode = async () => {
    if (!selectedWorld?.folder_name || !datapackShareCodeInput.trim()) return;

    setApplyingDatapackCode(true);
    setDatapackApplyProgress(0);
    setDatapackApplyStatus('Decoding share code...');

    const isCurseForgeProjectId = (value) => /^\d+$/.test(String(value || '').trim());

    try {
      const shareData = await invoke('decode_instance_share_code', { code: datapackShareCodeInput.trim() });
      const datapacks = shareData.datapacks || [];

      if (datapacks.length === 0) {
        onShowNotification?.('No datapacks found in this code.', 'info');
        setApplyingDatapackCode(false);
        return;
      }

      setDatapackApplyStatus(`Found ${datapacks.length} datapacks. Fetching metadata...`);
      setDatapackApplyProgress(10);

      const existingDatapacks = await invoke('get_world_datapacks', {
        instanceId: instance.id,
        worldName: selectedWorld.folder_name
      }).catch(() => []);
      const installedProjectIds = new Set(
        (existingDatapacks || [])
          .map((item) => String(item?.project_id || '').trim())
          .filter(Boolean)
      );

      const modrinthIds = datapacks
        .map((entry) => entry.project_id || entry.projectId)
        .filter((projectId) => projectId && !isCurseForgeProjectId(projectId));
      const modrinthProjectMap = {};
      try {
        if (modrinthIds.length > 0) {
          const projects = await invoke('get_modrinth_projects', { projectIds: modrinthIds });
          projects.forEach((project) => {
            const id = project.project_id || project.id;
            if (id) modrinthProjectMap[id] = project;
            if (project.slug) modrinthProjectMap[project.slug] = project;
          });
        }
      } catch (error) {
        console.warn('Bulk Modrinth fetch for datapacks failed:', error);
      }

      let installedCount = 0;
      for (let index = 0; index < datapacks.length; index += 1) {
        const entry = datapacks[index];
        const projectId = String(entry.project_id || entry.projectId || '').trim();
        const versionId = String(entry.version_id || entry.versionId || '').trim();
        if (!projectId) continue;

        setDatapackApplyStatus(`Installing ${entry.name || projectId} (${index + 1}/${datapacks.length})...`);
        setDatapackApplyProgress(10 + ((index / datapacks.length) * 90));

        if (installedProjectIds.has(projectId)) {
          installedCount += 1;
          continue;
        }

        try {
          if (isCurseForgeProjectId(projectId)) {
            const project = await invoke('get_curseforge_modpack', { projectId });
            const cfVersions = await invoke('get_curseforge_modpack_versions', { projectId });
            if (!Array.isArray(cfVersions) || cfVersions.length === 0) continue;

            let selectedVersion = versionId
              ? cfVersions.find((candidate) => String(candidate.id) === versionId)
              : null;
            if (!selectedVersion) {
              const sorted = [...cfVersions].sort((a, b) => new Date(b.date_published) - new Date(a.date_published));
              selectedVersion = sorted[0];
            }
            if (!selectedVersion) continue;

            const file = selectedVersion.files?.find((candidate) => String(candidate.filename || '').toLowerCase().endsWith('.zip'))
              || selectedVersion.files?.find((candidate) => candidate.primary)
              || selectedVersion.files?.[0];
            if (!file) continue;

            await invoke('install_curseforge_file', {
              instanceId: instance.id,
              projectId,
              fileId: String(selectedVersion.id),
              fileType: 'datapack',
              filename: file.filename || `${projectId}-${selectedVersion.id}.zip`,
              fileUrl: file.url || null,
              worldName: selectedWorld.folder_name,
              iconUrl: project?.icon_url || entry.icon_url || entry.iconUrl || null,
              name: project?.title || entry.name || null,
              author: project?.author || entry.author || null,
              versionName: selectedVersion.version_number || selectedVersion.name || entry.version_name || entry.versionName || null,
              categories: project?.categories || project?.display_categories || entry.categories || null
            });
          } else {
            let version = null;
            if (versionId) {
              version = await invoke('get_modrinth_version', { versionId });
            } else {
              const versions = await invoke('get_modrinth_versions', {
                projectId,
                gameVersion: instance.version_id,
                loader: 'datapack'
              });
              version = Array.isArray(versions) && versions.length > 0 ? versions[0] : null;
            }

            if (!version) continue;
            const project = modrinthProjectMap[projectId] || await invoke('get_modrinth_project', { projectId });
            const file = version.files?.find((candidate) => String(candidate.filename || '').toLowerCase().endsWith('.zip'))
              || version.files?.find((candidate) => candidate.primary)
              || version.files?.[0];
            if (!file) continue;

            await invoke('install_modrinth_file', {
              instanceId: instance.id,
              fileUrl: file.url,
              filename: file.filename,
              fileType: 'datapack',
              projectId,
              versionId: version.id,
              worldName: selectedWorld.folder_name,
              iconUrl: project?.icon_url || entry.icon_url || entry.iconUrl || null,
              name: project?.title || entry.name || null,
              author: project?.author || entry.author || null,
              versionName: version.version_number || version.name || entry.version_name || entry.versionName || null,
              categories: project?.categories || project?.display_categories || entry.categories || null
            });
          }

          installedProjectIds.add(projectId);
          installedCount += 1;
        } catch (error) {
          console.error(`Failed to install datapack ${projectId}:`, error);
        }
      }

      setDatapackApplyProgress(100);
      onShowNotification?.(`Successfully installed ${installedCount} datapacks!`, 'success');
      setTimeout(() => {
        setShowAddDatapackModal(false);
        setDatapackShareCodeInput('');
        setApplyingDatapackCode(false);
        setDatapackApplyProgress(0);
        setDatapackApplyStatus('');
        setDatapacksRefreshNonce((prev) => prev + 1);
      }, 400);
      return;
    } catch (error) {
      console.error('Failed to apply datapack code:', error);
      onShowNotification?.('Invalid or incompatible datapack code.', 'error');
    }

    setApplyingDatapackCode(false);
    setDatapackApplyProgress(0);
    setDatapackApplyStatus('');
  };

  const handleOpenSelectedDatapacksFolder = async () => {
    if (!selectedWorld?.folder_name) return;

    try {
      await invoke('open_instance_datapacks_folder', {
        instanceId: instance.id,
        worldName: selectedWorld.folder_name
      });
    } catch (error) {
      console.error('Failed to open datapacks folder:', error);
      onShowNotification?.(`Failed to open datapacks folder: ${error}`, 'error');
    }
  };

  const handleDeleteWorld = async (world) => {
    setDeleteConfirm({ show: true, world });
  };

  const handleImportWorld = async (mode) => {
    setShowAddWorldModal(false);
    try {
      const selected = mode === 'folder'
        ? await open({
            title: 'Select world folder(s)',
            directory: true,
            multiple: true
          })
        : await open({
            title: 'Select world zip file(s)',
            multiple: true,
            filters: [{
              name: 'World Backups',
              extensions: ['zip']
            }]
          });

      if (!selected) return;

      const selectedPaths = Array.isArray(selected) ? selected : [selected];
      if (selectedPaths.length === 0) return;

      let imported = 0;
      let failed = 0;

      for (const sourcePath of selectedPaths) {
        try {
          await invoke('import_instance_world', {
            instanceId: instance.id,
            sourcePath
          });
          imported += 1;
        } catch (error) {
          console.error(`Failed to import world from ${sourcePath}:`, error);
          failed += 1;
        }
      }

      await loadWorlds();

      if (imported > 0 && onShowNotification) {
        onShowNotification(`Imported ${imported} world${imported > 1 ? 's' : ''}`, 'success');
      }
      if (failed > 0 && onShowNotification) {
        onShowNotification(`Failed to import ${failed} world${failed > 1 ? 's' : ''}`, 'error');
      }
    } catch (error) {
      console.error('Failed to import world(s):', error);
      if (onShowNotification) {
        onShowNotification(`Failed to import world(s): ${error}`, 'error');
      }
    }
  };

  const handleWorldContextMenu = (e, world) => {
    e.preventDefault();
    e.stopPropagation();

    setWorldContextMenu({
      x: e.clientX + 2,
      y: e.clientY + 2,
      positioned: false,
      world
    });
  };

  const handleOpenWorldFolder = async (world) => {
    try {
      await invoke('open_instance_world_folder', {
        instanceId: instance.id,
        folderName: world.folder_name
      });
    } catch (error) {
      console.error('Failed to open world folder:', error);
      if (onShowNotification) {
        onShowNotification(`Failed to open world folder: ${error}`, 'error');
      }
    }
  };

  const handleOpenDatapacksFolder = async (world) => {
    try {
      await invoke('open_instance_datapacks_folder', {
        instanceId: instance.id,
        worldName: world.folder_name
      });
    } catch (error) {
      console.error('Failed to open datapacks folder:', error);
      if (onShowNotification) {
        onShowNotification(`Failed to open datapacks folder: ${error}`, 'error');
      }
    }
  };

  const handleRenameWorld = async () => {
    const { world, newName } = renameModal;
    if (!newName || newName === world.folder_name) {
      setRenameModal({ show: false, world: null, newName: '' });
      return;
    }

    try {
      await invoke('rename_instance_world', {
        instanceId: instance.id,
        folderName: world.folder_name,
        newName: newName
      });
      await loadWorlds();
      if (onShowNotification) {
        onShowNotification(`Renamed world to ${newName}`, 'success');
      }
    } catch (error) {
      console.error('Failed to rename world:', error);
      if (onShowNotification) {
        onShowNotification(`Failed to rename world: ${error}`, 'error');
      }
    }
    setRenameModal({ show: false, world: null, newName: '' });
  };

  const confirmDelete = async () => {
    const world = deleteConfirm.world;
    setDeleteConfirm({ show: false, world: null });

    try {
      await invoke('delete_instance_world', {
        instanceId: instance.id,
        worldName: world.folder_name
      });
      await loadWorlds();
    } catch (error) {
      console.error('Failed to delete world:', error);
    }
  };

  const handleDeleteSelected = () => {
    if (selectedWorlds.length === 0) return;
    setDeleteSelectedConfirmOpen(true);
  };

  const confirmDeleteSelected = async () => {
    const targets = [...selectedWorlds];
    setDeleteSelectedConfirmOpen(false);
    if (targets.length === 0) return;

    let failed = 0;
    for (const worldName of targets) {
      try {
        await invoke('delete_instance_world', {
          instanceId: instance.id,
          worldName
        });
      } catch (error) {
        failed += 1;
        console.error(`Failed to delete world ${worldName}:`, error);
      }
    }

    setSelectedWorlds([]);
    await loadWorlds();

    if (failed > 0 && onShowNotification) {
      onShowNotification(`Failed to delete ${failed} world${failed > 1 ? 's' : ''}`, 'error');
    }
  };

  const formatDate = (timestamp) => {
    if (!timestamp) return 'Unknown';
    return new Date(timestamp).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  const formatSize = (bytes) => {
    if (!bytes) return 'Unknown';
    if (bytes >= 1073741824) return (bytes / 1073741824).toFixed(2) + ' GB';
    if (bytes >= 1048576) return (bytes / 1048576).toFixed(2) + ' MB';
    if (bytes >= 1024) return (bytes / 1024).toFixed(2) + ' KB';
    return bytes + ' B';
  };

  const formatDownloads = (num) => {
    const value = Number(num || 0);
    if (value >= 1000000) return `${(value / 1000000).toFixed(1)}M`;
    if (value >= 1000) return `${(value / 1000).toFixed(1)}K`;
    return value.toLocaleString('en-US');
  };

  const getGameModeIcon = (gamemode) => {
    switch (gamemode) {
      case 0: return 'Survival';
      case 1: return 'Creative';
      case 2: return 'Adventure';
      case 3: return 'Spectator';
      default: return 'Unknown Mode';
    }
  };

  return (
    <div className="worlds-tab">
      <div className={`sub-tabs-row ${isScrolled ? 'scrolled' : ''}`}>
        <SubTabs
          tabs={isDatapacksMode
            ? [
                { id: 'datapacks-installed', label: 'Installed Datapacks' },
                { id: 'datapacks-find', label: 'Find Datapacks' }
              ]
            : [
                { id: 'worlds', label: `Worlds (${worlds.length})` },
                { id: 'find', label: 'Find Worlds' }
              ]}
          activeTab={activeSubTab}
          onTabChange={setActiveSubTab}
        />
        <div className="sub-tabs-actions">
          {activeSubTab === 'worlds' && (
            <>
              <button className="open-folder-btn" onClick={() => setShowAddWorldModal(true)} title="Add World">
                <Plus size={16} />
                <span>Add World</span>
              </button>
              <button className="open-folder-btn" onClick={handleOpenFolder} title="Open Saves Folder">
                📁 Folder
              </button>
            </>
          )}
          {activeSubTab === 'datapacks-installed' && selectedWorld && (
            <>
              <button className="open-folder-btn" onClick={() => setShowAddDatapackModal(true)} title="Add Datapack">
                <Plus size={16} />
                <span>Add Datapack</span>
              </button>
              <button
                className="open-folder-btn"
                onClick={handleOpenSelectedDatapacksFolder}
                title="Open Datapacks Folder"
              >
                📁 Folder
              </button>
            </>
          )}
        </div>
      </div>

      {activeSubTab === 'worlds' ? (
        <div className="installed-section worlds-content">
          {loading ? (
            <TabLoadingState label="Loading worlds" rows={4} />
          ) : worlds.length === 0 ? (
            <div className="empty-state worlds-empty-state">
              <h4>No worlds yet</h4>
              <p>Play the game to create worlds, or add existing worlds to the saves folder.</p>
            </div>
          ) : filteredWorlds.length === 0 ? (
            <div className="mods-container">
              <div className="search-controls-refined">
                <div className="search-input-wrapper-refined">
                  <div className="search-box-wide">
                    <input
                      ref={searchInputRef}
                      type="text"
                      placeholder="Search worlds..."
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                    />
                    {searchQuery && (
                      <button className="clear-search-btn" onClick={() => setSearchQuery('')} title="Clear search">
                        <X size={14} />
                      </button>
                    )}
                  </div>
                </div>
                <button className="search-btn" onClick={() => searchInputRef.current?.focus()}>
                  Search
                </button>
              </div>
              <div className="empty-state worlds-empty-state">
                <h4>No worlds found</h4>
                <p>No worlds match "{searchQuery}".</p>
                <button className="text-btn" onClick={() => setSearchQuery('')}>Clear search</button>
              </div>
            </div>
          ) : (
            <div className="mods-container">
              <div className="search-controls-refined">
                <div className="search-input-wrapper-refined">
                  <div className="search-box-wide">
                    <input
                      ref={searchInputRef}
                      type="text"
                      placeholder="Search worlds..."
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                    />
                    {searchQuery && (
                      <button className="clear-search-btn" onClick={() => setSearchQuery('')} title="Clear search">
                        <X size={14} />
                      </button>
                    )}
                  </div>
                </div>
                <button className="search-btn" onClick={() => searchInputRef.current?.focus()}>
                  Search
                </button>
              </div>

              <div className="mod-group">
                <div className="group-header">
                  <h3 className="group-title">Managed</h3>
                  <div className="group-header-line"></div>
                  <button className="select-all-btn-inline" onClick={handleSelectAll}>
                    <div className={`selection-checkbox mini ${allFilteredSelected ? 'checked' : ''}`}>
                      {allFilteredSelected && <Check size={10} />}
                    </div>
                    <span>{allFilteredSelected ? 'Deselect All' : 'Select All'}</span>
                  </button>
                </div>
              </div>

              <div className="worlds-list">
                {filteredWorlds.map((world) => (
                  <div
                    key={world.folder_name}
                    className={`world-card ${selectedWorlds.includes(world.folder_name) ? 'selected' : ''}`}
                    onContextMenu={(e) => handleWorldContextMenu(e, world)}
                  >
                    <div
                      className="item-selection"
                      onClick={(event) => {
                        event.stopPropagation();
                        handleToggleSelectWorld(world.folder_name);
                      }}
                      title={selectedWorlds.includes(world.folder_name) ? 'Deselect world' : 'Select world'}
                      aria-label={selectedWorlds.includes(world.folder_name) ? 'Deselect world' : 'Select world'}
                    >
                      <div className={`selection-checkbox ${selectedWorlds.includes(world.folder_name) ? 'checked' : ''}`}>
                        {selectedWorlds.includes(world.folder_name) && <Check size={11} />}
                      </div>
                    </div>
                    <div className="world-icon">
                      {world.icon ? (
                        <img
                          src={`data:image/png;base64,${world.icon}`}
                          alt=""
                          className="world-icon-image"
                        />
                      ) : (
                        <span className="world-icon-fallback">W</span>
                      )}
                    </div>
                    <div className="world-info">
                      <div className="world-title-row">
                        <h4>{world.name}</h4>
                        {world.name !== world.folder_name && (
                          <span className="world-folder-name">({world.folder_name})</span>
                        )}
                      </div>
                      <div className="world-meta">
                        <span>{getGameModeIcon(world.game_mode)}</span>
                        <span>{formatSize(world.size)}</span>
                        <span>Last played: {formatDate(world.last_played)}</span>
                      </div>
                    </div>
                    <div className="world-actions">
                      <button
                        className="open-btn world-action-datapacks"
                        onClick={() => {
                          setSelectedWorld(world);
                          setActiveSubTab('datapacks-installed');
                        }}
                      >
                        <FolderOpen size={14} />
                        Datapacks
                      </button>
                      <button
                        className="delete-btn-simple world-action-delete"
                        onClick={() => handleDeleteWorld(world)}
                        title="Delete world"
                        aria-label="Delete world"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {selectedWorlds.length > 0 && (
            <div className="bulk-actions-wrapper">
              <div className="bulk-actions-bar">
                <div className="bulk-info">
                  <span className="selected-count">{selectedWorlds.length} worlds selected</span>
                  <button className="clear-selection-btn" onClick={() => setSelectedWorlds([])}>Deselect all</button>
                </div>
                <div className="bulk-btns">
                  <button className="bulk-action-btn danger" onClick={handleDeleteSelected}>
                    <Trash2 size={13} />
                    Delete
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      ) : activeSubTab === 'find' ? (
        <div className="find-section worlds-content">
          <div className="mods-container">
            <div className="search-controls-refined">
              <button
                className={`filter-btn-modal ${selectedFindCategories.length > 0 ? 'active' : ''}`}
                onClick={() => setIsFindFilterModalOpen(true)}
                title="Filter Categories"
              >
                <ListFilterPlus size={18} />
                <span>Filters</span>
                {selectedFindCategories.length > 0 && (
                  <span className="filter-count">{selectedFindCategories.length}</span>
                )}
              </button>
              <div className="search-input-wrapper-refined">
                <div className="search-box-wide">
                  <input
                    ref={findSearchInputRef}
                    type="text"
                    placeholder="Search CurseForge worlds..."
                    value={findSearchInput}
                    onChange={(event) => setFindSearchInput(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') {
                        executeFindWorldSearch();
                      }
                    }}
                  />
                  {findSearchInput && (
                    <button className="clear-search-btn" onClick={() => setFindSearchInput('')} title="Clear search">
                      <X size={14} />
                    </button>
                  )}
                </div>
              </div>
              <button
                className="search-btn"
                onClick={() => executeFindWorldSearch()}
                disabled={searchingWorlds || checkingCurseForgeKey || !hasCurseForgeKey}
              >
                Search
              </button>
            </div>

            <h3 className="section-title">{hasAppliedFindWorldSearch ? 'Search Results' : 'Popular Worlds'}</h3>

            {checkingCurseForgeKey ? (
              <div className="loading-mods">Checking CurseForge configuration...</div>
            ) : !hasCurseForgeKey ? (
              <div className="empty-state error-state">
                <p style={{ color: '#ef4444' }}>CurseForge key not configured</p>
                <p style={{ fontSize: '12px', color: '#888', marginTop: '8px' }}>
                  Set `CURSEFORGE_API_KEY` for backend runtime.
                </p>
              </div>
            ) : (searchingWorlds || loadingPopularWorlds) ? (
              <div className="loading-mods">Loading...</div>
            ) : (
              <div className="search-results-viewport">
                <div className="search-results">
                  {displayFindWorlds.map((project, index) => {
                    const projectId = String(project?.project_id || project?.id || '').trim();
                    const isInstalling = projectId && String(installingWorldProjectId || '') === projectId;
                    return (
                      <div
                        key={`${projectId || project?.slug || index}`}
                        className={`search-result-card ${isInstalling ? 'mod-updating' : ''}`}
                      >
                        {isInstalling && (
                          <div className="mod-updating-overlay">
                            <Loader2 className="spin-icon" size={20} />
                            <span>Downloading...</span>
                          </div>
                        )}
                        <div className="result-header">
                          {project.icon_url && (
                            <img src={project.icon_url} alt="" className="result-icon" />
                          )}
                          <div className="result-info">
                            <h4>{project.title}</h4>
                            <span className="result-author">by {project.author || 'Unknown'}</span>
                          </div>
                        </div>
                        <p className="result-description">{project.description || 'No description available.'}</p>
                        <div className="result-footer">
                          <div className="result-meta">
                            <span className="result-downloads">{formatDownloads(project.downloads)} downloads</span>
                            <span className="result-platform">CURSEFORGE</span>
                          </div>
                          <button
                            className="install-btn"
                            onClick={() => handleRequestInstallWorld({
                              ...project,
                              provider_label: 'CurseForge',
                              project_type: 'world'
                            })}
                            disabled={isInstalling || !projectId}
                          >
                            {isInstalling ? <Loader2 className="spin-icon" size={16} /> : 'Install'}
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>

                {displayFindWorlds.length === 0 && (
                  <div className="empty-state">
                    <p>
                      {hasAppliedFindWorldSearch
                        ? `No worlds found for "${findSearchQuery || `${appliedFindCategories.length} filter${appliedFindCategories.length === 1 ? '' : 's'} applied`}".`
                        : 'No popular worlds available right now.'}
                    </p>
                  </div>
                )}

                {findWorldsError && (
                  <div className="empty-state error-state">
                    <p style={{ color: '#ef4444' }}>{findWorldsError}</p>
                  </div>
                )}

                {canLoadMoreWorlds && (
                  <div className="search-load-more-actions">
                    <button
                      className="search-load-more-btn"
                      onClick={loadMoreWorlds}
                      disabled={loadingMoreWorlds || searchingWorlds || loadingPopularWorlds}
                    >
                      {loadingMoreWorlds ? (
                        <>
                          <Loader2 className="search-load-more-spinner" size={16} />
                          <span>Loading...</span>
                        </>
                      ) : (
                        <span>Load More</span>
                      )}
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      ) : (
        selectedWorld ? (
          <div className="worlds-datapacks-shell">
            <WorldDatapacks
              instance={instance}
              world={selectedWorld}
              onShowNotification={onShowNotification}
              onShowConfirm={onShowConfirm}
              isScrolled={isScrolled}
              onQueueDownload={onQueueDownload}
              onDequeueDownload={onDequeueDownload}
              onUpdateDownloadStatus={onUpdateDownloadStatus}
              activeTab={activeSubTab === 'datapacks-find' ? 'find' : 'installed'}
              onTabChange={(tab) => setActiveSubTab(tab === 'find' ? 'datapacks-find' : 'datapacks-installed')}
              hideTabBar
              refreshNonce={datapacksRefreshNonce}
            />
            <button
              type="button"
              className="worlds-datapacks-back-btn"
              onClick={() => setActiveSubTab('worlds')}
            >
              <ArrowLeft size={16} />
              <span>Back to Worlds</span>
            </button>
          </div>
        ) : (
          <div className="worlds-content">
            <div className="empty-state worlds-empty-state">
              <h4>No world selected</h4>
              <p>Select a world and click Datapacks to manage installed and find datapacks.</p>
            </div>
          </div>
        )
      )}

      <FilterModal
        isOpen={isFindFilterModalOpen}
        onClose={() => setIsFindFilterModalOpen(false)}
        categories={CURSEFORGE_WORLD_CATEGORIES}
        selectedCategories={selectedFindCategories}
        onApply={handleApplyFindCategories}
        title="CurseForge World Categories"
      />

      {versionModal.show && (
        <ModVersionModal
          project={versionModal.project}
          projectId={versionModal.project?.project_id || versionModal.project?.id || versionModal.project?.slug}
          gameVersion={instance.version_id}
          loader={null}
          installedMod={null}
          onClose={() => setVersionModal({ show: false, project: null })}
          onSelect={(version) => {
            const selectedProject = versionModal.project;
            setVersionModal({ show: false, project: null });
            handleInstallCurseForgeWorld(selectedProject, version);
          }}
        />
      )}

      <ConfirmModal
        isOpen={deleteConfirm.show}
        title="Delete World"
        message={`Are you sure you want to delete world "${deleteConfirm.world?.name}"? This cannot be undone!`}
        confirmText="Delete"
        cancelText="Cancel"
        variant="danger"
        onConfirm={confirmDelete}
        onCancel={() => setDeleteConfirm({ show: false, world: null })}
      />

      <ConfirmModal
        isOpen={showAddWorldModal}
        title="Add World"
        message="Choose what you want to import. You can import world folders directly or extract .zip backups automatically."
        confirmText="Import Folder"
        extraConfirmText="Import .zip"
        cancelText="Cancel"
        variant="secondary"
        actionLayout="flat"
        onConfirm={() => handleImportWorld('folder')}
        onExtraConfirm={() => handleImportWorld('zip')}
        onCancel={() => setShowAddWorldModal(false)}
      />

      {showAddDatapackModal && (
        <div className="add-mod-modal-overlay" onClick={() => !applyingDatapackCode && setShowAddDatapackModal(false)}>
          <div className="add-mod-modal" onClick={(event) => event.stopPropagation()}>
            <div className="add-mod-header">
              <h2>Add Datapack</h2>
              <button className="close-btn-simple" onClick={() => setShowAddDatapackModal(false)}>✕</button>
            </div>
            <div className="add-mod-body">
              {applyingDatapackCode ? (
                <div className="apply-progress-container">
                  <div className="apply-status-text">{datapackApplyStatus}</div>
                  <div className="apply-progress-bar-bg">
                    <div className="apply-progress-bar-fill" style={{ width: `${datapackApplyProgress}%` }} />
                  </div>
                  <div className="apply-progress-percent">{Math.round(datapackApplyProgress)}%</div>
                </div>
              ) : (
                <>
                  <div className="choice-grid">
                    <button className="choice-card" onClick={() => {
                      setShowAddDatapackModal(false);
                      handleImportDatapackFile();
                    }}>
                      <div className="choice-icon">
                        <Upload size={24} />
                      </div>
                      <span>Add .ZIP</span>
                    </button>
                    <button className="choice-card" style={{ cursor: 'default', opacity: 1 }}>
                      <div className="choice-icon" style={{ color: 'var(--accent)' }}>
                        <Code size={24} />
                      </div>
                      <span>Use Code</span>
                    </button>
                  </div>

                  <div className="code-input-container">
                    <label style={{ fontSize: '12px', color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase' }}>Paste Share Code</label>
                    <div className="code-input-wrapper">
                      <input
                        type="text"
                        className="code-input"
                        placeholder="Paste code here..."
                        value={datapackShareCodeInput}
                        onChange={(event) => setDatapackShareCodeInput(event.target.value)}
                        disabled={applyingDatapackCode}
                      />
                      <button className="apply-btn" onClick={handleApplyDatapackCode} disabled={applyingDatapackCode || !datapackShareCodeInput.trim()}>
                        {applyingDatapackCode ? <Loader2 size={14} className="spin" /> : 'Apply'}
                      </button>
                    </div>
                    <p style={{ fontSize: '11px', color: 'var(--text-muted)', margin: 0 }}>
                      Installs datapacks from Modrinth and CurseForge.
                    </p>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      <ConfirmModal
        isOpen={deleteSelectedConfirmOpen}
        title="Delete Selected Worlds"
        message={`Are you sure you want to delete ${selectedWorlds.length} selected world${selectedWorlds.length !== 1 ? 's' : ''}? This cannot be undone!`}
        confirmText="Delete"
        cancelText="Cancel"
        variant="danger"
        onConfirm={confirmDeleteSelected}
        onCancel={() => setDeleteSelectedConfirmOpen(false)}
      />

      {worldContextMenu && createPortal(
        <div
          ref={worldContextMenuRef}
          className="screenshot-context-menu"
          style={{
            position: 'fixed',
            left: worldContextMenu.x,
            top: worldContextMenu.y,
            visibility: worldContextMenu.positioned ? 'visible' : 'hidden'
          }}
          onClick={e => e.stopPropagation()}
        >
          <div style={{ padding: '8px 12px', fontSize: '12px', opacity: 0.5, borderBottom: '1px solid var(--border)', marginBottom: '4px' }}>
            {worldContextMenu.world.name}
          </div>
          <button onClick={() => { setWorldContextMenu(null); setSelectedWorld(worldContextMenu.world); setActiveSubTab('datapacks-installed'); }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"></path><polyline points="3.27 6.96 12 12.01 20.73 6.96"></polyline><line x1="12" y1="22.08" x2="12" y2="12"></line></svg>
            Manage Datapacks
          </button>
          <button onClick={() => { setWorldContextMenu(null); handleOpenDatapacksFolder(worldContextMenu.world); }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path></svg>
            Open Datapacks Folder
          </button>
          <button onClick={() => {
            setWorldContextMenu(null);
            setRenameModal({
              show: true,
              world: worldContextMenu.world,
              newName: worldContextMenu.world.folder_name
            });
          }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9"></path><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path></svg>
            Rename World
          </button>
          <button onClick={() => { setWorldContextMenu(null); handleOpenWorldFolder(worldContextMenu.world); }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path></svg>
            Open Folder
          </button>
          <div className="divider" />
          <button className="danger" onClick={() => { setWorldContextMenu(null); handleDeleteWorld(worldContextMenu.world); }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2-2v2"></path><line x1="10" y1="11" x2="10" y2="17"></line><line x1="14" y1="11" x2="14" y2="17"></line></svg>
            Delete
          </button>
        </div>,
        document.body
      )}

      {renameModal.show && (
        <div className="welcome-overlay" onClick={() => setRenameModal({ show: false, world: null, newName: '' })}>
          <div className="rename-modal" onClick={e => e.stopPropagation()}>
            <h3>Rename World</h3>
            <p style={{ fontSize: '12px', opacity: 0.7, marginBottom: '12px' }}>
              Renaming the folder might affect some external tools or backups.
            </p>
            <input
              type="text"
              value={renameModal.newName}
              onChange={e => setRenameModal(prev => ({ ...prev, newName: e.target.value }))}
              onKeyDown={e => e.key === 'Enter' && handleRenameWorld()}
              autoFocus
            />
            <div className="rename-actions">
              <button className="rename-cancel" onClick={() => setRenameModal({ show: false, world: null, newName: '' })}>Cancel</button>
              <button className="rename-confirm" onClick={handleRenameWorld}>Rename</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default memo(InstanceWorlds);
