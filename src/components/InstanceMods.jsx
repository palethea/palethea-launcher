import { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { Trash2, RefreshCcw, Plus, Upload, Copy, Code } from 'lucide-react';
import { open } from '@tauri-apps/plugin-dialog';
import ConfirmModal from './ConfirmModal';
import ModVersionModal from './ModVersionModal';

function InstanceMods({ instance, onShowConfirm, onShowNotification }) {
  const [activeSubTab, setActiveSubTab] = useState('installed');
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [popularMods, setPopularMods] = useState([]);
  const [installedMods, setInstalledMods] = useState([]);
  const [searching, setSearching] = useState(false);
  const [installing, setInstalling] = useState(null);
  const [updatingMods, setUpdatingMods] = useState([]); // Array of filenames being updated
  const [loading, setLoading] = useState(true);
  const [loadingPopular, setLoadingPopular] = useState(true);
  const [deleteConfirm, setDeleteConfirm] = useState({ show: false, mod: null });
  const [versionModal, setVersionModal] = useState({ show: false, project: null, updateMod: null });
  const [showAddModal, setShowAddModal] = useState(false);
  const [shareCodeInput, setShareCodeInput] = useState('');
  const [applyingCode, setApplyingCode] = useState(false);
  const [applyProgress, setApplyProgress] = useState(0);
  const [applyStatus, setApplyStatus] = useState('');

  useEffect(() => {
    loadInstalledMods();
    loadPopularMods();
  }, [instance.id]);

  // Check if a mod is installed and return the mod object
  const getInstalledMod = (project) => {
    const projectId = project.project_id || project.id || project.slug;

    // First check by project_id
    const byId = installedMods.find(m => m.project_id === projectId);
    if (byId) return byId;

    // Fallback to filename matching
    const normalizedSlug = project.slug.toLowerCase().replace(/[^a-z0-9]/g, '');
    const normalizedTitle = (project.title || '').toLowerCase().replace(/[^a-z0-9]/g, '');

    return installedMods.find(m => {
      const normalizedFilename = (m.filename || '').toLowerCase().replace(/[^a-z0-9]/g, '');
      const normalizedName = (m.name || '').toLowerCase().replace(/[^a-z0-9]/g, '');
      return normalizedFilename.includes(normalizedSlug) ||
        normalizedName.includes(normalizedSlug) ||
        (normalizedTitle && (normalizedFilename.includes(normalizedTitle) || normalizedName.includes(normalizedTitle)));
    });
  };

  const isModInstalled = (project) => {
    return !!getInstalledMod(project);
  };

  const loadInstalledMods = async () => {
    try {
      const mods = await invoke('get_instance_mods', { instanceId: instance.id });
      setInstalledMods(mods);
    } catch (error) {
      console.error('Failed to load mods:', error);
    }
    setLoading(false);
  };

  const loadPopularMods = async () => {
    setLoadingPopular(true);
    try {
      const results = await invoke('search_modrinth', {
        query: '',
        projectType: 'mod',
        gameVersion: instance.version_id,
        loader: instance.mod_loader?.toLowerCase() !== 'vanilla' ? instance.mod_loader?.toLowerCase() : null,
        limit: 20,
        offset: 0
      });
      setPopularMods(results.hits || []);
    } catch (error) {
      console.error('Failed to load popular mods:', error);
    }
    setLoadingPopular(false);
  };

  const handleSearch = async () => {
    if (!searchQuery.trim()) {
      setSearchResults([]);
      return;
    }

    setSearching(true);
    try {
      const results = await invoke('search_modrinth', {
        query: searchQuery,
        projectType: 'mod',
        gameVersion: instance.version_id,
        loader: instance.mod_loader?.toLowerCase() !== 'vanilla' ? instance.mod_loader?.toLowerCase() : null,
        limit: 20,
        offset: 0
      });
      setSearchResults(results.hits || []);
    } catch (error) {
      console.error('Failed to search:', error);
    }
    setSearching(false);
  };

  const handleRequestInstall = async (project, updateMod = null) => {
    setVersionModal({ show: true, project, updateMod: updateMod });
  };

  const handleInstall = async (project, selectedVersion = null, skipDependencyCheck = false, updateMod = null) => {
    setInstalling(project.slug);
    if (updateMod) {
      setUpdatingMods(prev => [...prev, updateMod.filename]);
    }

    try {
      let version = selectedVersion;

      if (!version) {
        const versions = await invoke('get_modrinth_versions', {
          projectId: project.slug,
          gameVersion: instance.version_id,
          loader: instance.mod_loader?.toLowerCase() || null
        });

        if (versions.length === 0) {
          alert('No compatible version found for this mod');
          setInstalling(null);
          return;
        }

        version = versions[0];
      }

      // Check for required dependencies
      if (!skipDependencyCheck && version.dependencies && version.dependencies.length > 0) {
        const requiredDeps = version.dependencies.filter(d => d.dependency_type === 'required');

        if (requiredDeps.length > 0) {
          // Fetch dependency info
          const depProjects = [];
          for (const dep of requiredDeps) {
            if (dep.project_id) {
              try {
                const depProject = await invoke('get_modrinth_project', { projectId: dep.project_id });
                // Only add if not already installed
                if (!isModInstalled(depProject)) {
                  depProjects.push(depProject);
                }
              } catch (e) {
                console.error('Failed to fetch dependency:', e);
              }
            }
          }

          if (depProjects.length > 0) {
            // Show confirmation modal for dependencies
            setInstalling(null);
            onShowConfirm({
              title: 'Install Dependencies',
              message: `${project.title} requires the following mods:\n\n${depProjects.map(d => '• ' + d.title).join('\n')}\n\nWould you like to install them?`,
              confirmText: 'Install All',
              cancelText: 'Skip Dependencies',
              variant: 'primary',
              onConfirm: async () => {
                // Install all dependencies
                for (const depProject of depProjects) {
                  await handleInstall(depProject, null, true);
                }
                // Then install the original mod with the selected version
                await handleInstall(project, version, true, updateMod);
              },
              onCancel: async () => {
                // Install without dependencies
                await handleInstall(project, version, true, updateMod);
              }
            });
            return;
          }
        }
      }

      const file = version.files.find(f => f.primary) || version.files[0];

      await invoke('install_modrinth_file', {
        instanceId: instance.id,
        fileUrl: file.url,
        filename: file.filename,
        fileType: 'mod',
        projectId: project.project_id || project.slug,
        versionId: version.id,
        name: project.title,
        iconUrl: project.icon_url,
        versionName: version.version_number
      });

      // If this was an update and the new file name is different, delete the old one
      if (updateMod && updateMod.filename !== file.filename) {
        try {
          await invoke('delete_instance_mod', {
            instanceId: instance.id,
            filename: updateMod.filename
          });
        } catch (deleteError) {
          console.error('Failed to delete old mod version:', deleteError);
        }
      }

      await loadInstalledMods();
    } catch (error) {
      console.error('Failed to install mod:', error);
      alert('Failed to install mod: ' + error);
    } finally {
      setInstalling(null);
      if (updateMod) {
        setUpdatingMods(prev => prev.filter(f => f !== updateMod.filename));
      }
    }
  };

  const handleToggle = async (mod) => {
    try {
      await invoke('toggle_instance_mod', {
        instanceId: instance.id,
        filename: mod.filename
      });
      await loadInstalledMods();
    } catch (error) {
      console.error('Failed to toggle mod:', error);
    }
  };

  const handleDelete = async (mod) => {
    setDeleteConfirm({ show: true, mod });
  };

  const handleImportFile = async () => {
    try {
      const selected = await open({
        multiple: true,
        filters: [{
          name: 'JAR Files',
          extensions: ['jar']
        }]
      });

      if (selected && selected.length > 0) {
        for (const path of selected) {
          await invoke('import_instance_file', {
            instanceId: instance.id,
            sourcePath: path,
            folderType: 'mods'
          });
        }
        await loadInstalledMods();
        if (onShowNotification) {
          onShowNotification(`Imported ${selected.length} mod${selected.length > 1 ? 's' : ''}`, 'success');
        }
      }
    } catch (error) {
      console.error('Failed to import mods:', error);
      if (onShowNotification) {
        onShowNotification('Failed to import mods: ' + error, 'error');
      }
    }
  };

  const handleCheckUpdate = (mod) => {
    if (!mod.project_id) return;
    setVersionModal({ 
      show: true, 
      projectId: mod.project_id, 
      updateMod: mod,
      project: { title: mod.name, icon_url: mod.icon_url, slug: mod.project_id } 
    });
  };

  const handleCopyModsCode = async () => {
    try {
      const code = await invoke('get_instance_mods_share_code', { instanceId: instance.id });
      await navigator.clipboard.writeText(code);
      if (onShowNotification) {
        onShowNotification('Mods code copied to clipboard!', 'success');
      }
    } catch (error) {
      console.error('Failed to copy mods code:', error);
      if (onShowNotification) {
        onShowNotification(`Failed to copy mods code: ${error}`, 'error');
      }
    }
  };

  const handleApplyCode = async () => {
    if (!shareCodeInput.trim()) return;

    setApplyingCode(true);
    setApplyProgress(0);
    setApplyStatus('Decoding share code...');
    
    try {
      const shareData = await invoke('decode_instance_share_code', { code: shareCodeInput.trim() });
      const mods = shareData.mods || [];

      if (mods.length === 0) {
        if (onShowNotification) {
          onShowNotification('No mods found in this code.', 'info');
        }
        setApplyingCode(false);
        return;
      }

      setApplyStatus(`Found ${mods.length} mods. Fetching metadata...`);
      setApplyProgress(10);

      // Pre-fetch metadata if possible
      let projectMap = {};
      const projectIds = mods.map(m => m.project_id || m.projectId).filter(Boolean);
      try {
        if (projectIds.length > 0) {
          const projects = await invoke('get_modrinth_projects', { projectIds });
          projects.forEach(p => {
            const id = p.project_id || p.id;
            if (id) projectMap[id] = p;
            if (p.slug) projectMap[p.slug] = p;
          });
        }
      } catch (e) {
        console.warn('Bulk fetch failed:', e);
      }

      let installedCount = 0;
      for (let i = 0; i < mods.length; i++) {
        const mod = mods[i];
        try {
          const mid = mod.project_id || mod.projectId;
          const vid = mod.version_id || mod.versionId;

          const currentModName = mod.name || mid;
          setApplyStatus(`Installing ${currentModName} (${i + 1}/${mods.length})...`);
          setApplyProgress(10 + ((i / mods.length) * 90));

          // Skip if already installed
          if (installedMods.some(m => m.project_id === mid)) {
            installedCount++;
            continue;
          }

          let info;
          if (vid) {
            info = await invoke('get_modrinth_version', { versionId: vid });
          } else {
            const versions = await invoke('get_modrinth_versions', {
              projectId: mid,
              gameVersion: instance.version_id,
              loader: instance.mod_loader?.toLowerCase() || null
            });
            info = versions.length > 0 ? versions[0] : null;
          }

          if (info) {
            let project = projectMap[mid];
            if (!project) {
              try {
                project = await invoke('get_modrinth_project', { projectId: mid });
              } catch (e) {
                console.warn(`Failed to fetch project metadata for ${mid}:`, e);
              }
            }

            const file = info.files.find(f => f.primary) || info.files[0];

            await invoke('install_modrinth_file', {
              instanceId: instance.id,
              fileUrl: file.url,
              filename: file.filename,
              fileType: 'mod',
              projectId: mid,
              versionId: info.id,
              name: project?.title || mod.name || null,
              iconUrl: project?.icon_url || mod.icon_url || mod.iconUrl || null,
              versionName: info.name || mod.version_name || mod.versionName
            });
            installedCount++;
          }
        } catch (e) {
          console.error(`Failed to install mod ${mod.project_id || mod.projectId}:`, e);
        }
      }

      setApplyProgress(100);
      setApplyStatus('Installation complete!');

      if (onShowNotification) {
        onShowNotification(`Successfully installed ${installedCount} mods!`, 'success');
      }
      setTimeout(() => {
        setShowAddModal(false);
        setShareCodeInput('');
        setApplyingCode(false);
        setApplyProgress(0);
        setApplyStatus('');
        loadInstalledMods();
      }, 500);
      return;
    } catch (error) {
      console.error('Failed to apply code:', error);
      if (onShowNotification) {
        onShowNotification('Invalid or incompatible mods code.', 'error');
      }
    }
    setApplyingCode(false);
    setApplyProgress(0);
    setApplyStatus('');
  };

  const handleOpenFolder = async () => {
    try {
      await invoke('open_instance_folder', {
        instanceId: instance.id,
        folderType: 'mods'
      });
    } catch (error) {
      console.error('Failed to open folder:', error);
      if (onShowNotification) {
        onShowNotification(`Failed to open mods folder: ${error}`, 'error');
      }
    }
  };

  const handleOpenConfigFolder = async () => {
    try {
      await invoke('open_instance_folder', {
        instanceId: instance.id,
        folderType: 'config'
      });
    } catch (error) {
      console.error('Failed to open folder:', error);
      if (onShowNotification) {
        onShowNotification(`Failed to open config folder: ${error}`, 'error');
      }
    }
  };

  const confirmDelete = async () => {
    const mod = deleteConfirm.mod;
    setDeleteConfirm({ show: false, mod: null });

    try {
      await invoke('delete_instance_mod', {
        instanceId: instance.id,
        filename: mod.filename
      });
      await loadInstalledMods();
    } catch (error) {
      console.error('Failed to delete mod:', error);
    }
  };

  const formatDownloads = (num) => {
    if (num >= 1000000) return (num / 1000000).toFixed(1) + 'M';
    if (num >= 1000) return (num / 1000).toFixed(1) + 'K';
    return num.toString();
  };

  const formatFileSize = (bytes) => {
    if (!bytes || bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  const modrinthMods = installedMods.filter(m => m.provider === 'Modrinth').sort((a, b) => (a.name || a.filename).localeCompare(b.name || b.filename));
  const manualMods = installedMods.filter(m => m.provider !== 'Modrinth').sort((a, b) => (a.name || a.filename).localeCompare(b.name || b.filename));

  const getLoaderBadges = (categories) => {
    if (!categories) return [];
    const loaders = [];
    if (categories.includes('fabric')) loaders.push('Fabric');
    if (categories.includes('forge')) loaders.push('Forge');
    if (categories.includes('neoforge')) loaders.push('NeoForge');
    if (categories.includes('quilt')) loaders.push('Quilt');
    return loaders;
  };

  if (instance.mod_loader === 'Vanilla' || !instance.mod_loader) {
    return (
      <div className="mods-tab">
        <div className="empty-state">
          <h4>Mods require a mod loader</h4>
          <p>Go to Settings and install Fabric, Forge, or NeoForge to use mods.</p>
        </div>
      </div>
    );
  }

  const displayMods = searchQuery.trim() ? searchResults : popularMods;

  return (
    <div className="mods-tab">
      <div className="sub-tabs-row">
        <div className="sub-tabs">
          <button
            className={`sub-tab ${activeSubTab === 'installed' ? 'active' : ''}`}
            onClick={() => setActiveSubTab('installed')}
          >
            Installed ({installedMods.length})
          </button>
          <button
            className={`sub-tab ${activeSubTab === 'find' ? 'active' : ''}`}
            onClick={() => setActiveSubTab('find')}
          >
            Find Mods
          </button>
        </div>
        <div className="sub-tabs-actions">
          {activeSubTab === 'installed' && (
            <>
              <button className="open-folder-btn" onClick={() => setShowAddModal(true)} title="Add Mod">
                <Plus size={16} />
                <span>Add Mod</span>
              </button>
              <button className="open-folder-btn" onClick={handleOpenFolder}>
                📁 Folder
              </button>
              <button className="open-folder-btn" onClick={handleOpenConfigFolder}>
                ⚙️ Configs
              </button>
            </>
          )}
        </div>
      </div>

      {activeSubTab === 'installed' ? (
        <div className="installed-section">
          {loading ? (
            <p>Loading...</p>
          ) : installedMods.length === 0 ? (
            <div className="empty-state">
              <p>No mods installed. Go to "Find Mods" to browse and install mods.</p>
            </div>
          ) : (
            <div className="mods-container">
              {modrinthMods.length > 0 && (
                <div className="mod-group">
                  <div className="group-header">
                    <h3 className="group-title">Modrinth</h3>
                    <div className="group-header-line"></div>
                    <button className="copy-code-btn" onClick={handleCopyModsCode} title="Copy Mods Share Code">
                      <Copy size={12} />
                      <span>Copy Code</span>
                    </button>
                  </div>
                  <div className="installed-list">
                    {modrinthMods.map((mod) => {
                      const isUpdating = updatingMods.includes(mod.filename);
                      return (
                        <div key={mod.filename} className={`installed-item ${!mod.enabled ? 'disabled' : ''} ${isUpdating ? 'mod-updating' : ''}`}>
                          {isUpdating && (
                            <div className="mod-updating-overlay">
                              <RefreshCcw className="spin-icon" size={20} />
                              <span>Updating...</span>
                            </div>
                          )}
                          <div className="item-main">
                            <div
                              className={`item-toggle ${mod.enabled ? 'enabled' : ''}`}
                              onClick={() => !isUpdating && handleToggle(mod)}
                              title={mod.enabled ? "Disable Mod" : "Enable Mod"}
                            />
                            {mod.icon_url ? (
                              <img src={mod.icon_url} alt="" className="mod-icon-small" />
                            ) : (
                              <div className="mod-icon-placeholder">📦</div>
                            )}
                            <div className="item-info">
                              <div className="item-title-row">
                                <h4>{mod.name || mod.filename}</h4>
                                {mod.version && <span className="mod-version-tag">v{mod.version}</span>}
                              </div>
                              <div className="item-meta-row">
                                <span className="mod-provider">{mod.provider}</span>
                                <span className="mod-separator">•</span>
                                <span className="mod-size">{formatFileSize(mod.size)}</span>
                              </div>
                            </div>
                          </div>
                          <div className="item-actions">
                            <button 
                              className="update-btn-simple" 
                              onClick={() => handleCheckUpdate(mod)}
                              title="Check for updates"
                              disabled={isUpdating}
                            >
                              <RefreshCcw size={14} />
                            </button>
                            <button 
                              className="delete-btn-simple" 
                              onClick={() => handleDelete(mod)} 
                              title="Delete mod"
                              disabled={isUpdating}
                            >
                              <Trash2 size={16} />
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {manualMods.length > 0 && (
                <div className="mod-group">
                  <div className="group-header">
                    <h3 className="group-title">Other</h3>
                    <div className="group-header-line"></div>
                  </div>
                  <div className="installed-list">
                    {manualMods.map((mod) => {
                      const isUpdating = updatingMods.includes(mod.filename);
                      return (
                        <div key={mod.filename} className={`installed-item ${!mod.enabled ? 'disabled' : ''} ${isUpdating ? 'mod-updating' : ''}`}>
                          {isUpdating && (
                            <div className="mod-updating-overlay">
                              <RefreshCcw className="spin-icon" size={20} />
                              <span>Updating...</span>
                            </div>
                          )}
                          <div className="item-main">
                            <div
                              className={`item-toggle ${mod.enabled ? 'enabled' : ''}`}
                              onClick={() => !isUpdating && handleToggle(mod)}
                              title={mod.enabled ? "Disable Mod" : "Enable Mod"}
                            />
                            <div className="mod-icon-placeholder">📦</div>
                            <div className="item-info">
                              <div className="item-title-row">
                                <h4>{mod.name || mod.filename}</h4>
                              </div>
                              <div className="item-meta-row">
                                <span className="mod-provider manual">Manual</span>
                                <span className="mod-separator">•</span>
                                <span className="mod-size">{formatFileSize(mod.size)}</span>
                              </div>
                            </div>
                          </div>
                          <div className="item-actions">
                            <button 
                              className="delete-btn-simple" 
                              onClick={() => handleDelete(mod)} 
                              title="Delete mod"
                              disabled={isUpdating}
                            >
                              <Trash2 size={16} />
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      ) : (
        <div className="find-mods-section">
          <div className="search-input-wrapper">
            <input
              type="text"
              placeholder="Search Modrinth for mods..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
            />
            <button
              className="search-btn"
              onClick={handleSearch}
              disabled={searching}
            >
              {searching ? 'Searching...' : 'Search'}
            </button>
          </div>

          <h3 className="section-title">
            {searchQuery.trim() ? 'Search Results' : 'Popular Mods'}
          </h3>

          {(searching || loadingPopular) ? (
            <div className="loading-mods">Loading...</div>
          ) : displayMods.length === 0 ? (
            <div className="empty-state">
              <p>{searchQuery.trim() ? 'No mods found.' : 'No popular mods available for this version.'}</p>
            </div>
          ) : (
            <div className="search-results">
              {displayMods.map((project) => {
                const installedMod = getInstalledMod(project);
                const isDownloading = installing === project.slug;

                return (
                  <div key={project.slug} className={`search-result-card ${isDownloading ? 'mod-updating' : ''}`}>
                    {isDownloading && (
                      <div className="mod-updating-overlay">
                        <RefreshCcw className="spin-icon" size={20} />
                        <span>Downloading...</span>
                      </div>
                    )}
                    <div className="result-header">
                      {project.icon_url && (
                        <img src={project.icon_url} alt="" className="result-icon" />
                      )}
                      <div className="result-info">
                        <h4>{project.title}</h4>
                        <span className="result-author">by {project.author}</span>
                      </div>
                    </div>
                    <p className="result-description">{project.description}</p>
                    <div className="result-footer">
                      <div className="result-meta">
                        <span className="result-downloads">{formatDownloads(project.downloads)} downloads</span>
                        <div className="loader-badges">
                          {getLoaderBadges(project.categories).map((loader) => (
                            <span key={loader} className={`loader-badge loader-${loader.toLowerCase()}`}>
                              {loader}
                            </span>
                          ))}
                        </div>
                      </div>
                      {installedMod ? (
                        <button
                          className="install-btn reinstall"
                          onClick={() => handleRequestInstall(project, installedMod)}
                          disabled={isDownloading}
                        >
                          Reinstall
                        </button>
                      ) : (
                        <button
                          className="install-btn"
                          onClick={() => handleRequestInstall(project)}
                          disabled={isDownloading}
                        >
                          {isDownloading ? 'Downloading...' : 'Install'}
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      <ConfirmModal
        isOpen={deleteConfirm.show}
        title="Delete Mod"
        message={`Are you sure you want to delete "${deleteConfirm.mod?.name}"?`}
        confirmText="Delete"
        cancelText="Cancel"
        variant="danger"
        onConfirm={confirmDelete}
        onCancel={() => setDeleteConfirm({ show: false, mod: null })}
      />

      {versionModal.show && (
        <ModVersionModal
          project={versionModal.project}
          projectId={versionModal.projectId}
          gameVersion={instance.version_id}
          loader={instance.mod_loader}
          onClose={() => setVersionModal({ show: false, project: null, projectId: null, updateMod: null })}
          onSelect={(version) => {
            const updateMod = versionModal.updateMod;
            const project = versionModal.project;
            setVersionModal({ show: false, project: null, projectId: null, updateMod: null });
            handleInstall(project, version, false, updateMod);
          }}
        />
      )}

      {showAddModal && (
        <div className="add-mod-modal-overlay" onClick={() => !applyingCode && setShowAddModal(false)}>
          <div className="add-mod-modal" onClick={e => e.stopPropagation()}>
            <div className="add-mod-header">
              <h2>Add Mod</h2>
              <button className="close-btn-simple" onClick={() => setShowAddModal(false)}>✕</button>
            </div>
            <div className="add-mod-body">
              {applyingCode ? (
                <div className="apply-progress-container">
                  <div className="apply-status-text">{applyStatus}</div>
                  <div className="apply-progress-bar-bg">
                    <div 
                      className="apply-progress-bar-fill" 
                      style={{ width: `${applyProgress}%` }}
                    />
                  </div>
                  <div className="apply-progress-percent">{Math.round(applyProgress)}%</div>
                </div>
              ) : (
                <>
                  <div className="choice-grid">
                    <button className="choice-card" onClick={() => {
                      setShowAddModal(false);
                      handleImportFile();
                    }}>
                      <div className="choice-icon">
                        <Upload size={24} />
                      </div>
                      <span>Add .JAR</span>
                    </button>
                    <button className="choice-card" onClick={() => {
                      // Stay in modal but maybe show input
                    }} style={{ cursor: 'default', opacity: 1 }}>
                      <div className="choice-icon" style={{ color: 'var(--accent)' }}>
                        <Code size={24} />
                      </div>
                      <span>Use Code</span>
                    </button>
                  </div>

                  <div className="code-input-container">
                    <label style={{ fontSize: '12px', color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase' }}>Paste Share Code</label>
                    <div className="code-input-wrapper">
                      <input 
                        type="text" 
                        className="code-input" 
                        placeholder="Paste code here..." 
                        value={shareCodeInput}
                        onChange={(e) => setShareCodeInput(e.target.value)}
                        disabled={applyingCode}
                      />
                      <button 
                        className="apply-btn" 
                        onClick={handleApplyCode}
                        disabled={applyingCode || !shareCodeInput.trim()}
                      >
                        {applyingCode ? '...' : 'Apply'}
                      </button>
                    </div>
                    <p style={{ fontSize: '11px', color: 'var(--text-muted)', margin: 0 }}>
                      Adding mods from code will automatically download them from Modrinth.
                    </p>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default InstanceMods;
