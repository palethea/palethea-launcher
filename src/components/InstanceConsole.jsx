import { useState, useEffect, useRef, memo } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { RotateCcw, Trash2, FolderOpen } from 'lucide-react';

function InstanceConsole({ instance, onInstanceUpdated, onShowNotification, clearOnMount }) {
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [autoScroll, setAutoScroll] = useState(true);
  const [autoUpdate, setAutoUpdate] = useState(instance.console_auto_update || false);
  const consoleRef = useRef(null);
  const lastRawLogRef = useRef('');
  const logsRef = useRef([]);
  const shouldStickToBottomRef = useRef(true);
  const userPinnedToBottomRef = useRef(true);

  useEffect(() => {
    setAutoUpdate(instance.console_auto_update || false);
  }, [instance.console_auto_update]);

  useEffect(() => {
    logsRef.current = logs;
  }, [logs]);

  // ----------
  // Clear logs on mount if requested
  // Description: When launching, clears old logs instantly for a fresh start
  // ----------
  useEffect(() => {
    if (clearOnMount) {
      setLogs([]);
      logsRef.current = [];
      lastRawLogRef.current = '';
      userPinnedToBottomRef.current = true;
    }
    loadLogs(true);
  }, [instance.id, clearOnMount]);

  useEffect(() => {
    if (!autoUpdate) return;
    const interval = setInterval(() => {
      loadLogs(false);
    }, 2000);
    return () => clearInterval(interval);
  }, [autoUpdate, instance.id]);

  useEffect(() => {
    if (!autoScroll || !consoleRef.current || !shouldStickToBottomRef.current || !userPinnedToBottomRef.current) return;
    consoleRef.current.scrollTop = consoleRef.current.scrollHeight;
    shouldStickToBottomRef.current = false;
  }, [logs, autoScroll]);

  const isNearBottom = (element) => {
    if (!element) return true;
    const distanceFromBottom = element.scrollHeight - element.scrollTop - element.clientHeight;
    return distanceFromBottom <= 24;
  };

  const handleConsoleScroll = () => {
    userPinnedToBottomRef.current = isNearBottom(consoleRef.current);
  };

  const loadLogs = async (showLoading = false) => {
    if (showLoading) setLoading(true);
    try {
      const logContent = await invoke('get_instance_log', { instanceId: instance.id });
      if (typeof logContent === 'string') {
        const normalizedLog = logContent.replace(/\r\n/g, '\n');
        if (normalizedLog === lastRawLogRef.current) {
          if (showLoading) setLoading(false);
          return;
        }

        lastRawLogRef.current = normalizedLog;

        if (normalizedLog.trim().length === 0) {
          setLogs([]);
          logsRef.current = [];
          shouldStickToBottomRef.current = false;
          userPinnedToBottomRef.current = true;
        } else {
          const lines = normalizedLog.split('\n').map((line, index) => ({
            id: index,
            text: line,
            type: getLineType(line)
          }));
          const previousCount = logsRef.current.length;
          const hasNewOutput = lines.length > previousCount;
          shouldStickToBottomRef.current = hasNewOutput && userPinnedToBottomRef.current;
          setLogs(lines);
        }
      } else {
        setLogs([]);
        logsRef.current = [];
        lastRawLogRef.current = '';
        shouldStickToBottomRef.current = false;
        userPinnedToBottomRef.current = true;
      }
    } catch (error) {
      console.error('Failed to load logs:', error);
    }
    if (showLoading) setLoading(false);
  };

  const getLineType = (line) => {
    const lowerLine = line.toLowerCase();
    if (lowerLine.includes('[error]') || lowerLine.includes('exception') || lowerLine.includes('error:')) {
      return 'error';
    }
    if (lowerLine.includes('[warn]') || lowerLine.includes('warning')) {
      return 'warn';
    }
    if (lowerLine.includes('[info]')) {
      return 'info';
    }
    return '';
  };

  const handleOpenLogsFolder = async () => {
    try {
      await invoke('open_instance_folder', {
        instanceId: instance.id,
        folderType: 'logs'
      });
    } catch (error) {
      console.error('Failed to open folder:', error); if (onShowNotification) {
        onShowNotification(`Failed to open logs folder: ${error}`, 'error');
      }
    }
  };

  const handleAutoUpdateChange = async (checked) => {
    setAutoUpdate(checked);
    try {
      const updatedInstance = { ...instance, console_auto_update: checked };
      await invoke('update_instance', { instance: updatedInstance });
      if (onInstanceUpdated) onInstanceUpdated(updatedInstance);
    } catch (error) {
      console.error('Failed to update console setting:', error);
    }
  };

  const handleRefresh = () => {
    (async () => {
      setLoading(true);
      try {
        await new Promise((resolve) => setTimeout(resolve, 500));
        await loadLogs(false);
      } finally {
        setLoading(false);
      }
    })();
  };

  const handleClear = () => {
    setLogs([]);
    logsRef.current = [];
    lastRawLogRef.current = '';
    shouldStickToBottomRef.current = false;
    userPinnedToBottomRef.current = true;
  };

  return (
    <div className="console-tab">
      <div className="console-actions">
        <button className="open-btn" type="button" onClick={handleRefresh} title="Refresh logs">
          <RotateCcw size={16} className={loading ? 'spinning' : ''} />
          <span>Refresh</span>
        </button>
        <button className="open-btn" type="button" onClick={handleClear} title="Clear console">
          <Trash2 size={16} />
          <span>Clear</span>
        </button>
        <button className="open-btn" type="button" onClick={handleOpenLogsFolder} title="Open logs folder">
          <FolderOpen size={16} />
          <span>Open Folder</span>
        </button>
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '14px', color: 'var(--text-secondary)', fontSize: '14px' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={autoUpdate}
              onChange={(e) => handleAutoUpdateChange(e.target.checked)}
            />
            Auto-update
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={autoScroll}
              onChange={(e) => setAutoScroll(e.target.checked)}
            />
            Auto-scroll
          </label>
        </div>
      </div>

      <div className={`console-output-wrap ${loading ? 'is-refreshing' : ''}`}>
        <div className="console-output" ref={consoleRef} onScroll={handleConsoleScroll}>
          <div className="console-content">
            {loading && logs.length === 0 ? (
              <div className="console-loading-inner">
                <div className="loading-spinner"></div>
                <p>Loading instance logs...</p>
              </div>
            ) : (
              <>
                {logs.length === 0 ? (
                  <div className="no-logs">
                    No logs available. Launch the game to see console output.
                  </div>
                ) : (
                  logs.map((line) => (
                    <div key={line.id} className={`log-line ${line.type}`}>
                      {line.text}
                    </div>
                  ))
                )}
              </>
            )}
          </div>
        </div>
        {loading && (
          <div className="console-refreshing-overlay">
            <div className="console-refreshing-pill">
              <div className="loading-spinner small"></div>
              <span>Refreshing...</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default memo(InstanceConsole);
