import { useState, useEffect, useCallback, memo } from 'react';
import { invoke } from '@tauri-apps/api/core';
import ConfirmModal from './ConfirmModal';
import './ContextMenu.css';

// Helper for parsing Minecraft formatting codes
const parseMinecraftColors = (text) => {
  if (!text) return null;

  const colorMap = {
    '0': 'mc-0', '1': 'mc-1', '2': 'mc-2', '3': 'mc-3', 
    '4': 'mc-4', '5': 'mc-5', '6': 'mc-6', '7': 'mc-7',
    '8': 'mc-8', '9': 'mc-9', 'a': 'mc-a', 'b': 'mc-b', 
    'c': 'mc-c', 'd': 'mc-d', 'e': 'mc-e', 'f': 'mc-f'
  };
  
  const formatMap = {
    'l': 'mc-bold',
    'm': 'mc-strikethrough',
    'n': 'mc-underline',
    'o': 'mc-italic',
    'k': 'mc-obfuscated'
  };

  const lines = text.split(/\r?\n/);

  return lines.map((line, lineIdx) => {
    if (!line && lineIdx === lines.length - 1) return null;
    
    let currentColorClass = '';
    let currentFormatClasses = [];
    
    // Minecraft uses § as the formatting character
    const parts = line.split(/§([0-9a-fk-or])/g);
    
    const elements = parts.map((part, i) => {
      if (i % 2 === 1) {
        const code = part.toLowerCase();
        if (colorMap[code]) {
          currentColorClass = colorMap[code];
          currentFormatClasses = []; // Colors reset formatting
        } else if (formatMap[code]) {
          if (!currentFormatClasses.includes(formatMap[code])) {
            currentFormatClasses.push(formatMap[code]);
          }
        } else if (code === 'r') {
          currentColorClass = '';
          currentFormatClasses = [];
        }
        return null;
      } else {
        if (!part) return null;
        return (
          <span key={i} className={`${currentColorClass} ${currentFormatClasses.join(' ')}`}>
            {part}
          </span>
        );
      }
    }).filter(Boolean);

    return (
      <div key={lineIdx} className="motd-line">
        {elements.length > 0 ? elements : <br />}
      </div>
    );
  }).filter(Boolean);
};



const stripMinecraftCodes = (text) => text?.replace(/§[0-9a-fk-or]/g, '') || '';

function InstanceServers({ instance, onShowNotification, isScrolled }) {
  const [servers, setServers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [pingData, setPingData] = useState({});
  const [showAddModal, setShowAddModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [editingIndex, setEditingIndex] = useState(null);
  const [deleteIndex, setDeleteIndex] = useState(null);
  const [deleteServerName, setDeleteServerName] = useState('');
  const [newServerName, setNewServerName] = useState('');
  const [newServerIp, setNewServerIp] = useState('');
  const [editServerName, setEditServerName] = useState('');
  const [editServerIp, setEditServerIp] = useState('');
  const [editResourcePacks, setEditResourcePacks] = useState(0);
  const [previewPing, setPreviewPing] = useState(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState(null);
  const [contextMenu, setContextMenu] = useState(null);

  const loadServers = useCallback(async () => {
    try {
      const s = await invoke('get_instance_servers', { instanceId: instance.id });
      setServers(s);
    } catch (error) {
      console.error('Failed to load servers:', error);
    }
    setLoading(false);
  }, [instance.id]);

  useEffect(() => {
    loadServers();
  }, [loadServers]);

  useEffect(() => {
    const handleClickOutside = () => setContextMenu(null);
    window.addEventListener('click', handleClickOutside);
    return () => window.removeEventListener('click', handleClickOutside);
  }, []);

  useEffect(() => {
    let timeout;
    if (showAddModal && newServerIp.includes('.')) {
      setPreviewLoading(true);
      setPreviewError(null);
      timeout = setTimeout(async () => {
        try {
          const result = await invoke('ping_server', { address: newServerIp });
          setPreviewPing(result);
        } catch (error) {
          setPreviewPing(null);
          setPreviewError(error);
        }
        setPreviewLoading(false);
      }, 800);
    } else {
      setPreviewPing(null);
      setPreviewLoading(false);
      setPreviewError(null);
    }
    return () => clearTimeout(timeout);
  }, [newServerIp, showAddModal]);

  const handleAddServer = async () => {
    if (!newServerName || !newServerIp) return;
    
    try {
      await invoke('add_instance_server', { 
        instanceId: instance.id, 
        name: newServerName, 
        ip: newServerIp,
        icon: previewPing?.favicon || null
      });
      setNewServerName('');
      setNewServerIp('');
      setPreviewPing(null);
      setShowAddModal(false);
      loadServers();
      if (onShowNotification) {
        onShowNotification('Server added successfully', 'success');
      }
    } catch (error) {
      console.error('Failed to add server:', error);
      if (onShowNotification) {
        onShowNotification(`Failed to add server: ${error}`, 'error');
      }
    }
  };

  const handleContextMenu = (e, server, index) => {
    e.preventDefault();
    setContextMenu({
      x: e.pageX,
      y: e.pageY,
      server,
      index
    });
  };

  const openDeleteModal = (server, index) => {
    setDeleteIndex(index);
    setDeleteServerName(server.name);
    setShowDeleteModal(true);
    setContextMenu(null);
  };

  const handleDeleteServer = async () => {
    try {
      await invoke('delete_instance_server', { instanceId: instance.id, index: deleteIndex });
      loadServers();
      setShowDeleteModal(false);
      onShowNotification('Server removed', 'success');
    } catch (error) {
      onShowNotification(`Failed to remove: ${error}`, 'error');
    }
  };

  const openEditModal = (server, index) => {
    setEditingIndex(index);
    setEditServerName(server.name);
    setEditServerIp(server.ip);
    setEditResourcePacks(server.accept_textures || 0);
    setShowEditModal(true);
    setContextMenu(null);
  };

  const handleUpdateServer = async () => {
    try {
      await invoke('update_instance_server', {
        instanceId: instance.id,
        index: editingIndex,
        name: editServerName,
        ip: editServerIp,
        acceptTextures: parseInt(editResourcePacks)
      });
      setShowEditModal(false);
      loadServers();
      onShowNotification('Server updated', 'success');
    } catch (error) {
      onShowNotification(`Update failed: ${error}`, 'error');
    }
  };

  const toggleResourcePacks = async (index, currentMode) => {
    try {
      const nextMode = (currentMode + 1) % 3;
      await invoke('set_server_resource_packs', {
        instanceId: instance.id,
        index,
        mode: nextMode
      });
      loadServers();
      const labels = ['Prompt', 'Enabled', 'Disabled'];
      onShowNotification(`Resource Packs: ${labels[nextMode]}`, 'success');
    } catch (error) {
      onShowNotification(`Failed: ${error}`, 'error');
    }
    setContextMenu(null);
  };

  const handlePing = async (index, ip) => {
    setPingData(prev => ({
      ...prev,
      [index]: { ...prev[index], loading: true, error: null }
    }));

    try {
      const result = await invoke('ping_server', { address: ip });
      setPingData(prev => ({
        ...prev,
        [index]: { loading: false, data: result }
      }));
    } catch (error) {
      console.error('Ping failed:', error);
      setPingData(prev => ({
        ...prev,
        [index]: { loading: false, error: error.toString() }
      }));
    }
  };

  return (
    <div className="servers-tab">
      <div className={`tab-header-actions ${isScrolled ? 'scrolled' : ''}`}>
        <button className="add-server-btn" onClick={() => setShowAddModal(true)}>
          <svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" strokeWidth="2.5" fill="none">
            <line x1="12" y1="5" x2="12" y2="19"></line>
            <line x1="5" y1="12" x2="19" y2="12"></line>
          </svg>
          Add Server
        </button>
      </div>

      {servers.length === 0 ? (
        <div className="empty-state">
          <h4>No servers added</h4>
          <p>Servers you add in-game will appear here.</p>
          <p className="hint">The servers.dat file is stored in the instance folder.</p>
        </div>
      ) : (
        <div className="servers-list">
          {servers.map((server, index) => {
            const p = pingData[index];
            return (
              <div 
                key={index} 
                className="server-item"
                onContextMenu={(e) => handleContextMenu(e, server, index)}
              >
                <div className="server-icon">
                  {server.icon ? (
                    <img src={`data:image/png;base64,${server.icon}`} alt="" />
                  ) : (
                    <div className="default-icon">🖥️</div>
                  )}
                </div>
                <div className="server-info">
                  <div className="server-header">
                    <h4>{server.name || 'Unnamed Server'}</h4>
                    <span className="server-ip">{server.ip}</span>
                  </div>
                  {p?.data && (
                    <div className="ping-motd" title={stripMinecraftCodes(p.data.motd)}>
                      {parseMinecraftColors(p.data.motd)}
                    </div>
                  )}
                </div>
                <div className="server-ping">
                  {p?.loading ? (
                    <div className="ping-status loading">
                      <div className="ping-spinner"></div>
                      <span className="ping-players">Pinging...</span>
                    </div>
                  ) : p?.data ? (
                    <div className="ping-container">
                      <div className="ping-status success">
                        <div className="ping-row">
                          <span className={`ping-ms ${p.data.latency_ms < 100 ? 'good' : p.data.latency_ms < 200 ? 'medium' : 'bad'}`}>
                            {p.data.latency_ms}ms
                          </span>
                          <span className="ping-players">
                            {p.data.online_players.toLocaleString()}/{p.data.max_players.toLocaleString()}
                          </span>
                        </div>
                        <span className="ping-version" title={p.data.version_name}>
                          {p.data.version_name.includes('MC') ? '' : 'MC '}{p.data.version_name}
                        </span>
                      </div>
                      <button 
                        className="ping-refresh-button" 
                        onClick={() => handlePing(index, server.ip)}
                        title="Re-ping server"
                      >
                        <svg viewBox="0 0 24 24" width="14" height="14" stroke="currentColor" strokeWidth="2.5" fill="none">
                          <path d="M23 4v6h-6M1 20v-6h6M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15" />
                        </svg>
                      </button>
                    </div>
                  ) : p?.error ? (
                    <div className="ping-container">
                      <div className="ping-status error">
                        <span className="ping-error" title={p.error}>{p.error.includes('timeout') ? 'Offline / Timeout' : 'Error'}</span>
                        <span className="ping-version" title={p.error}>{p.error.length > 20 ? p.error.substring(0, 20) + '...' : p.error}</span>
                      </div>
                      <button 
                        className="ping-refresh-button" 
                        onClick={() => handlePing(index, server.ip)}
                        title="Retry ping"
                      >
                        <svg viewBox="0 0 24 24" width="14" height="14" stroke="currentColor" strokeWidth="2.5" fill="none">
                          <path d="M23 4v6h-6M1 20v-6h6M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15" />
                        </svg>
                      </button>
                    </div>
                  ) : (
                    <button 
                      className="ping-button" 
                      onClick={() => handlePing(index, server.ip)}
                    >
                      Ping Server
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {contextMenu && (
        <div 
          className="context-menu" 
          style={{ top: contextMenu.y, left: contextMenu.x }}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="context-menu-header">{contextMenu.server.name}</div>
          <div className="context-menu-divider" />
          <button className="context-menu-item" onClick={() => openEditModal(contextMenu.server, contextMenu.index)}>
            Edit Server
          </button>
          <button className="context-menu-item" onClick={() => toggleResourcePacks(contextMenu.index, contextMenu.server.accept_textures || 0)}>
            Resource Packs: {['Prompt', 'Enabled', 'Disabled'][contextMenu.server.accept_textures || 0]}
          </button>
          <div className="context-menu-divider" />
          <button className="context-menu-item danger" onClick={() => openDeleteModal(contextMenu.server, contextMenu.index)}>
            Delete Server
          </button>
        </div>
      )}

      <ConfirmModal
        isOpen={showDeleteModal}
        title="Delete Server"
        message={`Are you sure you want to remove "${deleteServerName}"? This action cannot be undone.`}
        confirmText="Remove Server"
        onConfirm={handleDeleteServer}
        onCancel={() => setShowDeleteModal(false)}
      />

      {showAddModal && (
        <div className="confirm-overlay add-server-overlay" onClick={() => setShowAddModal(false)}>
          <div className="add-server-card" onClick={(e) => e.stopPropagation()}>
            <div className="add-server-header">
              <div className="header-icon-preview">
                {previewPing?.favicon ? (
                  <img src={previewPing.favicon} alt="Server Logo" />
                ) : previewLoading ? (
                  <div className="preview-spinner"></div>
                ) : (
                  <div className="header-icon">
                    <svg viewBox="0 0 24 24" width="24" height="24" stroke="currentColor" strokeWidth="2" fill="none">
                      <path d="M5 12h14M12 5l7 7-7 7" strokeWidth="2.5" />
                    </svg>
                  </div>
                )}
              </div>
              <div className="header-text">
                <h3>Add New Server</h3>
                <p>
                  {previewPing ? `Found: ${stripMinecraftCodes(previewPing.motd).substring(0, 30)}...` : 
                   previewError ? `Error: ${previewError}` :
                   'Add a multiplayer server to your list'}
                </p>
              </div>
            </div>

            <div className="add-server-body">
              <div className="modern-input-group">
                <label>
                  <svg viewBox="0 0 24 24" width="14" height="14" stroke="currentColor" strokeWidth="2" fill="none">
                    <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path>
                    <circle cx="12" cy="7" r="4"></circle>
                  </svg>
                  Server Name
                </label>
                <input 
                  type="text" 
                  value={newServerName} 
                  onChange={(e) => setNewServerName(e.target.value)} 
                  placeholder="e.g. Hypixel Network"
                  autoFocus
                />
              </div>

              <div className="modern-input-group">
                <label>
                  <svg viewBox="0 0 24 24" width="14" height="14" stroke="currentColor" strokeWidth="2" fill="none">
                    <circle cx="12" cy="12" r="10"></circle>
                    <line x1="2" y1="12" x2="22" y2="12"></line>
                    <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"></path>
                  </svg>
                  Server Address
                </label>
                <div className="input-wrapper">
                  <input 
                    type="text" 
                    value={newServerIp} 
                    onChange={(e) => setNewServerIp(e.target.value)} 
                    placeholder="e.g. play.hypixel.net"
                    onKeyDown={(e) => e.key === 'Enter' && handleAddServer()}
                  />
                  <div className="input-hint">TCP/UDP Address</div>
                </div>
              </div>

              <div className="add-server-tip">
                <svg viewBox="0 0 24 24" width="14" height="14" stroke="currentColor" strokeWidth="2" fill="none">
                  <circle cx="12" cy="12" r="10"></circle>
                  <line x1="12" y1="16" x2="12" y2="12"></line>
                  <line x1="12" y1="8" x2="12.01" y2="8"></line>
                </svg>
                <span>This will be saved to your instance's servers.dat file.</span>
              </div>
            </div>

            <div className="add-server-footer">
              <button className="modern-btn secondary" onClick={() => setShowAddModal(false)}>
                Cancel
              </button>
              <button 
                className="modern-btn primary" 
                onClick={handleAddServer}
                disabled={!newServerName || !newServerIp}
              >
                Create Server
                <svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" strokeWidth="2.5" fill="none">
                  <polyline points="20 6 9 17 4 12"></polyline>
                </svg>
              </button>
            </div>
          </div>
        </div>
      )}

      {showEditModal && (
        <div className="confirm-overlay add-server-overlay" onClick={() => setShowEditModal(false)}>
          <div className="add-server-card" onClick={(e) => e.stopPropagation()}>
            <div className="add-server-header">
              <div className="header-icon-preview">
                <div className="header-icon">
                  <svg viewBox="0 0 24 24" width="24" height="24" stroke="currentColor" strokeWidth="2" fill="none">
                    <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
                    <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
                  </svg>
                </div>
              </div>
              <div className="header-text">
                <h3>Edit Server</h3>
                <p>Modify {editServerName || 'server'} details</p>
              </div>
            </div>

            <div className="add-server-body">
              <div className="modern-input-group">
                <label>Server Name</label>
                <div className="input-wrapper">
                  <input 
                    type="text" 
                    value={editServerName}
                    onChange={(e) => setEditServerName(e.target.value)}
                    placeholder="e.g. My Survival Server"
                  />
                </div>
              </div>
              <div className="modern-input-group">
                <label>Server IP</label>
                <div className="input-wrapper">
                  <input 
                    type="text" 
                    value={editServerIp}
                    onChange={(e) => setEditServerIp(e.target.value)}
                    placeholder="e.g. play.example.com"
                  />
                </div>
              </div>
              <div className="modern-input-group">
                <label>Resource Packs</label>
                <div className="input-wrapper">
                  <select 
                    value={editResourcePacks}
                    onChange={(e) => setEditResourcePacks(e.target.value)}
                    className="modern-select"
                    style={{ background: 'transparent', border: 'none', color: 'white', width: '100%', padding: '10px 0', outline: 'none' }}
                  >
                    <option value={0}>Prompt</option>
                    <option value={1}>Enabled (Always use)</option>
                    <option value={2}>Disabled (Never use)</option>
                  </select>
                </div>
              </div>
            </div>

            <div className="add-server-footer">
              <button className="modern-btn secondary" onClick={() => setShowEditModal(false)}>Cancel</button>
              <button 
                className="modern-btn primary" 
                onClick={handleUpdateServer}
                disabled={!editServerName || !editServerIp}
              >
                Save Changes
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}

export default memo(InstanceServers);


