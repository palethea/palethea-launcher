import { useEffect, useState, useMemo, useCallback, useRef } from 'react';
import { Clock, Plus, Box, LayoutGrid, List, ChevronDown, Check, User, UserCheck, Tag, CalendarDays, Play, Square, MoreVertical, X, Boxes } from 'lucide-react';
import { invoke, convertFileSrc } from '@tauri-apps/api/core';
import { sep } from '@tauri-apps/api/path';
import { clampProgress, formatBytes, formatSpeed } from '../utils/downloadTelemetry';
import './InstanceList.css';

const STEVE_HEAD_DATA = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAIAAABLbSncAAAARklEQVQI12NgoAbghLD+I4kwBqOjo+O/f/8YGBj+MzD8Z2D4z8Dwnwmq7P9/BoYL5y8g0/8hHP7/x0b/Y2D4D5b5/58ZAME2EVcxlvGVAAAAAElFTkSuQmCC';

function SkinHead2D({ src, size = 28 }) {
  return (
    <div className="instance-head-2d" style={{ width: `${size}px`, height: `${size}px` }}>
      <div
        className="head-base"
        style={{
          backgroundImage: `url("${src}")`,
          width: `${size}px`,
          height: `${size}px`,
          backgroundSize: `${size * 8}px auto`,
          backgroundPosition: `-${size}px -${size}px`
        }}
      />
      <div
        className="head-overlay"
        style={{
          backgroundImage: `url("${src}")`,
          width: `${size}px`,
          height: `${size}px`,
          backgroundSize: `${size * 8}px auto`,
          backgroundPosition: `-${size * 5}px -${size}px`
        }}
      />
    </div>
  );
}

function InstanceList({
  instances,
  onLaunch,
  onStop,
  onCreate,
  onContextMenu,
  onInstancesRefresh,
  onShowNotification,
  skinCache = {},
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
  const [savedAccounts, setSavedAccounts] = useState([]);
  const [activeAccountUsername, setActiveAccountUsername] = useState('');
  const [showAccountModal, setShowAccountModal] = useState(false);
  const [accountPickerInstance, setAccountPickerInstance] = useState(null);
  const [updatingAccount, setUpdatingAccount] = useState(false);
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

  useEffect(() => {
    if (!showAccountModal) return undefined;

    const handleEsc = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        if (!updatingAccount) {
          setShowAccountModal(false);
          setAccountPickerInstance(null);
        }
      }
    };

    window.addEventListener('keydown', handleEsc, true);
    return () => window.removeEventListener('keydown', handleEsc, true);
  }, [showAccountModal, updatingAccount]);

  const loadAccounts = useCallback(async () => {
    try {
      const data = await invoke('get_saved_accounts');
      setSavedAccounts(data?.accounts || []);
      setActiveAccountUsername(data?.active_account || '');
    } catch (error) {
      console.error('Failed to load accounts for picker:', error);
    }
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

  const handleOpenAccountPicker = useCallback(async (event, instance) => {
    event.preventDefault();
    event.stopPropagation();
    setAccountPickerInstance(instance);
    setShowAccountModal(true);
    await loadAccounts();
  }, [loadAccounts]);

  const handleSetPreferredAccount = useCallback(async (username) => {
    if (!accountPickerInstance || updatingAccount) return;
    setUpdatingAccount(true);
    try {
      await invoke('update_instance', {
        instance: {
          ...accountPickerInstance,
          preferred_account: username || null,
        }
      });
      if (onInstancesRefresh) {
        await onInstancesRefresh();
      }
      if (onShowNotification) {
        onShowNotification(
          username ? `Pinned ${accountPickerInstance.name} to ${username}` : `${accountPickerInstance.name} now uses active account`,
          'success'
        );
      }
      setShowAccountModal(false);
      setAccountPickerInstance(null);
    } catch (error) {
      console.error('Failed to update preferred account:', error);
      if (onShowNotification) {
        onShowNotification(`Failed to set account: ${error}`, 'error');
      }
    } finally {
      setUpdatingAccount(false);
    }
  }, [accountPickerInstance, onInstancesRefresh, onShowNotification, updatingAccount]);

  const activeAccountForDefault = useMemo(
    () => savedAccounts.find((account) => account.username === activeAccountUsername) || null,
    [savedAccounts, activeAccountUsername]
  );

  const getSkinUrl = useCallback((uuid, isMicrosoft) => {
    if (!isMicrosoft || !uuid) return null;
    return `https://crafatar.com/avatars/${uuid}?size=64&overlay=true`;
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
            const rawLoader = (instance.mod_loader || '').trim();
            const loaderLabel = rawLoader ? (rawLoader.toLowerCase() === 'vanilla' ? 'Vanilla' : rawLoader) : 'Vanilla';
            const loaderClass = loaderLabel.toLowerCase().replace(/\s+/g, '-');
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
            const accountButton = (
              <button
                className={`instance-account-corner-btn ${hasPinnedAccount ? 'is-pinned' : ''} ${isGridView ? 'is-grid' : 'is-list'}`}
                title={hasPinnedAccount ? `Pinned account: ${instance.preferred_account}` : 'Use active account (click to choose)'}
                aria-label={hasPinnedAccount ? `Pinned account: ${instance.preferred_account}` : 'Use active account'}
                onClick={(event) => handleOpenAccountPicker(event, instance)}
                disabled={isLaunching || isStopping}
              >
                <UserCheck size={16} />
              </button>
            );
            const instanceActions = (
              <>
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
                {!isGridView && accountButton}
              </>
            );

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
                    <div className="launching-overlay launching-overlay-grid">
                      <div className="launching-grid-top">
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
                        <div className="launching-grid-meta">
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
                      {runningInstances[instance.id] && (
                        <span
                          className="instance-running-blob"
                          title="Running"
                          aria-label="Running"
                        />
                      )}
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
                      {!isGridView && (
                        <span className="instance-title-version" title={`Minecraft version ${instance.version_id}`}>
                          <Tag className="meta-icon" size={12} />
                          {instance.version_id}
                        </span>
                      )}
                    </div>
                    {isGridView ? (
                      <div className="instance-title-version-line">
                        <span className="instance-meta-text version" title={`Minecraft version ${instance.version_id}`}>
                          <Tag className="meta-icon" size={12} />
                          {instance.version_id}
                        </span>
                      </div>
                    ) : (
                      <div className="instance-list-meta-line">
                        <span className={`instance-meta-text mod-loader ${loaderClass}`}>
                          <Boxes className="meta-icon" size={12} />
                          {loaderLabel}
                        </span>
                        <span className="instance-meta-text played">
                          <CalendarDays className="meta-icon" size={12} />
                          {formatDate(instance.last_played)}
                        </span>
                        {playtimeLabel && (
                          <span className="instance-meta-text playtime">
                            <Clock className="meta-icon" size={12} />
                            <span className="instance-meta-value">{playtimeLabel}</span>
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                  {isGridView && (
                    <div className="instance-actions">
                      {instanceActions}
                    </div>
                  )}
                </div>
                {isGridView ? (
                  <div className="instance-list-meta-line instance-list-meta-line-grid">
                    <span className={`instance-meta-text mod-loader ${loaderClass}`}>
                      <Boxes className="meta-icon" size={12} />
                      {loaderLabel}
                    </span>
                    <span className="instance-meta-text played">
                      <CalendarDays className="meta-icon" size={12} />
                      {formatDate(instance.last_played)}
                    </span>
                    {playtimeLabel && (
                      <span className="instance-meta-text playtime">
                        <Clock className="meta-icon" size={12} />
                        <span className="instance-meta-value">{playtimeLabel}</span>
                      </span>
                    )}
                  </div>
                ) : (
                  <div className="instance-actions">
                    {instanceActions}
                  </div>
                )}
                {isGridView && accountButton}
              </div>
            );
          })}
        </div>
      )}
      {showAccountModal && accountPickerInstance && (
        <div className="instance-account-modal-overlay" onClick={() => { if (!updatingAccount) { setShowAccountModal(false); setAccountPickerInstance(null); } }}>
          <div className="instance-account-modal" onClick={(e) => e.stopPropagation()}>
            <div className="instance-account-modal-header">
              <div>
                <h3>Choose Launch Account</h3>
                <p>Pick an account just for this instance, or keep using the active account.</p>
              </div>
              <button
                className="instance-account-modal-close"
                onClick={() => { if (!updatingAccount) { setShowAccountModal(false); setAccountPickerInstance(null); } }}
                title="Close"
                disabled={updatingAccount}
              >
                <X size={18} />
              </button>
            </div>

            <div className="instance-account-modal-list">
              <button
                className={`instance-account-option ${(accountPickerInstance.preferred_account || '') === '' ? 'selected' : ''}`}
                onClick={() => handleSetPreferredAccount('')}
                disabled={updatingAccount}
              >
                <div className="instance-account-option-avatar">
                  {activeAccountForDefault?.uuid && skinCache[activeAccountForDefault.uuid] ? (
                    <SkinHead2D src={skinCache[activeAccountForDefault.uuid]} size={28} />
                  ) : activeAccountForDefault?.is_microsoft ? (
                    <img
                      src={getSkinUrl(activeAccountForDefault.uuid, activeAccountForDefault.is_microsoft)}
                      alt=""
                      className="instance-account-avatar-img"
                      onError={(e) => {
                        e.target.src = STEVE_HEAD_DATA;
                      }}
                    />
                  ) : (
                    <User size={18} />
                  )}
                </div>
                <div className="instance-account-option-body">
                  <div className="instance-account-option-title">
                    Use Active Account
                    {activeAccountUsername && <span className="instance-account-option-meta">({activeAccountUsername})</span>}
                  </div>
                  <div className="instance-account-option-sub">Follows whatever account is currently active in the launcher.</div>
                </div>
                {(accountPickerInstance.preferred_account || '') === '' && <Check size={16} className="instance-account-option-check" />}
              </button>

              {savedAccounts.map((account) => (
                <button
                  key={account.uuid}
                  className={`instance-account-option ${accountPickerInstance.preferred_account === account.username ? 'selected' : ''}`}
                  onClick={() => handleSetPreferredAccount(account.username)}
                  disabled={updatingAccount}
                >
                  <div className="instance-account-option-avatar">
                    {skinCache[account.uuid] ? (
                      <SkinHead2D src={skinCache[account.uuid]} size={28} />
                    ) : account.is_microsoft ? (
                      <img
                        src={getSkinUrl(account.uuid, account.is_microsoft)}
                        alt=""
                        className="instance-account-avatar-img"
                        onError={(e) => {
                          e.target.src = STEVE_HEAD_DATA;
                        }}
                      />
                    ) : (
                      <User size={18} />
                    )}
                  </div>
                  <div className="instance-account-option-body">
                    <div className="instance-account-option-title">
                      {account.username}
                      {activeAccountUsername === account.username && (
                        <span className="instance-account-pill">Active</span>
                      )}
                    </div>
                    <div className="instance-account-option-sub">{account.is_microsoft ? 'Microsoft account' : 'Offline account'}</div>
                  </div>
                  {accountPickerInstance.preferred_account === account.username && (
                    <Check size={16} className="instance-account-option-check" />
                  )}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default InstanceList;
