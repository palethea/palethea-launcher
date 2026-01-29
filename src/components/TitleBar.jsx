import { useState, useEffect, useCallback, memo, useRef } from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { sep } from '@tauri-apps/api/path';
import { invoke, convertFileSrc } from '@tauri-apps/api/core';
import { X, Minus, Maximize, Minimize2, Terminal, ChevronDown, Square, List, Shirt, BarChart3, RefreshCcw, Wallpaper, Settings, Download, Trash2, Play } from 'lucide-react';
import './TitleBar.css';

function TitleBar({ 
  activeTab, 
  onTabChange, 
  isPopout, 
  launcherSettings, 
  runningInstances = {}, 
  instances = [],
  onStopInstance,
  editingInstanceId = null,
  downloadQueue = [],
  downloadHistory = [],
  onClearDownloadHistory
}) {
  const [isMaximized, setIsMaximized] = useState(false);
  const [showRunningDropdown, setShowRunningDropdown] = useState(false);
  const [showDownloadDropdown, setShowDownloadDropdown] = useState(false);
  const [currentTime, setCurrentTime] = useState(Math.floor(Date.now() / 1000));
  const [isClosing, setIsClosing] = useState(false);
  const [isDownloadClosing, setIsDownloadClosing] = useState(false);
  const [logoMap, setLogoMap] = useState({});
  const dropdownRef = useRef(null);
  const downloadRef = useRef(null);
  const appWindow = getCurrentWindow();

  const runningIds = Object.keys(runningInstances);
  const hasRunning = runningIds.length > 0;
  const hasDownloads = downloadQueue.length > 0;

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

  // Create a stable key that only changes when logos actually change
  const logoKey = instances.map(i => `${i.id}:${i.logo_filename || 'default'}`).join(',');

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
    const timer = setInterval(() => {
      setCurrentTime(Math.floor(Date.now() / 1000));
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    const loadLogos = async () => {
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
          const instance = instances.find(i => i.id === id);
          if (instance) {
            const filename = instance.logo_filename || 'minecraft_logo.png';
            const logoPath = `${logosDir}${s}${filename}`;
            newLogoMap[id] = convertFileSrc(logoPath);
          }
        }
        setLogoMap(newLogoMap);
      } catch (err) {
        console.error("Failed to load titlebar logos:", err);
      }
    };

    if ((hasRunning || editingInstanceId) && instances.length > 0) {
      loadLogos();
    } else if (!hasRunning && !editingInstanceId) {
      setLogoMap({});
    }
  }, [hasRunning, runningIds.join(','), logoKey, editingInstanceId]);

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
        setIsMaximized(maximized);
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

  return (
    <div 
      className="titlebar" 
      onMouseDown={handleMouseDown}
      onDoubleClick={handleMaximize}
    >
      <div className="titlebar-left">
        {/* <img src="/logoPL.png" className="titlebar-logo" alt="" /> */}
        <span className="titlebar-text">Palethea</span>
        
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
        {editingInstance && (
          <div className="titlebar-center-tab titlebar-editing-info">
            <div className="editing-logo">
              {logoMap[editingInstanceId] ? (
                <img src={logoMap[editingInstanceId]} alt="" />
              ) : (
                <div className="editing-logo-fallback">{editingInstance.name.charAt(0)}</div>
              )}
            </div>
            <span>{editingInstance.name}</span>
          </div>
        )}
        {!isPopout && !editingInstance && currentTabInfo && (
          <div className="titlebar-center-tab">
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
              <div className="dropdown-header">Running Instances</div>
              <div className="dropdown-list">
                {runningIds.length === 0 ? (
                  <div className="dropdown-empty">No instances running</div>
                ) : (
                  runningIds.map(id => {
                    const instance = instances.find(i => i.id === id);
                    if (!instance) return null;
                    const info = runningInstances[id];
                    
                    return (
                      <div key={id} className="running-item">
                        <div className="running-item-left">
                          <div className="running-item-logo">
                            {logoMap[id] ? (
                              <img 
                                src={logoMap[id]} 
                                alt="" 
                                onError={(e) => {
                                  e.target.style.display = 'none';
                                  e.target.nextSibling.style.display = 'flex';
                                }}
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
                            <div className="running-item-name">{instance.name}</div>
                            <div className="running-item-time">{formatRuntime(info?.start_time || 0)}</div>
                          </div>
                        </div>
                        <button 
                          className="stop-instance-btn"
                          onClick={() => onStopInstance(id)}
                          title="Force Stop"
                        >
                          <Square size={14} fill="currentColor" />
                        </button>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          )}
        </div>

        <div className="download-queue-container" ref={downloadRef}>
          <button 
            className={`download-queue-btn ${showDownloadDropdown ? 'active' : ''}`}
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
                      <div key={`active-${item.id || index}`} className="running-item">
                        <div className="running-item-left">
                          <div className="running-item-logo">
                            {item.icon ? (
                              <img src={item.icon} alt="" referrerPolicy="no-referrer" />
                            ) : (
                              <div className="logo-fallback">📦</div>
                            )}
                          </div>
                          <div className="running-item-info">
                            <div className="running-item-name">{item.name}</div>
                            <div className="running-item-time">{item.status || 'Pending...'}</div>
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
                            {item.icon ? (
                              <img src={item.icon} alt="" referrerPolicy="no-referrer" style={{ opacity: 0.6 }} />
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
