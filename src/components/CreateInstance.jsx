import { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { open } from '@tauri-apps/plugin-dialog';
import './CreateInstance.css';
import VersionSelector from './VersionSelector';

function CreateInstance({ onClose, onCreate, isLoading, mode = 'page' }) {
  const [creationMode, setCreationMode] = useState('version'); // 'version', 'modpack', 'import', or 'share-code'
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

  // Import state
  const [importZipPath, setImportZipPath] = useState('');
  const [importInfo, setImportInfo] = useState(null); // { name, version_id, mod_loader }

  // Share code state
  const [shareCode, setShareCode] = useState('');
  const [decodedShareData, setDecodedShareData] = useState(null);
  const [decodingError, setDecodingError] = useState('');
  const [isDecoding, setIsDecoding] = useState(false);

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
      setLoaderError(error.toString());
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

  // ----------
  // handleSelectZipFile
  // Description: Opens a file dialog to select a .zip file for importing
  // ----------
  const handleSelectZipFile = async () => {
    try {
      const selected = await open({
        multiple: false,
        filters: [{
          name: 'Palethea Instance',
          extensions: ['zip']
        }]
      });

      if (selected) {
        setImportZipPath(selected);
        // Extract name from filename for default name suggestion
        const filename = selected.split(/[/\\]/).pop()?.replace('.zip', '') || 'Imported Instance';
        if (!name) {
          setName(filename);
        }
      }
    } catch (error) {
      console.error('Failed to select file:', error);
    }
  };

  const handleDecodeShareCode = async (code) => {
    setShareCode(code);
    if (!code.trim()) {
      setDecodedShareData(null);
      setDecodingError('');
      return;
    }

    setIsDecoding(true);
    setDecodingError('');
    try {
      const result = await invoke('decode_instance_share_code', { code: code.trim() });
      setDecodedShareData(result);
      if (!name) setName(result.name);
    } catch (error) {
      console.error('Failed to decode share code:', error);
      setDecodingError('Invalid or corrupted share code.');
      setDecodedShareData(null);
    }
    setIsDecoding(false);
  };

  const handleCreate = () => {
    if (creationMode === 'version') {
      if (name.trim() && selectedVersion) {
        onCreate(name.trim(), selectedVersion, modLoader, selectedLoaderVersion || null);
      }
    } else if (creationMode === 'modpack') {
      if (name.trim() && selectedModpack && selectedModpackVersion) {
        // Pass specialized data for modpack creation
        onCreate(name.trim(), 'modpack', 'modpack', {
          modpackId: selectedModpack.project_id,
          versionId: selectedModpackVersion.id,
          modpackName: selectedModpack.title,
          modpackIcon: selectedModpack.icon_url
        });
      }
    } else if (creationMode === 'import') {
      if (importZipPath) {
        // Pass import data
        onCreate(name.trim() || null, 'import', 'import', {
          zipPath: importZipPath
        });
      }
    } else if (creationMode === 'share-code') {
      if (decodedShareData) {
        onCreate(name.trim() || decodedShareData.name, 'share-code', 'share-code', {
          shareData: decodedShareData
        });
      }
    }
  };

  // ----------
  // Validation logic
  // Description: Determines when user can proceed to next step or create instance
  // ----------
  const canNextFromName = (creationMode === 'import' || creationMode === 'share-code') ? true : name.trim().length > 0;
  const canNextFromVersion = creationMode === 'version'
    ? !!selectedVersion
    : creationMode === 'modpack'
      ? !!selectedModpack
      : creationMode === 'share-code'
        ? !!decodedShareData
        : !!importZipPath;
  const canCreate = creationMode === 'version'
    ? (name.trim() && selectedVersion && (modLoader === 'vanilla' || selectedLoaderVersion))
    : creationMode === 'modpack'
      ? (name.trim() && selectedModpack && selectedModpackVersion)
      : creationMode === 'share-code'
        ? !!decodedShareData
        : !!importZipPath;

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
        <h2>{creationMode === 'import'
          ? (step === 0 ? 'Instance Identity' : 'Select File')
          : (step === 0 ? 'Instance Identity' : step === 1 ? 'Minecraft Version' : 'Modifications')
        }</h2>
        {!isPage && <button className="close-btn" onClick={onClose}>×</button>}
      </div>

      <div className="create-steps">
        <div className={`create-step ${step === 0 ? 'active' : ''}`}>Setup</div>
        {creationMode === 'import' ? (
          <div className={`create-step ${step === 1 ? 'active' : ''}`}>Select File</div>
        ) : (
          <>
            <div className={`create-step ${step === 1 ? 'active' : ''}`}>{creationMode === 'version' ? 'Version' : 'Modpack'}</div>
            <div className={`create-step ${step === 2 ? 'active' : ''}`}>{creationMode === 'version' ? 'Loader' : 'Review'}</div>
          </>
        )}
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
                placeholder={
                  (creationMode === 'import' || creationMode === 'share-code')
                    ? "Name will be detected automatically..."
                    : "Name your new instance..."
                }
                className="instance-name-input"
                disabled={creationMode === 'import' || creationMode === 'share-code'}
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
                    <div className="mode-title">Preconfigured Modpack</div>
                    <div className="mode-description">
                      Browse Modrinth and install thousands of community-made modpacks with all mods pre-configured.
                    </div>
                  </div>
                  <div className="mode-check">
                    <div className="check-inner" />
                  </div>
                </button>

                <button
                  className={`mode-card ${creationMode === 'import' ? 'active' : ''}`}
                  onClick={() => setCreationMode('import')}
                >
                  <div className="mode-icon">📁</div>
                  <div className="mode-details">
                    <div className="mode-title">Import from .zip</div>
                    <div className="mode-description">
                      Import an instance shared by a friend. Simply select the .zip file they shared with you.
                    </div>
                  </div>
                  <div className="mode-check">
                    <div className="check-inner" />
                  </div>
                </button>

                <button
                  className={`mode-card ${creationMode === 'share-code' ? 'active' : ''}`}
                  onClick={() => setCreationMode('share-code')}
                >
                  <div className="mode-icon">🔗</div>
                  <div className="mode-details">
                    <div className="mode-title">Use Share Code</div>
                    <div className="mode-description">
                      Paste a code from a friend to automatically set name, version, mod loader, and all mods/resourcepacks.
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

        {/* ---------- */}
        {/* Import Step */}
        {/* Description: File selection UI for importing a shared instance .zip */}
        {/* ---------- */}
        {step === 1 && creationMode === 'import' && (
          <div className="import-step">
            <div className="import-dropzone" onClick={handleSelectZipFile}>
              <div className="import-icon">📁</div>
              {importZipPath ? (
                <>
                  <div className="import-filename">{importZipPath.split(/[/\\]/).pop()}</div>
                  <div className="import-hint">Click to select a different file</div>
                </>
              ) : (
                <>
                  <div className="import-title">Select Instance File</div>
                  <div className="import-hint">Click here to browse for a .zip file shared with you</div>
                </>
              )}
            </div>
            <div className="form-group" style={{ marginTop: '24px' }}>
              <label className="section-label">Instance Name (Optional)</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Leave blank for original name..."
                className="instance-name-input"
              />
              <div className="import-name-hint">If left blank, the original instance name will be used</div>
            </div>
          </div>
        )}

        {step === 1 && creationMode === 'share-code' && (
          <div className="share-code-step">
            <div className="share-code-hero">
              <div className="hero-icon">🔗</div>
              <h3>Import from Code</h3>
              <p>Paste the share code below to reconstruct a shared instance.</p>
            </div>

            <div className={`share-code-layout ${decodedShareData ? 'has-preview' : ''}`}>
              <div className="share-code-main">
                <div className="form-group">
                  <label className="section-label">Paste Share Code</label>
                  <input
                    className="share-code-input"
                    type="text"
                    placeholder="Paste the code your friend sent you here..."
                    value={shareCode}
                    onChange={(e) => handleDecodeShareCode(e.target.value)}
                  />
                  {isDecoding && <div className="decoding-status">
                    <div className="mini-spinner"></div>
                    Decoding...
                  </div>}
                  {decodingError && <div className="decoding-error">{decodingError}</div>}
                </div>

                <div className="form-group share-name-group">
                  <label className="section-label">Instance Name (Optional)</label>
                  <input
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Leave blank for pack name"
                    className="instance-name-input"
                  />
                </div>
              </div>

              {decodedShareData && (
                <div className="share-preview-card">
                  <div className="preview-accent-bar" />
                  <div className="preview-header">
                    <div className="preview-icon">📦</div>
                    <div className="preview-main">
                      <h4>{decodedShareData.name}</h4>
                      <span className="preview-meta">
                        Minecraft {decodedShareData.version} • {decodedShareData.loader.charAt(0).toUpperCase() + decodedShareData.loader.slice(1)}
                      </span>
                    </div>
                  </div>
                  <div className="preview-stats">
                    <div className="preview-stat">
                      <span className="stat-value">{decodedShareData.mods.length}</span>
                      <span className="stat-label">Mods</span>
                    </div>
                    <div className="preview-stat">
                      <span className="stat-value">{decodedShareData.resourcepacks.length}</span>
                      <span className="stat-label">Packs</span>
                    </div>
                    <div className="preview-stat">
                      <span className="stat-value">{decodedShareData.shaders.length}</span>
                      <span className="stat-label">Shaders</span>
                    </div>
                    {decodedShareData.datapacks && decodedShareData.datapacks.length > 0 && (
                      <div className="preview-stat">
                        <span className="stat-value">{decodedShareData.datapacks.length}</span>
                        <span className="stat-label">Data</span>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>

            <div className="share-code-info">
              Note: Shares only include files from Modrinth. Manually added files won't be synced.
            </div>
          </div>
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
                    onClick={() => {
                      // Reset version when switching loaders to avoid stale values
                      if (loader.id !== modLoader) {
                        setSelectedLoaderVersion('');
                      }
                      setModLoader(loader.id);
                    }}
                  >
                    <div className="loader-icon">{loader.icon}</div>
                    <span className="loader-name">{loader.name}</span>
                  </button>
                ))}
            </div>

            {modLoader !== 'vanilla' && (
              <div style={{ marginTop: '16px', flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
                {loaderError ? (
                  <div className="loader-error-container">
                    <div className="loader-error-icon">⚠️</div>
                    <div className="loader-error-text">
                      <h4>Loader Unavailable</h4>
                      <p>{loaderError}</p>
                    </div>
                  </div>
                ) : (
                  <VersionSelector
                    versions={loaderVersions}
                    selectedVersion={selectedLoaderVersion}
                    onSelect={setSelectedLoaderVersion}
                    onRefresh={loadLoaderVersions}
                    loading={loaderLoading}
                    showFilters={false}
                  />
                )}
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
        {/* ---------- */}
        {/* Step Navigation */}
        {/* Description: Next/Create buttons, import mode has only 2 steps */}
        {/* ---------- */}
        {(creationMode === 'import' || creationMode === 'share-code' ? step < 1 : step < 2) ? (
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
            {isLoading ? (creationMode === 'import' || creationMode === 'share-code' ? 'Processing...' : 'Creating...') : (creationMode === 'import' ? 'Import Instance' : creationMode === 'share-code' ? 'Create Instance' : 'Create Instance')}
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
