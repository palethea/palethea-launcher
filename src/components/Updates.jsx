import { useState, useEffect } from 'react';
import { getVersion } from '@tauri-apps/api/app';
import { invoke } from '@tauri-apps/api/core';
import { check } from '@tauri-apps/plugin-updater';
import { relaunch } from '@tauri-apps/plugin-process';
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
        console.log('Skipping throttled update check');
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
  // ----------
  const downloadAndInstall = async () => {
    // Works for both updates and downgrades
    if (!updateInfo && !downgradeInfo) return;

    setIsDownloading(true);
    setUpdateStatus('downloading');
    setDownloadProgress(0);

    try {
      const update = await check();
      if (!update) {
        throw new Error('Update no longer available');
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
  // parseNotes
  // Description: Parse markdown-style release notes into a list of bullet points
  // ----------
  const parseNotes = (body) => {
    if (!body) return [];
    return body
      .split('\n')
      .filter(line => line.trim().startsWith('-') || line.trim().startsWith('*'))
      .map(line => line.replace(/^[-*]\s*/, '').trim())
      .filter(line => line.length > 0);
  };

  const notes = updateInfo ? parseNotes(updateInfo.body) : [];

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

      {error && <div className="error-notice">{error}</div>}

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
          {updateInfo ? (
            notes.length > 0 ? (
              <ul className="notes-list">
                {notes.map((note, i) => (
                  <li key={i}>{note}</li>
                ))}
              </ul>
            ) : (
              <p className="status-hint">{updateInfo.body || 'No release notes available.'}</p>
            )
          ) : (
            <p className="status-hint">
              {isChecking ? 'Fetching details...' : 'You are running the latest version.'}
            </p>
          )}
        </div>
      </section>

      {/* Available Releases Section */}
      {allReleases.length > 0 && (
        <section className="updates-card updates-releases">
          <div className="updates-changelog-header">
            <h2>Available Versions</h2>
            <span className="release-count">{allReleases.length} release{allReleases.length !== 1 ? 's' : ''}</span>
          </div>
          <div className="updates-list">
            {allReleases.slice(0, 5).map((release) => {
              const verNum = release.tag_name.replace(/^v/, '');
              return (
                <article key={release.tag_name} className="update-item">
                  <div>
                    <p className="update-title">
                      {release.name || release.tag_name}
                      {release.prerelease && <span className="prerelease-badge-sm">Pre-release</span>}
                    </p>
                    <p className="update-meta">
                      {release.tag_name} • {release.published_at ? new Date(release.published_at).toLocaleDateString('en-US', { month: 'long', year: 'numeric' }) : 'Unknown date'}
                    </p>
                  </div>
                  <p className="update-body">
                    {release.body
                      ? release.body.split('\n').find(l => l.trim().startsWith('-') || l.trim().startsWith('*'))?.replace(/^[-*]\s*/, '').trim() || 'No description'
                      : 'No description'}
                  </p>
                </article>
              );
            })}
          </div>
        </section>
      )}

      <section className="updates-card updates-changelog">
        <div className="updates-changelog-header">
          <h2>Recent highlights</h2>
        </div>
        <div className="updates-list">
          <article className="update-item">
            <div>
              <p className="update-title">Removed CMD popups</p>
              <p className="update-meta">v0.2.11 • January 2026</p>
            </div>
            <p className="update-body">
              Removed the annoying CMD popups when launching and downloading files.
            </p>
          </article>
          <article className="update-item">
            <div>
              <p className="update-title">Fixed most issues launching mods</p>
              <p className="update-meta">v0.2.9 • January 2026</p>
            </div>
            <p className="update-body">
              Fixed a lot of issues happening on windows when trying to launch with mods.
            </p>
          </article>
          <article className="update-item">
            <div>
              <p className="update-title">Improved Instance Editor & Welcome message</p>
              <p className="update-meta">v0.2.1 • January 2026</p>
            </div>
            <p className="update-body">
              A revamped instance editor with better mod management, version selection, and performance optimizations. Fixed the bug where the welcome message would not accept the toggleable switch.
            </p>
          </article>
          <article className="update-item">
            <div>
              <p className="update-title">New and improved UI</p>
              <p className="update-meta">v0.2.0 • January 2026</p>
            </div>
            <p className="update-body">
              A cleaner, more focused interface with simplified navigation and informative welcome screen.
            </p>
          </article>
          <article className="update-item">
            <div>
              <p className="update-title">Modrinth modpack support</p>
              <p className="update-meta">v0.2.0 • January 2026</p>
            </div>
            <p className="update-body">
              Now you can browse and install modpacks directly from Modrinth within the launcher.
            </p>
          </article>
        </div>
      </section>
    </div>
  );
}

export default Updates;
