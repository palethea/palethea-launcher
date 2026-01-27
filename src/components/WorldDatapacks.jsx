import { useState, useEffect, useRef, useCallback, useMemo, memo } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { Trash2, RefreshCcw, Plus, Upload, FolderOpen, Loader2 } from 'lucide-react';
import { open } from '@tauri-apps/plugin-dialog';
import ConfirmModal from './ConfirmModal';
import ModVersionModal from './ModVersionModal';

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
    const [deleteConfirm, setDeleteConfirm] = useState({ show: false, datapack: null });
    const [versionModal, setVersionModal] = useState({ show: false, project: null, updateItem: null });

    // Pagination states
    const [popularOffset, setPopularOffset] = useState(0);
    const [searchOffset, setSearchOffset] = useState(0);
    const [hasMorePopular, setHasMorePopular] = useState(true);
    const [hasMoreSearch, setHasMoreSearch] = useState(true);
    const [loadingMore, setLoadingMore] = useState(false);
    const observer = useRef();

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
        setLoadingPopular(true);
        setPopularOffset(0);
        setHasMorePopular(true);
        try {
            const results = await invoke('search_modrinth', {
                query: '',
                projectType: 'datapack',
                gameVersion: instance.version_id,
                loader: 'datapack',
                limit: 20,
                offset: 0
            });
            setPopularDatapacks(results.hits || []);
            setHasMorePopular((results.hits?.length || 0) === 20 && results.total_hits > 20);
            setPopularOffset(results.hits?.length || 0);
        } catch (error) {
            console.error('Failed to load popular datapacks:', error);
        }
        setLoadingPopular(false);
    }, [instance.version_id]);

    const loadMorePopular = useCallback(async () => {
        if (loadingMore || !hasMorePopular) return;
        setLoadingMore(true);
        try {
            const results = await invoke('search_modrinth', {
                query: '',
                projectType: 'datapack',
                gameVersion: instance.version_id,
                loader: 'datapack',
                limit: 20,
                offset: popularOffset
            });
            const newHits = results.hits || [];
            if (newHits.length > 0) {
              setPopularDatapacks(prev => [...prev, ...newHits]);
              setPopularOffset(prev => prev + newHits.length);
            }
            setHasMorePopular(newHits.length === 20 && (popularOffset + newHits.length) < results.total_hits);
        } catch (error) {
            console.error('Failed to load more popular datapacks:', error);
        }
        setLoadingMore(false);
    }, [loadingMore, hasMorePopular, instance.version_id, popularOffset]);

    const handleSearch = useCallback(async () => {
        if (!searchQuery.trim()) {
            setSearchResults([]);
            setSearchOffset(0);
            setHasMoreSearch(false);
            return;
        }

        setSearching(true);
        setSearchOffset(0);
        setHasMoreSearch(true);
        try {
            // Modrinth uses 'project_type:datapack'
            const results = await invoke('search_modrinth', {
                query: searchQuery,
                projectType: 'datapack',
                gameVersion: instance.version_id,
                loader: 'datapack',
                limit: 20,
                offset: 0
            });
            setSearchResults(results.hits || []);
            setHasMoreSearch((results.hits?.length || 0) === 20 && results.total_hits > 20);
            setSearchOffset(results.hits?.length || 0);
        } catch (error) {
            console.error('Failed to search Modrinth for datapacks:', error);
        }
        setSearching(false);
    }, [searchQuery, instance.version_id]);

    const loadMoreSearch = useCallback(async () => {
        if (loadingMore || !hasMoreSearch) return;
        setLoadingMore(true);
        try {
            const results = await invoke('search_modrinth', {
                query: searchQuery,
                projectType: 'datapack',
                gameVersion: instance.version_id,
                loader: 'datapack',
                limit: 20,
                offset: searchOffset
            });
            const newHits = results.hits || [];
            if (newHits.length > 0) {
              setSearchResults(prev => [...prev, ...newHits]);
              setSearchOffset(prev => prev + newHits.length);
            }
            setHasMoreSearch(newHits.length === 20 && (searchOffset + newHits.length) < results.total_hits);
        } catch (error) {
            console.error('Failed to load more results:', error);
        }
        setLoadingMore(false);
    }, [loadingMore, hasMoreSearch, searchQuery, instance.version_id, searchOffset]);

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
        loadInstalledDatapacks();
        loadPopularDatapacks();
    }, [world.folder_name]);

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
                versionName: version.version_number
            });

            // If updating, delete the old file
            if (updateItem && updateItem.filename !== file.filename) {
                if (import.meta.env.DEV) {
                    invoke('log_event', { level: 'info', message: `Deleting old datapack: ${updateItem.filename}` }).catch(() => {});
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

            {activeSubTab === 'installed' ? (
                <div className="installed-section">
                    {loading ? (
                        <p>Loading...</p>
                    ) : installedDatapacks.length === 0 ? (
                        <div className="empty-state">
                            <p>No datapacks installed for this world.</p>
                        </div>
                    ) : (
                        <div className="mods-container">
                            {installedDatapacks.filter(p => p.provider === 'Modrinth').length > 0 && (
                                <div className="mod-group">
                                    <h3 className="group-title">Modrinth</h3>
                                    <div className="installed-list">
                                        {installedDatapacks.filter(p => p.provider === 'Modrinth').sort((a, b) => (a.name || a.filename).localeCompare(b.name || b.filename)).map((dp) => {
                                            const isUpdating = updatingItems.includes(dp.filename);
                                            return (
                                                <div key={dp.filename} className={`installed-item ${isUpdating ? 'mod-updating' : ''}`}>
                                                    {isUpdating && (
                                                        <div className="mod-updating-overlay">
                                                            <RefreshCcw className="spin-icon" size={20} />
                                                            <span>Updating...</span>
                                                        </div>
                                                    )}
                                                    <div className="item-main">
                                                        {dp.icon_url ? (
                                                            <img src={dp.icon_url} alt={dp.name} className="mod-icon-small" onError={(e) => e.target.src = 'https://cdn-icons-png.flaticon.com/512/3011/3011270.png'} />
                                                        ) : (
                                                            <div className="mod-icon-placeholder">📦</div>
                                                        )}
                                                        <div className="item-info clickable" onClick={() => handleRequestInstall({ project_id: dp.project_id, title: dp.name, slug: dp.project_id, icon_url: dp.icon_url, project_type: 'datapack' }, dp)}>
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
                                                                onClick={() => handleRequestInstall({ project_id: dp.project_id, title: dp.name, slug: dp.project_id, icon_url: dp.icon_url, project_type: 'datapack' }, dp)}
                                                                disabled={isUpdating}
                                                            >
                                                                <RefreshCcw size={14} />
                                                            </button>
                                                        )}
                                                        <button 
                                                            className="delete-btn-simple" 
                                                            title="Delete Datapack" 
                                                            onClick={() => handleDelete(dp)}
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
                            {installedDatapacks.filter(p => p.provider !== 'Modrinth').length > 0 && (
                                <div className="mod-group">
                                    <h3 className="group-title">Manual</h3>
                                    <div className="installed-list">
                                        {installedDatapacks.filter(p => p.provider !== 'Modrinth').sort((a, b) => (a.name || a.filename).localeCompare(b.name || b.filename)).map((dp) => (
                                            <div key={dp.filename} className="installed-item">
                                                <div className="item-main">
                                                    <div className="mod-icon-placeholder">📦</div>
                                                    <div className="item-info">
                                                        <div className="item-title-row">
                                                            <h4>{dp.filename.endsWith('.zip') ? dp.filename : `${dp.filename}.zip`}</h4>
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
                                                    <button className="delete-btn-simple" title="Delete Datapack" onClick={() => handleDelete(dp)}>
                                                        <Trash2 size={16} />
                                                    </button>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}
                        </div>
                    )}
                </div>
            ) : (
                <div className="find-mods-section">
                    <div className="search-input-wrapper">
                        <input
                            type="text"
                            placeholder="Search Modrinth for datapacks..."
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

                    <h3 className="section-title">
                        {searchQuery.trim() ? 'Search Results' : 'Popular Datapacks'}
                    </h3>

                    {(searching || loadingPopular) ? (
                        <div className="loading-mods">Loading...</div>
                    ) : (
                        <div className="search-results">
                            {(searchQuery.trim() ? searchResults : popularDatapacks).map((project, index, array) => {
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
                            {(searchQuery.trim() ? searchResults : popularDatapacks).length === 0 && (
                                <div className="empty-state">
                                    <p>{searchQuery.trim() ? 'No datapacks found.' : 'No popular datapacks available for this version.'}</p>
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
        </div>
    );
}

export default WorldDatapacks;
