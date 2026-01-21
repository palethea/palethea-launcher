import { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { ArrowLeft, Play, Box, Cpu, FolderOpen, Square } from 'lucide-react';
import './InstanceEditor.css';
import InstanceSettings from './InstanceSettings';
import InstanceMods from './InstanceMods';
import InstanceResources from './InstanceResources';
import InstanceWorlds from './InstanceWorlds';
import InstanceServers from './InstanceServers';
import InstanceScreenshots from './InstanceScreenshots';
import InstanceConsole from './InstanceConsole';
import ConfirmModal from './ConfirmModal';

function InstanceEditor({ instanceId, onClose, onUpdate, onLaunch, onStop, runningInstances, onDelete }) {
  const [instance, setInstance] = useState(null);
  const [activeTab, setActiveTab] = useState('settings');
  const [loading, setLoading] = useState(true);
  const [confirmModal, setConfirmModal] = useState(null);
  const [launching, setLaunching] = useState(false);

  const isRunning = (runningInstances || []).includes(instanceId);

  useEffect(() => {
    loadInstance();
  }, [instanceId]);

  const loadInstance = async () => {
    try {
      const result = await invoke('get_instance_details', { instanceId });
      setInstance(result);
    } catch (error) {
      console.error('Failed to load instance:', error);
    }
    setLoading(false);
  };

  const handleSave = async (updatedInstance) => {
    try {
      await invoke('update_instance', { instance: updatedInstance });
      setInstance(updatedInstance);
      if (onUpdate) onUpdate();
    } catch (error) {
      console.error('Failed to update instance:', error);
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
          />
        );
      case 'console':
        return <InstanceConsole instance={instance} onInstanceUpdated={setInstance} />;
      case 'mods':
        return <InstanceMods instance={instance} onShowConfirm={handleShowConfirm} />;
      case 'resources':
        return <InstanceResources instance={instance} />;
      case 'worlds':
        return <InstanceWorlds instance={instance} />;
      case 'servers':
        return <InstanceServers instance={instance} />;
      case 'screenshots':
        return <InstanceScreenshots instance={instance} />;
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
          <button className="back-btn" onClick={onClose}>
            <ArrowLeft size={18} />
            <span>Back</span>
          </button>
          <button className="folder-btn" onClick={handleOpenFolder} title="Open Instance Folder">
            <FolderOpen size={18} />
            <span>Files</span>
          </button>
        </div>
        <div className="header-title-container">
          <div className="title-row">
            <h1>{instance.name}</h1>
          </div>
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

      <div className="editor-content">
        {renderTabContent()}
      </div>

      {confirmModal && (
        <ConfirmModal
          title={confirmModal.title}
          message={confirmModal.message}
          confirmText={confirmModal.confirmText}
          cancelText={confirmModal.cancelText}
          variant={confirmModal.variant}
          onConfirm={() => {
            setConfirmModal(null);
            confirmModal.onConfirm();
          }}
          onCancel={confirmModal.cancelText === null ? null : () => {
            setConfirmModal(null);
            if (confirmModal.onCancel) confirmModal.onCancel();
          }}
        />
      )}
    </div>
  );
}

export default InstanceEditor;
