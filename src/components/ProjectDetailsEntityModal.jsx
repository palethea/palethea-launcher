import { useEffect, useMemo, useState } from 'react';
import { Download, User, Info, Image as ImageIcon, ExternalLink, Play, X, Copy, Save, Box } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeRaw from 'rehype-raw';
import {
  renderMarkdownIframe,
  renderMarkdownSource,
  renderMarkdownVideo
} from '../utils/markdownEmbeds';
import ProjectDetailsModal from './ProjectDetailsModal';

const formatNumber = (num) => {
  const value = Number(num || 0);
  if (value >= 1000000) return `${(value / 1000000).toFixed(1)}M`;
  if (value >= 1000) return `${(value / 1000).toFixed(1)}K`;
  return `${Math.max(0, Math.floor(value))}`;
};

const formatCategory = (value) => {
  const input = String(value || '').trim();
  if (!input) return '';
  return input
    .split(/[_-]/)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(' ');
};

function ProjectDetailsEntityModal({
  onClose,
  loading = false,
  error = null,
  header = {},
  platformLabel = '',
  details = {},
  loaders = [],
  compatibilityVersions = [],
  categories = [],
  mapCategoryLabel,
  descriptionMarkdown = '',
  descriptionEmptyText = 'No description provided.',
  galleryItems = [],
  galleryEmptyText = 'No gallery media available.',
  galleryNotice = null,
  dependencies = [],
  dependenciesLoading = false,
  dependenciesEmptyText = 'No dependencies listed.',
  showDependenciesTab = false,
  onOpenDependencyExternal,
  versionsLabel = '',
  versionsTag = '',
  versionsContent = null,
  footerContent = null,
  galleryActions = null
}) {
  const [activeTab, setActiveTab] = useState('description');
  const [showAllCompatibility, setShowAllCompatibility] = useState(false);
  const [selectedGalleryMedia, setSelectedGalleryMedia] = useState(null);
  const [galleryContextMenu, setGalleryContextMenu] = useState(null);
  const showSkeleton = loading && !error;

  const hasDependenciesTab = showDependenciesTab || dependenciesLoading || dependencies.length > 0;

  useEffect(() => {
    if (activeTab === 'dependencies' && !hasDependenciesTab) {
      setActiveTab('description');
    }
  }, [activeTab, hasDependenciesTab]);

  useEffect(() => {
    if (!galleryContextMenu) return undefined;
    const handleClick = () => setGalleryContextMenu(null);
    window.addEventListener('click', handleClick);
    return () => window.removeEventListener('click', handleClick);
  }, [galleryContextMenu]);

  const compatibilityInfo = useMemo(() => {
    const list = Array.from(new Set((compatibilityVersions || []).filter(Boolean)));
    const displayVersions = showAllCompatibility ? list : list.slice(0, 5);
    return {
      displayVersions,
      hasMore: list.length > 5,
      moreCount: Math.max(0, list.length - 5)
    };
  }, [compatibilityVersions, showAllCompatibility]);

  const resolvedCategories = useMemo(() => {
    return (categories || [])
      .filter(Boolean)
      .map((category) => (typeof mapCategoryLabel === 'function' ? mapCategoryLabel(category) : formatCategory(category)))
      .filter(Boolean);
  }, [categories, mapCategoryLabel]);

  const tabs = [
    { id: 'description', label: 'Description', icon: <Info size={16} /> },
    { id: 'gallery', label: 'Gallery', icon: <ImageIcon size={16} /> }
  ];
  if (hasDependenciesTab) {
    tabs.push({ id: 'dependencies', label: 'Dependencies', icon: <Box size={16} />, count: dependencies.length });
  }

  const sidebarSections = [
    platformLabel ? {
      key: 'platform',
      label: 'Platform',
      content: (
        <div className="sidebar-status-box">
          <div className="platform-value">{platformLabel}</div>
        </div>
      )
    } : null,
    {
      key: 'details',
      label: 'Details',
      content: (
        <div className="sidebar-stats">
          <div className="stat-item">
            <User size={14} />
            {showSkeleton ? (
              <span className="skeleton-line skeleton-text-sm"></span>
            ) : (
              <span>{details.author || 'Unknown creator'}</span>
            )}
          </div>
          <div className="stat-item">
            <Download size={14} />
            {showSkeleton ? (
              <span className="skeleton-line skeleton-text-sm"></span>
            ) : (
              <span>{details.downloadsText || `${formatNumber(details.downloads || 0)} downloads`}</span>
            )}
          </div>
          <div className="stat-item">
            <Info size={14} />
            {showSkeleton ? (
              <span className="skeleton-line skeleton-text-xs"></span>
            ) : (
              <span className="monospace">{details.projectId || 'unknown'}</span>
            )}
          </div>
        </div>
      )
    },
    loaders.length > 0 ? {
      key: 'loaders',
      label: 'Loaders',
      content: (
        <div className="platform-tags">
          {loaders.map((loader) => (
            <span key={loader} className={`platform-tag loader-${String(loader).toLowerCase()}`}>
              {String(loader).charAt(0).toUpperCase() + String(loader).slice(1)}
            </span>
          ))}
        </div>
      )
    } : null,
    compatibilityInfo.displayVersions.length > 0 ? {
      key: 'compatibility',
      label: 'Compatibility',
      content: (
        <div className="compatibility-info">
          <span className="compatibility-sublabel">Minecraft: Java Edition</span>
          <div className="compatibility-tags">
            {compatibilityInfo.displayVersions.map((version) => (
              <span key={version} className="compatibility-tag">{version}</span>
            ))}
            {!showAllCompatibility && compatibilityInfo.hasMore && (
              <span className="compatibility-tag more clickable" onClick={() => setShowAllCompatibility(true)}>
                +{compatibilityInfo.moreCount} more
              </span>
            )}
            {showAllCompatibility && compatibilityInfo.hasMore && (
              <span className="compatibility-tag more clickable" onClick={() => setShowAllCompatibility(false)}>
                show less
              </span>
            )}
          </div>
        </div>
      )
    } : null,
    resolvedCategories.length > 0 ? {
      key: 'categories',
      label: 'Categories',
      content: (
        <div className="category-tags">
          {resolvedCategories.map((category) => (
            <span key={category} className="category-tag">{category}</span>
          ))}
        </div>
      )
    } : null
  ].filter(Boolean);

  const renderDescription = () => {
    if (showSkeleton) {
      return (
        <div className="tab-pane description-content">
          <div className="skeleton-block-stack">
            <div className="skeleton-line skeleton-heading-lg"></div>
            <div className="skeleton-line skeleton-heading-md"></div>
            <div className="skeleton-line skeleton-paragraph-line"></div>
            <div className="skeleton-line skeleton-paragraph-line"></div>
            <div className="skeleton-line skeleton-paragraph-line short"></div>
            <div className="skeleton-line skeleton-paragraph-line"></div>
            <div className="skeleton-line skeleton-paragraph-line"></div>
            <div className="skeleton-line skeleton-paragraph-line short"></div>
          </div>
        </div>
      );
    }

    if (error) {
      return <div className="error-state">{error}</div>;
    }

    const content = descriptionMarkdown || descriptionEmptyText;
    return (
      <div className="tab-pane description-content">
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          rehypePlugins={[rehypeRaw]}
          components={{
            a: ({ node, ...props }) => <a {...props} target="_blank" rel="noopener noreferrer" />,
            img: ({ node, ...props }) => <img {...props} referrerPolicy="no-referrer" style={{ maxWidth: '100%', height: 'auto', borderRadius: '8px' }} />,
            iframe: ({ node, ...props }) => renderMarkdownIframe(props),
            video: ({ node, ...props }) => renderMarkdownVideo(props),
            source: ({ node, ...props }) => renderMarkdownSource(props),
            center: ({ node, ...props }) => <div style={{ textAlign: 'center' }} {...props} />,
            version: ({ node, ...props }) => <span {...props} />,
            minecraft: ({ node, ...props }) => <span {...props} />,
            important: ({ node, ...props }) => <span {...props} />
          }}
        >
          {content}
        </ReactMarkdown>
      </div>
    );
  };

  const renderGallery = () => {
    if (showSkeleton) {
      return (
        <div className="tab-pane gallery-pane">
          <div className="gallery-grid skeleton-gallery-grid">
            {Array.from({ length: 6 }).map((_, index) => (
              <div key={`gallery-skeleton-${index}`} className="gallery-item skeleton-gallery-card">
                <div className="gallery-image-container">
                  <div className="skeleton-line skeleton-gallery-image"></div>
                </div>
                <div className="gallery-caption">
                  <span className="skeleton-line skeleton-caption-line"></span>
                </div>
              </div>
            ))}
          </div>
        </div>
      );
    }

    if (error) {
      return <div className="error-state">{error}</div>;
    }

    if (!galleryItems.length) {
      return <div className="empty-state">{galleryEmptyText}</div>;
    }

    return (
      <div className="tab-pane gallery-pane">
        <div className="gallery-grid">
          {galleryItems.map((item, idx) => {
            const isVideo = item.type !== 'image';
            const previewUrl = isVideo ? (item.thumbnailUrl || header.iconUrl || '') : item.url;
            return (
              <div
                key={`${item.url || idx}-${idx}`}
                className={`gallery-item ${isVideo ? 'video' : ''}`}
                onClick={() => setSelectedGalleryMedia(item)}
                onContextMenu={(event) => {
                  if (!galleryActions?.onCopy && !galleryActions?.onSave) return;
                  if (item.type !== 'image') return;
                  event.preventDefault();
                  setGalleryContextMenu({
                    x: event.clientX,
                    y: event.clientY,
                    item
                  });
                }}
              >
                <div className="gallery-image-container">
                  {previewUrl ? (
                    <img src={previewUrl} alt={item.title || ''} referrerPolicy="no-referrer" />
                  ) : (
                    <div className="gallery-video-placeholder">
                      <Play size={28} />
                    </div>
                  )}
                  <div className="gallery-item-overlay">
                    {isVideo ? <Play size={24} /> : <ImageIcon size={24} />}
                  </div>
                </div>
                {item.title && <div className="gallery-caption">{item.title}</div>}
              </div>
            );
          })}
        </div>
        {galleryNotice && (
          <div className="curseforge-gallery-notice">
            <div className="curseforge-gallery-notice-text">{galleryNotice.text}</div>
            {galleryNotice.onClick && (
              <button
                className="curseforge-gallery-notice-btn"
                onClick={galleryNotice.onClick}
                disabled={Boolean(galleryNotice.disabled)}
              >
                {galleryNotice.buttonLabel || 'Open'}
              </button>
            )}
          </div>
        )}
      </div>
    );
  };

  const renderDependencies = () => {
    if (dependenciesLoading) {
      return (
        <div className="tab-pane dependencies-pane">
          <div className="dependencies-list">
            {Array.from({ length: 4 }).map((_, index) => (
              <div key={`dependency-skeleton-${index}`} className="dependency-card">
                <div className="dep-icon">
                  <div className="skeleton-line skeleton-icon-box"></div>
                </div>
                <div className="dep-info">
                  <div className="dep-title-row">
                    <span className="skeleton-line skeleton-text-md"></span>
                  </div>
                  <p className="dep-description">
                    <span className="skeleton-line skeleton-text-sm"></span>
                  </p>
                  <div className="dep-meta">
                    <span className="skeleton-line skeleton-text-xs"></span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      );
    }

    if (!dependencies.length) {
      return <div className="empty-state">{dependenciesEmptyText}</div>;
    }

    return (
      <div className="tab-pane dependencies-pane">
        <div className="dependencies-list">
          {dependencies.map((dependency) => (
            <div key={dependency.project_id || dependency.id} className="dependency-card">
              <div className="dep-icon">
                {dependency.icon_url ? (
                  <img src={dependency.icon_url} alt="" referrerPolicy="no-referrer" />
                ) : (
                  <div className="dep-icon-placeholder">PK</div>
                )}
              </div>
              <div className="dep-info">
                <div className="dep-title-row">
                  <h4>{dependency.title || dependency.name || 'Unknown dependency'}</h4>
                  <span className={`dep-type-tag ${dependency.dependency_type || 'required'}`}>
                    {dependency.dependency_type || 'required'}
                  </span>
                </div>
                <p className="dep-description">{dependency.description || 'No description.'}</p>
                <div className="dep-meta">
                  <span>by {dependency.author || 'Unknown'}</span>
                  <span className="dot">|</span>
                  <span>{formatNumber(dependency.downloads || 0)} downloads</span>
                </div>
              </div>
              {typeof onOpenDependencyExternal === 'function' && (
                <ExternalLink
                  size={16}
                  className="dep-external"
                  onClick={(event) => {
                    event.stopPropagation();
                    onOpenDependencyExternal(dependency);
                  }}
                />
              )}
            </div>
          ))}
        </div>
      </div>
    );
  };

  const renderMainContent = () => {
    if (activeTab === 'gallery') return renderGallery();
    if (activeTab === 'dependencies') return renderDependencies();
    return renderDescription();
  };

  const headerMetaNode = showSkeleton ? (
    <div className="header-meta-row">
      <span className="skeleton-line skeleton-meta-author"></span>
      <span className="skeleton-line skeleton-meta-downloads"></span>
    </div>
  ) : (
    <div className="header-meta-row">
      <span className="header-author">by {header.author || details.author || 'Unknown creator'}</span>
      <span className="header-separator">|</span>
      <span className="header-downloads">{header.downloadsText || details.downloadsText || `${formatNumber(details.downloads || 0)} downloads`}</span>
    </div>
  );

  const versionsContentNode = showSkeleton ? (
    <div className="versions-small-list">
      {Array.from({ length: 6 }).map((_, index) => (
        <div key={`version-skeleton-${index}`} className="version-mini-item">
          <div className="mini-item-top">
            <span className="skeleton-line skeleton-text-sm"></span>
          </div>
          <div className="mini-item-bottom">
            <span className="skeleton-line skeleton-text-xs"></span>
            <span className="skeleton-line skeleton-text-xs"></span>
          </div>
        </div>
      ))}
    </div>
  ) : versionsContent;

  return (
    <ProjectDetailsModal
      onClose={onClose}
      headerIconUrl={header.iconUrl}
      headerFallback={header.fallback || 'PK'}
      headerTitle={showSkeleton ? <span className="skeleton-line skeleton-title"></span> : (header.title || 'Loading...')}
      headerMeta={headerMetaNode}
      headerDescription={showSkeleton ? '' : header.description}
      sidebarSections={sidebarSections}
      tabs={tabs}
      activeTab={activeTab}
      onTabChange={setActiveTab}
      mainContent={renderMainContent()}
      versionsLabel={versionsLabel}
      versionsTag={versionsTag}
      versionsContent={versionsContentNode}
      footerContent={footerContent}
    >
      {selectedGalleryMedia && (
        <div className="gallery-modal-overlay" onClick={(event) => {
          event.stopPropagation();
          setSelectedGalleryMedia(null);
        }}>
          <div className="gallery-modal-content" onClick={(event) => event.stopPropagation()}>
            {selectedGalleryMedia.title && (
              <div className="gallery-modal-caption">
                <h3>{selectedGalleryMedia.title}</h3>
              </div>
            )}
            <div className="gallery-modal-image-wrapper">
              {selectedGalleryMedia.type === 'embed-video' ? (
                <div className="description-embed-frame gallery-video-frame">
                  <iframe
                    src={selectedGalleryMedia.embedUrl}
                    title={selectedGalleryMedia.title || 'Gallery video'}
                    loading="lazy"
                    referrerPolicy="no-referrer"
                    allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                    allowFullScreen
                  />
                </div>
              ) : selectedGalleryMedia.type === 'video' ? (
                <video
                  className="description-embedded-video gallery-inline-video"
                  controls
                  preload="metadata"
                  referrerPolicy="no-referrer"
                  src={selectedGalleryMedia.url}
                />
              ) : (
                <img
                  src={selectedGalleryMedia.raw_url || selectedGalleryMedia.url}
                  alt={selectedGalleryMedia.title || ''}
                  referrerPolicy="no-referrer"
                />
              )}
              <button className="gallery-modal-close" onClick={() => setSelectedGalleryMedia(null)}>
                <X size={20} />
              </button>
            </div>
            {(galleryActions?.onCopy || galleryActions?.onSave) && selectedGalleryMedia.type === 'image' && (
              <div className="gallery-modal-actions">
                {galleryActions?.onCopy && (
                  <button onClick={() => galleryActions.onCopy(selectedGalleryMedia)}>
                    <Copy size={18} />
                    Copy
                  </button>
                )}
                {galleryActions?.onSave && (
                  <button onClick={() => galleryActions.onSave(selectedGalleryMedia)}>
                    <Save size={18} />
                    Save
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      )}
      {galleryContextMenu && (galleryActions?.onCopy || galleryActions?.onSave) && (
        <div
          className="gallery-context-menu"
          style={{
            left: Math.min(galleryContextMenu.x, window.innerWidth - 160),
            top: Math.min(galleryContextMenu.y, window.innerHeight - 100)
          }}
          onClick={(event) => event.stopPropagation()}
        >
          <button onClick={() => {
            setSelectedGalleryMedia(galleryContextMenu.item);
            setGalleryContextMenu(null);
          }}>
            <ImageIcon size={14} />
            View Large
          </button>
          {galleryActions?.onCopy && (
            <button onClick={() => {
              galleryActions.onCopy(galleryContextMenu.item);
              setGalleryContextMenu(null);
            }}>
              <Copy size={14} />
              Copy Image
            </button>
          )}
          {galleryActions?.onSave && (
            <button onClick={() => {
              galleryActions.onSave(galleryContextMenu.item);
              setGalleryContextMenu(null);
            }}>
              <Save size={14} />
              Save Image As...
            </button>
          )}
        </div>
      )}
    </ProjectDetailsModal>
  );
}

export default ProjectDetailsEntityModal;
