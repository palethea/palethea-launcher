import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { open } from '@tauri-apps/plugin-dialog';
import { Loader2, ChevronDown, Check, ListFilterPlus, Settings2 } from 'lucide-react';
import './CreateInstance.css';
import VersionSelector from './VersionSelector';
import FilterModal from './FilterModal';

const MODPACK_CATEGORIES = [
  { id: 'all', label: 'All Categories' },
  { id: 'adventure', label: 'Adventure' },
  { id: 'challenging', label: 'Challenging' },
  { id: 'combat', label: 'Combat' },
  { id: 'kitchen-sink', label: 'Kitchen Sink' },
  { id: 'lightweight', label: 'Lightweight' },
  { id: 'magic', label: 'Magic' },
  { id: 'multiplayer', label: 'Multiplayer' },
  { id: 'optimization', label: 'Optimization' },
  { id: 'quests', label: 'Quests' },
  { id: 'technology', label: 'Technology' },
];

function CreateInstance({ onClose, onCreate, isLoading, mode = 'page' }) {
  // 1. State Hooks
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
  const [selectedModpackCategories, setSelectedModpackCategories] = useState([]);
  const [isFilterModalOpen, setIsFilterModalOpen] = useState(false);

  // Import state
  const [importZipPath, setImportZipPath] = useState('');
  const [importInfo, setImportInfo] = useState(null);

  // Share code state
  const [shareCode, setShareCode] = useState('');
  const [decodedShareData, setDecodedShareData] = useState(null);
  const [isDecoding, setIsDecoding] = useState(false);
  const [decodingError, setDecodingError] = useState('');

  // Pagination states
  const [modpackOffset, setModpackOffset] = useState(0);
  const [hasMoreModpacks, setHasMoreModpacks] = useState(true);
  const [loadingMoreModpacks, setLoadingMoreModpacks] = useState(false);

  // Java recommendation state
  const [selectedJava, setSelectedJava] = useState(21);
  const [isJavaInstalled, setIsJavaInstalled] = useState(false);
  const [isJavaChecking, setIsJavaChecking] = useState(false);
  const [isJavaDownloading, setIsJavaDownloading] = useState(false);
  const [javaDownloadError, setJavaDownloadError] = useState('');

  // Version loading state
  const [loadingVersions, setLoadingVersions] = useState(true);

  // 2. Ref Hooks
  const modpackObserver = useRef();

  // 3. useMemo hooks
  const canNextFromName = useMemo(() => (creationMode === 'import' || creationMode === 'share-code') ? true : name.trim().length > 0, [creationMode, name]);
  
  const canNextFromVersion = useMemo(() => creationMode === 'version'
    ? !!selectedVersion
    : creationMode === 'modpack'
      ? !!selectedModpack
      : creationMode === 'share-code'
        ? !!decodedShareData
        : !!importZipPath, [creationMode, selectedVersion, selectedModpack, decodedShareData, importZipPath]);
  
  const canNextFromLoader = useMemo(() => creationMode === 'version'
    ? (modLoader === 'vanilla' || !!selectedLoaderVersion)
    : creationMode === 'modpack'
      ? !!selectedModpackVersion
      : true, [creationMode, modLoader, selectedLoaderVersion, selectedModpackVersion]);
  
  const canCreate = useMemo(() => creationMode === 'version'
    ? (name.trim() && selectedVersion && (modLoader === 'vanilla' || selectedLoaderVersion))
    : creationMode === 'modpack'
      ? (name.trim() && selectedModpack && selectedModpackVersion)
      : creationMode === 'share-code'
        ? !!decodedShareData
        : !!importZipPath, [creationMode, name, selectedVersion, modLoader, selectedLoaderVersion, selectedModpack, selectedModpackVersion, decodedShareData, importZipPath]);

  // 4. useCallback hooks
  const loadVersions = useCallback(async () => {
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
  }, [selectedVersion]);

  const handleSearchModpacks = useCallback(async (queryOverride) => {
    const query = queryOverride !== undefined ? queryOverride : modpackSearch;
    setModpacksLoading(true);
    setModpacks([]); // Clear results immediately to show loading state
    setModpackOffset(0);
    setHasMoreModpacks(true);
    try {
      const result = await invoke('search_modrinth', {
        query: query,
        projectType: 'modpack',
        categories: selectedModpackCategories.length > 0 ? selectedModpackCategories : null,
        limit: 20,
        offset: 0
      });
      setModpacks(result.hits || []);
      setHasMoreModpacks((result.hits || []).length === 20 && result.total_hits > 20);
      setModpackOffset((result.hits || []).length);
    } catch (error) {
      console.error('Failed to search modpacks:', error);
    }
    setModpacksLoading(false);
  }, [modpackSearch, selectedModpackCategories]);

  const handleLoadMoreModpacks = useCallback(async () => {
    if (loadingMoreModpacks || !hasMoreModpacks) return;
    setLoadingMoreModpacks(true);
    try {
      const result = await invoke('search_modrinth', {
        query: modpackSearch,
        projectType: 'modpack',
        categories: selectedModpackCategories.length > 0 ? selectedModpackCategories : null,
        limit: 20,
        offset: modpackOffset
      });
      const newHits = result.hits || [];
      if (newHits.length > 0) {
        setModpacks(prev => [...prev, ...newHits]);
        setModpackOffset(prev => prev + newHits.length);
      }
      setHasMoreModpacks(newHits.length === 20 && (modpackOffset + newHits.length) < result.total_hits);
    } catch (error) {
      console.error('Failed to load more modpacks:', error);
    }
    setLoadingMoreModpacks(false);
  }, [loadingMoreModpacks, hasMoreModpacks, modpackSearch, modpackOffset, selectedModpackCategories]);

  const loadLoaderVersions = useCallback(async () => {
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
  }, [modLoader, selectedVersion]);

  const calculateTotalSize = useCallback(async (versionId) => {
    setSizeLoading(true);
    try {
      const size = await invoke('get_modpack_total_size', { versionId });
      setModpackTotalSize(size);
    } catch (error) {
      console.error('Failed to calculate modpack size:', error);
      setModpackTotalSize(null);
    }
    setSizeLoading(false);
  }, []);

  const lastModpackRef = useCallback(node => {
    if (modpacksLoading || loadingMoreModpacks) return;
    if (modpackObserver.current) modpackObserver.current.disconnect();
    
    modpackObserver.current = new IntersectionObserver(entries => {
      if (entries[0].isIntersecting && hasMoreModpacks) {
        handleLoadMoreModpacks();
      }
    });
    
    if (node) modpackObserver.current.observe(node);
  }, [modpacksLoading, loadingMoreModpacks, hasMoreModpacks, handleLoadMoreModpacks]);

  const getRecommendedJava = useCallback((mcVersion) => {
    if (!mcVersion) return 21;
    try {
      // Extract major/minor version
      const parts = mcVersion.split('.');
      if (parts.length < 2) return 21;
      const minor = parseInt(parts[1]);
      
      // Minecraft 1.20.5+ requires Java 21
      // Note: 1.20.5 is basically minor 20 with specific patch, but we check common versions
      if (minor >= 21) return 21;
      if (minor === 20) {
        const patch = parts.length > 2 ? parseInt(parts[2]) : 0;
        if (patch >= 5) return 21;
        return 17;
      }
      
      if (minor >= 18) return 17;
      if (minor === 17) return 16;
      return 8;
    } catch (e) {
      return 17;
    }
  }, []);

  const handleSelectModpack = useCallback(async (mp) => {
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
  }, []);

  const handleSelectZipFile = useCallback(async () => {
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

        try {
          const metadata = await invoke('peek_instance_zip', { zipPath: selected });
          setImportInfo(metadata);
        } catch (peekError) {
          console.error('Failed to peek zip metadata:', peekError);
        }
      }
    } catch (error) {
      console.error('Failed to select file:', error);
    }
  }, [name]);

  const handleDecodeShareCode = useCallback(async (code) => {
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
  }, [name]);

  const handleCreate = useCallback(async () => {
    // If Java is not installed, we download it first
    if (!isJavaInstalled) {
      setIsJavaDownloading(true);
      setJavaDownloadError('');
      try {
        await invoke('download_java_global', { version: selectedJava });
        setIsJavaInstalled(true);
      } catch (e) {
        setJavaDownloadError(`Failed to download Java: ${e}`);
        setIsJavaDownloading(false);
        return;
      }
      setIsJavaDownloading(false);
    }

    if (creationMode === 'version') {
      if (name.trim() && selectedVersion) {
        onCreate(name.trim(), selectedVersion, modLoader, (selectedLoaderVersion || null), selectedJava);
      }
    } else if (creationMode === 'modpack') {
      if (name.trim() && selectedModpack && selectedModpackVersion) {
        // Pass specialized data for modpack creation
        onCreate(name.trim(), 'modpack', 'modpack', {
          modpackId: selectedModpack.project_id,
          versionId: selectedModpackVersion.id,
          modpackName: selectedModpack.title,
          modpackIcon: selectedModpack.icon_url
        }, selectedJava);
      }
    } else if (creationMode === 'import') {
      if (importZipPath) {
        // Pass import data
        onCreate(name.trim() || null, 'import', 'import', {
          zipPath: importZipPath
        }, selectedJava);
      }
    } else if (creationMode === 'share-code') {
      if (decodedShareData) {
        onCreate(name.trim() || decodedShareData.name, 'share-code', 'share-code', {
          shareData: decodedShareData
        }, selectedJava);
      }
    }
  }, [isJavaInstalled, selectedJava, creationMode, name, selectedVersion, modLoader, selectedLoaderVersion, selectedModpack, selectedModpackVersion, importZipPath, decodedShareData, onCreate]);

  // 5. useEffect hooks
  useEffect(() => {
    if (creationMode === 'modpack') {
      handleSearchModpacks();
    }
  }, [selectedModpackCategories, handleSearchModpacks, creationMode]);

  useEffect(() => {
    loadVersions();
    handleSearchModpacks(""); // Load popular modpacks by default
  }, [loadVersions, handleSearchModpacks]);

  useEffect(() => {
    if (selectedVersion && modLoader !== 'vanilla') {
      loadLoaderVersions();
    }
  }, [selectedVersion, modLoader, loadLoaderVersions]);

  useEffect(() => {
    if (selectedModpackVersion) {
      calculateTotalSize(selectedModpackVersion.id);
    } else {
      setModpackTotalSize(null);
    }
  }, [selectedModpackVersion, calculateTotalSize]);

  useEffect(() => {
    const checkJava = async () => {
      setIsJavaChecking(true);
      try {
        const installed = await invoke('is_java_version_installed', { version: selectedJava });
        setIsJavaInstalled(installed);
      } catch (e) {
        console.error('Failed to check Java:', e);
      }
      setIsJavaChecking(false);
    };

    if (step === 3) {
      checkJava();
    }
  }, [step, selectedJava]);

  useEffect(() => {
    // When selected version changes, update recommended java
    let mcVersion = null;
    if (creationMode === 'version') {
      mcVersion = selectedVersion;
    } else if (creationMode === 'modpack' && selectedModpackVersion) {
      mcVersion = selectedModpackVersion.game_versions[0];
    } else if (creationMode === 'share-code' && decodedShareData) {
      mcVersion = decodedShareData.version;
    } else if (creationMode === 'import' && importInfo) {
      mcVersion = importInfo.version_id;
    }

    if (mcVersion) {
      setSelectedJava(getRecommendedJava(mcVersion));
    }
  }, [selectedVersion, selectedModpackVersion, decodedShareData, importInfo, creationMode, getRecommendedJava]);

  const isPage = mode === 'page';

  const content = (
    <div className={isPage ? 'create-page' : 'modal'} onClick={(e) => e.stopPropagation()}>
      <FilterModal 
        isOpen={isFilterModalOpen}
        onClose={() => setIsFilterModalOpen(false)}
        categories={MODPACK_CATEGORIES}
        selectedCategories={selectedModpackCategories}
        onApply={setSelectedModpackCategories}
        title="Modpack Filters"
      />
      <div className={isPage ? 'create-header' : 'modal-header'}>
        <h2>{creationMode === 'import'
          ? (step === 0 ? 'Instance Identity' : step === 1 ? 'Select File' : 'Java Environment')
          : (step === 0 ? 'Instance Identity' : step === 1 ? 'Minecraft Version' : step === 2 ? 'Modifications' : 'Java Environment')
        }</h2>
        {!isPage && <button className="close-btn" onClick={onClose}>×</button>}
      </div>

      <div className="create-steps">
        <div className={`create-step ${step === 0 ? 'active' : ''}`}>Setup</div>
        {creationMode === 'import' ? (
          <>
            <div className={`create-step ${step === 1 ? 'active' : ''}`}>Select File</div>
            <div className={`create-step ${step === 2 ? 'active' : ''}`}>Java</div>
          </>
        ) : (
          <>
            <div className={`create-step ${step === 1 ? 'active' : ''}`}>Version</div>
            <div className={`create-step ${step === 2 ? 'active' : ''}`}>Loader</div>
            <div className={`create-step ${step === 3 ? 'active' : ''}`}>Java</div>
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
                <button 
                  className={`filter-btn-modal ${selectedModpackCategories.length > 0 ? 'active' : ''}`}
                  onClick={() => setIsFilterModalOpen(true)}
                  title="Filter by Categories"
                >
                  <ListFilterPlus size={18} />
                  <span>Filters</span>
                  {selectedModpackCategories.length > 0 && (
                    <span className="filter-count">{selectedModpackCategories.length}</span>
                  )}
                </button>

                <div className="search-input-wrapper-refined">
                  <div className="search-box-wide">
                    <input
                      type="text"
                      value={modpackSearch}
                      onChange={(e) => setModpackSearch(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && handleSearchModpacks()}
                      placeholder="Search Modrinth modpacks..."
                    />
                  </div>
                </div>

                <button
                  className="search-btn"
                  onClick={() => handleSearchModpacks()}
                  disabled={modpacksLoading}
                >
                  {modpacksLoading ? <Loader2 className="spin" size={18} /> : 'Search'}
                </button>
              </div>
            </div>

            <div className="version-list" style={{ flex: 1, minHeight: 0 }}>
              {modpacks.length === 0 ? (
                <div className="empty-state">
                  <p>
                    {modpacksLoading 
                      ? 'Searching Modrinth...' 
                      : (modpackSearch.trim() || selectedModpackCategories.length > 0 
                          ? `No modpacks found for your search.` 
                          : 'Enter a search term to find modpacks.')}
                  </p>
                </div>
              ) : (
                <div className="modpack-grid">
                  {modpacks.map((mp, index) => (
                    <div
                      key={`${mp.project_id}-${index}`}
                      className={`modpack-card ${selectedModpack?.project_id === mp.project_id ? 'selected' : ''}`}
                      onClick={() => handleSelectModpack(mp)}
                      ref={index === modpacks.length - 1 ? lastModpackRef : null}
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
                  {loadingMoreModpacks && (
                    <div className="modpack-card loading-card">
                      <div className="loading-more-container">
                        <Loader2 className="spin-icon" size={20} />
                        <span>Loading more...</span>
                      </div>
                    </div>
                  )}
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

        {((creationMode === 'import' || creationMode === 'share-code') ? step === 2 : step === 3) && (
          <div className="java-step">
            <div className="java-recommendation">
              <div className="recommendation-icon">☕</div>
              <div className="recommendation-text">
                <h3>Java Environment</h3>
                <p>
                  Minecraft {creationMode === 'version' ? selectedVersion : 
                     creationMode === 'modpack' ? selectedModpackVersion?.game_versions[0] : 
                     creationMode === 'share-code' ? decodedShareData?.version : 
                     creationMode === 'import' ? importInfo?.version_id : ''}{' '}
                  runs best with <strong>Java {getRecommendedJava(
                    creationMode === 'version' ? selectedVersion : 
                    creationMode === 'modpack' ? selectedModpackVersion?.game_versions[0] : 
                    creationMode === 'share-code' ? decodedShareData?.version : 
                    creationMode === 'import' ? importInfo?.version_id : ''
                  )}</strong>.
                </p>
              </div>
            </div>

            <div className="java-selector-grid">
              {[8, 16, 17, 21].map(v => {
                const isRecommended = v === getRecommendedJava(
                  creationMode === 'version' ? selectedVersion : 
                  creationMode === 'modpack' ? selectedModpackVersion?.game_versions[0] : 
                  creationMode === 'share-code' ? decodedShareData?.version : 
                  creationMode === 'import' ? importInfo?.version_id : ''
                );
                return (
                  <div 
                    key={v} 
                    className={`java-option-card ${selectedJava === v ? 'active' : ''} ${isRecommended ? 'recommended' : ''}`}
                    onClick={() => setSelectedJava(v)}
                  >
                    {isRecommended && <div className="recommended-badge">Recommended</div>}
                    <div className="java-version-info">
                      <span className="java-version-name">Java {v}</span>
                      <span className="java-vendor"> {' '}LTS OpenJDK</span>
                    </div>
                    <div className="java-status">
                      {isJavaChecking && selectedJava === v ? (
                        <div className="mini-spinner"></div>
                      ) : (
                        // We can't easily check all versions at once without more backend commands,
                        // so we just show "Selected" vs "Available"
                        selectedJava === v ? (
                          isJavaInstalled ? "✓ Ready" : "⬇ Needs Download"
                        ) : ""
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            {!isJavaInstalled && !isJavaChecking && (
              <div className="java-download-prompt active">
                <div className="prompt-icon">ℹ</div>
                <div className="prompt-content">
                  <h4>Download Required</h4>
                  <p>Java {selectedJava} will be automatically downloaded and configured for this instance when you click Create.</p>
                </div>
              </div>
            )}

            {javaDownloadError && <div className="error-message">{javaDownloadError}</div>}
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
        {(creationMode === 'import' || creationMode === 'share-code' ? step < 2 : step < 3) ? (
          <button
            className="btn btn-primary"
            onClick={() => setStep(step + 1)}
            disabled={
              isLoading || 
              (step === 0 && !canNextFromName) || 
              (step === 1 && !canNextFromVersion) ||
              (step === 2 && !canNextFromLoader)
            }
          >
            Next
          </button>
        ) : (
          <button
            className="btn btn-primary"
            onClick={handleCreate}
            disabled={!canCreate || isLoading || isJavaDownloading}
          >
            {isLoading ? (creationMode === 'import' || creationMode === 'share-code' ? 'Processing...' : 'Creating...') : 
             (isJavaDownloading ? 'Downloading Java...' : 
              (creationMode === 'import' ? 'Import Instance' : 'Create Instance'))}
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
