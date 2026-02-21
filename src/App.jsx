import { useState, useEffect, useCallback, useRef, useMemo, lazy, Suspense } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { open } from '@tauri-apps/plugin-shell';
import { save } from '@tauri-apps/plugin-dialog';
import { listen, emit } from '@tauri-apps/api/event';
import { WebviewWindow } from '@tauri-apps/api/webviewWindow';
import { getCurrentWindow } from '@tauri-apps/api/window';

// Heavy components - Lazy loaded
const InstanceEditor = lazy(() => import('./components/InstanceEditor'));
const Settings = lazy(() => import('./components/Settings'));
const Appearance = lazy(() => import('./components/Appearance'));
const Stats = lazy(() => import('./components/Stats'));
const SkinManager = lazy(() => import('./components/SkinManager'));
const CreateInstance = lazy(() => import('./components/CreateInstance'));
const Updates = lazy(() => import('./components/Updates'));
const Console = lazy(() => import('./components/Console'));

// Core UI - Synchronous
import Sidebar from './components/Sidebar';
import TitleBar from './components/TitleBar';
import InstanceList from './components/InstanceList';
import ContextMenu from './components/ContextMenu';
import LoginPrompt from './components/LoginPrompt';
import ConfirmModal from './components/ConfirmModal';
import AccountManagerModal from './components/AccountManagerModal';
import EditChoiceModal from './components/EditChoiceModal';
import { EMPTY_DOWNLOAD_TELEMETRY, clampProgress, splitDownloadStage } from './utils/downloadTelemetry';
import './App.css';

// Detect platform early for CSS perf overrides (WebKitGTK blur is slow on Linux)
if (navigator.platform.toLowerCase().includes('linux')) {
  document.documentElement.classList.add('platform-linux');
}

const startTime = window.initialHtmlLoad ? (performance.now() - window.initialHtmlLoad) : 0;
let bootstrapOffset = 0;
let offsetSynced = false;

const getElapsed = () => {
  const fromHtml = ((performance.now() - (window.initialHtmlLoad || performance.now())) / 1000);
  const total = (bootstrapOffset + fromHtml).toFixed(3);
  return `${total}s`;
};

const devLog = (...args) => {
  if (import.meta.env.DEV) {
    const message = args.map(arg => typeof arg === 'object' ? JSON.stringify(arg) : String(arg)).join(' ');
    // Only send to Rust if it's not a spammy render log or sync confirmation
    if (!message.includes('component rendering') && !message.includes('Clock synced')) {
      invoke('log_event', { level: 'debug', message }).catch(() => { });
    }
  }
};

const devError = (...args) => {
  if (import.meta.env.DEV) {
    const message = args.map(arg => typeof arg === 'object' ? JSON.stringify(arg) : String(arg)).join(' ');
    invoke('log_event', { level: 'error', message }).catch(() => { });
  }
};

const SUPPORTED_LOADER_KEYS = new Set(['fabric', 'forge', 'neoforge']);
const DEFAULT_INSTANCE_ICON = '/minecraft_logo.png';
const CATEGORY_LIST_STORAGE_KEY = 'instance-category-list';
const CATEGORY_LIST_UPDATED_EVENT = 'instance-category-list-updated';
const SIDEBAR_STYLE_CACHE_KEY = 'sidebar_style_cache';
const OPEN_CATEGORY_MANAGER_EVENT = 'open-instance-category-manager';
const PREFERRED_SERVER_STORAGE_KEY = 'instance-preferred-server-map';

const normalizeCategoryName = (value) => (typeof value === 'string' ? value.trim() : '');

const loadStoredCategories = () => {
  try {
    const raw = localStorage.getItem(CATEGORY_LIST_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];

    const dedupedMap = new Map();
    for (const entry of parsed) {
      const normalized = normalizeCategoryName(entry);
      if (!normalized) continue;
      const key = normalized.toLowerCase();
      if (!dedupedMap.has(key)) {
        dedupedMap.set(key, normalized);
      }
    }
    return Array.from(dedupedMap.values());
  } catch (error) {
    console.warn('Failed to load stored category list:', error);
    return [];
  }
};

const persistStoredCategories = (categories) => {
  const dedupedMap = new Map();
  for (const entry of categories || []) {
    const normalized = normalizeCategoryName(entry);
    if (!normalized) continue;
    const key = normalized.toLowerCase();
    if (!dedupedMap.has(key)) {
      dedupedMap.set(key, normalized);
    }
  }
  const normalizedList = Array.from(dedupedMap.values());
  localStorage.setItem(CATEGORY_LIST_STORAGE_KEY, JSON.stringify(normalizedList));
  window.dispatchEvent(new CustomEvent(CATEGORY_LIST_UPDATED_EVENT, { detail: { categories: normalizedList } }));
  return normalizedList;
};

const buildCategoryPickerModalState = (instances, targetInstance) => {
  const countsMap = new Map();
  for (const instance of instances || []) {
    const category = normalizeCategoryName(instance?.category);
    if (!category) continue;
    const key = category.toLowerCase();
    const existing = countsMap.get(key);
    if (existing) {
      existing.count += 1;
    } else {
      countsMap.set(key, { name: category, count: 1 });
    }
  }

  const storedCategories = loadStoredCategories();
  const seenCategoryKeys = new Set();
  const categories = [];

  for (const category of storedCategories) {
    const key = category.toLowerCase();
    if (seenCategoryKeys.has(key)) continue;
    seenCategoryKeys.add(key);
    categories.push(category);
    if (!countsMap.has(key)) {
      countsMap.set(key, { name: category, count: 0 });
    }
  }

  const discoveredCategories = Array.from(countsMap.values())
    .map((entry) => entry.name)
    .filter((entry) => !seenCategoryKeys.has(entry.toLowerCase()))
    .sort((left, right) => left.localeCompare(right));
  categories.push(...discoveredCategories);

  const categoryCounts = Object.fromEntries(
    Array.from(countsMap.entries()).map(([key, value]) => [key, value.count])
  );

  return {
    instance: targetInstance,
    categories,
    categoryCounts,
    selectedCategory: normalizeCategoryName(targetInstance?.category),
    creatingNew: false,
    newCategoryName: '',
    editingCategoryKey: '',
    editingCategoryValue: '',
    pendingDeleteCategoryKey: '',
    draggedCategoryKey: '',
    dragOverCategoryKey: ''
  };
};

const compareLooseVersions = (left, right) => {
  const leftParts = String(left || '').match(/\d+/g)?.map(Number) || [];
  const rightParts = String(right || '').match(/\d+/g)?.map(Number) || [];

  if (leftParts.length > 0 && rightParts.length > 0) {
    const maxLength = Math.max(leftParts.length, rightParts.length);
    for (let i = 0; i < maxLength; i += 1) {
      const leftVal = leftParts[i] ?? 0;
      const rightVal = rightParts[i] ?? 0;
      if (leftVal > rightVal) return 1;
      if (leftVal < rightVal) return -1;
    }
    return 0;
  }

  return String(left || '').localeCompare(String(right || ''), undefined, {
    numeric: true,
    sensitivity: 'base'
  });
};

const pickPreferredLoaderVersion = (loaderKey, versions) => {
  if (!Array.isArray(versions) || versions.length === 0) return null;
  if (loaderKey === 'forge') {
    return versions.find((v) => v?.version_type === 'latest')
      || versions.find((v) => v?.version_type === 'recommended')
      || versions[0];
  }
  return versions[0];
};

function FpsCounter() {
  const [fps, setFps] = useState(0);
  const framesRef = useRef(0);
  const lastTimeRef = useRef(performance.now());

  useEffect(() => {
    let rafId;
    const tick = (now) => {
      framesRef.current++;
      const delta = now - lastTimeRef.current;
      if (delta >= 500) {
        setFps(Math.round((framesRef.current * 1000) / delta));
        framesRef.current = 0;
        lastTimeRef.current = now;
      }
      rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, []);

  return (
    <div className="fps-counter">{fps} FPS</div>
  );
}

function App() {
  const cachedSidebarStyle = useMemo(() => localStorage.getItem(SIDEBAR_STYLE_CACHE_KEY), []);
  const [activeTab, setActiveTab] = useState('instances');
  const [instances, setInstances] = useState([]);
  const [accounts, setAccounts] = useState([]);
  const [activeAccount, setActiveAccount] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isCreateTaskRunning, setIsCreateTaskRunning] = useState(false);
  const [launchingInstanceId, setLaunchingInstanceId] = useState(null);
  const [launchingInstanceIds, setLaunchingInstanceIds] = useState([]);
  const [launchProgressByInstance, setLaunchProgressByInstance] = useState({});
  const [stoppingInstanceIds, setStoppingInstanceIds] = useState([]);
  const [forceStoppingInstanceIds, setForceStoppingInstanceIds] = useState([]);
  const [loadingStatus, setLoadingStatus] = useState('');
  const [loadingProgress, setLoadingProgress] = useState(0);
  const [loadingBytes, setLoadingBytes] = useState({ current: 0, total: 0 });
  const [loadingCount, setLoadingCount] = useState({ current: 0, total: 0 });
  const [loadingTelemetry, setLoadingTelemetry] = useState(EMPTY_DOWNLOAD_TELEMETRY);
  const [notifications, setNotifications] = useState([]);
  const [editingInstanceId, setEditingInstanceId] = useState(null);
  const [deletingInstanceIds, setDeletingInstanceIds] = useState([]);
  const [contextMenu, setContextMenu] = useState(null);
  const [showLoginPrompt, setShowLoginPrompt] = useState(false);
  const [confirmModal, setConfirmModal] = useState(null);
  const [categoryEditorModal, setCategoryEditorModal] = useState(null);
  const [launchUpdatePrompt, setLaunchUpdatePrompt] = useState(null);
  const [runningInstances, setRunningInstances] = useState({}); // { id: { pid, start_time } }
  const [showWelcome, setShowWelcome] = useState(false);
  const [welcomeDontShow, setWelcomeDontShow] = useState(false);
  const [skinRefreshKey, setSkinRefreshKey] = useState(Date.now());
  const [currentSkinUrl, setCurrentSkinUrl] = useState(null);
  const [skinCache, setSkinCache] = useState({});
  const [logs, setLogs] = useState([]);
  const [launcherSettings, setLauncherSettings] = useState(null);
  const [showAccountManager, setShowAccountManager] = useState(false);
  const [isInitializing, setIsInitializing] = useState(true);
  const [openEditors, setOpenEditors] = useState([]);
  const [showEditChoiceModal, setShowEditChoiceModal] = useState(null); // { instanceId } or null
  const [downloadQueue, setDownloadQueue] = useState([]); // Array of { id, name, icon, status, progress }
  const [downloadHistory, setDownloadHistory] = useState([]); // Array of last 10 finished downloads
  const activeQueueDownloadIdRef = useRef(null);
  const launchUpdatePromptResolveRef = useRef(null);
  const launchUpdatePromptTailRef = useRef(Promise.resolve());
  const transferStatsRef = useRef({ lastBytes: null, lastTs: 0, speedBps: 0 });
  const instanceTransferStatsRef = useRef({});
  const launchingInstanceIdsRef = useRef([]);
  const handleLaunchInstanceRef = useRef(null);
  const activeLaunchingInstanceIdRef = useRef(null);
  const stoppingInstanceIdsRef = useRef([]);
  const forceStoppingInstanceIdsRef = useRef([]);
  const deletingInstanceIdsRef = useRef(new Set());
  const deleteQueueRef = useRef(Promise.resolve());
  const instanceSetupByInstanceRef = useRef({});
  const notificationsRef = useRef([]);
  const notificationTimersRef = useRef(new Map());
  const notificationCounterRef = useRef(0);
  const isMountedRef = useRef(true);

  const handleQueueDownload = useCallback((item) => {
    setDownloadQueue(prev => {
      // Avoid duplicates in active queue
      if (prev.find(i => i.id === item.id)) return prev;
      const newQueue = [...prev, {
        progress: 0,
        status: 'Queued',
        ...item
      }];
      emit('sync-download-queue', newQueue).catch(console.error);
      return newQueue;
    });
  }, []);

  const handleDequeueDownload = useCallback((id, addToHistory = true) => {
    setDownloadQueue(prev => {
      const item = prev.find(i => i.id === id);
      const newQueue = prev.filter(i => i.id !== id);
      if (activeQueueDownloadIdRef.current === id) {
        activeQueueDownloadIdRef.current = null;
      }

      if (item && addToHistory) {
        // Add to history
        setDownloadHistory(hPrev => {
          // Avoid duplicates in history
          const filteredHistory = hPrev.filter(h => h.id !== id);
          const newHistory = [{ ...item, status: 'Completed', finishedAt: Date.now() }, ...filteredHistory];
          const finalHistory = newHistory.slice(0, 10);
          emit('sync-download-history', finalHistory).catch(console.error);
          return finalHistory;
        });
      }

      emit('sync-download-queue', newQueue).catch(console.error);
      return newQueue;
    });
  }, []);

  const handleUpdateDownloadStatus = useCallback((id, statusUpdate) => {
    const update = (typeof statusUpdate === 'string')
      ? { status: statusUpdate }
      : (statusUpdate && typeof statusUpdate === 'object' ? statusUpdate : {});
    const normalizedStatus = typeof update.status === 'string' && update.status.trim()
      ? update.status.trim()
      : 'Pending...';
    const lowerStatus = normalizedStatus.toLowerCase();

    if (lowerStatus.includes('downloading')) {
      activeQueueDownloadIdRef.current = id;
    }
    if (
      activeQueueDownloadIdRef.current === id &&
      (lowerStatus.includes('complete') || lowerStatus.includes('installed') || lowerStatus.includes('failed') || lowerStatus.includes('error'))
    ) {
      activeQueueDownloadIdRef.current = null;
    }

    setDownloadQueue(prev => {
      const newQueue = prev.map(i => {
        if (i.id !== id) return i;
        const merged = {
          ...i,
          ...update,
          status: normalizedStatus
        };
        if (lowerStatus.includes('downloading')) {
          merged.trackBackendProgress = true;
        }
        if (lowerStatus.includes('installed') || lowerStatus.includes('complete') || lowerStatus.includes('failed') || lowerStatus.includes('error')) {
          merged.trackBackendProgress = false;
        }
        if (typeof update.progress === 'number') {
          merged.progress = clampProgress(update.progress);
        }
        return merged;
      });
      emit('sync-download-queue', newQueue).catch(console.error);
      return newQueue;
    });
  }, []);

  const handleClearDownloadHistory = useCallback(() => {
    setDownloadHistory([]);
    emit('sync-download-history', []).catch(console.error);
  }, []);

  const instanceSetupTasks = useMemo(
    () => downloadQueue.filter((item) => item?.kind === 'instance-setup'),
    [downloadQueue]
  );

  const instanceSetupByInstance = useMemo(() => {
    const map = {};
    instanceSetupTasks.forEach((task) => {
      if (task?.instanceId) {
        map[task.instanceId] = task;
      }
    });
    return map;
  }, [instanceSetupTasks]);

  useEffect(() => {
    launchingInstanceIdsRef.current = launchingInstanceIds;
  }, [launchingInstanceIds]);

  useEffect(() => {
    stoppingInstanceIdsRef.current = stoppingInstanceIds;
  }, [stoppingInstanceIds]);

  useEffect(() => {
    forceStoppingInstanceIdsRef.current = forceStoppingInstanceIds;
  }, [forceStoppingInstanceIds]);

  useEffect(() => {
    instanceSetupByInstanceRef.current = instanceSetupByInstance;
  }, [instanceSetupByInstance]);

  useEffect(() => {
    notificationsRef.current = notifications;
  }, [notifications]);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      if (launchUpdatePromptResolveRef.current) {
        launchUpdatePromptResolveRef.current({ action: 'ignore', disableFutureChecks: false });
        launchUpdatePromptResolveRef.current = null;
      }
    };
  }, []);

  const dismissNotification = useCallback((id) => {
    const target = notificationsRef.current.find((item) => item.id === id);
    if (!target || target.isLeaving) return;

    setNotifications((prev) => prev.map((item) => (
      item.id === id ? { ...item, isLeaving: true } : item
    )));

    const existingTimers = notificationTimersRef.current.get(id) || {};
    if (existingTimers.autoDismissTimer) {
      clearTimeout(existingTimers.autoDismissTimer);
    }
    if (existingTimers.removeTimer) {
      clearTimeout(existingTimers.removeTimer);
    }

    const removeTimer = setTimeout(() => {
      setNotifications((prev) => prev.filter((item) => item.id !== id));
      notificationTimersRef.current.delete(id);
    }, 240);

    notificationTimersRef.current.set(id, { ...existingTimers, removeTimer });
  }, []);

  const showNotification = useCallback((message, type = 'info') => {
    const id = `toast-${Date.now()}-${notificationCounterRef.current++}`;
    setNotifications((prev) => [...prev, { id, message, type, isLeaving: false }]);

    const autoDismissTimer = setTimeout(() => {
      dismissNotification(id);
    }, 5000);

    notificationTimersRef.current.set(id, { autoDismissTimer });
  }, [dismissNotification]);

  useEffect(() => () => {
    notificationTimersRef.current.forEach(({ autoDismissTimer, removeTimer }) => {
      if (autoDismissTimer) clearTimeout(autoDismissTimer);
      if (removeTimer) clearTimeout(removeTimer);
    });
    notificationTimersRef.current.clear();
  }, []);

  const resolveLaunchUpdatePrompt = useCallback((action) => {
    setLaunchUpdatePrompt((current) => {
      const resolver = launchUpdatePromptResolveRef.current;
      launchUpdatePromptResolveRef.current = null;
      if (resolver) {
        resolver({
          action,
          disableFutureChecks: current?.disableFutureChecks || false
        });
      }
      return null;
    });
  }, []);

  const promptLaunchUpdateChoice = useCallback((instance, modUpdates, loaderUpdate = null) => {
    const normalizedMods = Array.isArray(modUpdates) ? modUpdates : [];
    const entries = [
      ...(loaderUpdate ? [{
        id: `loader-${loaderUpdate.loaderKey}`,
        type: 'loader',
        name: `${loaderUpdate.loaderLabel} Loader`,
        currentLabel: loaderUpdate.currentVersion,
        latestLabel: loaderUpdate.latestVersion
      }] : []),
      ...normalizedMods.map((item, index) => ({
        id: `mod-${item.project_id || item.installed_filename || index}`,
        type: 'mod',
        name: item.installed_name || item.project_id || `Mod ${index + 1}`,
        currentLabel: item.installed_version_name || item.installed_version_id || 'Installed',
        latestLabel:
          item.latest_version?.version_number
          || item.latest_version?.name
          || item.latest_curseforge_version?.version_number
          || item.latest_curseforge_version?.name
          || 'Latest'
      }))
    ];

    const queuedPrompt = launchUpdatePromptTailRef.current
      .catch(() => undefined)
      .then(() => new Promise((resolve) => {
        if (!isMountedRef.current) {
          resolve({ action: 'ignore', disableFutureChecks: false });
          return;
        }

        launchUpdatePromptResolveRef.current = resolve;
        setLaunchUpdatePrompt({
          instanceId: instance.id,
          instanceName: instance.name,
          modUpdates: normalizedMods,
          loaderUpdate,
          entries,
          disableFutureChecks: false
        });
      }));

    launchUpdatePromptTailRef.current = queuedPrompt.then(
      () => undefined,
      () => undefined
    );

    return queuedPrompt;
  }, []);

  // Check if we are running in a pop-out window
  const urlParams = new URLSearchParams(window.location.search);
  const popoutMode = urlParams.get('popout');
  const popoutInstanceId = urlParams.get('instanceId');
  const sidebarStyleRaw = launcherSettings?.sidebar_style || cachedSidebarStyle || 'full';
  const sidebarStyle = (sidebarStyleRaw === 'compact' || sidebarStyleRaw === 'original-slim') ? 'compact' : 'full';

  // Show window once initialized
  useEffect(() => {
    if (!isInitializing) {
      // Small timeout to ensure the DOM is rendered before showing the window
      setTimeout(() => {
        getCurrentWindow().show().catch(err => devError('Failed to show window:', err));
      }, 100);
    }
  }, [isInitializing]);

  // Apply accent color from settings
  useEffect(() => {
    if (launcherSettings?.accent_color) {
      const root = document.documentElement;
      root.style.setProperty('--accent', launcherSettings.accent_color);

      // Convert hex to rgb for transparency support
      const hex = launcherSettings.accent_color.replace('#', '');
      const r = parseInt(hex.substring(0, 2), 16);
      const g = parseInt(hex.substring(2, 4), 16);
      const b = parseInt(hex.substring(4, 6), 16);

      if (!isNaN(r) && !isNaN(g) && !isNaN(b)) {
        root.style.setProperty('--accent-rgb', `${r}, ${g}, ${b}`);
      }
    }
  }, [launcherSettings]);

  useEffect(() => {
    const styleValue = launcherSettings?.sidebar_style;
    if (!styleValue) return;
    localStorage.setItem(SIDEBAR_STYLE_CACHE_KEY, styleValue);
  }, [launcherSettings?.sidebar_style]);

  useEffect(() => {
    // Load all cached skins on startup
    const cache = {};
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key.startsWith('skin_')) {
        cache[key.replace('skin_', '')] = localStorage.getItem(key);
      }
    }
    setSkinCache(cache);

    if (activeAccount?.uuid) {
      const cached = localStorage.getItem(`skin_${activeAccount.uuid}`);
      if (cached) setCurrentSkinUrl(cached);
    } else {
      setCurrentSkinUrl(null);
    }
  }, [activeAccount]);

  const loadSkinForAccount = useCallback(async (isLoggedIn, uuid) => {
    if (!isLoggedIn) {
      setCurrentSkinUrl(null);
      return;
    }

    try {
      const data = await invoke('get_mc_profile_full');
      const activeSkin = data.skins?.find(s => s.state === 'ACTIVE');
      if (activeSkin?.url) {
        setCurrentSkinUrl(activeSkin.url);
        if (uuid) {
          localStorage.setItem(`skin_${uuid}`, activeSkin.url);
          setSkinCache(prev => ({ ...prev, [uuid]: activeSkin.url }));
        }
      } else {
        // No custom skin, it's a default Steve/Alex
        setCurrentSkinUrl(null);
        if (uuid) {
          localStorage.removeItem(`skin_${uuid}`);
          setSkinCache(prev => {
            const next = { ...prev };
            delete next[uuid];
            return next;
          });
        }
      }
    } catch (err) {
      devLog('Silent skin load failed:', err);
    }
  }, []);

  const primeAccountSkins = useCallback(async (savedAccounts = []) => {
    const targets = Array.isArray(savedAccounts)
      ? savedAccounts.filter(
        (account) => account?.is_microsoft
          && account?.uuid
          && account?.access_token
          && !localStorage.getItem(`skin_${account.uuid}`)
      )
      : [];

    if (targets.length === 0) return;

    const resolvedEntries = await Promise.allSettled(
      targets.map(async (account) => {
        const profile = await invoke('get_mc_profile_full_with_token', {
          accessToken: account.access_token
        });
        const activeSkin = profile?.skins?.find((skin) => skin?.state === 'ACTIVE');
        if (!activeSkin?.url) return null;
        return { uuid: account.uuid, url: activeSkin.url };
      })
    );

    const nextEntries = resolvedEntries
      .filter((entry) => entry.status === 'fulfilled' && entry.value?.uuid && entry.value?.url)
      .map((entry) => entry.value);

    if (nextEntries.length === 0) return;

    nextEntries.forEach(({ uuid, url }) => {
      localStorage.setItem(`skin_${uuid}`, url);
    });

    setSkinCache((prev) => {
      const next = { ...prev };
      let changed = false;
      nextEntries.forEach(({ uuid, url }) => {
        if (next[uuid] !== url) {
          next[uuid] = url;
          changed = true;
        }
      });
      return changed ? next : prev;
    });
  }, []);

  const loadInstances = useCallback(async () => {
    try {
      const result = await invoke('get_instances');
      setInstances(result);
    } catch (error) {
      devError(`[DEBUG] [${getElapsed()}] Failed to load instances:`, error);
    }
  }, []);

  const loadRunningInstances = useCallback(async () => {
    try {
      const result = await invoke('get_running_instances');
      setRunningInstances(result);
    } catch (error) {
      devError(`[DEBUG] [${getElapsed()}] Failed to load running instances:`, error);
    }
  }, []);

  const loadLauncherSettings = useCallback(async () => {
    try {
      const settings = await invoke('get_settings');
      setLauncherSettings(settings);
    } catch (error) {
      devError(`[DEBUG] [${getElapsed()}] Failed to load settings:`, error);
      // Set defaults on error
      setLauncherSettings({
        enable_console: false,
        titlebar_location_next_to_logo: true,
        show_welcome: true,
        account_preview_mode: 'simple',
        sidebar_style: 'full',
        instance_header_style: 'glass-top',
        show_instance_editor_tab_icons: false
      });
    }
  }, []);

  const loadAccounts = useCallback(async () => {
    try {
      // Load saved accounts from Rust backend
      const savedData = await invoke('get_saved_accounts');

      if (!savedData.accounts || savedData.accounts.length === 0) {
        // No saved accounts, show login prompt
        setShowLoginPrompt(true);
        setActiveAccount({ username: 'Player', isLoggedIn: false, uuid: null });
        setAccounts([]);
        return;
      }

      // Convert saved accounts to UI format
      const uiAccounts = savedData.accounts.map(a => ({
        username: a.username,
        isLoggedIn: a.is_microsoft,
        uuid: a.uuid
      }));

      setAccounts(uiAccounts);
      void primeAccountSkins(savedData.accounts);

      // Find active account
      const activeUsername = savedData.active_account || savedData.accounts[0]?.username;
      const activeAcc = savedData.accounts.find(a => a.username === activeUsername);

      if (activeAcc) {
        const initialAccountState = {
          username: activeAcc.username,
          isLoggedIn: activeAcc.is_microsoft,
          uuid: activeAcc.uuid
        };

        setActiveAccount(initialAccountState);

        // ASYNC VALIDATION: Don't await this to avoid blocking app startup
        const validateAccountAsync = async () => {
          if (activeAcc.is_microsoft) {
            try {
              const isValid = await invoke('validate_account', { accessToken: activeAcc.access_token });

              if (!isValid) {
                // Try to refresh the token
                try {
                  const refreshed = await invoke('refresh_account', { username: activeAcc.username });
                  if (refreshed) {
                    // Reload accounts after refresh
                    const refreshedData = await invoke('get_saved_accounts');
                    const refreshedAcc = refreshedData.accounts.find(a => a.username === activeUsername);
                    if (refreshedAcc) {
                      await invoke('switch_account', { username: activeAcc.username });
                      setActiveAccount({
                        username: refreshedAcc.username,
                        isLoggedIn: true,
                        uuid: refreshedAcc.uuid
                      });
                      loadSkinForAccount(true, refreshedAcc.uuid);
                      return;
                    }
                  }
                } catch (refreshError) {
                  console.error('Failed to refresh token:', refreshError);
                  // Remove invalid account
                  await invoke('remove_saved_account', { username: activeAcc.username });
                  showNotification(`Session expired for ${activeAcc.username}. Please login again.`, 'warning');

                  // Update accounts list
                  const updatedData = await invoke('get_saved_accounts');
                  const updatedAccounts = (updatedData.accounts || []).map(a => ({
                    username: a.username,
                    isLoggedIn: a.is_microsoft,
                    uuid: a.uuid
                  }));
                  setAccounts(updatedAccounts);

                  if (updatedAccounts.length === 0) {
                    setShowLoginPrompt(true);
                    setActiveAccount({ username: 'Player', isLoggedIn: false, uuid: null });
                  } else {
                    // Switch to first available account
                    const firstAcc = updatedData.accounts[0];
                    await invoke('switch_account', { username: firstAcc.username });
                    setActiveAccount({
                      username: firstAcc.username,
                      isLoggedIn: firstAcc.is_microsoft,
                      uuid: firstAcc.uuid
                    });
                  }
                  return;
                }
              }
            } catch (err) {
              devLog('Silent account validation failed:', err);
            }
          }

          // Switch to active account in backend if not already done
          await invoke('switch_account', { username: activeAcc.username });
          // Fetch skin in background
          loadSkinForAccount(activeAcc.is_microsoft, activeAcc.uuid);
        };

        validateAccountAsync();
      }
    } catch (error) {
      devError('Failed to load accounts:', error);
      setShowLoginPrompt(true);
      setActiveAccount({ username: 'Player', isLoggedIn: false, uuid: null });
    }
  }, [loadSkinForAccount, primeAccountSkins, showNotification]);

  const initializationRef = useRef(false);

  useEffect(() => {
    const initializeApp = async () => {
      // Strictly prevent double-init
      if (initializationRef.current) return;
      initializationRef.current = true;

      try {
        const syncStart = performance.now();
        bootstrapOffset = await invoke('get_bootstrap_time');
        offsetSynced = true;
        const syncTime = (performance.now() - syncStart).toFixed(1);
      } catch (e) {
        bootstrapOffset = 0;
        offsetSynced = true;
      }

      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Initialization timed out')), 15000)
      );

      try {
        await Promise.race([
          Promise.all([
            loadInstances(),
            loadAccounts(),
            loadRunningInstances(),
            loadLauncherSettings()
          ]),
          timeoutPromise
        ]);
        // Short delay to ensure state updates and transitions are smooth
        setTimeout(() => setIsInitializing(false), 500);
      } catch (error) {
        devError(`[DEBUG] [${getElapsed()}] CRITICAL: Initialization halted:`, error);
        setIsInitializing(false);
      }
    };

    initializeApp();

    // Poll running instances periodically (process state can change without events)
    const runningPoll = setInterval(loadRunningInstances, 2000);

    // Disable default right-click unless Ctrl is pressed
    const handleContextMenu = (e) => {
      if (!e.ctrlKey) {
        e.preventDefault();
      }
    };
    document.addEventListener('contextmenu', handleContextMenu);

    // Listen for log events from Rust backend
    const unlistenLog = listen('app-log', (event) => {
      const { level, message, timestamp } = event.payload;
      setLogs(prev => [...prev.slice(-499), {
        id: Date.now() + Math.random(),
        level,
        message,
        timestamp: timestamp || new Date().toISOString()
      }]);

      const activeId = activeQueueDownloadIdRef.current;
      if (!activeId || typeof message !== 'string') {
        return;
      }

      const normalizedMessage = message
        .replace(/^\[[^\]]+\](?:\[[^\]]+\]){0,5}\s*/g, '')
        .trim();
      if (!normalizedMessage) {
        return;
      }

      const lower = normalizedMessage.toLowerCase();
      const importLogRelevant = (
        lower.includes('imported metadata for') ||
        lower.includes('resolved modrinth metadata for') ||
        lower.includes('installing fabric') ||
        lower.includes('installing forge') ||
        lower.includes('installing neoforge') ||
        lower.includes('successfully imported prism instance')
      );
      if (!importLogRelevant) {
        return;
      }

      setDownloadQueue((prev) => {
        const index = prev.findIndex(
          (item) => item?.id === activeId && item?.kind === 'instance-setup'
        );
        if (index === -1) {
          return prev;
        }

        const target = prev[index];
        const existingActivity = Array.isArray(target.activityLog) ? target.activityLog : [];
        const nextActivity = [normalizedMessage, ...existingActivity]
          .filter((entry, idx, list) => list.indexOf(entry) === idx)
          .slice(0, 6);

        const next = [...prev];
        next[index] = {
          ...target,
          currentItem: normalizedMessage,
          activityLog: nextActivity
        };

        if (lower.includes('installing fabric') || lower.includes('installing forge') || lower.includes('installing neoforge')) {
          next[index].status = normalizedMessage;
          next[index].stageLabel = normalizedMessage;
        }

        if (lower.includes('successfully imported prism instance')) {
          const boosted = Math.max(clampProgress(next[index].progress ?? 0), 99);
          next[index].progress = boosted;
          next[index].status = 'Import completed, finalizing...';
          next[index].stageLabel = 'Import completed, finalizing...';
        }

        emit('sync-download-queue', next).catch(console.error);
        return next;
      });
    });

    // Listen for download progress events
    const unlistenProgress = listen('download-progress', (event) => {
      const payload = event.payload;
      if (!payload) {
        console.warn('Received empty payload for download-progress');
        return;
      }

      // Check for both percentage and progress (Tauri 2 event payloads vary)
      const stage = payload.stage || 'Launching...';
      const percentage = typeof payload.percentage === 'number' ? payload.percentage :
        (typeof payload.progress === 'number' ? payload.progress : 0);
      const clampedProgress = clampProgress(percentage);
      const { stageLabel, currentItem } = splitDownloadStage(stage);

      // Update logs for visible history
      setLogs(prev => [...prev.slice(-199), {
        id: Date.now() + Math.random(),
        level: 'info',
        message: `[Launch] ${stage} (${clampedProgress.toFixed(1)}%)`,
        timestamp: new Date().toISOString()
      }]);

      setLoadingStatus(stage);
      setLoadingProgress(clampedProgress);

      const total_bytes = payload.total_bytes;
      const downloaded_bytes = payload.downloaded_bytes;
      let speedBps = 0;
      if (typeof total_bytes === 'number' && typeof downloaded_bytes === 'number') {
        setLoadingBytes({ current: downloaded_bytes, total: total_bytes });
        const now = performance.now();
        const stats = transferStatsRef.current;
        if (stats.lastBytes !== null && downloaded_bytes >= stats.lastBytes && now > stats.lastTs) {
          const elapsedSeconds = (now - stats.lastTs) / 1000;
          const deltaBytes = downloaded_bytes - stats.lastBytes;
          if (elapsedSeconds > 0.12 && deltaBytes >= 0) {
            const instantaneous = deltaBytes / elapsedSeconds;
            stats.speedBps = stats.speedBps > 0
              ? ((stats.speedBps * 0.7) + (instantaneous * 0.3))
              : instantaneous;
          }
        }
        stats.lastBytes = downloaded_bytes;
        stats.lastTs = now;
        if (Number.isFinite(stats.speedBps) && stats.speedBps > 0) {
          speedBps = stats.speedBps;
        }
      } else {
        setLoadingBytes({ current: 0, total: 0 });
        transferStatsRef.current = { lastBytes: null, lastTs: 0, speedBps: 0 };
      }

      const current = payload.current;
      const total = payload.total;
      if (typeof current === 'number' && typeof total === 'number' && total > 0) {
        setLoadingCount({ current, total });
      } else {
        setLoadingCount({ current: 0, total: 0 });
      }

      setLoadingTelemetry({
        stageLabel: stageLabel || stage,
        currentItem,
        speedBps
      });

      const activeId = activeQueueDownloadIdRef.current;
      if (activeId) {
        setDownloadQueue(prev => {
          const index = prev.findIndex(item => item.id === activeId);
          if (index === -1) {
            activeQueueDownloadIdRef.current = null;
            return prev;
          }
          const target = prev[index];
          if (!target.trackBackendProgress) {
            return prev;
          }
          const next = [...prev];
          next[index] = {
            ...target,
            status: stageLabel || stage,
            stage,
            stageLabel: stageLabel || stage,
            currentItem,
            progress: clampedProgress,
            downloadedBytes: (typeof downloaded_bytes === 'number') ? downloaded_bytes : null,
            totalBytes: (typeof total_bytes === 'number') ? total_bytes : null,
            currentCount: (typeof current === 'number') ? current : null,
            totalCount: (typeof total === 'number') ? total : null,
            speedBps
          };
          return next;
        });
      }
    });

    const unlistenLaunchProgress = listen('launch-progress', (event) => {
      const payload = event.payload;
      if (!payload || !payload.instance_id) {
        return;
      }

      const instanceId = payload.instance_id;
      const stage = payload.stage || 'Launching...';
      const percentage = typeof payload.percentage === 'number' ? payload.percentage :
        (typeof payload.progress === 'number' ? payload.progress : 0);
      const clampedProgress = clampProgress(percentage);
      const { stageLabel, currentItem } = splitDownloadStage(stage);

      const total_bytes = payload.total_bytes;
      const downloaded_bytes = payload.downloaded_bytes;

      let speedBps = 0;
      let bytes = { current: 0, total: 0 };
      if (typeof total_bytes === 'number' && typeof downloaded_bytes === 'number') {
        bytes = { current: downloaded_bytes, total: total_bytes };
        const now = performance.now();
        const statsMap = instanceTransferStatsRef.current;
        const stats = statsMap[instanceId] || { lastBytes: null, lastTs: 0, speedBps: 0 };
        if (stats.lastBytes !== null && downloaded_bytes >= stats.lastBytes && now > stats.lastTs) {
          const elapsedSeconds = (now - stats.lastTs) / 1000;
          const deltaBytes = downloaded_bytes - stats.lastBytes;
          if (elapsedSeconds > 0.12 && deltaBytes >= 0) {
            const instantaneous = deltaBytes / elapsedSeconds;
            stats.speedBps = stats.speedBps > 0
              ? ((stats.speedBps * 0.7) + (instantaneous * 0.3))
              : instantaneous;
          }
        }
        stats.lastBytes = downloaded_bytes;
        stats.lastTs = now;
        statsMap[instanceId] = stats;
        if (Number.isFinite(stats.speedBps) && stats.speedBps > 0) {
          speedBps = stats.speedBps;
        }
      } else {
        const statsMap = instanceTransferStatsRef.current;
        delete statsMap[instanceId];
      }

      const current = payload.current;
      const total = payload.total;
      const count = (typeof current === 'number' && typeof total === 'number' && total > 0)
        ? { current, total }
        : { current: 0, total: 0 };

      setLaunchProgressByInstance((prev) => ({
        ...prev,
        [instanceId]: {
          status: stage,
          progress: clampedProgress,
          bytes,
          count,
          telemetry: {
            stageLabel: stageLabel || stage,
            currentItem,
            speedBps
          }
        }
      }));
    });

    // Listen for instance refresh events from backend
    const unlistenRefresh = listen('refresh-instances', () => {
      loadInstances();
      loadRunningInstances();
    });

    // Listen for cross-window download sync
    const unlistenQueueSync = listen('sync-download-queue', (event) => {
      const incomingQueue = Array.isArray(event.payload) ? event.payload : [];
      setDownloadQueue(incomingQueue);
      const activeItem = incomingQueue.find(item => item?.trackBackendProgress);
      activeQueueDownloadIdRef.current = activeItem ? activeItem.id : null;
    });

    const unlistenHistorySync = listen('sync-download-history', (event) => {
      setDownloadHistory(event.payload);
    });

    // Listen for exit confirmation
    const unlistenExit = listen('show-exit-confirm', () => {
      setConfirmModal({
        title: 'Exit Palethea?',
        message: 'A game instance is still running. Closing the launcher will also stop the game. Are you sure you want to exit?',
        confirmText: 'Exit Everything',
        cancelText: 'Keep Playing',
        extraConfirmText: 'Minimize to Tray',
        variant: 'danger',
        onConfirm: async () => {
          await invoke('exit_app_fully');
        },
        onExtraConfirm: async () => {
          try {
            await getCurrentWindow().hide();
          } catch (error) {
            devError('Failed to hide window to tray from exit modal:', error);
          }
        },
        onCancel: () => setConfirmModal(null)
      });
    });

    const launchFromExternalSource = async (instanceId, source = 'unknown') => {
      if (!instanceId) return;
      try {
        invoke('log_event', {
          level: 'info',
          message: `[ShortcutDebug] External launch request source=${source} instanceId=${instanceId}`
        }).catch(() => {});
        setActiveTab('instances');
        const launchHandler = handleLaunchInstanceRef.current;
        if (launchHandler) {
          await launchHandler(instanceId);
        } else {
          const result = await invoke('launch_instance', { instanceId, serverAddress: null });
          showNotification(result, 'success');
          loadRunningInstances();
        }
      } catch (error) {
        showNotification(`Failed to launch: ${error}`, 'error');
      }
    };

    // Tray quick-launch event from backend menu
    const unlistenTrayLaunch = listen('tray-launch-instance', async (event) => {
      const instanceId = typeof event.payload === 'string' ? event.payload : null;
      await launchFromExternalSource(instanceId, 'tray');
    });

    const unlistenTrayOpenSettings = listen('tray-open-settings', () => {
      setActiveTab('settings');
    });

    // Desktop shortcut launch event from backend
    const unlistenShortcutLaunch = listen('shortcut-launch-instance', async (event) => {
      const instanceId = typeof event.payload === 'string' ? event.payload : null;
      await launchFromExternalSource(instanceId, 'shortcut-event');
    });

    // Consume startup launch request (when app was opened directly via shortcut)
    invoke('take_pending_shortcut_launch')
      .then(async (instanceId) => {
        if (typeof instanceId === 'string' && instanceId) {
          await launchFromExternalSource(instanceId, 'startup-pending');
        }
      })
      .catch((error) => {
        console.warn('Failed to read pending shortcut launch:', error);
      });

    return () => {
      clearInterval(runningPoll);
      unlistenLog.then(fn => fn());
      unlistenProgress.then(fn => fn());
      unlistenLaunchProgress.then(fn => fn());
      unlistenRefresh.then(fn => fn());
      unlistenQueueSync.then(fn => fn());
      unlistenHistorySync.then(fn => fn());
      unlistenExit.then(fn => fn());
      unlistenTrayLaunch.then(fn => fn());
      unlistenTrayOpenSettings.then(fn => fn());
      unlistenShortcutLaunch.then(fn => fn());
      document.removeEventListener('contextmenu', handleContextMenu);
    };
  }, [loadInstances, loadRunningInstances, showNotification]);

  useEffect(() => {
    if (!isLoading && !isCreateTaskRunning) {
      setLoadingTelemetry(EMPTY_DOWNLOAD_TELEMETRY);
      transferStatsRef.current = { lastBytes: null, lastTs: 0, speedBps: 0 };
    }
  }, [isLoading, isCreateTaskRunning]);

  // Navigation Guard: Redirect from specialized pages if state changes (eg. logout)
  useEffect(() => {
    if (activeTab === 'skins' && !activeAccount?.isLoggedIn) {
      setActiveTab('instances');
    }
  }, [activeAccount, activeTab]);

  const [hasCheckedWelcome, setHasCheckedWelcome] = useState(false);

  useEffect(() => {
    if (!hasCheckedWelcome && launcherSettings && launcherSettings.show_welcome !== undefined) {
      // Small delay to prevent layout flash while other things load
      const timer = setTimeout(() => {
        setShowWelcome(launcherSettings.show_welcome);
        setHasCheckedWelcome(true);
      }, 100);
      return () => clearTimeout(timer);
    }
  }, [launcherSettings, hasCheckedWelcome]);

  // Close context menu when clicking elsewhere
  useEffect(() => {
    const handleClick = () => setContextMenu(null);
    document.addEventListener('click', handleClick);
    return () => document.removeEventListener('click', handleClick);
  }, []);

  const handleInstanceContextMenu = useCallback((e, instance) => {
    e.preventDefault();
    setContextMenu({
      x: e.clientX,
      y: e.clientY,
      instance,
    });
  }, []);

  const handleCloneInstance = useCallback(async (instance) => {
    const newName = `${instance.name} (Copy)`;
    setIsLoading(true);
    setLoadingStatus('Cloning instance...');
    setLoadingTelemetry(EMPTY_DOWNLOAD_TELEMETRY);
    transferStatsRef.current = { lastBytes: null, lastTs: 0, speedBps: 0 };
    try {
      await invoke('clone_instance', { instanceId: instance.id, newName });
      await loadInstances();
      showNotification(`Cloned "${instance.name}" successfully!`, 'success');
    } catch (error) {
      showNotification(`Failed to clone instance: ${error}`, 'error');
    } finally {
      setIsLoading(false);
      setLoadingStatus('');
      setLoadingProgress(0);
      setLoadingCount({ current: 0, total: 0 });
      setLoadingBytes({ current: 0, total: 0 });
      setLoadingTelemetry(EMPTY_DOWNLOAD_TELEMETRY);
    }
  }, [loadInstances, showNotification]);

  const handleCreateInstance = useCallback(async (name, versionId, modLoader = 'vanilla', modLoaderVersion = null, javaVersion = null) => {
    if (isCreateTaskRunning) {
      setActiveTab('instances');
      showNotification('An instance setup task is already running.', 'info');
      return;
    }

    const taskLabel = (
      modLoader === 'import' ? `Importing ${name || 'Prism instance'}` :
        modLoader === 'share-code' ? `Creating ${name || 'shared instance'}` :
          modLoader === 'modpack' ? `Installing ${modLoaderVersion?.modpackName || name || 'modpack'}` :
            `Creating ${name || 'instance'}`
    );
    const taskIcon = (modLoader === 'modpack' && modLoaderVersion?.modpackIcon)
      ? modLoaderVersion.modpackIcon
      : DEFAULT_INSTANCE_ICON;
    const createTaskId = `instance-setup-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    let setupInstanceId = null;

    const setTaskInstanceId = (instanceId) => {
      if (!instanceId) return;
      setupInstanceId = instanceId;
      handleUpdateDownloadStatus(createTaskId, {
        instanceId,
        kind: 'instance-setup'
      });
    };

    const setTaskStatus = (status, progress = null, extra = {}) => {
      if (typeof status === 'string') {
        setLoadingStatus(status);
      }
      const update = {
        status,
        stageLabel: (typeof status === 'string' ? splitDownloadStage(status).stageLabel : undefined) || status,
        ...extra
      };
      if (setupInstanceId) {
        update.instanceId = setupInstanceId;
      }
      if (typeof progress === 'number') {
        const normalized = clampProgress(progress);
        setLoadingProgress(normalized);
        update.progress = normalized;
      }
      handleUpdateDownloadStatus(createTaskId, update);
    };

    setIsCreateTaskRunning(true);
    setLoadingProgress(0);
    setLoadingCount({ current: 0, total: 0 });
    setLoadingBytes({ current: 0, total: 0 });
    setLoadingTelemetry(EMPTY_DOWNLOAD_TELEMETRY);
    transferStatsRef.current = { lastBytes: null, lastTs: 0, speedBps: 0 };

    handleQueueDownload({
      id: createTaskId,
      name: taskLabel,
      icon: taskIcon,
      status: 'Queued',
      progress: 0,
      kind: 'instance-setup',
      trackBackendProgress: true
    });
    activeQueueDownloadIdRef.current = createTaskId;
    setTaskStatus('Preparing instance setup...', 0, { trackBackendProgress: true });

    // Immediately free the user from the create page. Progress continues in queue + instance list.
    setActiveTab('instances');
    showNotification(`${taskLabel} started in background.`, 'info');

    try {
      // Helper to set Java version for the new instance
      const setupJava = async (instanceId, version) => {
        if (!version) return;
        try {
          setTaskStatus(`Preparing Java ${version}...`);
          const javaPath = await invoke('download_java_global', { version: parseInt(version, 10) });
          const instance = await invoke('get_instance_details', { instanceId });
          instance.java_path = javaPath;
          await invoke('update_instance', { instance });
        } catch (e) {
          console.error('Failed to setup Java for instance:', e);
        }
      };

      let successMessage = `Created instance "${name}"!`;

      // ----------
      // Import from source handler
      // Description: Imports from Palethea .zip exports or Prism instance folders
      // ----------
      if (modLoader === 'import') {
        const { sourcePath } = modLoaderVersion;
        setTaskStatus('Importing instance...', 20);

        const importedInstance = await invoke('import_instance_source', {
          sourcePath,
          customName: name || null
        });
        setTaskInstanceId(importedInstance.id);

        await setupJava(importedInstance.id, javaVersion);

        setTaskStatus(`Downloading Minecraft ${importedInstance.version_id}...`, 60);
        await invoke('download_version', { versionId: importedInstance.version_id });
        successMessage = `Imported instance "${importedInstance.name}"!`;
      } else if (modLoader === 'share-code') {
        // ----------
        // Share Code Handler
        // Description: Extracts metadata from a shared code and rebuilds the instance by downloading all assets
        // ----------
        const { shareData } = modLoaderVersion;
        const {
          name: originalName,
          version: mcVersion,
          loader,
          loader_version,
          mods = [],
          resourcepacks = [],
          shaders = []
        } = shareData;

        const isCurseForgeProjectId = (projectId) => /^\d+$/.test(String(projectId || '').trim());

        setTaskStatus(`Preparing instance "${name || originalName}"...`, 5);

        // 0. Pre-fetch all project metadata for better speed and UI fidelity
        setTaskStatus('Fetching metadata...');
        const modrinthProjectIds = [
          ...mods.map((m) => m.project_id || m.projectId),
          ...resourcepacks.map((p) => p.project_id || p.projectId),
          ...shaders.map((s) => s.project_id || s.projectId)
        ].filter((projectId) => projectId && !isCurseForgeProjectId(projectId));

        const uniqueIds = [...new Set(modrinthProjectIds)];
        const projectMap = {};

        try {
          if (uniqueIds.length > 0) {
            const projects = await invoke('get_modrinth_projects', { projectIds: uniqueIds });
            projects.forEach((p) => {
              const id = p.project_id || p.id;
              if (id) projectMap[id] = p;
              if (p.slug) projectMap[p.slug] = p;
            });
          }
        } catch (e) {
          console.warn('Failed to bulk fetch project metadata:', e);
        }

        // 1. Create the instance
        const newInstance = await invoke('create_instance', {
          name: name || originalName,
          versionId: mcVersion
        });
        setTaskInstanceId(newInstance.id);

        await setupJava(newInstance.id, javaVersion);

        // 2. Download Minecraft
        setTaskStatus(`Downloading Minecraft ${mcVersion}...`, 10);
        await invoke('download_version', { versionId: mcVersion });

        // 3. Install Mod Loader
        if (loader !== 'vanilla') {
          setTaskStatus(`Installing ${loader}...`, 20);
          if (loader === 'fabric') {
            await invoke('install_fabric', { instanceId: newInstance.id, loaderVersion: loader_version });
          } else if (loader === 'forge') {
            await invoke('install_forge', { instanceId: newInstance.id, loaderVersion: loader_version });
          } else if (loader === 'neoforge') {
            await invoke('install_neoforge', { instanceId: newInstance.id, loaderVersion: loader_version });
          }
        }

        // 4. Download Everything
        const totalItems = mods.length + resourcepacks.length + shaders.length;
        let completedItems = 0;

        // Helper to process items with parallel concurrency
        const processItems = async (items, type) => {
          const CONCURRENCY = 10;
          for (let i = 0; i < items.length; i += CONCURRENCY) {
            const chunk = items.slice(i, i + CONCURRENCY);

            await Promise.all(chunk.map(async (item) => {
              const mid = String(item.project_id || item.projectId || '').trim();
              const vid = String(item.version_id || item.versionId || '').trim();
              if (!mid) {
                completedItems += 1;
                return;
              }

              try {
                if (isCurseForgeProjectId(mid)) {
                  let project = null;
                  try {
                    project = await invoke('get_curseforge_modpack', { projectId: mid });
                  } catch (e) {
                    console.warn(`Failed to fetch CurseForge project metadata for ${mid}:`, e);
                  }

                  const cfVersions = await invoke('get_curseforge_modpack_versions', { projectId: mid });
                  if (!Array.isArray(cfVersions) || cfVersions.length === 0) {
                    return;
                  }

                  let selectedVersion = vid
                    ? cfVersions.find((entry) => String(entry.id) === vid)
                    : null;

                  if (!selectedVersion) {
                    const sorted = [...cfVersions].sort((a, b) => new Date(b.date_published) - new Date(a.date_published));
                    selectedVersion = sorted[0];
                  }

                  if (!selectedVersion) {
                    return;
                  }

                  const file = selectedVersion.files?.find((entry) => entry.primary) || selectedVersion.files?.[0];
                  if (!file) {
                    return;
                  }

                  await invoke('install_curseforge_file', {
                    instanceId: newInstance.id,
                    projectId: mid,
                    fileId: String(selectedVersion.id),
                    fileType: type,
                    filename: file.filename || `${mid}-${selectedVersion.id}.${type === 'mod' ? 'jar' : 'zip'}`,
                    fileUrl: file.url || null,
                    worldName: null,
                    iconUrl: project?.icon_url || item.icon_url || item.iconUrl || null,
                    name: project?.title || item.name || null,
                    author: project?.author || item.author || null,
                    versionName: selectedVersion.version_number || selectedVersion.name || item.version_name || item.versionName || null,
                    categories: project?.categories || project?.display_categories || item.categories || null
                  });
                } else {
                  let info;
                  if (vid) {
                    info = await invoke('get_modrinth_version', { versionId: vid });
                  } else {
                    const versions = await invoke('get_modrinth_versions', {
                      projectId: mid,
                      gameVersion: mcVersion,
                      loader: type === 'mod' ? (loader === 'vanilla' ? null : loader) : null
                    });
                    info = versions.length > 0 ? versions[0] : null;
                  }

                  if (info) {
                    let project = projectMap[mid];

                    if (!project) {
                      try {
                        project = await invoke('get_modrinth_project', { projectId: mid });
                      } catch (e) {
                        console.warn(`Failed to fetch project metadata for ${mid}:`, e);
                      }
                    }

                    const file = info.files.find((f) => f.primary) || info.files[0];

                    await invoke('install_modrinth_file', {
                      instanceId: newInstance.id,
                      fileUrl: file.url,
                      filename: file.filename,
                      fileType: type,
                      projectId: mid,
                      versionId: info.id,
                      name: project?.title || item.name || null,
                      author: project?.author || item.author || null,
                      iconUrl: project?.icon_url || item.icon_url || item.iconUrl || null,
                      versionName: info.name || item.version_name || item.versionName,
                      worldName: null,
                      categories: project?.categories || project?.display_categories || item.categories || null
                    });
                  }
                }
              } catch (e) {
                console.warn(`Failed to install ${type} ${mid}:`, e);
              }

              completedItems += 1;
              const rollingProgress = totalItems > 0 ? 20 + ((completedItems / totalItems) * 75) : 95;
              setTaskStatus(`Installing ${type} ${completedItems}/${totalItems}...`, rollingProgress);
            }));
          }
        };

        await processItems(mods, 'mod');
        await processItems(resourcepacks, 'resourcepack');
        await processItems(shaders, 'shader');

        successMessage = `Share code applied! Instance "${name || originalName}" created.`;
      } else if (modLoader === 'modpack') {
        const {
          provider = 'modrinth',
          modpackId,
          versionId: modpackVersionId,
          modpackName,
          modpackIcon,
          modpackAuthor = null,
          modpackSlug = null,
          modpackWebsiteUrl = null
        } = modLoaderVersion || {};

        setTaskStatus(`Creating instance for ${modpackName}...`, 5);
        // We use a placeholder version initially, modpack installer will update it
        const newInstance = await invoke('create_instance', { name, versionId: 'pending' });
        const normalizedProvider = provider === 'curseforge' ? 'CurseForge' : 'Modrinth';
        const fallbackModrinthUrl = modpackId
          ? `https://modrinth.com/modpack/${modpackSlug || modpackId}`
          : null;
        const resolvedModpackUrl = modpackWebsiteUrl || (provider === 'modrinth' ? fallbackModrinthUrl : null);

        const attributedInstance = await invoke('update_instance', {
          instance: {
            ...newInstance,
            modpack_provider: normalizedProvider,
            modpack_project_id: modpackId ? String(modpackId) : null,
            modpack_version_id: modpackVersionId ? String(modpackVersionId) : null,
            modpack_title: modpackName || null,
            modpack_author: modpackAuthor || null,
            modpack_url: resolvedModpackUrl || null
          }
        });

        setTaskInstanceId(attributedInstance.id);

        // Set the modpack icon if available
        if (modpackIcon) {
          try {
            await invoke('set_instance_logo_from_url', {
              instanceId: attributedInstance.id,
              logoUrl: modpackIcon
            });
          } catch (iconError) {
            console.warn('Failed to set modpack icon:', iconError);
          }
        }

        await setupJava(attributedInstance.id, javaVersion);

        setTaskStatus(`Installing modpack ${modpackName}...`, 25);
        if (provider === 'curseforge') {
          await invoke('install_curseforge_modpack', {
            instanceId: attributedInstance.id,
            projectId: modpackId,
            fileId: modpackVersionId
          });
        } else {
          await invoke('install_modpack', {
            instanceId: attributedInstance.id,
            versionId: modpackVersionId
          });
        }

        // Now that modpack is installed, we have the real MC version.
        // We need to download it.
        const updatedInstance = await invoke('get_instance_details', { instanceId: attributedInstance.id });
        setTaskStatus(`Downloading Minecraft ${updatedInstance.version_id}...`, 65);
        await invoke('download_version', { versionId: updatedInstance.version_id });
        successMessage = `Created instance "${name}"!`;
      } else {
        // Create instance first (so it exists even if download fails)
        setTaskStatus('Creating instance...', 5);
        const newInstance = await invoke('create_instance', { name, versionId });
        setTaskInstanceId(newInstance.id);

        await setupJava(newInstance.id, javaVersion);

        setTaskStatus(`Downloading Minecraft ${versionId}...`, 45);
        await invoke('download_version', { versionId });

        // Install mod loader if not vanilla
        if (modLoader !== 'vanilla') {
          setTaskStatus(`Installing ${modLoader}...`, 80);
          if (modLoader === 'fabric') {
            try {
              const loaderVersions = modLoaderVersion ? [modLoaderVersion] : await invoke('get_loader_versions', {
                loader: 'fabric',
                gameVersion: versionId
              });
              const loaderVersion = modLoaderVersion || (loaderVersions && loaderVersions[0]);

              if (loaderVersion) {
                await invoke('install_fabric', {
                  instanceId: newInstance.id,
                  loaderVersion
                });
              } else {
                showNotification(`No Fabric version found for ${versionId}`, 'error');
              }
            } catch (fabricError) {
              console.error('Failed to install Fabric:', fabricError);
              showNotification(`Instance created but Fabric installation failed: ${fabricError}`, 'error');
            }
          } else if (modLoader === 'forge') {
            try {
              const loaderVersions = modLoaderVersion ? [modLoaderVersion] : await invoke('get_loader_versions', {
                loader: 'forge',
                gameVersion: versionId
              });
              const loaderVersion = modLoaderVersion || (loaderVersions && loaderVersions[0]);

              if (loaderVersion) {
                await invoke('install_forge', {
                  instanceId: newInstance.id,
                  loaderVersion
                });
              } else {
                showNotification(`No Forge version found for ${versionId}`, 'error');
              }
            } catch (forgeError) {
              console.error('Failed to install Forge:', forgeError);
              showNotification(`Instance created but Forge installation failed: ${forgeError}`, 'error');
            }
          } else if (modLoader === 'neoforge') {
            try {
              const loaderVersions = modLoaderVersion ? [modLoaderVersion] : await invoke('get_loader_versions', {
                loader: 'neoforge',
                gameVersion: versionId
              });
              const loaderVersion = modLoaderVersion || (loaderVersions && loaderVersions[0]);

              if (loaderVersion) {
                await invoke('install_neoforge', {
                  instanceId: newInstance.id,
                  loaderVersion
                });
              } else {
                showNotification(`No NeoForge version found for ${versionId}`, 'error');
              }
            } catch (neoforgeError) {
              console.error('Failed to install NeoForge:', neoforgeError);
              showNotification(`Instance created but NeoForge installation failed: ${neoforgeError}`, 'error');
            }
          }
        }

        successMessage = `Created instance "${name}"!`;
      }

      setTaskStatus('Completed', 100, { trackBackendProgress: false });
      await loadInstances();
      showNotification(successMessage, 'success');
      setTimeout(() => handleDequeueDownload(createTaskId), 900);
    } catch (error) {
      const errorText = String(error);
      setTaskStatus(`Failed: ${errorText}`, 100, { trackBackendProgress: false });
      showNotification(`Failed to create instance: ${errorText}`, 'error');
      setTimeout(() => handleDequeueDownload(createTaskId, false), 2200);
    } finally {
      if (activeQueueDownloadIdRef.current === createTaskId) {
        activeQueueDownloadIdRef.current = null;
      }
      setIsCreateTaskRunning(false);
      setLoadingStatus('');
      setLoadingProgress(0);
      setLoadingCount({ current: 0, total: 0 });
      setLoadingBytes({ current: 0, total: 0 });
      setLoadingTelemetry(EMPTY_DOWNLOAD_TELEMETRY);
      transferStatsRef.current = { lastBytes: null, lastTs: 0, speedBps: 0 };
    }
  }, [
    handleDequeueDownload,
    handleQueueDownload,
    handleUpdateDownloadStatus,
    isCreateTaskRunning,
    loadInstances,
    showNotification
  ]);

  const performDeleteInstance = useCallback(async (instanceId) => {
    if (deletingInstanceIdsRef.current.has(instanceId)) {
      return;
    }

    deletingInstanceIdsRef.current.add(instanceId);
    setDeletingInstanceIds(prev => (prev.includes(instanceId) ? prev : [...prev, instanceId]));

    const runDelete = async () => {
      try {
        await invoke('delete_instance', { instanceId });
        await loadInstances();
        showNotification('Instance deleted', 'success');
      } catch (error) {
        showNotification(`Failed to delete instance: ${error}`, 'error');
      } finally {
        deletingInstanceIdsRef.current.delete(instanceId);
        setDeletingInstanceIds(prev => prev.filter(id => id !== instanceId));
      }
    };

    const queued = deleteQueueRef.current.then(runDelete, runDelete);
    deleteQueueRef.current = queued.catch(() => {});
    return queued;
  }, [loadInstances, showNotification]);

  const handleDeleteInstance = useCallback((instanceId) => {
    const instance = instances.find(i => i.id === instanceId);
    setConfirmModal({
      title: 'Delete Instance',
      message: `Are you sure you want to delete "${instance?.name || 'this instance'}"? This will remove all mods, worlds, and data associated with it. This action cannot be undone.`,
      confirmText: 'Delete',
      cancelText: 'Cancel',
      variant: 'danger',
      onConfirm: async () => {
        setConfirmModal(null);
        await performDeleteInstance(instanceId);
      },
      onCancel: () => setConfirmModal(null)
    });
  }, [instances, performDeleteInstance]);

  const persistLaunchUpdateCheckPreference = useCallback(async (instanceId, enabled) => {
    const existing = instances.find((inst) => inst.id === instanceId);
    if (!existing) return;

    const updated = { ...existing, check_mod_updates_on_launch: enabled };
    await invoke('update_instance', { instance: updated });
    setInstances((prev) =>
      prev.map((inst) => (inst.id === instanceId ? { ...inst, check_mod_updates_on_launch: enabled } : inst))
    );
  }, [instances]);

  const findLoaderUpdateForLaunch = useCallback(async (instance) => {
    if (!instance || !instance.version_id) return null;

    const loaderKey = String(instance.mod_loader || '').toLowerCase();
    if (!SUPPORTED_LOADER_KEYS.has(loaderKey)) return null;

    const currentVersion = String(instance.mod_loader_version || '').trim();
    if (!currentVersion) return null;

    let loaderVersions = [];
    try {
      const rows = await invoke('get_loader_versions', {
        loader: loaderKey,
        gameVersion: instance.version_id
      });
      loaderVersions = Array.isArray(rows) ? rows : [];
    } catch (error) {
      console.error(`Failed to load ${loaderKey} versions:`, error);
      return null;
    }

    if (loaderVersions.length === 0) return null;

    const preferred = pickPreferredLoaderVersion(loaderKey, loaderVersions);
    const latestVersion = preferred?.version ? String(preferred.version).trim() : '';
    if (!latestVersion || latestVersion === currentVersion) return null;

    if (compareLooseVersions(latestVersion, currentVersion) <= 0) return null;

    return {
      loaderKey,
      loaderLabel: instance.mod_loader || loaderKey,
      currentVersion,
      latestVersion
    };
  }, []);

  const applyPendingModUpdatesForLaunch = useCallback(async (instanceId, updates) => {
    if (!Array.isArray(updates) || updates.length === 0) {
      return { updatedCount: 0, failedCount: 0 };
    }

    let updatedCount = 0;
    let failedCount = 0;
    const total = updates.length;

    for (let index = 0; index < updates.length; index++) {
      const update = updates[index];
      const provider = String(update?.provider || (update?.project_id && /^\d+$/.test(update.project_id) ? 'CurseForge' : 'Modrinth')).toLowerCase();
      const latestVersion = provider === 'curseforge'
        ? update.latest_curseforge_version
        : update.latest_version;
      const displayName = update.installed_name || update.project_id || `Mod ${index + 1}`;
      const file = latestVersion?.files?.find((f) => f.primary) || latestVersion?.files?.[0];

      setLaunchProgressByInstance((prev) => ({
        ...prev,
        [instanceId]: {
          status: `Updating mods ${index + 1}/${total}...`,
          progress: clampProgress(6 + ((index / Math.max(total, 1)) * 18)),
          bytes: { current: 0, total: 0 },
          count: { current: index + 1, total },
          telemetry: {
            stageLabel: `Updating ${displayName}`,
            currentItem: displayName,
            speedBps: 0
          }
        }
      }));

      if (!file?.url || !file?.filename) {
        failedCount += 1;
        continue;
      }

      const downloadId = `launch-update:${instanceId}:${update.project_id || index}`;
      handleQueueDownload({
        id: downloadId,
        name: displayName,
        icon: update.installed_icon_url || null,
        status: 'Queued'
      });
      handleUpdateDownloadStatus(downloadId, 'Downloading update...');

      try {
        if (provider === 'curseforge') {
          await invoke('install_curseforge_file', {
            instanceId,
            projectId: update.project_id || '',
            fileId: latestVersion.id,
            fileType: 'mod',
            filename: file.filename,
            fileUrl: file.url || null,
            name: update.installed_name || null,
            author: update.installed_author || null,
            iconUrl: update.installed_icon_url || null,
            versionName: latestVersion.version_number || latestVersion.name || null,
            categories: update.installed_categories || null
          });
        } else {
          await invoke('install_modrinth_file', {
            instanceId,
            fileUrl: file.url,
            filename: file.filename,
            fileType: 'mod',
            projectId: update.project_id || null,
            versionId: latestVersion.id,
            name: update.installed_name || null,
            author: update.installed_author || null,
            iconUrl: update.installed_icon_url || null,
            versionName: latestVersion.version_number || latestVersion.name || null,
            categories: update.installed_categories || null
          });
        }

        if (update.installed_filename && update.installed_filename !== file.filename) {
          try {
            await invoke('delete_instance_mod', {
              instanceId,
              filename: update.installed_filename
            });
          } catch (deleteError) {
            console.warn(`Failed to delete old mod file for ${displayName}:`, deleteError);
          }
        }

        updatedCount += 1;
        handleUpdateDownloadStatus(downloadId, { status: 'Updated', progress: 100, trackBackendProgress: false });
        setTimeout(() => handleDequeueDownload(downloadId), 700);
      } catch (error) {
        failedCount += 1;
        console.error(`Failed to update mod ${displayName}:`, error);
        handleUpdateDownloadStatus(downloadId, { status: 'Failed', trackBackendProgress: false });
        setTimeout(() => handleDequeueDownload(downloadId, false), 1100);
      }
    }

    setLaunchProgressByInstance((prev) => ({
      ...prev,
      [instanceId]: {
        status: 'Preparing launch...',
        progress: 24,
        bytes: { current: 0, total: 0 },
        count: { current: 0, total: 0 },
        telemetry: {
          stageLabel: 'Preparing launch',
          currentItem: null,
          speedBps: 0
        }
      }
    }));

    return { updatedCount, failedCount };
  }, [handleQueueDownload, handleUpdateDownloadStatus, handleDequeueDownload]);

  const applyPendingLoaderUpdateForLaunch = useCallback(async (instanceId, loaderUpdate) => {
    if (!loaderUpdate?.loaderKey || !loaderUpdate.latestVersion) {
      return { updated: false, failed: false };
    }

    const loaderLabel = loaderUpdate.loaderLabel || loaderUpdate.loaderKey;
    const downloadId = `launch-loader-update:${instanceId}:${loaderUpdate.loaderKey}`;

    setLaunchProgressByInstance((prev) => ({
      ...prev,
      [instanceId]: {
        status: `Updating ${loaderLabel} loader...`,
        progress: 23,
        bytes: { current: 0, total: 0 },
        count: { current: 0, total: 0 },
        telemetry: {
          stageLabel: `Updating ${loaderLabel}`,
          currentItem: loaderUpdate.latestVersion,
          speedBps: 0
        }
      }
    }));

    handleQueueDownload({
      id: downloadId,
      name: `${loaderLabel} ${loaderUpdate.latestVersion}`,
      icon: null,
      status: 'Queued'
    });
    handleUpdateDownloadStatus(downloadId, 'Downloading loader...');

    try {
      if (loaderUpdate.loaderKey === 'fabric') {
        await invoke('install_fabric', { instanceId, loaderVersion: loaderUpdate.latestVersion });
      } else if (loaderUpdate.loaderKey === 'forge') {
        await invoke('install_forge', { instanceId, loaderVersion: loaderUpdate.latestVersion });
      } else if (loaderUpdate.loaderKey === 'neoforge') {
        await invoke('install_neoforge', { instanceId, loaderVersion: loaderUpdate.latestVersion });
      } else {
        throw new Error(`Unsupported loader: ${loaderUpdate.loaderKey}`);
      }

      handleUpdateDownloadStatus(downloadId, { status: 'Updated', progress: 100, trackBackendProgress: false });
      setTimeout(() => handleDequeueDownload(downloadId), 700);
      return { updated: true, failed: false };
    } catch (error) {
      console.error(`Failed to update ${loaderLabel} before launch:`, error);
      handleUpdateDownloadStatus(downloadId, { status: 'Failed', trackBackendProgress: false });
      setTimeout(() => handleDequeueDownload(downloadId, false), 1100);
      return { updated: false, failed: true };
    }
  }, [handleQueueDownload, handleUpdateDownloadStatus, handleDequeueDownload]);

  const handleLaunchInstance = useCallback(async (instanceId, launchOptions = {}) => {
    if (runningInstances[instanceId]) {
      showNotification("Instance is already running", "info");
      return;
    }
    if (instanceSetupByInstanceRef.current[instanceId]) {
      showNotification("Instance is still setting up files. Please wait for setup to finish.", "info");
      return;
    }
    if (launchingInstanceIdsRef.current.includes(instanceId)) {
      showNotification("Instance is already launching", "info");
      return;
    }
    if (stoppingInstanceIdsRef.current.includes(instanceId)) {
      showNotification("Instance is still stopping", "info");
      return;
    }

    setLaunchingInstanceIds((prev) => (prev.includes(instanceId) ? prev : [...prev, instanceId]));
    setLaunchProgressByInstance((prev) => ({
      ...prev,
      [instanceId]: {
        status: 'Starting launch sequence...',
        progress: 5,
        bytes: { current: 0, total: 0 },
        count: { current: 0, total: 0 },
        telemetry: EMPTY_DOWNLOAD_TELEMETRY
      }
    }));
    if (!activeLaunchingInstanceIdRef.current) {
      activeLaunchingInstanceIdRef.current = instanceId;
      setLaunchingInstanceId(instanceId);
      setLoadingStatus('Starting launch sequence...');
      setLoadingProgress(5);
      setLoadingCount({ current: 0, total: 0 });
      setLoadingBytes({ current: 0, total: 0 });
      setLoadingTelemetry(EMPTY_DOWNLOAD_TELEMETRY);
      transferStatsRef.current = { lastBytes: null, lastTs: 0, speedBps: 0 };
    }

    // Give React a frame to render the overlay before the backend starts heavy preparation
    await new Promise(resolve => setTimeout(resolve, 50));

    try {
      const targetInstance = instances.find((inst) => inst.id === instanceId)
        || await invoke('get_instance_details', { instanceId });
      const isManagedModpackInstance = Boolean(
        targetInstance?.modpack_provider || targetInstance?.modpack_project_id
      );
      const shouldCheckForLaunchUpdates =
        targetInstance?.check_mod_updates_on_launch !== false && !isManagedModpackInstance;

      if (shouldCheckForLaunchUpdates) {
        setLaunchProgressByInstance((prev) => ({
          ...prev,
          [instanceId]: {
            status: 'Checking updates...',
            progress: 7,
            bytes: { current: 0, total: 0 },
            count: { current: 0, total: 0 },
            telemetry: {
              stageLabel: 'Checking updates',
              currentItem: null,
              speedBps: 0
            }
          }
        }));

        let availableModUpdates = [];
        let availableLoaderUpdate = null;
        try {
          const updateRows = await invoke('get_instance_mod_updates', { instanceId });
          availableModUpdates = Array.isArray(updateRows) ? updateRows : [];
        } catch (scanError) {
          console.error('Failed to scan mod updates before launch:', scanError);
          showNotification('Could not check for mod updates before launch.', 'warning');
        }

        try {
          availableLoaderUpdate = await findLoaderUpdateForLaunch(targetInstance);
        } catch (loaderScanError) {
          console.error('Failed to scan loader updates before launch:', loaderScanError);
        }

        const totalLaunchUpdates = availableModUpdates.length + (availableLoaderUpdate ? 1 : 0);

        if (totalLaunchUpdates > 0) {
          const choice = await promptLaunchUpdateChoice(targetInstance, availableModUpdates, availableLoaderUpdate);

          if (choice?.disableFutureChecks) {
            try {
              await persistLaunchUpdateCheckPreference(instanceId, false);
            } catch (saveError) {
              console.error('Failed to save launch update-check preference:', saveError);
              showNotification('Could not save update-check preference.', 'warning');
            }
          }

          if (choice?.action === 'update') {
            const { updatedCount, failedCount } = await applyPendingModUpdatesForLaunch(instanceId, availableModUpdates);
            const loaderResult = await applyPendingLoaderUpdateForLaunch(instanceId, availableLoaderUpdate);
            if (loaderResult.updated && availableLoaderUpdate?.latestVersion) {
              setInstances((prev) =>
                prev.map((inst) => (inst.id === instanceId
                  ? { ...inst, mod_loader_version: availableLoaderUpdate.latestVersion }
                  : inst))
              );
            }
            if (updatedCount > 0 || loaderResult.updated) {
              const updateParts = [];
              if (updatedCount > 0) {
                updateParts.push(`${updatedCount} mod${updatedCount > 1 ? 's' : ''}`);
              }
              if (loaderResult.updated) {
                updateParts.push('1 loader');
              }
              showNotification(`Updated ${updateParts.join(' and ')} before launch.`, 'success');
            }
            if (failedCount > 0 || loaderResult.failed) {
              const failureParts = [];
              if (failedCount > 0) {
                failureParts.push(`${failedCount} mod update${failedCount > 1 ? 's' : ''}`);
              }
              if (loaderResult.failed) {
                failureParts.push('loader update');
              }
              showNotification(`${failureParts.join(' and ')} failed. Launching anyway.`, 'warning');
            }
          } else if (choice?.action === 'cancel') {
            showNotification('Launch canceled.', 'info');
            return;
          } else {
            showNotification(`Skipped ${totalLaunchUpdates} update${totalLaunchUpdates > 1 ? 's' : ''}.`, 'info');
            setLaunchProgressByInstance((prev) => ({
              ...prev,
              [instanceId]: {
                status: 'Preparing launch...',
                progress: 9,
                bytes: { current: 0, total: 0 },
                count: { current: 0, total: 0 },
                telemetry: {
                  stageLabel: 'Preparing launch',
                  currentItem: null,
                  speedBps: 0
                }
              }
            }));
          }
        }

        setLaunchProgressByInstance((prev) => ({
          ...prev,
          [instanceId]: {
            status: 'Preparing launch...',
            progress: 9,
            bytes: { current: 0, total: 0 },
            count: { current: 0, total: 0 },
            telemetry: {
              stageLabel: 'Preparing launch',
              currentItem: null,
              speedBps: 0
            }
          }
        }));
      }

      // Clear old logs first so the console doesn't show them
      try {
        await invoke('clear_instance_log', { instanceId });
      } catch (logError) {
        console.warn('Failed to clear log file:', logError);
      }

      const normalizedServerAddress = typeof launchOptions?.serverAddress === 'string' && launchOptions.serverAddress.trim()
        ? launchOptions.serverAddress.trim()
        : null;

      const result = await invoke('launch_instance', {
        instanceId,
        serverAddress: normalizedServerAddress,
      });
      showNotification(result, 'success');
      loadRunningInstances(); // Update running instances immediately

      // Keep the 100% state visible for a moment before closing overlay
      await new Promise(resolve => setTimeout(resolve, 800));
    } catch (error) {
      showNotification(`Failed to launch: ${error}`, 'error');
    } finally {
      setLaunchProgressByInstance((prev) => {
        if (!prev[instanceId]) return prev;
        const next = { ...prev };
        delete next[instanceId];
        return next;
      });
      delete instanceTransferStatsRef.current[instanceId];

      setLaunchingInstanceIds((prev) => {
        const next = prev.filter((id) => id !== instanceId);
        launchingInstanceIdsRef.current = next;

        if (next.length === 0) {
          activeLaunchingInstanceIdRef.current = null;
          setLaunchingInstanceId(null);
          setLoadingStatus('');
          setLoadingProgress(0);
          setLoadingCount({ current: 0, total: 0 });
          setLoadingBytes({ current: 0, total: 0 });
          setLoadingTelemetry(EMPTY_DOWNLOAD_TELEMETRY);
          transferStatsRef.current = { lastBytes: null, lastTs: 0, speedBps: 0 };
        } else if (activeLaunchingInstanceIdRef.current === instanceId) {
          // Keep remaining concurrent launches in generic queued mode.
          // Backend progress events are global, so re-targeting would show incorrect per-instance telemetry.
          activeLaunchingInstanceIdRef.current = null;
          setLaunchingInstanceId(null);
          setLoadingStatus('');
          setLoadingProgress(0);
          setLoadingCount({ current: 0, total: 0 });
          setLoadingBytes({ current: 0, total: 0 });
          setLoadingTelemetry(EMPTY_DOWNLOAD_TELEMETRY);
          transferStatsRef.current = { lastBytes: null, lastTs: 0, speedBps: 0 };
        }

        return next;
      });
    }
  }, [
    runningInstances,
    showNotification,
    loadRunningInstances,
    instances,
    promptLaunchUpdateChoice,
    persistLaunchUpdateCheckPreference,
    applyPendingModUpdatesForLaunch,
    applyPendingLoaderUpdateForLaunch,
    findLoaderUpdateForLaunch
  ]);

  handleLaunchInstanceRef.current = handleLaunchInstance;

  const handleStopInstance = useCallback(async (instanceId) => {
    if (stoppingInstanceIdsRef.current.includes(instanceId)) {
      showNotification("Instance is already stopping", "info");
      return;
    }
    if (forceStoppingInstanceIdsRef.current.includes(instanceId)) {
      showNotification("Force stop is already in progress", "info");
      return;
    }

    setStoppingInstanceIds((prev) => (prev.includes(instanceId) ? prev : [...prev, instanceId]));

    // Let React paint the stopping state before backend stop begins.
    await new Promise(resolve => setTimeout(resolve, 16));

    try {
      const result = await invoke('kill_game', { instanceId });
      showNotification(result, 'success');
      void loadRunningInstances();
      window.setTimeout(() => {
        void loadInstances();
      }, 100);
    } catch (error) {
      showNotification(`Failed to stop: ${error}`, 'error');
    } finally {
      setStoppingInstanceIds((prev) => {
        const next = prev.filter((id) => id !== instanceId);
        stoppingInstanceIdsRef.current = next;
        return next;
      });
    }
  }, [showNotification, loadRunningInstances, loadInstances]);

  const handleForceStopInstance = useCallback(async (instanceId) => {
    if (forceStoppingInstanceIdsRef.current.includes(instanceId)) {
      showNotification("Force stop is already in progress", "info");
      return;
    }

    setForceStoppingInstanceIds((prev) => (prev.includes(instanceId) ? prev : [...prev, instanceId]));

    try {
      const result = await invoke('force_kill_game', { instanceId });
      showNotification(result, 'success');
      void loadRunningInstances();
      window.setTimeout(() => {
        void loadInstances();
      }, 100);
    } catch (error) {
      showNotification(`Failed to force stop: ${error}`, 'error');
    } finally {
      setForceStoppingInstanceIds((prev) => {
        const next = prev.filter((id) => id !== instanceId);
        forceStoppingInstanceIdsRef.current = next;
        return next;
      });
    }
  }, [showNotification, loadRunningInstances, loadInstances]);

  const handleStopAllInstances = useCallback(() => {
    const runningIds = Object.keys(runningInstances);
    if (runningIds.length === 0) return;
    const idsToStop = runningIds.filter((id) => (
      !stoppingInstanceIdsRef.current.includes(id)
      && !forceStoppingInstanceIdsRef.current.includes(id)
    ));
    idsToStop.forEach((id) => {
      void handleStopInstance(id);
    });
  }, [runningInstances, handleStopInstance]);

  const handleSetUsername = useCallback(async (newUsername) => {
    try {
      await invoke('set_offline_user', { username: newUsername });
      const newAccount = { username: newUsername, isLoggedIn: false, uuid: null };
      setActiveAccount(newAccount);

      // Add to accounts list if not exists
      const savedAccounts = JSON.parse(localStorage.getItem('palethea_accounts') || '[]');
      if (!savedAccounts.find(a => a.username === newUsername)) {
        savedAccounts.push(newAccount);
        localStorage.setItem('palethea_accounts', JSON.stringify(savedAccounts));
        setAccounts(savedAccounts);
      }

      showNotification(`Username set to "${newUsername}"`, 'success');
    } catch (error) {
      showNotification(`Failed to set username: ${error}`, 'error');
    }
  }, [showNotification]);

  const handleLogin = useCallback(async (newUsername) => {
    // Reload accounts from backend (already saved there)
    const savedData = await invoke('get_saved_accounts');
    const uiAccounts = savedData.accounts.map(a => ({
      username: a.username,
      isLoggedIn: a.is_microsoft,
      uuid: a.uuid
    }));
    setAccounts(uiAccounts);

    const account = savedData.accounts.find(a => a.username === newUsername);
    if (account) {
      const newActiveAccount = {
        username: account.username,
        isLoggedIn: account.is_microsoft,
        uuid: account.uuid
      };
      setActiveAccount(newActiveAccount);

      // Load skin immediately after login
      loadSkinForAccount(account.is_microsoft, account.uuid);
    }

    showNotification(`Signed in as ${newUsername}`, 'success');
  }, [loadSkinForAccount, showNotification]);

  const handleLogout = useCallback(() => {
    setActiveAccount({ username: 'Player', isLoggedIn: false, uuid: null });
    setCurrentSkinUrl(null);
    if (activeTab === 'skins') {
      setActiveTab('instances');
    }
    showNotification('Signed out', 'success');
  }, [activeTab, showNotification]);

  const handleCloseWelcome = useCallback(async () => {
    if (welcomeDontShow && launcherSettings) {
      const updated = {
        ...launcherSettings,
        show_welcome: false
      };
      await invoke('save_settings', { newSettings: updated });
      setLauncherSettings(updated);
    }
    setShowWelcome(false);
  }, [welcomeDontShow, launcherSettings]);

  const handleOpenSupport = useCallback(async () => {
    try {
      await open('https://palethea.com');
    } catch (error) {
      console.error('Failed to open support link:', error);
    }
  }, []);

  const handleSwitchAccount = useCallback(async (account) => {
    try {
      await invoke('switch_account', { username: account.username });
      setActiveAccount(account);
      loadSkinForAccount(account.isLoggedIn, account.uuid);
      showNotification(`Switched to ${account.username}`, 'success');
    } catch (error) {
      showNotification(`Failed to switch account: ${error}`, 'error');
    }
  }, [loadSkinForAccount, showNotification]);

  const handleAddAccount = useCallback(() => {
    setShowLoginPrompt(true);
  }, []);

  const focusExistingPopoutEditor = useCallback(async (instanceId) => {
    const windowLabel = `editor-${instanceId}`;
    const win = await WebviewWindow.getByLabel(windowLabel);
    if (!win) return false;

    setOpenEditors(prev => (prev.includes(instanceId) ? prev : [...prev, instanceId]));
    await win.setFocus();
    return true;
  }, []);

  const handleRemoveAccount = useCallback(async (username) => {
    try {
      await invoke('remove_saved_account', { username });
      const updatedData = await invoke('get_saved_accounts');
      const updatedAccounts = (updatedData.accounts || []).map(a => ({
        username: a.username,
        isLoggedIn: a.is_microsoft,
        uuid: a.uuid
      }));
      setAccounts(updatedAccounts);

      // If removed active account, switch to another or show login
      if (activeAccount?.username === username) {
        if (updatedAccounts.length > 0) {
          await invoke('switch_account', { username: updatedAccounts[0].username });
          setActiveAccount(updatedAccounts[0]);
        } else {
          setActiveAccount({ username: 'Player', isLoggedIn: false, uuid: null });
          setShowLoginPrompt(true);
        }
      }
      showNotification(`Removed account ${username}`, 'success');
    } catch (error) {
      showNotification(`Failed to remove account: ${error}`, 'error');
    }
  }, [activeAccount, showNotification]);

  const handleOpenPopoutEditor = useCallback(async (instanceId) => {
    if (editingInstanceId === instanceId) {
      setEditingInstanceId(null);
    }

    const alreadyOpen = await focusExistingPopoutEditor(instanceId);
    if (alreadyOpen) {
      return;
    }

    try {
      const windowLabel = `editor-${instanceId}`;
      const editorWindow = new WebviewWindow(windowLabel, {
        url: `/?popout=editor&instanceId=${instanceId}`,
        title: `Editing Instance - ${instances.find(i => i.id === instanceId)?.name || instanceId}`,
        width: 1000,
        height: 700,
        minWidth: 800,
        minHeight: 600,
        decorations: false,
        transparent: true,
        visible: false, // Start hidden to prevent white flash
      });

      setOpenEditors(prev => [...prev, instanceId]);

      // Handle window closure to clean up state
      await editorWindow.onCloseRequested(() => {
        setOpenEditors(prev => prev.filter(id => id !== instanceId));
        loadInstances();
      });

    } catch (error) {
      console.error('Failed to create window:', error);
      showNotification('Failed to open pop-out editor', 'error');
    }
  }, [editingInstanceId, focusExistingPopoutEditor, instances, loadInstances, showNotification]);

  const handleEditInstanceChoice = useCallback(async (mode, dontAskAgain) => {
    const { instanceId } = showEditChoiceModal;
    setShowEditChoiceModal(null);

    if (dontAskAgain) {
      const updated = {
        ...launcherSettings,
        edit_mode_preference: mode
      };
      await invoke('save_settings', { newSettings: updated });
      loadLauncherSettings();
    }

    if (mode === 'pop-out') {
      handleOpenPopoutEditor(instanceId);
    } else {
      setEditingInstanceId(instanceId);
    }
  }, [showEditChoiceModal, launcherSettings, loadLauncherSettings, handleOpenPopoutEditor]);

  const handleEditInstance = useCallback(async (instanceId) => {
    if (editingInstanceId === instanceId) {
      return;
    }

    const openedInPopout = await focusExistingPopoutEditor(instanceId);
    if (openedInPopout) {
      showNotification('This instance is already being edited in a pop-out window.', 'info');
      return;
    }

    const preference = launcherSettings?.edit_mode_preference || 'ask';

    if (preference === 'ask') {
      setShowEditChoiceModal({ instanceId });
    } else if (preference === 'pop-out') {
      handleOpenPopoutEditor(instanceId);
    } else {
      setEditingInstanceId(instanceId);
    }
  }, [editingInstanceId, focusExistingPopoutEditor, handleOpenPopoutEditor, launcherSettings, showNotification]);

  const handleContextMenuAction = useCallback(async (action) => {
    const contextTarget = contextMenu?.instance;
    const isCategoryTarget = Boolean(contextTarget && contextTarget.__kind === 'category');
    const instance = isCategoryTarget ? null : contextTarget;
    const categoryName = isCategoryTarget ? normalizeCategoryName(contextTarget?.name) : '';
    setContextMenu(null);

    const openCategoryManagerFromContext = (mode = 'edit') => {
      if (!isCategoryTarget) return;
      window.dispatchEvent(new CustomEvent(OPEN_CATEGORY_MANAGER_EVENT, {
        detail: {
          mode,
          categoryName,
          bucketKey: contextTarget?.bucketKey || ''
        }
      }));
    };

    switch (action) {
      case 'play':
        if (instance) handleLaunchInstance(instance.id);
        break;
      case 'edit':
        if (instance) handleEditInstance(instance.id);
        break;
      case 'delete':
        if (instance) handleDeleteInstance(instance.id);
        break;
      case 'create':
        setActiveTab('create');
        break;
      case 'openFolder':
        if (instance) {
          try {
            await invoke('open_instance_folder', { instanceId: instance.id, folderType: 'root' });
          } catch (error) {
            console.error('Failed to open folder:', error);
          }
        }
        break;
      case 'clone':
        if (instance) {
          handleCloneInstance(instance);
        }
        break;
      case 'setCategory':
        if (instance) {
          setCategoryEditorModal(buildCategoryPickerModalState(instances, instance));
        }
        break;
      case 'clearCategory':
        if (instance) {
          try {
            const updated = { ...instance, category: null };
            await invoke('update_instance', { instance: updated });
            await loadInstances();
          } catch (error) {
            console.error('Failed to clear category:', error);
          }
        }
        break;
      case 'categoryEdit':
        if (isCategoryTarget) {
          openCategoryManagerFromContext('edit');
        }
        break;
      case 'categoryRename':
        if (isCategoryTarget && contextTarget?.bucketKey !== '__uncategorized__' && categoryName) {
          openCategoryManagerFromContext('rename');
        }
        break;
      case 'categoryDelete':
        if (isCategoryTarget && contextTarget?.bucketKey !== '__uncategorized__' && categoryName) {
          openCategoryManagerFromContext('delete');
        }
        break;
      case 'categoryLaunchAll':
        if (isCategoryTarget) {
          const isUncategorizedCategory = contextTarget?.bucketKey === '__uncategorized__';
          const normalizedCategoryKey = categoryName.toLowerCase();
          const categoryInstances = instances.filter((entry) => {
            const entryCategory = normalizeCategoryName(entry?.category);
            if (isUncategorizedCategory) {
              return !entryCategory;
            }
            return entryCategory.toLowerCase() === normalizedCategoryKey;
          });

          if (categoryInstances.length === 0) {
            showNotification('No instances in this category to launch.', 'info');
            break;
          }

          let preferredServerMap = {};
          try {
            const rawMap = localStorage.getItem(PREFERRED_SERVER_STORAGE_KEY);
            const parsedMap = rawMap ? JSON.parse(rawMap) : {};
            if (parsedMap && typeof parsedMap === 'object') {
              preferredServerMap = parsedMap;
            }
          } catch (error) {
            console.warn('Failed to read preferred server map for bulk category launch:', error);
          }

          for (const targetInstance of categoryInstances) {
            const preferredServerEntry = preferredServerMap?.[targetInstance.id];
            const preferredServerAddress = typeof preferredServerEntry?.address === 'string'
              ? preferredServerEntry.address.trim()
              : '';

            void handleLaunchInstance(
              targetInstance.id,
              preferredServerAddress ? { serverAddress: preferredServerAddress } : undefined
            );
          }

          showNotification(
            `Queued launch for ${categoryInstances.length} instance${categoryInstances.length === 1 ? '' : 's'}.`,
            'info'
          );
        }
        break;
      // ----------
      // Share (Export) action
      // Description: Exports the instance as a .zip file for sharing with others
      // ----------
      case 'share':
        if (instance) {
          try {
            const defaultName = `${instance.name.replace(/[^a-zA-Z0-9]/g, '_')}.zip`;
            const savePath = await save({
              defaultPath: defaultName,
              filters: [{
                name: 'Zip Archive',
                extensions: ['zip']
              }]
            });

            if (savePath) {
              setIsLoading(true);
              setLoadingStatus(`Exporting ${instance.name}...`);
              setLoadingTelemetry(EMPTY_DOWNLOAD_TELEMETRY);
              transferStatsRef.current = { lastBytes: null, lastTs: 0, speedBps: 0 };
              await invoke('export_instance_zip', {
                instanceId: instance.id,
                destinationPath: savePath
              });
              showNotification(`Exported "${instance.name}" successfully!`, 'success');
            }
          } catch (error) {
            showNotification(`Failed to export instance: ${error}`, 'error');
          } finally {
            setIsLoading(false);
            setLoadingStatus('');
            setLoadingProgress(0);
            setLoadingCount({ current: 0, total: 0 });
            setLoadingBytes({ current: 0, total: 0 });
            setLoadingTelemetry(EMPTY_DOWNLOAD_TELEMETRY);
          }
        }
        break;
      case 'shareCode':
        if (instance) {
          try {
            const code = await invoke('get_instance_share_code', { instanceId: instance.id });
            await navigator.clipboard.writeText(code);
            showNotification(
              'Share code copied! Includes supported Modrinth and CurseForge files; manual files are not included.',
              'success'
            );
          } catch (error) {
            showNotification(`Failed to generate share code: ${error}`, 'error');
          }
        }
        break;
      case 'createShortcut':
        if (instance) {
          try {
            const shortcutPath = await invoke('create_instance_shortcut', { instanceId: instance.id });
            showNotification(`Shortcut created on desktop: ${shortcutPath}`, 'success');
          } catch (error) {
            showNotification(`Failed to create shortcut: ${error}`, 'error');
          }
        }
        break;
    }
  }, [contextMenu, instances, handleLaunchInstance, handleEditInstance, handleDeleteInstance, handleCloneInstance, loadInstances, showNotification]);

  const handleCreateCategoryFromModal = useCallback(() => {
    if (!categoryEditorModal) return;
    const normalized = normalizeCategoryName(categoryEditorModal.newCategoryName);
    if (!normalized) {
      showNotification('Enter a category name first.', 'warning');
      return;
    }

    const existingMatch = categoryEditorModal.categories.find(
      (entry) => entry.toLowerCase() === normalized.toLowerCase()
    );
    const nextCategoryName = existingMatch || normalized;

    if (!existingMatch) {
      const nextStorageList = persistStoredCategories([...categoryEditorModal.categories, normalized]);

      setCategoryEditorModal((prev) => (prev ? {
        ...prev,
        categories: nextStorageList,
        categoryCounts: {
          ...prev.categoryCounts,
          [normalized.toLowerCase()]: 0
        },
        selectedCategory: nextCategoryName,
        creatingNew: false,
        newCategoryName: '',
        editingCategoryKey: '',
        editingCategoryValue: '',
        pendingDeleteCategoryKey: '',
        draggedCategoryKey: '',
        dragOverCategoryKey: ''
      } : prev));
      return;
    }

    setCategoryEditorModal((prev) => (prev ? {
      ...prev,
      selectedCategory: nextCategoryName,
      creatingNew: false,
      newCategoryName: '',
      editingCategoryKey: '',
      editingCategoryValue: '',
      pendingDeleteCategoryKey: '',
      draggedCategoryKey: '',
      dragOverCategoryKey: ''
    } : prev));
  }, [categoryEditorModal, showNotification]);

  const handleStartCategoryRenameFromModal = useCallback((categoryName) => {
    const normalized = normalizeCategoryName(categoryName);
    if (!normalized) return;
    const categoryKey = normalized.toLowerCase();
    setCategoryEditorModal((prev) => (prev ? {
      ...prev,
      editingCategoryKey: categoryKey,
      editingCategoryValue: categoryName,
      pendingDeleteCategoryKey: '',
      draggedCategoryKey: '',
      dragOverCategoryKey: ''
    } : prev));
  }, []);

  const handleCancelCategoryRenameFromModal = useCallback(() => {
    setCategoryEditorModal((prev) => (prev ? {
      ...prev,
      editingCategoryKey: '',
      editingCategoryValue: '',
      draggedCategoryKey: '',
      dragOverCategoryKey: ''
    } : prev));
  }, []);

  const handleCommitCategoryRenameFromModal = useCallback(async () => {
    if (!categoryEditorModal) return;

    const originalKey = normalizeCategoryName(categoryEditorModal.editingCategoryKey).toLowerCase();
    const renamed = normalizeCategoryName(categoryEditorModal.editingCategoryValue);
    const renamedKey = renamed.toLowerCase();

    if (!originalKey) return;
    if (!renamed) {
      showNotification('Category name cannot be empty.', 'warning');
      return;
    }

    const duplicate = categoryEditorModal.categories.some(
      (entry) => entry.toLowerCase() === renamedKey && entry.toLowerCase() !== originalKey
    );
    if (duplicate) {
      showNotification('Category already exists.', 'warning');
      return;
    }

    try {
      const affectedInstances = instances.filter(
        (instance) => normalizeCategoryName(instance?.category).toLowerCase() === originalKey
      );

      for (const instance of affectedInstances) {
        const updated = { ...instance, category: renamed };
        await invoke('update_instance', { instance: updated });
      }

      const renamedCategories = categoryEditorModal.categories.map((entry) => (
        entry.toLowerCase() === originalKey ? renamed : entry
      ));
      const persistedCategories = persistStoredCategories(renamedCategories);
      const nextCounts = { ...categoryEditorModal.categoryCounts };
      const movedCount = nextCounts[originalKey] || 0;
      delete nextCounts[originalKey];
      nextCounts[renamedKey] = movedCount;

      setCategoryEditorModal((prev) => (prev ? {
        ...prev,
        categories: persistedCategories,
        categoryCounts: nextCounts,
        selectedCategory: (prev.selectedCategory || '').toLowerCase() === originalKey ? renamed : prev.selectedCategory,
        editingCategoryKey: '',
        editingCategoryValue: '',
        pendingDeleteCategoryKey: '',
        draggedCategoryKey: '',
        dragOverCategoryKey: ''
      } : prev));

      await loadInstances();
    } catch (error) {
      console.error('Failed to rename category:', error);
      showNotification(`Failed to rename category: ${error}`, 'error');
    }
  }, [categoryEditorModal, instances, loadInstances, showNotification]);

  const handleDeleteCategoryFromModal = useCallback(async (categoryName) => {
    if (!categoryEditorModal) return;

    const category = normalizeCategoryName(categoryName);
    const categoryKey = category.toLowerCase();
    if (!categoryKey) return;

    try {
      const affectedInstances = instances.filter(
        (instance) => normalizeCategoryName(instance?.category).toLowerCase() === categoryKey
      );

      for (const instance of affectedInstances) {
        const updated = { ...instance, category: null };
        await invoke('update_instance', { instance: updated });
      }

      const remainingCategories = categoryEditorModal.categories.filter(
        (entry) => entry.toLowerCase() !== categoryKey
      );
      const persistedCategories = persistStoredCategories(remainingCategories);
      const nextCounts = { ...categoryEditorModal.categoryCounts };
      delete nextCounts[categoryKey];

      setCategoryEditorModal((prev) => (prev ? {
        ...prev,
        categories: persistedCategories,
        categoryCounts: nextCounts,
        selectedCategory: (prev.selectedCategory || '').toLowerCase() === categoryKey ? '' : prev.selectedCategory,
        editingCategoryKey: '',
        editingCategoryValue: '',
        pendingDeleteCategoryKey: '',
        draggedCategoryKey: '',
        dragOverCategoryKey: ''
      } : prev));

      await loadInstances();
    } catch (error) {
      console.error('Failed to delete category:', error);
      showNotification(`Failed to delete category: ${error}`, 'error');
    }
  }, [categoryEditorModal, instances, loadInstances, showNotification]);

  const handleSaveCategoryFromModal = useCallback(async () => {
    if (!categoryEditorModal?.instance) return;

    const targetInstance = categoryEditorModal.instance;
    const normalizedCategory = normalizeCategoryName(categoryEditorModal.selectedCategory);
    if (!normalizedCategory) {
      showNotification('Pick a category or create a new one.', 'warning');
      return;
    }

    const storedCategories = loadStoredCategories();
    if (!storedCategories.some((entry) => entry.toLowerCase() === normalizedCategory.toLowerCase())) {
      persistStoredCategories([...storedCategories, normalizedCategory]);
    } else {
      persistStoredCategories(storedCategories);
    }
    setCategoryEditorModal(null);

    try {
      const updated = { ...targetInstance, category: normalizedCategory };
      await invoke('update_instance', { instance: updated });
      await loadInstances();
    } catch (error) {
      console.error('Failed to save category:', error);
      showNotification(`Failed to save category: ${error}`, 'error');
    }
  }, [categoryEditorModal, loadInstances, showNotification]);

  const handleCloseEditor = useCallback(() => {
    setEditingInstanceId(null);
    loadInstances();
  }, [loadInstances]);

  const renderContent = () => {
    if (editingInstanceId) {
      return (
        <Suspense fallback={<div className="centered-loader"><div className="init-spinner"></div></div>}>
          <InstanceEditor
            instanceId={editingInstanceId}
            onClose={handleCloseEditor}
            onPopout={() => {
              const id = editingInstanceId;
              handleCloseEditor();
              handleOpenPopoutEditor(id);
            }}
            onUpdate={loadInstances}
            onLaunch={handleLaunchInstance}
            onStop={handleStopInstance}
            runningInstances={runningInstances}
            onShowNotification={showNotification}
            onQueueDownload={handleQueueDownload}
            onDequeueDownload={handleDequeueDownload}
            onUpdateDownloadStatus={handleUpdateDownloadStatus}
            skinCache={skinCache}
            skinRefreshKey={skinRefreshKey}
            launcherSettings={launcherSettings}
            onDelete={(id) => {
              performDeleteInstance(id);
              setEditingInstanceId(null);
            }}
          />
        </Suspense>
      );
    }

    switch (activeTab) {
      case 'instances':
        return (
          <InstanceList
            instances={instances}
            onLaunch={handleLaunchInstance}
            onStop={handleStopInstance}
            onCreate={() => setActiveTab('create')}
            onEditInstance={handleEditInstance}
            onContextMenu={handleInstanceContextMenu}
            onInstancesRefresh={loadInstances}
            onShowNotification={showNotification}
            skinCache={skinCache}
            isLoading={isLoading}
            launchingInstanceIds={launchingInstanceIds}
            launchingInstanceId={launchingInstanceId}
            loadingStatus={loadingStatus}
            loadingProgress={loadingProgress}
            loadingBytes={loadingBytes}
            loadingCount={loadingCount}
            loadingTelemetry={loadingTelemetry}
            launchProgressByInstance={launchProgressByInstance}
            runningInstances={runningInstances}
            stoppingInstanceIds={stoppingInstanceIds}
            deletingInstanceIds={deletingInstanceIds}
            launcherSettings={launcherSettings}
            backgroundTasks={instanceSetupTasks}
            setupProgressByInstance={instanceSetupByInstance}
            onQueueDownload={handleQueueDownload}
            onUpdateDownloadStatus={handleUpdateDownloadStatus}
            onDequeueDownload={handleDequeueDownload}
          />
        );
      case 'create':
        return (
          <Suspense fallback={<div className="centered-loader"><div className="init-spinner"></div></div>}>
            <CreateInstance
              onClose={() => setActiveTab('instances')}
              onCreate={handleCreateInstance}
              isLoading={isCreateTaskRunning}
              loadingStatus={loadingStatus}
              loadingProgress={loadingProgress}
              loadingBytes={loadingBytes}
              loadingCount={loadingCount}
              loadingTelemetry={loadingTelemetry}
              launcherSettings={launcherSettings}
              mode="page"
            />
          </Suspense>
        );
      case 'settings':
        return (
          <Suspense fallback={<div className="centered-loader"><div className="init-spinner"></div></div>}>
            <Settings
              username={activeAccount?.username || 'Player'}
              onSetUsername={handleSetUsername}
              isLoggedIn={activeAccount?.isLoggedIn || false}
              onLogin={handleLogin}
              onLogout={handleLogout}
              launcherSettings={launcherSettings}
              onSettingsUpdated={loadLauncherSettings}
            />
          </Suspense>
        );
      case 'appearance':
        return (
          <Suspense fallback={<div className="centered-loader"><div className="init-spinner"></div></div>}>
            <Appearance
              launcherSettings={launcherSettings}
              onSettingsUpdated={loadLauncherSettings}
            />
          </Suspense>
        );
      case 'stats':
        return (
          <Suspense fallback={<div className="centered-loader"><div className="init-spinner"></div></div>}>
            <Stats />
          </Suspense>
        );
      case 'skins':
        return (
          <Suspense fallback={<div className="centered-loader"><div className="init-spinner"></div></div>}>
            <SkinManager
              activeAccount={activeAccount}
              showNotification={showNotification}
              onSkinChange={(url) => {
                setSkinRefreshKey(Date.now());
                setCurrentSkinUrl(url || null);
                if (activeAccount?.uuid) {
                  // Update the skin cache so dropdown shows new head immediately
                  if (url) {
                    setSkinCache(prev => ({ ...prev, [activeAccount.uuid]: url }));
                    if (url.startsWith('http')) {
                      localStorage.setItem(`skin_${activeAccount.uuid}`, url);
                    }
                  } else {
                    localStorage.removeItem(`skin_${activeAccount.uuid}`);
                  }
                }
              }}
              onPreviewChange={setCurrentSkinUrl}
            />
          </Suspense>
        );
      case 'updates':
        return (
          <Suspense fallback={<div className="centered-loader"><div className="init-spinner"></div></div>}>
            <Updates />
          </Suspense>
        );
      case 'console':
        return (
          <Suspense fallback={<div className="centered-loader"><div className="init-spinner"></div></div>}>
            <Console logs={logs} setLogs={setLogs} />
          </Suspense>
        );
      default:
        return null;
    }
  };

  const renderLaunchUpdatePromptModal = () => {
    if (!launchUpdatePrompt) return null;

    const entries = launchUpdatePrompt.entries || [];
    const totalCount = entries.length;
    const modCount = launchUpdatePrompt.modUpdates?.length || 0;
    const hasLoaderUpdate = Boolean(launchUpdatePrompt.loaderUpdate);

    return (
      <ConfirmModal
        title={`Updates found for ${launchUpdatePrompt.instanceName}`}
        message={
          <div className="launch-update-check-message">
            <p className="launch-update-check-intro">
              {modCount > 0 && hasLoaderUpdate
                ? `${modCount} mod update${modCount > 1 ? 's' : ''} and 1 loader update are available before launch.`
                : hasLoaderUpdate
                  ? '1 loader update is available before launch.'
                  : `${modCount} mod update${modCount > 1 ? 's are' : ' is'} available before launch.`}
            </p>
            <div className="launch-update-check-list">
              {entries.slice(0, 8).map((item) => (
                <div key={`${launchUpdatePrompt.instanceId}-${item.id}`} className="launch-update-check-item">
                  <span className="launch-update-check-name">
                    {item.name}
                    {item.type === 'loader' && <span className="launch-update-type-chip">Loader</span>}
                  </span>
                  <span className="launch-update-version-flow">
                    <span className="launch-update-version-pill old">{item.currentLabel}</span>
                    <span className="launch-update-version-arrow">→</span>
                    <span className="launch-update-version-pill new">{item.latestLabel}</span>
                  </span>
                </div>
              ))}
              {entries.length > 8 && (
                <div className="launch-update-check-more">
                  +{entries.length - 8} more update{entries.length - 8 > 1 ? 's' : ''}
                </div>
              )}
            </div>
            <button
              type="button"
              className={`launch-update-check-toggle-btn ${launchUpdatePrompt.disableFutureChecks ? 'enabled' : ''}`}
              onClick={() =>
                setLaunchUpdatePrompt((prev) =>
                  prev ? { ...prev, disableFutureChecks: !prev.disableFutureChecks } : prev
                )
              }
            >
              <span className={`launch-update-check-switch ${launchUpdatePrompt.disableFutureChecks ? 'enabled' : ''}`} />
              <span className="launch-update-check-toggle-copy">
                <span className="launch-update-check-toggle-title">
                  Disable future launch update checks
                </span>
                <span className="launch-update-check-toggle-sub">
                  Skip this prompt next time for this instance.
                </span>
              </span>
            </button>
          </div>
        }
        confirmText={`Update & Launch (${totalCount})`}
        cancelText="Cancel Launch"
        extraConfirmText="Ignore & Launch"
        variant="primary"
        actionLayout="flat"
        modalClassName="launch-update-confirm-modal"
        onConfirm={() => resolveLaunchUpdatePrompt('update')}
        onExtraConfirm={() => resolveLaunchUpdatePrompt('ignore')}
        onCancel={() => resolveLaunchUpdatePrompt('cancel')}
      />
    );
  };

  const renderNotifications = () => {
    if (!notifications.length) return null;

    return (
      <div className="notification-stack" role="status" aria-live="polite">
        {notifications.map((item) => (
          <div
            key={item.id}
            className={`notification notification-${item.type} ${item.isLeaving ? 'notification-exit' : ''}`}
          >
            <span className="notification-message">{item.message}</span>
            <button
              type="button"
              className="notification-close"
              onClick={() => dismissNotification(item.id)}
              aria-label="Close notification"
            >
              ×
            </button>
          </div>
        ))}
      </div>
    );
  };

  if (popoutMode === 'editor' && popoutInstanceId) {
    return (
      <div className={`app popout-window bg-${launcherSettings?.background_style || 'gradient'}`} style={{ height: '100vh', width: '100vw' }}>
        <TitleBar
          activeTab={activeTab}
          onTabChange={setActiveTab}
          isPopout={true}
          launcherSettings={launcherSettings}
          instances={instances}
          accounts={accounts}
          runningInstances={runningInstances}
          stoppingInstanceIds={stoppingInstanceIds}
          forceStoppingInstanceIds={forceStoppingInstanceIds}
          onStopInstance={handleStopInstance}
          onForceStopInstance={handleForceStopInstance}
          onStopAllInstances={handleStopAllInstances}
          editingInstanceId={popoutInstanceId}
          downloadQueue={downloadQueue}
          downloadHistory={downloadHistory}
          onClearDownloadHistory={handleClearDownloadHistory}
        />
        <div className="app-main-layout">
          <main className="main-content" style={{ padding: 0 }}>
            <Suspense fallback={<div className="centered-loader"><div className="init-spinner"></div></div>}>
              <InstanceEditor
                instanceId={popoutInstanceId}
                isPopout={true}
                onClose={async () => {
                  devLog('Closing pop-out window...');
                  try {
                    await getCurrentWindow().close();
                  } catch (e) {
                    devError('Failed to close window:', e);
                    window.close(); // Fallback
                  }
                }}
                onUpdate={loadInstances}
                onLaunch={handleLaunchInstance}
                onStop={handleStopInstance}
                runningInstances={runningInstances}
                onShowNotification={showNotification}
                onQueueDownload={handleQueueDownload}
                onDequeueDownload={handleDequeueDownload}
                onUpdateDownloadStatus={handleUpdateDownloadStatus}
                skinCache={skinCache}
                skinRefreshKey={skinRefreshKey}
                launcherSettings={launcherSettings}
                onDelete={async (id) => {
                  await performDeleteInstance(id);
                  getCurrentWindow().close();
                }}
              />
            </Suspense>
          </main>
        </div>

        {renderNotifications()}

        {renderLaunchUpdatePromptModal()}

        {isInitializing && (
          <div className="app-initializing">
            <div className="init-spinner-container">
              <div className="init-spinner"></div>
              <span className="init-text">Loading Editor</span>
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className={`app bg-${launcherSettings?.background_style || 'gradient'} sidebar-style-${sidebarStyle} sidebar-variant-${sidebarStyleRaw}`}>
      <TitleBar
        activeTab={activeTab}
        onTabChange={setActiveTab}
        launcherSettings={launcherSettings}
        runningInstances={runningInstances}
        stoppingInstanceIds={stoppingInstanceIds}
        forceStoppingInstanceIds={forceStoppingInstanceIds}
        instances={instances}
        accounts={accounts}
        onStopInstance={handleStopInstance}
        onForceStopInstance={handleForceStopInstance}
        onStopAllInstances={handleStopAllInstances}
        editingInstanceId={editingInstanceId}
        downloadQueue={downloadQueue}
        downloadHistory={downloadHistory}
        onClearDownloadHistory={handleClearDownloadHistory}
      />
      <div className={`app-main-layout with-sidebar sidebar-style-${sidebarStyle} sidebar-variant-${sidebarStyleRaw}`}>
        <Sidebar
          activeTab={activeTab}
          onTabChange={(tab) => {
            setEditingInstanceId(null);
            setActiveTab(tab);
          }}
          accounts={accounts}
          activeAccount={activeAccount}
          onSwitchAccount={handleSwitchAccount}
          onAddAccount={handleAddAccount}
          onRemoveAccount={handleRemoveAccount}
          skinRefreshKey={skinRefreshKey}
          currentSkinTexture={currentSkinUrl}
          skinCache={skinCache}
          launcherSettings={launcherSettings}
          onOpenAccountManager={() => setShowAccountManager(true)}
          onShowInfo={(config) => {
            setConfirmModal({
              ...config,
              onConfirm: () => setConfirmModal(null),
              onCancel: () => setConfirmModal(null)
            });
          }}
        />
        <main className="main-content">
          <div
            key={editingInstanceId ? `editor-${editingInstanceId}` : `tab-${activeTab}`}
            className={`main-content-switch ${activeTab === 'instances' && !editingInstanceId ? 'blur-friendly' : ''}`}
          >
            {renderContent()}
          </div>
        </main>
      </div>

      {launcherSettings?.show_fps_counter && <FpsCounter />}

      {showWelcome && (
        <div className="welcome-overlay" onClick={handleCloseWelcome}>
          <div className="welcome-modal" onClick={(e) => e.stopPropagation()}>
            <div className="welcome-header">
              <h2>Welcome to Palethea Launcher</h2>
              <button className="close-btn" onClick={handleCloseWelcome}>×</button>
            </div>
            <div className="welcome-body">
              <p className="welcome-intro">
                Create and manage Minecraft instances with mod loaders, profiles, and performance tuning.
              </p>

              <div className="welcome-features-list">
                <div className="welcome-feature-item">
                  <span className="feature-dot"></span>
                  <div className="feature-content">
                    <strong>Organize Your Library</strong>
                    <p>Assign unique color accents to your instances for a personalized collection view.</p>
                  </div>
                </div>
                <div className="welcome-feature-item">
                  <span className="feature-dot"></span>
                  <div className="feature-content">
                    <strong>Playtime Tracking</strong>
                    <p>Monitor your journey with automated logging that tracks every hour spent across your various instances.</p>
                  </div>
                </div>
                <div className="welcome-feature-item">
                  <span className="feature-dot"></span>
                  <div className="feature-content">
                    <strong>Universal Modding</strong>
                    <p>Seamlessly install Fabric, Forge, or NeoForge directly when creating new instances—no manual downloads required.</p>
                  </div>
                </div>
              </div>

              <p className="welcome-hint">
                Tip: You can change whether this welcome screen shows in Settings later.
              </p>
            </div>
            <div className="welcome-footer">
              <button className="link-btn-text" onClick={handleOpenSupport}>
                palethea.com
              </button>
              <div className="footer-right">
                <button
                  className={`btn btn-secondary welcome-toggle ${welcomeDontShow ? 'active' : ''}`}
                  onClick={() => setWelcomeDontShow(!welcomeDontShow)}
                >
                  Don’t show this again
                </button>
                <button className="btn btn-primary" onClick={handleCloseWelcome}>
                  Get Started
                </button>
              </div>
            </div>
          </div>
        </div>
      )}


      {renderNotifications()}


      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          instance={contextMenu.instance}
          isEditing={
            Boolean(contextMenu.instance && contextMenu.instance.__kind !== 'category')
            && (
              editingInstanceId === contextMenu.instance.id
              || openEditors.includes(contextMenu.instance.id)
            )
          }
          onAction={handleContextMenuAction}
        />
      )}

      {categoryEditorModal && (
        <ConfirmModal
          title={categoryEditorModal.instance ? 'Set Instance Category' : 'Manage Categories'}
          message={(
            <div className="instance-category-modal-body">
              {categoryEditorModal.instance ? (
                <p>
                  Category for <strong>{categoryEditorModal.instance?.name}</strong>
                </p>
              ) : (
                <p>Manage existing categories, or create a new one.</p>
              )}
              <div className="instance-category-modal-toolbar">
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => setCategoryEditorModal((prev) => (prev ? { ...prev, creatingNew: !prev.creatingNew } : prev))}
                >
                  {categoryEditorModal.creatingNew ? 'Cancel New' : 'Create New'}
                </button>
              </div>
              {categoryEditorModal.creatingNew && (
                <div className="instance-category-modal-create-row">
                  <input
                    type="text"
                    value={categoryEditorModal.newCategoryName}
                    onChange={(event) => setCategoryEditorModal((prev) => (prev ? { ...prev, newCategoryName: event.target.value } : prev))}
                    placeholder="New category name"
                    autoFocus
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') {
                        event.preventDefault();
                        handleCreateCategoryFromModal();
                      }
                    }}
                  />
                  <button
                    type="button"
                    className="btn btn-primary"
                    onClick={handleCreateCategoryFromModal}
                  >
                    Add
                  </button>
                </div>
              )}
              <div className="instance-category-modal-list">
                {categoryEditorModal.categories.length === 0 ? (
                  <div className="instance-category-modal-empty">
                    No categories are in use yet. Create one to continue.
                  </div>
                ) : (
                  categoryEditorModal.categories.map((categoryName) => {
                    const isSelectionMode = Boolean(categoryEditorModal.instance);
                    const categoryKey = categoryName.toLowerCase();
                    const usageCount = categoryEditorModal.categoryCounts?.[categoryKey] ?? 0;
                    const isSelected = (categoryEditorModal.selectedCategory || '').toLowerCase() === categoryKey;
                    const isEditing = categoryEditorModal.editingCategoryKey === categoryKey;
                    const isPendingDelete = categoryEditorModal.pendingDeleteCategoryKey === categoryKey;

                    if (isSelectionMode) {
                      return (
                        <div
                          key={categoryKey}
                          className={`instance-category-modal-item selection-mode ${isSelected ? 'selected' : ''}`}
                        >
                          <button
                            type="button"
                            className="instance-category-modal-item-select instance-category-modal-item-select-full"
                            onClick={() => setCategoryEditorModal((prev) => (prev ? { ...prev, selectedCategory: categoryName } : prev))}
                          >
                            <span className="instance-category-modal-item-name">{categoryName}</span>
                            <span className="instance-category-modal-item-count">{usageCount}</span>
                          </button>
                        </div>
                      );
                    }

                    return (
                      <div
                        key={categoryKey}
                        className={`instance-category-modal-item ${isSelected ? 'selected' : ''}`}
                      >
                        <button
                          type="button"
                          className="instance-category-modal-item-select"
                          onClick={() => setCategoryEditorModal((prev) => (prev ? { ...prev, selectedCategory: categoryName } : prev))}
                        >
                          <span className="instance-category-modal-item-name">{categoryName}</span>
                          <span className="instance-category-modal-item-count">{usageCount}</span>
                        </button>
                        <div className="instance-category-modal-item-actions">
                          <button
                            type="button"
                            className="instance-category-modal-action-btn"
                            onClick={() => handleStartCategoryRenameFromModal(categoryName)}
                          >
                            Rename
                          </button>
                          <button
                            type="button"
                            className="instance-category-modal-action-btn danger"
                            onClick={() => setCategoryEditorModal((prev) => (prev ? {
                              ...prev,
                              pendingDeleteCategoryKey: categoryKey,
                              editingCategoryKey: '',
                              editingCategoryValue: '',
                              draggedCategoryKey: '',
                              dragOverCategoryKey: ''
                            } : prev))}
                          >
                            Delete
                          </button>
                        </div>
                        {isEditing && (
                          <div className="instance-category-modal-inline-edit">
                            <input
                              type="text"
                              value={categoryEditorModal.editingCategoryValue}
                              onChange={(event) => setCategoryEditorModal((prev) => (prev ? { ...prev, editingCategoryValue: event.target.value } : prev))}
                              onKeyDown={(event) => {
                                if (event.key === 'Enter') {
                                  event.preventDefault();
                                  handleCommitCategoryRenameFromModal();
                                }
                                if (event.key === 'Escape') {
                                  event.preventDefault();
                                  handleCancelCategoryRenameFromModal();
                                }
                              }}
                              autoFocus
                            />
                            <button
                              type="button"
                              className="btn btn-primary"
                              onClick={handleCommitCategoryRenameFromModal}
                            >
                              Save
                            </button>
                            <button
                              type="button"
                              className="btn btn-secondary"
                              onClick={handleCancelCategoryRenameFromModal}
                            >
                              Cancel
                            </button>
                          </div>
                        )}
                        {isPendingDelete && (
                          <div className="instance-category-modal-inline-delete">
                            <p>Delete this category and clear it from all assigned instances?</p>
                            <div className="instance-category-modal-inline-delete-actions">
                              <button
                                type="button"
                                className="btn btn-secondary"
                                onClick={() => setCategoryEditorModal((prev) => (prev ? {
                                  ...prev,
                                  pendingDeleteCategoryKey: '',
                                  draggedCategoryKey: '',
                                  dragOverCategoryKey: ''
                                } : prev))}
                              >
                                Cancel
                              </button>
                              <button
                                type="button"
                                className="btn btn-danger"
                                onClick={() => handleDeleteCategoryFromModal(categoryName)}
                              >
                                Delete
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          )}
          confirmText={categoryEditorModal.instance ? 'Set Category' : 'Done'}
          cancelText={categoryEditorModal.instance ? 'Cancel' : 'Close'}
          variant="primary"
          onConfirm={categoryEditorModal.instance ? handleSaveCategoryFromModal : () => setCategoryEditorModal(null)}
          onCancel={() => setCategoryEditorModal(null)}
        />
      )}

      {showLoginPrompt && (
        <LoginPrompt
          onLogin={async (username) => {
            await handleLogin(username);
            setShowLoginPrompt(false);
          }}
          onClose={() => setShowLoginPrompt(false)}
          onOfflineMode={(username) => {
            handleSetUsername(username);
            setShowLoginPrompt(false);
          }}
          canCancel={accounts.length > 0}
        />
      )}

      {renderLaunchUpdatePromptModal()}

      {confirmModal && (
        <ConfirmModal
          title={confirmModal.title}
          message={confirmModal.message}
          confirmText={confirmModal.confirmText}
          cancelText={confirmModal.cancelText}
          extraConfirmText={confirmModal.extraConfirmText}
          variant={confirmModal.variant}
          onConfirm={() => {
            if (confirmModal.onConfirm) confirmModal.onConfirm();
            setConfirmModal(null);
          }}
          onCancel={() => {
            if (confirmModal.onCancel) confirmModal.onCancel();
            setConfirmModal(null);
          }}
          onExtraConfirm={() => {
            if (confirmModal.onExtraConfirm) confirmModal.onExtraConfirm();
            setConfirmModal(null);
          }}
        />
      )}

      <AccountManagerModal
        show={showAccountManager}
        onClose={() => setShowAccountManager(false)}
        accounts={accounts}
        activeAccount={activeAccount}
        onSwitchAccount={handleSwitchAccount}
        onAddAccount={handleAddAccount}
        onRemoveAccount={handleRemoveAccount}
        skinCache={skinCache}
        skinRefreshKey={skinRefreshKey}
      />

      {showEditChoiceModal && (
        <EditChoiceModal
          onChoose={handleEditInstanceChoice}
          onCancel={() => setShowEditChoiceModal(null)}
        />
      )}

      {isInitializing && (
        <div className="app-initializing">
          {/* <img src="/logoPL.png" className="init-logo" alt="Palethea" /> */}
          <div className="init-spinner-container">
            <div className="init-spinner"></div>
            <span className="init-text">{popoutMode ? 'Loading Editor' : 'Initializing Launcher'}</span>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
