import { useState, useEffect, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { ArrowLeft, Play, Box, Cpu, FolderOpen, Square, X, ExternalLink } from 'lucide-react';
import './InstanceEditor.css';
import InstanceSettings from './InstanceSettings';
import InstanceMods from './InstanceMods';
import InstanceResources from './InstanceResources';
import InstanceWorlds from './InstanceWorlds';
import InstanceServers from './InstanceServers';
import InstanceScreenshots from './InstanceScreenshots';
import InstanceConsole from './InstanceConsole';
import ConfirmModal from './ConfirmModal';

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
  skinRefreshKey = 0
}) {
  const [instance, setInstance] = useState(null);
  const [activeTab, setActiveTab] = useState('settings');
  const [loading, setLoading] = useState(true);
  const [confirmModal, setConfirmModal] = useState(null);
  const [launching, setLaunching] = useState(false);
  const [scrolled, setScrolled] = useState(false);

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

  const handleLaunch = async () => {
    if (isRunning) {
      if (onStop) await onStop(instanceId);
      return;
    }

    if (onLaunch && instance) {
      setLaunching(true);
      setConsoleClearKey(prev => prev + 1); // Trigger console clear
      setActiveTab('console');
      await onLaunch(instance.id);
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
    { id: 'settings', label: 'Settings' },
    { id: 'console', label: 'Console' },
    { id: 'mods', label: 'Mods' },
    { id: 'resources', label: 'Resources' },
    { id: 'worlds', label: 'Worlds' },
    { id: 'servers', label: 'Servers' },
    { id: 'screenshots', label: 'Screenshots' },
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
          isScrolled={scrolled}
          onQueueDownload={onQueueDownload}
          onDequeueDownload={onDequeueDownload}
          onUpdateDownloadStatus={onUpdateDownloadStatus}
        />;
      case 'servers':
        return <InstanceServers instance={instance} onShowNotification={onShowNotification} isScrolled={scrolled} />;
      case 'screenshots':
        return <InstanceScreenshots instance={instance} onShowNotification={onShowNotification} isScrolled={scrolled} />;
      default:
        return null;
    }
  };

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
          <button className={`back-btn icon-only ${isPopout ? 'popout-close-btn' : ''}`} onClick={onClose} title={isPopout ? 'Close' : 'Back'}>
            {isPopout ? <X size={18} /> : <ArrowLeft size={18} />}
          </button>
          <button className="folder-btn icon-only" onClick={handleOpenFolder} title="Open Instance Folder">
            <FolderOpen size={18} />
          </button>
          {!isPopout && onPopout && (
            <button className="popout-btn icon-only" onClick={onPopout} title="Open in Pop-out Window">
              <ExternalLink size={18} />
            </button>
          )}
        </div>

        <div className="header-separator" />

        <div className="header-title-container">
          <div className="info-row">
            <span className="info-badge version-badge">
              <Box size={12} />
              {instance.version_id}
            </span>
            {instance.mod_loader && instance.mod_loader !== 'Vanilla' && (
              <span className={`info-badge loader-badge ${(instance.mod_loader || '').toLowerCase()}`}>
                <Cpu size={12} />
                {instance.mod_loader}
              </span>
            )}
          </div>
        </div>
        <div className="header-right">
          <button
            className={`launch-btn-large ${isRunning ? 'stop-mode' : ''}`}
            onClick={handleLaunch}
            disabled={launching}
          >
            {launching ? (
              'Launching...'
            ) : isRunning ? (
              <>
                <Square size={18} fill="currentColor" />
                <span>Stop</span>
              </>
            ) : (
              <>
                <Play size={18} fill="currentColor" />
                <span>Launch</span>
              </>
            )}
          </button>
        </div>
      </div>

      <div className="editor-tabs">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            className={`tab-btn ${activeTab === tab.id ? 'active' : ''}`}
            onClick={() => setActiveTab(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div className="editor-content" onScroll={handleScroll}>
        {renderTabContent()}
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
