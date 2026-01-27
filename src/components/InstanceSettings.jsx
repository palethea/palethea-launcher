import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { invoke, convertFileSrc } from '@tauri-apps/api/core';
import { open } from '@tauri-apps/plugin-dialog';
import { join } from '@tauri-apps/api/path';
import { Box, ChevronDown, ChevronUp, Cpu, Save, Trash2, Image, Check, Minus, Plus } from 'lucide-react';
import VersionSelector from './VersionSelector';
import IconPicker from './IconPicker';

function InstanceSettings({ instance, onSave, onInstanceUpdated, onShowConfirm, onDelete, onShowNotification, isScrolled }) {
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

  const [name, setName] = useState(instance.name);
  const [versionId, setVersionId] = useState(instance.version_id);
  const [colorAccent, setColorAccent] = useState(instance.color_accent || '#ffffff');
  const [modLoader, setModLoader] = useState(instance.mod_loader || 'Vanilla');
  const [modLoaderVersion, setModLoaderVersion] = useState(instance.mod_loader_version || '');
  const [javaPath, setJavaPath] = useState(instance.java_path || '');
  const [javaDownloadVersion, setJavaDownloadVersion] = useState(getRecommendedJava(instance.version_id).toString());
  const [showJavaDropdown, setShowJavaDropdown] = useState(false);
  const javaDropdownRef = useRef(null);
  const [javaDownloading, setJavaDownloading] = useState(false);
  const [javaDownloadError, setJavaDownloadError] = useState('');
  const [memory, setMemory] = useState(instance.memory_max || 4096);
  const [jvmArgs, setJvmArgs] = useState(instance.jvm_args || '');
  const [versions, setVersions] = useState([]);
  const [loaderVersions, setLoaderVersions] = useState([]);
  const [loadingLoaders, setLoadingLoaders] = useState(false);
  const [saving, setSaving] = useState(false);
  const [hasChanges, setHasChanges] = useState(false);
  const [logoSrc, setLogoSrc] = useState(null);
  const [logoUpdating, setLogoUpdating] = useState(false);
  const [showVersionSelector, setShowVersionSelector] = useState(false);
  const [showLoaderSelector, setShowLoaderSelector] = useState(false);
  const [showIconPicker, setShowIconPicker] = useState(false);
  const [installingLoader, setInstallingLoader] = useState(false);

  const loadVersions = useCallback(async () => {
    try {
      const vers = await invoke('get_versions');
      setVersions(vers);
    } catch (error) {
      console.error('Failed to load versions:', error);
    }
  }, []);

  useEffect(() => {
    loadVersions();
  }, [loadVersions]);

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (javaDropdownRef.current && !javaDropdownRef.current.contains(event.target)) {
        setShowJavaDropdown(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  useEffect(() => {
    // Update recommended Java version when Minecraft version changes
    const recommended = getRecommendedJava(versionId);
    setJavaDownloadVersion(recommended.toString());
  }, [versionId, getRecommendedJava]);

  const loadLoaderVersions = useCallback(async (loader) => {
    setLoadingLoaders(true);
    try {
      const vers = await invoke('get_loader_versions', {
        loader: loader.toLowerCase(),
        gameVersion: versionId
      });
      setLoaderVersions(vers);
      if (vers.length > 0 && !modLoaderVersion) {
        setModLoaderVersion(vers[0].version);
      }
    } catch (error) {
      console.error('Failed to load loader versions:', error);
      setLoaderVersions([]);
    }
    setLoadingLoaders(false);
  }, [versionId, modLoaderVersion]);

  useEffect(() => {
    if (modLoader !== 'Vanilla') {
      loadLoaderVersions(modLoader);
    } else {
      setLoaderVersions([]);
      setModLoaderVersion('');
    }
  }, [modLoader, versionId, loadLoaderVersions]);

  const checkChanges = useCallback(() => {
    const changed =
      name !== instance.name ||
      versionId !== instance.version_id ||
      colorAccent !== (instance.color_accent || '#ffffff') ||
      modLoader !== (instance.mod_loader || 'Vanilla') ||
      modLoaderVersion !== (instance.mod_loader_version || '') ||
      javaPath !== (instance.java_path || '') ||
      memory !== (instance.memory_max || 4096) ||
      jvmArgs !== (instance.jvm_args || '');
    setHasChanges(changed);
  }, [name, versionId, colorAccent, modLoader, modLoaderVersion, javaPath, memory, jvmArgs, instance]);

  useEffect(() => {
    checkChanges();
  }, [checkChanges]);

  useEffect(() => {
    let cancelled = false;

    const loadLogo = async () => {
      try {
        const baseDir = await invoke('get_data_directory');
        const filename = instance.logo_filename || 'minecraft_logo.png';
        const logoPath = await join(baseDir, 'instance_logos', filename);
        if (!cancelled) {
          setLogoSrc(convertFileSrc(logoPath));
        }
      } catch (error) {
        console.error('Failed to load logo:', error);
      }
    };

    loadLogo();

    return () => {
      cancelled = true;
    };
  }, [instance.id, instance.logo_filename]);

  const handleSave = useCallback(async () => {
    setSaving(true);
    try {
      const updatedInstance = {
        ...instance,
        name,
        version_id: versionId,
        color_accent: colorAccent || null,
        mod_loader: modLoader,
        mod_loader_version: modLoaderVersion || null,
        java_path: javaPath || null,
        memory_max: memory,
        jvm_args: jvmArgs || null,
      };
      const success = await onSave(updatedInstance);
      if (success) {
        setHasChanges(false);
      }
    } catch (error) {
      console.error('Failed to save:', error);
    }
    setSaving(false);
  }, [instance, name, versionId, colorAccent, modLoader, modLoaderVersion, javaPath, memory, jvmArgs, onSave]);

  const handleDownloadJava = useCallback(async () => {
    setJavaDownloading(true);
    setJavaDownloadError('');
    try {
      const updated = await invoke('download_java_for_instance', {
        instanceId: instance.id,
        version: parseInt(javaDownloadVersion, 10),
      });
      if (updated?.java_path) {
        setJavaPath(updated.java_path);
      }
      if (onInstanceUpdated) {
        onInstanceUpdated(updated);
      }
    } catch (error) {
      console.error('Failed to download Java:', error);
      setJavaDownloadError('Failed to download Java');
    }
    setJavaDownloading(false);
  }, [instance.id, javaDownloadVersion, onInstanceUpdated]);

  const handleOpenFolder = useCallback(async () => {
    try {
      await invoke('open_instance_folder', { instanceId: instance.id, folderType: 'root' });
    } catch (error) {
      console.error('Failed to open folder:', error);
      if (onShowNotification) {
        onShowNotification(`Failed to open instance folder: ${error}`, 'error');
      }
    }
  }, [instance.id, onShowNotification]);

  const handleChooseLogo = useCallback(() => {
    setShowIconPicker(true);
  }, []);

  const handleIconSelect = useCallback(async (icon, type) => {
    try {
      setLogoUpdating(true);
      if (type === 'clear') {
        const updated = await invoke('clear_instance_logo', { instanceId: instance.id });
        if (onInstanceUpdated) onInstanceUpdated(updated);
      } else if (type === 'stock') {
        const updated = await invoke('set_instance_logo_from_stock', { instanceId: instance.id, filename: icon });
        if (onInstanceUpdated) onInstanceUpdated(updated);
      } else if (type === 'custom') {
        const updated = await invoke('set_instance_logo', { instanceId: instance.id, filePath: icon });
        if (onInstanceUpdated) onInstanceUpdated(updated);
      }
    } catch (error) {
      console.error('Failed to update logo:', error);
      if (onShowNotification) onShowNotification('Failed to update logo: ' + error, 'error');
    }
    setLogoUpdating(false);
  }, [instance.id, onInstanceUpdated, onShowNotification]);

  const handleClearLogo = useCallback(async () => {
    try {
      setLogoUpdating(true);
      const updated = await invoke('clear_instance_logo', { instanceId: instance.id });
      if (onInstanceUpdated) {
        onInstanceUpdated(updated);
      }
    } catch (error) {
      console.error('Failed to clear logo:', error);
    }
    setLogoUpdating(false);
  }, [instance.id, onInstanceUpdated]);

  const handleDelete = useCallback(() => {
    if (onShowConfirm) {
      onShowConfirm({
        title: 'Delete Instance?',
        message: `Are you sure you want to delete "${instance.name}"? This action cannot be undone and all files will be lost.`,
        confirmText: 'Delete Permanently',
        cancelText: 'Cancel',
        variant: 'danger',
        onConfirm: () => {
          if (onDelete) onDelete(instance.id);
        }
      });
    }
  }, [instance.name, instance.id, onShowConfirm, onDelete]);

  const handleInstallLoader = useCallback(async () => {
    if (modLoader === 'Vanilla' || !modLoaderVersion) return;

    setInstallingLoader(true);
    try {
      const command = `install_${modLoader.toLowerCase()}`;
      await invoke(command, {
        instanceId: instance.id,
        loaderVersion: modLoaderVersion
      });

      // Update the instance to reflect the new loader/version
      const updatedInstance = {
        ...instance,
        mod_loader: modLoader,
        mod_loader_version: modLoaderVersion
      };
      await onSave(updatedInstance);
      setHasChanges(false);

      if (onShowConfirm) {
        onShowConfirm({
          title: 'Installation Successful',
          message: `${modLoader} ${modLoaderVersion} has been installed and configured for this instance.`,
          confirmText: 'Great',
          cancelText: null,
          onConfirm: () => { }
        });
      }
    } catch (error) {
      console.error(`Failed to install ${modLoader}:`, error);
      if (onShowConfirm) {
        onShowConfirm({
          title: 'Installation Failed',
          message: `Failed to install ${modLoader}: ${error}`,
          confirmText: 'Understood',
          cancelText: null,
          variant: 'danger',
          onConfirm: () => { }
        });
      }
    }
    setInstallingLoader(false);
  }, [modLoader, modLoaderVersion, instance, onSave, onShowConfirm]);

  const loaders = ['Vanilla', 'Fabric', 'Forge', 'NeoForge'];

  return (
    <div className="settings-tab">
      <div className="settings-scroll-content">
        <div className="settings-section">
          <h2>General</h2>
          <div className="setting-row">
            <label>Instance Name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div className="setting-row-vertical">
            <label>Game Version</label>
            <div
              className={`version-changer-preview ${showVersionSelector ? 'open' : ''}`}
              onClick={() => setShowVersionSelector(!showVersionSelector)}
            >
              <div className="version-changer-info">
                <Box size={16} />
                <span className="version-changer-label">Minecraft {versionId}</span>
              </div>
              {showVersionSelector ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
            </div>

            {showVersionSelector && (
              <div className="version-selector-expanded">
                <VersionSelector
                  versions={versions}
                  selectedVersion={versionId}
                  onSelect={(vid) => {
                    setVersionId(vid);
                  }}
                  onRefresh={loadVersions}
                />
              </div>
            )}
          </div>
          <div className="setting-row-vertical logo-row">
            <label>Instance Logo</label>
            <div className="logo-settings-container">
              <div className="logo-preview-box">
                {logoSrc ? (
                  <img
                    src={logoSrc}
                    alt=""
                    onError={(e) => {
                      if (!e.target.src.endsWith('/minecraft_logo.png')) {
                        e.target.src = '/minecraft_logo.png';
                      }
                    }}
                  />
                ) : (
                  <div className="logo-preview-fallback" />
                )}
              </div>
              <div className="logo-controls-stack">
                <div className="logo-buttons-row">
                  <button className="btn-logo-action primary" onClick={handleChooseLogo} disabled={logoUpdating}>
                    {logoUpdating ? 'Updating...' : 'Choose PNG'}
                  </button>
                  <button
                    className="btn-logo-action secondary"
                    onClick={handleClearLogo}
                    disabled={logoUpdating || !instance.logo_filename}
                  >
                    Clear
                  </button>
                </div>
                <span className="logo-hint-text">PNG only. Recommended 256×256.</span>
              </div>
            </div>
          </div>
        </div>

        <div className="settings-section">
          <h2>Mod Loader</h2>
          <div className="mod-loader-section">
            <div className="setting-row-vertical">
              <label>Loader Type</label>
              <div className="mod-loader-selection-row">
                <div className="mod-loader-options">
                  {loaders.map((loader) => (
                    <button
                      key={loader}
                      className={`loader-option ${modLoader === loader ? 'active' : ''}`}
                      onClick={() => {
                        setModLoader(loader);
                        // Reset version when switching loaders to avoid showing wrong version
                        if (loader !== modLoader) {
                          setModLoaderVersion('');
                        }
                        if (loader === 'Vanilla') {
                          setShowLoaderSelector(false);
                        }
                      }}
                    >
                      {loader}
                    </button>
                  ))}
                </div>

                {modLoader !== 'Vanilla' && (
                  <div className="loader-install-action inline">
                    <button
                      className={`btn-install-loader ${installingLoader ? 'loading' : ''} ${modLoader === instance.mod_loader && modLoaderVersion === instance.mod_loader_version ? 'installed' : ''
                        }`}
                      onClick={handleInstallLoader}
                      disabled={
                        installingLoader ||
                        !modLoaderVersion ||
                        (modLoader === instance.mod_loader && modLoaderVersion === instance.mod_loader_version)
                      }
                    >
                      {installingLoader ? 'Installing...' :
                        (modLoader === instance.mod_loader && modLoaderVersion === instance.mod_loader_version) ?
                          'Already Installed' : `Install ${modLoader} Version`}
                    </button>
                  </div>
                )}
              </div>
            </div>

            {modLoader !== 'Vanilla' && (
              <div className="setting-row-vertical" style={{ marginTop: '20px' }}>
                <label>{modLoader} Version</label>
                <div
                  className={`version-changer-preview ${showLoaderSelector ? 'open' : ''}`}
                  onClick={() => setShowLoaderSelector(!showLoaderSelector)}
                >
                  <div className="version-changer-info">
                    <Cpu size={16} />
                    <span className="version-changer-label">{modLoader} {modLoaderVersion || 'Select version...'}</span>
                  </div>
                  {showLoaderSelector ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
                </div>

                {showLoaderSelector && (
                  <div className="version-selector-expanded">
                    <VersionSelector
                      versions={loaderVersions}
                      selectedVersion={modLoaderVersion}
                      onSelect={(v) => {
                        setModLoaderVersion(v);
                      }}
                      onRefresh={() => loadLoaderVersions(modLoader)}
                      loading={loadingLoaders}
                      showFilters={false}
                    />
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        <div className="settings-section">
          <h2>Java Settings</h2>
          <div className="setting-row">
            <label>Quick Java Install</label>
            <div className="java-download-actions">
              <div className="p-dropdown" ref={javaDropdownRef}>
                <button 
                  className={`p-dropdown-trigger ${showJavaDropdown ? 'active' : ''}`}
                  onClick={() => setShowJavaDropdown(!showJavaDropdown)}
                  style={{ minWidth: '160px' }}
                >
                  <span>
                    Java {javaDownloadVersion} {javaDownloadVersion === getRecommendedJava(versionId).toString() ? '(Rec.)' : ''}
                  </span>
                  <ChevronDown size={14} className={`trigger-icon ${showJavaDropdown ? 'flip' : ''}`} />
                </button>

                {showJavaDropdown && (
                  <div className="p-dropdown-menu">
                    {[8, 16, 17, 21].map((v) => {
                      const verStr = v.toString();
                      const isRecommended = verStr === getRecommendedJava(versionId).toString();
                      return (
                        <div 
                          key={v}
                          className={`p-dropdown-item ${javaDownloadVersion === verStr ? 'selected' : ''}`}
                          onClick={() => {
                            setJavaDownloadVersion(verStr);
                            setShowJavaDropdown(false);
                          }}
                        >
                          <span>Java {v} {isRecommended ? '(Recommended)' : (v === 8 ? '(Legacy)' : '')}</span>
                          {javaDownloadVersion === verStr && <Check size={14} className="selected-icon" />}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
              <button
                className="btn btn-secondary"
                onClick={handleDownloadJava}
                disabled={javaDownloading}
              >
                {javaDownloading ? 'Downloading...' : 'Download'}
              </button>
            </div>
          </div>
          <p className="setting-hint" style={{ marginTop: '-12px', marginBottom: '12px', color: 'var(--text-secondary)', fontSize: '11px', lineHeight: '1.4' }}>
            <strong>Note:</strong> Java 21 for 1.20.5+ (including 1.21), Java 17 for 1.18–1.20.4, Java 16 for 1.17, and Java 8 for 1.16.5 and older.
          </p>
          {javaDownloadError && (
            <div className="java-download-error">{javaDownloadError}</div>
          )}
          <div className="setting-row">
            <label>Java Path</label>
            <input
              type="text"
              value={javaPath}
              onChange={(e) => setJavaPath(e.target.value)}
              placeholder="Use global setting"
            />
          </div>
          <div className="setting-row">
            <label>Memory (MB)</label>
            <div className="p-stepper">
              <input
                type="number"
                value={memory}
                onChange={(e) => setMemory(parseInt(e.target.value) || 4096)}
                min={512}
                max={32768}
                step={512}
              />
              <div className="p-stepper-actions">
                <button 
                  className="p-stepper-btn" 
                  onClick={() => setMemory(Math.max(512, memory - 512))}
                  disabled={memory <= 512}
                  title="Decrease Memory"
                >
                  <Minus size={16} />
                </button>
                <button 
                  className="p-stepper-btn" 
                  onClick={() => setMemory(Math.min(32768, memory + 512))}
                  disabled={memory >= 32768}
                  title="Increase Memory"
                >
                  <Plus size={16} />
                </button>
              </div>
            </div>
          </div>
          <div className="setting-row">
            <label>JVM Arguments</label>
            <input
              type="text"
              value={jvmArgs}
              onChange={(e) => setJvmArgs(e.target.value)}
              placeholder="-XX:+UseG1GC"
            />
          </div>
        </div>
      </div>


      <div className="settings-footer-bar">
        <button className="save-changes-btn" onClick={handleSave} disabled={!hasChanges || saving}>
          <Save size={18} />
          {saving ? 'Saving...' : 'Save Changes'}
        </button>
        <button className="delete-instance-btn" onClick={handleDelete}>
          <Trash2 size={16} />
          Delete Instance
        </button>
      </div>

      {showIconPicker && (
        <IconPicker
          instanceId={instance.id}
          currentIcon={instance.logo_filename}
          onClose={() => setShowIconPicker(false)}
          onSelect={handleIconSelect}
        />
      )}
    </div>
  );
}

export default InstanceSettings;
