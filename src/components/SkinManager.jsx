import { useState, useEffect, useRef, useCallback } from 'react';
import { invoke, convertFileSrc } from '@tauri-apps/api/core';
import { open } from '@tauri-apps/plugin-dialog';
import SkinViewer3D from './SkinViewer3D';
import './SkinManager.css';

function SkinManager({ activeAccount, showNotification, onSkinChange, onPreviewChange }) {
  const viewer3dRef = useRef(null);
  const [profile, setProfile] = useState(null);
  const [library, setLibrary] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [showSaveDialog, setShowSaveDialog] = useState(false);
  const [saveName, setSaveName] = useState('');
  const [saveVariant, setSaveVariant] = useState('classic');
  const [lastSelectedPath, setLastSelectedPath] = useState('');
  const [refreshKey, setRefreshKey] = useState(Date.now());
  const [justUploadedUrl, setJustUploadedUrl] = useState(null);
  const [autoRotate, setAutoRotate] = useState(true);
  const [error, setError] = useState(null);
  const [showVariantPicker, setShowVariantPicker] = useState(false);
  const [showRateLimitModal, setShowRateLimitModal] = useState(false);

  const loadProfile = useCallback(async (silent = false) => {
    if (!silent) {
      setIsLoading(true);
    }
    setError(null);
    try {
      const data = await invoke('get_mc_profile_full');
      setProfile(data);
      // Only clear local preview if not silent (initial load or manual refresh)
      if (!silent) {
        setRefreshKey(Date.now());
        setJustUploadedUrl(null);
      }
    } catch (err) {
      console.error('Failed to load profile:', err);
      const errStr = err.toString();
      if (errStr.includes('429') || errStr.toLowerCase().includes('too many')) {
        setShowRateLimitModal(true);
      } else {
        setError(err);
        if (!silent) {
          showNotification(`Failed to load skin profile: ${err}`, 'error');
        }
      }
    }
    if (!silent) {
      setIsLoading(false);
    }
  }, [showNotification]);

  const loadLibrary = useCallback(async () => {
    try {
      const items = await invoke('get_skin_collection');
      // Pre-resolve all file paths for the images
      const itemsWithSrc = await Promise.all(items.map(async item => {
        const path = await invoke('get_skin_file_path', { filename: item.filename });
        return { ...item, src: convertFileSrc(path) };
      }));
      setLibrary(itemsWithSrc);
    } catch (error) {
      console.error('Failed to load library:', error);
    }
  }, []);

  useEffect(() => {
    if (activeAccount?.isLoggedIn) {
      loadProfile();
    }
    loadLibrary();
  }, [activeAccount, loadProfile, loadLibrary]);

  const currentSkinUrl = profile?.skins?.find(s => s.state === 'ACTIVE')?.url;

  const detectSkinVariant = useCallback(async (filePath) => {
    return new Promise((resolve) => {
      invoke('log_event', { level: 'info', message: `Analyzing skin model for: ${filePath}` });

      const img = new Image();
      img.crossOrigin = "anonymous";

      img.onload = () => {
        try {
          const canvas = document.createElement('canvas');
          const ctx = canvas.getContext('2d');
          canvas.width = img.width;
          canvas.height = img.height;
          ctx.drawImage(img, 0, 0);

          let isSlim = false;
          let reason = "";
          const scale = img.width / 64;

          invoke('log_event', {
            level: 'info',
            message: `Skin Dimensions: ${img.width}x${img.height} (Scale: ${scale}x)`
          });

          if (img.height === 32 * scale) {
            isSlim = false;
            reason = "Classic (Legacy 64x32 format)";
          } else {
            // Check indicator pixels in the "4th column" of the arms.
            // These pixels are unused (transparent) in proper Slim models.
            // We check the scaled coordinates.
            const p1 = ctx.getImageData(47 * scale, 16 * scale, 1, 1).data[3];
            const p2 = ctx.getImageData(47 * scale, 31 * scale, 1, 1).data[3];
            const p3 = ctx.getImageData(39 * scale, 48 * scale, 1, 1).data[3];
            const p4 = ctx.getImageData(39 * scale, 63 * scale, 1, 1).data[3];

            invoke('log_event', {
              level: 'info',
              message: `Indicator pixels (Alpha) at scale ${scale}x: P1:${p1}, P2:${p2}, P3:${p3}, P4:${p4}`
            });

            // If ALL of these indicator pixels are transparent, it's definitely a Slim model.
            // If even one is solid, it's formatted as a Classic model.
            if (p1 === 0 && p2 === 0 && p3 === 0 && p4 === 0) {
              isSlim = true;
              reason = "Slim (Detected via transparency in scaled 4th arm column)";
            } else {
              isSlim = false;
              reason = "Classic (Opaque pixels found in 4th arm column)";
            }
          }

          const variant = isSlim ? 'slim' : 'classic';
          invoke('log_event', { level: 'info', message: `Skin analysis complete. ${reason}` });
          resolve(variant);
        } catch (e) {
          invoke('log_event', { level: 'error', message: `Skin analysis failed: ${e.message}` });
          resolve('classic');
        }
      };

      img.onerror = (err) => {
        invoke('log_event', { level: 'error', message: `Failed to load image for analysis: ${filePath}` });
        resolve('classic');
      };

      img.src = convertFileSrc(filePath);
    });
  }, []);

  const uploadSkinWithVariant = useCallback(async (filePath, localUrl, variant) => {
    setIsUploading(true);
    setSaveVariant(variant);

    try {
      invoke('log_event', { level: 'info', message: `Uploading skin as ${variant} model...` });

      await invoke('upload_skin', {
        filePath: filePath,
        variant: variant
      });

      showNotification(`Skin uploaded as ${variant}!`, 'success');
      if (onSkinChange) onSkinChange(localUrl);

      // Ask if user wants to save to library
      setShowSaveDialog(true);

      // Silently sync with Mojang in the background (no visual refresh)
      setTimeout(() => loadProfile(true), 8000);
    } catch (error) {
      const errStr = error.toString();
      if (errStr.includes('429') || errStr.toLowerCase().includes('too many')) {
        setShowRateLimitModal(true);
      } else {
        invoke('log_event', { level: 'error', message: `Upload failed: ${error}` });
        showNotification(`Upload failed: ${error}`, 'error');
      }
    } finally {
      setIsUploading(false);
      setShowVariantPicker(false);
    }
  }, [onSkinChange, showNotification, loadProfile]);

  const handleUploadSkin = useCallback(async (explicitVariant) => {
    if (!activeAccount?.isLoggedIn) {
      showNotification('You must be logged in with a Microsoft account to change skins', 'error');
      return;
    }

    try {
      const selected = await open({
        multiple: false,
        filters: [{
          name: 'Image',
          extensions: ['png']
        }]
      });

      if (selected) {
        const localUrl = convertFileSrc(selected);
        setLastSelectedPath(selected);
        setJustUploadedUrl(localUrl);

        if (explicitVariant) {
          // User explicitly chose a variant, upload directly
          await uploadSkinWithVariant(selected, localUrl, explicitVariant);
        } else {
          // Show variant picker modal
          setShowVariantPicker(true);
        }
      }
    } catch (error) {
      console.error('Upload failed:', error);
      showNotification(`Upload failed: ${error}`, 'error');
    }
  }, [activeAccount, showNotification, uploadSkinWithVariant]);

  const handleSaveToLibrary = useCallback(async () => {
    if (!saveName.trim()) {
      showNotification('Please enter a name for the skin', 'error');
      return;
    }

    try {
      await invoke('add_to_skin_collection', {
        name: saveName,
        sourcePath: lastSelectedPath || currentSkinUrl,
        variant: saveVariant
      });
      showNotification('Added to library!', 'success');
      loadLibrary();
      setShowSaveDialog(false);
      setSaveName('');
    } catch (error) {
      showNotification(`Failed to save: ${error}`, 'error');
    }
  }, [saveName, lastSelectedPath, currentSkinUrl, saveVariant, showNotification, loadLibrary]);

  const handleUseFromLibrary = useCallback(async (skin) => {
    if (!activeAccount?.isLoggedIn) {
      showNotification('You must be logged in to change skins', 'error');
      return;
    }

    try {
      setIsUploading(true);
      setJustUploadedUrl(skin.src); // Immediate feedback
      setSaveVariant(skin.variant); // Set variant so 3D preview is correct
      const filePath = await invoke('get_skin_file_path', { filename: skin.filename });
      await invoke('upload_skin', {
        filePath,
        variant: skin.variant
      });
      showNotification(`Applied skin "${skin.name}"`, 'success');
      if (onSkinChange) onSkinChange(skin.src);
      setTimeout(() => loadProfile(true), 3000);
    } catch (error) {
      showNotification(`Failed to apply skin: ${error}`, 'error');
    } finally {
      setIsUploading(false);
    }
  }, [activeAccount, showNotification, onSkinChange, loadProfile]);

  const handleDeleteFromLibrary = useCallback(async (id) => {
    try {
      await invoke('delete_skin_from_collection', { id });
      loadLibrary();
    } catch (error) {
      showNotification(`Delete failed: ${error}`, 'error');
    }
  }, [loadLibrary, showNotification]);

  const handleResetSkin = useCallback(async () => {
    try {
      setIsUploading(true);
      await invoke('reset_skin');
      // The default Steve skin URL from Mojang
      const steveUrl = 'http://textures.minecraft.net/texture/31f477eb1a7beee631c2ca64d06f8f68fa93a3386d04452ab27f43acdf1b60cb';
      setJustUploadedUrl(steveUrl);
      setSaveVariant('classic');
      showNotification('Skin reset to default', 'success');
      if (onSkinChange) onSkinChange(steveUrl);
      setTimeout(() => loadProfile(true), 2000);
    } catch (error) {
      const errStr = error.toString();
      if (errStr.includes('429') || errStr.toLowerCase().includes('too many')) {
        setShowRateLimitModal(true);
      } else {
        showNotification(`Reset failed: ${error}`, 'error');
      }
    } finally {
      setIsUploading(false);
    }
  }, [onSkinChange, showNotification, loadProfile]);

  const SkinCharacter2D = ({ src }) => (
    <div className="skin-character-2d">
      <div className="skin-part head" style={{ backgroundImage: `url("${src}")` }}></div>
      <div className="skin-part head-ov" style={{ backgroundImage: `url("${src}")` }}></div>
      <div className="skin-part body" style={{ backgroundImage: `url("${src}")` }}></div>
      <div className="skin-part body-ov" style={{ backgroundImage: `url("${src}")` }}></div>
      <div className="skin-part arm-l" style={{ backgroundImage: `url("${src}")` }}></div>
      <div className="skin-part arm-l-ov" style={{ backgroundImage: `url("${src}")` }}></div>
      <div className="skin-part arm-r" style={{ backgroundImage: `url("${src}")` }}></div>
      <div className="skin-part arm-r-ov" style={{ backgroundImage: `url("${src}")` }}></div>
      <div className="skin-part leg-l" style={{ backgroundImage: `url("${src}")` }}></div>
      <div className="skin-part leg-l-ov" style={{ backgroundImage: `url("${src}")` }}></div>
      <div className="skin-part leg-r" style={{ backgroundImage: `url("${src}")` }}></div>
      <div className="skin-part leg-r-ov" style={{ backgroundImage: `url("${src}")` }}></div>
    </div>
  );

  const activePreviewUrl = justUploadedUrl || currentSkinUrl;
  const activeSkin = profile?.skins?.find(s => s.state === 'ACTIVE');
  const activeVariant = justUploadedUrl ? saveVariant : (activeSkin?.variant?.toLowerCase() || 'classic');

  useEffect(() => {
    if (onPreviewChange && activePreviewUrl) {
      onPreviewChange(activePreviewUrl);
    }
  }, [activePreviewUrl, onPreviewChange]);

  if (!activeAccount?.isLoggedIn && library.length === 0) {
    return (
      <div className="skin-manager empty">
        <div className="skin-empty-card">
          <h2>Not Logged In</h2>
          <p>You are not logged in and therefore cannot use the skins page.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="skin-manager">
      <div className="skin-header page-header">
        <p className="page-subtitle">Personalize your character by uploading custom skins or choosing from your library.</p>
      </div>

      <div className="skin-top-row">
        <div className="skin-preview-container">
          {isLoading ? (
            <div className="skin-loader">
              <div className="spinner"></div>
              <span>Loading preview...</span>
            </div>
          ) : activePreviewUrl ? (
            <div className="skin-view">
              <SkinViewer3D
                ref={viewer3dRef}
                src={activePreviewUrl}
                variant={activeVariant}
                width={280}
                height={400}
                autoRotate={autoRotate}
              />
              <button
                className={`btn-toggle-rotate ${autoRotate ? 'active' : ''}`}
                title={autoRotate ? "Pause Rotation" : "Resume Rotation"}
                onClick={() => setAutoRotate(!autoRotate)}
              >
                {autoRotate ? (
                  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.5">
                    <rect x="6" y="4" width="4" height="16" />
                    <rect x="14" y="4" width="4" height="16" />
                  </svg>
                ) : (
                  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.5">
                    <path d="M21 12a9 9 0 11-9-9c2.52 0 4.85.83 6.72 2.24M21 3v5h-5" />
                  </svg>
                )}
              </button>
            </div>
          ) : error ? (
            <div className="skin-none error">
              <p>Failed to load profile</p>
              <button className="btn btn-secondary btn-sm" onClick={loadProfile}>Retry</button>
            </div>
          ) : (
            <div className="skin-none">No skin found</div>
          )}
        </div>

        <div className="skin-info-panels">
          <div className="skin-details">
            <div className="details-header">
              <h3>Current Profile</h3>
              <span className="skin-badge">Active</span>
            </div>
            <p className="active-name">{profile?.name || activeAccount?.username || 'Steve'}</p>

            <button
              className="btn btn-secondary btn-add-library"
              onClick={() => {
                const activeSkin = profile?.skins?.find(s => s.state === 'ACTIVE');
                setSaveName(activeAccount?.username || 'Current Skin');
                setSaveVariant(activeSkin?.variant?.toLowerCase() || 'classic');
                setLastSelectedPath('');
                setShowSaveDialog(true);
              }}
            >
              Add this skin to library
            </button>
          </div>

          <div className="action-card">
            <h3>Upload New Skin</h3>
            <p>Select a PNG file and choose Classic or Slim.</p>
            <div className="upload-buttons vertical">
              <button
                className="btn btn-primary btn-upload-main"
                onClick={() => handleUploadSkin()}
                disabled={isUploading || isLoading}
              >
                {isUploading ? 'Uploading...' : 'Upload Skin'}
              </button>
            </div>
          </div>

          <div className="action-card secondary">
            <h3>Maintenance</h3>
            <p>Reset to default or refresh preview.</p>
            <div className="maintenance-buttons">
              <button
                className="btn-reset"
                onClick={handleResetSkin}
                disabled={isUploading || isLoading}
              >
                Reset
              </button>
              <button
                className="btn-refresh"
                onClick={() => {
                  setRefreshKey(Date.now());
                  loadProfile();
                }}
                disabled={isLoading}
              >
                Refresh
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className="skin-bottom-row">
        <div className="skin-library">
          <div className="library-header">
            <h3>Skin Collection</h3>
            <span className="library-count">{library.length} skins saved</span>
          </div>

          {library.length === 0 ? (
            <div className="library-empty">
              <p>Your collection is empty.</p>
              <small>Upload a skin to add it to your library.</small>
            </div>
          ) : (
            <div className="library-grid">
              {library.map(skin => (
                <div key={skin.id} className="library-item" onClick={() => handleUseFromLibrary(skin)}>
                  <div className="library-preview">
                    <SkinCharacter2D src={skin.src} />
                    <span className={`variant-badge ${skin.variant}`}>
                      {skin.variant === 'slim' ? 'Slim' : 'Classic'}
                    </span>
                  </div>
                  <div className="item-info">
                    <span className="item-name" title={skin.name}>{skin.name}</span>
                    <button
                      className="btn-delete-small"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDeleteFromLibrary(skin.id);
                      }}
                    >
                      ×
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {showSaveDialog && (
        <div className="modal-overlay" onClick={() => setShowSaveDialog(false)}>
          <div className="modal-content" onClick={e => e.stopPropagation()}>
            <h3>Add to Collection?</h3>
            <p>Would you like to save this skin to your library for easy swapping later?</p>
            <input
              type="text"
              placeholder="Skin name (e.g. Red Hoodie)"
              value={saveName}
              onChange={(e) => setSaveName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleSaveToLibrary();
                if (e.key === 'Escape') setShowSaveDialog(false);
              }}
              autoFocus
            />
            <div className="modal-actions">
              <button className="btn btn-secondary" onClick={() => setShowSaveDialog(false)}>Cancel</button>
              <button className="btn btn-primary" onClick={handleSaveToLibrary}>Save to Library</button>
            </div>
          </div>
        </div>
      )}

      {showVariantPicker && (
        <div className="modal-overlay" onClick={() => setShowVariantPicker(false)}>
          <div className="modal-content variant-picker" onClick={e => e.stopPropagation()}>
            <h3>Choose Skin Model</h3>
            <p>Select the arm style for this skin:</p>

            <div className="variant-preview">
              {justUploadedUrl && (
                <SkinCharacter2D src={justUploadedUrl} />
              )}
            </div>

            <div className="variant-options">
              <button
                className="variant-btn classic"
                onClick={() => uploadSkinWithVariant(lastSelectedPath, justUploadedUrl, 'classic')}
                disabled={isUploading}
              >
                <svg className="variant-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M12 2v8m0 0l4-4m-4 4l-4-4M6 14h12M6 18h12" />
                </svg>
                <span className="variant-label">Classic</span>
                <span className="variant-desc">4px wide arms (Steve)</span>
              </button>

              <button
                className="variant-btn slim"
                onClick={() => uploadSkinWithVariant(lastSelectedPath, justUploadedUrl, 'slim')}
                disabled={isUploading}
              >
                <svg className="variant-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M12 2v8m0 0l3-3m-3 3l-3-3M7 14h10M7 18h10" />
                </svg>
                <span className="variant-label">Slim</span>
                <span className="variant-desc">3px wide arms (Alex)</span>
              </button>
            </div>

            {isUploading && (
              <div className="uploading-status">
                <div className="spinner"></div>
                <span>Uploading...</span>
              </div>
            )}
          </div>
        </div>
      )}

      {showRateLimitModal && (
        <div className="modal-overlay" onClick={() => setShowRateLimitModal(false)}>
          <div className="modal-content rate-limit-modal" onClick={e => e.stopPropagation()}>
            <div className="rate-limit-icon">
              <svg viewBox="0 0 24 24" width="48" height="48" fill="none" stroke="currentColor" strokeWidth="1.5">
                <circle cx="12" cy="12" r="10" />
                <path d="M12 6v6l4 2" />
              </svg>
            </div>
            <h3>Slow Down!</h3>
            <p>
              Mojang's servers are rate limiting your requests.
              Please wait a minute before trying again.
            </p>
            <p className="rate-limit-hint">
              This happens when you change your skin too frequently.
            </p>
            <button
              className="btn btn-primary"
              onClick={() => setShowRateLimitModal(false)}
            >
              Got it
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default SkinManager;

