import { useEffect, useState, useMemo, useCallback, useRef } from 'react';
import { Clock, Plus, Box, LayoutGrid, List, ChevronDown, Check, User, Tag, CalendarDays, Play, Square, MoreVertical } from 'lucide-react';
import { invoke, convertFileSrc } from '@tauri-apps/api/core';
import { sep } from '@tauri-apps/api/path';
import { clampProgress, formatBytes, formatSpeed } from '../utils/downloadTelemetry';
import './InstanceList.css';

function InstanceList({
  instances,
  onLaunch,
  onStop,
  onCreate,
  onContextMenu,
  isLoading,
  launchingInstanceIds = [],
  launchingInstanceId = null,
  loadingStatus = '',
  loadingProgress = 0,
  loadingBytes = { current: 0, total: 0 },
  loadingCount = { current: 0, total: 0 },
  loadingTelemetry = { stageLabel: '', currentItem: '', speedBps: 0, etaSeconds: null },
  launchProgressByInstance = {},
  runningInstances = {},
  stoppingInstanceIds = [],
  deletingInstanceId = null,
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

    const handleEscape = (event) => {
      if (event.key === 'Escape') {
        setIsSortOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEscape);
    };
  }, []);

  const openInstanceContextMenuFromButton = useCallback((event, instance) => {
    event.preventDefault();
    event.stopPropagation();
    const buttonRect = event.currentTarget.getBoundingClientRect();
    const syntheticEvent = {
      preventDefault: () => {},
      clientX: Math.round(buttonRect.left + (buttonRect.width / 2)),
      clientY: Math.round(buttonRect.bottom + 6)
    };
    onContextMenu(syntheticEvent, instance);
  }, [onContextMenu]);

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
    <div className={`instance-list ${viewMode === 'list' ? 'list-mode' : 'grid-mode'}`} onScroll={handleScroll} onContextMenu={handleContainerContextMenu}>
      {instances.length > 0 && (
        <>
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
          {sortedInstances.map((instance) => {
            const loaderClass = (instance.mod_loader || '').toLowerCase().replace(' ', '-');
            const hasPinnedAccount = Boolean(instance.preferred_account && instance.preferred_account.trim() !== '');
            const playtimeLabel = formatPlaytime(instance.playtime_seconds);
            const isGridView = viewMode === 'grid';
            const isLaunching = launchingInstanceIds.includes(instance.id) || instance.id === launchingInstanceId;
            const isStopping = stoppingInstanceIds.includes(instance.id);
            const launchData = launchProgressByInstance[instance.id];
            const launchTelemetry = launchData?.telemetry || loadingTelemetry;
            const launchBytes = launchData?.bytes || loadingBytes;
            const launchCount = launchData?.count || loadingCount;
            const launchProgress = clampProgress(launchData?.progress ?? loadingProgress);
            const launchStageLabel = launchTelemetry.stageLabel || launchData?.status || loadingStatus || 'Launching...';

            return (
              <div
                key={instance.id}
                className={`instance-card ${runningInstances[instance.id] ? 'is-running' : ''} ${instance.id === deletingInstanceId ? 'deleting' : ''} ${isLaunching ? 'launching' : ''} ${isStopping ? 'stopping' : ''}`}
                style={{
                  '--instance-accent': instance.color_accent || 'var(--accent)',
                  '--instance-icon-accent': instance.color_accent || 'var(--border)'
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
                {isStopping ? (
                  isGridView ? (
                    <div className="stopping-overlay">
                      <div className="stopping-spinner" />
                      <span className="stopping-status">Stopping instance...</span>
                      <div className="stopping-progress-bar">
                        <div className="stopping-progress-fill" />
                      </div>
                    </div>
                  ) : (
                    <div className="stopping-overlay stopping-overlay-list">
                      <div className="stopping-list-top">
                        <div className="stopping-spinner" />
                        <span className="stopping-status">Stopping instance...</span>
                      </div>
                      <div className="stopping-progress-bar">
                        <div className="stopping-progress-fill" />
                      </div>
                    </div>
                  )
                ) : isLaunching ? (
                  isGridView ? (
                    <div className="launching-overlay">
                      <div className="launching-spinner" />
                      <span className="launching-status">{launchStageLabel}</span>
                      {launchTelemetry.currentItem && (
                        <span className="launching-item">{launchTelemetry.currentItem}</span>
                      )}
                      <div className="launching-progress-bar">
                        <div className="launching-progress-fill" style={{ width: `${launchProgress}%` }} />
                      </div>
                      <span className="launching-percentage">{launchProgress.toFixed(1)}%</span>
                      {launchBytes.total > 0 && (
                        <span className="launching-bytes">
                          {formatBytes(launchBytes.current)} / {formatBytes(launchBytes.total)}
                        </span>
                      )}
                      {launchCount.total > 0 && (
                        <span className="launching-file-count">
                          {launchCount.current} / {launchCount.total} files
                        </span>
                      )}
                      {launchTelemetry.speedBps > 0 && (
                        <span className="launching-transfer-meta">
                          {formatSpeed(launchTelemetry.speedBps)}
                        </span>
                      )}
                    </div>
                  ) : (
                    <div className="launching-overlay launching-overlay-list">
                      <div className="launching-list-top">
                        <div className="launching-spinner" />
                        <span className="launching-status">{launchStageLabel}</span>
                        <span className="launching-percentage">{launchProgress.toFixed(1)}%</span>
                      </div>
                      <div className="launching-progress-bar">
                        <div className="launching-progress-fill" style={{ width: `${launchProgress}%` }} />
                      </div>
                      {launchTelemetry.currentItem && (
                        <span className="launching-item">{launchTelemetry.currentItem}</span>
                      )}
                      {(launchBytes.total > 0 || launchCount.total > 0 || launchTelemetry.speedBps > 0) && (
                        <div className="launching-list-meta">
                          {launchBytes.total > 0 && (
                            <span className="launching-bytes">
                              {formatBytes(launchBytes.current)} / {formatBytes(launchBytes.total)}
                            </span>
                          )}
                          {launchCount.total > 0 && (
                            <span className="launching-file-count">
                              {launchCount.current} / {launchCount.total} files
                            </span>
                          )}
                          {launchTelemetry.speedBps > 0 && (
                            <span className="launching-transfer-meta">
                              {formatSpeed(launchTelemetry.speedBps)}
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                  )
                ) : null}

                <div className={`instance-row-main ${isGridView ? 'instance-row-main-grid' : ''}`}>
                  <div className="instance-logo-wrapper">
                    <div className="instance-logo">
                      {logoMap[instance.id] ? (
                        <img
                          src={logoMap[instance.id]}
                          alt=""
                          onError={(e) => {
                            if (!e.target.src.endsWith('/minecraft_logo.png')) {
                              e.target.src = '/minecraft_logo.png';
                            } else {
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
                  </div>
                  <div className={`instance-info instance-info-list ${isGridView ? 'instance-info-grid' : ''}`}>
                    <div className="instance-row-title">
                      <h3 className="instance-name">{instance.name}</h3>
                      {runningInstances[instance.id] && (
                        <span
                          className="instance-running-blob"
                          title="Running"
                          aria-label="Running"
                        />
                      )}
                    </div>
                    <div className={`instance-list-meta-line ${isGridView ? 'instance-list-meta-line-grid' : ''}`}>
                      <span className="instance-meta-text version" title={`Minecraft version ${instance.version_id}`}>
                        <Tag className="meta-icon" size={12} />
                        {instance.version_id}
                      </span>
                      {instance.mod_loader && instance.mod_loader !== 'Vanilla' && (
                        <span className={`instance-meta-text mod-loader ${loaderClass}`}>
                          {instance.mod_loader}
                        </span>
                      )}
                      <span className="instance-meta-text played">
                        <CalendarDays className="meta-icon" size={12} />
                        {formatDate(instance.last_played)}
                      </span>
                      {playtimeLabel && (
                        <span className="instance-meta-text playtime">
                          <Clock className="meta-icon" size={12} />
                          {playtimeLabel}
                        </span>
                      )}
                      {hasPinnedAccount && (
                        <span className="instance-meta-text account" title={`Launches with ${instance.preferred_account}`}>
                          <User className="meta-icon" size={12} />
                          {instance.preferred_account}
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                <div className="instance-actions">
                  <button
                    className={`instance-list-play-btn ${runningInstances[instance.id] ? 'is-running' : ''} ${isLaunching && !runningInstances[instance.id] ? 'is-launching' : ''} ${isStopping ? 'is-stopping' : ''}`}
                    onClick={() => (runningInstances[instance.id] ? onStop(instance.id) : onLaunch(instance.id))}
                    disabled={isLoading || isLaunching || isStopping}
                    title={runningInstances[instance.id] ? 'Stop instance' : 'Launch instance'}
                    aria-label={runningInstances[instance.id] ? 'Stop instance' : 'Launch instance'}
                  >
                    {runningInstances[instance.id] ? <Square size={15} /> : <Play size={15} />}
                    <span>{runningInstances[instance.id] ? (isStopping ? 'Stopping...' : 'Playing') : (isLaunching ? 'Launching...' : 'Play')}</span>
                  </button>

                  <div className="instance-row-menu-anchor">
                    <button
                      className="instance-kebab-btn"
                      type="button"
                      title="More actions"
                      aria-label="More actions"
                      disabled={isStopping}
                      onClick={(event) => openInstanceContextMenuFromButton(event, instance)}
                    >
                      <MoreVertical size={18} />
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default InstanceList;
