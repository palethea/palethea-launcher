import { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { Trash2, RefreshCcw, Plus, Upload } from 'lucide-react';
import { open } from '@tauri-apps/plugin-dialog';
import ConfirmModal from './ConfirmModal';
import ModVersionModal from './ModVersionModal';

function InstanceResources({ instance, onShowNotification }) {
  const [activeSubTab, setActiveSubTab] = useState('resourcepacks');
  const [resourcePacks, setResourcePacks] = useState([]);
  const [shaderPacks, setShaderPacks] = useState([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [popularItems, setPopularItems] = useState([]);
  const [searching, setSearching] = useState(false);
  const [installing, setInstalling] = useState(null);
  const [updatingItems, setUpdatingItems] = useState([]); // Array of filenames being updated
  const [loading, setLoading] = useState(true);
  const [loadingPopular, setLoadingPopular] = useState(false);
  const [error, setError] = useState(null);
  const [deleteConfirm, setDeleteConfirm] = useState({ show: false, item: null, type: null });
  const [versionModal, setVersionModal] = useState({ show: false, project: null, updateItem: null });

  useEffect(() => {
    loadResources();
  }, [instance.id]);

  useEffect(() => {
    if (activeSubTab === 'find-resourcepacks' || activeSubTab === 'find-shaders') {
      loadPopularItems();
    }
  }, [activeSubTab, instance.version_id]);

  const getInstalledItem = (project) => {
    const isResourcePack = activeSubTab === 'find-resourcepacks';
    const installedList = isResourcePack ? resourcePacks : shaderPacks;

    if (!installedList || installedList.length === 0) return null;

    const projectId = project.project_id || project.id;

    // First check by project_id
    if (projectId) {
      const byId = installedList.find(m => m.project_id === projectId);
      if (byId) return byId;
    }

    // Normalize: remove all non-alphanumeric characters and lowercase
    const searchTitle = (project.title || project.name || '').toLowerCase().trim();
    const searchSlug = (project.slug || '').toLowerCase().trim();

    return installedList.find(item => {
      const itemTitle = (item.name || '').toLowerCase().trim();
      const itemFilename = (item.filename || '').toLowerCase().trim();

      return (searchTitle && (itemTitle === searchTitle || itemFilename.includes(searchTitle))) ||
             (searchSlug && (itemFilename.includes(searchSlug) || itemTitle.includes(searchSlug)));
    });
  };

  const isItemInstalled = (project) => {
    return !!getInstalledItem(project);
  };

  const loadResources = async () => {
    setError(null);
    try {
      const [rp, sp] = await Promise.all([
        invoke('get_instance_resourcepacks', { instanceId: instance.id }).catch(() => []),
        invoke('get_instance_shaderpacks', { instanceId: instance.id }).catch(() => [])
      ]);
      setResourcePacks(rp || []);
      setShaderPacks(sp || []);
    } catch (err) {
      console.error('Failed to load resources:', err);
      setError('Failed to load resources: ' + err.toString());
      setResourcePacks([]);
      setShaderPacks([]);
    }
    setLoading(false);
  };

  const loadPopularItems = async () => {
    const projectType = activeSubTab === 'find-resourcepacks' ? 'resourcepack' : 'shader';
    setLoadingPopular(true);
    setSearchResults([]);
    setSearchQuery('');
    setError(null);
    try {
      const results = await invoke('search_modrinth', {
        query: '',
        projectType: projectType,
        gameVersion: instance.version_id,
        loader: null,
        limit: 20,
        offset: 0
      });
      setPopularItems(results?.hits || []);
    } catch (err) {
      console.error('Failed to load popular items:', err);
      setPopularItems([]);
    }
    setLoadingPopular(false);
  };

  const handleSearch = async () => {
    if (!searchQuery.trim()) {
      setSearchResults([]);
      return;
    }

    const projectType = activeSubTab === 'find-resourcepacks' ? 'resourcepack' : 'shader';
    setSearching(true);
    try {
      const results = await invoke('search_modrinth', {
        query: searchQuery,
        projectType: projectType,
        gameVersion: instance.version_id,
        loader: null,
        limit: 20,
        offset: 0
      });
      setSearchResults(results.hits || []);
    } catch (error) {
      console.error('Failed to search:', error);
    }
    setSearching(false);
  };

  const handleRequestInstall = async (project, updateItem = null) => {
    setVersionModal({ show: true, project, updateItem: updateItem });
  };

  const handleInstall = async (project, selectedVersion = null, skipDependencyCheck = false, updateItem = null) => {
    const fileType = activeSubTab === 'find-resourcepacks' || activeSubTab === 'resourcepacks' ? 'resourcepack' : 'shader';
    setInstalling(project.slug);
    if (updateItem) {
      setUpdatingItems(prev => [...prev, updateItem.filename]);
    }

    try {
      let version = selectedVersion;

      if (!version) {
        const versions = await invoke('get_modrinth_versions', {
          projectId: project.slug,
          gameVersion: instance.version_id,
          loader: null
        });

        if (versions.length === 0) {
          if (onShowNotification) {
            onShowNotification('No compatible version found', 'error');
          }
          setInstalling(null);
          return;
        }

        version = versions[0];
      }

      const file = version.files.find(f => f.primary) || version.files[0];

      await invoke('install_modrinth_file', {
        instanceId: instance.id,
        fileUrl: file.url,
        filename: file.filename,
        fileType: fileType,
        projectId: project.project_id || project.slug || project.id,
        versionId: version.id,
        iconUrl: project.icon_url || project.thumbnail,
        name: project.title || project.name,
        versionName: version.version_number
      });

      // If updating, delete the old file
      if (updateItem && updateItem.filename !== file.filename) {
        console.log(`Deleting old file: ${updateItem.filename}`);
        if (fileType === 'resourcepack') {
          await invoke('delete_instance_resourcepack', {
            instanceId: instance.id,
            filename: updateItem.filename
          });
        } else {
          await invoke('delete_instance_shaderpack', {
            instanceId: instance.id,
            filename: updateItem.filename
          });
        }
      }

      await loadResources();
      if (onShowNotification) {
        onShowNotification(`${project.title || project.name} ${updateItem ? 'updated' : 'installed'} successfully`, 'success');
      }
    } catch (error) {
      console.error('Failed to install:', error);
      if (onShowNotification) {
        onShowNotification(`Failed to install: ${error}`, 'error');
      }
    }
    setInstalling(null);
    if (updateItem) {
      setUpdatingItems(prev => prev.filter(f => f !== updateItem.filename));
    }
  };

  const handleDelete = async (item, type) => {
    setDeleteConfirm({ show: true, item, type });
  };

  const confirmDelete = async () => {
    const { item, type } = deleteConfirm;
    setDeleteConfirm({ show: false, item: null, type: null });

    try {
      if (type === 'resourcepack') {
        await invoke('delete_instance_resourcepack', {
          instanceId: instance.id,
          filename: item.filename
        });
      } else {
        await invoke('delete_instance_shaderpack', {
          instanceId: instance.id,
          filename: item.filename
        });
      }
      await loadResources();
    } catch (error) {
      console.error('Failed to delete:', error);
    }
  };

  const formatDownloads = (num) => {
    if (num >= 1000000) return (num / 1000000).toFixed(1) + 'M';
    if (num >= 1000) return (num / 1000).toFixed(1) + 'K';
    return num.toString();
  };

  const handleImportFile = async (type) => {
    try {
      const selected = await open({
        multiple: true,
        filters: [{
          name: type === 'resourcepack' ? 'Resource Packs' : 'Shader Packs',
          extensions: ['zip']
        }]
      });

      if (selected && selected.length > 0) {
        for (const path of selected) {
          await invoke('import_instance_file', {
            instanceId: instance.id,
            sourcePath: path,
            folderType: type === 'resourcepack' ? 'resourcepacks' : 'shaderpacks'
          });
        }
        await loadResources();
        if (onShowNotification) {
          onShowNotification(`Imported ${selected.length} ${type === 'resourcepack' ? 'pack' : 'shader'}${selected.length > 1 ? 's' : ''}`, 'success');
        }
      }
    } catch (error) {
      console.error('Failed to import:', error);
      if (onShowNotification) {
        onShowNotification('Failed to import: ' + error, 'error');
      }
    }
  };

  const handleOpenResourcePacksFolder = async () => {
    try {
      await invoke('open_instance_folder', {
        instanceId: instance.id,
        folderType: 'resourcepacks'
      });
    } catch (error) {
      console.error('Failed to open folder:', error);
      if (onShowNotification) {
        onShowNotification(`Failed to open resource packs folder: ${error}`, 'error');
      }
    }
  };

  const handleOpenShadersFolder = async () => {
    try {
      await invoke('open_instance_folder', {
        instanceId: instance.id,
        folderType: 'shaderpacks'
      });
    } catch (error) {
      console.error('Failed to open folder:', error);
      if (onShowNotification) {
        onShowNotification(`Failed to open shader packs folder: ${error}`, 'error');
      }
    }
  };

  const displayItems = searchQuery.trim() ? searchResults : popularItems;
  const isFindTab = activeSubTab === 'find-resourcepacks' || activeSubTab === 'find-shaders';

  return (
    <div className="resources-tab">
      <div className="sub-tabs-row">
        <div className="sub-tabs">
          <button
            className={`sub-tab ${activeSubTab === 'resourcepacks' ? 'active' : ''}`}
            onClick={() => setActiveSubTab('resourcepacks')}
          >
            Resource Packs ({resourcePacks.length})
          </button>
          <button
            className={`sub-tab ${activeSubTab === 'find-resourcepacks' ? 'active' : ''}`}
            onClick={() => setActiveSubTab('find-resourcepacks')}
          >
            Find Packs
          </button>
          <button
            className={`sub-tab ${activeSubTab === 'shaders' ? 'active' : ''}`}
            onClick={() => setActiveSubTab('shaders')}
          >
            Shaders ({shaderPacks.length})
          </button>
          <button
            className={`sub-tab ${activeSubTab === 'find-shaders' ? 'active' : ''}`}
            onClick={() => setActiveSubTab('find-shaders')}
          >
            Find Shaders
          </button>
        </div>
        <div className="sub-tabs-actions">
          {activeSubTab === 'resourcepacks' && (
            <>
              <button className="open-folder-btn" onClick={() => handleImportFile('resourcepack')} title="Add Pack ZIP File">
                <Plus size={16} />
                <span>Add Pack</span>
              </button>
              <button className="open-folder-btn" onClick={handleOpenResourcePacksFolder}>
                📁 Folder
              </button>
            </>
          )}
          {activeSubTab === 'shaders' && (
            <>
              <button className="open-folder-btn" onClick={() => handleImportFile('shader')} title="Add Shader ZIP File">
                <Plus size={16} />
                <span>Add Shader</span>
              </button>
              <button className="open-folder-btn" onClick={handleOpenShadersFolder}>
                📁 Folder
              </button>
            </>
          )}
        </div>
      </div>

      {activeSubTab === 'resourcepacks' && (
        <div className="installed-section">
          {loading ? (
            <p>Loading...</p>
          ) : resourcePacks.length === 0 ? (
            <div className="empty-state">
              <p>No resource packs installed. Go to "Find Packs" to browse and install resource packs.</p>
            </div>
          ) : (
            <div className="mods-container">
              {resourcePacks.filter(p => p.provider === 'Modrinth').length > 0 && (
                <div className="mod-group">
                  <h3 className="group-title">Modrinth</h3>
                  <div className="installed-list">
                    {resourcePacks.filter(p => p.provider === 'Modrinth').sort((a, b) => (a.name || a.filename).localeCompare(b.name || b.filename)).map((rp) => {
                      const isUpdating = updatingItems.includes(rp.filename);
                      return (
                        <div key={rp.filename} className={`installed-item ${isUpdating ? 'mod-updating' : ''}`}>
                          {isUpdating && (
                            <div className="mod-updating-overlay">
                              <RefreshCcw className="spin-icon" size={20} />
                              <span>Updating...</span>
                            </div>
                          )}
                          <div className="item-main">
                            {rp.icon_url ? (
                              <img src={rp.icon_url} alt={rp.name} className="mod-icon-small" onError={(e) => e.target.src = 'https://cdn-icons-png.flaticon.com/512/3011/3011270.png'} />
                            ) : (
                              <div className="mod-icon-placeholder">📦</div>
                            )}
                            <div className="item-info">
                              <div className="item-title-row">
                                <h4>{rp.name}</h4>
                                {rp.version && <span className="mod-version-tag">v{rp.version}</span>}
                              </div>
                              <div className="item-meta-row">
                                <span className="mod-provider">{rp.provider}</span>
                                {rp.size > 0 && (
                                  <>
                                    <span className="mod-separator">•</span>
                                    <span className="mod-size">{(rp.size / 1024 / 1024).toFixed(2)} MB</span>
                                  </>
                                )}
                              </div>
                            </div>
                          </div>
                          <div className="item-actions">
                            <button 
                              className="update-btn-simple" 
                              title="Update Pack"
                              onClick={() => handleRequestInstall({ project_id: rp.project_id, title: rp.name, slug: rp.project_id, icon_url: rp.icon_url }, rp)}
                              disabled={isUpdating}
                            >
                              <RefreshCcw size={14} />
                            </button>
                            <button 
                              className="delete-btn-simple" 
                              title="Delete Pack" 
                              onClick={() => handleDelete(rp, 'resourcepack')} 
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
              {resourcePacks.filter(p => p.provider !== 'Modrinth').length > 0 && (
                <div className="mod-group">
                  <h3 className="group-title">Manual</h3>
                  <div className="installed-list">
                    {resourcePacks.filter(p => p.provider !== 'Modrinth').sort((a, b) => (a.name || a.filename).localeCompare(b.name || b.filename)).map((rp) => (
                      <div key={rp.filename} className="installed-item">
                        <div className="item-main">
                          <div className="mod-icon-placeholder">📦</div>
                          <div className="item-info">
                            <div className="item-title-row">
                              <h4>{rp.filename.endsWith('.zip') ? rp.filename : `${rp.filename}.zip`}</h4>
                            </div>
                            <div className="item-meta-row">
                              <span className="mod-provider">Manual</span>
                              {rp.size > 0 && (
                                <>
                                  <span className="mod-separator">•</span>
                                  <span className="mod-size">{(rp.size / 1024 / 1024).toFixed(2)} MB</span>
                                </>
                              )}
                            </div>
                          </div>
                        </div>
                        <div className="item-actions">
                          <button className="delete-btn-simple" title="Delete Pack" onClick={() => handleDelete(rp, 'resourcepack')}>
                            <Trash2 size={16} />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {activeSubTab === 'shaders' && (
        <div className="installed-section">
          {loading ? (
            <p>Loading...</p>
          ) : shaderPacks.length === 0 ? (
            <div className="empty-state">
              <p>No shader packs installed. Go to "Find Shaders" to browse and install shaders.</p>
            </div>
          ) : (
            <div className="mods-container">
              {shaderPacks.filter(p => p.provider === 'Modrinth').length > 0 && (
                <div className="mod-group">
                  <h3 className="group-title">Modrinth</h3>
                  <div className="installed-list">
                    {shaderPacks.filter(p => p.provider === 'Modrinth').sort((a, b) => (a.name || a.filename).localeCompare(b.name || b.filename)).map((sp) => {
                      const isUpdating = updatingItems.includes(sp.filename);
                      return (
                        <div key={sp.filename} className={`installed-item ${isUpdating ? 'mod-updating' : ''}`}>
                          {isUpdating && (
                            <div className="mod-updating-overlay">
                              <RefreshCcw className="spin-icon" size={20} />
                              <span>Updating...</span>
                            </div>
                          )}
                          <div className="item-main">
                            {sp.icon_url ? (
                              <img src={sp.icon_url} alt={sp.name} className="mod-icon-small" onError={(e) => e.target.src = 'https://cdn-icons-png.flaticon.com/512/3011/3011270.png'} />
                            ) : (
                              <div className="mod-icon-placeholder">📦</div>
                            )}
                            <div className="item-info">
                              <div className="item-title-row">
                                <h4>{sp.name}</h4>
                                {sp.version && <span className="mod-version-tag">v{sp.version}</span>}
                              </div>
                              <div className="item-meta-row">
                                <span className="mod-provider">{sp.provider}</span>
                                {sp.size > 0 && (
                                  <>
                                    <span className="mod-separator">•</span>
                                    <span className="mod-size">{(sp.size / 1024 / 1024).toFixed(2)} MB</span>
                                  </>
                                )}
                              </div>
                            </div>
                          </div>
                          <div className="item-actions">
                            {sp.project_id && (
                              <button 
                                className="update-btn-simple" 
                                title="Update Shader"
                                onClick={() => handleRequestInstall({ project_id: sp.project_id, title: sp.name, slug: sp.project_id, icon_url: sp.icon_url, project_type: 'shader' }, sp)}
                                disabled={isUpdating}
                              >
                                <RefreshCcw size={16} />
                              </button>
                            )}
                            <button className="delete-btn-simple" title="Delete Shader" onClick={() => handleDelete(sp, 'shader')} disabled={isUpdating}>
                              <Trash2 size={16} />
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
              {shaderPacks.filter(p => p.provider !== 'Modrinth').length > 0 && (
                <div className="mod-group">
                  <h3 className="group-title">Manual</h3>
                  <div className="installed-list">
                    {shaderPacks.filter(p => p.provider !== 'Modrinth').sort((a, b) => (a.name || a.filename).localeCompare(b.name || b.filename)).map((sp) => (
                      <div key={sp.filename} className="installed-item">
                        <div className="item-main">
                          <div className="mod-icon-placeholder">📦</div>
                          <div className="item-info">
                            <div className="item-title-row">
                              <h4>{sp.filename.endsWith('.zip') ? sp.filename : `${sp.filename}.zip`}</h4>
                            </div>
                            <div className="item-meta-row">
                              <span className="mod-provider">Manual</span>
                              {sp.size > 0 && (
                                <>
                                  <span className="mod-separator">•</span>
                                  <span className="mod-size">{(sp.size / 1024 / 1024).toFixed(2)} MB</span>
                                </>
                              )}
                            </div>
                          </div>
                        </div>
                        <div className="item-actions">
                          <button className="delete-btn-simple" title="Delete Shader" onClick={() => handleDelete(sp, 'shader')}>
                            <Trash2 size={16} />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {isFindTab && (
        <div className="find-mods-section">
          <div className="search-input-wrapper">
            <input
              type="text"
              placeholder={`Search Modrinth for ${activeSubTab === 'find-resourcepacks' ? 'resource packs' : 'shaders'}...`}
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
            {searchQuery.trim() ? 'Search Results' : `Popular ${activeSubTab === 'find-resourcepacks' ? 'Resource Packs' : 'Shaders'}`}
          </h3>

          {(searching || loadingPopular) ? (
            <div className="loading-mods">Loading...</div>
          ) : displayItems.length === 0 ? (
            <div className="empty-state">
              <p>{searchQuery.trim() ? 'No results found.' : 'No popular items available for this version.'}</p>
            </div>
          ) : (
            <div className="search-results">
              {displayItems.map((project) => {
                const installedItem = getInstalledItem(project);
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
                      </div>
                      {installedItem ? (
                        <button
                          className="install-btn reinstall"
                          onClick={() => handleRequestInstall(project, installedItem)}
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
                          Install
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

      {deleteConfirm.show && (
        <ConfirmModal
          isOpen={deleteConfirm.show}
          title={deleteConfirm.type === 'resourcepack' ? 'Delete Resource Pack' : 'Delete Shader'}
          message={`Are you sure you want to delete "${deleteConfirm.item?.name || deleteConfirm.item?.filename}"?`}
          confirmText="Delete"
          cancelText="Cancel"
          variant="danger"
          onConfirm={confirmDelete}
          onCancel={() => setDeleteConfirm({ show: false, item: null, type: null })}
        />
      )}

      {versionModal.show && (
        <ModVersionModal
          project={versionModal.project}
          projectId={versionModal.project?.project_id || versionModal.project?.id || versionModal.project?.slug}
          gameVersion={instance.version_id}
          loader={null}
          onClose={() => setVersionModal({ show: false, project: null, updateItem: null })}
          onSelect={(version) => {
            handleInstall(versionModal.project, version, false, versionModal.updateItem);
            setVersionModal({ show: false, project: null, updateItem: null });
          }}
        />
      )}
    </div>
  );
}

export default InstanceResources;
