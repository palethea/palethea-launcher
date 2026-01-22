import { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import ConfirmModal from './ConfirmModal';

function InstanceResources({ instance, onShowNotification }) {
  const [activeSubTab, setActiveSubTab] = useState('resourcepacks');
  const [resourcePacks, setResourcePacks] = useState([]);
  const [shaderPacks, setShaderPacks] = useState([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [popularItems, setPopularItems] = useState([]);
  const [searching, setSearching] = useState(false);
  const [installing, setInstalling] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadingPopular, setLoadingPopular] = useState(false);
  const [error, setError] = useState(null);
  const [deleteConfirm, setDeleteConfirm] = useState({ show: false, item: null, type: null });

  useEffect(() => {
    loadResources();
  }, [instance.id]);

  useEffect(() => {
    if (activeSubTab === 'find-resourcepacks' || activeSubTab === 'find-shaders') {
      loadPopularItems();
    }
  }, [activeSubTab, instance.version_id]);

  const isItemInstalled = (project) => {
    if (!project?.slug || !project?.title) return false;

    const isResourcePack = activeSubTab === 'find-resourcepacks';
    const installedList = isResourcePack ? resourcePacks : shaderPacks;

    if (!installedList || installedList.length === 0) return false;

    // Normalize: remove all non-alphanumeric characters and lowercase
    const normalizedSlug = project.slug.toLowerCase().replace(/[^a-z0-9]/g, '');
    const normalizedTitle = project.title.toLowerCase().replace(/[^a-z0-9]/g, '');

    return installedList.some(item => {
      if (!item?.filename) return false;
      const normalizedFilename = item.filename.toLowerCase().replace(/[^a-z0-9]/g, '');

      // Check if slug or title appears in the normalized filename
      return normalizedFilename.includes(normalizedSlug) ||
        normalizedFilename.includes(normalizedTitle);
    });
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

  const handleInstall = async (project) => {
    const fileType = activeSubTab === 'find-resourcepacks' ? 'resourcepack' : 'shader';
    setInstalling(project.slug);
    try {
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

      const version = versions[0];
      const file = version.files.find(f => f.primary) || version.files[0];

      await invoke('install_modrinth_file', {
        instanceId: instance.id,
        fileUrl: file.url,
        filename: file.filename,
        fileType: fileType,
        projectId: project.project_id || project.slug,
        versionId: version.id
      });

      await loadResources();
    } catch (error) {
      console.error('Failed to install:', error);
      if (onShowNotification) {
        onShowNotification(`Failed to install: ${error}`, 'error');
      }
    }
    setInstalling(null);
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
            <button className="open-folder-btn" onClick={handleOpenResourcePacksFolder}>
              📁 Open Resource Packs Folder
            </button>
          )}
          {activeSubTab === 'shaders' && (
            <button className="open-folder-btn" onClick={handleOpenShadersFolder}>
              📁 Open Shaders Folder
            </button>
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
            <div className="installed-list">
              {resourcePacks.map((rp) => (
                <div key={rp.filename} className="installed-item">
                  <div className="item-info">
                    <h4>{rp.name}</h4>
                    <span>{rp.filename}</span>
                  </div>
                  <div className="item-actions">
                    <button className="delete-btn" onClick={() => handleDelete(rp, 'resourcepack')}>
                      Delete
                    </button>
                  </div>
                </div>
              ))}
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
            <div className="installed-list">
              {shaderPacks.map((sp) => (
                <div key={sp.filename} className="installed-item">
                  <div className="item-info">
                    <h4>{sp.name}</h4>
                    <span>{sp.filename}</span>
                  </div>
                  <div className="item-actions">
                    <button className="delete-btn" onClick={() => handleDelete(sp, 'shader')}>
                      Delete
                    </button>
                  </div>
                </div>
              ))}
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
              {displayItems.map((project) => (
                <div key={project.slug} className="search-result-card">
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
                    <span className="result-downloads">{formatDownloads(project.downloads)} downloads</span>
                    {isItemInstalled(project) ? (
                      <span className="installed-badge">Installed</span>
                    ) : (
                      <button
                        className="install-btn"
                        onClick={() => handleInstall(project)}
                        disabled={installing === project.slug}
                      >
                        {installing === project.slug ? 'Installing...' : 'Install'}
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

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
    </div>
  );
}

export default InstanceResources;
