import { useState, useEffect, useRef, useCallback, useMemo, memo } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { Trash2, RefreshCcw, Plus, Upload, FolderOpen, Loader2, ListFilterPlus, ChevronDown, Check, X } from 'lucide-react';
import { open } from '@tauri-apps/plugin-dialog';
import ConfirmModal from './ConfirmModal';
import ModVersionModal from './ModVersionModal';
import FilterModal from './FilterModal';
import './FilterModal.css';

const DATAPACK_CATEGORIES = [
    { id: 'group-categories', label: 'Categories', isSection: true },
    { id: 'adventure', label: 'Adventure' },
    { id: 'cursed', label: 'Cursed' },
    { id: 'decoration', label: 'Decoration' },
    { id: 'economy', label: 'Economy' },
    { id: 'equipment', label: 'Equipment' },
    { id: 'food', label: 'Food' },
    { id: 'game-mechanics', label: 'Game Mechanics' },
    { id: 'library', label: 'Library' },
    { id: 'magic', label: 'Magic' },
    { id: 'management', label: 'Management' },
    { id: 'minigame', label: 'Minigame' },
    { id: 'mobs', label: 'Mobs' },
    { id: 'optimization', label: 'Optimization' },
    { id: 'social', label: 'Social' },
    { id: 'storage', label: 'Storage' },
    { id: 'technology', label: 'Technology' },
    { id: 'transportation', label: 'Transportation' },
    { id: 'utility', label: 'Utility' },
    { id: 'worldgen', label: 'World Generation' },
];

function WorldDatapacks({ instance, world, onShowNotification, onBack, isScrolled }) {
    const [activeSubTab, setActiveSubTab] = useState('installed');
    const [searchQuery, setSearchQuery] = useState('');
    const [searchResults, setSearchResults] = useState([]);
    const [popularDatapacks, setPopularDatapacks] = useState([]);
    const [installedDatapacks, setInstalledDatapacks] = useState([]);
    const [searching, setSearching] = useState(false);
    const [loadingPopular, setLoadingPopular] = useState(true);
    const [installing, setInstalling] = useState(null);
    const [updatingItems, setUpdatingItems] = useState([]); // Array of filenames being updated
    const [loading, setLoading] = useState(true);
    const [selectedCategories, setSelectedCategories] = useState([]);
    const [isFilterModalOpen, setIsFilterModalOpen] = useState(false);
    const [deleteConfirm, setDeleteConfirm] = useState({ show: false, datapack: null });
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
    const observer = useRef();
    const installedSearchRef = useRef();
    const findSearchRef = useRef();

    const loadInstalledDatapacks = useCallback(async () => {
        setLoading(true);
        try {
            const packs = await invoke('get_world_datapacks', {
                instanceId: instance.id,
                worldName: world.folder_name
            });
            setInstalledDatapacks(packs);
        } catch (error) {
            console.error('Failed to load datapacks:', error);
            if (onShowNotification) {
                onShowNotification('Failed to load datapacks: ' + error, 'error');
            }
        }
        setLoading(false);
    }, [instance.id, world.folder_name, onShowNotification]);

    const loadPopularDatapacks = useCallback(async () => {
        searchEpochRef.current += 1;
        const currentEpoch = searchEpochRef.current;

        setLoadingPopular(true);
        setPopularOffset(0);
        setHasMorePopular(true);
        hasMorePopularRef.current = true;
        try {
            const results = await invoke('search_modrinth', {
                query: '',
                projectType: 'datapack',
                gameVersion: instance.version_id,
                categories: selectedCategories.length > 0 ? selectedCategories : null,
                loader: 'datapack',
                limit: 20,
                offset: 0,
                index: 'downloads'
            });

            if (currentEpoch !== searchEpochRef.current) return;

            setPopularDatapacks(results.hits || []);
            const more = (results.hits?.length || 0) === 20 && results.total_hits > 20;
            setHasMorePopular(more);
            hasMorePopularRef.current = more;
            setPopularOffset(results.hits?.length || 0);
        } catch (error) {
            console.error('Failed to load popular datapacks:', error);
        } finally {
            if (currentEpoch === searchEpochRef.current) {
                setLoadingPopular(false);
            }
        }
    }, [instance.version_id, selectedCategories]);

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

        const currentEpoch = searchEpochRef.current;
        try {
            // Modrinth uses 'project_type:datapack'
            const results = await invoke('search_modrinth', {
                query: searchQuery,
                projectType: 'datapack',
                gameVersion: instance.version_id,
                categories: selectedCategories.length > 0 ? selectedCategories : null,
                loader: 'datapack',
                limit: 20,
                offset: newOffset,
                index: searchQuery.trim() === '' ? 'downloads' : 'relevance'
            });

            if (currentEpoch !== searchEpochRef.current) return;

            const hits = results.hits || [];
            if (isInitial) {
                setSearchResults(hits);
            } else {
                setSearchResults(prev => [...prev, ...hits]);
            }
            
            const nextOffset = newOffset + hits.length;
            setSearchOffset(nextOffset);
            const more = hits.length === 20 && nextOffset < results.total_hits;
            setHasMoreSearch(more);
            hasMoreSearchRef.current = more;
        } catch (error) {
            console.error('Failed to search Modrinth for datapacks:', error);
        } finally {
            if (currentEpoch === searchEpochRef.current) {
                if (isInitial) setSearching(false);
                else {
                    setLoadingMore(false);
                    loadingMoreRef.current = false;
                }
            }
        }
    }, [searchQuery, instance.version_id, selectedCategories]);

    useEffect(() => {
        if (activeSubTab === 'find') {
            const delay = searchQuery.trim() === '' && selectedCategories.length === 0 ? 0 : 500;
            const timer = setTimeout(() => {
                if (searchQuery.trim() === '' && selectedCategories.length === 0) {
                    loadPopularDatapacks();
                } else {
                    handleSearch();
                }
            }, delay);
            return () => clearTimeout(timer);
        }
    }, [activeSubTab, selectedCategories, searchQuery, loadPopularDatapacks, handleSearch]);

    useEffect(() => {
        setSelectedItems([]);
    }, [activeSubTab]);

    // Cleanup effects when switching back to worlds or closing
    useEffect(() => {
        return () => {
            // Optional cleanup if needed
        };
    }, []);

    const loadMorePopular = useCallback(async () => {
        if (loadingMoreRef.current || !hasMorePopularRef.current) return;
        setLoadingMore(true);
        loadingMoreRef.current = true;
        const currentEpoch = searchEpochRef.current;
        try {
            const results = await invoke('search_modrinth', {
                query: '',
                projectType: 'datapack',
                gameVersion: instance.version_id,
                categories: selectedCategories.length > 0 ? selectedCategories : null,
                loader: 'datapack',
                limit: 20,
                offset: popularOffset,
                index: 'downloads'
            });

            if (currentEpoch !== searchEpochRef.current) return;

            const newHits = results.hits || [];
            if (newHits.length > 0) {
                setPopularDatapacks(prev => [...prev, ...newHits]);
                setPopularOffset(prev => prev + newHits.length);
            }
            const more = newHits.length === 20 && (popularOffset + newHits.length) < results.total_hits;
            setHasMorePopular(more);
            hasMorePopularRef.current = more;
        } catch (error) {
            console.error('Failed to load more popular datapacks:', error);
        } finally {
            if (currentEpoch === searchEpochRef.current) {
                setLoadingMore(false);
                loadingMoreRef.current = false;
            }
        }
    }, [instance.version_id, popularOffset, selectedCategories]);

    const loadMoreSearch = useCallback(async () => {
        if (loadingMoreRef.current || !hasMoreSearchRef.current) return;
        setLoadingMore(true);
        loadingMoreRef.current = true;
        const currentEpoch = searchEpochRef.current;
        try {
            const results = await invoke('search_modrinth', {
                query: searchQuery,
                projectType: 'datapack',
                gameVersion: instance.version_id,
                categories: selectedCategories.length > 0 ? selectedCategories : null,
                loader: 'datapack',
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
        } catch (error) {
            console.error('Failed to load more results:', error);
        } finally {
            if (currentEpoch === searchEpochRef.current) {
                setLoadingMore(false);
                loadingMoreRef.current = false;
            }
        }
    }, [searchQuery, instance.version_id, searchOffset, selectedCategories]);

    const lastElementRef = useCallback(node => {
        if (loadingMoreRef.current || searching || loadingPopular) return;
        if (observer.current) observer.current.disconnect();

        observer.current = new IntersectionObserver(entries => {
            if (entries[0].isIntersecting) {
                const isSearch = searchQuery.trim().length > 0 || selectedCategories.length > 0;
                if (isSearch && hasMoreSearchRef.current && !loadingMoreRef.current) {
                    loadMoreSearch();
                } else if (!isSearch && hasMorePopularRef.current && !loadingMoreRef.current) {
                    loadMorePopular();
                }
            }
        });

        if (node) observer.current.observe(node);
    }, [loadingPopular, searching, searchQuery, selectedCategories, loadMoreSearch, loadMorePopular]);

    // Effects
    useEffect(() => {
        loadInstalledDatapacks();
        loadPopularDatapacks();
    }, [world.folder_name, loadInstalledDatapacks, loadPopularDatapacks]);

    useEffect(() => {
        if (activeSubTab === 'find') {
            if (searchQuery.trim() === '' && selectedCategories.length === 0) {
                loadPopularDatapacks();
            } else {
                handleSearch();
            }
        }
    }, [activeSubTab, selectedCategories, searchQuery, loadPopularDatapacks, handleSearch]);

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

    const filteredInstalledDatapacks = useMemo(() => {
        return installedDatapacks.filter(p => {
            const matchesSearch = !searchQuery.trim() ||
                (p.name || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
                (p.filename || '').toLowerCase().includes(searchQuery.toLowerCase());
            const matchesCategories = selectedCategories.length === 0 ||
                (p.categories && selectedCategories.every(cat => p.categories.includes(cat)));
            return matchesSearch && matchesCategories;
        });
    }, [installedDatapacks, searchQuery, selectedCategories]);

    const matchesAllSelectedCategories = useCallback((project) => {
        if (selectedCategories.length === 0) return true;
        const categories = project?.categories || project?.display_categories || [];
        return selectedCategories.every(cat => categories.includes(cat));
    }, [selectedCategories]);

    const displayItems = useMemo(() => {
        const base = (searchQuery.trim() || selectedCategories.length > 0) ? searchResults : popularDatapacks;
        return base.filter(matchesAllSelectedCategories);
    }, [searchQuery, selectedCategories, searchResults, popularDatapacks, matchesAllSelectedCategories]);

    // Helpers
    const getInstalledItem = (project) => {
        if (!installedDatapacks || installedDatapacks.length === 0) return null;

        const projectId = project.project_id || project.id;

        // First check by project_id
        if (projectId) {
            const byId = installedDatapacks.find(m => m.project_id === projectId);
            if (byId) return byId;
        }

        // Fallback to title/slug matching
        const searchTitle = (project.title || '').toLowerCase().trim();
        const searchSlug = (project.slug || '').toLowerCase().trim();

        return installedDatapacks.find(item => {
            const itemTitle = (item.name || '').toLowerCase().trim();
            const itemFilename = (item.filename || '').toLowerCase().trim();

            return (searchTitle && (itemTitle === searchTitle || itemFilename.includes(searchTitle))) ||
                (searchSlug && (itemFilename.includes(searchSlug) || itemTitle.includes(searchSlug)));
        });
    };

    const isDatapackInstalled = (project) => {
        return !!getInstalledItem(project);
    };

    const handleToggleSelect = useCallback((filename) => {
        setSelectedItems(prev =>
            prev.includes(filename)
                ? prev.filter(f => f !== filename)
                : [...prev, filename]
        );
    }, []);

    const handleSelectAll = useCallback(() => {
        if (selectedItems.length > 0 && selectedItems.length === installedDatapacks.length) {
            setSelectedItems([]);
        } else {
            setSelectedItems(installedDatapacks.map(item => item.filename));
        }
    }, [selectedItems.length, installedDatapacks]);

    const handleBulkDelete = useCallback(async () => {
        if (selectedItems.length === 0) return;

        if (confirm(`Are you sure you want to delete ${selectedItems.length} selected datapacks?`)) {
            for (const filename of selectedItems) {
                try {
                    await invoke('delete_instance_datapack', {
                        instanceId: instance.id,
                        worldName: world.folder_name,
                        filename: filename
                    });
                } catch (err) {
                    console.error(`Failed to delete ${filename}:`, err);
                }
            }
            setSelectedItems([]);
            loadInstalledDatapacks();
            if (onShowNotification) {
                onShowNotification(`Successfully deleted ${selectedItems.length} datapacks.`, 'success');
            }
        }
    }, [selectedItems, instance.id, world.folder_name, loadInstalledDatapacks, onShowNotification]);

    const handleRequestInstall = useCallback((project, updateItem = null) => {
        setVersionModal({ show: true, project, updateItem: updateItem });
    }, []);

    const handleInstall = useCallback(async (project, version, skipDeps = false, updateItem = null) => {
        setInstalling(project.slug);
        if (updateItem) {
            setUpdatingItems(prev => [...prev, updateItem.filename]);
        }

        try {
            // Prefer .zip files for datapacks if available, otherwise fallback to primary or first file
            const file = version.files.find(f => f.filename.toLowerCase().endsWith('.zip')) ||
                version.files.find(f => f.primary) ||
                version.files[0];

            await invoke('install_modrinth_file', {
                instanceId: instance.id,
                fileUrl: file.url,
                filename: file.filename,
                fileType: 'datapack',
                projectId: project.project_id || project.slug || project.id,
                versionId: version.id,
                worldName: world.folder_name,
                iconUrl: project.icon_url || project.thumbnail,
                name: project.title || project.name,
                author: project.author,
                versionName: version.version_number,
                categories: project.categories || project.display_categories || (updateItem ? updateItem.categories : null) || null
            });

            // If updating, delete the old file
            if (updateItem && updateItem.filename !== file.filename) {
                if (import.meta.env.DEV) {
                    invoke('log_event', { level: 'info', message: `Deleting old datapack: ${updateItem.filename}` }).catch(() => { });
                }
                await invoke('delete_instance_datapack', {
                    instanceId: instance.id,
                    worldName: world.folder_name,
                    filename: updateItem.filename
                });
            }

            if (onShowNotification) {
                onShowNotification(`Successfully ${updateItem ? 'updated' : 'installed'} ${project.title || project.name}`, 'success');
            }

            await loadInstalledDatapacks();
        } catch (error) {
            console.error('Failed to install datapack:', error);
            if (onShowNotification) {
                onShowNotification('Failed to install datapack: ' + error, 'error');
            }
        }
        setInstalling(null);
        if (updateItem) {
            setUpdatingItems(prev => prev.filter(f => f !== updateItem.filename));
        }
    }, [instance.id, world.folder_name, onShowNotification, loadInstalledDatapacks]);

    const handleDelete = useCallback((datapack) => {
        setDeleteConfirm({ show: true, datapack });
    }, []);

    const handleImportFile = async () => {
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
                        worldName: world.folder_name
                    });
                }
                await loadInstalledDatapacks();
                if (onShowNotification) {
                    onShowNotification(`Imported ${selected.length} datapack${selected.length > 1 ? 's' : ''}`, 'success');
                }
            }
        } catch (error) {
            console.error('Failed to import datapacks:', error);
            if (onShowNotification) {
                onShowNotification('Failed to import datapacks: ' + error, 'error');
            }
        }
    };

    const handleOpenFolder = async () => {
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

    const confirmDelete = useCallback(async () => {
        const dp = deleteConfirm.datapack;
        setDeleteConfirm({ show: false, datapack: null });

        try {
            await invoke('delete_instance_datapack', {
                instanceId: instance.id,
                worldName: world.folder_name,
                filename: dp.filename
            });
            await loadInstalledDatapacks();
        } catch (error) {
            console.error('Failed to delete datapack:', error);
        }
    }, [instance.id, world.folder_name, deleteConfirm.datapack, loadInstalledDatapacks]);

    const formatDownloads = (num) => {
        if (num >= 1000000) return (num / 1000000).toFixed(1) + 'M';
        if (num >= 1000) return (num / 1000).toFixed(1) + 'K';
        return num.toString();
    };

    return (
        <div className="datapacks-view">
            <div className="view-header">
                <button className="back-btn" onClick={onBack}>← Worlds</button>
                <div className="header-info">
                    <h3>Datapacks for {world.name}</h3>
                </div>
            </div>

            <div className={`sub-tabs-row ${isScrolled ? 'scrolled' : ''}`}>
                <div className="sub-tabs">
                    <button
                        className={`sub-tab ${activeSubTab === 'installed' ? 'active' : ''}`}
                        onClick={() => setActiveSubTab('installed')}
                    >
                        Installed ({installedDatapacks.length})
                    </button>
                    <button
                        className={`sub-tab ${activeSubTab === 'find' ? 'active' : ''}`}
                        onClick={() => setActiveSubTab('find')}
                    >
                        Find Datapacks
                    </button>
                </div>
                <div className="sub-tabs-actions">
                    {activeSubTab === 'installed' && (
                        <>
                            <button className="open-folder-btn" onClick={handleImportFile} title="Add Datapack ZIP File">
                                <Plus size={16} />
                                <span>Add Datapack</span>
                            </button>
                            <button
                                className="open-folder-btn"
                                onClick={handleOpenFolder}
                                title="Open Datapacks Folder"
                            >
                                <FolderOpen size={16} />
                                <span>Folder</span>
                            </button>
                        </>
                    )}
                </div>
            </div>

            <FilterModal
                isOpen={isFilterModalOpen}
                onClose={() => setIsFilterModalOpen(false)}
                categories={DATAPACK_CATEGORIES}
                selectedCategories={selectedCategories}
                onApply={setSelectedCategories}
                title="Datapack Categories"
            />

            {activeSubTab === 'installed' ? (
                <div className="installed-section">
                    {loading ? (
                        <p>Loading...</p>
                    ) : installedDatapacks.length === 0 ? (
                        <div className="empty-state">
                            <p>No datapacks installed for this world.</p>
                        </div>
                    ) : filteredInstalledDatapacks.length === 0 ? (
                        <div className="empty-state">
                            <p>No datapacks matching your filters {searchQuery ? `("${searchQuery}")` : ''}</p>
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
                                            placeholder="Search installed datapacks..."
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

                            {installedDatapacks.filter(p => p.provider === 'Modrinth').length > 0 && (
                                <div className="mod-group">
                                    <div className="group-header">
                                        <h3 className="group-title">Modrinth</h3>
                                        <div className="group-header-line"></div>
                                        <button className="select-all-btn-inline" onClick={handleSelectAll}>
                                            <div className={`selection-checkbox mini ${selectedItems.length === installedDatapacks.length && installedDatapacks.length > 0 ? 'checked' : ''}`}>
                                                {selectedItems.length === installedDatapacks.length && installedDatapacks.length > 0 && <Check size={10} />}
                                            </div>
                                            <span>{selectedItems.length === installedDatapacks.length && installedDatapacks.length > 0 ? 'Deselect All' : 'Select All'}</span>
                                        </button>
                                    </div>
                                    <div className="installed-list">
                                        {filteredInstalledDatapacks
                                            .filter(p => p.provider === 'Modrinth')
                                            .sort((a, b) => (a.name || a.filename).localeCompare(b.name || b.filename))
                                            .map((dp) => {
                                                const isUpdating = updatingItems.includes(dp.filename);
                                                const isSelected = selectedItems.includes(dp.filename);
                                                return (
                                                    <div
                                                        key={dp.filename}
                                                        className={`installed-item ${isUpdating ? 'mod-updating' : ''} ${isSelected ? 'selected' : ''}`}
                                                        onClick={() => {
                                                            if (selectedItems.length > 0) {
                                                                handleToggleSelect(dp.filename);
                                                            } else {
                                                                handleRequestInstall({ project_id: dp.project_id, title: dp.name, slug: dp.project_id, icon_url: dp.icon_url, project_type: 'datapack', categories: dp.categories }, dp);
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
                                                                handleToggleSelect(dp.filename);
                                                            }}>
                                                                <div className={`selection-checkbox ${isSelected ? 'checked' : ''}`}>
                                                                    {isSelected && <Check size={12} />}
                                                                </div>
                                                            </div>
                                                            {dp.icon_url ? (
                                                                <img src={dp.icon_url} alt={dp.name} className="mod-icon-small" onError={(e) => e.target.src = 'https://cdn-icons-png.flaticon.com/512/3011/3011270.png'} />
                                                            ) : (
                                                                <div className="mod-icon-placeholder">📦</div>
                                                            )}
                                                            <div className="item-info">
                                                                <div className="item-title-row">
                                                                    <h4>{dp.name || dp.filename}</h4>
                                                                    {dp.version && <span className="mod-version-tag">v{dp.version}</span>}
                                                                </div>
                                                                <div className="item-meta-row">
                                                                    <span className="mod-provider">{dp.provider}</span>
                                                                    {dp.size > 0 && (
                                                                        <>
                                                                            <span className="mod-separator">•</span>
                                                                            <span className="mod-size">{(dp.size / 1024 / 1024).toFixed(2)} MB</span>
                                                                        </>
                                                                    )}
                                                                </div>
                                                            </div>
                                                        </div>
                                                        <div className="item-actions">
                                                            {dp.project_id && (
                                                                <button
                                                                    className="update-btn-simple"
                                                                    title="Update Datapack"
                                                                    onClick={(e) => {
                                                                        e.stopPropagation();
                                                                        handleRequestInstall({ project_id: dp.project_id, title: dp.name, slug: dp.project_id, icon_url: dp.icon_url, project_type: 'datapack' }, dp);
                                                                    }}
                                                                    disabled={isUpdating}
                                                                >
                                                                    <RefreshCcw size={14} />
                                                                </button>
                                                            )}
                                                            <button
                                                                className="delete-btn-simple"
                                                                title="Delete Datapack"
                                                                onClick={(e) => {
                                                                    e.stopPropagation();
                                                                    handleDelete(dp);
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
                            {installedDatapacks.filter(p => !p.provider || p.provider === 'Manual').length > 0 && (
                                <div className="mod-group">
                                    <div className="group-header">
                                        <h3 className="group-title">Manual</h3>
                                        <div className="group-header-line"></div>
                                    </div>
                                    <div className="installed-list">
                                        {filteredInstalledDatapacks
                                            .filter(p => !p.provider || p.provider === 'Manual')
                                            .sort((a, b) => (a.name || a.filename).localeCompare(b.name || b.filename))
                                            .map((dp) => {
                                                const isSelected = selectedItems.includes(dp.filename);
                                                return (
                                                    <div
                                                        key={dp.filename}
                                                        className={`installed-item ${isSelected ? 'selected' : ''}`}
                                                        onClick={() => {
                                                            if (selectedItems.length > 0) {
                                                                handleToggleSelect(dp.filename);
                                                            }
                                                        }}
                                                    >
                                                        <div className="item-main">
                                                            <div className="item-selection" onClick={(e) => {
                                                                e.stopPropagation();
                                                                handleToggleSelect(dp.filename);
                                                            }}>
                                                                <div className={`selection-checkbox ${isSelected ? 'checked' : ''}`}>
                                                                    {isSelected && <Check size={12} />}
                                                                </div>
                                                            </div>
                                                            <div className="mod-icon-placeholder manual">📦</div>
                                                            <div className="item-info">
                                                                <div className="item-title-row">
                                                                    <h4>{dp.filename}</h4>
                                                                </div>
                                                                <div className="item-meta-row">
                                                                    <span className="mod-provider">Manual</span>
                                                                    {dp.size > 0 && (
                                                                        <>
                                                                            <span className="mod-separator">•</span>
                                                                            <span className="mod-size">{(dp.size / 1024 / 1024).toFixed(2)} MB</span>
                                                                        </>
                                                                    )}
                                                                </div>
                                                            </div>
                                                        </div>
                                                        <div className="item-actions">
                                                            <button
                                                                className="delete-btn-simple"
                                                                title="Delete Datapack"
                                                                onClick={(e) => {
                                                                    e.stopPropagation();
                                                                    handleDelete(dp);
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
            ) : (
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
                                        placeholder="Search Modrinth for datapacks..."
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
                            {searchQuery.trim() || selectedCategories.length > 0 ? 'Search Results' : 'Popular Datapacks'}
                        </h3>

                        {(searching || loadingPopular) ? (
                            <div className="loading-mods">Loading...</div>
                        ) : (
                            <div className="search-results">
                                {(searchQuery.trim() || selectedCategories.length > 0 ? searchResults : popularDatapacks).map((project, index, array) => {
                                    const installedItem = getInstalledItem(project);
                                    const isDownloading = installing === project.slug;

                                    return (
                                        <div
                                            key={`${project.project_id || project.slug}-${index}`}
                                            className={`search-result-card ${isDownloading ? 'mod-updating' : ''}`}
                                            ref={index === array.length - 1 ? lastElementRef : null}
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
                                                        onClick={() => handleRequestInstall({ ...project, categories: project.categories || installedItem.categories }, installedItem)}
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
                                {(searchQuery.trim() || selectedCategories.length > 0 ? searchResults : popularDatapacks).length === 0 && (
                                    <div className="empty-state">
                                        <p>
                                            {searchQuery.trim() || selectedCategories.length > 0
                                                ? `No datapacks found for "${searchQuery || (selectedCategories.length > 0 ? `${selectedCategories.length} filters applied` : '')}".`
                                                : 'No popular datapacks available for this version.'}
                                        </p>
                                    </div>
                                )}
                                {loadingMore && (
                                    <div className="loading-more">
                                        <Loader2 className="spin-icon" size={24} />
                                        <span>Loading more datapacks...</span>
                                    </div>
                                )}
                            </div>
                        )}
                    </div>
                </div>
            )}

            {deleteConfirm.show && (
                <ConfirmModal
                    isOpen={deleteConfirm.show}
                    title="Delete Datapack"
                    message={`Are you sure you want to delete "${deleteConfirm.datapack?.name || deleteConfirm.datapack?.filename}"?`}
                    confirmText="Delete"
                    cancelText="Cancel"
                    variant="danger"
                    onConfirm={confirmDelete}
                    onCancel={() => setDeleteConfirm({ show: false, datapack: null })}
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
                            <span className="selected-count">{selectedItems.length} datapacks selected</span>
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

export default WorldDatapacks;
