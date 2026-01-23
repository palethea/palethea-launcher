import { useState, useEffect, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { open } from '@tauri-apps/plugin-shell';
import { save } from '@tauri-apps/plugin-dialog';
import { listen } from '@tauri-apps/api/event';
import Sidebar from './components/Sidebar';
import InstanceList from './components/InstanceList';
import InstanceEditor from './components/InstanceEditor';
import Settings from './components/Settings';
import Stats from './components/Stats';
import SkinManager from './components/SkinManager';
import CreateInstance from './components/CreateInstance';
import ContextMenu from './components/ContextMenu';
import LoginPrompt from './components/LoginPrompt';
import ConfirmModal from './components/ConfirmModal';
import Updates from './components/Updates';
import Console from './components/Console';
import AccountManagerModal from './components/AccountManagerModal';
import './App.css';

function App() {
  const [activeTab, setActiveTab] = useState('instances');
  const [instances, setInstances] = useState([]);
  const [accounts, setAccounts] = useState([]);
  const [activeAccount, setActiveAccount] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [loadingStatus, setLoadingStatus] = useState('');
  const [loadingProgress, setLoadingProgress] = useState(0);
  const [loadingBytes, setLoadingBytes] = useState({ current: 0, total: 0 });
  const [notification, setNotification] = useState(null);
  const [editingInstanceId, setEditingInstanceId] = useState(null);
  const [contextMenu, setContextMenu] = useState(null);
  const [showLoginPrompt, setShowLoginPrompt] = useState(false);
  const [confirmModal, setConfirmModal] = useState(null);
  const [runningInstances, setRunningInstances] = useState([]);
  const [showWelcome, setShowWelcome] = useState(false);
  const [welcomeDontShow, setWelcomeDontShow] = useState(false);
  const [skinRefreshKey, setSkinRefreshKey] = useState(Date.now());
  const [currentSkinUrl, setCurrentSkinUrl] = useState(null);
  const [skinCache, setSkinCache] = useState({});
  const [logs, setLogs] = useState([]);
  const [launcherSettings, setLauncherSettings] = useState(null);
  const [showAccountManager, setShowAccountManager] = useState(false);
  const [isInitializing, setIsInitializing] = useState(true);

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
      console.warn('Silent skin load failed:', err);
    }
  }, []);

  const loadInstances = useCallback(async () => {
    try {
      const result = await invoke('get_instances');
      setInstances(result);
    } catch (error) {
      console.error('Failed to load instances:', error);
    }
  }, []);

  const loadRunningInstances = useCallback(async () => {
    try {
      const result = await invoke('get_running_instances');
      setRunningInstances(result);
    } catch (error) {
      console.error('Failed to load running instances:', error);
    }
  }, []);

  const loadLauncherSettings = useCallback(async () => {
    try {
      const settings = await invoke('get_settings');
      setLauncherSettings(settings);
    } catch (error) {
      console.error('Failed to load launcher settings:', error);
      // Set defaults on error
      setLauncherSettings({ enable_console: false, show_welcome: true, account_preview_mode: 'simple' });
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

      // Find active account
      const activeUsername = savedData.active_account || savedData.accounts[0]?.username;
      const activeAcc = savedData.accounts.find(a => a.username === activeUsername);

      if (activeAcc) {
        // Validate/refresh Microsoft account
        if (activeAcc.is_microsoft) {
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
        }

        // Switch to active account in backend
        await invoke('switch_account', { username: activeAcc.username });
        setActiveAccount({
          username: activeAcc.username,
          isLoggedIn: activeAcc.is_microsoft,
          uuid: activeAcc.uuid
        });
        await loadSkinForAccount(activeAcc.is_microsoft, activeAcc.uuid);
      }
    } catch (error) {
      console.error('Failed to load accounts:', error);
      setShowLoginPrompt(true);
      setActiveAccount({ username: 'Player', isLoggedIn: false, uuid: null });
    }
  }, [loadSkinForAccount]);

  useEffect(() => {
    const initializeApp = async () => {
      try {
        await Promise.all([
          loadInstances(),
          loadAccounts(),
          loadRunningInstances(),
          loadLauncherSettings()
        ]);
        // Short delay to ensure state updates and transitions are smooth
        setTimeout(() => setIsInitializing(false), 800);
      } catch (error) {
        console.error('Initialization failed:', error);
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
    });

    // Listen for download progress events
    const unlistenProgress = listen('download-progress', (event) => {
      const { stage, percentage, total_bytes, downloaded_bytes } = event.payload;
      const displayPercentage = Number(percentage).toFixed(1);

      setLogs(prev => [...prev.slice(-499), {
        id: Date.now() + Math.random(),
        level: 'info',
        message: `[Download] ${stage} (${displayPercentage}%)`,
        timestamp: new Date().toISOString()
      }]);
      setLoadingStatus(stage);
      setLoadingProgress(percentage);
      if (total_bytes !== undefined && downloaded_bytes !== undefined) {
        setLoadingBytes({ current: downloaded_bytes || 0, total: total_bytes || 0 });
      } else {
        setLoadingBytes({ current: 0, total: 0 });
      }
    });

    // Listen for instance refresh events from backend
    const unlistenRefresh = listen('refresh-instances', () => {
      loadInstances();
      loadRunningInstances();
    });

    // Listen for exit confirmation
    const unlistenExit = listen('show-exit-confirm', () => {
      setConfirmModal({
        title: 'Exit Palethea?',
        message: 'A game instance is still running. Closing the launcher will also stop the game. Are you sure you want to exit?',
        confirmText: 'Exit Everything',
        cancelText: 'Keep Playing',
        variant: 'danger',
        onConfirm: async () => {
          await invoke('exit_app_fully');
        },
        onCancel: () => setConfirmModal(null)
      });
    });

    return () => {
      clearInterval(runningPoll);
      unlistenLog.then(fn => fn());
      unlistenProgress.then(fn => fn());
      unlistenRefresh.then(fn => fn());
      unlistenExit.then(fn => fn());
      document.removeEventListener('contextmenu', handleContextMenu);
    };
  }, [loadInstances, loadRunningInstances, isLoading]);

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

  const handleInstanceContextMenu = (e, instance) => {
    e.preventDefault();
    setContextMenu({
      x: e.clientX,
      y: e.clientY,
      instance,
    });
  };

  const handleContextMenuAction = async (action, data) => {
    const instance = contextMenu?.instance;
    setContextMenu(null);

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
      case 'setColor':
        if (instance && data) {
          try {
            const updated = { ...instance, color_accent: data };
            await invoke('update_instance', { instance: updated });
            await loadInstances();
          } catch (error) {
            console.error('Failed to set color:', error);
          }
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
          }
        }
        break;
      case 'shareCode':
        if (instance) {
          try {
            const code = await invoke('get_instance_share_code', { instanceId: instance.id });
            await navigator.clipboard.writeText(code);
            showNotification(
              'Share code copied! Note: Only Modrinth-sourced files are included.',
              'success'
            );
          } catch (error) {
            showNotification(`Failed to generate share code: ${error}`, 'error');
          }
        }
        break;
    }
  };

  const handleCloneInstance = async (instance) => {
    const newName = `${instance.name} (Copy)`;
    setIsLoading(true);
    setLoadingStatus('Cloning instance...');
    try {
      await invoke('clone_instance', { instanceId: instance.id, newName });
      await loadInstances();
      showNotification(`Cloned "${instance.name}" successfully!`, 'success');
    } catch (error) {
      showNotification(`Failed to clone instance: ${error}`, 'error');
    }
    setIsLoading(false);
    setLoadingStatus('');
  };

  const showNotification = (message, type = 'info') => {
    setNotification({ message, type });
    setTimeout(() => setNotification(null), 5000);
  };

  const handleCreateInstance = async (name, versionId, modLoader = 'vanilla', modLoaderVersion = null) => {
    setIsLoading(true);
    setLoadingProgress(0);
    try {
      // ----------
      // Import from .zip handler
      // Description: Imports an instance from a shared .zip file
      // ----------
      if (modLoader === 'import') {
        const { zipPath } = modLoaderVersion;
        setLoadingStatus('Importing instance...');
        setLoadingProgress(20);

        const importedInstance = await invoke('import_instance_zip', {
          zipPath,
          customName: name || null
        });

        setLoadingProgress(60);
        setLoadingStatus(`Downloading Minecraft ${importedInstance.version_id}...`);
        await invoke('download_version', { versionId: importedInstance.version_id });

        setLoadingProgress(100);
        await loadInstances();
        setActiveTab('instances');
        showNotification(`Imported instance "${importedInstance.name}"!`, 'success');
        setIsLoading(false);
        setLoadingStatus('');
        setLoadingProgress(0);
        return;
      }

      // ----------
      // Share Code Handler
      // Description: Extracts metadata from a shared code and rebuilds the instance by downloading all assets
      // ----------
      if (modLoader === 'share-code') {
        const { shareData } = modLoaderVersion;
        const { 
          name: originalName, 
          version: mcVersion, 
          loader, 
          loader_version, 
          mods, 
          resourcepacks, 
          shaders,
          datapacks = [] 
        } = shareData;

        setLoadingStatus(`Preparing instance "${name || originalName}"...`);
        setLoadingProgress(5);

        // 0. Pre-fetch all project metadata for better speed and UI fidelity
        setLoadingStatus("Fetching metadata...");
        const allProjectIds = [
          ...mods.map(m => m.project_id || m.projectId),
          ...resourcepacks.map(p => p.project_id || p.projectId),
          ...shaders.map(s => s.project_id || s.projectId),
          ...datapacks.map(d => d.project_id || d.projectId)
        ].filter(Boolean);
        
        const uniqueIds = [...new Set(allProjectIds)];
        let projectMap = {};
        
        try {
          if (uniqueIds.length > 0) {
            const projects = await invoke('get_modrinth_projects', { projectIds: uniqueIds });
            projects.forEach(p => {
              const id = p.project_id || p.id;
              if (id) projectMap[id] = p;
              if (p.slug) projectMap[p.slug] = p;
            });
          }
        } catch (e) {
          console.warn("Failed to bulk fetch project metadata:", e);
        }

        // 1. Create the instance
        const newInstance = await invoke('create_instance', { 
          name: name || originalName, 
          versionId: mcVersion 
        });

        // 2. Download Minecraft
        setLoadingStatus(`Downloading Minecraft ${mcVersion}...`);
        setLoadingProgress(10);
        await invoke('download_version', { versionId: mcVersion });

        // 3. Install Mod Loader
        if (loader !== 'vanilla') {
          setLoadingStatus(`Installing ${loader}...`);
          setLoadingProgress(20);
          if (loader === 'fabric') {
            await invoke('install_fabric', { instanceId: newInstance.id, loaderVersion: loader_version });
          } else if (loader === 'forge') {
            await invoke('install_forge', { instanceId: newInstance.id, loaderVersion: loader_version });
          } else if (loader === 'neoforge') {
            await invoke('install_neoforge', { instanceId: newInstance.id, loaderVersion: loader_version });
          }
        }

        // 4. Download Everything
        const totalItems = mods.length + resourcepacks.length + shaders.length + datapacks.length;
        let completedItems = 0;

        // Helper to process items
        const processItems = async (items, type, worldName = null) => {
          for (const item of items) {
            const mid = item.project_id || item.projectId;
            const vid = item.version_id || item.versionId;
            setLoadingStatus(`Installing ${type} ${++completedItems}/${totalItems}...`);
            try {
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
                
                // Fallback for individual fetch if bulk failed or item was slug
                if (!project) {
                  try {
                    project = await invoke('get_modrinth_project', { projectId: mid });
                  } catch (e) {
                    console.warn(`Failed to fetch project metadata for ${mid}:`, e);
                  }
                }

                const file = info.files.find(f => f.primary) || info.files[0];
                
                await invoke('install_modrinth_file', {
                  instanceId: newInstance.id,
                  fileUrl: file.url,
                  filename: file.filename,
                  fileType: type,
                  projectId: mid,
                  versionId: info.id,
                  name: project?.title || item.name || null,
                  iconUrl: project?.icon_url || item.icon_url || item.iconUrl || null,
                  versionName: info.name || item.version_name || item.versionName,
                  worldName: worldName
                });
              }
            } catch (e) {
              console.warn(`Failed to install ${type} ${mid}:`, e);
            }
            setLoadingProgress(20 + (completedItems / totalItems) * 75);
          }
        };

        await processItems(mods, 'mod');
        await processItems(resourcepacks, 'resourcepack');
        await processItems(shaders, 'shader');
        
        if (datapacks.length > 0) {
          // For datapacks, we create a default world since they must belong to a world
          await processItems(datapacks, 'datapack', 'Shared World');
        }

        setLoadingProgress(100);
        await loadInstances();
        setActiveTab('instances');
        showNotification(`Share code applied! Instance "${name || originalName}" created.`, 'success');
        setIsLoading(false);
        setLoadingStatus('');
        setLoadingProgress(0);
        return;
      }

      if (modLoader === 'modpack') {
        const { modpackId, versionId: modpackVersionId, modpackName, modpackIcon } = modLoaderVersion;

        setLoadingStatus(`Creating instance for ${modpackName}...`);
        setLoadingProgress(5);
        // We use a placeholder version initially, modpack installer will update it
        const newInstance = await invoke('create_instance', { name, versionId: 'pending' });

        // Set the modpack icon if available
        if (modpackIcon) {
          try {
            await invoke('set_instance_logo_from_url', {
              instanceId: newInstance.id,
              logoUrl: modpackIcon
            });
          } catch (iconError) {
            console.warn('Failed to set modpack icon:', iconError);
          }
        }

        setLoadingStatus(`Installing modpack ${modpackName}...`);
        await invoke('install_modpack', {
          instanceId: newInstance.id,
          versionId: modpackVersionId
        });

        // Now that modpack is installed, we have the real MC version.
        // We need to download it.
        const updatedInstance = await invoke('get_instance_details', { instanceId: newInstance.id });
        setLoadingStatus(`Downloading Minecraft ${updatedInstance.version_id}...`);
        await invoke('download_version', { versionId: updatedInstance.version_id });
      } else {
        // Create instance first (so it exists even if download fails)
        setLoadingStatus('Creating instance...');
        setLoadingProgress(5);
        const newInstance = await invoke('create_instance', { name, versionId });

        setLoadingStatus(`Downloading Minecraft ${versionId}...`);
        await invoke('download_version', { versionId });

        setLoadingProgress(80);

        // Install mod loader if not vanilla
        if (modLoader !== 'vanilla') {
          setLoadingStatus(`Installing ${modLoader}...`);
          setLoadingProgress(90);

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
      }

      setLoadingProgress(100);
      await loadInstances();
      setActiveTab('instances');
      showNotification(`Created instance "${name}"!`, 'success');
    } catch (error) {
      showNotification(`Failed to create instance: ${error}`, 'error');
    }
    setIsLoading(false);
    setLoadingStatus('');
    setLoadingProgress(0);
  };

  const performDeleteInstance = async (instanceId) => {
    try {
      await invoke('delete_instance', { instanceId });
      await loadInstances();
      showNotification('Instance deleted', 'success');
    } catch (error) {
      showNotification(`Failed to delete instance: ${error}`, 'error');
    }
  };

  const handleDeleteInstance = (instanceId) => {
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
  };

  const handleLaunchInstance = async (instanceId) => {
    if (runningInstances.includes(instanceId)) {
      showNotification("Instance is already running", "info");
      return;
    }
    setIsLoading(true);
    try {
      // Clear old logs first so the console doesn't show them
      try {
        await invoke('clear_instance_log', { instanceId });
      } catch (logError) {
        console.warn('Failed to clear log file:', logError);
      }

      const result = await invoke('launch_instance', { instanceId });
      showNotification(result, 'success');
      loadRunningInstances(); // Update running instances immediately
    } catch (error) {
      showNotification(`Failed to launch: ${error}`, 'error');
    }
    setIsLoading(false);
  };

  const handleStopInstance = async (instanceId) => {
    try {
      const result = await invoke('kill_game', { instanceId });
      showNotification(result, 'success');
      loadRunningInstances(); // Update running instances immediately
      loadInstances(); // Reload to get updated playtime
    } catch (error) {
      showNotification(`Failed to stop: ${error}`, 'error');
    }
  };

  const handleSetUsername = async (newUsername) => {
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
  };

  const handleLogin = async (newUsername) => {
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
  };

  const handleLogout = () => {
    setActiveAccount({ username: 'Player', isLoggedIn: false, uuid: null });
    setCurrentSkinUrl(null);
    if (activeTab === 'skins') {
      setActiveTab('instances');
    }
    showNotification('Signed out', 'success');
  };

  const handleCloseWelcome = async () => {
    if (welcomeDontShow && launcherSettings) {
      const updated = {
        ...launcherSettings,
        show_welcome: false
      };
      await invoke('save_settings', { newSettings: updated });
      setLauncherSettings(updated);
    }
    setShowWelcome(false);
  };

  const handleOpenSupport = async () => {
    try {
      await open('https://palethea.com');
    } catch (error) {
      console.error('Failed to open support link:', error);
    }
  };

  const handleSwitchAccount = async (account) => {
    try {
      await invoke('switch_account', { username: account.username });
      setActiveAccount(account);
      loadSkinForAccount(account.isLoggedIn, account.uuid);
      showNotification(`Switched to ${account.username}`, 'success');
    } catch (error) {
      showNotification(`Failed to switch account: ${error}`, 'error');
    }
  };

  const handleAddAccount = () => {
    setShowLoginPrompt(true);
  };

  const handleRemoveAccount = async (username) => {
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
  };

  const handleEditInstance = (instanceId) => {
    setEditingInstanceId(instanceId);
  };

  const handleCloseEditor = () => {
    setEditingInstanceId(null);
    loadInstances();
  };

  const renderContent = () => {
    if (editingInstanceId) {
      return (
        <InstanceEditor
          instanceId={editingInstanceId}
          onClose={handleCloseEditor}
          onUpdate={loadInstances}
          onLaunch={handleLaunchInstance}
          onStop={handleStopInstance}
          runningInstances={runningInstances}
          onShowNotification={showNotification}
          onDelete={(id) => {
            performDeleteInstance(id);
            setEditingInstanceId(null);
          }}
        />
      );
    }

    switch (activeTab) {
      case 'instances':
        return (
          <InstanceList
            instances={instances}
            onLaunch={handleLaunchInstance}
            onStop={handleStopInstance}
            onDelete={handleDeleteInstance}
            onEdit={handleEditInstance}
            onCreate={() => setActiveTab('create')}
            onContextMenu={handleInstanceContextMenu}
            isLoading={isLoading}
            runningInstances={runningInstances}
          />
        );
      case 'create':
        return (
          <CreateInstance
            onClose={() => setActiveTab('instances')}
            onCreate={handleCreateInstance}
            isLoading={isLoading}
            mode="page"
          />
        );
      case 'settings':
        return (
          <Settings
            username={activeAccount?.username || 'Player'}
            onSetUsername={handleSetUsername}
            isLoggedIn={activeAccount?.isLoggedIn || false}
            onLogin={handleLogin}
            onLogout={handleLogout}
            launcherSettings={launcherSettings}
            onSettingsUpdated={loadLauncherSettings}
          />
        );
      case 'stats':
        return <Stats />;
      case 'skins':
        return (
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
        );
      case 'updates':
        return <Updates />;
      case 'console':
        return <Console logs={logs} setLogs={setLogs} />;
      default:
        return null;
    }
  };

  return (
    <div className={`app bg-${launcherSettings?.background_style || 'gradient'}`}>
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
        {renderContent()}
      </main>

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
                    <p>Right-click any instance to assign unique color accents or update logos for a personalized collection view.</p>
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


      {notification && (
        <div className={`notification notification-${notification.type}`}>
          {notification.message}
        </div>
      )}

      {isLoading && (
        <div className="loading-overlay">
          <div className="loading-content">
            <div className="loading-spinner"></div>
            {loadingStatus && <p className="loading-status">{loadingStatus}</p>}
            <div className="progress-bar-container">
              <div
                className="progress-bar-fill"
                style={{ width: `${loadingProgress}%` }}
              />
            </div>
            <p className="loading-percentage">{Number(loadingProgress).toFixed(1)}%</p>
            {loadingBytes.total > 0 && (
              <p className="loading-bytes">
                {(loadingBytes.current / 1024 / 1024).toFixed(1)} MB / {(loadingBytes.total / 1024 / 1024).toFixed(1)} MB
              </p>
            )}
          </div>
        </div>
      )}

      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          instance={contextMenu.instance}
          onAction={handleContextMenuAction}
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
        />
      )}

      {confirmModal && (
        <ConfirmModal
          title={confirmModal.title}
          message={confirmModal.message}
          confirmText={confirmModal.confirmText}
          cancelText={confirmModal.cancelText}
          variant={confirmModal.variant}
          onConfirm={confirmModal.onConfirm}
          onCancel={confirmModal.onCancel}
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

      {isInitializing && (
        <div className="app-initializing">
          <div className="init-spinner-container">
            <div className="init-spinner"></div>
            <span className="init-text">Initializing Launcher</span>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
