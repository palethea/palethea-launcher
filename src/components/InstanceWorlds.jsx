import { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import ConfirmModal from './ConfirmModal';
import WorldDatapacks from './WorldDatapacks';
import './ScreenshotContextMenu.css';

function InstanceWorlds({ instance, onShowNotification }) {
  const [worlds, setWorlds] = useState([]);
  const [loading, setLoading] = useState(true);
  const [deleteConfirm, setDeleteConfirm] = useState({ show: false, world: null });
  const [selectedWorld, setSelectedWorld] = useState(null);
  const [worldContextMenu, setWorldContextMenu] = useState(null);
  const [renameModal, setRenameModal] = useState({ show: false, world: null, newName: '' });

  useEffect(() => {
    loadWorlds();

    const handleClick = () => {
      setWorldContextMenu(null);
    };
    window.addEventListener('click', handleClick);
    return () => window.removeEventListener('click', handleClick);
  }, [instance.id]);

  const loadWorlds = async () => {
    try {
      const w = await invoke('get_instance_worlds', { instanceId: instance.id });
      setWorlds(w);
    } catch (error) {
      console.error('Failed to load worlds:', error);
    }
    setLoading(false);
  };

  const handleOpenFolder = async () => {
    try {
      await invoke('open_instance_folder', {
        instanceId: instance.id,
        folderType: 'saves'
      });
    } catch (error) {
      console.error('Failed to open folder:', error);
      if (onShowNotification) {
        onShowNotification(`Failed to open worlds folder: ${error}`, 'error');
      }
    }
  };

  const handleDeleteWorld = async (world) => {
    setDeleteConfirm({ show: true, world });
  };

  const handleWorldContextMenu = (e, world) => {
    e.preventDefault();
    e.stopPropagation();
    setWorldContextMenu({
      x: e.clientX,
      y: e.clientY,
      world
    });
  };

  const handleOpenWorldFolder = async (world) => {
    try {
      await invoke('open_instance_world_folder', {
        instanceId: instance.id,
        folderName: world.folder_name
      });
    } catch (error) {
      console.error('Failed to open world folder:', error);
      if (onShowNotification) {
        onShowNotification(`Failed to open world folder: ${error}`, 'error');
      }
    }
  };

  const handleOpenDatapacksFolder = async (world) => {
    try {
      await invoke('open_instance_datapacks_folder', {
        instanceId: instance.id,
        worldName: world.folder_name
      });
    } catch (error) {
      console.error('Failed to open datapacks folder:', error);
      if (onShowNotification) {
        onShowNotification(`Failed to open datapacks folder: ${error}`, 'error');
      }
    }
  };

  const handleRenameWorld = async () => {
    const { world, newName } = renameModal;
    if (!newName || newName === world.folder_name) {
      setRenameModal({ show: false, world: null, newName: '' });
      return;
    }

    try {
      await invoke('rename_instance_world', {
        instanceId: instance.id,
        folderName: world.folder_name,
        newName: newName
      });
      await loadWorlds();
      if (onShowNotification) {
        onShowNotification(`Renamed world to ${newName}`, 'success');
      }
    } catch (error) {
      console.error('Failed to rename world:', error);
      if (onShowNotification) {
        onShowNotification(`Failed to rename world: ${error}`, 'error');
      }
    }
    setRenameModal({ show: false, world: null, newName: '' });
  };

  const confirmDelete = async () => {
    const world = deleteConfirm.world;
    setDeleteConfirm({ show: false, world: null });

    try {
      await invoke('delete_instance_world', {
        instanceId: instance.id,
        worldName: world.folder_name
      });
      await loadWorlds();
    } catch (error) {
      console.error('Failed to delete world:', error);
    }
  };

  const formatDate = (timestamp) => {
    if (!timestamp) return 'Unknown';
    return new Date(timestamp).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  const formatSize = (bytes) => {
    if (!bytes) return 'Unknown';
    if (bytes >= 1073741824) return (bytes / 1073741824).toFixed(2) + ' GB';
    if (bytes >= 1048576) return (bytes / 1048576).toFixed(2) + ' MB';
    if (bytes >= 1024) return (bytes / 1024).toFixed(2) + ' KB';
    return bytes + ' B';
  };

  const getGameModeIcon = (gamemode) => {
    switch (gamemode) {
      case 0: return 'Survival';
      case 1: return 'Creative';
      case 2: return 'Adventure';
      case 3: return 'Spectator';
      default: return 'Unknown Mode';
    }
  };

  if (loading) {
    return (
      <div className="worlds-tab">
        <p>Loading worlds...</p>
      </div>
    );
  }

  if (selectedWorld) {
    return (
      <WorldDatapacks
        instance={instance}
        world={selectedWorld}
        onShowNotification={onShowNotification}
        onBack={() => setSelectedWorld(null)}
      />
    );
  }

  return (
    <div className="worlds-tab">
      <div className="console-actions">
        <button className="open-btn" onClick={handleOpenFolder}>
          Open Saves Folder
        </button>
      </div>

      {worlds.length === 0 ? (
        <div className="empty-state">
          <h4>No worlds yet</h4>
          <p>Play the game to create worlds, or add existing worlds to the saves folder.</p>
        </div>
      ) : (
        worlds.map((world) => (
          <div 
            key={world.folder_name} 
            className="world-card"
            onContextMenu={(e) => handleWorldContextMenu(e, world)}
          >
            <div className="world-icon">
              {world.icon ? (
                <img
                  src={`data:image/png;base64,${world.icon}`}
                  alt=""
                  style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: '8px' }}
                />
              ) : (
                <span style={{ color: 'var(--text-secondary)' }}>W</span>
              )}
            </div>
            <div className="world-info">
              <div style={{ display: 'flex', alignItems: 'baseline', gap: '8px' }}>
                <h4>{world.name}</h4>
                {world.name !== world.folder_name && (
                  <span style={{ fontSize: '13px', opacity: 0.5, fontWeight: 'normal' }}>
                    ({world.folder_name})
                  </span>
                )}
              </div>
              <div className="world-meta">
                <span>{getGameModeIcon(world.game_mode)}</span>
                <span>{formatSize(world.size)}</span>
                <span>Last played: {formatDate(world.last_played)}</span>
              </div>
            </div>
            <div className="world-actions" style={{ display: 'flex', gap: '8px' }}>
              <div style={{ display: 'flex' }}>
                <button
                  className="open-btn"
                  onClick={() => setSelectedWorld(world)}
                  style={{ 
                    background: 'rgba(var(--accent-rgb), 0.1)', 
                    color: 'var(--accent)', 
                    border: '1px solid rgba(var(--accent-rgb), 0.2)',
                    borderRight: 'none',
                    borderRadius: '6px 0 0 6px'
                  }}
                >
                  Datapacks
                </button>
                <button
                  className="open-btn"
                  onClick={() => handleOpenDatapacksFolder(world)}
                  title="Open Datapacks Folder"
                  style={{ 
                    background: 'rgba(var(--accent-rgb), 0.1)', 
                    color: 'var(--accent)', 
                    border: '1px solid rgba(var(--accent-rgb), 0.2)',
                    borderRadius: '0 6px 6px 0',
                    padding: '0 8px',
                    display: 'flex',
                    alignItems: 'center'
                  }}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path></svg>
                </button>
              </div>
              <button className="delete-btn" onClick={() => handleDeleteWorld(world)}>
                Delete
              </button>
            </div>
          </div>
        ))
      )}

      <ConfirmModal
        isOpen={deleteConfirm.show}
        title="Delete World"
        message={`Are you sure you want to delete world "${deleteConfirm.world?.name}"? This cannot be undone!`}
        confirmText="Delete"
        cancelText="Cancel"
        variant="danger"
        onConfirm={confirmDelete}
        onCancel={() => setDeleteConfirm({ show: false, world: null })}
      />

      {worldContextMenu && (
        <div
          className="screenshot-context-menu"
          style={{
            left: Math.min(worldContextMenu.x, window.innerWidth - 170),
            top: Math.min(worldContextMenu.y, window.innerHeight - 200)
          }}
          onClick={e => e.stopPropagation()}
        >
          <div style={{ padding: '8px 12px', fontSize: '12px', opacity: 0.5, borderBottom: '1px solid var(--border)', marginBottom: '4px' }}>
            {worldContextMenu.world.name}
          </div>
          <button onClick={() => { setWorldContextMenu(null); setSelectedWorld(worldContextMenu.world); }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"></path><polyline points="3.27 6.96 12 12.01 20.73 6.96"></polyline><line x1="12" y1="22.08" x2="12" y2="12"></line></svg>
            Manage Datapacks
          </button>
          <button onClick={() => { setWorldContextMenu(null); handleOpenDatapacksFolder(worldContextMenu.world); }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path></svg>
            Open Datapacks Folder
          </button>
          <button onClick={() => {
            setWorldContextMenu(null);
            setRenameModal({
              show: true,
              world: worldContextMenu.world,
              newName: worldContextMenu.world.folder_name
            });
          }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9"></path><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path></svg>
            Rename World
          </button>
          <button onClick={() => { setWorldContextMenu(null); handleOpenWorldFolder(worldContextMenu.world); }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path></svg>
            Open Folder
          </button>
          <div className="divider" />
          <button className="danger" onClick={() => { setWorldContextMenu(null); handleDeleteWorld(worldContextMenu.world); }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2-2v2"></path><line x1="10" y1="11" x2="10" y2="17"></line><line x1="14" y1="11" x2="14" y2="17"></line></svg>
            Delete
          </button>
        </div>
      )}

      {renameModal.show && (
        <div className="welcome-overlay" onClick={() => setRenameModal({ show: false, world: null, newName: '' })}>
          <div className="rename-modal" onClick={e => e.stopPropagation()}>
            <h3>Rename World</h3>
            <p style={{ fontSize: '12px', opacity: 0.7, marginBottom: '12px' }}>
              Renaming the folder might affect some external tools or backups.
            </p>
            <input
              type="text"
              value={renameModal.newName}
              onChange={e => setRenameModal(prev => ({ ...prev, newName: e.target.value }))}
              onKeyDown={e => e.key === 'Enter' && handleRenameWorld()}
              autoFocus
            />
            <div className="rename-actions">
              <button className="rename-cancel" onClick={() => setRenameModal({ show: false, world: null, newName: '' })}>Cancel</button>
              <button className="rename-confirm" onClick={handleRenameWorld}>Rename</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default InstanceWorlds;
