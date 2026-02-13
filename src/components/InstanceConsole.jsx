import { useState, useEffect, useRef, useCallback, memo } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { Trash2, ChevronDown, Check } from 'lucide-react';
import SubTabs from './SubTabs';

const CONSOLE_FONT_OPTIONS = [
  {
    id: 'jetbrains-mono',
    label: 'JetBrains Mono',
    checkFamily: 'JetBrains Mono',
    family: "'JetBrains Mono', 'Consolas', 'SFMono-Regular', Menlo, Monaco, monospace"
  },
  {
    id: 'fira-code',
    label: 'Fira Code',
    checkFamily: 'Fira Code',
    family: "'Fira Code', 'Consolas', 'SFMono-Regular', Menlo, Monaco, monospace"
  },
  {
    id: 'source-code-pro',
    label: 'Source Code Pro',
    checkFamily: 'Source Code Pro',
    family: "'Source Code Pro', 'Consolas', 'SFMono-Regular', Menlo, Monaco, monospace"
  }
];

const DEFAULT_CONSOLE_FONT_ID = CONSOLE_FONT_OPTIONS[0].id;
const CONSOLE_FONT_SIZE_OPTIONS = [11, 12, 13, 14, 15, 16, 18];
const DEFAULT_CONSOLE_FONT_SIZE = 12;
const DEFAULT_JUMP_TO_BOTTOM_ON_OPEN = true;
const CONSOLE_INSTALLED_FONTS_KEY = 'console-installed-fonts';
const PRELOADED_CONSOLE_FONT_IDS = ['jetbrains-mono'];

const importBundledFont = async (fontId) => {
  switch (fontId) {
    case 'jetbrains-mono':
      await import('@fontsource/jetbrains-mono/400.css');
      await import('@fontsource/jetbrains-mono/500.css');
      await import('@fontsource/jetbrains-mono/700.css');
      return;
    case 'fira-code':
      await import('@fontsource/fira-code/400.css');
      await import('@fontsource/fira-code/500.css');
      await import('@fontsource/fira-code/700.css');
      return;
    case 'source-code-pro':
      await import('@fontsource/source-code-pro/400.css');
      await import('@fontsource/source-code-pro/500.css');
      await import('@fontsource/source-code-pro/700.css');
      return;
    default:
      return;
  }
};

function InstanceConsole({ instance, onInstanceUpdated, onShowNotification, clearOnMount, isScrolled }) {
  const [activeSubTab, setActiveSubTab] = useState('console');
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [autoScroll, setAutoScroll] = useState(true);
  const [jumpToBottomOnOpen, setJumpToBottomOnOpen] = useState(DEFAULT_JUMP_TO_BOTTOM_ON_OPEN);
  const [autoUpdate, setAutoUpdate] = useState(instance.console_auto_update || false);
  const [consoleFontId, setConsoleFontId] = useState(DEFAULT_CONSOLE_FONT_ID);
  const [consoleFontSize, setConsoleFontSize] = useState(DEFAULT_CONSOLE_FONT_SIZE);
  const [fontAvailability, setFontAvailability] = useState({});
  const [appInstalledFontIds, setAppInstalledFontIds] = useState([]);
  const [installingFontId, setInstallingFontId] = useState(null);
  const [fontInstallError, setFontInstallError] = useState('');
  const [computedConsoleFontFamily, setComputedConsoleFontFamily] = useState('');
  const [fontRenderVerification, setFontRenderVerification] = useState('pending');
  const [showFontDropdown, setShowFontDropdown] = useState(false);
  const [showFontSizeDropdown, setShowFontSizeDropdown] = useState(false);
  const [fontDropdownUpwards, setFontDropdownUpwards] = useState(false);
  const [fontSizeDropdownUpwards, setFontSizeDropdownUpwards] = useState(false);
  const consoleRef = useRef(null);
  const fontDropdownRef = useRef(null);
  const fontSizeDropdownRef = useRef(null);
  const lastRawLogRef = useRef('');
  const logsRef = useRef([]);
  const shouldStickToBottomRef = useRef(true);
  const userPinnedToBottomRef = useRef(true);
  const latestLoadRequestIdRef = useRef(0);
  const isClearingRef = useRef(false);
  const pendingOpenJumpRef = useRef(false);
  const openJumpAnimationFrameRef = useRef(null);
  const selectedConsoleFont = CONSOLE_FONT_OPTIONS.find(option => option.id === consoleFontId) || CONSOLE_FONT_OPTIONS[0];

  useEffect(() => {
    setAutoUpdate(instance.console_auto_update || false);
  }, [instance.console_auto_update]);

  const isFontAvailable = useCallback((option) => {
    if (!option) return true;
    return appInstalledFontIds.includes(option.id);
  }, [appInstalledFontIds]);

  useEffect(() => {
    let cancelled = false;

    const bootstrapInstalledFonts = async () => {
      try {
        const raw = localStorage.getItem(CONSOLE_INSTALLED_FONTS_KEY);
        const parsed = raw ? JSON.parse(raw) : [];
        const storedIds = Array.isArray(parsed)
          ? parsed.filter((id) => CONSOLE_FONT_OPTIONS.some(option => option.id === id))
          : [];

        const mergedStoredIds = Array.from(new Set([...PRELOADED_CONSOLE_FONT_IDS, ...storedIds]));

        for (const fontId of mergedStoredIds) {
          await importBundledFont(fontId);
        }

        if (!cancelled) {
          setAppInstalledFontIds(mergedStoredIds);
          localStorage.setItem(CONSOLE_INSTALLED_FONTS_KEY, JSON.stringify(mergedStoredIds));
        }
      } catch (error) {
        console.warn('Failed to restore installed console fonts', error);
      }
    };

    bootstrapInstalledFonts();

    return () => {
      cancelled = true;
    };
  }, []);

  const refreshFontAvailability = useCallback(async () => {
    try {
      if (document?.fonts?.ready) {
        await document.fonts.ready;
      }
    } catch {
      // ignore
    }

    const next = {};
    for (const option of CONSOLE_FONT_OPTIONS) {
      next[option.id] = isFontAvailable(option);
    }
    setFontAvailability(next);
  }, [isFontAvailable]);

  useEffect(() => {
    const storageKey = `instance-console-font:${instance.id}`;
    try {
      const saved = localStorage.getItem(storageKey);
      if (saved && CONSOLE_FONT_OPTIONS.some(option => option.id === saved)) {
        setConsoleFontId(saved);
      } else {
        setConsoleFontId(DEFAULT_CONSOLE_FONT_ID);
      }
    } catch (error) {
      console.warn('Failed to load console font preference', error);
      setConsoleFontId(DEFAULT_CONSOLE_FONT_ID);
    }
  }, [instance.id]);

  useEffect(() => {
    const storageKey = `instance-console-font-size:${instance.id}`;
    try {
      const raw = localStorage.getItem(storageKey);
      const parsed = raw ? Number.parseInt(raw, 10) : Number.NaN;
      if (Number.isFinite(parsed) && CONSOLE_FONT_SIZE_OPTIONS.includes(parsed)) {
        setConsoleFontSize(parsed);
      } else {
        setConsoleFontSize(DEFAULT_CONSOLE_FONT_SIZE);
      }
    } catch {
      setConsoleFontSize(DEFAULT_CONSOLE_FONT_SIZE);
    }
  }, [instance.id]);

  useEffect(() => {
    refreshFontAvailability();
  }, [refreshFontAvailability]);

  useEffect(() => {
    const element = consoleRef.current;
    if (!element) {
      setComputedConsoleFontFamily('Console tab not mounted');
      return;
    }

    const computed = window.getComputedStyle(element).fontFamily || '';
    setComputedConsoleFontFamily(computed);
  }, [activeSubTab, consoleFontId, logs.length]);

  useEffect(() => {
    const verifyRenderedFont = async () => {
      try {
        if (activeSubTab !== 'console') {
          setFontRenderVerification('pending');
          return;
        }

        if (document?.fonts?.ready) {
          await document.fonts.ready;
        }

        const canvas = document.createElement('canvas');
        const context = canvas.getContext('2d');
        if (!context) {
          setFontRenderVerification('unknown');
          return;
        }

        const sample = 'MWwmIl1O0[]{}<>@#%&|/\\';
        context.font = `400 14px "${selectedConsoleFont.checkFamily}", monospace`;
        const selectedWidth = context.measureText(sample).width;

        context.font = '400 14px monospace';
        const fallbackWidth = context.measureText(sample).width;

        const delta = Math.abs(selectedWidth - fallbackWidth);
        setFontRenderVerification(delta > 0.2 ? 'applied' : 'fallback');
      } catch {
        setFontRenderVerification('unknown');
      }
    };

    verifyRenderedFont();
  }, [activeSubTab, selectedConsoleFont, logs.length]);

  const animateScrollToBottom = useCallback((duration = 320) => {
    const element = consoleRef.current;
    if (!element) return;

    const target = Math.max(0, element.scrollHeight - element.clientHeight);
    const start = element.scrollTop;
    const distance = target - start;

    if (Math.abs(distance) < 1) {
      element.scrollTop = target;
      pendingOpenJumpRef.current = false;
      return;
    }

    if (openJumpAnimationFrameRef.current) {
      cancelAnimationFrame(openJumpAnimationFrameRef.current);
      openJumpAnimationFrameRef.current = null;
    }

    const startTime = performance.now();
    const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);

    const tick = (now) => {
      const elapsed = now - startTime;
      const progress = Math.min(elapsed / duration, 1);
      const eased = easeOutCubic(progress);
      element.scrollTop = start + (distance * eased);

      if (progress < 1) {
        openJumpAnimationFrameRef.current = requestAnimationFrame(tick);
      } else {
        openJumpAnimationFrameRef.current = null;
        pendingOpenJumpRef.current = false;
      }
    };

    openJumpAnimationFrameRef.current = requestAnimationFrame(tick);
  }, []);

  useEffect(() => {
    if (!pendingOpenJumpRef.current || !jumpToBottomOnOpen || !consoleRef.current) return;
    animateScrollToBottom(320);
  }, [logs, jumpToBottomOnOpen, animateScrollToBottom]);

  useEffect(() => {
    if (activeSubTab !== 'console' || !jumpToBottomOnOpen) {
      pendingOpenJumpRef.current = false;
      return;
    }

    pendingOpenJumpRef.current = true;
    const frame = requestAnimationFrame(() => {
      if (pendingOpenJumpRef.current) {
        animateScrollToBottom(320);
      }
    });

    return () => cancelAnimationFrame(frame);
  }, [activeSubTab, jumpToBottomOnOpen, animateScrollToBottom]);

  useEffect(() => {
    return () => {
      if (openJumpAnimationFrameRef.current) {
        cancelAnimationFrame(openJumpAnimationFrameRef.current);
        openJumpAnimationFrameRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    logsRef.current = logs;
  }, [logs]);

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (fontDropdownRef.current && !fontDropdownRef.current.contains(event.target)) {
        setShowFontDropdown(false);
      }
      if (fontSizeDropdownRef.current && !fontSizeDropdownRef.current.contains(event.target)) {
        setShowFontSizeDropdown(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, []);

  const shouldOpenDropdownUpwards = useCallback((triggerElement, estimatedMenuHeight = 220) => {
    if (!triggerElement) return false;
    const rect = triggerElement.getBoundingClientRect();
    const spaceBelow = window.innerHeight - rect.bottom;
    const spaceAbove = rect.top;
    return spaceBelow < estimatedMenuHeight && spaceAbove > spaceBelow;
  }, []);

  useEffect(() => {
    if (!showFontDropdown) return;
    setFontDropdownUpwards(shouldOpenDropdownUpwards(fontDropdownRef.current, 240));
  }, [showFontDropdown, shouldOpenDropdownUpwards]);

  useEffect(() => {
    if (!showFontSizeDropdown) return;
    setFontSizeDropdownUpwards(shouldOpenDropdownUpwards(fontSizeDropdownRef.current, 220));
  }, [showFontSizeDropdown, shouldOpenDropdownUpwards]);

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
    let openJumpPreference = DEFAULT_JUMP_TO_BOTTOM_ON_OPEN;
    const storageKey = `instance-console-jump-open:${instance.id}`;
    try {
      const raw = localStorage.getItem(storageKey);
      if (raw !== null) {
        openJumpPreference = raw === 'true';
      }
    } catch {
      openJumpPreference = DEFAULT_JUMP_TO_BOTTOM_ON_OPEN;
    }

    setJumpToBottomOnOpen(openJumpPreference);
    pendingOpenJumpRef.current = openJumpPreference;
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
    const requestId = ++latestLoadRequestIdRef.current;
    if (showLoading) setLoading(true);
    try {
      const logContent = await invoke('get_instance_log', { instanceId: instance.id });

      if (requestId !== latestLoadRequestIdRef.current || isClearingRef.current) {
        if (showLoading) setLoading(false);
        return;
      }

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

  const handleClear = () => {
    (async () => {
      isClearingRef.current = true;
      latestLoadRequestIdRef.current += 1;

      setLogs([]);
      logsRef.current = [];
      lastRawLogRef.current = '';
      shouldStickToBottomRef.current = false;
      userPinnedToBottomRef.current = true;

      try {
        await invoke('clear_instance_log', { instanceId: instance.id });
      } catch (error) {
        console.error('Failed to clear instance log:', error);
        if (onShowNotification) {
          onShowNotification(`Failed to clear logs: ${error}`, 'error');
        }
      } finally {
        isClearingRef.current = false;
        await loadLogs(false);
      }
    })();
  };

  const handleConsoleFontChange = (fontId) => {
    setConsoleFontId(fontId);
    setFontInstallError('');
    const storageKey = `instance-console-font:${instance.id}`;
    try {
      localStorage.setItem(storageKey, fontId);
    } catch (error) {
      console.warn('Failed to persist console font preference', error);
    }
  };

  const handleConsoleFontSizeChange = (fontSize) => {
    setConsoleFontSize(fontSize);
    const storageKey = `instance-console-font-size:${instance.id}`;
    try {
      localStorage.setItem(storageKey, String(fontSize));
    } catch (error) {
      console.warn('Failed to persist console font size preference', error);
    }
  };

  const handleJumpToBottomOnOpenChange = (enabled) => {
    setJumpToBottomOnOpen(enabled);
    const storageKey = `instance-console-jump-open:${instance.id}`;
    try {
      localStorage.setItem(storageKey, String(enabled));
    } catch (error) {
      console.warn('Failed to persist console open-jump preference', error);
    }
  };

  const selectedFontInstalled = !!fontAvailability[selectedConsoleFont.id];
  const selectedFontSizeLabel = `${consoleFontSize}px`;
  const selectedFontStyle = {
    fontFamily: selectedConsoleFont.family,
    fontSize: `${consoleFontSize}px`,
    fontWeight: 400,
    fontFeatureSettings: '"calt" 0'
  };

  const installSelectedFont = async () => {
    if (!selectedConsoleFont?.id) return;

    setInstallingFontId(selectedConsoleFont.id);
    setFontInstallError('');

    try {
      await importBundledFont(selectedConsoleFont.id);

      if (document?.fonts?.load) {
        await Promise.all([
          document.fonts.load(`400 14px "${selectedConsoleFont.checkFamily}"`),
          document.fonts.load(`500 14px "${selectedConsoleFont.checkFamily}"`),
          document.fonts.load(`700 14px "${selectedConsoleFont.checkFamily}"`),
        ]);
      }

      const nextInstalled = Array.from(new Set([...appInstalledFontIds, selectedConsoleFont.id]));
      setAppInstalledFontIds(nextInstalled);
      localStorage.setItem(CONSOLE_INSTALLED_FONTS_KEY, JSON.stringify(nextInstalled));

      await refreshFontAvailability();

      if (onShowNotification) {
        onShowNotification(`${selectedConsoleFont.label} installed`, 'success');
      }
    } catch (error) {
      const message = String(error);
      setFontInstallError(message);
      if (onShowNotification) {
        onShowNotification(`Font install failed: ${message}`, 'error');
      }
    } finally {
      setInstallingFontId(null);
    }
  };

  return (
    <div className="console-tab">
      <div className={`sub-tabs-row ${isScrolled ? 'scrolled' : ''}`}>
        <SubTabs
          tabs={[
            { id: 'console', label: 'Console' },
            { id: 'settings', label: 'Console Settings' }
          ]}
          activeTab={activeSubTab}
          onTabChange={setActiveSubTab}
        />
        <div className="sub-tabs-actions">
          {activeSubTab === 'console' && (
            <button className="open-folder-btn" type="button" onClick={handleOpenLogsFolder} title="Open logs folder">
              📁 Folder
            </button>
          )}
        </div>
      </div>

      {activeSubTab === 'console' ? (
        <>
          <div className={`console-output-wrap ${loading ? 'is-refreshing' : ''}`}>
            <div
              key={`console-output-${consoleFontId}`}
              className="console-output"
              ref={consoleRef}
              onScroll={handleConsoleScroll}
              style={selectedFontStyle}
            >
              <div className="console-content" style={selectedFontStyle}>
                {loading && logs.length === 0 ? (
                  <div className="console-loading-inner">
                    <div className="loading-spinner"></div>
                    <p>Loading instance logs...</p>
                  </div>
                ) : (
                  <>
                    {logs.length === 0 ? (
                      <div className="no-logs" style={selectedFontStyle}>
                        No logs available. Launch the game to see console output.
                      </div>
                    ) : (
                      logs.map((line) => (
                        <div key={line.id} className={`log-line ${line.type}`} style={selectedFontStyle}>
                          {line.text}
                        </div>
                      ))
                    )}
                  </>
                )}
              </div>
            </div>
            <button className="console-clear-fab" type="button" onClick={handleClear} title="Clear console">
              <Trash2 size={15} />
              <span>Clear</span>
            </button>
            {loading && (
              <div className="console-refreshing-overlay">
                <div className="console-refreshing-pill">
                  <div className="loading-spinner small"></div>
                  <span>Refreshing...</span>
                </div>
              </div>
            )}
          </div>
        </>
      ) : (
        <div className="console-settings-panel">
          <h4>Console Settings</h4>
          <div className="console-settings-options">
            <div className="console-setting-toggle console-setting-block">
              <span>Font</span>
              <div className="p-dropdown" ref={fontDropdownRef}>
                <button
                  className={`p-dropdown-trigger ${showFontDropdown ? 'active' : ''}`}
                  onClick={() => setShowFontDropdown(!showFontDropdown)}
                  style={{ minWidth: '220px' }}
                >
                  <span>{selectedConsoleFont.label}</span>
                  <ChevronDown size={14} className={`trigger-icon ${showFontDropdown ? 'flip' : ''}`} />
                </button>

                {showFontDropdown && (
                  <div className={`p-dropdown-menu ${fontDropdownUpwards ? 'p-dropdown-menu-upwards' : ''}`}>
                    {CONSOLE_FONT_OPTIONS.map((option) => (
                      <div
                        key={option.id}
                        className={`p-dropdown-item ${consoleFontId === option.id ? 'selected' : ''}`}
                        onClick={() => {
                          handleConsoleFontChange(option.id);
                          setShowFontDropdown(false);
                        }}
                      >
                        <span>{option.label}</span>
                        {consoleFontId === option.id && <Check size={14} className="selected-icon" />}
                      </div>
                    ))}
                  </div>
                )}
              </div>
              <div className={`console-font-status ${selectedFontInstalled ? 'installed' : 'missing'}`}>
                {selectedFontInstalled ? (
                  <span>{selectedConsoleFont.label} is available</span>
                ) : (
                  <span>{selectedConsoleFont.label} is missing on this system/app</span>
                )}
                {!selectedFontInstalled && (
                  <button
                    type="button"
                    className="console-font-install-btn"
                    onClick={installSelectedFont}
                    disabled={installingFontId === selectedConsoleFont.id}
                  >
                    {installingFontId === selectedConsoleFont.id ? 'Installing...' : 'Install'}
                  </button>
                )}
              </div>
              <div className="console-font-diagnostics">
                Computed font: {computedConsoleFontFamily || 'Unknown'}
              </div>
              <div className={`console-font-diagnostics ${fontRenderVerification === 'fallback' ? 'warn' : ''}`}>
                Render check: {fontRenderVerification === 'applied'
                  ? 'Selected font is rendering'
                  : fontRenderVerification === 'fallback'
                    ? 'Likely fallback font (selected face not applied)'
                    : fontRenderVerification === 'pending'
                      ? 'Switch to Console tab to verify render'
                      : 'Unable to verify'}
              </div>
              {fontInstallError && (
                <div className="console-font-install-error">{fontInstallError}</div>
              )}
            </div>
            <div className="console-setting-toggle console-setting-block">
              <span>Font Size</span>
              <div className="p-dropdown" ref={fontSizeDropdownRef}>
                <button
                  className={`p-dropdown-trigger ${showFontSizeDropdown ? 'active' : ''}`}
                  onClick={() => setShowFontSizeDropdown(!showFontSizeDropdown)}
                  style={{ minWidth: '120px' }}
                >
                  <span>{selectedFontSizeLabel}</span>
                  <ChevronDown size={14} className={`trigger-icon ${showFontSizeDropdown ? 'flip' : ''}`} />
                </button>

                {showFontSizeDropdown && (
                  <div className={`p-dropdown-menu ${fontSizeDropdownUpwards ? 'p-dropdown-menu-upwards' : ''}`}>
                    {CONSOLE_FONT_SIZE_OPTIONS.map((size) => (
                      <div
                        key={size}
                        className={`p-dropdown-item ${consoleFontSize === size ? 'selected' : ''}`}
                        onClick={() => {
                          handleConsoleFontSizeChange(size);
                          setShowFontSizeDropdown(false);
                        }}
                      >
                        <span>{size}px</span>
                        {consoleFontSize === size && <Check size={14} className="selected-icon" />}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
            <div className="console-toggle-setting">
              <div className="console-toggle-setting-row">
                <div className="console-toggle-setting-text">
                  <span className="console-toggle-setting-title">Jump to bottom on open</span>
                  <p className="console-toggle-setting-description">Automatically scrolls to the latest log line when you open the Console tab.</p>
                </div>
                <button
                  type="button"
                  className={`item-toggle ${jumpToBottomOnOpen ? 'enabled' : ''}`}
                  onClick={() => handleJumpToBottomOnOpenChange(!jumpToBottomOnOpen)}
                  role="switch"
                  aria-checked={jumpToBottomOnOpen}
                  title={jumpToBottomOnOpen ? 'Disable jump on open' : 'Enable jump on open'}
                />
              </div>
            </div>

            <div className="console-toggle-setting">
              <div className="console-toggle-setting-row">
                <div className="console-toggle-setting-text">
                  <span className="console-toggle-setting-title">Auto-update</span>
                  <p className="console-toggle-setting-description">Refreshes the console output automatically every 2 seconds.</p>
                </div>
                <button
                  type="button"
                  className={`item-toggle ${autoUpdate ? 'enabled' : ''}`}
                  onClick={() => handleAutoUpdateChange(!autoUpdate)}
                  role="switch"
                  aria-checked={autoUpdate}
                  title={autoUpdate ? 'Disable auto-update' : 'Enable auto-update'}
                />
              </div>
            </div>

            <div className="console-toggle-setting">
              <div className="console-toggle-setting-row">
                <div className="console-toggle-setting-text">
                  <span className="console-toggle-setting-title">Auto-scroll</span>
                  <p className="console-toggle-setting-description">Keeps the view pinned to the latest log lines when new output arrives.</p>
                </div>
                <button
                  type="button"
                  className={`item-toggle ${autoScroll ? 'enabled' : ''}`}
                  onClick={() => setAutoScroll(!autoScroll)}
                  role="switch"
                  aria-checked={autoScroll}
                  title={autoScroll ? 'Disable auto-scroll' : 'Enable auto-scroll'}
                />
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default memo(InstanceConsole);
