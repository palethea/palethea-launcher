import { useState, useEffect, useCallback, useLayoutEffect, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import {
  ArrowLeft, Play, FolderOpen, Square, X, ExternalLink, User, Server, Tag, Boxes,
  Cog, SquareTerminal, Puzzle, Archive, Earth, Image as ImageIcon
} from 'lucide-react';
import './InstanceEditor.css';
import InstanceSettings from './InstanceSettings';
import InstanceMods from './InstanceMods';
import InstanceResources from './InstanceResources';
import InstanceWorlds from './InstanceWorlds';
import InstanceServers from './InstanceServers';
import InstanceScreenshots from './InstanceScreenshots';
import InstanceConsole from './InstanceConsole';
import ConfirmModal from './ConfirmModal';

const PREFERRED_SERVER_STORAGE_KEY = 'instance-preferred-server-map';

function getPreferredServerAddress(instanceId) {
  try {
    const stored = localStorage.getItem(PREFERRED_SERVER_STORAGE_KEY);
    const parsedMap = stored ? JSON.parse(stored) || {} : {};
    const savedValue = parsedMap?.[instanceId];
    const serverAddress = typeof savedValue === 'string'
      ? savedValue
      : (savedValue?.address || '');
    return serverAddress.trim() || null;
  } catch (error) {
    console.error('Failed to parse preferred server map in instance editor:', error);
    return null;
  }
}

function getPreferredServerSelection(instanceId) {
  try {
    const stored = localStorage.getItem(PREFERRED_SERVER_STORAGE_KEY);
    const parsedMap = stored ? JSON.parse(stored) || {} : {};
    const savedValue = parsedMap?.[instanceId];
    const address = typeof savedValue === 'string'
      ? savedValue.trim()
      : (typeof savedValue?.address === 'string' ? savedValue.address.trim() : '');
    const name = typeof savedValue?.name === 'string'
      ? savedValue.name.trim()
      : '';
    const icon = typeof savedValue?.icon === 'string'
      ? savedValue.icon.trim()
      : '';

    return {
      address: address || null,
      name: name || null,
      icon: icon || null
    };
  } catch (error) {
    console.error('Failed to parse preferred server selection in instance editor:', error);
    return { address: null, name: null, icon: null };
  }
}

function InstanceEditor({
  instanceId,
  onClose,
  onUpdate,
  onLaunch,
  onStop,
  runningInstances,
  onDelete,
  onShowNotification,
  onPopout,
  onQueueDownload,
  onDequeueDownload,
  onUpdateDownloadStatus,
  skinCache = {},
  skinRefreshKey = 0,
  launcherSettings = null
}) {
  const [instance, setInstance] = useState(null);
  const [activeTab, setActiveTab] = useState('settings');
  const [loading, setLoading] = useState(true);
  const [confirmModal, setConfirmModal] = useState(null);
  const [launching, setLaunching] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const [savedAccounts, setSavedAccounts] = useState([]);
  const [preferredAccountSkinFailed, setPreferredAccountSkinFailed] = useState(false);
  const [tabIndicatorStyle, setTabIndicatorStyle] = useState({ left: 0, width: 0, visible: false });
  const tabsContainerRef = useRef(null);
  const tabButtonRefs = useRef({});
  const indicatorRafRef = useRef(null);

  // Check if we are in popout mode
  const isPopout = new URLSearchParams(window.location.search).get('popout') === 'editor';

  // ----------
  // Console clear key
  // Description: Increments when launching to tell console to clear old logs immediately
  // ----------
  const [consoleClearKey, setConsoleClearKey] = useState(0);

  const isRunning = !!(runningInstances && runningInstances[instanceId]);

  const loadInstance = useCallback(async () => {
    try {
      const result = await invoke('get_instance_details', { instanceId });
      setInstance(result);
    } catch (error) {
      console.error('Failed to load instance:', error);
    }
    setLoading(false);
  }, [instanceId]);

  useEffect(() => {
    loadInstance();
  }, [loadInstance]);

  useEffect(() => {
    let mounted = true;
    invoke('get_saved_accounts')
      .then((result) => {
        if (!mounted) return;
        const accounts = Array.isArray(result)
          ? result
          : (Array.isArray(result?.accounts) ? result.accounts : []);
        setSavedAccounts(accounts);
      })
      .catch((error) => {
        console.error('Failed to load saved accounts for editor header:', error);
      });

    return () => {
      mounted = false;
    };
  }, [instanceId]);

  useEffect(() => {
    const unlisten = listen('refresh-instances', () => {
      loadInstance();
    });

    return () => {
      unlisten.then(fn => fn());
    };
  }, [loadInstance]);

  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        // If there's a modal open, let it handle escape (it usually does by unmounting)
        // Otherwise close the editor
        if (!confirmModal && onClose) {
          onClose();
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose, confirmModal]);

  useEffect(() => {
    setScrolled(false);
  }, [activeTab]);

  const updateMainTabIndicator = useCallback(() => {
    const container = tabsContainerRef.current;
    const activeButton = tabButtonRefs.current[activeTab];
    const indicatorHorizontalPadding = 6;

    if (!container || !activeButton) {
      setTabIndicatorStyle((prev) => ({ ...prev, visible: false }));
      return false;
    }

    const containerRect = container.getBoundingClientRect();
    const activeLabel = activeButton.querySelector('.tab-btn-label');
    const targetRect = activeLabel
      ? activeLabel.getBoundingClientRect()
      : activeButton.getBoundingClientRect();

    if (!targetRect.width || !containerRect.width) {
      setTabIndicatorStyle((prev) => ({ ...prev, visible: false }));
      return false;
    }

    setTabIndicatorStyle({
      left: targetRect.left - containerRect.left - indicatorHorizontalPadding,
      width: targetRect.width + indicatorHorizontalPadding * 2,
      visible: true
    });
    return true;
  }, [activeTab]);

  const scheduleMainTabIndicatorUpdate = useCallback((maxRetries = 10) => {
    if (indicatorRafRef.current) {
      cancelAnimationFrame(indicatorRafRef.current);
      indicatorRafRef.current = null;
    }

    const tick = (remainingRetries) => {
      const resolved = updateMainTabIndicator();
      if (resolved || remainingRetries <= 0) {
        indicatorRafRef.current = null;
        return;
      }
      indicatorRafRef.current = requestAnimationFrame(() => tick(remainingRetries - 1));
    };

    indicatorRafRef.current = requestAnimationFrame(() => tick(maxRetries));
  }, [updateMainTabIndicator]);

  useLayoutEffect(() => {
    updateMainTabIndicator();
    scheduleMainTabIndicatorUpdate(12);

    window.addEventListener('resize', updateMainTabIndicator);
    if (document?.fonts?.ready) {
      document.fonts.ready.then(() => {
        scheduleMainTabIndicatorUpdate(6);
      }).catch(() => {});
    }

    return () => {
      window.removeEventListener('resize', updateMainTabIndicator);
      if (indicatorRafRef.current) {
        cancelAnimationFrame(indicatorRafRef.current);
        indicatorRafRef.current = null;
      }
    };
  }, [updateMainTabIndicator, scheduleMainTabIndicatorUpdate]);

  const handleScroll = (e) => {
    setScrolled(e.target.scrollTop > 10);
  };

  const handleSave = async (updatedInstance) => {
    try {
      await invoke('update_instance', { instance: updatedInstance });
      setInstance(updatedInstance);
      if (onUpdate) onUpdate();
      return true;
    } catch (error) {
      console.error('Failed to update instance:', error);
      if (onShowNotification) {
        onShowNotification(`Failed to update instance: ${error}`, 'error');
      }
      return false;
    }
  };

  const handleInstanceUpdated = (updatedInstance) => {
    setInstance(updatedInstance);
    if (onUpdate) onUpdate();
  };

  const handleShowConfirm = (config) => {
    setConfirmModal(config);
  };

  const handleLaunch = async (serverAddress = null) => {
    if (isRunning) {
      if (onStop) await onStop(instanceId);
      return;
    }

    if (onLaunch && instance) {
      const normalizedServerAddress = typeof serverAddress === 'string'
        ? serverAddress.trim()
        : '';
      const resolvedServerAddress = normalizedServerAddress || getPreferredServerAddress(instance.id);
      setLaunching(true);
      setConsoleClearKey(prev => prev + 1); // Trigger console clear
      setActiveTab('console');
      await onLaunch(instance.id, { serverAddress: resolvedServerAddress });
      setLaunching(false);
    }
  };

  const handleOpenFolder = async () => {
    try {
      await invoke('open_instance_folder', { instanceId, folderType: 'root' });
    } catch (error) {
      console.error('Failed to open instance folder:', error);
      if (onShowNotification) {
        onShowNotification(`Failed to open folder: ${error}`, 'error');
      }
    }
  };

  const tabs = [
    { id: 'settings', label: 'Settings', icon: Cog },
    { id: 'console', label: 'Console', icon: SquareTerminal },
    { id: 'mods', label: 'Mods', icon: Puzzle },
    { id: 'resources', label: 'Resources', icon: Archive },
    { id: 'worlds', label: 'Worlds', icon: Earth },
    { id: 'servers', label: 'Servers', icon: Server },
    { id: 'screenshots', label: 'Screenshots', icon: ImageIcon },
  ];

  const renderTabContent = () => {
    if (!instance) return null;

    switch (activeTab) {
      case 'settings':
        return (
          <InstanceSettings
            instance={instance}
            onSave={handleSave}
            onInstanceUpdated={handleInstanceUpdated}
            onShowConfirm={handleShowConfirm}
            onDelete={onDelete}
            onShowNotification={onShowNotification}
            isScrolled={scrolled}
            skinCache={skinCache}
            skinRefreshKey={skinRefreshKey}
          />
        );
      case 'console':
        return <InstanceConsole instance={instance} onInstanceUpdated={setInstance} onShowNotification={onShowNotification} clearOnMount={consoleClearKey} isScrolled={scrolled} />;
      case 'mods':
        return <InstanceMods
          instance={instance}
          onShowConfirm={handleShowConfirm}
          onShowNotification={onShowNotification}
          isScrolled={scrolled}
          onQueueDownload={onQueueDownload}
          onDequeueDownload={onDequeueDownload}
          onUpdateDownloadStatus={onUpdateDownloadStatus}
        />;
      case 'resources':
        return <InstanceResources
          instance={instance}
          onShowConfirm={handleShowConfirm}
          onShowNotification={onShowNotification}
          isScrolled={scrolled}
          onQueueDownload={onQueueDownload}
          onDequeueDownload={onDequeueDownload}
          onUpdateDownloadStatus={onUpdateDownloadStatus}
        />;
      case 'worlds':
        return <InstanceWorlds
          instance={instance}
          onShowNotification={onShowNotification}
          onShowConfirm={handleShowConfirm}
          isScrolled={scrolled}
          onQueueDownload={onQueueDownload}
          onDequeueDownload={onDequeueDownload}
          onUpdateDownloadStatus={onUpdateDownloadStatus}
        />;
      case 'servers':
        return <InstanceServers instance={instance} onShowNotification={onShowNotification} isScrolled={scrolled} onLaunchInstance={handleLaunch} />;
      case 'screenshots':
        return <InstanceScreenshots instance={instance} onShowNotification={onShowNotification} isScrolled={scrolled} />;
      default:
        return null;
    }
  };

  const preferredAccount = (instance?.preferred_account || '').trim();
  const preferredAccountNormalized = preferredAccount.toLowerCase();
  const rawLoader = (instance?.mod_loader || '').trim();
  const loaderLabel = rawLoader ? (rawLoader.toLowerCase() === 'vanilla' ? 'Vanilla' : rawLoader) : 'Vanilla';
  const loaderClass = loaderLabel.toLowerCase().replace(/\s+/g, '-');
  const preferredServer = getPreferredServerSelection(instance?.id || instanceId);
  const preferredAccountData = preferredAccount
    ? savedAccounts.find((account) => (account?.username || '').trim().toLowerCase() === preferredAccountNormalized) || null
    : null;
  const preferredAccountUuid = preferredAccountData?.uuid || null;
  const preferredAccountSkinUrl = preferredAccountUuid
    ? `https://minotar.net/helm/${preferredAccountUuid.replace(/-/g, '')}/64.png?t=${skinRefreshKey}`
    : null;
  const preferredServerSummary = preferredServer.address
    ? (preferredServer.name && preferredServer.name !== preferredServer.address
      ? `${preferredServer.name} (${preferredServer.address})`
      : preferredServer.address)
    : 'No auto-join server';
  const showMainTabIcons = launcherSettings?.show_instance_editor_tab_icons === true;
  const preferredServerIconSrc = preferredServer.icon
    ? (preferredServer.icon.startsWith('data:')
      ? preferredServer.icon
      : `data:image/png;base64,${preferredServer.icon}`)
    : null;

  useEffect(() => {
    setPreferredAccountSkinFailed(false);
  }, [preferredAccountSkinUrl, preferredAccount]);

  useEffect(() => {
    if (!instance?.id || !preferredServer.address || preferredServer.icon) return;

    let cancelled = false;

    const hydratePreferredServerIcon = async () => {
      try {
        const servers = await invoke('get_instance_servers', { instanceId: instance.id });
        if (cancelled || !Array.isArray(servers)) return;

        const normalizedAddress = preferredServer.address.trim();
        const match = servers.find(
          (server) => (server?.ip || '').trim() === normalizedAddress
            && typeof server?.icon === 'string'
            && server.icon.trim().length > 0
        );

        if (!match) return;

        let parsedMap = {};
        try {
          const raw = localStorage.getItem(PREFERRED_SERVER_STORAGE_KEY);
          parsedMap = raw ? JSON.parse(raw) || {} : {};
        } catch (error) {
          console.error('Failed to parse preferred server map while hydrating icon:', error);
        }

        const current = parsedMap?.[instance.id];
        parsedMap[instance.id] = {
          address: normalizedAddress,
          name: (
            (typeof current?.name === 'string' && current.name.trim())
            || (typeof match?.name === 'string' && match.name.trim())
            || normalizedAddress
          ),
          icon: match.icon.trim()
        };

        localStorage.setItem(PREFERRED_SERVER_STORAGE_KEY, JSON.stringify(parsedMap));

        if (!cancelled) {
          setInstance((prev) => (prev ? { ...prev } : prev));
        }
      } catch (error) {
        console.error('Failed to hydrate preferred server icon in editor header:', error);
      }
    };

    void hydratePreferredServerIcon();

    return () => {
      cancelled = true;
    };
  }, [instance?.id, preferredServer.address, preferredServer.icon]);

  if (loading) {
    return (
      <div className="instance-editor">
        <div className="editor-loading">Loading...</div>
      </div>
    );
  }

  if (!instance) {
    return (
      <div className="instance-editor">
        <div className="editor-error">Instance not found</div>
      </div>
    );
  }

  return (
    <div className="instance-editor">
      <div className="editor-header">
        <div className="header-left">
          <button
            className={`header-icon-btn back-btn icon-only ${isPopout ? 'popout-close-btn' : ''}`}
            onClick={onClose}
            title={isPopout ? 'Close' : 'Back'}
            aria-label={isPopout ? 'Close editor' : 'Back to instance list'}
          >
            {isPopout ? <X size={18} /> : <ArrowLeft size={18} />}
          </button>
          <button
            className="header-icon-btn folder-btn icon-only"
            onClick={handleOpenFolder}
            title="Open Instance Folder"
            aria-label="Open instance folder"
          >
            <FolderOpen size={18} />
          </button>
          {!isPopout && onPopout && (
            <button
              className="header-icon-btn popout-btn icon-only"
              onClick={onPopout}
              title="Open in Pop-out Window"
              aria-label="Open in popout window"
            >
              <ExternalLink size={18} />
            </button>
          )}
        </div>

        <div className="header-title-container">
          <div className="title-row">
            <h1>{instance.name}</h1>
            <div className="editor-title-meta">
              <span className="editor-title-version" title={`Minecraft version ${instance.version_id}`}>
                <Tag className="meta-icon" size={12} />
                {instance.version_id}
              </span>
              <span className={`editor-loader-inline ${loaderClass}`} title={`Mod loader ${loaderLabel}`}>
                <Boxes className="meta-icon" size={12} />
                {loaderLabel}
              </span>
            </div>
          </div>
          <div className="launch-pref-row">
            <span className={`launch-pref-chip ${preferredAccount ? 'is-bound' : 'is-default'}`}>
              <span className="launch-pref-account-avatar">
                {preferredAccount && preferredAccountSkinUrl && !preferredAccountSkinFailed ? (
                  <img
                    src={preferredAccountSkinUrl}
                    alt={`${preferredAccount} skin`}
                    onError={() => setPreferredAccountSkinFailed(true)}
                  />
                ) : (
                  <User size={12} />
                )}
              </span>
              <span className="launch-pref-label">Account</span>
              <span className="launch-pref-value">{preferredAccount || 'Active account'}</span>
            </span>
            <span className={`launch-pref-chip ${preferredServer.address ? 'is-bound' : 'is-default'}`}>
              <span className="launch-pref-server-avatar">
                {preferredServerIconSrc ? (
                  <img src={preferredServerIconSrc} alt="" />
                ) : (
                  <Server size={12} />
                )}
              </span>
              <span className="launch-pref-label">Auto-join</span>
              <span className="launch-pref-value">{preferredServerSummary}</span>
            </span>
          </div>
        </div>
        <div className="header-right">
          <button
            className={`instance-list-play-btn editor-launch-btn ${isRunning ? 'is-running' : ''} ${launching && !isRunning ? 'is-launching' : ''}`}
            onClick={handleLaunch}
            disabled={launching}
            title={isRunning ? 'Stop instance' : (launching ? 'Launching instance' : 'Launch instance')}
            aria-label={isRunning ? 'Stop instance' : (launching ? 'Launching instance' : 'Launch instance')}
          >
            {launching ? (
              <>
                <Play size={15} />
                <span>Launching...</span>
              </>
            ) : isRunning ? (
              <>
                <Square size={15} fill="currentColor" />
                <span>Stop</span>
              </>
            ) : (
              <>
                <Play size={15} fill="currentColor" />
                <span>Launch</span>
              </>
            )}
          </button>
        </div>
      </div>

      <div className="editor-tabs" ref={tabsContainerRef}>
        {tabs.map((tab, index) => {
          const TabIcon = tab.icon;
          return (
            <button
              key={tab.id}
              ref={(el) => {
                if (el) {
                  tabButtonRefs.current[tab.id] = el;
                  if (tab.id === activeTab) {
                    scheduleMainTabIndicatorUpdate(8);
                  }
                }
              }}
              className={`tab-btn ${activeTab === tab.id ? 'active' : ''}`}
              style={{ '--tab-enter-index': index }}
              onClick={() => setActiveTab(tab.id)}
            >
              <span className="tab-btn-content">
                {showMainTabIcons && (
                  <span className="tab-btn-icon" aria-hidden="true">
                    <TabIcon size={14} />
                  </span>
                )}
                <span className="tab-btn-label">{tab.label}</span>
              </span>
            </button>
          );
        })}
        <div
          className="main-tab-indicator"
          style={{
            transform: `translateX(${tabIndicatorStyle.left}px)`,
            width: `${tabIndicatorStyle.width}px`,
            opacity: tabIndicatorStyle.visible ? 1 : 0
          }}
        />
      </div>

      <div className={`editor-content ${activeTab === 'console' ? 'console-active' : ''} ${activeTab === 'settings' ? 'settings-active' : ''} ${['mods', 'resources', 'worlds'].includes(activeTab) ? 'has-subtabs' : ''}`} onScroll={handleScroll}>
        <div key={activeTab} className={`editor-tab-panel ${activeTab === 'console' ? 'console-panel' : ''}`}>
          {renderTabContent()}
        </div>
      </div>

      {confirmModal && (
        <ConfirmModal
          title={confirmModal.title}
          message={confirmModal.message}
          confirmText={confirmModal.confirmText}
          cancelText={confirmModal.cancelText}
          extraConfirmText={confirmModal.extraConfirmText}
          variant={confirmModal.variant}
          onConfirm={() => {
            setConfirmModal(null);
            confirmModal.onConfirm();
          }}
          onCancel={confirmModal.cancelText === null ? null : () => {
            setConfirmModal(null);
            if (confirmModal.onCancel) confirmModal.onCancel();
          }}
          onExtraConfirm={() => {
            setConfirmModal(null);
            if (confirmModal.onExtraConfirm) confirmModal.onExtraConfirm();
          }}
        />
      )}
    </div>
  );
}

export default InstanceEditor;
