import { useEffect, useState, useMemo, useCallback, useRef } from 'react';
import { Clock, Plus, Box, LayoutGrid, List, ChevronDown, Check } from 'lucide-react';
import { invoke, convertFileSrc } from '@tauri-apps/api/core';
import { sep } from '@tauri-apps/api/path';
import './InstanceList.css';

function InstanceList({
  instances,
  onLaunch,
  onStop,
  onDelete,
  onEdit,
  onCreate,
  onContextMenu,
  isLoading,
  launchingInstanceId = null,
  loadingStatus = '',
  loadingProgress = 0,
  loadingBytes = { current: 0, total: 0 },
  loadingCount = { current: 0, total: 0 },
  runningInstances = {},
  deletingInstanceId = null,
  openEditors = [],
  launcherSettings = null
}) {
  const [logoMap, setLogoMap] = useState({});
  const [sortBy, setSortBy] = useState(localStorage.getItem('instance_sort') || 'name');
  const [viewMode, setViewMode] = useState(localStorage.getItem('instance_view_mode') || 'list');
  const [scrolled, setScrolled] = useState(false);
  const [isSortOpen, setIsSortOpen] = useState(false);
  const sortRef = useRef(null);

  const handleScroll = useCallback((e) => {
    setScrolled(e.target.scrollTop > 20);
  }, []);

  // Close sorting dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (sortRef.current && !sortRef.current.contains(event.target)) {
        setIsSortOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const sortedInstances = useMemo(() => {
    return [...instances].sort((a, b) => {
      switch (sortBy) {
        case 'name':
          return a.name.localeCompare(b.name);
        case 'color': {
          // Sort by hex value, treating undefined as bottom
          const colorA = a.color_accent || '#zzzzzz';
          const colorB = b.color_accent || '#zzzzzz';
          return colorA.localeCompare(colorB);
        }
        case 'age': {
          // created_at is timestamp string
          const ageA = parseInt(a.created_at || '0');
          const ageB = parseInt(b.created_at || '0');
          return ageB - ageA;
        }
        case 'playtime':
          return (b.playtime_seconds || 0) - (a.playtime_seconds || 0);
        default:
          return 0;
      }
    });
  }, [instances, sortBy]);

  // Create a stable key that only changes when logos actually change
  const logoKey = useMemo(() => {
    return instances.map(i => `${i.id}:${i.logo_filename || 'default'}`).join(',');
  }, [instances]);

  const formatDate = useCallback((timestamp) => {
    if (!timestamp) return 'Never';
    const date = new Date(parseInt(timestamp) * 1000);
    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  }, []);

  const formatPlaytime = useCallback((seconds) => {
    if (!seconds || seconds === 0) return null;
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    if (hours > 0) {
      return `${hours}h ${minutes}m`;
    }
    return `${minutes}m`;
  }, []);

  const handleContainerContextMenu = useCallback((e) => {
    // Right-click on empty area
    if (e.target.classList.contains('instance-list') || e.target.classList.contains('instances-grid')) {
      e.preventDefault();
      onContextMenu(e, null);
    }
  }, [onContextMenu]);

  const handleSortChange = useCallback((e) => {
    const val = e.target.value;
    setSortBy(val);
    localStorage.setItem('instance_sort', val);
  }, []);

  const switchToListView = useCallback(() => {
    setViewMode('list');
    localStorage.setItem('instance_view_mode', 'list');
  }, []);

  const switchToGridView = useCallback(() => {
    setViewMode('grid');
    localStorage.setItem('instance_view_mode', 'grid');
  }, []);

  useEffect(() => {
    let cancelled = false;

    const loadLogos = async () => {
      try {
        if (!instances || instances.length === 0) {
          setLogoMap({});
          return;
        }
        
        // Optimize: Get base path and separator once to avoid N IPC calls
        const baseDir = await invoke('get_data_directory');
        const s = await sep();
        const logosDir = `${baseDir}${s}instance_logos`;
        
        const entries = instances.map((instance) => {
          const filename = instance.logo_filename || 'minecraft_logo.png';
          const logoPath = `${logosDir}${s}${filename}`;
          return [instance.id, convertFileSrc(logoPath)];
        });

        if (!cancelled) {
          setLogoMap(Object.fromEntries(entries));
        }
      } catch (error) {
        console.error('Failed to load instance logos:', error);
      }
    };

    loadLogos();

    return () => {
      cancelled = true;
    };
    // logoKey captures only id+logo_filename changes, so we don't reload on every instance update
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [logoKey]);

  return (
    <div className="instance-list" onScroll={handleScroll} onContextMenu={handleContainerContextMenu}>
      {instances.length > 0 && (
        <>
          <div className="page-header" style={{ marginTop: '20px', marginBottom: '0' }}>
            <p className="page-subtitle">Manage your Minecraft instances, install mods, and launch your favorite game versions.</p>
          </div>
          <div className={`instance-header ${scrolled ? 'scrolled' : ''}`}>
            <div className="header-actions">
            <div className="sort-controls">
              <span className="p-dropdown-label">Sort by:</span>
              <div className="p-dropdown" ref={sortRef}>
                <button 
                  className={`p-dropdown-trigger ${isSortOpen ? 'active' : ''}`}
                  style={{ minWidth: '120px' }}
                  onClick={() => setIsSortOpen(!isSortOpen)}
                >
                  <span className="trigger-label">
                    {sortBy === 'name' && 'Name'}
                    {sortBy === 'color' && 'Color'}
                    {sortBy === 'age' && 'Creation Date'}
                    {sortBy === 'playtime' && 'Playtime'}
                  </span>
                  <ChevronDown size={14} className={`trigger-icon ${isSortOpen ? 'flip' : ''}`} />
                </button>

                {isSortOpen && (
                  <div className="p-dropdown-menu">
                    <div 
                      className={`p-dropdown-item ${sortBy === 'name' ? 'selected' : ''}`}
                      onClick={() => {
                        handleSortChange({ target: { value: 'name' } });
                        setIsSortOpen(false);
                      }}
                    >
                      <span className="item-label">Name</span>
                      {sortBy === 'name' && <Check size={14} className="selected-icon" />}
                    </div>
                    <div 
                      className={`p-dropdown-item ${sortBy === 'color' ? 'selected' : ''}`}
                      onClick={() => {
                        handleSortChange({ target: { value: 'color' } });
                        setIsSortOpen(false);
                      }}
                    >
                      <span className="item-label">Color</span>
                      {sortBy === 'color' && <Check size={14} className="selected-icon" />}
                    </div>
                    <div 
                      className={`p-dropdown-item ${sortBy === 'age' ? 'selected' : ''}`}
                      onClick={() => {
                        handleSortChange({ target: { value: 'age' } });
                        setIsSortOpen(false);
                      }}
                    >
                      <span className="item-label">Creation Date</span>
                      {sortBy === 'age' && <Check size={14} className="selected-icon" />}
                    </div>
                    <div 
                      className={`p-dropdown-item ${sortBy === 'playtime' ? 'selected' : ''}`}
                      onClick={() => {
                        handleSortChange({ target: { value: 'playtime' } });
                        setIsSortOpen(false);
                      }}
                    >
                      <span className="item-label">Playtime</span>
                      {sortBy === 'playtime' && <Check size={14} className="selected-icon" />}
                    </div>
                  </div>
                )}
              </div>

              <div className="view-controls">
                <button
                  className={`view-btn ${viewMode === 'list' ? 'active' : ''}`}
                  onClick={switchToListView}
                  title="List View"
                >
                  <List size={18} />
                </button>
                <button
                  className={`view-btn ${viewMode === 'grid' ? 'active' : ''}`}
                  onClick={switchToGridView}
                  title="Grid View"
                >
                  <LayoutGrid size={18} />
                </button>
              </div>
            </div>
            <div style={{ flex: 1 }}></div>
            <button className="btn btn-primary" onClick={onCreate} disabled={isLoading}>
              + New Instance
            </button>
          </div>
        </div>
        </>
      )}

      {instances.length === 0 ? (
        <div className="empty-state">
          <div className="empty-state-visual">
            <Box
              className="empty-icon-main"
              size={56}
              style={{
                color: 'var(--accent)',
                opacity: 0.8
              }}
            />
          </div>
          <div className="empty-state-content">
            <h2>Your collection is empty</h2>
            <p>Ready to start a new adventure? Create a custom instance or install a modpack to see it here.</p>
            <button className="btn btn-primary btn-large btn-with-icon" onClick={onCreate}>
              <Plus size={18} />
              Create your first instance
            </button>
          </div>
        </div>
      ) : (
        <div className={`instances-grid ${viewMode} ${launcherSettings?.enable_instance_animations === false ? 'no-animations' : ''}`}>
          {sortedInstances.map((instance) => (
            <div
              key={instance.id}
              className={`instance-card ${instance.id === deletingInstanceId ? 'deleting' : ''} ${instance.id === launchingInstanceId ? 'launching' : ''}`}
              style={{
                '--instance-accent': instance.color_accent || 'var(--accent)',
                borderLeftWidth: instance.color_accent ? '4px' : '2px',
                borderLeftColor: instance.color_accent || 'var(--border)'
              }}
              onContextMenu={(e) => {
                e.preventDefault();
                e.stopPropagation();
                onContextMenu(e, instance);
              }}
            >
              {instance.id === deletingInstanceId && (
                <div className="deleting-overlay">
                  <div className="deleting-spinner" />
                  <span className="deleting-text">Removing...</span>
                </div>
              )}
              {instance.id === launchingInstanceId && (
                <div className="launching-overlay">
                  <div className="launching-spinner" />
                  <span className="launching-status">{loadingStatus || 'Launching...'}</span>
                  <div className="launching-progress-bar">
                    <div className="launching-progress-fill" style={{ width: `${loadingProgress}%` }} />
                  </div>
                  <span className="launching-percentage">{Number(loadingProgress).toFixed(1)}%</span>
                  {loadingBytes.total > 0 && (
                    <span className="launching-bytes">
                      {(loadingBytes.current / 1024 / 1024).toFixed(1)} / {(loadingBytes.total / 1024 / 1024).toFixed(1)} MB
                    </span>
                  )}
                  {loadingCount.total > 0 && (
                    <span className="launching-file-count">
                      {loadingCount.current} / {loadingCount.total} files
                    </span>
                  )}
                </div>
              )}
              <div className="instance-logo-wrapper">
                <div className="instance-logo">
                  {logoMap[instance.id] ? (
                    <img
                      src={logoMap[instance.id]}
                      alt=""
                      onError={(e) => {
                        // If it's not already the fallback, try the fallback
                        if (!e.target.src.endsWith('/minecraft_logo.png')) {
                          e.target.src = '/minecraft_logo.png';
                        } else {
                          // If fallback also fails, hide it
                          e.target.style.display = 'none';
                          if (e.target.nextSibling) {
                            e.target.nextSibling.style.display = 'block';
                          }
                        }
                      }}
                    />
                  ) : null}
                  <div
                    className="instance-logo-fallback"
                    style={{ display: logoMap[instance.id] ? 'none' : 'block' }}
                  />
                </div>
                {instance.mod_loader && instance.mod_loader !== 'Vanilla' && (
                  <span className={`instance-loader-badge ${(instance.mod_loader || '').toLowerCase().replace(' ', '-')}`}>
                    {instance.mod_loader}
                  </span>
                )}
              </div>
              <div className="instance-info">
                <div className="instance-title">
                  <h3 className="instance-name">{instance.name}</h3>
                  {instance.mod_loader && instance.mod_loader !== 'Vanilla' && (
                    <span className={`loader-inline ${(instance.mod_loader || '').toLowerCase().replace(' ', '-')}`}>{instance.mod_loader}</span>
                  )}
                </div>
                <div className="instance-meta">
                  <div className="meta-row">
                    <span className="version-pill">{instance.version_id}</span>
                    {formatPlaytime(instance.playtime_seconds) && (
                      <span className="time-pill">
                        <Clock className="meta-icon" size={12} />
                        {formatPlaytime(instance.playtime_seconds)}
                      </span>
                    )}
                    <span className="last-played-pill">
                      Last played: {formatDate(instance.last_played)}
                    </span>
                  </div>
                </div>
              </div>
              <div className="instance-actions">
                {runningInstances[instance.id] ? (
                  <button
                    className="btn btn-danger"
                    onClick={() => onStop(instance.id)}
                    disabled={isLoading}
                  >
                    Stop
                  </button>
                ) : (
                  <button
                    className="btn btn-play"
                    onClick={() => onLaunch(instance.id)}
                    disabled={isLoading}
                  >
                    Play
                  </button>
                )}
                <button
                  className="btn btn-secondary"
                  onClick={() => onEdit(instance.id)}
                  disabled={isLoading || openEditors.includes(instance.id)}
                  title={openEditors.includes(instance.id) ? "Editor already open" : "Edit instance"}
                >
                  {openEditors.includes(instance.id) ? "Editing..." : "Edit"}
                </button>
                <button
                  className="delete-btn-standalone"
                  onClick={() => onDelete(instance.id)}
                  disabled={isLoading}
                  title="Delete instance"
                >
                  <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="#f87171"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                  >
                    <path d="M3 6h18" />
                    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
                    <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                    <line x1="10" y1="11" x2="10" y2="17" />
                    <line x1="14" y1="11" x2="14" y2="17" />
                  </svg>
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default InstanceList;
