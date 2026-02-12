import { useState, useEffect, useRef, useCallback, useMemo, memo } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { Trash2, RefreshCcw, Plus, Upload, Loader2, ChevronDown, Check, ListFilterPlus, Settings2, X, Wand2 } from 'lucide-react';
import { open } from '@tauri-apps/plugin-dialog';
import ConfirmModal from './ConfirmModal';
import ModVersionModal from './ModVersionModal';
import FilterModal from './FilterModal';
import useModrinthSearch from '../hooks/useModrinthSearch';
import { findInstalledProject, matchesSelectedCategories } from '../utils/projectBrowser';
import { maybeShowCurseForgeBlockedDownloadModal } from '../utils/curseforgeInstallError';
import { formatInstalledVersionLabel, withVersionPrefix } from '../utils/versionDisplay';
import './FilterModal.css';

const MODRINTH_RESOURCE_PACK_CATEGORIES = [
  { id: 'group-categories', label: 'Categories', isSection: true },
  { id: 'combat', label: 'Combat' },
  { id: 'cursed', label: 'Cursed' },
  { id: 'decoration', label: 'Decoration' },
  { id: 'modded', label: 'Modded' },
  { id: 'realistic', label: 'Realistic' },
  { id: 'simplistic', label: 'Simplistic' },
  { id: 'themed', label: 'Themed' },
  { id: 'tweaks', label: 'Tweaks' },
  { id: 'utility', label: 'Utility' },
  { id: 'vanilla-like', label: 'Vanilla-like' },
  { id: 'group-features', label: 'Features', isSection: true },
  { id: 'audio', label: 'Audio' },
  { id: 'blocks', label: 'Blocks' },
  { id: 'core-shaders', label: 'Core Shaders' },
  { id: 'entities', label: 'Entities' },
  { id: 'environment', label: 'Environment' },
  { id: 'equipment', label: 'Equipment' },
  { id: 'fonts', label: 'Fonts' },
  { id: 'gui', label: 'GUI' },
  { id: 'items', label: 'Items' },
  { id: 'locale', label: 'Locale' },
  { id: 'models', label: 'Models' },
  { id: 'group-resolutions', label: 'Resolutions', isSection: true },
  { id: '8x', label: '8x or lower' },
  { id: '16x', label: '16x' },
  { id: '32x', label: '32x' },
  { id: '48x', label: '48x' },
  { id: '64x', label: '64x' },
  { id: '128x', label: '128x' },
  { id: '256x', label: '256x' },
  { id: '512x', label: '512x or higher' },
];

const MODRINTH_SHADER_CATEGORIES = [
  { id: 'group-categories', label: 'Categories', isSection: true },
  { id: 'cartoon', label: 'Cartoon' },
  { id: 'cursed', label: 'Cursed' },
  { id: 'fantasy', label: 'Fantasy' },
  { id: 'realistic', label: 'Realistic' },
  { id: 'semi-realistic', label: 'Semi-realistic' },
  { id: 'vanilla-like', label: 'Vanilla-like' },
  { id: 'group-features', label: 'Features', isSection: true },
  { id: 'atmosphere', label: 'Atmosphere' },
  { id: 'bloom', label: 'Bloom' },
  { id: 'colored-lighting', label: 'Colored Lighting' },
  { id: 'foliage', label: 'Foliage' },
  { id: 'path-tracing', label: 'Path Tracing' },
  { id: 'pbr', label: 'PBR' },
  { id: 'reflections', label: 'Reflections' },
  { id: 'shadows', label: 'Shadows' },
  { id: 'group-performance', label: 'Performance Impact', isSection: true },
  { id: 'high', label: 'High' },
  { id: 'low', label: 'Low' },
  { id: 'medium', label: 'Medium' },
  { id: 'potato', label: 'Potato' },
  { id: 'screenshot', label: 'Screenshot' },
];

const CURSEFORGE_RESOURCE_PACK_CATEGORIES = [
  { id: 'group-resolution', label: 'Resolution', isSection: true },
  { id: 'cf-rp-16x', label: '16x', queryValue: '16x' },
  { id: 'cf-rp-32x', label: '32x', queryValue: '32x' },
  { id: 'cf-rp-64x', label: '64x', queryValue: '64x' },
  { id: 'cf-rp-128x', label: '128x', queryValue: '128x' },
  { id: 'cf-rp-256x', label: '256x', queryValue: '256x' },
  { id: 'cf-rp-512x-higher', label: '512x and Higher', queryValue: '512x and Higher' },

  { id: 'group-style', label: 'Style', isSection: true },
  { id: 'cf-rp-animated', label: 'Animated', queryValue: 'Animated' },
  { id: 'cf-rp-medieval', label: 'Medieval', queryValue: 'Medieval' },
  { id: 'cf-rp-modern', label: 'Modern', queryValue: 'Modern' },
  { id: 'cf-rp-photo-realistic', label: 'Photo Realistic', queryValue: 'Photo Realistic' },
  { id: 'cf-rp-steampunk', label: 'Steampunk', queryValue: 'Steampunk' },
  { id: 'cf-rp-traditional', label: 'Traditional', queryValue: 'Traditional' },

  { id: 'group-extra', label: 'Extra', isSection: true },
  { id: 'cf-rp-mod-support', label: 'Mod Support', queryValue: 'Mod Support' },
  { id: 'cf-rp-data-packs', label: 'Data Packs', queryValue: 'Data Packs' },
  { id: 'cf-rp-font-packs', label: 'Font Packs', queryValue: 'Font Packs' },
  { id: 'cf-rp-misc', label: 'Miscellaneous', queryValue: 'Miscellaneous' },
  { id: 'cf-rp-modjam-2025', label: 'ModJam 2025', queryValue: 'ModJam 2025' },
];

const CURSEFORGE_SHADER_CATEGORIES = [
  { id: 'group-categories', label: 'Categories', isSection: true },
  { id: 'cf-sh-fantasy', label: 'Fantasy', queryValue: 'Fantasy' },
  { id: 'cf-sh-realistic', label: 'Realistic', queryValue: 'Realistic' },
  { id: 'cf-sh-vanilla', label: 'Vanilla', queryValue: 'Vanilla' },
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

const isCurseForgeProjectId = (value) => /^\d+$/.test(String(value || '').trim());

const normalizeProviderLabel = (provider, projectId) => {
  const normalized = String(provider || '').toLowerCase();
  if (normalized === 'curseforge') return 'CurseForge';
  if (normalized === 'modrinth') return 'Modrinth';
  return isCurseForgeProjectId(projectId) ? 'CurseForge' : 'Modrinth';
};

const getUpdateRowLatestVersion = (row) => {
  const provider = normalizeProviderLabel(row?.provider, row?.project_id).toLowerCase();
  if (provider === 'curseforge') {
    return row?.latest_curseforge_version || null;
  }
  return row?.latest_version || null;
};

function InstanceResources({
  instance,
  onShowConfirm,
  onShowNotification,
  isScrolled,
  onQueueDownload,
  onDequeueDownload,
  onUpdateDownloadStatus
}) {
  const [activeSubTab, setActiveSubTab] = useState('resourcepacks');
  const [resourcePacks, setResourcePacks] = useState([]);
  const [shaderPacks, setShaderPacks] = useState([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [findSearchQuery, setFindSearchQuery] = useState('');
  const [selectedCategories, setSelectedCategories] = useState([]);
  const [appliedFindCategories, setAppliedFindCategories] = useState([]);
  const [isFilterModalOpen, setIsFilterModalOpen] = useState(false);
  const [installing, setInstalling] = useState(null);
  const [updatingItems, setUpdatingItems] = useState([]); // Array of filenames being updated
  const [loading, setLoading] = useState(true);
  const [findProvider, setFindProvider] = useState('modrinth');
  const [hasCurseForgeKey, setHasCurseForgeKey] = useState(false);
  const [error, setError] = useState(null);
  const [deleteConfirm, setDeleteConfirm] = useState({ show: false, item: null, type: null });
  const [versionModal, setVersionModal] = useState({ show: false, project: null, updateItem: null });
  const [selectedItems, setSelectedItems] = useState([]); // Array of filenames

  const [isCheckingUpdates, setIsCheckingUpdates] = useState(false);
  const [updatesFound, setUpdatesFound] = useState({}); // { project_id: update_row }
  const [resolvingManualType, setResolvingManualType] = useState(null);
  const installedSearchRef = useRef();
  const findSearchRef = useRef();

  const loadResources = useCallback(async () => {
    setError(null);
    try {
      const [rp, sp] = await Promise.all([
        invoke('get_instance_resourcepacks', { instanceId: instance.id }).catch(() => []),
        invoke('get_instance_shaderpacks', { instanceId: instance.id }).catch(() => [])
      ]);
      setResourcePacks(rp || []);
      setShaderPacks(sp || []);
    } catch (err) {
      console.error('Failed to load resources:', err);
      setError('Failed to load resources: ' + err.toString());
      setResourcePacks([]);
      setShaderPacks([]);
    }
    setLoading(false);
  }, [instance.id]);

  const discoverProjectType =
    activeSubTab === 'find-resourcepacks' ? 'resourcepack' : 'shader';
  const activeFilterCategories = useMemo(() => {
    const isFindResourcepacks = activeSubTab === 'find-resourcepacks';
    const isFindShaders = activeSubTab === 'find-shaders';

    if (isFindResourcepacks && findProvider === 'curseforge') {
      return CURSEFORGE_RESOURCE_PACK_CATEGORIES;
    }
    if (isFindShaders && findProvider === 'curseforge') {
      return CURSEFORGE_SHADER_CATEGORIES;
    }
    if (isFindShaders || activeSubTab === 'shaders') {
      return MODRINTH_SHADER_CATEGORIES;
    }
    return MODRINTH_RESOURCE_PACK_CATEGORIES;
  }, [activeSubTab, findProvider]);
  const selectedCategoryQueryValues = useMemo(
    () => resolveSelectedCategoryQueryValues(activeFilterCategories, selectedCategories),
    [activeFilterCategories, selectedCategories]
  );
  const appliedCategoryQueryValues = useMemo(
    () => resolveSelectedCategoryQueryValues(activeFilterCategories, appliedFindCategories),
    [activeFilterCategories, appliedFindCategories]
  );
  const effectiveFindCategories = useMemo(
    () => appliedCategoryQueryValues,
    [appliedCategoryQueryValues]
  );

  const {
    searchResults,
    popularItems,
    searching,
    loadingPopular,
    loadingMore,
    canLoadMore,
    searchError,
    handleSearch,
    loadPopularItems,
    loadMore,
    resetFeed,
  } = useModrinthSearch({
    provider: findProvider,
    projectType: discoverProjectType,
    gameVersion: instance.version_id,
    loader: null,
    categories: effectiveFindCategories,
    query: findSearchQuery,
    withPopular: true,
    searchEmptyQuery: false,
  });

  const executeFindSearch = useCallback((queryOverride = searchQuery, categoriesOverride = selectedCategories) => {
    if (findProvider === 'curseforge' && !hasCurseForgeKey) {
      return;
    }
    const categoryQueryValues = Array.isArray(categoriesOverride)
      ? resolveSelectedCategoryQueryValues(activeFilterCategories, categoriesOverride)
      : selectedCategoryQueryValues;

    setFindSearchQuery(queryOverride);
    setAppliedFindCategories(categoriesOverride);

    if (queryOverride.trim() === '' && categoriesOverride.length === 0) {
      loadPopularItems();
      return;
    }

    handleSearch(0, queryOverride, categoryQueryValues);
  }, [searchQuery, selectedCategories, findProvider, hasCurseForgeKey, loadPopularItems, handleSearch, activeFilterCategories, selectedCategoryQueryValues]);

  // Effects
  useEffect(() => {
    loadResources();
  }, [loadResources]);

  useEffect(() => {
    const loadCurseForgeKeyStatus = async () => {
      try {
        const hasKey = await invoke('has_curseforge_api_key');
        setHasCurseForgeKey(Boolean(hasKey));
      } catch (loadError) {
        console.error('Failed to check CurseForge key status:', loadError);
        setHasCurseForgeKey(false);
      }
    };
    loadCurseForgeKeyStatus();
  }, []);

  useEffect(() => {
    // Reset filters when switching between tabs
    setSelectedCategories([]);
    setSearchQuery('');
    setFindSearchQuery('');
    setAppliedFindCategories([]);
    setSelectedItems([]);
    resetFeed();
  }, [activeSubTab, resetFeed]);

  useEffect(() => {
    const isFindTab = activeSubTab === 'find-resourcepacks' || activeSubTab === 'find-shaders';
    if (!isFindTab) return;
    setSelectedCategories([]);
    setSearchQuery('');
    setFindSearchQuery('');
    setAppliedFindCategories([]);
    resetFeed();
  }, [activeSubTab, findProvider, resetFeed]);

  useEffect(() => {
    const isFindTab = activeSubTab === 'find-resourcepacks' || activeSubTab === 'find-shaders';
    if (!isFindTab) return;
    if (findProvider === 'curseforge' && !hasCurseForgeKey) return;
    if (findSearchQuery.trim() !== '' || appliedFindCategories.length > 0) return;
    loadPopularItems();
  }, [activeSubTab, findProvider, hasCurseForgeKey, findSearchQuery, appliedFindCategories.length, loadPopularItems]);

  useEffect(() => {
    const handleKeyDown = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
        e.preventDefault();
        if (activeSubTab === 'resourcepacks' || activeSubTab === 'shaders') {
          installedSearchRef.current?.focus();
        } else if (activeSubTab === 'find-resourcepacks' || activeSubTab === 'find-shaders') {
          findSearchRef.current?.focus();
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [activeSubTab]);

  // Helpers
  const getInstalledItem = useCallback((project) => {
    const isResourcePack = activeSubTab === 'find-resourcepacks';
    const installedList = isResourcePack ? resourcePacks : shaderPacks;
    return findInstalledProject(installedList, project);
  }, [activeSubTab, resourcePacks, shaderPacks]);

  const isItemInstalled = useCallback((project) => {
    return !!getInstalledItem(project);
  }, [getInstalledItem]);

  const handleToggleSelect = useCallback((filename) => {
    setSelectedItems(prev =>
      prev.includes(filename)
        ? prev.filter(f => f !== filename)
        : [...prev, filename]
    );
  }, []);

  const handleSelectAll = useCallback(() => {
    const currentList = activeSubTab === 'resourcepacks' ? resourcePacks : shaderPacks;
    if (selectedItems.length > 0 && selectedItems.length === currentList.length) {
      setSelectedItems([]);
    } else {
      setSelectedItems(currentList.map(item => item.filename));
    }
  }, [selectedItems.length, activeSubTab, resourcePacks, shaderPacks]);

  const handleBulkDelete = useCallback(async () => {
    if (selectedItems.length === 0) return;

    onShowConfirm({
      title: 'Bulk Delete',
      message: `Are you sure you want to delete ${selectedItems.length} selected ${activeSubTab === 'resourcepacks' ? 'resource packs' : 'shaders'}?`,
      confirmText: 'Delete All',
      cancelText: 'Cancel',
      variant: 'danger',
      onConfirm: async () => {
        const type = activeSubTab === 'resourcepacks' ? 'resourcepack' : 'shader';
        const deleteInvoke = type === 'resourcepack' ? 'delete_instance_resourcepack' : 'delete_instance_shaderpack';

        for (const filename of selectedItems) {
          try {
            await invoke(deleteInvoke, {
              instanceId: instance.id,
              filename: filename
            });
          } catch (err) {
            console.error(`Failed to delete ${filename}:`, err);
          }
        }
        setSelectedItems([]);
        loadResources();
        onShowNotification(`Successfully deleted ${selectedItems.length} items.`, 'success');
      }
    });
  }, [selectedItems, activeSubTab, instance.id, onShowConfirm, loadResources, onShowNotification]);

  const handleRequestInstall = useCallback(async (project, updateItem = null) => {
    setVersionModal({ show: true, project, updateItem: updateItem });
  }, []);

  const handleInstall = useCallback(async (project, selectedVersion = null, skipDependencyCheck = false, updateItem = null) => {
    const resolvedProjectId = String(project?.project_id || project?.id || project?.slug || updateItem?.project_id || '').trim();
    const providerLabel = normalizeProviderLabel(
      project?.provider_label || project?.provider || updateItem?.provider,
      resolvedProjectId
    );
    const provider = providerLabel.toLowerCase();
    const downloadId = resolvedProjectId || updateItem?.filename || project?.slug;

    if (onQueueDownload) {
      onQueueDownload({
        id: downloadId,
        name: project.title || project.name,
        icon: project.icon_url || project.thumbnail,
        status: 'Preparing...'
      });
    }

    setInstalling(resolvedProjectId || project.slug || project.project_id || project.id);
    if (updateItem) {
      setUpdatingItems(prev => [...prev, updateItem.filename]);
    }
    try {
      const fileType = project.project_type || updateItem?.item_type || (activeSubTab.includes('resourcepack') ? 'resourcepack' : 'shader');
      let version = selectedVersion;

      if (onUpdateDownloadStatus) {
        onUpdateDownloadStatus(downloadId, 'Fetching version...');
      }

      if (provider === 'modrinth' && !version) {
        const versions = await invoke('get_modrinth_versions', {
          projectId: project.slug || resolvedProjectId,
          gameVersion: instance.version_id,
          loader: null
        });

        if (versions.length === 0) {
          if (onShowNotification) {
            onShowNotification('No compatible version found', 'error');
          }
          setInstalling(null);
          if (onDequeueDownload) {
            onDequeueDownload(downloadId, false);
          }
          if (updateItem) {
            setUpdatingItems(prev => prev.filter(f => f !== updateItem.filename));
          }
          return;
        }

        version = versions[0];
      }

      let installedFilename = '';
      if (provider === 'curseforge') {
        if (!resolvedProjectId) {
          throw new Error('Missing CurseForge project ID');
        }

        if (!version) {
          const cfVersions = await invoke('get_curseforge_modpack_versions', { projectId: resolvedProjectId });
          if (!Array.isArray(cfVersions) || cfVersions.length === 0) {
            throw new Error('No compatible CurseForge file found');
          }
          const sorted = [...cfVersions].sort((a, b) => new Date(b.date_published) - new Date(a.date_published));
          version = sorted[0];
        }

        const file = version?.files?.find((f) => f.primary) || version?.files?.[0];
        if (!file) {
          throw new Error('Selected CurseForge version has no downloadable file');
        }
        installedFilename = file.filename || `${resolvedProjectId}-${version.id}.zip`;

        if (onUpdateDownloadStatus) {
          onUpdateDownloadStatus(downloadId, 'Downloading...');
        }

        await invoke('install_curseforge_file', {
          instanceId: instance.id,
          projectId: resolvedProjectId,
          fileId: version.id,
          fileType,
          filename: installedFilename,
          fileUrl: file.url || null,
          worldName: null,
          iconUrl: project.icon_url || project.thumbnail || updateItem?.icon_url || null,
          name: project.title || project.name || updateItem?.name || null,
          author: project.author || updateItem?.author || null,
          versionName: version.name || version.version_number || null,
          categories: project.categories || project.display_categories || (updateItem ? updateItem.categories : null) || null
        });
      } else {
        const file = version.files.find(f => f.primary) || version.files[0];
        installedFilename = file.filename;

        if (onUpdateDownloadStatus) {
          onUpdateDownloadStatus(downloadId, 'Downloading...');
        }

        await invoke('install_modrinth_file', {
          instanceId: instance.id,
          fileUrl: file.url,
          filename: file.filename,
          fileType: fileType,
          projectId: resolvedProjectId || project.slug || project.id,
          versionId: version.id,
          iconUrl: project.icon_url || project.thumbnail,
          name: project.title || project.name,
          author: project.author,
          versionName: version.version_number,
          categories: project.categories || project.display_categories || (updateItem ? updateItem.categories : null) || null
        });
      }

      // If updating, delete the old file
      if (updateItem && updateItem.filename !== installedFilename) {
        if (import.meta.env.DEV) {
          invoke('log_event', { level: 'info', message: `Deleting old file: ${updateItem.filename}` }).catch(() => { });
        }
        if (fileType === 'resourcepack') {
          await invoke('delete_instance_resourcepack', {
            instanceId: instance.id,
            filename: updateItem.filename
          });
        } else {
          await invoke('delete_instance_shaderpack', {
            instanceId: instance.id,
            filename: updateItem.filename
          });
        }
      }

      await loadResources();
      if (onShowNotification) {
        onShowNotification(`${project.title || project.name} ${updateItem ? 'updated' : 'installed'} successfully`, 'success');
      }
    } catch (error) {
      console.error('Failed to install:', error);
      const handledCurseForgeRestriction = await maybeShowCurseForgeBlockedDownloadModal({
        error,
        provider,
        project,
        projectId: resolvedProjectId,
        onShowConfirm,
        onShowNotification,
      });
      if (!handledCurseForgeRestriction && onShowNotification) {
        onShowNotification(`Failed to install: ${error}`, 'error');
      }
    }
    setInstalling(null);
    if (onDequeueDownload) {
      setTimeout(() => onDequeueDownload(downloadId), 1000);
    }
    if (updateItem) {
      setUpdatingItems(prev => prev.filter(f => f !== updateItem.filename));
    }
  }, [activeSubTab, instance.version_id, instance.id, loadResources, onShowConfirm, onShowNotification, onQueueDownload, onDequeueDownload, onUpdateDownloadStatus]);

  const handleDelete = useCallback(async (item, type) => {
    setDeleteConfirm({ show: true, item, type });
  }, []);

  const confirmDelete = useCallback(async () => {
    const { item, type } = deleteConfirm;
    setDeleteConfirm({ show: false, item: null, type: null });

    try {
      if (type === 'resourcepack') {
        await invoke('delete_instance_resourcepack', {
          instanceId: instance.id,
          filename: item.filename
        });
      } else {
        await invoke('delete_instance_shaderpack', {
          instanceId: instance.id,
          filename: item.filename
        });
      }
      await loadResources();
    } catch (error) {
      console.error('Failed to delete:', error);
    }
  }, [deleteConfirm, instance.id, loadResources]);

  const handleBulkCheckUpdates = useCallback(async () => {
    const trackedRPs = resourcePacks.filter((p) => p.project_id && (!p.provider || p.provider !== 'Manual'));
    const trackedSPs = shaderPacks.filter((p) => p.project_id && (!p.provider || p.provider !== 'Manual'));
    if (trackedRPs.length + trackedSPs.length === 0) return;

    setIsCheckingUpdates(true);
    const updates = {};

    try {
      const [resourceRows, shaderRows] = await Promise.all([
        invoke('get_instance_mod_updates', { instanceId: instance.id, fileType: 'resourcepack' }),
        invoke('get_instance_mod_updates', { instanceId: instance.id, fileType: 'shader' })
      ]);

      for (const row of [...(Array.isArray(resourceRows) ? resourceRows : []), ...(Array.isArray(shaderRows) ? shaderRows : [])]) {
        if (row?.project_id && getUpdateRowLatestVersion(row)) {
          updates[row.project_id] = row;
        }
      }
      setUpdatesFound(updates);
      if (onShowNotification) {
        const count = Object.keys(updates).length;
        if (count > 0) {
          onShowNotification(`Found updates for ${count} item${count > 1 ? 's' : ''}!`, 'info');
        } else {
          onShowNotification('All packs and shaders are up to date.', 'success');
        }
      }
    } catch (error) {
      console.error('Bulk update check failed:', error);
    } finally {
      setIsCheckingUpdates(false);
    }
  }, [resourcePacks, shaderPacks, instance.id, onShowNotification]);

  const handleUpdateAll = useCallback(async () => {
    const trackedRPs = resourcePacks
      .filter((p) => p.project_id && (!p.provider || p.provider !== 'Manual'))
      .map((item) => ({ ...item, item_type: 'resourcepack' }));
    const trackedSPs = shaderPacks
      .filter((p) => p.project_id && (!p.provider || p.provider !== 'Manual'))
      .map((item) => ({ ...item, item_type: 'shader' }));
    const allItems = [...trackedRPs, ...trackedSPs];
    const itemsToUpdate = allItems.filter(item => updatesFound[item.project_id]);

    if (itemsToUpdate.length === 0) return;

    onShowConfirm({
      title: 'Update Everything',
      message: `Would you like to update ${itemsToUpdate.length} items to their latest versions?`,
      confirmText: 'Update All',
      cancelText: 'Cancel',
      variant: 'primary',
      onConfirm: async () => {
        for (const item of itemsToUpdate) {
          const updateRow = updatesFound[item.project_id];
          const latestVersion = getUpdateRowLatestVersion(updateRow);
          if (!latestVersion) continue;

          try {
            const provider = normalizeProviderLabel(updateRow?.provider || item.provider, item.project_id);
            const project = provider === 'CurseForge'
              ? await invoke('get_curseforge_modpack', { projectId: item.project_id })
              : await invoke('get_modrinth_project', { projectId: item.project_id });
            await handleInstall({
              ...project,
              project_id: item.project_id,
              slug: item.project_id,
              provider_label: provider,
              project_type: item.item_type
            }, latestVersion, true, item);
          } catch (error) {
            console.error(`Failed to update ${item.name}:`, error);
          }
        }
        setUpdatesFound({});
        onShowNotification?.('Completed bulk updates', 'info');
      }
    });
  }, [resourcePacks, shaderPacks, updatesFound, onShowConfirm, handleInstall, onShowNotification]);

  const formatDownloads = useCallback((num) => {
    if (num >= 1000000) return (num / 1000000).toFixed(1) + 'M';
    if (num >= 1000) return (num / 1000).toFixed(1) + 'K';
    return num.toString();
  }, []);

  const handleImportFile = useCallback(async (type) => {
    try {
      const selected = await open({
        multiple: true,
        filters: [{
          name: type === 'resourcepack' ? 'Resource Packs' : 'Shader Packs',
          extensions: ['zip']
        }]
      });

      if (selected && selected.length > 0) {
        for (const path of selected) {
          await invoke('import_instance_file', {
            instanceId: instance.id,
            sourcePath: path,
            folderType: type === 'resourcepack' ? 'resourcepacks' : 'shaderpacks'
          });
        }
        await loadResources();
        if (onShowNotification) {
          onShowNotification(`Imported ${selected.length} ${type === 'resourcepack' ? 'pack' : 'shader'}${selected.length > 1 ? 's' : ''}`, 'success');
        }
      }
    } catch (error) {
      console.error('Failed to import:', error);
      if (onShowNotification) {
        onShowNotification('Failed to import: ' + error, 'error');
      }
    }
  }, [instance.id, loadResources, onShowNotification]);

  const handleOpenResourcePacksFolder = useCallback(async () => {
    try {
      await invoke('open_instance_folder', {
        instanceId: instance.id,
        folderType: 'resourcepacks'
      });
    } catch (error) {
      console.error('Failed to open folder:', error);
      if (onShowNotification) {
        onShowNotification(`Failed to open resource packs folder: ${error}`, 'error');
      }
    }
  }, [instance.id, onShowNotification]);

  const handleOpenShadersFolder = useCallback(async () => {
    try {
      await invoke('open_instance_folder', {
        instanceId: instance.id,
        folderType: 'shaderpacks'
      });
    } catch (error) {
      console.error('Failed to open folder:', error);
      if (onShowNotification) {
        onShowNotification(`Failed to open shader packs folder: ${error}`, 'error');
      }
    }
  }, [instance.id, onShowNotification]);

  const handleResolveManualMetadata = useCallback(async (type, filenames = null) => {
    if (resolvingManualType) return;
    setResolvingManualType(type);
    try {
      const result = await invoke('resolve_manual_modrinth_metadata', {
        instanceId: instance.id,
        fileType: type,
        filenames
      });
      await loadResources();
      if (onShowNotification) {
        if (result.updated > 0) {
          onShowNotification(
            `Matched ${result.updated}/${result.scanned} ${type === 'resourcepack' ? 'pack' : 'shader'} file${result.updated === 1 ? '' : 's'} on Modrinth.`,
            'success'
          );
        } else if (result.scanned > 0) {
          onShowNotification('No Modrinth matches found for the selected files.', 'info');
        } else {
          onShowNotification('No manual files available to check.', 'info');
        }
      }
    } catch (error) {
      console.error('Failed to resolve metadata on Modrinth:', error);
      onShowNotification?.(`Failed to check Modrinth: ${error}`, 'error');
    } finally {
      setResolvingManualType(null);
    }
  }, [instance.id, loadResources, onShowNotification, resolvingManualType]);

  const matchesAllSelectedCategories = useCallback((project) => {
    if (findProvider === 'curseforge') return true;
    return matchesSelectedCategories(project, appliedFindCategories);
  }, [findProvider, appliedFindCategories]);

  const displayItems = useMemo(() => {
    const base = (findSearchQuery.trim() || appliedFindCategories.length > 0) ? searchResults : popularItems;
    return base.filter(matchesAllSelectedCategories);
  }, [findSearchQuery, appliedFindCategories, searchResults, popularItems, matchesAllSelectedCategories]);
  const hasAppliedFindFilters = findSearchQuery.trim().length > 0 || appliedFindCategories.length > 0;

  const filteredResourcePacks = useMemo(() => {
    return resourcePacks.filter(p => {
      const matchesSearch = !searchQuery.trim() ||
        (p.name || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
        (p.filename || '').toLowerCase().includes(searchQuery.toLowerCase());
      const matchesCategories = selectedCategories.length === 0 ||
        (p.categories && selectedCategories.every(cat => p.categories.includes(cat)));
      return matchesSearch && matchesCategories;
    });
  }, [resourcePacks, searchQuery, selectedCategories]);

  const filteredShaderPacks = useMemo(() => {
    return shaderPacks.filter(p => {
      const matchesSearch = !searchQuery.trim() ||
        (p.name || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
        (p.filename || '').toLowerCase().includes(searchQuery.toLowerCase());
      const matchesCategories = selectedCategories.length === 0 ||
        (p.categories && selectedCategories.every(cat => p.categories.includes(cat)));
      return matchesSearch && matchesCategories;
    });
  }, [shaderPacks, searchQuery, selectedCategories]);
  const isShaderTab = activeSubTab === 'shaders' || activeSubTab === 'find-shaders';
  const isFindTab = activeSubTab === 'find-resourcepacks' || activeSubTab === 'find-shaders';

  return (
    <div className="resources-tab">
      <div className={`sub-tabs-row ${isScrolled ? 'scrolled' : ''}`}>
        <div className="sub-tabs">
          <button
            className={`sub-tab ${activeSubTab === 'resourcepacks' ? 'active' : ''}`}
            onClick={() => setActiveSubTab('resourcepacks')}
          >
            Resource Packs ({resourcePacks.length})
          </button>
          <button
            className={`sub-tab ${activeSubTab === 'find-resourcepacks' ? 'active' : ''}`}
            onClick={() => setActiveSubTab('find-resourcepacks')}
          >
            Find Packs
          </button>
          <button
            className={`sub-tab ${activeSubTab === 'shaders' ? 'active' : ''}`}
            onClick={() => setActiveSubTab('shaders')}
          >
            Shaders ({shaderPacks.length})
          </button>
          <button
            className={`sub-tab ${activeSubTab === 'find-shaders' ? 'active' : ''}`}
            onClick={() => setActiveSubTab('find-shaders')}
          >
            Find Shaders
          </button>
        </div>
        <div className="sub-tabs-actions">
          {activeSubTab === 'resourcepacks' && (
            <>
              <button className="open-folder-btn" onClick={() => handleImportFile('resourcepack')} title="Add Pack ZIP File">
                <Plus size={16} />
                <span>Add Pack</span>
              </button>
              <button className="open-folder-btn" onClick={handleOpenResourcePacksFolder}>
                📁 Folder
              </button>
            </>
          )}
          {activeSubTab === 'shaders' && (
            <>
              <button className="open-folder-btn" onClick={() => handleImportFile('shader')} title="Add Shader ZIP File">
                <Plus size={16} />
                <span>Add Shader</span>
              </button>
              <button className="open-folder-btn" onClick={handleOpenShadersFolder}>
                📁 Folder
              </button>
            </>
          )}
        </div>
      </div>

      {activeSubTab === 'resourcepacks' && (
        <div className="installed-section">
          {loading ? (
            <p>Loading...</p>
          ) : resourcePacks.length === 0 ? (
            <div className="empty-state">
              <p>No resource packs installed. Go to "Find Packs" to browse and install resource packs.</p>
            </div>
          ) : filteredResourcePacks.length === 0 ? (
            <div className="empty-state">
              <p>No resource packs matching your filters {searchQuery ? `("${searchQuery}")` : ''}</p>
              <button className="text-btn" onClick={() => { setSearchQuery(''); setSelectedCategories([]); }}>Clear all filters</button>
            </div>
          ) : (
            <div className="mods-container">
              <div className="search-controls-refined">
                <button
                  className={`filter-btn-modal ${selectedCategories.length > 0 ? 'active' : ''}`}
                  onClick={() => setIsFilterModalOpen(true)}
                  title="Filter Categories"
                >
                  <ListFilterPlus size={18} />
                  <span>Filters</span>
                  {selectedCategories.length > 0 && (
                    <span className="filter-count">{selectedCategories.length}</span>
                  )}
                </button>
                <div className="search-input-wrapper-refined">
                  <div className="search-box-wide">
                    <input
                      ref={installedSearchRef}
                      type="text"
                      placeholder="Search installed resource packs..."
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
                <button className="search-btn" onClick={() => installedSearchRef.current?.focus()}>
                  Search
                </button>
              </div>

              {resourcePacks.filter(p => p.project_id && (!p.provider || p.provider !== 'Manual')).length > 0 && (
                <div className="mod-group">
                  <div className="group-header">
                    <h3 className="group-title">Managed</h3>
                    <div className="group-header-line"></div>
                    <button className="select-all-btn-inline" onClick={handleSelectAll}>
                      <div className={`selection-checkbox mini ${selectedItems.length === resourcePacks.length && resourcePacks.length > 0 ? 'checked' : ''}`}>
                        {selectedItems.length === resourcePacks.length && resourcePacks.length > 0 && <Check size={10} />}
                      </div>
                      <span>{selectedItems.length === resourcePacks.length && resourcePacks.length > 0 ? 'Deselect All' : 'Select All'}</span>
                    </button>
                    <button
                      className={`check-updates-btn-inline ${isCheckingUpdates ? 'loading' : ''}`}
                      onClick={handleBulkCheckUpdates}
                      disabled={isCheckingUpdates}
                    >
                      {isCheckingUpdates ? <Loader2 size={12} className="spin" /> : <RefreshCcw size={12} />}
                      <span>Check Updates</span>
                      {Object.keys(updatesFound).length > 0 && (
                        <span className="update-badge pulse">{Object.keys(updatesFound).length}</span>
                      )}
                    </button>
                    {Object.keys(updatesFound).length > 0 && (
                      <button
                        className="update-all-btn-inline"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleUpdateAll();
                        }}
                        title="Update All"
                      >
                        Update All
                      </button>
                    )}
                  </div>
                  <div className="installed-list">
                    {filteredResourcePacks
                      .filter(p => p.project_id && (!p.provider || p.provider !== 'Manual'))
                      .sort((a, b) => (a.name || a.filename).localeCompare(b.name || b.filename))
                      .map((rp) => {
                        const isUpdating = updatingItems.includes(rp.filename) || (rp.project_id && installing === rp.project_id);
                        const isSelected = selectedItems.includes(rp.filename);
                        const versionLabel = withVersionPrefix(
                          formatInstalledVersionLabel(rp.version, rp.provider, rp.filename)
                        );
                        return (
                          <div
                            key={rp.filename}
                            className={`installed-item ${isUpdating ? 'mod-updating' : ''} ${isSelected ? 'selected' : ''}`}
                            onClick={() => {
                              if (selectedItems.length > 0) {
                                handleToggleSelect(rp.filename);
                              } else {
                                handleRequestInstall({
                                  project_id: rp.project_id,
                                  title: rp.name,
                                  slug: rp.project_id,
                                  icon_url: rp.icon_url,
                                  project_type: 'resourcepack',
                                  provider_label: normalizeProviderLabel(rp.provider, rp.project_id),
                                  categories: rp.categories
                                }, { ...rp, item_type: 'resourcepack' });
                              }
                            }}
                          >
                            {isUpdating && (
                              <div className="mod-updating-overlay">
                                <RefreshCcw className="spin-icon" size={20} />
                                <span>Updating...</span>
                              </div>
                            )}
                            <div className="item-main">
                              <div className="item-selection" onClick={(e) => {
                                e.stopPropagation();
                                handleToggleSelect(rp.filename);
                              }}>
                                <div className={`selection-checkbox ${isSelected ? 'checked' : ''}`}>
                                  {isSelected && <Check size={12} />}
                                </div>
                              </div>
                              {rp.icon_url ? (
                                <img src={rp.icon_url} alt={rp.name} className="mod-icon-small" onError={(e) => e.target.src = 'https://cdn-icons-png.flaticon.com/512/3011/3011270.png'} />
                              ) : (
                                <div className="mod-icon-placeholder">📦</div>
                              )}
                              <div className="item-info">
                                <div className="item-title-row">
                                  <h4>{rp.name}</h4>
                                  {versionLabel && <span className="mod-version-tag">{versionLabel}</span>}
                                  {updatesFound[rp.project_id] && (
                                    <span className="update-available-tag pulse">Update Available</span>
                                  )}
                                </div>
                                <div className="item-meta-row">
                                  <span className="mod-provider">{rp.provider}</span>
                                  {rp.size > 0 && (
                                    <>
                                      <span className="mod-separator">•</span>
                                      <span className="mod-size">{(rp.size / 1024 / 1024).toFixed(2)} MB</span>
                                    </>
                                  )}
                                </div>
                              </div>
                            </div>
                            <div className="item-actions">
                              <button
                                className="update-btn-simple"
                                title="Update Pack"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleRequestInstall({
                                    project_id: rp.project_id,
                                    title: rp.name,
                                    slug: rp.project_id,
                                    icon_url: rp.icon_url,
                                    project_type: 'resourcepack',
                                    provider_label: normalizeProviderLabel(rp.provider, rp.project_id),
                                    categories: rp.categories
                                  }, { ...rp, item_type: 'resourcepack' });
                                }}
                                disabled={isUpdating}
                              >
                                <RefreshCcw size={14} />
                              </button>
                              <button
                                className="delete-btn-simple"
                                title="Delete Pack"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleDelete(rp, 'resourcepack');
                                }}
                                disabled={isUpdating}
                              >
                                <Trash2 size={16} />
                              </button>
                            </div>
                          </div>
                        );
                      })}
                  </div>
                </div>
              )}
              {resourcePacks.filter(p => !p.project_id || !p.provider || p.provider === 'Manual').length > 0 && (
                <div className="mod-group">
                  <div className="group-header">
                    <h3 className="group-title">Manual</h3>
                    <div className="group-header-line"></div>
                    <button
                      className={`resolve-modrinth-btn-inline ${resolvingManualType === 'resourcepack' ? 'loading' : ''}`}
                      onClick={() => handleResolveManualMetadata('resourcepack')}
                      disabled={resolvingManualType !== null}
                      title="Find metadata for manual files"
                    >
                      {resolvingManualType === 'resourcepack' ? <Loader2 size={12} className="spin" /> : <Wand2 size={12} />}
                      <span>Find on Modrinth/CurseForge</span>
                    </button>
                  </div>
                  <div className="installed-list">
                    {filteredResourcePacks
                      .filter(p => !p.project_id || !p.provider || p.provider === 'Manual')
                      .sort((a, b) => (a.name || a.filename).localeCompare(b.name || b.filename))
                      .map((rp) => {
                        const isSelected = selectedItems.includes(rp.filename);
                        return (
                          <div
                            key={rp.filename}
                            className={`installed-item ${isSelected ? 'selected' : ''}`}
                            onClick={() => {
                              if (selectedItems.length > 0) {
                                handleToggleSelect(rp.filename);
                              }
                            }}
                          >
                            <div className="item-main">
                              <div className="item-selection" onClick={(e) => {
                                e.stopPropagation();
                                handleToggleSelect(rp.filename);
                              }}>
                                <div className={`selection-checkbox ${isSelected ? 'checked' : ''}`}>
                                  {isSelected && <Check size={12} />}
                                </div>
                              </div>
                              <div className="mod-icon-placeholder">📦</div>
                              <div className="item-info">
                                <div className="item-title-row">
                                  <h4>{rp.filename.endsWith('.zip') ? rp.filename : `${rp.filename}.zip`}</h4>
                                </div>
                                <div className="item-meta-row">
                                  <span className="mod-provider">Manual</span>
                                  {rp.size > 0 && (
                                    <>
                                      <span className="mod-separator">•</span>
                                      <span className="mod-size">{(rp.size / 1024 / 1024).toFixed(2)} MB</span>
                                    </>
                                  )}
                                </div>
                              </div>
                            </div>
                            <div className="item-actions">
                              <button
                                className="delete-btn-simple"
                                title="Delete Pack"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleDelete(rp, 'resourcepack');
                                }}
                              >
                                <Trash2 size={16} />
                              </button>
                            </div>
                          </div>
                        );
                      })}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {activeSubTab === 'shaders' && (
        <div className="installed-section">
          {loading ? (
            <p>Loading...</p>
          ) : shaderPacks.length === 0 ? (
            <div className="empty-state">
              <p>No shader packs installed. Go to "Find Shaders" to browse and install shaders.</p>
            </div>
          ) : filteredShaderPacks.length === 0 ? (
            <div className="empty-state">
              <p>No shaders matching your filters {searchQuery ? `("${searchQuery}")` : ''}</p>
              <button className="text-btn" onClick={() => { setSearchQuery(''); setSelectedCategories([]); }}>Clear all filters</button>
            </div>
          ) : (
            <div className="mods-container">
              <div className="search-controls-refined">
                <button
                  className={`filter-btn-modal ${selectedCategories.length > 0 ? 'active' : ''}`}
                  onClick={() => setIsFilterModalOpen(true)}
                  title="Filter Categories"
                >
                  <ListFilterPlus size={18} />
                  <span>Filters</span>
                  {selectedCategories.length > 0 && (
                    <span className="filter-count">{selectedCategories.length}</span>
                  )}
                </button>
                <div className="search-input-wrapper-refined">
                  <div className="search-box-wide">
                    <input
                      ref={installedSearchRef}
                      type="text"
                      placeholder="Search installed shaders..."
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                    />
                  </div>
                </div>
                <button className="search-btn" onClick={() => installedSearchRef.current?.focus()}>
                  Search
                </button>
              </div>

              {shaderPacks.filter(p => p.project_id && (!p.provider || p.provider !== 'Manual')).length > 0 && (
                <div className="mod-group">
                  <div className="group-header">
                    <h3 className="group-title">Managed</h3>
                    <div className="group-header-line"></div>
                    <button className="select-all-btn-inline" onClick={handleSelectAll}>
                      <div className={`selection-checkbox mini ${selectedItems.length === (activeSubTab === 'resourcepacks' ? resourcePacks.length : shaderPacks.length) && (activeSubTab === 'resourcepacks' ? resourcePacks.length : shaderPacks.length) > 0 ? 'checked' : ''}`}>
                        {selectedItems.length === (activeSubTab === 'resourcepacks' ? resourcePacks.length : shaderPacks.length) && (activeSubTab === 'resourcepacks' ? resourcePacks.length : shaderPacks.length) > 0 && <Check size={10} />}
                      </div>
                      <span>{selectedItems.length === (activeSubTab === 'resourcepacks' ? resourcePacks.length : shaderPacks.length) && (activeSubTab === 'resourcepacks' ? resourcePacks.length : shaderPacks.length) > 0 ? 'Deselect All' : 'Select All'}</span>
                    </button>
                    <button
                      className={`check-updates-btn-inline ${isCheckingUpdates ? 'loading' : ''}`}
                      onClick={handleBulkCheckUpdates}
                      disabled={isCheckingUpdates}
                    >
                      {isCheckingUpdates ? <Loader2 size={12} className="spin" /> : <RefreshCcw size={12} />}
                      <span>Check Updates</span>
                      {Object.keys(updatesFound).length > 0 && (
                        <span className="update-badge pulse">{Object.keys(updatesFound).length}</span>
                      )}
                    </button>
                    {Object.keys(updatesFound).length > 0 && (
                      <button
                        className="update-all-btn-inline"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleUpdateAll();
                        }}
                        title="Update All"
                      >
                        Update All
                      </button>
                    )}
                  </div>
                  <div className="installed-list">
                    {filteredShaderPacks
                      .filter(p => p.project_id && (!p.provider || p.provider !== 'Manual'))
                      .sort((a, b) => (a.name || a.filename).localeCompare(b.name || b.filename))
                      .map((sp) => {
                        const isUpdating = updatingItems.includes(sp.filename) || (sp.project_id && installing === sp.project_id);
                        const isSelected = selectedItems.includes(sp.filename);
                        const versionLabel = withVersionPrefix(
                          formatInstalledVersionLabel(sp.version, sp.provider, sp.filename)
                        );
                        return (
                          <div
                            key={sp.filename}
                            className={`installed-item ${isUpdating ? 'mod-updating' : ''} ${isSelected ? 'selected' : ''}`}
                            onClick={() => {
                              if (selectedItems.length > 0) {
                                handleToggleSelect(sp.filename);
                              } else {
                                handleRequestInstall({
                                  project_id: sp.project_id,
                                  title: sp.name,
                                  slug: sp.project_id,
                                  icon_url: sp.icon_url,
                                  project_type: 'shader',
                                  provider_label: normalizeProviderLabel(sp.provider, sp.project_id)
                                }, { ...sp, item_type: 'shader' });
                              }
                            }}
                          >
                            {isUpdating && (
                              <div className="mod-updating-overlay">
                                <RefreshCcw className="spin-icon" size={20} />
                                <span>Updating...</span>
                              </div>
                            )}
                            <div className="item-main">
                              <div className="item-selection" onClick={(e) => {
                                e.stopPropagation();
                                handleToggleSelect(sp.filename);
                              }}>
                                <div className={`selection-checkbox ${isSelected ? 'checked' : ''}`}>
                                  {isSelected && <Check size={12} />}
                                </div>
                              </div>
                              {sp.icon_url ? (
                                <img src={sp.icon_url} alt={sp.name} className="mod-icon-small" onError={(e) => e.target.src = 'https://cdn-icons-png.flaticon.com/512/3011/3011270.png'} />
                              ) : (
                                <div className="mod-icon-placeholder">📦</div>
                              )}
                              <div className="item-info">
                                <div className="item-title-row">
                                  <h4>{sp.name}</h4>
                                  {versionLabel && <span className="mod-version-tag">{versionLabel}</span>}
                                  {updatesFound[sp.project_id] && (
                                    <span className="update-available-tag pulse">Update Available</span>
                                  )}
                                </div>
                                <div className="item-meta-row">
                                  <span className="mod-provider">{sp.provider}</span>
                                  {sp.size > 0 && (
                                    <>
                                      <span className="mod-separator">•</span>
                                      <span className="mod-size">{(sp.size / 1024 / 1024).toFixed(2)} MB</span>
                                    </>
                                  )}
                                </div>
                              </div>
                            </div>
                            <div className="item-actions">
                              {sp.project_id && (
                                <button
                                  className="update-btn-simple"
                                  title="Update Shader"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleRequestInstall({
                                      project_id: sp.project_id,
                                      title: sp.name,
                                      slug: sp.project_id,
                                      icon_url: sp.icon_url,
                                      project_type: 'shader',
                                      provider_label: normalizeProviderLabel(sp.provider, sp.project_id)
                                    }, { ...sp, item_type: 'shader' });
                                  }}
                                  disabled={isUpdating}
                                >
                                  <RefreshCcw size={16} />
                                </button>
                              )}
                              <button
                                className="delete-btn-simple"
                                title="Delete Shader"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleDelete(sp, 'shader');
                                }}
                                disabled={isUpdating}
                              >
                                <Trash2 size={16} />
                              </button>
                            </div>
                          </div>
                        );
                      })}
                  </div>
                </div>
              )}
              {shaderPacks.filter(p => !p.project_id || !p.provider || p.provider === 'Manual').length > 0 && (
                <div className="mod-group">
                  <div className="group-header">
                    <h3 className="group-title">Manual</h3>
                    <div className="group-header-line"></div>
                    <button
                      className={`resolve-modrinth-btn-inline ${resolvingManualType === 'shader' ? 'loading' : ''}`}
                      onClick={() => handleResolveManualMetadata('shader')}
                      disabled={resolvingManualType !== null}
                      title="Find metadata for manual files"
                    >
                      {resolvingManualType === 'shader' ? <Loader2 size={12} className="spin" /> : <Wand2 size={12} />}
                      <span>Find on Modrinth/CurseForge</span>
                    </button>
                  </div>
                  <div className="installed-list">
                    {filteredShaderPacks
                      .filter(p => !p.project_id || !p.provider || p.provider === 'Manual')
                      .sort((a, b) => (a.name || a.filename).localeCompare(b.name || b.filename))
                      .map((sp) => {
                        const isSelected = selectedItems.includes(sp.filename);
                        return (
                          <div
                            key={sp.filename}
                            className={`installed-item ${isSelected ? 'selected' : ''}`}
                            onClick={() => {
                              if (selectedItems.length > 0) {
                                handleToggleSelect(sp.filename);
                              }
                            }}
                          >
                            <div className="item-main">
                              <div className="item-selection" onClick={(e) => {
                                e.stopPropagation();
                                handleToggleSelect(sp.filename);
                              }}>
                                <div className={`selection-checkbox ${isSelected ? 'checked' : ''}`}>
                                  {isSelected && <Check size={12} />}
                                </div>
                              </div>
                              <div className="mod-icon-placeholder">📦</div>
                              <div className="item-info">
                                <div className="item-title-row">
                                  <h4>{sp.filename.endsWith('.zip') ? sp.filename : `${sp.filename}.zip`}</h4>
                                </div>
                                <div className="item-meta-row">
                                  <span className="mod-provider">Manual</span>
                                  {sp.size > 0 && (
                                    <>
                                      <span className="mod-separator">•</span>
                                      <span className="mod-size">{(sp.size / 1024 / 1024).toFixed(2)} MB</span>
                                    </>
                                  )}
                                </div>
                              </div>
                            </div>
                            <div className="item-actions">
                              <button
                                className="delete-btn-simple"
                                title="Delete Shader"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleDelete(sp, 'shader');
                                }}
                              >
                                <Trash2 size={16} />
                              </button>
                            </div>
                          </div>
                        );
                      })}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {isFindTab && (
        <div className="find-section">
          <div className="mods-container">
            <div className="search-controls-refined">
              <div className="sub-tabs">
                <button
                  className={`sub-tab ${findProvider === 'modrinth' ? 'active' : ''}`}
                  onClick={() => setFindProvider('modrinth')}
                >
                  Modrinth
                </button>
                <button
                  className={`sub-tab ${findProvider === 'curseforge' ? 'active' : ''}`}
                  onClick={() => setFindProvider('curseforge')}
                >
                  CurseForge
                </button>
              </div>
              <button
                className={`filter-btn-modal ${selectedCategories.length > 0 ? 'active' : ''}`}
                onClick={() => setIsFilterModalOpen(true)}
                title="Filter Categories"
              >
                <ListFilterPlus size={18} />
                <span>Filters</span>
                {selectedCategories.length > 0 && (
                  <span className="filter-count">{selectedCategories.length}</span>
                )}
              </button>
              <div className="search-input-wrapper-refined">
                <div className="search-box-wide">
                  <input
                    ref={findSearchRef}
                    type="text"
                    placeholder={`${findProvider === 'curseforge' ? 'Search CurseForge' : 'Search Modrinth'} for ${activeSubTab === 'find-resourcepacks' ? 'packs' : 'shaders'}...`}
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && executeFindSearch()}
                  />
                  {searchQuery && (
                    <button className="clear-search-btn" onClick={() => setSearchQuery('')} title="Clear search">
                      <X size={14} />
                    </button>
                  )}
                </div>
              </div>
              <button
                className="search-btn"
                onClick={() => executeFindSearch()}
                disabled={searching || (findProvider === 'curseforge' && !hasCurseForgeKey)}
              >
                {searching ? <Loader2 className="spin-icon" size={18} /> : 'Search'}
              </button>
            </div>

            <h3 className="section-title">
              {hasAppliedFindFilters ? 'Search Results' : `Popular ${activeSubTab === 'find-resourcepacks' ? 'Resource Packs' : 'Shaders'}`}
            </h3>

            {findProvider === 'curseforge' && !hasCurseForgeKey ? (
              <div className="empty-state error-state">
                <p style={{ color: '#ef4444' }}>CurseForge key not configured</p>
                <p style={{ fontSize: '12px', color: '#888', marginTop: '8px' }}>
                  Set `CURSEFORGE_API_KEY` for backend runtime.
                </p>
              </div>
            ) : (searching || loadingPopular) ? (
              <div className="loading-mods">Loading...</div>
            ) : searchError ? (
              <div className="empty-state error-state">
                <p style={{ color: '#ef4444' }}>⚠️ Failed to fetch items</p>
                <p style={{ fontSize: '12px', color: '#888', marginTop: '8px' }}>{searchError}</p>
                <button
                  onClick={() => hasAppliedFindFilters ? executeFindSearch(findSearchQuery, appliedFindCategories) : loadPopularItems()}
                  style={{ marginTop: '12px', padding: '8px 16px', background: '#333', border: '1px solid #555', borderRadius: '6px', color: '#fff', cursor: 'pointer' }}
                >
                  Retry
                </button>
              </div>
            ) : displayItems.length === 0 ? (
              <div className="empty-state">
                <p>
                  {hasAppliedFindFilters
                    ? `No results found for your search.`
                    : 'No popular items available for this version.'}
                </p>
              </div>
            ) : (
              <div className="search-results-viewport">
                <div className="search-results">
                  {displayItems.map((project, index) => {
                    const installedItem = getInstalledItem(project);
                    const isDownloading = installing === (project.slug || project.project_id || project.id);

                    return (
                      <div
                      key={`${project.project_id || project.slug || project.id || index}`}
                        className={`search-result-card ${isDownloading ? 'mod-updating' : ''}`}
                      >
                        {isDownloading && (
                          <div className="mod-updating-overlay">
                            <RefreshCcw className="spin-icon" size={20} />
                            <span>Downloading...</span>
                          </div>
                        )}
                        <div className="result-header">
                          {project.icon_url && (
                            <img src={project.icon_url} alt="" className="result-icon" />
                          )}
                          <div className="result-info">
                            <h4>{project.title}</h4>
                            <span className="result-author">by {project.author}</span>
                          </div>
                        </div>
                        <p className="result-description">{project.description}</p>
                        <div className="result-footer">
                          <div className="result-meta">
                            <span className="result-downloads">{formatDownloads(project.downloads)} downloads</span>
                          </div>
                          {installedItem ? (
                            <button
                              className="install-btn reinstall"
                              onClick={() => handleRequestInstall({
                                ...project,
                                provider_label: findProvider === 'curseforge' ? 'CurseForge' : 'Modrinth',
                                project_type: activeSubTab === 'find-resourcepacks' ? 'resourcepack' : 'shader'
                              }, installedItem)}
                              disabled={isDownloading}
                            >
                              Reinstall
                            </button>
                          ) : (
                            <button
                              className="install-btn"
                              onClick={() => handleRequestInstall({
                                ...project,
                                provider_label: findProvider === 'curseforge' ? 'CurseForge' : 'Modrinth',
                                project_type: activeSubTab === 'find-resourcepacks' ? 'resourcepack' : 'shader'
                              })}
                              disabled={isDownloading}
                            >
                              Install
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
                {canLoadMore && (
                  <div className="search-load-more-actions">
                    <button
                      className="search-load-more-btn"
                      onClick={loadMore}
                      disabled={loadingMore || searching || loadingPopular}
                    >
                      {loadingMore ? (
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
      )}

      <FilterModal
        isOpen={isFilterModalOpen}
        onClose={() => setIsFilterModalOpen(false)}
        categories={activeFilterCategories}
        selectedCategories={selectedCategories}
        onApply={setSelectedCategories}
        title={
          (activeSubTab === 'find-resourcepacks' || activeSubTab === 'find-shaders') && findProvider === 'curseforge'
            ? (activeSubTab === 'find-shaders' ? 'CurseForge Shader Categories' : 'CurseForge Resource Pack Categories')
            : (isShaderTab ? 'Shader Filters' : 'Resource Pack Filters')
        }
      />

      {deleteConfirm.show && (
        <ConfirmModal
          isOpen={deleteConfirm.show}
          title={deleteConfirm.type === 'resourcepack' ? 'Delete Resource Pack' : 'Delete Shader'}
          message={`Are you sure you want to delete "${deleteConfirm.item?.name || deleteConfirm.item?.filename}"?`}
          confirmText="Delete"
          cancelText="Cancel"
          variant="danger"
          onConfirm={confirmDelete}
          onCancel={() => setDeleteConfirm({ show: false, item: null, type: null })}
        />
      )}

      {versionModal.show && (
        <ModVersionModal
          project={versionModal.project}
          projectId={versionModal.project?.project_id || versionModal.project?.id || versionModal.project?.slug}
          gameVersion={instance.version_id}
          loader={null}
          onClose={() => setVersionModal({ show: false, project: null, updateItem: null })}
          onSelect={(version) => {
            handleInstall(versionModal.project, version, false, versionModal.updateItem);
            setVersionModal({ show: false, project: null, updateItem: null });
          }}
        />
      )}

      {selectedItems.length > 0 && (
        <div className="bulk-actions-wrapper">
          <div className="bulk-actions-bar">
            <div className="bulk-info">
              <span className="selected-count">{selectedItems.length} {activeSubTab === 'resourcepacks' ? 'packs' : 'shaders'} selected</span>
              <button className="clear-selection-btn" onClick={() => setSelectedItems([])}>Deselect all</button>
            </div>
            <div className="bulk-btns">
              <button className="bulk-action-btn danger" onClick={handleBulkDelete}>
                <Trash2 size={13} />
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default memo(InstanceResources);
