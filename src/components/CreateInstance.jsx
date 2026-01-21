import { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import './CreateInstance.css';
import VersionSelector from './VersionSelector';

function CreateInstance({ onClose, onCreate, isLoading, mode = 'page' }) {
  const [creationMode, setCreationMode] = useState('version'); // 'version' or 'modpack'
  const [name, setName] = useState('');
  const [selectedVersion, setSelectedVersion] = useState('');
  const [modLoader, setModLoader] = useState('vanilla');
  const [step, setStep] = useState(0);
  const [loaderVersions, setLoaderVersions] = useState([]);
  const [loaderLoading, setLoaderLoading] = useState(false);
  const [loaderError, setLoaderError] = useState('');
  const [selectedLoaderVersion, setSelectedLoaderVersion] = useState('');
  const [versions, setVersions] = useState([]);

  // Modpack state
  const [modpackSearch, setModpackSearch] = useState('');
  const [modpacks, setModpacks] = useState([]);
  const [modpacksLoading, setModpacksLoading] = useState(false);
  const [selectedModpack, setSelectedModpack] = useState(null);
  const [selectedModpackVersion, setSelectedModpackVersion] = useState(null);
  const [modpackVersions, setModpackVersions] = useState([]);
  const [modpackVersionsLoading, setModpackVersionsLoading] = useState(false);
  const [modpackTotalSize, setModpackTotalSize] = useState(null);
  const [sizeLoading, setSizeLoading] = useState(false);

  // Filters
  const [enabledTypes, setEnabledTypes] = useState(['release']);
  const [searchQuery, setSearchQuery] = useState('');
  const [loaderSearchQuery, setLoaderSearchQuery] = useState('');
  const [loadingVersions, setLoadingVersions] = useState(true);

  useEffect(() => {
    loadVersions();
    handleSearchModpacks(""); // Load popular modpacks by default
  }, []);

  const loadVersions = async () => {
    setLoadingVersions(true);
    try {
      const result = await invoke('get_versions');
      setVersions(result);

      // Select latest release by default if none selected
      if (!selectedVersion) {
        const latest = await invoke('get_latest_release');
        setSelectedVersion(latest);
      }
    } catch (error) {
      console.error('Failed to load versions:', error);
    }
    setLoadingVersions(false);
  };

  const filteredVersions = versions.filter((v) => {
    const matchesFilter = enabledTypes.length === 0 || enabledTypes.includes(v.version_type);
    const matchesSearch = v.id.toLowerCase().includes(searchQuery.toLowerCase());
    return matchesFilter && matchesSearch;
  });

  const filteredLoaderVersions = loaderVersions.filter((v) => {
    return v.version.toLowerCase().includes(loaderSearchQuery.toLowerCase());
  });

  useEffect(() => {
    if (selectedVersion && modLoader !== 'vanilla') {
      loadLoaderVersions();
    }
  }, [selectedVersion, modLoader]);

  const loadLoaderVersions = async () => {
    if (modLoader === 'vanilla' || !selectedVersion) {
      setLoaderVersions([]);
      setSelectedLoaderVersion('');
      setLoaderError('');
      setLoaderLoading(false);
      return;
    }

    setLoaderLoading(true);
    setLoaderError('');
    try {
      const result = await invoke('get_loader_versions', {
        loader: modLoader,
        gameVersion: selectedVersion,
      });
      setLoaderVersions(result);
      if (result.length > 0) {
        setSelectedLoaderVersion(result[0].version);
      }
    } catch (error) {
      console.error('Failed to load loader versions:', error);
      setLoaderVersions([]);
      setSelectedLoaderVersion('');
      setLoaderError('Failed to load loader versions');
    }
    setLoaderLoading(false);
  };

  useEffect(() => {
    if (selectedModpackVersion) {
      calculateTotalSize(selectedModpackVersion.id);
    } else {
      setModpackTotalSize(null);
    }
  }, [selectedModpackVersion]);

  const calculateTotalSize = async (versionId) => {
    setSizeLoading(true);
    try {
      const size = await invoke('get_modpack_total_size', { versionId });
      setModpackTotalSize(size);
    } catch (error) {
      console.error('Failed to calculate modpack size:', error);
      setModpackTotalSize(null);
    }
    setSizeLoading(false);
  };

  const toggleType = (type) => {
    setEnabledTypes(prev =>
      prev.includes(type) ? prev.filter(t => t !== type) : [...prev, type]
    );
  };

  const formatDate = (isoStr) => {
    if (!isoStr) return 'Unknown';
    try {
      const date = new Date(isoStr);
      return date.toLocaleDateString(undefined, { year: '2-digit', month: 'numeric', day: 'numeric' });
    } catch {
      return isoStr;
    }
  };

  const handleSearchModpacks = async (queryOverride) => {
    const query = queryOverride !== undefined ? queryOverride : modpackSearch;
    setModpacksLoading(true);
    try {
      const result = await invoke('search_modrinth', {
        query: query,
        projectType: 'modpack',
        limit: 20,
        offset: 0
      });
      setModpacks(result.hits);
    } catch (error) {
      console.error('Failed to search modpacks:', error);
    }
    setModpacksLoading(false);
  };

  const handleSelectModpack = async (mp) => {
    setSelectedModpack(mp);
    setModpackVersionsLoading(true);
    try {
      const versions = await invoke('get_modrinth_versions', { projectId: mp.project_id });
      setModpackVersions(versions);
      if (versions.length > 0) {
        setSelectedModpackVersion(versions[0]);
      }
    } catch (error) {
      console.error('Failed to load modpack versions:', error);
    }
    setModpackVersionsLoading(false);
  };

  const handleCreate = () => {
    if (creationMode === 'version') {
      if (name.trim() && selectedVersion) {
        onCreate(name.trim(), selectedVersion, modLoader, selectedLoaderVersion || null);
      }
    } else {
      if (name.trim() && selectedModpack && selectedModpackVersion) {
        // Pass specialized data for modpack creation
        onCreate(name.trim(), 'modpack', 'modpack', {
          modpackId: selectedModpack.project_id,
          versionId: selectedModpackVersion.id,
          modpackName: selectedModpack.title,
          modpackIcon: selectedModpack.icon_url
        });
      }
    }
  };

  const canNextFromName = name.trim().length > 0;
  const canNextFromVersion = creationMode === 'version' ? !!selectedVersion : !!selectedModpack;
  const canCreate = creationMode === 'version' 
    ? (name.trim() && selectedVersion && (modLoader === 'vanilla' || selectedLoaderVersion))
    : (name.trim() && selectedModpack && selectedModpackVersion);

  const isPage = mode === 'page';

  const versionTypes = [
    { id: 'release', label: 'Releases' },
    { id: 'snapshot', label: 'Snapshots' },
    { id: 'old_beta', label: 'Betas' },
    { id: 'old_alpha', label: 'Alphas' },
  ];

  const content = (
    <div className={isPage ? 'create-page' : 'modal'} onClick={(e) => e.stopPropagation()}>
      <div className={isPage ? 'create-header' : 'modal-header'}>
        <h2>{step === 0 ? 'Instance Identity' : step === 1 ? 'Minecraft Version' : 'Modifications'}</h2>
        {!isPage && <button className="close-btn" onClick={onClose}>×</button>}
      </div>

      <div className="create-steps">
        <div className={`create-step ${step === 0 ? 'active' : ''}`}>Setup</div>
        <div className={`create-step ${step === 1 ? 'active' : ''}`}>{creationMode === 'version' ? 'Version' : 'Modpack'}</div>
        <div className={`create-step ${step === 2 ? 'active' : ''}`}>{creationMode === 'version' ? 'Loader' : 'Review'}</div>
      </div>

      <div className={isPage ? 'create-body' : 'modal-body'}>
        {step === 0 && (
          <div className="setup-step-v2">
            <div className="form-group name-input-group">
              <label className="section-label">Instance Name</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Name your new instance..."
                className="instance-name-input"
                autoFocus
              />
            </div>

            <div className="form-group">
              <label className="section-label">Installation Type</label>
              <div className="creation-mode-cards">
                <button 
                  className={`mode-card ${creationMode === 'version' ? 'active' : ''}`}
                  onClick={() => setCreationMode('version')}
                >
                  <div className="mode-icon">📦</div>
                  <div className="mode-details">
                    <div className="mode-title">Custom Instance</div>
                    <div className="mode-description">
                      Choose a specific Minecraft version and optionally install Fabric, Forge, or NeoForge.
                    </div>
                  </div>
                  <div className="mode-check">
                    <div className="check-inner" />
                  </div>
                </button>

                <button 
                  className={`mode-card ${creationMode === 'modpack' ? 'active' : ''}`}
                  onClick={() => setCreationMode('modpack')}
                >
                  <div className="mode-icon">⚡</div>
                  <div className="mode-details">
                    <div className="mode-title">Modrinth Modpack</div>
                    <div className="mode-description">
                      Browse and install thousands of community-made modpacks with all mods pre-configured.
                    </div>
                  </div>
                  <div className="mode-check">
                    <div className="check-inner" />
                  </div>
                </button>
              </div>
            </div>
          </div>
        )}

        {step === 1 && creationMode === 'version' && (
          <VersionSelector
            versions={versions}
            selectedVersion={selectedVersion}
            onSelect={setSelectedVersion}
            onRefresh={loadVersions}
            loading={loadingVersions}
          />
        )}

        {step === 1 && creationMode === 'modpack' && (
          <div className="modpack-step">
            <div className="modpack-search-container">
              <div className="search-bar">
                <span className="search-icon">🔍</span>
                <input
                  type="text"
                  value={modpackSearch}
                  onChange={(e) => setModpackSearch(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleSearchModpacks()}
                  placeholder="Search Modrinth modpacks..."
                  className="modpack-search-input"
                />
                <button 
                  className="btn btn-primary search-btn" 
                  onClick={() => handleSearchModpacks()} 
                  disabled={modpacksLoading}
                >
                  {modpacksLoading ? '...' : 'Search'}
                </button>
              </div>
            </div>

            <div className="version-list" style={{ flex: 1, minHeight: 0 }}>
              {modpacks.length === 0 ? (
                <div className="empty-state">
                  <p>{modpacksLoading ? 'Searching Modrinth...' : 'Enter a search term to find modpacks'}</p>
                </div>
              ) : (
                <div className="modpack-grid">
                  {modpacks.map((mp) => (
                    <div 
                      key={mp.project_id} 
                      className={`modpack-card ${selectedModpack?.project_id === mp.project_id ? 'selected' : ''}`}
                      onClick={() => handleSelectModpack(mp)}
                    >
                      <div className="modpack-card-icon">
                        {mp.icon_url ? (
                          <img src={mp.icon_url} alt="" />
                        ) : (
                          <div className="modpack-placeholder-icon">M</div>
                        )}
                      </div>
                      <div className="modpack-card-info">
                        <div className="modpack-title">{mp.title}</div>
                        <div className="modpack-author">by {mp.author}</div>
                        <div className="modpack-meta">
                          <span className="modpack-downloads">⬇ {mp.downloads.toLocaleString()}</span>
                          <span className="modpack-tag">Modpack</span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {step === 2 && creationMode === 'version' && (
          <div className="loader-layout">
            <div className="loader-grid">
              {[
                {
                  id: 'vanilla',
                  name: 'None',
                  icon: <img src="https://minecraft.wiki/images/Grass_Block_JE7_BE6.png" alt="Vanilla" className="loader-logo-img vanilla" />
                },
                {
                  id: 'fabric',
                  name: 'Fabric',
                  icon: <img src="https://flintmc.net/brand/modification/81bae1feee32c1c794d63719ef123d0b.png" alt="Fabric" className="loader-logo-img fabric" />
                },
                {
                  id: 'forge',
                  name: 'Forge',
                  icon: <img src="https://avatars.githubusercontent.com/u/1390178?v=4" alt="Forge" className="loader-logo-img forge" />
                },
                {
                  id: 'neoforge',
                  name: 'NeoForge',
                  icon: <img src="https://www.boxtoplay.com/assets/backend/img/minecraft/logos/neoforge.png" alt="NeoForge" className="loader-logo-img neoforge" />
                }
              ]
                .map(loader => (
                  <button
                    key={loader.id}
                    className={`loader-card ${modLoader === loader.id ? 'active' : ''}`}
                    onClick={() => setModLoader(loader.id)}
                  >
                    <div className="loader-icon">{loader.icon}</div>
                    <span className="loader-name">{loader.name}</span>
                  </button>
                ))}
            </div>

            {modLoader !== 'vanilla' && (
              <div style={{ marginTop: '16px', flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
                <VersionSelector
                  versions={loaderVersions}
                  selectedVersion={selectedLoaderVersion}
                  onSelect={setSelectedLoaderVersion}
                  onRefresh={loadLoaderVersions}
                  loading={loaderLoading}
                  showFilters={false}
                />
              </div>
            )}
          </div>
        )}

        {step === 2 && creationMode === 'modpack' && (
          <div className="modpack-review">
            <div className="modpack-review-header">
              <div className="modpack-icon-large">
                {selectedModpack?.icon_url ? (
                  <img src={selectedModpack.icon_url} alt="" />
                ) : (
                  <div className="modpack-placeholder-icon large">M</div>
                )}
              </div>
              <div className="modpack-review-info">
                <h3 className="modpack-review-title">{selectedModpack?.title}</h3>
                <p className="modpack-review-author">by {selectedModpack?.author}</p>
                {selectedModpackVersion && (
                  <div className="modpack-review-meta">
                    <span className="badge">{selectedModpackVersion.name}</span>
                    <span className="badge">{selectedModpackVersion.game_versions[0]}</span>
                    {sizeLoading ? (
                      <span className="badge size-badge loading">Calculating total download size...</span>
                    ) : modpackTotalSize ? (
                      <span className="badge size-badge">
                        {(modpackTotalSize / 1024 / 1024).toFixed(1)} MB (Total)
                      </span>
                    ) : (
                      <span className="badge size-badge">
                        {(selectedModpackVersion?.files?.find(f => f.primary)?.size / 1024 / 1024).toFixed(1)} MB (Config)
                      </span>
                    )}
                  </div>
                )}
                <div className="modpack-review-description">
                  {selectedModpack?.description}
                </div>
              </div>
            </div>

            <div className="modpack-version-section form-group">
              <label className="section-label">Target Version</label>
              <div className="review-version-list">
                {modpackVersionsLoading ? (
                  <div className="version-loading">Loading available versions...</div>
                ) : (
                  modpackVersions.map(v => (
                    <div 
                      key={v.id} 
                      className={`review-version-item ${selectedModpackVersion?.id === v.id ? 'selected' : ''}`}
                      onClick={() => setSelectedModpackVersion(v)}
                    >
                      <div className="selection-indicator" />
                      <div className="version-main-info">
                        <span className="version-number">{v.name || v.version_number}</span>
                      </div>
                      <div className="version-meta-info">
                        <span className="game-version">{v.game_versions[0]}</span>
                        <span className="loader-tag">{v.loaders.join(', ')}</span>
                        {v.files?.find(f => f.primary)?.size && (
                          <span className="file-size">
                            {(v.files.find(f => f.primary).size / 1024).toFixed(0)} KB (zip)
                          </span>
                        )}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        )}
      </div>

      <div className={isPage ? 'create-footer' : 'modal-footer'}>
        <button className="btn btn-secondary" onClick={onClose} disabled={isLoading}>
          Cancel
        </button>
        {step > 0 && (
          <button
            className="btn btn-secondary"
            onClick={() => setStep(step - 1)}
            disabled={isLoading}
          >
            Back
          </button>
        )}
        {step < 2 ? (
          <button
            className="btn btn-primary"
            onClick={() => setStep(step + 1)}
            disabled={isLoading || (step === 0 && !canNextFromName) || (step === 1 && !canNextFromVersion)}
          >
            Next
          </button>
        ) : (
          <button
            className="btn btn-primary"
            onClick={handleCreate}
            disabled={!canCreate || isLoading}
          >
            {isLoading ? 'Creating...' : 'Create Instance'}
          </button>
        )}
      </div>
    </div>
  );

  return isPage ? (
    <div className="create-page-container">
      {content}
    </div>
  ) : (
    <div className="modal-overlay" onClick={onClose}>
      {content}
    </div>
  );
}

export default CreateInstance;
