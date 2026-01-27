import { useState, useEffect, useCallback, memo, useRef } from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { sep } from '@tauri-apps/api/path';
import { invoke, convertFileSrc } from '@tauri-apps/api/core';
import { X, Minus, Maximize, Minimize2, Terminal, ChevronDown, Square } from 'lucide-react';
import './TitleBar.css';

function TitleBar({ 
  activeTab, 
  onTabChange, 
  isPopout, 
  launcherSettings, 
  runningInstances = {}, 
  instances = [],
  onStopInstance
}) {
  const [isMaximized, setIsMaximized] = useState(false);
  const [showRunningDropdown, setShowRunningDropdown] = useState(false);
  const [currentTime, setCurrentTime] = useState(Math.floor(Date.now() / 1000));
  const [isClosing, setIsClosing] = useState(false);
  const [logoMap, setLogoMap] = useState({});
  const dropdownRef = useRef(null);
  const appWindow = getCurrentWindow();

  const runningIds = Object.keys(runningInstances);
  const hasRunning = runningIds.length > 0;

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

        for (const id of runningIds) {
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

    if (hasRunning && instances.length > 0) {
      loadLogos();
    } else if (!hasRunning) {
      setLogoMap({});
    }
  }, [hasRunning, runningIds.join(','), logoKey]);

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
        if (showRunningDropdown && !isClosing) {
          toggleDropdown();
        }
      }
    };

    if (showRunningDropdown) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [showRunningDropdown, isClosing]);

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
        {hasRunning && !isPopout && (
          <div className="running-instances-container" ref={dropdownRef}>
            <button 
              className={`running-instances-pill ${showRunningDropdown ? 'active' : ''}`}
              onClick={toggleDropdown}
            >
              <div className="pulse-dot"></div>
              <span>{runningIds.length} {runningIds.length === 1 ? 'instance' : 'instances'} running</span>
              <ChevronDown size={14} className={`chevron ${showRunningDropdown && !isClosing ? 'inverted' : ''}`} />
            </button>

            {showRunningDropdown && (
              <div className={`running-dropdown ${isClosing ? 'closing' : ''}`}>
                <div className="dropdown-header">Running Instances</div>
                <div className="dropdown-list">
                  {runningIds.map(id => {
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
                  })}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
      
      <div className="titlebar-right">
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
