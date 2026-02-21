import { useState, useEffect, useCallback, memo, useRef, useMemo } from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { sep } from '@tauri-apps/api/path';
import { invoke, convertFileSrc } from '@tauri-apps/api/core';
import { X, Minus, Maximize, Minimize2, Terminal, ChevronDown, Square, List, Shirt, BarChart3, RefreshCcw, Wallpaper, Settings, Download, Trash2, Play, User, Tag } from 'lucide-react';
import { clampProgress, formatBytes, formatSpeed } from '../utils/downloadTelemetry';
import './TitleBar.css';

const STEVE_HEAD_DATA = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAIAAABLbSncAAAARklEQVQI12NgoAbghLD+I4kwBqOjo+O/f/8YGBj+MzD8Z2D4z8Dwnwmq7P9/BoYL5y8g0/8hHP7/x0b/Y2D4D5b5/58ZAME2EVcxlvGVAAAAAElFTkSuQmCC';

function handleLogoImageError(event) {
  const image = event.currentTarget;

  if (image.dataset.fallbackTried !== '1') {
    image.dataset.fallbackTried = '1';
    image.src = '/minecraft_logo.png';
    return;
  }

  image.style.display = 'none';
  if (image.nextElementSibling) {
    image.nextElementSibling.style.display = 'flex';
  }
}

function getDownloadItemIcon(item) {
  if (item?.icon) return item.icon;
  if (item?.kind === 'instance-setup') return '/minecraft_logo.png';
  return null;
}

function shallowEqualObject(a, b) {
  const aKeys = Object.keys(a);
  const bKeys = Object.keys(b);
  if (aKeys.length !== bKeys.length) return false;
  for (const key of aKeys) {
    if (a[key] !== b[key]) return false;
  }
  return true;
}

function TitleBar({ 
  activeTab, 
  onTabChange, 
  isPopout, 
  launcherSettings, 
  runningInstances = {}, 
  stoppingInstanceIds = [],
  forceStoppingInstanceIds = [],
  instances = [],
  accounts = [],
  onStopInstance,
  onForceStopInstance,
  onStopAllInstances,
  editingInstanceId = null,
  downloadQueue = [],
  downloadHistory = [],
  onClearDownloadHistory
}) {
  const [isMaximized, setIsMaximized] = useState(false);
  const [showRunningDropdown, setShowRunningDropdown] = useState(false);
  const [showDownloadDropdown, setShowDownloadDropdown] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [isClosing, setIsClosing] = useState(false);
  const [isDownloadClosing, setIsDownloadClosing] = useState(false);
  const [logoMap, setLogoMap] = useState({});
  const [failedAccountHeads, setFailedAccountHeads] = useState({});
  const dropdownRef = useRef(null);
  const downloadRef = useRef(null);
  const appWindow = useMemo(() => getCurrentWindow(), []);

  const runningIdsKey = useMemo(
    () => Object.keys(runningInstances).sort().join(','),
    [runningInstances]
  );
  const runningIds = useMemo(
    () => (runningIdsKey ? runningIdsKey.split(',') : []),
    [runningIdsKey]
  );
  const stoppingInstanceIdSet = useMemo(
    () => new Set(stoppingInstanceIds),
    [stoppingInstanceIds]
  );
  const forceStoppingInstanceIdSet = useMemo(
    () => new Set(forceStoppingInstanceIds),
    [forceStoppingInstanceIds]
  );
  const hasRunning = runningIds.length > 0;
  const hasActiveDownloads = useMemo(
    () => downloadQueue.some((item) => {
      const status = `${item?.status || ''} ${item?.stageLabel || ''} ${item?.stage || ''}`.toLowerCase();
      const progress = typeof item?.progress === 'number' ? item.progress : null;
      return Boolean(
        item?.trackBackendProgress
        || status.includes('downloading')
        || status.includes('installing')
        || (progress !== null && progress > 0 && progress < 100)
      );
    }),
    [downloadQueue]
  );
  const accountByUsername = useMemo(() => {
    const map = new Map();
    for (const account of accounts) {
      const username = (account?.username || '').trim();
      if (!username) continue;
      map.set(username.toLowerCase(), account);
    }
    return map;
  }, [accounts]);

  const TABS_CONFIG = {
    instances: { label: 'Instances', icon: List },
    skins: { label: 'Skins', icon: Shirt },
    stats: { label: 'Stats', icon: BarChart3 },
    updates: { label: 'Updates', icon: RefreshCcw },
    appearance: { label: 'Appearance', icon: Wallpaper },
    settings: { label: 'Settings', icon: Settings },
  };

  const currentTabInfo = TABS_CONFIG[activeTab];
  const editingInstance = editingInstanceId ? instances.find(i => i.id === editingInstanceId) : null;
  const showTitlebarLocation = launcherSettings?.titlebar_location_next_to_logo !== false;

  // Create a stable key that only changes when logos actually change
  const logoKey = useMemo(
    () => instances.map(i => `${i.id}:${i.logo_filename || 'default'}`).sort().join(','),
    [instances]
  );
  const logoFilenameById = useMemo(() => {
    const map = {};
    for (const instance of instances) {
      map[instance.id] = instance.logo_filename || 'minecraft_logo.png';
    }
    return map;
  }, [logoKey]);

  const toggleDropdown = () => {
    if (showRunningDropdown) {
      setIsClosing(true);
      setTimeout(() => {
        setShowRunningDropdown(false);
        setIsClosing(false);
      }, 200); // Match CSS animation time
    } else {
      setShowRunningDropdown(true);
    }
  };

  const toggleDownloadDropdown = () => {
    if (showDownloadDropdown) {
      setIsDownloadClosing(true);
      setTimeout(() => {
        setShowDownloadDropdown(false);
        setIsDownloadClosing(false);
      }, 200);
    } else {
      setShowDownloadDropdown(true);
    }
  };

  useEffect(() => {
    const updateCurrentTime = () => {
      setCurrentTime(Math.floor(Date.now() / 1000));
    };

    updateCurrentTime();
    const timer = setInterval(updateCurrentTime, 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    const loadLogos = async () => {
      if ((!hasRunning && !editingInstanceId) || instances.length === 0) {
        setLogoMap(prev => (Object.keys(prev).length === 0 ? prev : {}));
        return;
      }

      try {
        const baseDir = await invoke('get_data_directory');
        const s = await sep();
        
        // Clean up baseDir if it ends with a separator
        const normalizedBase = baseDir.endsWith(s) ? baseDir.slice(0, -1) : baseDir;
        const logosDir = `${normalizedBase}${s}instance_logos`;
        
        const newLogoMap = {};
        const idsToLoad = new Set([...runningIds]);
        if (editingInstanceId) idsToLoad.add(editingInstanceId);

        for (const id of idsToLoad) {
          const filename = logoFilenameById[id];
          if (filename) {
            const logoPath = `${logosDir}${s}${filename}`;
            newLogoMap[id] = convertFileSrc(logoPath);
          }
        }
        setLogoMap(prev => (shallowEqualObject(prev, newLogoMap) ? prev : newLogoMap));
      } catch (err) {
        console.error("Failed to load titlebar logos:", err);
      }
    };

    loadLogos();
  }, [hasRunning, runningIdsKey, logoKey, editingInstanceId, logoFilenameById, instances.length]);

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
        if (showRunningDropdown && !isClosing) {
          toggleDropdown();
        }
      }
      if (downloadRef.current && !downloadRef.current.contains(event.target)) {
        if (showDownloadDropdown && !isDownloadClosing) {
          toggleDownloadDropdown();
        }
      }
    };

    if (showRunningDropdown || showDownloadDropdown) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [showRunningDropdown, isClosing, showDownloadDropdown, isDownloadClosing]);

  useEffect(() => {
    const updateMaximized = async () => {
      try {
        const maximized = await appWindow.isMaximized();
        setIsMaximized(prev => (prev === maximized ? prev : maximized));
      } catch (e) {
        console.warn('Failed to check maximized state:', e);
      }
    };

    updateMaximized();

    const unlisten = appWindow.onResized(() => {
      updateMaximized();
    });

    return () => {
      unlisten.then(u => u());
    };
  }, [appWindow]);

  const formatRuntime = (startTime) => {
    const diff = Math.max(0, currentTime - startTime);
    const h = Math.floor(diff / 3600);
    const m = Math.floor((diff % 3600) / 60);
    const s = diff % 60;
    
    if (h > 0) return `${h}h ${m}m ${s}s`;
    if (m > 0) return `${m}m ${s}s`;
    return `${s}s`;
  };

  const getAccountHeadUrl = useCallback((account) => {
    if (!account?.uuid) return null;
    const isMicrosoft = Boolean(account.isLoggedIn ?? account.is_microsoft);
    if (!isMicrosoft) return null;
    if (failedAccountHeads[account.uuid]) return STEVE_HEAD_DATA;
    return `https://minotar.net/helm/${account.uuid.replace(/-/g, '')}/64.png`;
  }, [failedAccountHeads]);

  const handleMinimize = useCallback(() => appWindow.minimize(), [appWindow]);
  const handleMaximize = useCallback(async () => {
    try {
      await appWindow.toggleMaximize();
      const maximized = await appWindow.isMaximized();
      setIsMaximized(maximized);
    } catch (e) {
      console.warn('Failed to toggle maximize:', e);
    }
  }, [appWindow]);

  const handleClose = useCallback(() => appWindow.close(), [appWindow]);

  const handleMouseDown = useCallback((e) => {
    // Only drag on left click and ignore if it's a double click (let double-click handle maximize)
    if (e.button === 0 && e.detail === 1 && !e.target.closest('button')) {
      appWindow.startDragging();
    }
  }, [appWindow]);

  const renderDownloadQueueControl = (extraClass = '') => (
    <div className={`download-queue-container ${extraClass}`.trim()} ref={downloadRef}>
      <button 
        className={`download-queue-btn ${hasActiveDownloads ? 'has-active-downloads' : ''} ${showDownloadDropdown ? 'is-open' : ''}`.trim()}
        onClick={toggleDownloadDropdown}
        title="Download Queue"
      >
        <Download size={18} />
        {downloadQueue.length > 0 && <span className="download-count">{downloadQueue.length}</span>}
      </button>

      {showDownloadDropdown && (
        <div className={`running-dropdown download-dropdown ${isDownloadClosing ? 'closing' : ''}`}>
          <div className="dropdown-header">
            <span>Downloads</span>
            {downloadHistory.length > 0 && (
              <button 
                className="clear-history-btn"
                onClick={(e) => {
                  e.stopPropagation();
                  onClearDownloadHistory?.();
                }}
                title="Clear History"
              >
                <Trash2 size={12} />
                <span>Clear</span>
              </button>
            )}
          </div>
          <div className="dropdown-list">
            {downloadQueue.length === 0 && downloadHistory.length === 0 ? (
              <div className="dropdown-empty">No downloads</div>
            ) : (
              <>
                {/* Active Downloads */}
                {downloadQueue.map((item, index) => (
                  <div key={`active-${item.id || index}`} className="running-item download-item">
                    <div className="running-item-left">
                      <div className="running-item-logo">
                        {getDownloadItemIcon(item) ? (
                          <img src={getDownloadItemIcon(item)} alt="" referrerPolicy="no-referrer" />
                        ) : (
                          <div className="logo-fallback">📦</div>
                        )}
                      </div>
                      <div className="running-item-info">
                        <div className="running-item-name">{item.name}</div>
                        <div className="running-item-time">{item.stageLabel || item.status || 'Pending...'}</div>
                        {item.currentItem && <div className="download-item-current">{item.currentItem}</div>}
                        {typeof item.progress === 'number' && (
                          <div className="download-item-progress">
                            <div className="download-item-progress-fill" style={{ width: `${clampProgress(item.progress)}%` }} />
                          </div>
                        )}
                        {(item.totalBytes > 0 || item.totalCount > 0 || item.speedBps > 0) && (
                          <div className="download-item-metrics">
                            {item.totalCount > 0 && <span>{item.currentCount || 0}/{item.totalCount} files</span>}
                            {item.totalBytes > 0 && <span>{formatBytes(item.downloadedBytes || 0)}/{formatBytes(item.totalBytes)}</span>}
                            {item.speedBps > 0 && <span>{formatSpeed(item.speedBps)}</span>}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                ))}

                {/* Separator if both exist */}
                {downloadQueue.length > 0 && downloadHistory.length > 0 && (
                  <div className="download-separator">
                    <div className="separator-line"></div>
                    <span>Recent</span>
                    <div className="separator-line"></div>
                  </div>
                )}

                {/* History */}
                {downloadHistory.map((item, index) => (
                  <div key={`history-${item.id || index}`} className="running-item items-history">
                    <div className="running-item-left">
                      <div className="running-item-logo">
                        {getDownloadItemIcon(item) ? (
                          <img src={getDownloadItemIcon(item)} alt="" referrerPolicy="no-referrer" style={{ opacity: 0.6 }} />
                        ) : (
                          <div className="logo-fallback" style={{ opacity: 0.6 }}>📦</div>
                        )}
                      </div>
                      <div className="running-item-info" style={{ opacity: 0.6 }}>
                        <div className="running-item-name">{item.name}</div>
                        <div className="running-item-time">Installed</div>
                      </div>
                    </div>
                  </div>
                ))}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );

  return (
    <div 
      className={`titlebar ${isPopout ? '' : 'with-sidebar'}`} 
      onMouseDown={handleMouseDown}
      onDoubleClick={handleMaximize}
    >
      <div className="titlebar-left">
        {/* <img src="/logoPL.png" className="titlebar-logo" alt="" /> */}
        <span className="titlebar-text">Palethea</span>
        {renderDownloadQueueControl('titlebar-left-download')}
        
        {!isPopout && launcherSettings?.enable_console && (
          <button 
            className={`titlebar-console-btn ${activeTab === 'console' ? 'active' : ''}`}
            onClick={() => onTabChange('console')}
            title="Console"
          >
            <Terminal size={14} />
          </button>
        )}
      </div>

      <div className="titlebar-center">
        {showTitlebarLocation && editingInstance && (
          <div className="titlebar-center-tab titlebar-editing-info titlebar-location-tab">
            <div className="editing-logo">
              {logoMap[editingInstanceId] ? (
                <>
                  <img
                    key={logoMap[editingInstanceId]}
                    src={logoMap[editingInstanceId]}
                    alt=""
                    onError={handleLogoImageError}
                  />
                  <div className="editing-logo-fallback" style={{ display: 'none' }}>
                    {editingInstance.name.charAt(0)}
                  </div>
                </>
              ) : (
                <div className="editing-logo-fallback">{editingInstance.name.charAt(0)}</div>
              )}
            </div>
            <span>{editingInstance.name}</span>
          </div>
        )}
        {showTitlebarLocation && !isPopout && !editingInstance && currentTabInfo && (
          <div className="titlebar-center-tab titlebar-location-tab">
            <currentTabInfo.icon size={16} />
            <span>{currentTabInfo.label}</span>
          </div>
        )}
      </div>
      
      <div className="titlebar-right">
        <div className="running-instances-container" ref={dropdownRef}>
          <button 
            className={`running-instances-pill ${showRunningDropdown ? 'active' : ''} ${!hasRunning ? 'no-running' : ''}`}
            onClick={toggleDropdown}
            title="Running Instances"
          >
            <Play size={14} fill={hasRunning ? "currentColor" : "none"} className={hasRunning ? 'play-active' : ''} />
            <span>{runningIds.length}</span>
            <ChevronDown size={14} className={`chevron ${showRunningDropdown && !isClosing ? 'inverted' : ''}`} />
          </button>

          {showRunningDropdown && (
            <div className={`running-dropdown ${isClosing ? 'closing' : ''}`}>
              <div className="dropdown-header">
                <span>Running Instances</span>
                <button
                  type="button"
                  className="stop-all-instances-btn"
                  onClick={() => onStopAllInstances?.()}
                  disabled={!hasRunning}
                  title="Stop all running instances"
                >
                  <Square size={11} fill="currentColor" />
                  <span>Stop all</span>
                </button>
              </div>
              <div className="dropdown-list">
                {runningIds.length === 0 ? (
                  <div className="dropdown-empty">No instances running</div>
                ) : (
                  runningIds.map(id => {
                    const instance = instances.find(i => i.id === id);
                    if (!instance) return null;
                    const info = runningInstances[id];
                    const isStopping = stoppingInstanceIdSet.has(id);
                    const isForceStopping = forceStoppingInstanceIdSet.has(id);
                    const canForceStop = isStopping && typeof onForceStopInstance === 'function';
                    const stopButtonTitle = isForceStopping
                      ? 'Force stop in progress'
                      : canForceStop
                        ? 'Force stop instance'
                        : isStopping
                          ? 'Stopping instance'
                          : 'Stop instance';
                    const launchUsername = (info?.launch_username || '').trim();
                    const launchAccount = launchUsername ? (accountByUsername.get(launchUsername.toLowerCase()) || null) : null;
                    const accountHeadUrl = getAccountHeadUrl(launchAccount);
                    const accountDisplay = launchUsername || 'Unknown';
                    const hasBoundAccount = Boolean(launchUsername);
                    
                    return (
                      <div key={id} className="running-item">
                        <div className="running-item-left">
                          <div className="running-item-logo">
                            {logoMap[id] ? (
                              <img 
                                key={logoMap[id]}
                                src={logoMap[id]} 
                                alt="" 
                                onError={handleLogoImageError}
                              />
                            ) : null}
                            <div 
                              className="logo-fallback"
                              style={{ display: logoMap[id] ? 'none' : 'flex' }}
                            >
                              {instance.name.charAt(0)}
                            </div>
                          </div>
                          <div className="running-item-info">
                            <div className="running-item-name-line">
                              <div className="running-item-name">{instance.name}</div>
                              <span className="running-item-title-version" title={`Minecraft version ${instance.version_id || 'Unknown'}`}>
                                <Tag className="meta-icon" size={12} />
                                {instance.version_id || 'Unknown'}
                              </span>
                            </div>
                            <div className="running-item-time">{formatRuntime(info?.start_time || 0)}</div>
                            <div className={`running-item-account-chip ${hasBoundAccount ? 'is-bound' : 'is-default'}`}>
                              <span className="running-item-account-avatar">
                                {accountHeadUrl ? (
                                  <img
                                    src={accountHeadUrl}
                                    alt={`${accountDisplay} skin`}
                                    onError={() => {
                                      if (launchAccount?.uuid) {
                                        setFailedAccountHeads((prev) => ({ ...prev, [launchAccount.uuid]: true }));
                                      }
                                    }}
                                  />
                                ) : (
                                  <User size={10} />
                                )}
                              </span>
                              <span className="running-item-account-label">Account</span>
                              <span className="running-item-account-value">{accountDisplay}</span>
                            </div>
                          </div>
                        </div>
                        <button 
                          className={`stop-instance-btn ${isStopping ? 'is-stopping' : ''} ${isForceStopping ? 'is-force-stopping' : ''}`}
                          onClick={() => {
                            if (isForceStopping) return;
                            if (canForceStop) {
                              onForceStopInstance?.(id);
                              return;
                            }
                            onStopInstance?.(id);
                          }}
                          disabled={isForceStopping || (isStopping && !canForceStop)}
                          title={stopButtonTitle}
                          aria-label={stopButtonTitle}
                        >
                          {canForceStop || isForceStopping
                            ? <X size={14} />
                            : <Square size={14} fill="currentColor" />}
                        </button>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          )}
        </div>

        <div className="titlebar-v-separator"></div>

        <button className="titlebar-button" onClick={handleMinimize} title="Minimize">
          <Minus size={18} />
        </button>
        <button className="titlebar-button" onClick={handleMaximize} title={isMaximized ? "Restore" : "Maximize"}>
          {isMaximized ? <Minimize2 size={16} /> : <Maximize size={16} />}
        </button>
        <button className="titlebar-button close" onClick={handleClose} title="Close">
          <X size={18} />
        </button>
      </div>
    </div>
  );
}

export default memo(TitleBar);

