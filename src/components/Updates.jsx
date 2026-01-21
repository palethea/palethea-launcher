import { useState, useEffect } from 'react';
import { getVersion } from '@tauri-apps/api/app';
import { invoke } from '@tauri-apps/api/core';
import { check } from '@tauri-apps/plugin-updater';
import { relaunch } from '@tauri-apps/plugin-process';
import './Updates.css';

function Updates() {
  const [currentVersion, setCurrentVersion] = useState('0.1.2');
  const [updateInfo, setUpdateInfo] = useState(null);
  const [isChecking, setIsChecking] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState(0);
  const [error, setError] = useState(null);
  const [updateStatus, setUpdateStatus] = useState('idle'); // idle, downloading, ready, installing

  const checkUpdates = async () => {
    setIsChecking(true);
    setError(null);
    try {
      await invoke('log_event', { level: 'info', message: 'Checking for updates...' });
      // Get the version from the actual Tauri app
      const version = await getVersion();
      setCurrentVersion(version);

      // Use Tauri's built-in updater to check GitHub releases
      const update = await check();

      if (update) {
        await invoke('log_event', { level: 'info', message: `Update found: v${update.version}` });
        setUpdateInfo({
          version: update.version,
          body: update.body,
          date: update.date,
        });
      } else {
        await invoke('log_event', { level: 'info', message: 'No updates found. App is up to date.' });
        setUpdateInfo(null);
      }
    } catch (err) {
      await invoke('log_event', { level: 'error', message: `Update check failed: ${err.toString()}` });
      console.error('Failed to check updates:', err);
      setError('Could not check for updates. Please try again later.');
    } finally {
      setIsChecking(false);
    }
  };

  const downloadAndInstall = async () => {
    if (!updateInfo) return;

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
    checkUpdates();
  }, []);

  const hasUpdate = updateInfo !== null;

  // Parse markdown-style release notes into a list
  const parseNotes = (body) => {
    if (!body) return [];
    return body
      .split('\n')
      .filter(line => line.trim().startsWith('-') || line.trim().startsWith('*'))
      .map(line => line.replace(/^[-*]\s*/, '').trim())
      .filter(line => line.length > 0);
  };

  const notes = updateInfo ? parseNotes(updateInfo.body) : [];

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
            onClick={checkUpdates}
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
              <p className="status-value">v{currentVersion}</p>
            </div>
            {updateInfo && (
              <div>
                <p className="status-label">Latest version</p>
                <p className="status-value">v{updateInfo.version}</p>
              </div>
            )}
            <div>
              <p className="status-label">Update channel</p>
              <p className="status-value">Stable</p>
            </div>
          </div>

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
                  <p>A new version of Palethea Launcher is available.</p>
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

      <section className="updates-card updates-changelog">
        <div className="updates-changelog-header">
          <h2>Recent highlights</h2>
        </div>
        <div className="updates-list">
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
