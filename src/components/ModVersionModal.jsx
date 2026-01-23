import { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import './ModVersionModal.css';

function ModVersionModal({ project: initialProject, projectId, gameVersion, loader, onSelect, onClose }) {
    const [project, setProject] = useState(initialProject);
    const [versions, setVersions] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);

    useEffect(() => {
        loadData();
    }, [projectId, initialProject?.slug, gameVersion, loader]);

    const loadData = async () => {
        setLoading(true);
        setError(null);
        try {
            let currentProject = project;
            const targetId = projectId || initialProject?.slug;

            if (!currentProject || !currentProject.title) {
                // Fetch project info if we only have ID
                currentProject = await invoke('get_modrinth_project', { projectId: targetId });
                setProject(currentProject);
            }

            // Don't filter by loader for resource packs, shaders, or datapacks
            let loaderFilter = loader?.toLowerCase() || null;
            if (loaderFilter === 'resourcepack' || loaderFilter === 'shader' || loaderFilter === 'datapack') {
                loaderFilter = null;
            }

            const results = await invoke('get_modrinth_versions', {
                projectId: targetId,
                gameVersion: gameVersion,
                loader: loaderFilter
            });
            // Sort: release > beta > alpha, then by date desc
            const sortedResults = results.sort((a, b) => {
                const typeOrder = { release: 0, beta: 1, alpha: 2 };
                if (typeOrder[a.version_type] !== typeOrder[b.version_type]) {
                    return typeOrder[a.version_type] - typeOrder[b.version_type];
                }
                return new Date(b.date_published) - new Date(a.date_published);
            });
            setVersions(sortedResults);
        } catch (err) {
            console.error('Failed to load mod data:', err);
            setError('Failed to fetch version data');
        }
        setLoading(false);
    };

    const formatDate = (dateStr) => {
        const date = new Date(dateStr);
        return date.toLocaleDateString(undefined, {
            year: 'numeric',
            month: 'short',
            day: 'numeric'
        });
    };

    return (
        <div className="version-modal-overlay" onClick={onClose}>
            <div className="version-modal" onClick={(e) => e.stopPropagation()}>
                <div className="version-modal-header">
                    <div className="header-info">
                        {project?.icon_url ? (
                            <img src={project.icon_url} alt="" className="project-icon-mini" />
                        ) : (
                            <div className="project-icon-mini project-icon-placeholder">📦</div>
                        )}
                        <div>
                            <h3>Select Version</h3>
                            <p>{project?.title || 'Loading mod information...'}</p>
                        </div>
                    </div>
                    <button className="close-btn" onClick={onClose}>&times;</button>
                </div>

                <div className="version-modal-body">
                    {loading ? (
                        <div className="loading-state">
                            <div className="spinner"></div>
                            <span>Fetching versions...</span>
                        </div>
                    ) : error ? (
                        <div className="error-state">{error}</div>
                    ) : versions.length === 0 ? (
                        <div className="empty-state">No compatible versions found for {gameVersion}</div>
                    ) : (
                        <div className="versions-list">
                            {versions.map((v) => (
                                <div key={v.id} className="version-item" onClick={() => onSelect(v)}>
                                    <div className="version-main">
                                        <span className="version-name">{v.name}</span>
                                        <span className="version-number">{v.version_number}</span>
                                    </div>
                                    <div className="version-meta">
                                        <span className={`version-tag ${v.version_type}`}>
                                            {v.version_type}
                                        </span>
                                        <span className="version-date">{formatDate(v.date_published)}</span>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>

                <div className="version-modal-footer">
                    <button className="btn-secondary" onClick={onClose}>Cancel</button>
                </div>
            </div>
        </div>
    );
}

export default ModVersionModal;
