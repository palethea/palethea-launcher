import { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
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
  const [loading, setLoading] = useState(true);
  const [loadingPopular, setLoadingPopular] = useState(true);
  const [deleteConfirm, setDeleteConfirm] = useState({ show: false, mod: null });
  const [versionModal, setVersionModal] = useState({ show: false, project: null });

  useEffect(() => {
    loadInstalledMods();
    loadPopularMods();
  }, [instance.id]);

  // Check if a mod is installed by comparing project_id or filenames
  const isModInstalled = (project) => {
    const projectId = project.project_id || project.slug;

    // First check by project_id (most reliable)
    if (installedMods.some(m => m.project_id === projectId)) {
      return true;
    }

    // Fallback to filename matching for mods installed before metadata was added
    const normalizedSlug = project.slug.toLowerCase().replace(/[^a-z0-9]/g, '');
    const normalizedTitle = project.title.toLowerCase().replace(/[^a-z0-9]/g, '');

    return installedMods.some(m => {
      const normalizedFilename = m.filename.toLowerCase().replace(/[^a-z0-9]/g, '');
      return normalizedFilename.includes(normalizedSlug) ||
        normalizedFilename.includes(normalizedTitle);
    });
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

  const handleRequestInstall = async (project) => {
    setVersionModal({ show: true, project });
  };

  const handleInstall = async (project, selectedVersion = null, skipDependencyCheck = false) => {
    setInstalling(project.slug);
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
                // Install all dependencies (using their latest version for simplicity, or we could recurse version selection)
                for (const depProject of depProjects) {
                  await handleInstall(depProject, null, true);
                }
                // Then install the original mod with the selected version
                await handleInstall(project, version, true);
              },
              onCancel: async () => {
                // Install without dependencies
                await handleInstall(project, version, true);
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
        versionId: version.id
      });

      await loadInstalledMods();
    } catch (error) {
      console.error('Failed to install mod:', error);
      alert('Failed to install mod: ' + error);
    }
    setInstalling(null);
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
              <button className="open-folder-btn" onClick={handleOpenFolder}>
                📁 Open Mods Folder
              </button>
              <button className="open-folder-btn" onClick={handleOpenConfigFolder}>
                ⚙️ Open Configs Folder
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
            <div className="installed-list">
              {installedMods.map((mod) => (
                <div key={mod.filename} className={`installed-item ${!mod.enabled ? 'disabled' : ''}`}>
                  <div
                    className={`item-toggle ${mod.enabled ? 'enabled' : ''}`}
                    onClick={() => handleToggle(mod)}
                  />
                  <div className="item-info">
                    <h4>{mod.name}</h4>
                    <span>{mod.filename}</span>
                  </div>
                  <div className="item-actions">
                    <button className="delete-btn" onClick={() => handleDelete(mod)}>
                      Delete
                    </button>
                  </div>
                </div>
              ))}
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
              {displayMods.map((project) => (
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
                    {isModInstalled(project) ? (
                      <span className="installed-badge">Installed</span>
                    ) : (
                      <button
                        className="install-btn"
                        onClick={() => handleRequestInstall(project)}
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
          gameVersion={instance.version_id}
          loader={instance.mod_loader}
          onClose={() => setVersionModal({ show: false, project: null })}
          onSelect={(version) => {
            setVersionModal({ show: false, project: null });
            handleInstall(versionModal.project, version);
          }}
        />
      )}
    </div>
  );
}

export default InstanceMods;
