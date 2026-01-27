import { useState, useEffect, useRef, useCallback, useMemo, memo } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { Trash2, RefreshCcw, Plus, Upload, Copy, Code, Loader2, ChevronDown, Check, Filter } from 'lucide-react';
import { open } from '@tauri-apps/plugin-dialog';
import ConfirmModal from './ConfirmModal';
import ModVersionModal from './ModVersionModal';

const MOD_CATEGORIES = [
  { id: 'all', label: 'All Categories' },
  { id: 'optimization', label: 'Optimization' },
  { id: 'utility', label: 'Utility' },
  { id: 'technology', label: 'Technology' },
  { id: 'magic', label: 'Magic' },
  { id: 'adventure', label: 'Adventure' },
  { id: 'equipment', label: 'Equipment' },
  { id: 'storage', label: 'Storage' },
  { id: 'decoration', label: 'Decoration' },
  { id: 'library', label: 'Library' },
  { id: 'worldgen', label: 'Worldgen' },
  { id: 'food', label: 'Food' },
];

function InstanceMods({ instance, onShowConfirm, onShowNotification, isScrolled }) {
  const [activeSubTab, setActiveSubTab] = useState('installed');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('all');
  const [isCategoryOpen, setIsCategoryOpen] = useState(false);
  const categoryRef = useRef(null);
  const [installedSearchQuery, setInstalledSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [popularMods, setPopularMods] = useState([]);
  const [installedMods, setInstalledMods] = useState([]);
  const [searching, setSearching] = useState(false);
  const [installing, setInstalling] = useState(null);
  const [updatingMods, setUpdatingMods] = useState([]); // Array of IDs (filename/project_id) being updated
  const [loading, setLoading] = useState(true);
  const [loadingPopular, setLoadingPopular] = useState(true);
  const [searchError, setSearchError] = useState(null);
  const [popularError, setPopularError] = useState(null);
  const [deleteConfirm, setDeleteConfirm] = useState({ show: false, mod: null });
  const [versionModal, setVersionModal] = useState({ show: false, project: null, updateMod: null });
  const [showAddModal, setShowAddModal] = useState(false);
  const [shareCodeInput, setShareCodeInput] = useState('');
  const [applyingCode, setApplyingCode] = useState(false);
  const [applyProgress, setApplyProgress] = useState(0);
  const [applyStatus, setApplyStatus] = useState('');

  const installedSearchRef = useRef(null);
  const findSearchRef = useRef(null);

  // Close category dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (categoryRef.current && !categoryRef.current.contains(event.target)) {
        setIsCategoryOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Pagination states
  const [popularOffset, setPopularOffset] = useState(0);
  const [searchOffset, setSearchOffset] = useState(0);
  const [hasMorePopular, setHasMorePopular] = useState(true);
  const [hasMoreSearch, setHasMoreSearch] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const observer = useRef();

  useEffect(() => {
    if (activeSubTab === 'find') {
      if (searchQuery.trim() === '' && selectedCategory === 'all') {
        loadPopularMods();
      } else {
        handleSearch();
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedCategory]);

  const loadInstalledMods = useCallback(async () => {
    try {
      const mods = await invoke('get_instance_mods', { instanceId: instance.id });
      setInstalledMods(mods);
    } catch (error) {
      console.error('Failed to load mods:', error);
    }
    setLoading(false);
  }, [instance.id]);

  const loadPopularMods = useCallback(async () => {
    setLoadingPopular(true);
    setPopularOffset(0);
    setHasMorePopular(true);
    setPopularError(null);
    try {
      const results = await invoke('search_modrinth', {
        query: '',
        projectType: 'mod',
        gameVersion: instance.version_id,
        loader: instance.mod_loader?.toLowerCase() !== 'vanilla' ? instance.mod_loader?.toLowerCase() : null,
        category: selectedCategory !== 'all' ? selectedCategory : null,
        limit: 20,
        offset: 0
      });
      setPopularMods(results.hits || []);
      setHasMorePopular((results.hits?.length || 0) === 20 && results.total_hits > 20);
      setPopularOffset(results.hits?.length || 0);
    } catch (error) {
      console.error('Failed to load popular mods:', error);
      setPopularError(error.toString());
    }
    setLoadingPopular(false);
  }, [instance.version_id, instance.mod_loader, selectedCategory]);

  const loadMorePopular = useCallback(async () => {
    if (loadingMore || !hasMorePopular) return;
    setLoadingMore(true);
    try {
      const results = await invoke('search_modrinth', {
        query: '',
        projectType: 'mod',
        gameVersion: instance.version_id,
        loader: instance.mod_loader?.toLowerCase() !== 'vanilla' ? instance.mod_loader?.toLowerCase() : null,
        category: selectedCategory !== 'all' ? selectedCategory : null,
        limit: 20,
        offset: popularOffset
      });
      const newHits = results.hits || [];
      setPopularMods(prev => [...prev, ...newHits]);
      setPopularOffset(prev => prev + newHits.length);
      setHasMorePopular(newHits.length === 20 && (popularOffset + newHits.length) < results.total_hits);
    } catch (error) {
      console.error('Failed to load more popular mods:', error);
    }
    setLoadingMore(false);
  }, [loadingMore, hasMorePopular, instance.version_id, instance.mod_loader, popularOffset, selectedCategory]);

  const handleSearch = useCallback(async () => {
    if (!searchQuery.trim() && selectedCategory === 'all') {
      setSearchResults([]);
      setSearchOffset(0);
      setHasMoreSearch(false);
      setSearchError(null);
      return;
    }

    setSearching(true);
    setSearchOffset(0);
    setHasMoreSearch(true);
    setSearchError(null);
    try {
      const results = await invoke('search_modrinth', {
        query: searchQuery,
        projectType: 'mod',
        gameVersion: instance.version_id,
        loader: instance.mod_loader?.toLowerCase() !== 'vanilla' ? instance.mod_loader?.toLowerCase() : null,
        category: selectedCategory !== 'all' ? selectedCategory : null,
        limit: 20,
        offset: 0
      });
      setSearchResults(results.hits || []);
      setHasMoreSearch((results.hits?.length || 0) === 20 && results.total_hits > 20);
      setSearchOffset(results.hits?.length || 0);
    } catch (error) {
      console.error('Failed to search:', error);
      setSearchError(error.toString());
    }
    setSearching(false);
  }, [searchQuery, instance.version_id, instance.mod_loader, selectedCategory]);

  const loadMoreSearch = useCallback(async () => {
    if (loadingMore || !hasMoreSearch) return;
    setLoadingMore(true);
    try {
      const results = await invoke('search_modrinth', {
        query: searchQuery,
        projectType: 'mod',
        gameVersion: instance.version_id,
        loader: instance.mod_loader?.toLowerCase() !== 'vanilla' ? instance.mod_loader?.toLowerCase() : null,
        category: selectedCategory !== 'all' ? selectedCategory : null,
        limit: 20,
        offset: searchOffset
      });
      const newHits = results.hits || [];
      setSearchResults(prev => [...prev, ...newHits]);
      setSearchOffset(prev => prev + newHits.length);
      setHasMoreSearch(newHits.length === 20 && (searchOffset + newHits.length) < results.total_hits);
    } catch (error) {
      console.error('Failed to load more results:', error);
    }
    setLoadingMore(false);
  }, [loadingMore, hasMoreSearch, searchQuery, instance.version_id, instance.mod_loader, searchOffset, selectedCategory]);

  const lastElementRef = useCallback(node => {
    if (loadingMore || searching || loadingPopular) return;
    if (observer.current) observer.current.disconnect();
    
    observer.current = new IntersectionObserver(entries => {
      if (entries[0].isIntersecting) {
        const isSearch = searchQuery.trim().length > 0;
        if (isSearch && hasMoreSearch) {
          loadMoreSearch();
        } else if (!isSearch && hasMorePopular) {
          loadMorePopular();
        }
      }
    });
    
    if (node) observer.current.observe(node);
  }, [loadingMore, searching, loadingPopular, hasMoreSearch, hasMorePopular, searchQuery, loadMoreSearch, loadMorePopular]);

  useEffect(() => {
    loadInstalledMods();
    loadPopularMods();
  }, [loadInstalledMods, loadPopularMods]);

  useEffect(() => {
    const handleKeyDown = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
        e.preventDefault();
        if (activeSubTab === 'installed') {
          installedSearchRef.current?.focus();
        } else if (activeSubTab === 'find') {
          findSearchRef.current?.focus();
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [activeSubTab]);

  // Check if a mod is installed and return the mod object
  const getInstalledMod = useCallback((project) => {
    const projectId = project.project_id || project.id || project.slug;

    // First check by project_id
    const byId = installedMods.find(m => m.project_id === projectId);
    if (byId) return byId;

    // Fallback to filename matching
    const normalizedSlug = project.slug.toLowerCase().replace(/[^a-z0-9]/g, '');
    const normalizedTitle = (project.title || '').toLowerCase().replace(/[^a-z0-9]/g, '');

    return installedMods.find(modItem => {
      const normalizedFilename = (modItem.filename || '').toLowerCase().replace(/[^a-z0-9]/g, '');
      const normalizedName = (modItem.name || '').toLowerCase().replace(/[^a-z0-9]/g, '');
      return normalizedFilename.includes(normalizedSlug) ||
        normalizedName.includes(normalizedSlug) ||
        (normalizedTitle && (normalizedFilename.includes(normalizedTitle) || normalizedName.includes(normalizedTitle)));
    });
  }, [installedMods]);

  const isModInstalled = useCallback((project) => {
    return !!getInstalledMod(project);
  }, [getInstalledMod]);

  const handleInstall = useCallback(async (project, selectedVersionMatch = null, skipDependencyCheck = false, updateMod = null) => {
    setInstalling(project.slug);
    if (updateMod) {
      setUpdatingMods(prev => [...prev, updateMod.project_id || updateMod.filename]);
    }

    try {
      let version = selectedVersionMatch;

      if (!version) {
        const versions = await invoke('get_modrinth_versions', {
          projectId: project.slug,
          gameVersion: instance.version_id,
          loader: instance.mod_loader?.toLowerCase() || null
        });

        if (versions.length === 0) {
          alert('No compatible version found for this mod');
          setInstalling(null);
          return;
        }

        version = versions[0];
      }

      // Check for required dependencies
      if (!skipDependencyCheck && version.dependencies && version.dependencies.length > 0) {
        const requiredDeps = version.dependencies.filter(d => d.dependency_type === 'required');

        if (requiredDeps.length > 0) {
          // Fetch dependency info
          const depProjects = [];
          for (const dep of requiredDeps) {
            if (dep.project_id) {
              try {
                const depProject = await invoke('get_modrinth_project', { projectId: dep.project_id });
                // Only add if not already installed
                if (!isModInstalled(depProject)) {
                  depProjects.push(depProject);
                }
              } catch (e) {
                console.error('Failed to fetch dependency:', e);
              }
            }
          }

          if (depProjects.length > 0) {
            // Show confirmation modal for dependencies
            setInstalling(null);
            onShowConfirm({
              title: 'Install Dependencies',
              message: `${project.title} requires the following mods:\n\n${depProjects.map(d => '• ' + d.title).join('\n')}\n\nWould you like to install them?`,
              confirmText: 'Install All',
              cancelText: 'Skip Dependencies',
              variant: 'primary',
              onConfirm: async () => {
                // Install all dependencies
                for (const depProject of depProjects) {
                  await handleInstall(depProject, null, true);
                }
                // Then install the original mod with the selected version
                await handleInstall(project, version, true, updateMod);
              },
              onCancel: async () => {
                // Install without dependencies
                await handleInstall(project, version, true, updateMod);
              }
            });
            return;
          }
        }
      }

      const file = version.files.find(f => f.primary) || version.files[0];

      await invoke('install_modrinth_file', {
        instanceId: instance.id,
        fileUrl: file.url,
        filename: file.filename,
        fileType: 'mod',
        projectId: project.project_id || project.slug,
        versionId: version.id,
        name: project.title,
        author: project.author,
        iconUrl: project.icon_url,
        versionName: version.version_number
      });

      // If this was an update and the new file name is different, delete the old one
      if (updateMod && updateMod.filename !== file.filename) {
        try {
          await invoke('delete_instance_mod', {
            instanceId: instance.id,
            filename: updateMod.filename
          });
        } catch (deleteError) {
          console.error('Failed to delete old mod version:', deleteError);
        }
      }

      await loadInstalledMods();
    } catch (error) {
      console.error('Failed to install mod:', error);
      alert('Failed to install mod: ' + error);
    } finally {
      setInstalling(null);
      if (updateMod) {
        setUpdatingMods(prev => prev.filter(f => f !== (updateMod.project_id || updateMod.filename)));
      }
    }
  }, [instance.id, instance.version_id, instance.mod_loader, isModInstalled, loadInstalledMods, onShowConfirm]);

  const handleToggle = useCallback(async (mod) => {
    try {
      await invoke('toggle_instance_mod', {
        instanceId: instance.id,
        filename: mod.filename
      });
      await loadInstalledMods();
    } catch (error) {
      console.error('Failed to toggle mod:', error);
    }
  }, [instance.id, loadInstalledMods]);

  const handleRequestInstall = useCallback(async (project, updateMod = null) => {
    setVersionModal({ show: true, project, updateMod: updateMod });
  }, []);

  const handleDelete = useCallback(async (mod) => {
    setDeleteConfirm({ show: false, mod }); // Close if open
    setDeleteConfirm({ show: true, mod });
  }, []);

  const handleImportFile = useCallback(async () => {
    try {
      const selected = await open({
        multiple: true,
        filters: [{
          name: 'JAR Files',
          extensions: ['jar']
        }]
      });

      if (selected && selected.length > 0) {
        for (const path of selected) {
          await invoke('import_instance_file', {
            instanceId: instance.id,
            sourcePath: path,
            folderType: 'mods'
          });
        }
        await loadInstalledMods();
        if (onShowNotification) {
          onShowNotification(`Imported ${selected.length} mod${selected.length > 1 ? 's' : ''}`, 'success');
        }
      }
    } catch (error) {
      console.error('Failed to import mods:', error);
      if (onShowNotification) {
        onShowNotification('Failed to import mods: ' + error, 'error');
      }
    }
  }, [instance.id, loadInstalledMods, onShowNotification]);

  const handleCheckUpdate = useCallback((mod) => {
    if (!mod.project_id) return;
    setVersionModal({ 
      show: true, 
      projectId: mod.project_id, 
      updateMod: mod,
      project: { title: mod.name, icon_url: mod.icon_url, slug: mod.project_id } 
    });
  }, []);

  const handleCopyModsCode = useCallback(async () => {
    try {
      const code = await invoke('get_instance_mods_share_code', { instanceId: instance.id });
      await navigator.clipboard.writeText(code);
      if (onShowNotification) {
        onShowNotification('Mods code copied to clipboard!', 'success');
      }
    } catch (error) {
      console.error('Failed to copy mods code:', error);
      if (onShowNotification) {
        onShowNotification(`Failed to copy mods code: ${error}`, 'error');
      }
    }
  }, [instance.id, onShowNotification]);

  const handleApplyCode = useCallback(async () => {
    if (!shareCodeInput.trim()) return;

    setApplyingCode(true);
    setApplyProgress(0);
    setApplyStatus('Decoding share code...');
    
    try {
      const shareData = await invoke('decode_instance_share_code', { code: shareCodeInput.trim() });
      const mods = shareData.mods || [];

      if (mods.length === 0) {
        if (onShowNotification) {
          onShowNotification('No mods found in this code.', 'info');
        }
        setApplyingCode(false);
        return;
      }

      setApplyStatus(`Found ${mods.length} mods. Fetching metadata...`);
      setApplyProgress(10);

      // Pre-fetch metadata if possible
      let projectMap = {};
      const projectIds = mods.map(m => m.project_id || m.projectId).filter(Boolean);
      try {
        if (projectIds.length > 0) {
          const projects = await invoke('get_modrinth_projects', { projectIds });
          projects.forEach(p => {
            const id = p.project_id || p.id;
            if (id) projectMap[id] = p;
            if (p.slug) projectMap[p.slug] = p;
          });
        }
      } catch (e) {
        console.warn('Bulk fetch failed:', e);
      }

      let installedCount = 0;
      for (let i = 0; i < mods.length; i++) {
        const mod = mods[i];
        try {
          const mid = mod.project_id || mod.projectId;
          const vid = mod.version_id || mod.versionId;

          const currentModName = mod.name || mid;
          setApplyStatus(`Installing ${currentModName} (${i + 1}/${mods.length})...`);
          setApplyProgress(10 + ((i / mods.length) * 90));

          // Skip if already installed
          if (installedMods.some(m => m.project_id === mid)) {
            installedCount++;
            continue;
          }

          let info;
          if (vid) {
            info = await invoke('get_modrinth_version', { versionId: vid });
          } else {
            const versions = await invoke('get_modrinth_versions', {
              projectId: mid,
              gameVersion: instance.version_id,
              loader: instance.mod_loader?.toLowerCase() || null
            });
            info = versions.length > 0 ? versions[0] : null;
          }

          if (info) {
            let project = projectMap[mid];
            if (!project) {
              try {
                project = await invoke('get_modrinth_project', { projectId: mid });
              } catch (e) {
                console.warn(`Failed to fetch project metadata for ${mid}:`, e);
              }
            }

            const file = info.files.find(f => f.primary) || info.files[0];

            await invoke('install_modrinth_file', {
              instanceId: instance.id,
              fileUrl: file.url,
              filename: file.filename,
              fileType: 'mod',
              projectId: mid,
              versionId: info.id,
              name: project?.title || mod.name || null,
              author: project?.author || mod.author || null,
              iconUrl: project?.icon_url || mod.icon_url || mod.iconUrl || null,
              versionName: info.name || mod.version_name || mod.versionName
            });
            installedCount++;
          }
        } catch (e) {
          console.error(`Failed to install mod ${mod.project_id || mod.projectId}:`, e);
        }
      }

      setApplyProgress(100);
      if (onShowNotification) {
        onShowNotification(`Successfully installed ${installedCount} mods!`, 'success');
      }
      setTimeout(() => {
        setShowAddModal(false);
        setShareCodeInput('');
        setApplyingCode(false);
        setApplyProgress(0);
        setApplyStatus('');
        loadInstalledMods();
      }, 500);
      return;
    } catch (error) {
      console.error('Failed to apply code:', error);
      if (onShowNotification) {
        onShowNotification('Invalid or incompatible mods code.', 'error');
      }
    }
    setApplyingCode(false);
    setApplyProgress(0);
    setApplyStatus('');
  }, [shareCodeInput, instance.id, instance.version_id, instance.mod_loader, installedMods, onShowNotification, loadInstalledMods]);

  const handleOpenFolder = useCallback(async () => {
    try {
      await invoke('open_instance_folder', {
        instanceId: instance.id,
        folderType: 'mods'
      });
    } catch (error) {
      console.error('Failed to open folder:', error);
      if (onShowNotification) {
        onShowNotification(`Failed to open mods folder: ${error}`, 'error');
      }
    }
  }, [instance.id, onShowNotification]);

  const handleOpenConfigFolder = useCallback(async () => {
    try {
      await invoke('open_instance_folder', {
        instanceId: instance.id,
        folderType: 'config'
      });
    } catch (error) {
      console.error('Failed to open folder:', error);
      if (onShowNotification) {
        onShowNotification(`Failed to open config folder: ${error}`, 'error');
      }
    }
  }, [instance.id, onShowNotification]);

  const confirmDelete = useCallback(async () => {
    const mod = deleteConfirm.mod;
    setDeleteConfirm({ show: false, mod: null });

    try {
      await invoke('delete_instance_mod', {
        instanceId: instance.id,
        filename: mod.filename
      });
      await loadInstalledMods();
    } catch (error) {
      console.error('Failed to delete mod:', error);
    }
  }, [instance.id, deleteConfirm.mod, loadInstalledMods]);

  const formatDownloads = useCallback((num) => {
    if (num >= 1000000) return (num / 1000000).toFixed(1) + 'M';
    if (num >= 1000) return (num / 1000).toFixed(1) + 'K';
    return num.toString();
  }, []);

  const formatFileSize = useCallback((bytes) => {
    if (!bytes || bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }, []);

  const getLoaderBadges = useCallback((categories) => {
    if (!categories) return [];
    const loadersList = [];
    if (categories.includes('fabric')) loadersList.push('Fabric');
    if (categories.includes('forge')) loadersList.push('Forge');
    if (categories.includes('neoforge')) loadersList.push('NeoForge');
    if (categories.includes('quilt')) loadersList.push('Quilt');
    return loadersList;
  }, []);

  const filteredInstalledMods = useMemo(() => {
    return installedMods.filter(m => {
      if (!installedSearchQuery.trim()) return true;
      const query = installedSearchQuery.toLowerCase();
      return (m.name || '').toLowerCase().includes(query) || 
             (m.filename || '').toLowerCase().includes(query);
    });
  }, [installedMods, installedSearchQuery]);

  const modrinthMods = useMemo(() => {
    return filteredInstalledMods
      .filter(m => m.provider === 'Modrinth')
      .sort((a, b) => (a.name || a.filename).localeCompare(b.name || b.filename));
  }, [filteredInstalledMods]);

  const manualMods = useMemo(() => {
    return filteredInstalledMods
      .filter(m => m.provider !== 'Modrinth')
      .sort((a, b) => (a.name || a.filename).localeCompare(b.name || b.filename));
  }, [filteredInstalledMods]);

  if (instance.mod_loader === 'Vanilla' || !instance.mod_loader) {
    return (
      <div className="mods-tab">
        <div className="empty-state">
          <h4>Mods require a mod loader</h4>
          <p>Go to Settings and install Fabric, Forge, or NeoForge to use mods.</p>
        </div>
      </div>
    );
  }

  const displayMods = searchQuery.trim() ? searchResults : popularMods;

  return (
    <div className="mods-tab">
      <div className={`sub-tabs-row ${isScrolled ? 'scrolled' : ''}`}>
        <div className="sub-tabs">
          <button
            className={`sub-tab ${activeSubTab === 'installed' ? 'active' : ''}`}
            onClick={() => setActiveSubTab('installed')}
          >
            Installed ({installedMods.length})
          </button>
          <button
            className={`sub-tab ${activeSubTab === 'find' ? 'active' : ''}`}
            onClick={() => setActiveSubTab('find')}
          >
            Find Mods
          </button>
        </div>
        <div className="sub-tabs-actions">
          {activeSubTab === 'installed' && (
            <>
              <button className="open-folder-btn" onClick={() => setShowAddModal(true)} title="Add Mod">
                <Plus size={16} />
                <span>Add Mod</span>
              </button>
              <button className="open-folder-btn" onClick={handleOpenFolder}>
                📁 Folder
              </button>
              <button className="open-folder-btn" onClick={handleOpenConfigFolder}>
                ⚙️ Configs
              </button>
            </>
          )}
        </div>
      </div>

      {activeSubTab === 'installed' ? (
        <div className="installed-section">
          {installedMods.length > 0 && (
            <div className="search-input-wrapper" style={{ position: 'relative', marginBottom: '0' }}>
              <input
                ref={installedSearchRef}
                type="text"
                placeholder="Search installed mods... (Ctrl+F)"
                value={installedSearchQuery}
                onChange={(e) => setInstalledSearchQuery(e.target.value)}
                style={{ paddingRight: '40px' }}
              />
              {installedSearchQuery && (
                <button 
                  className="clear-search-btn" 
                  onClick={() => setInstalledSearchQuery('')}
                  style={{ position: 'absolute', right: '12px', top: '50%', transform: 'translateY(-50%)' }}
                >
                  ✕
                </button>
              )}
            </div>
          )}
          
          {loading ? (
            <p>Loading...</p>
          ) : installedMods.length === 0 ? (
            <div className="empty-state">
              <p>No mods installed. Go to "Find Mods" to browse and install mods.</p>
            </div>
          ) : filteredInstalledMods.length === 0 ? (
            <div className="empty-state">
              <p>No mods matching "{installedSearchQuery}"</p>
              <button className="text-btn" onClick={() => setInstalledSearchQuery('')}>Clear search</button>
            </div>
          ) : (
            <div className="mods-container">
              {modrinthMods.length > 0 && (
                <div className="mod-group">
                  <div className="group-header">
                    <h3 className="group-title">Modrinth</h3>
                    <div className="group-header-line"></div>
                    <button className="copy-code-btn" onClick={handleCopyModsCode} title="Copy Mods Share Code">
                      <Copy size={12} />
                      <span>Copy Code</span>
                    </button>
                  </div>
                  <div className="installed-list">
                    {modrinthMods.map((mod) => {
                      const isUpdating = updatingMods.includes(mod.project_id || mod.filename);
                      return (
                        <div key={mod.filename} className={`installed-item ${!mod.enabled ? 'disabled' : ''} ${isUpdating ? 'mod-updating' : ''}`}>
                          {isUpdating && (
                            <div className="mod-updating-overlay">
                              <RefreshCcw className="spin-icon" size={20} />
                              <span>Updating...</span>
                            </div>
                          )}
                          <div className="item-main">
                            <div
                              className={`item-toggle ${mod.enabled ? 'enabled' : ''}`}
                              onClick={() => !isUpdating && handleToggle(mod)}
                              title={mod.enabled ? "Disable Mod" : "Enable Mod"}
                            />
                            {mod.icon_url ? (
                              <img src={mod.icon_url} alt="" className="mod-icon-small" />
                            ) : (
                              <div className="mod-icon-placeholder">📦</div>
                            )}
                            <div className="item-info clickable" onClick={() => handleCheckUpdate(mod)}>
                              <div className="item-title-row">
                                <h4>{mod.name || mod.filename}</h4>
                                {mod.version && <span className="mod-version-tag">v{mod.version}</span>}
                              </div>
                              <div className="item-meta-row">
                                <span className="mod-provider">{mod.provider}</span>
                                <span className="mod-separator">•</span>
                                <span className="mod-size">{formatFileSize(mod.size)}</span>
                              </div>
                            </div>
                          </div>
                          <div className="item-actions">
                            <button 
                              className="update-btn-simple" 
                              onClick={() => handleCheckUpdate(mod)}
                              title="Check for updates"
                              disabled={isUpdating}
                            >
                              <RefreshCcw size={14} />
                            </button>
                            <button 
                              className="delete-btn-simple" 
                              onClick={() => handleDelete(mod)} 
                              title="Delete mod"
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

              {manualMods.length > 0 && (
                <div className="mod-group">
                  <div className="group-header">
                    <h3 className="group-title">Other</h3>
                    <div className="group-header-line"></div>
                  </div>
                  <div className="installed-list">
                    {manualMods.map((mod) => {
                      const isUpdating = updatingMods.includes(mod.project_id || mod.filename);
                      return (
                        <div key={mod.filename} className={`installed-item ${!mod.enabled ? 'disabled' : ''} ${isUpdating ? 'mod-updating' : ''}`}>
                          {isUpdating && (
                            <div className="mod-updating-overlay">
                              <RefreshCcw className="spin-icon" size={20} />
                              <span>Updating...</span>
                            </div>
                          )}
                          <div className="item-main">
                            <div
                              className={`item-toggle ${mod.enabled ? 'enabled' : ''}`}
                              onClick={() => !isUpdating && handleToggle(mod)}
                              title={mod.enabled ? "Disable Mod" : "Enable Mod"}
                            />
                            <div className="mod-icon-placeholder">📦</div>
                            <div className="item-info">
                              <div className="item-title-row">
                                <h4>{mod.name || mod.filename}</h4>
                              </div>
                              <div className="item-meta-row">
                                <span className="mod-provider manual">Manual</span>
                                <span className="mod-separator">•</span>
                                <span className="mod-size">{formatFileSize(mod.size)}</span>
                              </div>
                            </div>
                          </div>
                          <div className="item-actions">
                            <button 
                              className="delete-btn-simple" 
                              onClick={() => handleDelete(mod)} 
                              title="Delete mod"
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
            </div>
          )}
        </div>
      ) : (
        <div className="find-mods-section">
          <div className="find-mods-controls" style={{ display: 'flex', gap: '12px', marginBottom: '20px' }}>
            <div className="p-dropdown" ref={categoryRef} style={{ flexShrink: 0 }}>
              <button 
                className={`p-dropdown-trigger ${isCategoryOpen ? 'active' : ''}`}
                onClick={() => setIsCategoryOpen(!isCategoryOpen)}
                style={{ height: '42px', width: '180px' }}
              >
                <div className="p-dropdown-label" style={{ margin: 0, opacity: 1, display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <Filter size={14} style={{ opacity: 0.6 }} />
                  <span>{MOD_CATEGORIES.find(c => c.id === selectedCategory)?.label}</span>
                </div>
                <ChevronDown size={16} className={`trigger-icon ${isCategoryOpen ? 'flip' : ''}`} />
              </button>
              {isCategoryOpen && (
                <div className="p-dropdown-menu">
                  {MOD_CATEGORIES.map(category => (
                    <div
                      key={category.id}
                      className={`p-dropdown-item ${selectedCategory === category.id ? 'selected' : ''}`}
                      onClick={() => {
                        setSelectedCategory(category.id);
                        setIsCategoryOpen(false);
                      }}
                    >
                      <span>{category.label}</span>
                      {selectedCategory === category.id && <Check size={14} className="selected-icon" />}
                    </div>
                  ))}
                </div>
              )}
            </div>
            
            <div className="search-input-wrapper" style={{ flex: 1, marginBottom: 0 }}>
              <input
                ref={findSearchRef}
                type="text"
                placeholder="Search Modrinth for mods..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
              />
              <button
                className="search-btn"
                onClick={handleSearch}
                disabled={searching}
              >
                {searching ? 'Searching...' : 'Search'}
              </button>
            </div>
          </div>

          <h3 className="section-title">
            {searchQuery.trim() || selectedCategory !== 'all' ? 'Search Results' : 'Popular Mods'}
          </h3>

          {(searching || loadingPopular) ? (
            <div className="loading-mods">Loading...</div>
          ) : (searchError || popularError) ? (
            <div className="empty-state error-state">
              <p style={{ color: '#ef4444' }}>⚠️ Failed to fetch mods</p>
              <p style={{ fontSize: '12px', color: '#888', marginTop: '8px' }}>{searchError || popularError}</p>
              <button 
                onClick={() => searchQuery.trim() ? handleSearch() : loadPopularMods()}
                style={{ marginTop: '12px', padding: '8px 16px', background: '#333', border: '1px solid #555', borderRadius: '6px', color: '#fff', cursor: 'pointer' }}
              >
                Retry
              </button>
            </div>
          ) : displayMods.length === 0 ? (
            <div className="empty-state">
              <p>{searchQuery.trim() ? `No mods found for "${searchQuery}"` : 'No popular mods available for this version.'}</p>
            </div>
          ) : (
            <div className="search-results">
              {displayMods.map((project, index) => {
                const installedMod = getInstalledMod(project);
                const isDownloading = installing === project.slug;

                return (
                  <div 
                    key={`${project.slug}-${index}`} 
                    className={`search-result-card ${isDownloading ? 'mod-updating' : ''}`}
                    ref={index === displayMods.length - 1 ? lastElementRef : null}
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
                        <div className="loader-badges">
                          {getLoaderBadges(project.categories).map((loader) => (
                            <span key={loader} className={`loader-badge loader-${loader.toLowerCase()}`}>
                              {loader}
                            </span>
                          ))}
                        </div>
                      </div>
                      {installedMod ? (
                        <button
                          className="install-btn reinstall"
                          onClick={() => handleRequestInstall(project, installedMod)}
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
                          {isDownloading ? 'Downloading...' : 'Install'}
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}              {loadingMore && (
                <div className="loading-more">
                  <Loader2 className="spin-icon" size={24} />
                  <span>Loading more mods...</span>
                </div>
              )}            </div>
          )}
        </div>
      )}

      <ConfirmModal
        isOpen={deleteConfirm.show}
        title="Delete Mod"
        message={`Are you sure you want to delete "${deleteConfirm.mod?.name}"?`}
        confirmText="Delete"
        cancelText="Cancel"
        variant="danger"
        onConfirm={confirmDelete}
        onCancel={() => setDeleteConfirm({ show: false, mod: null })}
      />

      {versionModal.show && (
        <ModVersionModal
          project={versionModal.project}
          projectId={versionModal.projectId}
          gameVersion={instance.version_id}
          loader={instance.mod_loader}
          onClose={() => setVersionModal({ show: false, project: null, projectId: null, updateMod: null })}
          onSelect={(selectedV) => {
            const updateModItem = versionModal.updateMod;
            const projectItem = versionModal.project;
            setVersionModal({ show: false, project: null, projectId: null, updateMod: null });
            handleInstall(projectItem, selectedV, false, updateModItem);
          }}
        />
      )}

      {showAddModal && (
        <div className="add-mod-modal-overlay" onClick={() => !applyingCode && setShowAddModal(false)}>
          <div className="add-mod-modal" onClick={e => e.stopPropagation()}>
            <div className="add-mod-header">
              <h2>Add Mod</h2>
              <button className="close-btn-simple" onClick={() => setShowAddModal(false)}>✕</button>
            </div>
            <div className="add-mod-body">
              {applyingCode ? (
                <div className="apply-progress-container">
                  <div className="apply-status-text">{applyStatus}</div>
                  <div className="apply-progress-bar-bg">
                    <div 
                      className="apply-progress-bar-fill" 
                      style={{ width: `${applyProgress}%` }}
                    />
                  </div>
                  <div className="apply-progress-percent">{Math.round(applyProgress)}%</div>
                </div>
              ) : (
                <>
                  <div className="choice-grid">
                    <button className="choice-card" onClick={() => {
                      setShowAddModal(false);
                      handleImportFile();
                    }}>
                      <div className="choice-icon">
                        <Upload size={24} />
                      </div>
                      <span>Add .JAR</span>
                    </button>
                    <button className="choice-card" onClick={() => {
                      // Stay in modal but maybe show input
                    }} style={{ cursor: 'default', opacity: 1 }}>
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
                        value={shareCodeInput}
                        onChange={(e) => setShareCodeInput(e.target.value)}
                        disabled={applyingCode}
                      />
                      <button 
                        className="apply-btn" 
                        onClick={handleApplyCode}
                        disabled={applyingCode || !shareCodeInput.trim()}
                      >
                        {applyingCode ? '...' : 'Apply'}
                      </button>
                    </div>
                    <p style={{ fontSize: '11px', color: 'var(--text-muted)', margin: 0 }}>
                      Adding mods from code will automatically download them from Modrinth.
                    </p>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default memo(InstanceMods);
