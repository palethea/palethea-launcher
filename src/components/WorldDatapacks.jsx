import { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import ConfirmModal from './ConfirmModal';
import ModVersionModal from './ModVersionModal';

function WorldDatapacks({ instance, world, onShowNotification, onBack }) {
    const [activeSubTab, setActiveSubTab] = useState('installed');
    const [searchQuery, setSearchQuery] = useState('');
    const [searchResults, setSearchResults] = useState([]);
    const [popularDatapacks, setPopularDatapacks] = useState([]);
    const [installedDatapacks, setInstalledDatapacks] = useState([]);
    const [searching, setSearching] = useState(false);
    const [loadingPopular, setLoadingPopular] = useState(true);
    const [installing, setInstalling] = useState(null);
    const [loading, setLoading] = useState(true);
    const [deleteConfirm, setDeleteConfirm] = useState({ show: false, datapack: null });
    const [versionModal, setVersionModal] = useState({ show: false, project: null });

    useEffect(() => {
        loadInstalledDatapacks();
        loadPopularDatapacks();
    }, [world.folder_name]);

    const loadInstalledDatapacks = async () => {
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
    };

    const loadPopularDatapacks = async () => {
        setLoadingPopular(true);
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
        } catch (error) {
            console.error('Failed to load popular datapacks:', error);
        }
        setLoadingPopular(false);
    };

    const handleSearch = async () => {
        if (!searchQuery.trim()) {
            setSearchResults([]);
            return;
        }

        setSearching(true);
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
        } catch (error) {
            console.error('Failed to search Modrinth for datapacks:', error);
        }
        setSearching(false);
    };

    const isDatapackInstalled = (project) => {
        const projectId = project.project_id || project.slug;
        return installedDatapacks.some(p => p.filename.includes(projectId) || p.name === project.title);
    };

    const handleRequestInstall = (project) => {
        setVersionModal({ show: true, project });
    };

    const handleInstall = async (project, version) => {
        setInstalling(project.slug);
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
                projectId: project.project_id || project.slug,
                versionId: version.id,
                worldName: world.folder_name
            });

            if (onShowNotification) {
                onShowNotification(`Successfully installed ${file.filename}`, 'success');
            }

            await loadInstalledDatapacks();
        } catch (error) {
            console.error('Failed to install datapack:', error);
            if (onShowNotification) {
                onShowNotification('Failed to install datapack: ' + error, 'error');
            }
        }
        setInstalling(null);
    };

    const handleDelete = (datapack) => {
        setDeleteConfirm({ show: true, datapack });
    };

    const confirmDelete = async () => {
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
    };

    const formatDownloads = (num) => {
        if (num >= 1000000) return (num / 1000000).toFixed(1) + 'M';
        if (num >= 1000) return (num / 1000).toFixed(1) + 'K';
        return num.toString();
    };

    return (
        <div className="datapacks-view">
            <div className="view-header">
                <button className="back-btn" onClick={onBack}>← Back to Worlds</button>
                <div className="header-info">
                    <h3>Datapacks for {world.name}</h3>
                </div>
            </div>

            <div className="sub-tabs-row">
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
                        <div className="installed-list">
                            {installedDatapacks.map((dp) => (
                                <div key={dp.filename} className="installed-item">
                                    <div className="item-info">
                                        <h4>{dp.name || dp.filename}</h4>
                                        <span>{dp.filename}</span>
                                    </div>
                                    <div className="item-actions">
                                        <button className="delete-btn" onClick={() => handleDelete(dp)}>
                                            Delete
                                        </button>
                                    </div>
                                </div>
                            ))}
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

                    <h3 className="section-title" style={{ marginTop: '20px', fontSize: '14px', color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                        {searchQuery.trim() ? 'Search Results' : 'Popular Datapacks'}
                    </h3>

                    <div className="search-results">
                        {(searching || loadingPopular) ? (
                            <div className="loading-mods" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '200px', width: '100%', color: 'var(--muted)' }}>
                                Loading...
                            </div>
                        ) : (searchQuery.trim() ? searchResults : popularDatapacks).length === 0 ? (
                            <div className="empty-state">
                                <p>{searchQuery.trim() ? 'No datapacks found.' : 'No popular datapacks available for this version.'}</p>
                            </div>
                        ) : (
                            (searchQuery.trim() ? searchResults : popularDatapacks).map((project) => (
                                <div key={project.slug} className="search-result-card">
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
                                        {isDatapackInstalled(project) ? (
                                            <span className="installed-badge">Installed</span>
                                        ) : (
                                            <button
                                                className="install-btn"
                                                onClick={() => handleRequestInstall(project)}
                                                disabled={installing === project.slug}
                                            >
                                                {installing === project.slug ? 'Installing...' : 'Install'}
                                            </button>
                                        )}
                                    </div>
                                </div>
                            ))
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
                    gameVersion={instance.version_id}
                    loader="datapack"
                    onClose={() => setVersionModal({ show: false, project: null })}
                    onSelect={(version) => {
                        setVersionModal({ show: false, project: null });
                        handleInstall(versionModal.project, version);
                    }}
                />
            )}
        </div>
    );
}

export default WorldDatapacks;
