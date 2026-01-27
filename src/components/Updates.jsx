import { useState, useEffect } from 'react';
import { getVersion } from '@tauri-apps/api/app';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { check } from '@tauri-apps/plugin-updater';
import { relaunch } from '@tauri-apps/plugin-process';
import { open } from '@tauri-apps/plugin-shell';
import { ExternalLink } from 'lucide-react';
import './Updates.css';

// ----------
// Updates Component
// Description: Manages launcher updates with proper prerelease version handling.
//              Supports switching between stable and prerelease update channels.
// ----------
function Updates() {
  const [currentVersion, setCurrentVersion] = useState('');
  const [isPrerelease, setIsPrerelease] = useState(false);
  const [updateChannel, setUpdateChannel] = useState('stable');
  const [updateInfo, setUpdateInfo] = useState(() => {
    const cached = localStorage.getItem('cached_update_info');
    return cached ? JSON.parse(cached) : null;
  });
  const [downgradeInfo, setDowngradeInfo] = useState(null); // For downgrading from prerelease to stable
  const [allReleases, setAllReleases] = useState(() => {
    const cached = localStorage.getItem('cached_all_releases');
    return cached ? JSON.parse(cached) : [];
  });

  // Effect to clear stale cached update info if version has changed
  useEffect(() => {
    const checkVersion = async () => {
      const version = await getVersion();
      if (updateInfo && updateInfo.version === version) {
        // App was updated to the version we had cached as "new"
        setUpdateInfo(null);
        localStorage.removeItem('cached_update_info');
      }
    };
    checkVersion();
  }, [updateInfo]);
  const [isChecking, setIsChecking] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState(0);
  const [error, setError] = useState(null);
  const [updateStatus, setUpdateStatus] = useState('idle'); // idle, downloading, ready, installing

  // ----------
  // Effect to load app version immediately
  // ----------
  useEffect(() => {
    const fetchVersion = async () => {
      try {
        const version = await getVersion();
        setCurrentVersion(version);
        const isPre = await invoke('is_prerelease_version', { version });
        setIsPrerelease(isPre);
      } catch (err) {
        console.error('Failed to get app version:', err);
      }
    };
    fetchVersion();
  }, []);

  // ----------
  // loadSettings
  // Description: Load the user's update channel preference from settings
  // ----------
  const loadSettings = async () => {
    try {
      const settings = await invoke('get_settings');
      if (settings.update_channel) {
        setUpdateChannel(settings.update_channel);
      }
    } catch (err) {
      console.error('Failed to load settings:', err);
    }
  };

  // ----------
  // saveUpdateChannel
  // Description: Persist the update channel preference to settings
  // ----------
  const saveUpdateChannel = async (channel) => {
    try {
      const settings = await invoke('get_settings');
      const updated = { ...settings, update_channel: channel };
      await invoke('save_settings', { newSettings: updated });
    } catch (err) {
      console.error('Failed to save update channel:', err);
    }
  };

  // ----------
  // handleChannelChange
  // Description: Handle update channel selection change
  // ----------
  const handleChannelChange = async (newChannel) => {
    setUpdateChannel(newChannel);
    await saveUpdateChannel(newChannel);
    // Re-check updates with new channel
    checkUpdates(newChannel, true);
  };

  // ----------
  // checkUpdates
  // Description: Check for available updates using custom version comparison logic
  //              that properly handles prerelease versions and downgrade opportunities
  // ----------
  const checkUpdates = async (channel = updateChannel, force = false) => {
    // Throttle automatic checks (only allow if 30s have passed)
    if (!force) {
      const lastCheck = localStorage.getItem('last_update_check');
      const now = Date.now();
      if (lastCheck && now - parseInt(lastCheck) < 30000) {
        if (import.meta.env.DEV) {
          invoke('log_event', { level: 'debug', message: 'Skipping throttled update check' }).catch(() => {});
        }
        return;
      }
    }

    setIsChecking(true);
    localStorage.setItem('last_update_check', Date.now().toString());
    setError(null);
    setDowngradeInfo(null); // Reset downgrade info
    try {
      await invoke('log_event', { level: 'info', message: `Checking for updates on channel: ${channel}` });

      // Get the current version
      const version = await getVersion();
      setCurrentVersion(version);

      // Check if current version is a prerelease
      const isPre = await invoke('is_prerelease_version', { version });
      setIsPrerelease(isPre);

      // Always fetch ALL releases to check for downgrade options
      const allReleasesData = await invoke('get_github_releases', { includePrerelease: true });

      // ----------
      // Sort releases by version (newest first)
      // Description: Use our backend compare_versions to sort properly, so 0.2.9-1 > 0.2.9
      // ----------
      const sortedReleases = [...allReleasesData].sort((a, b) => {
        const vA = a.tag_name.replace(/^v/, '');
        const vB = b.tag_name.replace(/^v/, '');
        // compare_versions returns 1 if v1 > v2, so we need to reverse for descending order
        // We'll do a simple inline comparison here for speed (avoids async in sort)
        const parseVer = (ver) => {
          const parts = ver.split('-');
          const main = parts[0].split('.').map(n => parseInt(n, 10) || 0);
          const pre = parts[1] ? parseInt(parts[1], 10) : null;
          return { main, pre };
        };
        const pA = parseVer(vA);
        const pB = parseVer(vB);
        // Compare main versions
        for (let i = 0; i < Math.max(pA.main.length, pB.main.length); i++) {
          const cA = pA.main[i] || 0;
          const cB = pB.main[i] || 0;
          if (cA !== cB) return cB - cA; // Descending
        }
        // Main versions equal, follow Standard SemVer: Base version is NEWER than prerelease
        if (pA.pre === null && pB.pre !== null) return -1; // A is base, B is pre -> A first (newest)
        if (pA.pre !== null && pB.pre === null) return 1;  // A is pre, B is base -> B first (newest)
        if (pA.pre !== null && pB.pre !== null) return pB.pre - pA.pre; // Both pre, higher is newest
        return 0;
      });

      setAllReleases(sortedReleases);
      localStorage.setItem('cached_all_releases', JSON.stringify(sortedReleases));

      if (sortedReleases.length === 0) {
        await invoke('log_event', { level: 'info', message: 'No releases found on GitHub' });
        setUpdateInfo(null);
        localStorage.removeItem('cached_update_info');
        localStorage.removeItem('cached_all_releases');
        return;
      }

      // Find the latest applicable release based on channel
      const includePrerelease = channel === 'prerelease';
      let latestRelease = null;
      if (includePrerelease) {
        latestRelease = sortedReleases[0]; // Now properly sorted by version
      } else {
        latestRelease = sortedReleases.find(r => !r.prerelease);
      }

      if (!latestRelease) {
        await invoke('log_event', { level: 'info', message: 'No applicable releases found' });
        setUpdateInfo(null);
        localStorage.removeItem('cached_update_info');
        return;
      }

      // Extract version from tag (remove 'v' prefix if present)
      const latestVersion = latestRelease.tag_name.replace(/^v/, '');

      // Use our custom compare_versions to properly handle prerelease versions
      // Returns: 1 if v1 > v2, -1 if v1 < v2, 0 if equal
      const comparison = await invoke('compare_versions', { v1: latestVersion, v2: version });

      await invoke('log_event', {
        level: 'info',
        message: `Version comparison: latest=${latestVersion}, current=${version}, result=${comparison}`
      });

      if (comparison > 0) {
        // There's a newer version available
        await invoke('log_event', { level: 'info', message: `Update found: v${latestVersion}` });
        const info = {
          version: latestVersion,
          body: latestRelease.body,
          date: latestRelease.published_at,
          isPrerelease: latestRelease.prerelease,
          htmlUrl: latestRelease.html_url,
        };
        setUpdateInfo(info);
        localStorage.setItem('cached_update_info', JSON.stringify(info));
      } else {
        setUpdateInfo(null);
        localStorage.removeItem('cached_update_info');

        // ----------
        // Downgrade Detection
        // Description: If user is on prerelease and viewing stable channel, offer downgrade option
        // ----------
        if (isPre && channel === 'stable') {
          const latestStable = allReleasesData.find(r => !r.prerelease);
          if (latestStable) {
            const stableVersion = latestStable.tag_name.replace(/^v/, '');
            await invoke('log_event', {
              level: 'info',
              message: `Downgrade available: ${version} -> ${stableVersion}`
            });
            setDowngradeInfo({
              version: stableVersion,
              body: latestStable.body,
              date: latestStable.published_at,
              htmlUrl: latestStable.html_url,
            });
          }
        } else {
          await invoke('log_event', { level: 'info', message: 'No updates found. App is up to date.' });
        }
      }
    } catch (err) {
      await invoke('log_event', { level: 'error', message: `Update check failed: ${err.toString()}` });
      console.error('Failed to check updates:', err);
      setError('Could not check for updates. Please try again later.');
    } finally {
      setIsChecking(false);
    }
  };

  // ----------
  // downloadAndInstall
  // Description: Download and install the available update or downgrade using Tauri's updater
  //              Falls back to direct installer download for pre-releases
  // ----------
  const downloadAndInstall = async () => {
    // Works for both updates and downgrades
    if (!updateInfo && !downgradeInfo) return;

    const targetVersion = updateInfo?.version || downgradeInfo?.version;
    const isPreRelease = updateInfo?.isPrerelease || false;

    setIsDownloading(true);
    setUpdateStatus('downloading');
    setDownloadProgress(0);
    setError(null);

    try {
      const update = await check();
      
      if (!update) {
        // Fallback: Direct download for pre-releases when Tauri updater doesn't work
        if (isPreRelease && targetVersion) {
          await invoke('log_event', { 
            level: 'info', 
            message: `Tauri updater unavailable, using direct installer download for v${targetVersion}` 
          });
          
          // Listen for download progress
          const unlisten = await listen('installer-download-progress', (event) => {
            setDownloadProgress(event.payload);
          });
          
          try {
            await invoke('download_and_run_installer', { version: targetVersion });
            // If successful, the app will exit and installer will run
          } finally {
            unlisten();
          }
          return;
        }
        
        throw new Error('Update manifest not found. This is common with Pre-releases. Please download manually from GitHub.');
      }

      let downloaded = 0;
      let contentLength = 0;

      await update.downloadAndInstall((event) => {
        switch (event.event) {
          case 'Started':
            contentLength = event.data.contentLength || 0;
            break;
          case 'Progress':
            downloaded += event.data.chunkLength;
            if (contentLength > 0) {
              setDownloadProgress(Math.round((downloaded / contentLength) * 100));
            }
            break;
          case 'Finished':
            setDownloadProgress(100);
            setUpdateStatus('ready');
            break;
        }
      });

      setUpdateStatus('installing');
      // Relaunch the app to apply the update
      await relaunch();
    } catch (err) {
      console.error('Failed to download/install update:', err);
      setError('Failed to download update: ' + err.message);
      setUpdateStatus('idle');
    } finally {
      setIsDownloading(false);
    }
  };

  useEffect(() => {
    loadSettings().then(() => {
      checkUpdates();
    });
  }, []);

  const hasUpdate = updateInfo !== null;

  // ----------
  // getChannelDescription
  // Description: Get helpful description text for the selected channel
  // ----------
  const getChannelDescription = (channel) => {
    if (channel === 'prerelease') {
      return 'Get the latest features first. Pre-release versions may be less stable.';
    }
    return 'Recommended for most users. Only receive stable, tested updates.';
  };

  return (
    <div className="updates-page">
      <header className="updates-header">
        <div>
          <h1>Updates</h1>
          <p className="subtitle">Keep the launcher current and see what changed.</p>
        </div>
        <div className="updates-actions">
          <button
            className={`btn ${isChecking ? 'btn-secondary' : 'btn-primary'}`}
            onClick={() => checkUpdates(updateChannel, true)}
            disabled={isChecking || isDownloading}
          >
            {isChecking ? 'Checking...' : 'Check for updates'}
          </button>
        </div>
      </header>

      {error && (
        <div className="error-notice">
          <span>{error}</span>
          {updateInfo?.htmlUrl && (
            <button 
              className="btn-link error-link"
              onClick={() => open(updateInfo.htmlUrl)}
            >
              Go to Download Page
            </button>
          )}
        </div>
      )}

      <section className="updates-status-grid">
        <div className="updates-card updates-status">
          <div className={`status-pill ${hasUpdate ? 'status-pill-update' : 'status-pill-good'}`}>
            {hasUpdate ? 'Update Available' : 'Up to date'}
          </div>
          <div className="status-details">
            <div>
              <p className="status-label">Current version</p>
              <p className="status-value">
                v{currentVersion}
                {isPrerelease && <span className="prerelease-badge">Pre-release</span>}
              </p>
            </div>
            {updateInfo && (
              <div>
                <p className="status-label">Latest version</p>
                <p className="status-value">
                  v{updateInfo.version}
                  {updateInfo.isPrerelease && <span className="prerelease-badge">Pre-release</span>}
                </p>
              </div>
            )}
            <div>
              <p className="status-label">Update channel</p>
              <select
                className="channel-select"
                value={updateChannel}
                onChange={(e) => handleChannelChange(e.target.value)}
                disabled={isDownloading}
              >
                <option value="stable">Stable</option>
                <option value="prerelease">Pre-release (Beta)</option>
              </select>
            </div>
          </div>

          {/* ---------- */}
          {/* Channel Hint / Downgrade Action */}
          {/* Description: Shows channel description, or downgrade option inline when applicable */}
          {/* ---------- */}
          {downgradeInfo && !hasUpdate ? (
            <div className="downgrade-hint">
              {updateStatus === 'downloading' ? (
                <>
                  <span>Downloading v{downgradeInfo.version}... {downloadProgress}%</span>
                  <div className="progress-bar inline-progress">
                    <div
                      className="progress-fill downgrade-fill"
                      style={{ width: `${downloadProgress}%` }}
                    />
                  </div>
                </>
              ) : updateStatus === 'installing' ? (
                <span>Installing and restarting...</span>
              ) : (
                <>
                  <span>Stable version v{downgradeInfo.version} available.</span>
                  <button
                    className="btn-link"
                    onClick={downloadAndInstall}
                    disabled={isDownloading}
                  >
                    Switch to stable
                  </button>
                </>
              )}
            </div>
          ) : (
            <p className="channel-hint">{getChannelDescription(updateChannel)}</p>
          )}

          {hasUpdate && (
            <div className="update-available-box">
              {updateStatus === 'downloading' ? (
                <>
                  <p>Downloading update... {downloadProgress}%</p>
                  <div className="progress-bar">
                    <div
                      className="progress-fill"
                      style={{ width: `${downloadProgress}%` }}
                    />
                  </div>
                </>
              ) : updateStatus === 'installing' ? (
                <p>Installing update and restarting...</p>
              ) : (
                <>
                  <p>
                    A new version of Palethea Launcher is available.
                    {updateInfo.isPrerelease && ' (Pre-release)'}
                  </p>
                  <button
                    className="btn btn-primary"
                    onClick={downloadAndInstall}
                    disabled={isDownloading}
                  >
                    Install v{updateInfo.version}
                  </button>
                </>
              )}
            </div>
          )}
        </div>

        <div className="updates-card updates-next">
          <h2>Latest Release Notes</h2>
          <div className="discord-redirect">
            <p className="status-hint">
              Detailed changelogs and community updates are now posted on our official Discord server.
            </p>
            <a 
              href="https://discord.gg/jcPbFWnZMM" 
              target="_blank" 
              rel="noreferrer"
              className="btn btn-primary btn-discord"
            >
              Join Discord for Updates
            </a>
          </div>
        </div>
      </section>

      {/* Available Releases Section */}
      {allReleases.length > 0 && (
        <section className="updates-card updates-releases">
          <div className="updates-changelog-header">
            <h2>Available Versions</h2>
            <span className="release-count">
              {allReleases.filter(r => updateChannel === 'prerelease' ? r.prerelease : !r.prerelease).length} versions
            </span>
          </div>
          <div className="updates-list">
            {allReleases
              .filter(release => updateChannel === 'prerelease' ? release.prerelease : !release.prerelease)
              .slice(0, 5)
              .map((release) => {
                return (
                  <article key={release.tag_name} className="update-item">
                    <div className="update-item-info">
                      <p className="update-title">
                        {release.name || release.tag_name}
                        {release.prerelease && <span className="prerelease-badge-sm">Pre-release</span>}
                      </p>
                      <p className="update-meta">
                        {release.published_at ? new Date(release.published_at).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }) : 'Unknown date'}
                      </p>
                    </div>
                    <button 
                      className="btn-icon-link" 
                      onClick={() => open(release.html_url)}
                      title="View release on GitHub"
                    >
                      <ExternalLink size={16} />
                    </button>
                  </article>
                );
              })}
          </div>
        </section>
      )}
    </div>
  );
}

export default Updates;
