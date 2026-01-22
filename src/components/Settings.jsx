import { useState, useEffect } from 'react';
import { getVersion } from '@tauri-apps/api/app';
import { invoke } from '@tauri-apps/api/core';
import { open } from '@tauri-apps/plugin-dialog';
import './Settings.css';

function Settings({ username, onSetUsername, isLoggedIn, onLogin, onLogout, launcherSettings, onSettingsUpdated }) {
  const [newUsername, setNewUsername] = useState(username);
  const [javaPath, setJavaPath] = useState('');
  const [customJavaPath, setCustomJavaPath] = useState('');
  const [dataDir, setDataDir] = useState('');
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const [loginCode, setLoginCode] = useState(null);
  const [diskUsage, setDiskUsage] = useState(null);
  const [downloadedVersions, setDownloadedVersions] = useState([]);
  const [isCleaning, setIsCleaning] = useState(false);
  const [appVersion, setAppVersion] = useState('0.2.0');
  const [javaDownloadVersion, setJavaDownloadVersion] = useState('21');
  const [javaDownloading, setJavaDownloading] = useState(false);
  const [javaDownloadError, setJavaDownloadError] = useState('');

  useEffect(() => {
    // Throttle settings load to prevent repeated calls on tab switch
    const lastLoad = sessionStorage.getItem('last_settings_load');
    const now = Date.now();
    const shouldRefresh = !lastLoad || now - parseInt(lastLoad) > 30000;

    if (shouldRefresh) {
      sessionStorage.setItem('last_settings_load', now.toString());
      checkJava();
      getDataDirectory();
      loadCustomJavaPath();
      loadStorageInfo();
    } else {
      // Load from session cache if available
      const cachedJavaPath = sessionStorage.getItem('cached_java_path');
      const cachedDataDir = sessionStorage.getItem('cached_data_dir');
      const cachedCustomJava = sessionStorage.getItem('cached_custom_java');
      if (cachedJavaPath) setJavaPath(cachedJavaPath);
      if (cachedDataDir) setDataDir(cachedDataDir);
      if (cachedCustomJava) setCustomJavaPath(cachedCustomJava);
    }
    getVersion().then(setAppVersion);
  }, []);

  useEffect(() => {
    setNewUsername(username);
  }, [username]);

  const checkJava = async () => {
    try {
      const path = await invoke('check_java');
      setJavaPath(path);
      sessionStorage.setItem('cached_java_path', path);
    } catch (error) {
      setJavaPath('Not found');
      sessionStorage.setItem('cached_java_path', 'Not found');
    }
  };

  const getDataDirectory = async () => {
    try {
      const dir = await invoke('get_data_directory');
      setDataDir(dir);
      sessionStorage.setItem('cached_data_dir', dir);
    } catch (error) {
      console.error('Failed to get data directory:', error);
    }
  };

  const loadCustomJavaPath = async () => {
    try {
      const path = await invoke('get_java_path');
      if (path) {
        setCustomJavaPath(path);
        sessionStorage.setItem('cached_custom_java', path);
      }
    } catch (error) {
      console.error('Failed to load Java path:', error);
    }
  };

  const handleSaveUsername = () => {
    if (newUsername.trim() && newUsername !== username) {
      onSetUsername(newUsername.trim());
    }
  };

  const handleBrowseJava = async () => {
    try {
      const selected = await open({
        multiple: false,
        filters: [{
          name: 'Java Executable',
          extensions: process.platform === 'win32' ? ['exe'] : ['*']
        }]
      });

      if (selected) {
        setCustomJavaPath(selected);
        await invoke('set_java_path', { path: selected });
        await checkJava();
      }
    } catch (error) {
      console.error('Failed to select Java:', error);
    }
  };

  const handleClearJavaPath = async () => {
    try {
      setCustomJavaPath('');
      await invoke('set_java_path', { path: null });
      await checkJava();
    } catch (error) {
      console.error('Failed to clear Java path:', error);
    }
  };

  const handleDownloadJava = async () => {
    setJavaDownloading(true);
    setJavaDownloadError('');
    try {
      const downloadedPath = await invoke('download_java_global', {
        version: parseInt(javaDownloadVersion, 10),
      });
      setCustomJavaPath(downloadedPath);
      await invoke('set_java_path', { path: downloadedPath });
      await checkJava();
    } catch (error) {
      console.error('Failed to download Java:', error);
      setJavaDownloadError('Failed to download Java: ' + error);
    }
    setJavaDownloading(false);
  };

  const handleMicrosoftLogin = async () => {
    setIsLoggingIn(true);
    try {
      const codeInfo = await invoke('start_microsoft_login');
      setLoginCode(codeInfo);

      // Poll for login completion
      const pollInterval = setInterval(async () => {
        try {
          const newUser = await invoke('poll_microsoft_login', {
            deviceCode: codeInfo.device_code
          });
          clearInterval(pollInterval);
          setLoginCode(null);
          setIsLoggingIn(false);
          onLogin(newUser);
        } catch (error) {
          // "authorization_pending" is expected while waiting
          if (!error.includes('authorization_pending')) {
            console.error('Login error:', error);
            if (error.includes('expired') || error.includes('denied')) {
              clearInterval(pollInterval);
              setLoginCode(null);
              setIsLoggingIn(false);
            }
          }
        }
      }, (codeInfo.interval || 5) * 1000);

      // Timeout after 5 minutes
      setTimeout(() => {
        clearInterval(pollInterval);
        setLoginCode(null);
        setIsLoggingIn(false);
      }, 5 * 60 * 1000);

    } catch (error) {
      console.error('Failed to start login:', error);
      setIsLoggingIn(false);
    }
  };

  const loadStorageInfo = async () => {
    try {
      const usage = await invoke('get_disk_usage');
      setDiskUsage(usage);

      const versions = await invoke('get_downloaded_versions');
      setDownloadedVersions(versions);
    } catch (error) {
      console.error('Failed to load storage info:', error);
    }
  };

  const handleClearAssets = async () => {
    if (!confirm('Are you sure you want to clear the assets cache? This will save space but requires re-downloading assets when launching games.')) {
      return;
    }

    setIsCleaning(true);
    try {
      await invoke('clear_assets_cache');
      await loadStorageInfo();
    } catch (error) {
      console.error('Failed to clear assets:', error);
      alert(`Failed to clear assets: ${error}`);
    }
    setIsCleaning(false);
  };

  const handleDeleteVersion = async (versionId) => {
    if (!confirm(`Are you sure you want to delete Minecraft version ${versionId}?`)) {
      return;
    }

    try {
      await invoke('delete_version', { versionId });
      await loadStorageInfo();
    } catch (error) {
      console.error('Failed to delete version:', error);
      alert(`Failed to delete version: ${error}`);
    }
  };

  const formatSize = (bytes) => {
    if (!bytes) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    let size = bytes;
    let unitIndex = 0;
    while (size >= 1024 && unitIndex < units.length - 1) {
      size /= 1024;
      unitIndex++;
    }
    return `${size.toFixed(1)} ${units[unitIndex]}`;
  };

  const handleLogout = async () => {
    try {
      await invoke('logout');
      onLogout();
    } catch (error) {
      console.error('Failed to logout:', error);
    }
  };

  return (
    <div className="settings">
      <div className="settings-header">
        <h1>Settings</h1>
        <p className="subtitle">Configure your launcher preferences</p>
      </div>

      <div className="settings-content">
        <section className="settings-section">
          <h2>Account</h2>

          {isLoggedIn ? (
            <div className="setting-item">
              <label>Microsoft Account</label>
              <div className="account-info">
                <span className="account-username">{username}</span>
                <span className="account-badge">Microsoft</span>
              </div>
              <button className="btn btn-secondary" onClick={handleLogout}>
                Sign Out
              </button>
            </div>
          ) : (
            <>
              <div className="setting-item">
                <label>Microsoft Login</label>
                {loginCode ? (
                  <div className="login-code-box">
                    <p>Go to <a href={loginCode.verification_uri} target="_blank" rel="noopener noreferrer">{loginCode.verification_uri}</a></p>
                    <p>Enter code: <strong className="login-code">{loginCode.user_code}</strong></p>
                  </div>
                ) : (
                  <button
                    className="btn btn-primary"
                    onClick={handleMicrosoftLogin}
                    disabled={isLoggingIn}
                  >
                    {isLoggingIn ? 'Waiting...' : 'Sign in with Microsoft'}
                  </button>
                )}
                <p className="setting-hint">
                  Sign in with your Microsoft account to play on online servers.
                </p>
              </div>

              <div className="setting-item">
                <label>Offline Mode</label>
                <div className="input-group">
                  <input
                    type="text"
                    value={newUsername}
                    onChange={(e) => setNewUsername(e.target.value)}
                    placeholder="Enter username"
                    maxLength={16}
                  />
                  <button
                    className="btn btn-primary"
                    onClick={handleSaveUsername}
                    disabled={!newUsername.trim() || newUsername === username}
                  >
                    Save
                  </button>
                </div>
                <p className="setting-hint">
                  Play offline with a custom username. Max 16 characters.
                </p>
              </div>
            </>
          )}
        </section>

        <section className="settings-section">
          <h2>Java</h2>
          <div className="setting-item">
            <label>Java Installation</label>
            <div className="info-box">
              <span className={`status-indicator ${javaPath !== 'Not found' ? 'success' : 'error'}`}></span>
              <span className="info-text">{javaPath}</span>
            </div>
          </div>

          <div className="setting-item">
            <label>Quick Java Install</label>
            <div className="input-group">
              <select
                value={javaDownloadVersion}
                onChange={(e) => setJavaDownloadVersion(e.target.value)}
              >
                <option value="8">Java 8 (Legacy)</option>
                <option value="17">Java 17</option>
                <option value="21">Java 21 (Recommended)</option>
              </select>
              <button
                className="btn btn-secondary"
                onClick={handleDownloadJava}
                disabled={javaDownloading}
              >
                {javaDownloading ? 'Downloading...' : 'Install'}
              </button>
            </div>
            {javaDownloadError && (
              <p className="setting-hint" style={{ color: '#f56565' }}>{javaDownloadError}</p>
            )}
            <p className="setting-hint">
              Automatically download and set the selected Java version.
            </p>
          </div>

          <div className="setting-item">
            <label>Custom Java Path</label>
            <div className="input-group">
              <input
                type="text"
                value={customJavaPath}
                onChange={(e) => setCustomJavaPath(e.target.value)}
                placeholder="Auto-detect"
                readOnly
              />
              <button className="btn btn-secondary" onClick={handleBrowseJava}>
                Browse
              </button>
              {customJavaPath && (
                <button className="btn btn-secondary" onClick={handleClearJavaPath}>
                  Clear
                </button>
              )}
            </div>
            <p className="setting-hint">
              Set a custom Java path, or leave empty to auto-detect.
            </p>
          </div>
        </section>

        <section className="settings-section">
          <h2>Storage</h2>
          <div className="setting-item">
            <label>Data Directory</label>
            <div className="info-box">
              <span className="info-text">{dataDir}</span>
            </div>
          </div>

          {diskUsage && (
            <div className="disk-usage">
              <div className="disk-usage-summary">
                <div className="disk-usage-item">
                  <span className="label">Total Space:</span>
                  <span className="value">{formatSize(diskUsage.total)}</span>
                </div>
                <div className="disk-usage-item">
                  <span className="label">Assets:</span>
                  <span className="value">{formatSize(diskUsage.assets)}</span>
                </div>
                <div className="disk-usage-item">
                  <span className="label">Versions:</span>
                  <span className="value">{formatSize(diskUsage.versions)}</span>
                </div>
                <div className="disk-usage-item">
                  <span className="label">Libraries:</span>
                  <span className="value">{formatSize(diskUsage.libraries)}</span>
                </div>
                <div className="disk-usage-item">
                  <span className="label">Instances:</span>
                  <span className="value">{formatSize(diskUsage.instances)}</span>
                </div>
                <div className="disk-usage-item">
                  <span className="label">Java:</span>
                  <span className="value">{formatSize(diskUsage.java)}</span>
                </div>
              </div>

              <div className="disk-actions">
                <button
                  className="btn btn-secondary"
                  onClick={handleClearAssets}
                  disabled={isCleaning}
                >
                  {isCleaning ? 'Cleaning...' : 'Clear Assets Cache'}
                </button>
              </div>
            </div>
          )}

          <div className="downloaded-versions">
            <h3>Downloaded Versions</h3>
            {downloadedVersions.length === 0 ? (
              <p className="no-data">No versions downloaded yet.</p>
            ) : (
              <div className="version-management-list">
                {downloadedVersions.map(v => (
                  <div key={v.id} className="version-management-item">
                    <div className="version-details">
                      <span className="version-id">{v.id}</span>
                      <span className="version-size">{formatSize(v.size)}</span>
                    </div>
                    <button
                      className="btn-icon delete"
                      onClick={() => handleDeleteVersion(v.id)}
                      title="Delete version files"
                    >
                      <svg
                        className="delete-svg"
                        viewBox="0 0 24 24"
                        width="18"
                        height="18"
                        stroke="#f87171"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        fill="none"
                        aria-hidden="true"
                      >
                        <path d="M3 6h18" />
                        <path d="M8 6V4h8v2" />
                        <path d="M10 11v6" />
                        <path d="M14 11v6" />
                        <path d="M6 6l1 14h10l1-14" />
                      </svg>
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>

        <section className="settings-section">
          <h2>Interface</h2>
          <div className="setting-item">
            <div className="checkbox-row">
              <label>Enable Console Button</label>
              <input
                type="checkbox"
                className="ios-switch"
                checked={launcherSettings?.enable_console || false}
                onChange={async (e) => {
                  const updated = {
                    ...launcherSettings,
                    enable_console: e.target.checked
                  };
                  await invoke('save_settings', { newSettings: updated });
                  onSettingsUpdated();
                }}
              />
            </div>
            <p className="setting-hint">
              Show a dedicated console button in the sidebar for debugging and logs.
            </p>
          </div>

          <div className="setting-item">
            <div className="checkbox-row">
              <label>Account Preview Mode</label>
              <select
                value={launcherSettings?.account_preview_mode || 'simple'}
                onChange={async (e) => {
                  const updated = {
                    ...launcherSettings,
                    account_preview_mode: e.target.value
                  };
                  await invoke('save_settings', { newSettings: updated });
                  onSettingsUpdated();
                }}
                className="setting-select"
              >
                <option value="simple">Simple (Dropdown)</option>
                <option value="advanced">Advanced (Modal)</option>
              </select>
            </div>
            <p className="setting-hint">
              "Simple" uses a sidebar dropdown. "Advanced" uses a dedicated account management modal.
            </p>
          </div>

          <div className="setting-item">
            <div className="checkbox-row">
              <label>Show Welcome Screen</label>
              <input
                type="checkbox"
                className="ios-switch"
                checked={launcherSettings?.show_welcome !== false}
                onChange={async (e) => {
                  const updated = {
                    ...launcherSettings,
                    show_welcome: e.target.checked
                  };
                  await invoke('save_settings', { newSettings: updated });
                  onSettingsUpdated();
                }}
              />
            </div>
            <p className="setting-hint">
              Show the welcome screen overlay on startup.
            </p>
          </div>
        </section>

        <section className="settings-section">
          <h2>About</h2>
          <div className="about-info">
            <h3>Palethea Launcher</h3>
            <p className="version">Version {appVersion}</p>
            <p className="description">
              A high-performance Minecraft launcher designed for speed, customizability, and a modern adventure. Manage your instances, installations, and modpacks with ease.
            </p>
          </div>
        </section>
      </div>
    </div>
  );
}

export default Settings;
