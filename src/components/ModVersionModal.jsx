import { useState, useEffect, useCallback, memo, useMemo } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { save } from '@tauri-apps/plugin-dialog';
import { Download, User, Info, Image as ImageIcon, List, ExternalLink, X, Copy, Save, Trash2, Box } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeRaw from 'rehype-raw';
import './ModVersionModal.css';

// Get high-resolution URL - prefer raw_url from API, fallback to removing size suffix
const getFullSizeUrl = (img) => {
    // If we have raw_url from the API, use it (this is the original upload)
    if (img.raw_url) {
        return img.raw_url;
    }
    // Fallback: remove the size suffix (e.g., _350) from the URL
    const url = img.url || img;
    if (!url) return '';
    const clean = url.split('?')[0];
    // Remove size suffix like _350, _512, etc.
    return clean.replace(/_\d+\.(webp|png|jpg|jpeg|gif)$/i, '.$1');
};

const LOADER_CATEGORIES = ['fabric', 'forge', 'neoforge', 'quilt', 'bukkit', 'folia', 'paper', 'spigot', 'sponge', 'bungeecord', 'velocity', 'waterfall', 'purpur', 'rift', 'liteloader', 'modloader', 'risugamis-modloader'];

const formatCategory = (cat) => {
    if (!cat) return '';
    // Handle common abbreviations or special cases from Modrinth slugs to human labels
    const specialCases = {
        'worldgen': 'World Generation',
        'vanilla-like': 'Vanilla-like',
        'core-shaders': 'Core Shaders',
        'game-mechanics': 'Game Mechanics',
    };
    if (specialCases[cat.toLowerCase()]) return specialCases[cat.toLowerCase()];

    return cat.split(/[_-]/)
        .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
        .join(' ');
};

const filterContentCategories = (categories) => {
    if (!categories) return [];
    return categories.filter(cat => !LOADER_CATEGORIES.includes(cat.toLowerCase()));
};

function ModVersionModal({ project: initialProject, projectId, gameVersion, loader, onSelect, onClose, installedMod, onUninstall }) {
    const [project, setProject] = useState(initialProject);
    const [versions, setVersions] = useState([]);
    const [dependencies, setDependencies] = useState([]);
    const [loading, setLoading] = useState(true);
    const [loadingDeps, setLoadingDeps] = useState(false);
    const [error, setError] = useState(null);
    const [activeTab, setActiveTab] = useState('description');
    const [showAllCompatibility, setShowAllCompatibility] = useState(false);
    const [selectedGalleryImage, setSelectedGalleryImage] = useState(null);
    const [galleryContextMenu, setGalleryContextMenu] = useState(null);
    const [copying, setCopying] = useState(false);

    useEffect(() => {
        const handleClick = () => {
            setGalleryContextMenu(null);
        };
        window.addEventListener('click', handleClick);
        return () => window.removeEventListener('click', handleClick);
    }, []);

    const loadData = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const targetId = projectId || initialProject?.project_id || initialProject?.slug;

            // Always fetch full project info to get body and gallery
            const fullProject = await invoke('get_modrinth_project', { projectId: targetId });
            
            setProject(prev => {
                // Modrinth /project/{id} API doesn't return author, so it will be empty in fullProject.
                // We want to preserve the author from our initial search hit if possible.
                // We check if the existing author is better than what we just got.
                const currentAuthor = prev?.author || initialProject?.author;
                const newAuthor = (fullProject.author && fullProject.author !== "" && fullProject.author !== "Unknown" && fullProject.author !== "Unknown Creator")
                    ? fullProject.author 
                    : (currentAuthor && currentAuthor !== "Unknown Creator" ? currentAuthor : "Unknown Creator");
                
                // Preserve the full categories array from the search result (which includes all categories)
                // The full project API sometimes only returns display_categories
                const allCategories = prev?.categories || initialProject?.categories || fullProject.categories || [];
                
                return {
                    ...initialProject,
                    ...prev,
                    ...fullProject,
                    author: newAuthor,
                    categories: allCategories.length > 0 ? allCategories : (fullProject.categories || [])
                };
            });

            // Don't filter by loader for resource packs, shaders, or datapacks
            let loaderFilter = loader?.toLowerCase() || null;
            const projectType = (fullProject.project_type || '').toLowerCase();
            if (projectType === 'resourcepack' || projectType === 'shader' || projectType === 'datapack') {
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

            // Fetch dependencies for the latest version if they exist
            if (sortedResults.length > 0) {
                const latestVersion = sortedResults[0];
                if (latestVersion.dependencies && latestVersion.dependencies.length > 0) {
                    setLoadingDeps(true);
                    try {
                        const projectIds = latestVersion.dependencies
                            .map(d => d.project_id)
                            .filter(Boolean);
                        
                        if (projectIds.length > 0) {
                            const depProjects = await invoke('get_modrinth_projects', { projectIds });
                            // Merge dependency type info from version into project info
                            const enrichedDeps = depProjects.map(p => {
                                const depInfo = latestVersion.dependencies.find(d => d.project_id === (p.project_id || p.id));
                                return { ...p, dependency_type: depInfo?.dependency_type };
                            });
                            setDependencies(enrichedDeps);
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
        } catch (err) {
            console.error('Failed to load mod data:', err);
            setError('Failed to fetch project data');
        }
        setLoading(false);
    }, [projectId, initialProject, gameVersion, loader]);

    useEffect(() => {
        loadData();
    }, [loadData]);

    const formatDate = useCallback((dateStr) => {
        const date = new Date(dateStr);
        return date.toLocaleDateString(undefined, {
            year: 'numeric',
            month: 'short',
            day: 'numeric'
        });
    }, []);

    const handleCopyImage = useCallback(async (galleryImg) => {
        setCopying(true);
        try {
            const fullUrl = getFullSizeUrl(galleryImg);
            
            let response = await fetch(fullUrl, { referrerPolicy: 'no-referrer' });
            
            const blob = await response.blob();
            
            if (window.ClipboardItem) {
                const item = new ClipboardItem({ [blob.type]: blob });
                await navigator.clipboard.write([item]);
                if (import.meta.env.DEV) {
                    invoke('log_event', { level: 'info', message: 'High-res image copied to clipboard' }).catch(() => {});
                }
            } else {
                throw new Error('ClipboardItem not supported');
            }
        } catch (err) {
            console.error('Failed to copy image:', err);
        } finally {
            setCopying(false);
            setGalleryContextMenu(null);
        }
    }, []);

    const handleSaveImage = useCallback(async (galleryImg) => {
        try {
            const fullUrl = getFullSizeUrl(galleryImg);

            const url = new URL(fullUrl);
            const originalFilename = url.pathname.split('/').pop() || 'image.png';
            
            const filePath = await save({
                defaultPath: originalFilename,
                filters: [{
                    name: 'Image',
                    extensions: ['png', 'jpg', 'jpeg', 'webp']
                }]
            });

            if (filePath) {
                await invoke('save_remote_file', { url: fullUrl, path: filePath });
                if (import.meta.env.DEV) {
                    invoke('log_event', { level: 'info', message: `Image saved to ${filePath}` }).catch(() => {});
                }
            }
        } catch (err) {
            if (import.meta.env.DEV) {
                invoke('log_event', { level: 'error', message: `Failed to save image: ${err}` }).catch(() => {});
            }
        } finally {
            setGalleryContextMenu(null);
        }
    }, []);

    const formatNumber = useCallback((num) => {
        if (num >= 1000000) return (num / 1000000).toFixed(1) + 'M';
        if (num >= 1000) return (num / 1000).toFixed(1) + 'K';
        return num.toString();
    }, []);

    const handleOpenModrinth = useCallback(() => {
        const type = project?.project_type || 'mod';
        const slug = project?.slug || project?.project_id || projectId;
        if (slug) {
            invoke('open_url', { url: `https://modrinth.com/${type}/${slug}` });
        }
    }, [project, projectId]);

    const renderTabContent = useCallback(() => {
        if (loading) {
            return (
                <div className="loading-state">
                    <div className="spinner"></div>
                    <span>Loading details...</span>
                </div>
            );
        }

        switch (activeTab) {
            case 'description':
                return (
                    <div className="tab-pane description-content">
                        {project?.body ? (
                            <ReactMarkdown 
                                remarkPlugins={[remarkGfm]}
                                rehypePlugins={[rehypeRaw]}
                                components={{
                                    a: ({ node, ...props }) => <a {...props} target="_blank" rel="noopener noreferrer" />,
                                    img: ({ node, ...props }) => <img {...props} referrerPolicy="no-referrer" style={{ maxWidth: '100%', height: 'auto', borderRadius: '8px' }} />,
                                    // Handle non-standard tags found in Modrinth descriptions to avoid React warnings
                                    version: ({ node, ...props }) => <span {...props} />,
                                    minecraft: ({ node, ...props }) => <span {...props} />,
                                    center: ({ node, ...props }) => <div style={{ textAlign: 'center' }} {...props} />,
                                    important: ({ node, ...props }) => <span {...props} />
                                }}
                            >
                                {project.body}
                            </ReactMarkdown>
                        ) : (
                            <div className="empty-state">No description provided.</div>
                        )}
                    </div>
                );
            case 'gallery':
                return (
                    <div className="tab-pane gallery-pane">
                        {project?.gallery && project.gallery.length > 0 ? (
                            <div className="gallery-grid">
                                {project.gallery.map((img, idx) => (
                                    <div 
                                        key={idx} 
                                        className="gallery-item"
                                        onClick={() => setSelectedGalleryImage(img)}
                                        onContextMenu={(e) => {
                                            e.preventDefault();
                                            setGalleryContextMenu({
                                                x: e.clientX,
                                                y: e.clientY,
                                                url: img.url
                                            });
                                        }}
                                    >
                                        <div className="gallery-image-container">
                                            <img src={img.url} alt={img.title || ''} referrerPolicy="no-referrer" />
                                            <div className="gallery-item-overlay">
                                                <ImageIcon size={24} />
                                            </div>
                                        </div>
                                        {img.title && <div className="gallery-caption">{img.title}</div>}
                                    </div>
                                ))}
                            </div>
                        ) : (
                            <div className="empty-state">No gallery images available.</div>
                        )}
                    </div>
                );
            case 'dependencies':
                return (
                    <div className="tab-pane dependencies-pane">
                        {loadingDeps ? (
                            <div className="loading-state">
                                <div className="spinner"></div>
                                <span>Loading dependencies...</span>
                            </div>
                        ) : dependencies.length > 0 ? (
                            <div className="dependencies-list">
                                {dependencies.map((dep) => (
                                    <div 
                                        key={dep.project_id || dep.id} 
                                        className="dependency-card"
                                        onClick={() => {
                                            // Handle clicking a dependency - maybe switch to that mod view?
                                            // For now we'll just show info
                                        }}
                                    >
                                        <div className="dep-icon">
                                            {dep.icon_url ? (
                                                <img src={dep.icon_url} alt="" referrerPolicy="no-referrer" />
                                            ) : (
                                                <div className="dep-icon-placeholder">📦</div>
                                            )}
                                        </div>
                                        <div className="dep-info">
                                            <div className="dep-title-row">
                                                <h4>{dep.title}</h4>
                                                <span className={`dep-type-tag ${dep.dependency_type}`}>
                                                    {dep.dependency_type || 'required'}
                                                </span>
                                            </div>
                                            <p className="dep-description">{dep.description}</p>
                                            <div className="dep-meta">
                                                <span>by {dep.author || 'Unknown'}</span>
                                                <span className="dot">•</span>
                                                <span>{formatNumber(dep.downloads || 0)} downloads</span>
                                            </div>
                                        </div>
                                        <ExternalLink 
                                            size={16} 
                                            className="dep-external" 
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                const type = dep.project_type || 'mod';
                                                const slug = dep.slug || dep.project_id || dep.id;
                                                invoke('open_url', { url: `https://modrinth.com/${type}/${slug}` });
                                            }}
                                        />
                                    </div>
                                ))}
                            </div>
                        ) : (
                            <div className="empty-state">No dependencies listed for the latest version.</div>
                        )}
                    </div>
                );
            default:
                return null;
        }
    }, [loading, loadingDeps, activeTab, project, dependencies, formatNumber]);

    const compatibilityInfo = useMemo(() => {
        if (!project?.game_versions) return null;
        const versionsList = [...project.game_versions].reverse();
        const displayVersions = showAllCompatibility ? versionsList : versionsList.slice(0, 5);
        const hasMore = versionsList.length > 5;
        
        return {
            displayVersions,
            hasMore,
            moreCount: versionsList.length - 5
        };
    }, [project?.game_versions, showAllCompatibility]);

    return (
        <div className="version-modal-overlay" onClick={onClose}>
            <div className="version-modal rich-modal" onClick={(e) => e.stopPropagation()}>
                <div className="version-modal-header">
                    <div className="header-info">
                        {project?.icon_url ? (
                            <img src={project.icon_url} alt="" className="project-icon-large" referrerPolicy="no-referrer" />
                        ) : (
                            <div className="project-icon-large project-icon-placeholder">📦</div>
                        )}
                        <div className="header-text">
                            <h3>{project?.title || 'Loading...'}</h3>
                            <div className="header-meta-row">
                                <span className="header-author">by {project?.author || initialProject?.author || 'Unknown Creator'}</span>
                                <span className="header-separator">•</span>
                                <span className="header-downloads">{formatNumber(project?.downloads || 0)} downloads</span>
                            </div>
                            {project?.description && <p className="header-description">{project.description}</p>}
                        </div>
                    </div>
                    <button className="close-btn" onClick={onClose}>&times;</button>
                </div>

                <div className="rich-modal-content">
                    <div className="rich-modal-sidebar">
                        {installedMod && (
                            <div className="sidebar-section">
                                <label>Status</label>
                                <div className="sidebar-status-box">
                                    <div className="status-header">
                                        <div className="status-indicator"></div>
                                        <span>Installed</span>
                                    </div>
                                    <div className="status-version-link" onClick={() => {
                                        // Scroll to version in list if possible, or just show it
                                    }}>
                                        {installedMod.version || installedMod.versionName || installedMod.version_name || 'Unknown version'}
                                    </div>
                                    {installedMod.filename && (
                                        <div className="status-filename">{installedMod.filename}</div>
                                    )}
                                </div>
                            </div>
                        )}

                        <div className="sidebar-section">
                            <label>Details</label>
                            <div className="sidebar-stats">
                                <div className="stat-item" title="Project Author">
                                    <User size={14} />
                                    <span>{project?.author || initialProject?.author || 'Unknown Creator'}</span>
                                </div>
                                <div className="stat-item" title="Total Downloads">
                                    <Download size={14} />
                                    <span>{formatNumber(project?.downloads || 0)} downloads</span>
                                </div>
                                <div className="stat-item" title="Project ID">
                                    <Info size={14} />
                                    <span className="monospace">{project?.project_id || projectId}</span>
                                </div>
                            </div>
                        </div>

                        {project?.loaders && project.loaders.length > 0 && (
                            <div className="sidebar-section">
                                <label>Platforms</label>
                                <div className="platform-tags">
                                    {project.loaders.map(loader => (
                                        <span key={loader} className={`platform-tag loader-${loader.toLowerCase()}`}>
                                            {loader.charAt(0).toUpperCase() + loader.slice(1)}
                                        </span>
                                    ))}
                                </div>
                            </div>
                        )}

                        {project?.game_versions && project.game_versions.length > 0 && (
                            <div className="sidebar-section">
                                <label>Compatibility</label>
                                <div className="compatibility-info">
                                    <span className="compatibility-sublabel">Minecraft: Java Edition</span>
                                    <div className="compatibility-tags">
                                        {compatibilityInfo?.displayVersions.map(v => (
                                            <span key={v} className="compatibility-tag">{v}</span>
                                        ))}
                                        {!showAllCompatibility && compatibilityInfo?.hasMore && (
                                            <span 
                                                className="compatibility-tag more clickable"
                                                onClick={() => setShowAllCompatibility(true)}
                                            >
                                                +{compatibilityInfo.moreCount} more
                                            </span>
                                        )}
                                        {showAllCompatibility && (
                                            <span 
                                                className="compatibility-tag more clickable"
                                                onClick={() => setShowAllCompatibility(false)}
                                            >
                                                show less
                                            </span>
                                        )}
                                    </div>
                                </div>
                            </div>
                        )}

                        {project?.categories && project.categories.length > 0 && (
                            <div className="sidebar-section">
                                <label>Categories</label>
                                <div className="category-tags">
                                    {filterContentCategories(project.categories).map(cat => (
                                        <span key={cat} className="category-tag">{formatCategory(cat)}</span>
                                    ))}
                                </div>
                            </div>
                        )}
                    </div>

                    <div className="rich-modal-main">
                        <div className="modal-tabs">
                            <button 
                                className={`modal-tab ${activeTab === 'description' ? 'active' : ''}`}
                                onClick={() => setActiveTab('description')}
                            >
                                <Info size={16} />
                                Description
                            </button>
                            <button 
                                className={`modal-tab ${activeTab === 'gallery' ? 'active' : ''}`}
                                onClick={() => setActiveTab('gallery')}
                            >
                                <ImageIcon size={16} />
                                Gallery
                            </button>
                            <button 
                                className={`modal-tab ${activeTab === 'dependencies' ? 'active' : ''}`}
                                onClick={() => setActiveTab('dependencies')}
                            >
                                <Box size={16} />
                                Dependencies
                                {dependencies.length > 0 && <span className="tab-count">{dependencies.length}</span>}
                            </button>
                        </div>

                        <div className="modal-tab-content">
                            {error ? <div className="error-state">{error}</div> : renderTabContent()}
                        </div>
                    </div>

                    <div className="rich-modal-versions">
                        <div className="versions-header">
                            <label>Compatible Versions</label>
                            <span className="version-info-tag">{gameVersion}</span>
                        </div>
                        <div className="versions-scroll">
                            {loading ? (
                                <div className="versions-loading">
                                    <div className="spinner small"></div>
                                </div>
                            ) : versions.length === 0 ? (
                                <div className="empty-state mini">No versions found</div>
                            ) : (
                                <div className="versions-small-list">
                                    {versions.map((v) => {
                                        const isInstalled = installedMod?.version_id === v.id;
                                        return (
                                            <div 
                                                key={v.id} 
                                                className={`version-mini-item ${isInstalled ? 'installed' : ''}`} 
                                                onClick={() => onSelect(v)}
                                            >
                                                <div className="mini-item-top">
                                                    <span className="mini-name" title={v.name}>{v.name}</span>
                                                    <div className="mini-item-tags">
                                                        {isInstalled && <span className="installed-label">INSTALLED</span>}
                                                        <span className={`version-tag-mini ${v.version_type}`}></span>
                                                    </div>
                                                </div>
                                                <div className="mini-item-bottom">
                                                    <span className="mini-number">{v.version_number}</span>
                                                    <span className="mini-date">{formatDate(v.date_published)}</span>
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            )}
                        </div>
                    </div>
                </div>

                <div className="version-modal-footer">
                    <button 
                        className="modrinth-link-btn"
                        onClick={handleOpenModrinth}
                    >
                        <ExternalLink size={14} />
                        <span>View on Modrinth</span>
                    </button>
                    {installedMod && (
                        <button 
                            className="uninstall-btn"
                            onClick={() => onUninstall(installedMod)}
                        >
                            <Trash2 size={14} />
                            <span>Uninstall</span>
                        </button>
                    )}
                    <button className="btn-secondary" onClick={onClose}>Cancel</button>
                </div>
            </div>

            {selectedGalleryImage && (
                <div className="gallery-modal-overlay" onClick={(e) => {
                    e.stopPropagation();
                    setSelectedGalleryImage(null);
                }}>
                    <div className="gallery-modal-content" onClick={e => e.stopPropagation()}>
                        {selectedGalleryImage.title && (
                            <div className="gallery-modal-caption">
                                <h3>{selectedGalleryImage.title}</h3>
                            </div>
                        )}
                        <div className="gallery-modal-image-wrapper">
                            <img src={getFullSizeUrl(selectedGalleryImage)} alt={selectedGalleryImage.title || ''} referrerPolicy="no-referrer" />
                            <button className="gallery-modal-close" onClick={() => setSelectedGalleryImage(null)}>
                                <X size={20} />
                            </button>
                        </div>
                        <div className="gallery-modal-actions">
                            <button onClick={() => handleCopyImage(selectedGalleryImage)}>
                                <Copy size={18} />
                                Copy
                            </button>
                            <button onClick={() => handleSaveImage(selectedGalleryImage)}>
                                <Save size={18} />
                                Save
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {galleryContextMenu && (
                <div 
                    className="gallery-context-menu"
                    style={{ 
                        left: Math.min(galleryContextMenu.x, window.innerWidth - 160), 
                        top: Math.min(galleryContextMenu.y, window.innerHeight - 100) 
                    }}
                    onClick={e => e.stopPropagation()}
                >
                    <button onClick={() => {
                        const img = project.gallery.find(g => g.url === galleryContextMenu.url);
                        setSelectedGalleryImage(img);
                        setGalleryContextMenu(null);
                    }}>
                        <ImageIcon size={14} />
                        View Large
                    </button>
                    <button onClick={() => {
                        const img = project.gallery.find(g => g.url === galleryContextMenu.url);
                        handleCopyImage(img);
                    }}>
                        <Copy size={14} />
                        Copy Image
                    </button>
                    <button onClick={() => {
                        const img = project.gallery.find(g => g.url === galleryContextMenu.url);
                        handleSaveImage(img);
                    }}>
                        <Save size={14} />
                        Save Image As...
                    </button>
                </div>
            )}
        </div>
    );
}

export default memo(ModVersionModal);

