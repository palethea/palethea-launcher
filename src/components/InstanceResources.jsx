import { useState, useEffect, useRef, useCallback, useMemo, memo } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { Trash2, RefreshCcw, Plus, Upload, Loader2, ChevronDown, Check, ListFilterPlus, Settings2, X } from 'lucide-react';
import { open } from '@tauri-apps/plugin-dialog';
import ConfirmModal from './ConfirmModal';
import ModVersionModal from './ModVersionModal';
import FilterModal from './FilterModal';
import './FilterModal.css';

const RESOURCE_PACK_CATEGORIES = [
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

const SHADER_CATEGORIES = [
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

function InstanceResources({ instance, onShowConfirm, onShowNotification, isScrolled }) {
  const [activeSubTab, setActiveSubTab] = useState('resourcepacks');
  const [resourcePacks, setResourcePacks] = useState([]);
  const [shaderPacks, setShaderPacks] = useState([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategories, setSelectedCategories] = useState([]);
  const [isFilterModalOpen, setIsFilterModalOpen] = useState(false);
  const [searchResults, setSearchResults] = useState([]);
  const [popularItems, setPopularItems] = useState([]);
  const [searching, setSearching] = useState(false);
  const [installing, setInstalling] = useState(null);
  const [updatingItems, setUpdatingItems] = useState([]); // Array of filenames being updated
  const [loading, setLoading] = useState(true);
  const [loadingPopular, setLoadingPopular] = useState(false);
  const [error, setError] = useState(null);
  const [searchError, setSearchError] = useState(null);
  const [deleteConfirm, setDeleteConfirm] = useState({ show: false, item: null, type: null });
  const [versionModal, setVersionModal] = useState({ show: false, project: null, updateItem: null });
  const [selectedItems, setSelectedItems] = useState([]); // Array of filenames

  // Pagination states
  const [popularOffset, setPopularOffset] = useState(0);
  const [searchOffset, setSearchOffset] = useState(0);
  const [hasMorePopular, setHasMorePopular] = useState(true);
  const [hasMoreSearch, setHasMoreSearch] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const loadingMoreRef = useRef(false);
  const hasMorePopularRef = useRef(true);
  const hasMoreSearchRef = useRef(true);
  const searchEpochRef = useRef(0);
  const [isCheckingUpdates, setIsCheckingUpdates] = useState(false);
  const [updatesFound, setUpdatesFound] = useState({}); // { project_id: version_obj }
  const observer = useRef();
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

  const handleSearch = useCallback(async (newOffset = 0) => {
    const isInitial = newOffset === 0;

    if (isInitial) {
      if (!searchQuery.trim() && selectedCategories.length === 0) {
        setSearchResults([]);
        setSearchOffset(0);
        setHasMoreSearch(false);
        hasMoreSearchRef.current = false;
        return;
      }
      searchEpochRef.current += 1;
      setSearching(true);
      setSearchOffset(0);
      setHasMoreSearch(true);
      hasMoreSearchRef.current = true;
    } else {
      if (loadingMoreRef.current || !hasMoreSearchRef.current) return;
      setLoadingMore(true);
      loadingMoreRef.current = true;
    }

    const projectType = activeSubTab === 'find-resourcepacks' ? 'resourcepack' : 'shader';
    const currentEpoch = searchEpochRef.current;
    
    try {
      const results = await invoke('search_modrinth', {
        query: searchQuery,
        projectType: projectType,
        gameVersion: instance.version_id,
        loader: null,
        categories: selectedCategories.length > 0 ? selectedCategories : null,
        limit: 20,
        offset: newOffset,
        index: searchQuery.trim() === '' ? 'downloads' : 'relevance'
      });
      
      if (currentEpoch !== searchEpochRef.current) return;

      const newHits = results.hits || [];
      if (isInitial) {
        setSearchResults(newHits);
      } else {
        setSearchResults(prev => [...prev, ...newHits]);
      }

      const totalHits = results.total_hits || 0;
      const currentTotal = isInitial ? newHits.length : (searchResults.length + newHits.length);
      const more = newHits.length === 20 && currentTotal < totalHits;
      
      setHasMoreSearch(more);
      hasMoreSearchRef.current = more;
      setSearchOffset(isInitial ? newHits.length : (searchOffset + newHits.length));
    } catch (error) {
      console.error('Failed to search:', error);
    } finally {
      if (currentEpoch === searchEpochRef.current) {
        if (isInitial) setSearching(false);
        else {
          setLoadingMore(false);
          loadingMoreRef.current = false;
        }
      }
    }
  }, [searchQuery, activeSubTab, instance.version_id, selectedCategories]);

  const loadPopularItems = useCallback(async () => {
    const projectType = activeSubTab === 'find-resourcepacks' ? 'resourcepack' : 'shader';
    
    searchEpochRef.current += 1;
    const currentEpoch = searchEpochRef.current;

    setLoadingPopular(true);
    setSearchResults([]);
    setSearchQuery('');
    setError(null);
    setSearchError(null);
    setSearchOffset(0);
    setPopularOffset(0);
    setHasMorePopular(true);
    hasMorePopularRef.current = true;

    try {
      const results = await invoke('search_modrinth', {
        query: '',
        projectType: projectType,
        gameVersion: instance.version_id,
        loader: null,
        categories: selectedCategories.length > 0 ? selectedCategories : null,
        limit: 20,
        offset: 0,
        index: 'downloads'
      });

      if (currentEpoch !== searchEpochRef.current) return;

      setPopularItems(results?.hits || []);
      const more = (results.hits?.length || 0) === 20 && results.total_hits > 20;
      setHasMorePopular(more);
      hasMorePopularRef.current = more;
      setPopularOffset(results.hits?.length || 0);
    } catch (err) {
      console.error('Failed to load popular items:', err);
      if (currentEpoch === searchEpochRef.current) {
        setSearchError(err.toString());
        setPopularItems([]);
      }
    } finally {
      if (currentEpoch === searchEpochRef.current) {
        setLoadingPopular(false);
      }
    }
  }, [activeSubTab, instance.version_id, selectedCategories]);

  const loadMorePopular = useCallback(async () => {
    if (loadingMoreRef.current || !hasMorePopularRef.current) return;
    const projectType = activeSubTab === 'find-resourcepacks' ? 'resourcepack' : 'shader';
    
    setLoadingMore(true);
    loadingMoreRef.current = true;
    
    const currentEpoch = searchEpochRef.current;

    try {
      const results = await invoke('search_modrinth', {
        query: '',
        projectType: projectType,
        gameVersion: instance.version_id,
        loader: null,
        categories: selectedCategories.length > 0 ? selectedCategories : null,
        limit: 20,
        offset: popularOffset,
        index: 'downloads'
      });

      if (currentEpoch !== searchEpochRef.current) return;

      const newHits = results.hits || [];
      if (newHits.length > 0) {
        setPopularItems(prev => [...prev, ...newHits]);
        setPopularOffset(prev => prev + newHits.length);
      }
      const more = newHits.length === 20 && (popularOffset + newHits.length) < results.total_hits;
      setHasMorePopular(more);
      hasMorePopularRef.current = more;
    } catch (err) {
      console.error('Failed to load more popular items:', err);
    } finally {
      if (currentEpoch === searchEpochRef.current) {
        setLoadingMore(false);
        loadingMoreRef.current = false;
      }
    }
  }, [instance.version_id, popularOffset, selectedCategories, activeSubTab]);

  const loadMoreSearch = useCallback(async () => {
    if (loadingMoreRef.current || !hasMoreSearchRef.current) return;
    const projectType = activeSubTab === 'find-resourcepacks' ? 'resourcepack' : 'shader';
    
    setLoadingMore(true);
    loadingMoreRef.current = true;
    
    const currentEpoch = searchEpochRef.current;

    try {
      const results = await invoke('search_modrinth', {
        query: searchQuery,
        projectType: projectType,
        gameVersion: instance.version_id,
        loader: null,
        categories: selectedCategories.length > 0 ? selectedCategories : null,
        limit: 20,
        offset: searchOffset,
        index: !searchQuery.trim() ? 'downloads' : 'relevance'
      });

      if (currentEpoch !== searchEpochRef.current) return;

      const newHits = results.hits || [];
      if (newHits.length > 0) {
        setSearchResults(prev => [...prev, ...newHits]);
        setSearchOffset(prev => prev + newHits.length);
      }
      const more = newHits.length === 20 && (searchOffset + newHits.length) < results.total_hits;
      setHasMoreSearch(more);
      hasMoreSearchRef.current = more;
    } catch (err) {
      console.error('Failed to load more search results:', err);
    } finally {
      if (currentEpoch === searchEpochRef.current) {
        setLoadingMore(false);
        loadingMoreRef.current = false;
      }
    }
  }, [searchQuery, instance.version_id, searchOffset, selectedCategories, activeSubTab]);

  const lastElementRef = useCallback(node => {
    if (loadingMoreRef.current || searching || loadingPopular) return;
    if (observer.current) observer.current.disconnect();

    observer.current = new IntersectionObserver(entries => {
      if (entries[0].isIntersecting) {
        const isSearchType = searchQuery.trim().length > 0 || selectedCategories.length > 0;
        if (isSearchType && hasMoreSearchRef.current && !loadingMoreRef.current) {
          loadMoreSearch();
        } else if (!isSearchType && hasMorePopularRef.current && !loadingMoreRef.current) {
          loadMorePopular();
        }
      }
    });

    if (node) observer.current.observe(node);
  }, [loadingPopular, searching, searchQuery, selectedCategories, loadMoreSearch, loadMorePopular]);

  // Effects
  useEffect(() => {
    loadResources();
  }, [loadResources]);

  useEffect(() => {
    // Reset filters when switching between tabs
    setSelectedCategories([]);
    setSearchQuery('');
    setSelectedItems([]);
  }, [activeSubTab]);

  useEffect(() => {
    if (activeSubTab === 'find-resourcepacks' || activeSubTab === 'find-shaders') {
      const delay = searchQuery.trim() === '' && selectedCategories.length === 0 ? 0 : 500;
      const timer = setTimeout(() => {
        if (searchQuery.trim() === '' && selectedCategories.length === 0) {
          loadPopularItems();
        } else {
          handleSearch();
        }
      }, delay);
      return () => clearTimeout(timer);
    }
  }, [activeSubTab, selectedCategories, searchQuery, loadPopularItems, handleSearch]);

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

    if (!installedList || installedList.length === 0) return null;

    const projectId = project.project_id || project.id;

    // First check by project_id
    if (projectId) {
      const byId = installedList.find(m => m.project_id === projectId);
      if (byId) return byId;
    }

    // Normalize: remove all non-alphanumeric characters and lowercase
    const searchTitle = (project.title || project.name || '').toLowerCase().trim();
    const searchSlug = (project.slug || '').toLowerCase().trim();

    return installedList.find(item => {
      const itemTitle = (item.name || '').toLowerCase().trim();
      const itemFilename = (item.filename || '').toLowerCase().trim();

      return (searchTitle && (itemTitle === searchTitle || itemFilename.includes(searchTitle))) ||
        (searchSlug && (itemFilename.includes(searchSlug) || itemTitle.includes(searchSlug)));
    });
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
    setInstalling(project.slug || project.project_id || project.id);
    if (updateItem) {
      setUpdatingItems(prev => [...prev, updateItem.filename]);
    }
    try {
      const fileType = project.project_type || (activeSubTab.includes('resourcepack') ? 'resourcepack' : 'shader');
      let version = selectedVersion;

      if (!version) {
        const versions = await invoke('get_modrinth_versions', {
          projectId: project.slug,
          gameVersion: instance.version_id,
          loader: null
        });

        if (versions.length === 0) {
          if (onShowNotification) {
            onShowNotification('No compatible version found', 'error');
          }
          setInstalling(null);
          return;
        }

        version = versions[0];
      }

      const file = version.files.find(f => f.primary) || version.files[0];

      await invoke('install_modrinth_file', {
        instanceId: instance.id,
        fileUrl: file.url,
        filename: file.filename,
        fileType: fileType,
        projectId: project.project_id || project.slug || project.id,
        versionId: version.id,
        iconUrl: project.icon_url || project.thumbnail,
        name: project.title || project.name,
        author: project.author,
        versionName: version.version_number,
        // ----------
        // Categories
        // Description: Pass Modrinth categories for filtering installed items
        // ----------
        categories: project.categories || project.display_categories || (updateItem ? updateItem.categories : null) || null
      });

      // If updating, delete the old file
      if (updateItem && updateItem.filename !== file.filename) {
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
      if (onShowNotification) {
        onShowNotification(`Failed to install: ${error}`, 'error');
      }
    }
    setInstalling(null);
    if (updateItem) {
      setUpdatingItems(prev => prev.filter(f => f !== updateItem.filename));
    }
  }, [activeSubTab, instance.version_id, instance.id, loadResources, onShowNotification]);

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
    const modrinthRPs = resourcePacks.filter(p => p.provider === 'Modrinth' && p.project_id);
    const modrinthSPs = shaderPacks.filter(p => p.provider === 'Modrinth' && p.project_id);
    const modrinthItems = [...modrinthRPs, ...modrinthSPs];

    if (modrinthItems.length === 0) return;

    setIsCheckingUpdates(true);
    const updates = {};

    try {
      for (const item of modrinthItems) {
        try {
          // Shaders and resource packs don't usually need a loader, so we pass null or empty
          const versions = await invoke('get_modrinth_versions', {
            projectId: item.project_id,
            gameVersion: instance.version_id,
            loader: null
          });

          if (versions.length > 0) {
            const latest = versions[0];
            if (latest.id !== item.version_id) {
              updates[item.project_id] = latest;
            }
          }
        } catch (e) {
          console.warn(`Failed to check update for ${item.name}:`, e);
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
  }, [resourcePacks, shaderPacks, instance.version_id, onShowNotification]);

  const handleUpdateAll = useCallback(async () => {
    const modrinthRPs = resourcePacks.filter(p => p.provider === 'Modrinth' && p.project_id);
    const modrinthSPs = shaderPacks.filter(p => p.provider === 'Modrinth' && p.project_id);
    const allItems = [...modrinthRPs, ...modrinthSPs];
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
          const latestVersion = updatesFound[item.project_id];
          if (!latestVersion) continue;

          try {
            // Get project info for handleInstall
            const project = await invoke('get_modrinth_project', { projectId: item.project_id });
            await handleInstall(project, latestVersion, true, item);
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

  const matchesAllSelectedCategories = useCallback((project) => {
    if (selectedCategories.length === 0) return true;
    const categories = project?.categories || project?.display_categories || [];
    return selectedCategories.every(cat => categories.includes(cat));
  }, [selectedCategories]);

  const displayItems = useMemo(() => {
    const base = (searchQuery.trim() || selectedCategories.length > 0) ? searchResults : popularItems;
    return base.filter(matchesAllSelectedCategories);
  }, [searchQuery, selectedCategories, searchResults, popularItems, matchesAllSelectedCategories]);

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

              {resourcePacks.filter(p => p.provider === 'Modrinth').length > 0 && (
                <div className="mod-group">
                  <div className="group-header">
                    <h3 className="group-title">Modrinth</h3>
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
                      .filter(p => p.provider === 'Modrinth')
                      .sort((a, b) => (a.name || a.filename).localeCompare(b.name || b.filename))
                      .map((rp) => {
                        const isUpdating = updatingItems.includes(rp.filename) || (rp.project_id && installing === rp.project_id);
                        const isSelected = selectedItems.includes(rp.filename);
                        return (
                          <div
                            key={rp.filename}
                            className={`installed-item ${isUpdating ? 'mod-updating' : ''} ${isSelected ? 'selected' : ''}`}
                            onClick={() => {
                              if (selectedItems.length > 0) {
                                handleToggleSelect(rp.filename);
                              } else {
                                handleRequestInstall({ project_id: rp.project_id, title: rp.name, slug: rp.project_id, icon_url: rp.icon_url, project_type: 'resourcepack', categories: rp.categories }, rp);
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
                                  {rp.version && <span className="mod-version-tag">v{rp.version}</span>}
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
                                  handleRequestInstall({ project_id: rp.project_id, title: rp.name, slug: rp.project_id, icon_url: rp.icon_url, project_type: 'resourcepack', categories: rp.categories }, rp);
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
              {resourcePacks.filter(p => p.provider !== 'Modrinth').length > 0 && (
                <div className="mod-group">
                  <div className="group-header">
                    <h3 className="group-title">Manual</h3>
                    <div className="group-header-line"></div>
                  </div>
                  <div className="installed-list">
                    {filteredResourcePacks
                      .filter(p => !p.provider || p.provider === 'Manual')
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

              {shaderPacks.filter(p => p.provider === 'Modrinth').length > 0 && (
                <div className="mod-group">
                  <div className="group-header">
                    <h3 className="group-title">Modrinth</h3>
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
                      .filter(p => p.provider === 'Modrinth')
                      .sort((a, b) => (a.name || a.filename).localeCompare(b.name || b.filename))
                      .map((sp) => {
                        const isUpdating = updatingItems.includes(sp.filename) || (sp.project_id && installing === sp.project_id);
                        const isSelected = selectedItems.includes(sp.filename);
                        return (
                          <div
                            key={sp.filename}
                            className={`installed-item ${isUpdating ? 'mod-updating' : ''} ${isSelected ? 'selected' : ''}`}
                            onClick={() => {
                              if (selectedItems.length > 0) {
                                handleToggleSelect(sp.filename);
                              } else {
                                handleRequestInstall({ project_id: sp.project_id, title: sp.name, slug: sp.project_id, icon_url: sp.icon_url, project_type: 'shader' }, sp);
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
                                  {sp.version && <span className="mod-version-tag">v{sp.version}</span>}
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
                                    handleRequestInstall({ project_id: sp.project_id, title: sp.name, slug: sp.project_id, icon_url: sp.icon_url, project_type: 'shader' }, sp);
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
              {shaderPacks.filter(p => p.provider !== 'Modrinth').length > 0 && (
                <div className="mod-group">
                  <div className="group-header">
                    <h3 className="group-title">Manual</h3>
                    <div className="group-header-line"></div>
                  </div>
                  <div className="installed-list">
                    {filteredShaderPacks
                      .filter(p => !p.provider || p.provider === 'Manual')
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
                    placeholder={`Search Modrinth for ${activeSubTab === 'find-resourcepacks' ? 'packs' : 'shaders'}...`}
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
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
                onClick={handleSearch}
                disabled={searching}
              >
                {searching ? <Loader2 className="spin-icon" size={18} /> : 'Search'}
              </button>
            </div>

            <h3 className="section-title">
              {searchQuery.trim() || selectedCategories.length > 0 ? 'Search Results' : `Popular ${activeSubTab === 'find-resourcepacks' ? 'Resource Packs' : 'Shaders'}`}
            </h3>

            {(searching || loadingPopular) ? (
              <div className="loading-mods">Loading...</div>
            ) : searchError ? (
              <div className="empty-state error-state">
                <p style={{ color: '#ef4444' }}>⚠️ Failed to fetch items</p>
                <p style={{ fontSize: '12px', color: '#888', marginTop: '8px' }}>{searchError}</p>
                <button
                  onClick={() => searchQuery.trim() ? handleSearch() : loadPopularItems()}
                  style={{ marginTop: '12px', padding: '8px 16px', background: '#333', border: '1px solid #555', borderRadius: '6px', color: '#fff', cursor: 'pointer' }}
                >
                  Retry
                </button>
              </div>
            ) : displayItems.length === 0 ? (
              <div className="empty-state">
                <p>
                  {searchQuery.trim() || selectedCategories.length > 0
                    ? `No results found for your search.`
                    : 'No popular items available for this version.'}
                </p>
              </div>
            ) : (
              <div className="search-results">
                {displayItems.map((project, index) => {
                  const installedItem = getInstalledItem(project);
                  const isDownloading = installing === (project.slug || project.project_id || project.id);

                  return (
                    <div
                      key={`${project.slug}-${index}`}
                      className={`search-result-card ${isDownloading ? 'mod-updating' : ''}`}
                      ref={index === displayItems.length - 1 ? lastElementRef : null}
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
                            onClick={() => handleRequestInstall(project, installedItem)}
                            disabled={isDownloading}
                          >
                            Reinstall
                          </button>
                        ) : (
                          <button
                            className="install-btn"
                            onClick={() => handleRequestInstall(project)}
                            disabled={isDownloading}
                          >
                            Install
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
                {loadingMore && (
                  <div className="loading-more">
                    <Loader2 className="spin-icon" size={24} />
                    <span>Loading more items...</span>
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
        categories={isShaderTab ? SHADER_CATEGORIES : RESOURCE_PACK_CATEGORIES}
        selectedCategories={selectedCategories}
        onApply={setSelectedCategories}
        title={isShaderTab ? "Shader Filters" : "Resource Pack Filters"}
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
