import { useState, useEffect, useCallback, useLayoutEffect, useRef, useMemo, memo } from 'react';
import { createPortal } from 'react-dom';
import { invoke, convertFileSrc } from '@tauri-apps/api/core';
import ConfirmModal from './ConfirmModal';
import TabLoadingState from './TabLoadingState';
import SubTabs from './SubTabs';
import './ScreenshotContextMenu.css';

function InstanceScreenshots({ instance, onShowNotification, isScrolled }) {
  const [screenshots, setScreenshots] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedImage, setSelectedImage] = useState(null);
  const [deleteConfirm, setDeleteConfirm] = useState({ show: false, screenshot: null });
  const [copiedId, setCopiedId] = useState(null);
  const [screenshotContextMenu, setScreenshotContextMenu] = useState(null);
  const [renameModal, setRenameModal] = useState({ show: false, screenshot: null, newName: '' });
  const [toast, setToast] = useState(null);
  const [activeSubTab, setActiveSubTab] = useState('gallery');
  const screenshotContextMenuRef = useRef(null);

  const sortedScreenshots = useMemo(() => {
    return [...screenshots].sort((left, right) => {
      const leftTime = left?.date ? new Date(left.date).getTime() : 0;
      const rightTime = right?.date ? new Date(right.date).getTime() : 0;
      return rightTime - leftTime;
    });
  }, [screenshots]);

  const loadScreenshots = useCallback(async () => {
    try {
      const ss = await invoke('get_instance_screenshots', { instanceId: instance.id });
      setScreenshots(ss);
    } catch (error) {
      console.error('Failed to load screenshots:', error);
    }
    setLoading(false);
  }, [instance.id]);

  useEffect(() => {
    loadScreenshots();

    const handleClick = () => {
      setScreenshotContextMenu(null);
    };
    window.addEventListener('click', handleClick);
    return () => window.removeEventListener('click', handleClick);
  }, [instance.id, loadScreenshots]);

  useLayoutEffect(() => {
    if (!screenshotContextMenu || !screenshotContextMenuRef.current) return;

    const rect = screenshotContextMenuRef.current.getBoundingClientRect();
    const margin = 8;
    const maxX = Math.max(margin, window.innerWidth - rect.width - margin);
    const maxY = Math.max(margin, window.innerHeight - rect.height - margin);
    const clampedX = Math.min(Math.max(screenshotContextMenu.x, margin), maxX);
    const clampedY = Math.min(Math.max(screenshotContextMenu.y, margin), maxY);

    if (clampedX !== screenshotContextMenu.x || clampedY !== screenshotContextMenu.y || !screenshotContextMenu.positioned) {
      setScreenshotContextMenu(prev => {
        if (!prev) return prev;
        return {
          ...prev,
          x: clampedX,
          y: clampedY,
          positioned: true
        };
      });
    }
  }, [screenshotContextMenu]);

  const showToast = (message) => {
    setToast(message);
    setTimeout(() => setToast(null), 3000);
  };

  const debugLog = (message, data = null) => {
    if (import.meta.env.DEV) {
      const fullMessage = data ? `${message} ${JSON.stringify(data)}` : message;
      invoke('log_event', {
        level: 'info',
        message: `[JS DEBUG] ${fullMessage}`
      }).catch(() => { });
    }
  };

  const handleOpenFolder = async () => {
    try {
      await invoke('open_instance_folder', {
        instanceId: instance.id,
        folderType: 'screenshots'
      });
    } catch (error) {
      console.error('Failed to open folder:', error);      if (onShowNotification) {
        onShowNotification(`Failed to open screenshots folder: ${error}`, 'error');
      }    }
  };

  const handleDelete = async (screenshot) => {
    setDeleteConfirm({ show: true, screenshot });
  };

  const confirmDelete = async () => {
    const screenshot = deleteConfirm.screenshot;
    setDeleteConfirm({ show: false, screenshot: null });

    try {
      await invoke('delete_instance_screenshot', {
        instanceId: instance.id,
        filename: screenshot.filename
      });
      await loadScreenshots();
      showToast('Screenshot deleted');
    } catch (error) {
      console.error('Failed to delete screenshot:', error);
      showToast('Failed to delete screenshot');
    }
  };

  const handleCopy = async (ss) => {
    debugLog('--- START COPY ATTEMPT ---');
    debugLog('Screenshot:', ss.filename);

    try {
      if (!window.ClipboardItem) {
        debugLog('ERROR: ClipboardItem API is not available.');
        showToast('Clipboard API not supported');
        return;
      }

      const srcUrl = convertFileSrc(ss.path);
      debugLog('File URL:', srcUrl);

      debugLog('Writing to clipboard (direct promise approach)...');
      
      // Create ClipboardItem with a Promise for the blob. 
      // This preserves user activation context which is often lost on Linux/WebKit 
      // when awaiting fetch/blob before calling the clipboard API.
      const item = new ClipboardItem({
        'image/png': (async () => {
          const response = await fetch(srcUrl);
          if (!response.ok) throw new Error(`Fetch failed: ${response.status}`);
          return await response.blob();
        })()
      });

      await navigator.clipboard.write([item]);

      debugLog('SUCCESS: Clipboard write finished.');
      setCopiedId(ss.filename);
      showToast('Copied to clipboard!');
      setTimeout(() => setCopiedId(null), 2000);
    } catch (error) {
      debugLog('FATAL: Copy failed', {
        message: error.message,
        name: error.name,
        stack: error.stack
      });
      showToast('Failed to copy to clipboard');
    }
  };

  const handleScreenshotContextMenu = (e, ss) => {
    e.preventDefault();
    e.stopPropagation();

    setScreenshotContextMenu({
      x: e.clientX + 2,
      y: e.clientY + 2,
      positioned: false,
      screenshot: ss
    });
  };

  const handleRename = async () => {
    const { screenshot, newName } = renameModal;
    if (!newName || newName === screenshot.filename) {
      setRenameModal({ show: false, screenshot: null, newName: '' });
      return;
    }

    try {
      await invoke('rename_instance_screenshot', {
        instanceId: instance.id,
        oldFilename: screenshot.filename,
        newFilename: newName
      });
      showToast('Screenshot renamed');
      await loadScreenshots();
    } catch (error) {
      showToast(`Rename failed: ${error}`);
    }
    setRenameModal({ show: false, screenshot: null, newName: '' });
  };

  const handleOpenScreenshot = async (ss) => {
    try {
      await invoke('open_instance_screenshot', {
        instanceId: instance.id,
        filename: ss.filename
      });
    } catch (error) {
      showToast(`Failed to open: ${error}`);
    }
  };

  const formatDate = (dateStr) => {
    if (!dateStr) return 'Unknown';
    return new Date(dateStr).toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  if (loading) {
    return (
      <div className="screenshots-tab">
        <div className={`sub-tabs-row ${isScrolled ? 'scrolled' : ''}`}>
          <SubTabs
            tabs={[
              { id: 'gallery', label: 'Gallery' },
              { id: 'timeline', label: 'Timeline' }
            ]}
            activeTab={activeSubTab}
            onTabChange={setActiveSubTab}
          />
          <div className="sub-tabs-actions">
            <button className="open-folder-btn" disabled title="Open Screenshots Folder">
              📁 Folder
            </button>
          </div>
        </div>
        <TabLoadingState label="Loading screenshots" rows={4} />
      </div>
    );
  }

  return (
    <div className="screenshots-tab">
      <div className={`sub-tabs-row ${isScrolled ? 'scrolled' : ''}`}>
        <SubTabs
          tabs={[
            { id: 'gallery', label: `Gallery (${screenshots.length})` },
            { id: 'timeline', label: 'Timeline' }
          ]}
          activeTab={activeSubTab}
          onTabChange={setActiveSubTab}
        />
        <div className="sub-tabs-actions">
          <button className="open-folder-btn" onClick={handleOpenFolder} title="Open Screenshots Folder">
            📁 Folder
          </button>
        </div>
      </div>

      {screenshots.length === 0 ? (
        <div className="empty-state">
          <h4>No screenshots yet</h4>
          <p>Press F2 in-game to take screenshots.</p>
        </div>
      ) : activeSubTab === 'timeline' ? (
        <div className="screenshots-timeline">
          {sortedScreenshots.map((ss) => (
            <div
              key={ss.filename}
              className="screenshot-timeline-row"
              onContextMenu={(e) => handleScreenshotContextMenu(e, ss)}
            >
              <button
                type="button"
                className="screenshot-timeline-thumb-btn"
                onClick={() => setSelectedImage(ss)}
              >
                <img src={convertFileSrc(ss.path)} alt={ss.filename} className="screenshot-timeline-thumb" />
              </button>
              <div className="screenshot-timeline-meta">
                <span className="screenshot-filename" title={ss.filename}>{ss.filename}</span>
                <span className="screenshot-date">{formatDate(ss.date)}</span>
              </div>
              <div className="screenshot-timeline-actions">
                <button className="open-btn" onClick={() => setSelectedImage(ss)} title="Open preview">Open</button>
                <button
                  className="timeline-copy-btn"
                  title={copiedId === ss.filename ? 'Copied!' : 'Copy to clipboard'}
                  onClick={() => handleCopy(ss)}
                >
                  {copiedId === ss.filename ? 'Copied' : 'Copy'}
                </button>
                <button className="delete-btn" onClick={() => handleDelete(ss)}>Delete</button>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="screenshots-grid">
          {screenshots.map((ss) => (
            <div
              key={ss.filename}
              className="screenshot-card"
              onContextMenu={(e) => handleScreenshotContextMenu(e, ss)}
            >
              <div className="screenshot-image-wrapper">
                <img
                  src={convertFileSrc(ss.path)}
                  alt={ss.filename}
                  className="screenshot-image"
                  onClick={() => setSelectedImage(ss)}
                />
                <button
                  className={`copy-screenshot-btn ${copiedId === ss.filename ? 'copied' : ''}`}
                  title={copiedId === ss.filename ? 'Copied!' : 'Copy to clipboard'}
                  onClick={(e) => {
                    e.stopPropagation();
                    handleCopy(ss);
                  }}
                >
                  {copiedId === ss.filename ? (
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="20 6 9 17 4 12"></polyline>
                    </svg>
                  ) : (
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
                    </svg>
                  )}
                </button>
              </div>
              <div className="screenshot-info">
                <div className="screenshot-meta">
                  <span className="screenshot-filename">{ss.filename}</span>
                  <span className="screenshot-date">{formatDate(ss.date)}</span>
                </div>
                <button className="delete-btn" onClick={() => handleDelete(ss)}>
                  Delete
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {selectedImage && (
        <div
          className="screenshot-modal"
          onClick={() => setSelectedImage(null)}
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: 'rgba(0, 0, 0, 0.9)',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '40px',
            zIndex: 1000,
            cursor: 'pointer'
          }}
        >
          <div className="modal-screenshot-info" onClick={e => e.stopPropagation()}>
            <h3>{selectedImage.filename}</h3>
            <span>{formatDate(selectedImage.date)}</span>
          </div>
          <img
            src={convertFileSrc(selectedImage.path)}
            alt={selectedImage.filename}
            className="modal-screenshot-image"
            onClick={e => e.stopPropagation()}
          />
        </div>
      )}

      <ConfirmModal
        isOpen={deleteConfirm.show}
        title="Delete Screenshot"
        message={`Are you sure you want to delete "${deleteConfirm.screenshot?.filename}"?`}
        confirmText="Delete"
        cancelText="Cancel"
        variant="danger"
        onConfirm={confirmDelete}
        onCancel={() => setDeleteConfirm({ show: false, screenshot: null })}
      />

      {screenshotContextMenu && createPortal(
        <div
          ref={screenshotContextMenuRef}
          className="screenshot-context-menu"
          style={{
            position: 'fixed',
            left: screenshotContextMenu.x,
            top: screenshotContextMenu.y,
            visibility: screenshotContextMenu.positioned ? 'visible' : 'hidden'
          }}
          onClick={e => e.stopPropagation()}
        >
          <button onClick={() => { setScreenshotContextMenu(null); setSelectedImage(screenshotContextMenu.screenshot); }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>
            View
          </button>
          <button onClick={() => { setScreenshotContextMenu(null); handleOpenScreenshot(screenshotContextMenu.screenshot); }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><circle cx="8.5" cy="8.5" r="1.5"></circle><polyline points="21 15 16 10 5 21"></polyline></svg>
            View with system
          </button>
          <button onClick={() => { setScreenshotContextMenu(null); handleCopy(screenshotContextMenu.screenshot); }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
            Copy Image
          </button>
          <button onClick={() => {
            setScreenshotContextMenu(null);
            setRenameModal({
              show: true,
              screenshot: screenshotContextMenu.screenshot,
              newName: screenshotContextMenu.screenshot.filename
            });
          }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9"></path><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path></svg>
            Rename
          </button>
          <button onClick={() => { setScreenshotContextMenu(null); handleOpenFolder(); }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path></svg>
            Show in Folder
          </button>
          <div className="divider" />
          <button className="danger" onClick={() => { setScreenshotContextMenu(null); handleDelete(screenshotContextMenu.screenshot); }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2-2v2"></path><line x1="10" y1="11" x2="10" y2="17"></line><line x1="14" y1="11" x2="14" y2="17"></line></svg>
            Delete
          </button>
        </div>,
        document.body
      )}

      {renameModal.show && (
        <div className="welcome-overlay" onClick={() => setRenameModal({ show: false, screenshot: null, newName: '' })}>
          <div className="rename-modal" onClick={e => e.stopPropagation()}>
            <h3>Rename Screenshot</h3>
            <input
              type="text"
              value={renameModal.newName}
              onChange={e => setRenameModal(prev => ({ ...prev, newName: e.target.value }))}
              onKeyDown={e => e.key === 'Enter' && handleRename()}
              autoFocus
            />
            <div className="rename-actions">
              <button className="rename-cancel" onClick={() => setRenameModal({ show: false, screenshot: null, newName: '' })}>Cancel</button>
              <button className="rename-confirm" onClick={handleRename}>Rename</button>
            </div>
          </div>
        </div>
      )}

      {toast && (
        <div className="notification notification-info" style={{ pointerEvents: 'none' }}>
          {toast}
        </div>
      )}
    </div>
  );
}

export default memo(InstanceScreenshots);
