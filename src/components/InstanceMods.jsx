import { useState, useEffect, useRef, useCallback, useMemo, memo } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { Trash2, RefreshCcw, Plus, Upload, Copy, Code, Loader2, ChevronDown, Check, ListFilterPlus, Play, Square, X, TriangleAlert, ShieldCheck } from 'lucide-react';
import { open } from '@tauri-apps/plugin-dialog';
import ConfirmModal from './ConfirmModal';
import ModVersionModal from './ModVersionModal';
import FilterModal from './FilterModal';
import useModrinthSearch from '../hooks/useModrinthSearch';
import { findInstalledProject, matchesSelectedCategories } from '../utils/projectBrowser';
import './FilterModal.css';

const MOD_CATEGORIES = [
  { id: 'group-categories', label: 'Categories', isSection: true },
  { id: 'adventure', label: 'Adventure' },
  { id: 'cursed', label: 'Cursed' },
  { id: 'decoration', label: 'Decoration' },
  { id: 'economy', label: 'Economy' },
  { id: 'equipment', label: 'Equipment' },
  { id: 'food', label: 'Food' },
  { id: 'game-mechanics', label: 'Game Mechanics' },
  { id: 'library', label: 'Library' },
  { id: 'magic', label: 'Magic' },
  { id: 'management', label: 'Management' },
  { id: 'minigame', label: 'Minigame' },
  { id: 'mobs', label: 'Mobs' },
  { id: 'optimization', label: 'Optimization' },
  { id: 'social', label: 'Social' },
  { id: 'storage', label: 'Storage' },
  { id: 'technology', label: 'Technology' },
  { id: 'transportation', label: 'Transportation' },
  { id: 'utility', label: 'Utility' },
  { id: 'worldgen', label: 'World Generation' },
];

function InstanceMods({
  instance,
  onShowConfirm,
  onShowNotification,
  isScrolled,
  onQueueDownload,
  onDequeueDownload,
  onUpdateDownloadStatus
}) {
  const [activeSubTab, setActiveSubTab] = useState('installed');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategories, setSelectedCategories] = useState([]);
  const [isFilterModalOpen, setIsFilterModalOpen] = useState(false);
  const [installedSearchQuery, setInstalledSearchQuery] = useState('');
  const [installedMods, setInstalledMods] = useState([]);
  const [installing, setInstalling] = useState(null);
  const [updatingMods, setUpdatingMods] = useState([]); // Array of IDs (filename/project_id) being updated
  const [loading, setLoading] = useState(true);
  const [deleteConfirm, setDeleteConfirm] = useState({ show: false, mod: null });
  const [versionModal, setVersionModal] = useState({ show: false, project: null, updateMod: null });
  const [showAddModal, setShowAddModal] = useState(false);
  const [shareCodeInput, setShareCodeInput] = useState('');
  const [applyingCode, setApplyingCode] = useState(false);
  const [applyProgress, setApplyProgress] = useState(0);
  const [applyStatus, setApplyStatus] = useState('');
  const [isCheckingUpdates, setIsCheckingUpdates] = useState(false);
  const [updatesFound, setUpdatesFound] = useState({}); // { project_id: version_obj }
  const [selectedMods, setSelectedMods] = useState([]); // Array of filenames
  const [conflictScan, setConflictScan] = useState({ scanned: false, issues: [] });
  const [scanningConflicts, setScanningConflicts] = useState(false);
  const [fixingConflictId, setFixingConflictId] = useState(null);
  const [showConflictModal, setShowConflictModal] = useState(false);
  const [isFixingAllConflicts, setIsFixingAllConflicts] = useState(false);

  const installedSearchRef = useRef(null);
  const findSearchRef = useRef(null);

  const modLoaderForSearch =
    instance.mod_loader?.toLowerCase() !== 'vanilla'
      ? instance.mod_loader?.toLowerCase()
      : null;

  const {
    searchResults,
    searching,
    loadingMore,
    searchError,
    handleSearch,
    lastElementRef,
  } = useModrinthSearch({
    projectType: 'mod',
    gameVersion: instance.version_id,
    loader: modLoaderForSearch,
    categories: selectedCategories,
    query: searchQuery,
    withPopular: false,
    searchEmptyQuery: true,
  });

  const loadInstalledMods = useCallback(async () => {
    try {
      const mods = await invoke('get_instance_mods', { instanceId: instance.id });
      setInstalledMods(mods);
    } catch (error) {
      console.error('Failed to load mods:', error);
    }
    setLoading(false);
  }, [instance.id]);

  // Effects
  useEffect(() => {
    // Reset filters when switching between tabs
    setSelectedCategories([]);
    setSearchQuery('');
  }, [activeSubTab]);

  useEffect(() => {
    loadInstalledMods();
  }, [loadInstalledMods]);

  useEffect(() => {
    setConflictScan({ scanned: false, issues: [] });
  }, [installedMods]);

  useEffect(() => {
    // Debounce search when typing, but trigger immediately for initial load
    if (activeSubTab !== 'find') return;

    const delay = (searchQuery.trim() === '' && selectedCategories.length === 0) ? 0 : 500;
    const timer = setTimeout(() => {
      handleSearch(0);
    }, delay);

    return () => clearTimeout(timer);
  }, [instance.version_id, instance.mod_loader, selectedCategories, searchQuery, activeSubTab, handleSearch]);

  useEffect(() => {
    const handleKeyDown = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
        e.preventDefault();
        if (activeSubTab === 'installed') {
          installedSearchRef.current?.focus();
        } else if (activeSubTab === 'find') {
          findSearchRef.current?.focus();
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [activeSubTab]);

  // Helpers
  // Check if a mod is installed and return the mod object
  const getInstalledMod = useCallback((project) => {
    return findInstalledProject(installedMods, project, { normalized: true });
  }, [installedMods]);

  const isModInstalled = useCallback((project) => {
    return !!getInstalledMod(project);
  }, [getInstalledMod]);

  const handleInstall = useCallback(async (project, selectedVersionMatch = null, skipDependencyCheck = false, updateMod = null) => {
    const downloadId = project.project_id || project.id || project.slug;

    // Add to global queue if not already there
    if (onQueueDownload) {
      onQueueDownload({
        id: downloadId,
        name: project.title,
        icon: project.icon_url,
        status: 'Preparing...'
      });
    }

    setInstalling(project.slug);
    if (updateMod) {
      setUpdatingMods(prev => [...prev, updateMod.project_id || updateMod.filename]);
    }

    try {
      let version = selectedVersionMatch;

      if (onUpdateDownloadStatus) {
        onUpdateDownloadStatus(downloadId, 'Fetching version...');
      }

      if (!version) {
        const versions = await invoke('get_modrinth_versions', {
          projectId: project.slug,
          gameVersion: instance.version_id,
          loader: instance.mod_loader?.toLowerCase() || null
        });

        if (versions.length === 0) {
          alert('No compatible version found for this mod');
          setInstalling(null);
          return;
        }

        version = versions[0];
      }

      // Check for dependencies (recursive)
      if (!skipDependencyCheck && version.dependencies && version.dependencies.length > 0) {
        const dependencyInfo = [];
        let hasNewDependencies = false;
        const visitedIds = new Map(); // id -> type

        // Add current project to visited to prevent circular dependencies
        if (project.project_id) visitedIds.set(project.project_id, 'required');
        if (project.id) visitedIds.set(project.id, 'required');
        if (project.slug) visitedIds.set(project.slug, 'required');

        const resolveDeps = async (deps, parentType = 'required') => {
          for (const dep of deps) {
            if (!dep.project_id) continue;

            const currentDepType = (dep.dependency_type === 'optional' || parentType === 'optional') ? 'optional' : 'required';

            if (visitedIds.has(dep.project_id)) {
              // If we already visited it, check if we need to upgrade it from optional to required
              if (currentDepType === 'required' && visitedIds.get(dep.project_id) === 'optional') {
                visitedIds.set(dep.project_id, 'required');
                const existing = dependencyInfo.find(d => (d.project.project_id || d.project.id || d.project.slug) === dep.project_id);
                if (existing) {
                  existing.type = 'required';
                  // Recursively check dependencies again with 'required' parent type to upgrade them too
                  if (existing.version?.dependencies) {
                    await resolveDeps(existing.version.dependencies, 'required');
                  }
                }
              }
              continue;
            }

            // Only process required or optional
            if (dep.dependency_type !== 'required' && dep.dependency_type !== 'optional') continue;

            visitedIds.set(dep.project_id, currentDepType);

            try {
              const depProject = await invoke('get_modrinth_project', { projectId: dep.project_id });
              const installed = isModInstalled(depProject);

              if (!installed) {
                hasNewDependencies = true;

                // Find compatible version for this dependency
                const depVersions = await invoke('get_modrinth_versions', {
                  projectId: depProject.slug,
                  gameVersion: instance.version_id,
                  loader: instance.mod_loader?.toLowerCase() !== 'vanilla' ? instance.mod_loader?.toLowerCase() : null
                });

                if (depVersions.length > 0) {
                  const depVersion = depVersions[0];
                  dependencyInfo.push({
                    project: depProject,
                    version: depVersion,
                    type: currentDepType,
                    installed: false
                  });
                  // Recursively check for dependencies of THIS dependency
                  if (depVersion.dependencies && depVersion.dependencies.length > 0) {
                    await resolveDeps(depVersion.dependencies, currentDepType);
                  }
                }
              } else {
                dependencyInfo.push({
                  project: depProject,
                  type: currentDepType,
                  installed: true
                });
              }
            } catch (e) {
              console.error('Failed to fetch dependency metadata:', e);
            }
          }
        };

        await resolveDeps(version.dependencies);

        const requiredDeps = dependencyInfo.filter(d => d.type === 'required');
        const optionalDeps = dependencyInfo.filter(d => d.type === 'optional');

        if (hasNewDependencies) {
          setInstalling(null);
          // Remove self from queue if we are showing dependency prompt
          if (onDequeueDownload) onDequeueDownload(downloadId, false);

          const dependencyMessage = (
            <div className="dependency-confirm-list">
              <p className="dep-intro-text">{project.title} has dependencies:</p>
              {requiredDeps.length > 0 && (
                <div className="dep-confirm-group">
                  <label>Required</label>
                  {requiredDeps.map(d => (
                    <div key={d.project.project_id || d.project.id} className={`dep-confirm-item ${d.installed ? 'already-installed' : ''}`}>
                      {d.project.icon_url ? (
                        <img src={d.project.icon_url} alt="" className="dep-confirm-icon" referrerPolicy="no-referrer" />
                      ) : (
                        <div className="dep-confirm-icon mod-icon-placeholder">📦</div>
                      )}
                      <span>{d.project.title}</span>
                      {d.installed && <Check size={16} className="dep-installed-tick" />}
                    </div>
                  ))}
                </div>
              )}
              {optionalDeps.length > 0 && (
                <div className="dep-confirm-group">
                  <label>Optional</label>
                  {optionalDeps.map(d => (
                    <div key={d.project.project_id || d.project.id} className={`dep-confirm-item ${d.installed ? 'already-installed' : ''}`}>
                      {d.project.icon_url ? (
                        <img src={d.project.icon_url} alt="" className="dep-confirm-icon" referrerPolicy="no-referrer" />
                      ) : (
                        <div className="dep-confirm-icon mod-icon-placeholder">📦</div>
                      )}
                      <span>{d.project.title}</span>
                      {d.installed && <Check size={16} className="dep-installed-tick" />}
                    </div>
                  ))}
                </div>
              )}
              <p className="dep-ask-text">Would you like to install the missing ones?</p>
            </div>
          );

          // If there are optional dependencies, offer "Required Only" vs "Install All"
          const uninstalledRequired = requiredDeps.filter(d => !d.installed);
          const uninstalledOptional = optionalDeps.filter(d => !d.installed);

          onShowConfirm({
            title: 'Install Dependencies',
            message: dependencyMessage,
            confirmText: uninstalledOptional.length > 0 ? 'Install All' : 'Install Required',
            extraConfirmText: (uninstalledRequired.length > 0 && uninstalledOptional.length > 0) ? 'Required Only' : null,
            cancelText: 'Skip All',
            variant: 'primary',
            onConfirm: async () => {
              // Install all dependencies (required + optional) that aren't installed
              // Reverse the list to install deep dependencies first
              const toInstall = [...requiredDeps, ...optionalDeps].filter(d => !d.installed).reverse();

              // Add all to queue at once so user sees the full list
              if (onQueueDownload) {
                for (const d of toInstall) {
                  onQueueDownload({
                    id: d.project.project_id || d.project.id || d.project.slug,
                    name: d.project.title,
                    icon: d.project.icon_url,
                    status: 'Queued'
                  });
                }
                onQueueDownload({
                  id: project.project_id || project.id || project.slug,
                  name: project.title,
                  icon: project.icon_url,
                  status: 'Queued'
                });
              }

              for (const d of toInstall) {
                await handleInstall(d.project, d.version, true);
              }
              await handleInstall(project, version, true, updateMod);
            },
            onExtraConfirm: async () => {
              // Install only required that aren't installed
              const toInstall = requiredDeps.filter(d => !d.installed).reverse();

              // Add all to queue
              if (onQueueDownload) {
                for (const d of toInstall) {
                  onQueueDownload({
                    id: d.project.project_id || d.project.id || d.project.slug,
                    name: d.project.title,
                    icon: d.project.icon_url,
                    status: 'Queued'
                  });
                }
                onQueueDownload({
                  id: project.project_id || project.id || project.slug,
                  name: project.title,
                  icon: project.icon_url,
                  status: 'Queued'
                });
              }

              for (const d of toInstall) {
                await handleInstall(d.project, d.version, true);
              }
              await handleInstall(project, version, true, updateMod);
            },
            onCancel: async () => {
              // Install without any dependencies
              await handleInstall(project, version, true, updateMod);
            }
          });
          return;
        }
      }

      const file = version.files.find(f => f.primary) || version.files[0];

      if (onUpdateDownloadStatus) {
        onUpdateDownloadStatus(downloadId, 'Downloading...');
      }

      await invoke('install_modrinth_file', {
        instanceId: instance.id,
        fileUrl: file.url,
        filename: file.filename,
        fileType: 'mod',
        projectId: project.project_id || project.slug,
        versionId: version.id,
        name: project.title,
        author: project.author,
        iconUrl: project.icon_url,
        versionName: version.version_number,
        categories: project.categories || project.display_categories || (updateMod ? updateMod.categories : null) || null
      });

      // If this was an update and the new file name is different, delete the old one
      if (updateMod && updateMod.filename !== file.filename) {
        try {
          await invoke('delete_instance_mod', {
            instanceId: instance.id,
            filename: updateMod.filename
          });
        } catch (deleteError) {
          console.error('Failed to delete old mod version:', deleteError);
        }
      }

      await loadInstalledMods();
    } catch (error) {
      console.error('Failed to install mod:', error);
      alert('Failed to install mod: ' + error);
    } finally {
      setInstalling(null);
      if (onDequeueDownload) {
        // Short delay so user can see it finished if it was fast
        setTimeout(() => onDequeueDownload(downloadId), 1000);
      }
      if (updateMod) {
        setUpdatingMods(prev => prev.filter(f => f !== (updateMod.project_id || updateMod.filename)));
      }
    }
  }, [instance.id, instance.version_id, instance.mod_loader, isModInstalled, loadInstalledMods, onShowConfirm]);

  const handleToggle = useCallback(async (mod) => {
    try {
      await invoke('toggle_instance_mod', {
        instanceId: instance.id,
        filename: mod.filename
      });
      await loadInstalledMods();
    } catch (error) {
      console.error('Failed to toggle mod:', error);
    }
  }, [instance.id, loadInstalledMods]);

  const scanConflicts = useCallback(async ({ silent = false } = {}) => {
    setScanningConflicts(true);
    try {
      const issues = await invoke('scan_mod_conflicts', { instanceId: instance.id });
      const normalizedIssues = Array.isArray(issues) ? issues : [];
      setConflictScan({
        scanned: true,
        issues: normalizedIssues
      });
      if (!silent && onShowNotification) {
        if (normalizedIssues.length > 0) {
          onShowNotification(`Found ${normalizedIssues.length} potential conflict${normalizedIssues.length > 1 ? 's' : ''}`, 'info');
        } else {
          onShowNotification('No mod conflicts detected.', 'success');
        }
      }
      return normalizedIssues;
    } catch (error) {
      console.error('Failed to scan mod conflicts:', error);
      if (!silent && onShowNotification) {
        onShowNotification(`Failed to scan conflicts: ${error}`, 'error');
      }
      return null;
    } finally {
      setScanningConflicts(false);
    }
  }, [instance.id, onShowNotification]);

  const openConflictScanner = useCallback(() => {
    setShowConflictModal(true);
    if (!conflictScan.scanned && !scanningConflicts) {
      scanConflicts({ silent: true });
    }
  }, [conflictScan.scanned, scanningConflicts, scanConflicts]);

  const applyConflictFix = useCallback(async (issue, { notify = true } = {}) => {
    if (!issue || !issue.fix_action) return false;

    if (issue.fix_action === 'disable_duplicates' && issue.project_id) {
      const duplicateMods = installedMods.filter((m) => m.enabled && m.project_id === issue.project_id);
      for (const mod of duplicateMods.slice(1)) {
        await invoke('toggle_instance_mod', {
          instanceId: instance.id,
          filename: mod.filename
        });
      }
      if (notify) {
        onShowNotification?.('Disabled duplicate files for that project.', 'success');
      }
      return true;
    }

    if (issue.fix_action === 'install_missing_dependency' && issue.missing_project_id) {
      const depProject = await invoke('get_modrinth_project', { projectId: issue.missing_project_id });
      const depVersions = await invoke('get_modrinth_versions', {
        projectId: depProject.slug || depProject.project_id || issue.missing_project_id,
        gameVersion: instance.version_id,
        loader: instance.mod_loader?.toLowerCase() || null
      });

      if (!Array.isArray(depVersions) || depVersions.length === 0) {
        throw new Error('No compatible dependency version found');
      }

      const depVersion = depVersions[0];
      const depFile = depVersion.files?.find(f => f.primary) || depVersion.files?.[0];
      if (!depFile) {
        throw new Error('Dependency version has no downloadable file');
      }

      await handleInstall(depProject, depVersion, true);
      if (notify) {
        onShowNotification?.(`Installed dependency: ${depProject.title}`, 'success');
      }
      return true;
    }

    return false;
  }, [installedMods, instance.id, instance.version_id, instance.mod_loader, handleInstall, onShowNotification]);

  const handleFixConflict = useCallback(async (issue) => {
    if (!issue || !issue.fix_action) return;

    setFixingConflictId(issue.id);
    try {
      await applyConflictFix(issue, { notify: true });

      await loadInstalledMods();
      await scanConflicts({ silent: true });
    } catch (error) {
      console.error('Failed to auto-fix mod conflict:', error);
      onShowNotification?.(`Failed to apply fix: ${error}`, 'error');
    } finally {
      setFixingConflictId(null);
    }
  }, [loadInstalledMods, onShowNotification, scanConflicts, applyConflictFix]);

  const handleFixAllConflicts = useCallback(async () => {
    const actionableIssues = conflictScan.issues.filter((issue) => !!issue.fix_action);
    if (actionableIssues.length === 0) return;

    setIsFixingAllConflicts(true);
    let appliedCount = 0;
    let failedCount = 0;
    const processedKeys = new Set();

    try {
      for (const issue of actionableIssues) {
        const dedupeKey = issue.fix_action === 'install_missing_dependency'
          ? `dep:${issue.missing_project_id || issue.id}`
          : issue.fix_action === 'disable_duplicates'
            ? `dupe:${issue.project_id || issue.id}`
            : `${issue.fix_action}:${issue.id}`;

        if (processedKeys.has(dedupeKey)) {
          continue;
        }
        processedKeys.add(dedupeKey);
        setFixingConflictId(issue.id);

        try {
          const applied = await applyConflictFix(issue, { notify: false });
          if (applied) {
            appliedCount += 1;
          }
        } catch (e) {
          failedCount += 1;
          console.error(`Failed to apply conflict fix for issue ${issue.id}:`, e);
        }
      }

      await loadInstalledMods();
      await scanConflicts({ silent: true });

      if (appliedCount > 0) {
        onShowNotification?.(`Applied ${appliedCount} conflict fix${appliedCount > 1 ? 'es' : ''}.`, 'success');
      }
      if (failedCount > 0) {
        onShowNotification?.(`${failedCount} fix${failedCount > 1 ? 'es' : ''} failed. Check issue list for details.`, 'error');
      }
    } finally {
      setFixingConflictId(null);
      setIsFixingAllConflicts(false);
    }
  }, [conflictScan.issues, applyConflictFix, loadInstalledMods, scanConflicts, onShowNotification]);

  const handleRequestInstall = useCallback(async (project, updateMod = null) => {
    setVersionModal({ show: true, project, updateMod: updateMod });
  }, []);

  const handleDelete = useCallback(async (mod) => {
    setDeleteConfirm({ show: false, mod }); // Close if open
    setDeleteConfirm({ show: true, mod });
  }, []);

  const handleImportFile = useCallback(async () => {
    try {
      const selected = await open({
        multiple: true,
        filters: [{
          name: 'JAR Files',
          extensions: ['jar']
        }]
      });

      if (selected && selected.length > 0) {
        for (const path of selected) {
          await invoke('import_instance_file', {
            instanceId: instance.id,
            sourcePath: path,
            folderType: 'mods'
          });
        }
        await loadInstalledMods();
        if (onShowNotification) {
          onShowNotification(`Imported ${selected.length} mod${selected.length > 1 ? 's' : ''}`, 'success');
        }
      }
    } catch (error) {
      console.error('Failed to import mods:', error);
      if (onShowNotification) {
        onShowNotification('Failed to import mods: ' + error, 'error');
      }
    }
  }, [instance.id, loadInstalledMods, onShowNotification]);

  const handleCheckUpdate = useCallback((mod) => {
    if (!mod.project_id) return;
    setVersionModal({
      show: true,
      projectId: mod.project_id,
      updateMod: mod,
      project: {
        title: mod.name,
        icon_url: mod.icon_url,
        slug: mod.project_id,
        categories: mod.categories
      }
    });
  }, []);

  const handleBulkCheckUpdates = useCallback(async () => {
    const modrinthMods = installedMods.filter(m => m.enabled && m.provider === 'Modrinth' && m.project_id);
    if (modrinthMods.length === 0) return;

    setIsCheckingUpdates(true);
    try {
      const rows = await invoke('get_instance_mod_updates', { instanceId: instance.id });
      const updates = {};
      for (const row of Array.isArray(rows) ? rows : []) {
        if (row?.project_id && row?.latest_version) {
          updates[row.project_id] = row.latest_version;
        }
      }

      setUpdatesFound(updates);
      if (onShowNotification) {
        const count = Object.keys(updates).length;
        if (count > 0) {
          onShowNotification(`Found updates for ${count} mod${count > 1 ? 's' : ''}!`, 'info');
        } else {
          onShowNotification('All mods are up to date.', 'success');
        }
      }
    } catch (error) {
      console.error('Bulk update check failed:', error);
    } finally {
      setIsCheckingUpdates(false);
    }
  }, [installedMods, instance.id, onShowNotification]);

  const handleUpdateAll = useCallback(async () => {
    const modsToUpdate = installedMods.filter(m => updatesFound[m.project_id]);
    if (modsToUpdate.length === 0) return;

    onShowConfirm({
      title: 'Update All Mods',
      message: `Would you like to update ${modsToUpdate.length} mods to their latest versions?`,
      confirmText: 'Update All',
      cancelText: 'Cancel',
      variant: 'primary',
      onConfirm: async () => {
        for (const mod of modsToUpdate) {
          const latestVersion = updatesFound[mod.project_id];
          if (!latestVersion) continue;

          try {
            // Get project info for handleInstall
            const project = await invoke('get_modrinth_project', { projectId: mod.project_id });
            // Use skipDependencyCheck = true for bulk updates to avoid multiple modals
            await handleInstall(project, latestVersion, true, mod);
          } catch (error) {
            console.error(`Failed to update ${mod.name}:`, error);
          }
        }
        setUpdatesFound({});
        onShowNotification?.('Completed bulk updates', 'info');
      }
    });
  }, [installedMods, updatesFound, onShowConfirm, handleInstall, onShowNotification]);

  const handleCopyModsCode = useCallback(async () => {
    try {
      const code = await invoke('get_instance_mods_share_code', { instanceId: instance.id });
      await navigator.clipboard.writeText(code);
      if (onShowNotification) {
        onShowNotification('Mods code copied to clipboard!', 'success');
      }
    } catch (error) {
      console.error('Failed to copy mods code:', error);
      if (onShowNotification) {
        onShowNotification(`Failed to copy mods code: ${error}`, 'error');
      }
    }
  }, [instance.id, onShowNotification]);

  const handleApplyCode = useCallback(async () => {
    if (!shareCodeInput.trim()) return;

    setApplyingCode(true);
    setApplyProgress(0);
    setApplyStatus('Decoding share code...');

    try {
      const shareData = await invoke('decode_instance_share_code', { code: shareCodeInput.trim() });
      const mods = shareData.mods || [];

      if (mods.length === 0) {
        if (onShowNotification) {
          onShowNotification('No mods found in this code.', 'info');
        }
        setApplyingCode(false);
        return;
      }

      setApplyStatus(`Found ${mods.length} mods. Fetching metadata...`);
      setApplyProgress(10);

      // Pre-fetch metadata if possible
      let projectMap = {};
      const projectIds = mods.map(m => m.project_id || m.projectId).filter(Boolean);
      try {
        if (projectIds.length > 0) {
          const projects = await invoke('get_modrinth_projects', { projectIds });
          projects.forEach(p => {
            const id = p.project_id || p.id;
            if (id) projectMap[id] = p;
            if (p.slug) projectMap[p.slug] = p;
          });
        }
      } catch (e) {
        console.warn('Bulk fetch failed:', e);
      }

      let installedCount = 0;
      for (let i = 0; i < mods.length; i++) {
        const mod = mods[i];
        try {
          const mid = mod.project_id || mod.projectId;
          const vid = mod.version_id || mod.versionId;

          const currentModName = mod.name || mid;
          setApplyStatus(`Installing ${currentModName} (${i + 1}/${mods.length})...`);
          setApplyProgress(10 + ((i / mods.length) * 90));

          // Skip if already installed
          if (installedMods.some(m => m.project_id === mid)) {
            installedCount++;
            continue;
          }

          let info;
          if (vid) {
            info = await invoke('get_modrinth_version', { versionId: vid });
          } else {
            const versions = await invoke('get_modrinth_versions', {
              projectId: mid,
              gameVersion: instance.version_id,
              loader: instance.mod_loader?.toLowerCase() || null
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

            const file = info.files.find(f => f.primary) || info.files[0];

            await invoke('install_modrinth_file', {
              instanceId: instance.id,
              fileUrl: file.url,
              filename: file.filename,
              fileType: 'mod',
              projectId: mid,
              versionId: info.id,
              name: project?.title || mod.name || null,
              author: project?.author || mod.author || null,
              iconUrl: project?.icon_url || mod.icon_url || mod.iconUrl || null,
              versionName: info.name || mod.version_name || mod.versionName,
              categories: project?.categories || project?.display_categories || mod.categories || null
            });
            installedCount++;
          }
        } catch (e) {
          console.error(`Failed to install mod ${mod.project_id || mod.projectId}:`, e);
        }
      }

      setApplyProgress(100);
      if (onShowNotification) {
        onShowNotification(`Successfully installed ${installedCount} mods!`, 'success');
      }
      setTimeout(() => {
        setShowAddModal(false);
        setShareCodeInput('');
        setApplyingCode(false);
        setApplyProgress(0);
        setApplyStatus('');
        loadInstalledMods();
      }, 500);
      return;
    } catch (error) {
      console.error('Failed to apply code:', error);
      if (onShowNotification) {
        onShowNotification('Invalid or incompatible mods code.', 'error');
      }
    }
    setApplyingCode(false);
    setApplyProgress(0);
    setApplyStatus('');
  }, [shareCodeInput, instance.id, instance.version_id, instance.mod_loader, installedMods, onShowNotification, loadInstalledMods]);

  const handleOpenFolder = useCallback(async () => {
    try {
      await invoke('open_instance_folder', {
        instanceId: instance.id,
        folderType: 'mods'
      });
    } catch (error) {
      console.error('Failed to open folder:', error);
      if (onShowNotification) {
        onShowNotification(`Failed to open mods folder: ${error}`, 'error');
      }
    }
  }, [instance.id, onShowNotification]);

  const handleOpenConfigFolder = useCallback(async () => {
    try {
      await invoke('open_instance_folder', {
        instanceId: instance.id,
        folderType: 'config'
      });
    } catch (error) {
      console.error('Failed to open folder:', error);
      if (onShowNotification) {
        onShowNotification(`Failed to open config folder: ${error}`, 'error');
      }
    }
  }, [instance.id, onShowNotification]);

  const confirmDelete = useCallback(async () => {
    const mod = deleteConfirm.mod;
    setDeleteConfirm({ show: false, mod: null });

    try {
      await invoke('delete_instance_mod', {
        instanceId: instance.id,
        filename: mod.filename
      });
      await loadInstalledMods();
    } catch (error) {
      console.error('Failed to delete mod:', error);
    }
  }, [instance.id, deleteConfirm.mod, loadInstalledMods]);

  const formatDownloads = useCallback((num) => {
    if (num >= 1000000) return (num / 1000000).toFixed(1) + 'M';
    if (num >= 1000) return (num / 1000).toFixed(1) + 'K';
    return num.toString();
  }, []);

  const formatFileSize = useCallback((bytes) => {
    if (!bytes || bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }, []);

  const getLoaderBadges = useCallback((categories) => {
    if (!categories) return [];
    const loadersList = [];
    if (categories.includes('fabric')) loadersList.push('Fabric');
    if (categories.includes('forge')) loadersList.push('Forge');
    if (categories.includes('neoforge')) loadersList.push('NeoForge');
    if (categories.includes('quilt')) loadersList.push('Quilt');
    return loadersList;
  }, []);

  const filteredInstalledMods = useMemo(() => {
    return installedMods.filter(m => {
      // Filter by search query
      const matchesSearch = !installedSearchQuery.trim() ||
        (m.name || '').toLowerCase().includes(installedSearchQuery.toLowerCase()) ||
        (m.filename || '').toLowerCase().includes(installedSearchQuery.toLowerCase());

      // Filter by categories
      const matchesCategories = selectedCategories.length === 0 ||
        (m.categories && selectedCategories.every(cat => m.categories.includes(cat)));

      return matchesSearch && matchesCategories;
    });
  }, [installedMods, installedSearchQuery, selectedCategories]);

  const modrinthMods = useMemo(() => {
    return filteredInstalledMods
      .filter(m => m.provider === 'Modrinth')
      .sort((a, b) => (a.name || a.filename).localeCompare(b.name || b.filename));
  }, [filteredInstalledMods]);

  const manualMods = useMemo(() => {
    return filteredInstalledMods
      .filter(m => m.provider !== 'Modrinth')
      .sort((a, b) => (a.name || a.filename).localeCompare(b.name || b.filename));
  }, [filteredInstalledMods]);

  const handleToggleSelect = useCallback((filename) => {
    setSelectedMods(prev =>
      prev.includes(filename)
        ? prev.filter(f => f !== filename)
        : [...prev, filename]
    );
  }, []);

  const handleSelectAll = useCallback(() => {
    if (selectedMods.length > 0 && selectedMods.length === filteredInstalledMods.length) {
      setSelectedMods([]);
    } else {
      setSelectedMods(filteredInstalledMods.map(m => m.filename));
    }
  }, [selectedMods.length, filteredInstalledMods]);

  const handleDeleteSelected = useCallback(() => {
    if (selectedMods.length === 0) return;

    onShowConfirm({
      title: 'Delete Selected Mods?',
      message: `Are you sure you want to delete ${selectedMods.length} selected mods? This cannot be undone.`,
      confirmText: 'Delete All',
      cancelText: 'Cancel',
      variant: 'danger',
      onConfirm: async () => {
        setLoading(true);
        try {
          for (const filename of selectedMods) {
            await invoke('delete_instance_mod', { instanceId: instance.id, filename });
          }
          setSelectedMods([]);
          await loadInstalledMods();
          onShowNotification(`Successfully deleted ${selectedMods.length} mods.`, 'success');
        } catch (error) {
          console.error('Failed to delete mods:', error);
          onShowNotification('Failed to delete some mods.', 'error');
        }
        setLoading(false);
      }
    });
  }, [selectedMods, instance.id, onShowConfirm, loadInstalledMods, onShowNotification]);

  const handleToggleSelected = useCallback(async (enable) => {
    if (selectedMods.length === 0) return;

    setLoading(true);
    try {
      for (const filename of selectedMods) {
        const mod = installedMods.find(m => m.filename === filename);
        if (mod && mod.enabled !== enable) {
          await invoke('toggle_instance_mod', { instanceId: instance.id, filename });
        }
      }
      setSelectedMods([]);
      await loadInstalledMods();
      onShowNotification(`Successfully ${enable ? 'enabled' : 'disabled'} ${selectedMods.length} mods.`, 'success');
    } catch (error) {
      console.error('Failed to toggle mods:', error);
      onShowNotification('Failed to toggle some mods.', 'error');
    }
    setLoading(false);
  }, [selectedMods, installedMods, instance.id, loadInstalledMods, onShowNotification]);

  if (instance.mod_loader === 'Vanilla' || !instance.mod_loader) {
    return (
      <div className="mods-tab">
        <div className="empty-state">
          <h4>Mods require a mod loader</h4>
          <p>Go to Settings and install Fabric, Forge, or NeoForge to use mods.</p>
        </div>
      </div>
    );
  }

  const matchesAllSelectedCategories = useCallback((project) => {
    return matchesSelectedCategories(project, selectedCategories);
  }, [selectedCategories]);

  const displayMods = useMemo(
    () => searchResults.filter(matchesAllSelectedCategories),
    [searchResults, matchesAllSelectedCategories]
  );

  return (
    <div className="mods-tab">
      <div className={`sub-tabs-row ${isScrolled ? 'scrolled' : ''}`}>
        <div className="sub-tabs">
          <button
            className={`sub-tab ${activeSubTab === 'installed' ? 'active' : ''}`}
            onClick={() => setActiveSubTab('installed')}
          >
            Installed ({installedMods.length})
          </button>
          <button
            className={`sub-tab ${activeSubTab === 'find' ? 'active' : ''}`}
            onClick={() => setActiveSubTab('find')}
          >
            Find Mods
          </button>
        </div>
        <div className="sub-tabs-actions">
          {activeSubTab === 'installed' && (
            <>
              <button className="open-folder-btn" onClick={() => setShowAddModal(true)} title="Add Mod">
                <Plus size={16} />
                <span>Add Mod</span>
              </button>
              <button className="open-folder-btn" onClick={handleOpenFolder}>
                📁 Folder
              </button>
              <button className="open-folder-btn" onClick={handleOpenConfigFolder}>
                ⚙️ Configs
              </button>
            </>
          )}
        </div>
      </div>

      <FilterModal
        isOpen={isFilterModalOpen}
        onClose={() => setIsFilterModalOpen(false)}
        categories={MOD_CATEGORIES}
        selectedCategories={selectedCategories}
        onApply={setSelectedCategories}
        title="Mod Categories"
      />

      {activeSubTab === 'installed' ? (
        <div className="installed-section">
          {installedMods.length > 0 && (
            <div className="search-controls-refined">
              <button
                className={`filter-btn-modal ${selectedCategories.length > 0 ? 'active' : ''}`}
                onClick={() => setIsFilterModalOpen(true)}
                title="Filter Categories"
              >
                <ListFilterPlus size={18} />
                <span>Filters</span>
                {selectedCategories.length > 0 && (
                  <span className="filter-count">{selectedCategories.length}</span>
                )}
              </button>

              <div className="search-input-wrapper-refined">
                <div className="search-box-wide">
                  <input
                    ref={installedSearchRef}
                    type="text"
                    placeholder="Search installed mods... (Ctrl+F)"
                    value={installedSearchQuery}
                    onChange={(e) => setInstalledSearchQuery(e.target.value)}
                  />
                  {installedSearchQuery && (
                    <button className="clear-search-btn" onClick={() => setInstalledSearchQuery('')} title="Clear search">
                      <X size={14} />
                    </button>
                  )}
                </div>
              </div>

              <button className="search-btn" onClick={() => installedSearchRef.current?.focus()}>
                Search
              </button>
            </div>
          )}

          {loading ? (
            <p>Loading...</p>
          ) : installedMods.length === 0 ? (
            <div className="empty-state">
              <p>No mods installed. Go to "Find Mods" to browse and install mods.</p>
            </div>
          ) : filteredInstalledMods.length === 0 ? (
            <div className="empty-state">
              <p>No mods matching your filters {installedSearchQuery ? `("${installedSearchQuery}")` : ''}</p>
              <button
                className="text-btn"
                onClick={() => {
                  setInstalledSearchQuery('');
                  setSelectedCategories([]);
                }}
              >
                Clear all filters
              </button>
            </div>
          ) : (
            <div className="mods-container">
              {modrinthMods.length > 0 && (
                <div className="mod-group">
                  <div className="group-header">
                    <h3 className="group-title">Modrinth</h3>
                    <div className="group-header-line"></div>
                    <button className="select-all-btn-inline" onClick={handleSelectAll}>
                      <div className={`selection-checkbox mini ${selectedMods.length === filteredInstalledMods.length && filteredInstalledMods.length > 0 ? 'checked' : ''}`}>
                        {selectedMods.length === filteredInstalledMods.length && filteredInstalledMods.length > 0 && <Check size={10} />}
                      </div>
                      <span>{selectedMods.length === filteredInstalledMods.length && filteredInstalledMods.length > 0 ? 'Deselect All' : 'Select All'}</span>
                    </button>
                    <button
                      className={`check-updates-btn-inline ${isCheckingUpdates ? 'loading' : ''}`}
                      onClick={handleBulkCheckUpdates}
                      disabled={isCheckingUpdates}
                    >
                      {isCheckingUpdates ? <Loader2 size={12} className="spin" /> : <RefreshCcw size={12} />}
                      <span>Check Updates</span>
                      {Object.keys(updatesFound).length > 0 && (
                        <span className="update-badge pulse">{Object.keys(updatesFound).length}</span>
                      )}
                    </button>
                    {Object.keys(updatesFound).length > 0 && (
                      <button
                        className="update-all-btn-inline"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleUpdateAll();
                        }}
                        title="Update All"
                      >
                        Update All
                      </button>
                    )}
                    <button className="copy-code-btn" onClick={handleCopyModsCode} title="Copy Mods Share Code">
                      <Copy size={12} />
                      <span>Copy Code</span>
                    </button>
                  </div>
                  <div className="installed-list">
                    {modrinthMods.map((mod) => {
                      const isUpdating = updatingMods.includes(mod.project_id || mod.filename);
                      const isSelected = selectedMods.includes(mod.filename);
                      return (
                        <div
                          key={mod.filename}
                          className={`installed-item ${!mod.enabled ? 'disabled' : ''} ${isUpdating ? 'mod-updating' : ''} ${isSelected ? 'selected' : ''}`}
                          onClick={() => {
                            if (selectedMods.length > 0) {
                              handleToggleSelect(mod.filename);
                            }
                          }}
                        >
                          {isUpdating && (
                            <div className="mod-updating-overlay">
                              <RefreshCcw className="spin-icon" size={20} />
                              <span>Updating...</span>
                            </div>
                          )}
                          <div className="item-main">
                            <div className="item-selection" onClick={(e) => { e.stopPropagation(); handleToggleSelect(mod.filename); }}>
                              <div className={`selection-checkbox ${isSelected ? 'checked' : ''}`}>
                                {isSelected && <Check size={12} />}
                              </div>
                            </div>
                            <div
                              className={`item-toggle ${mod.enabled ? 'enabled' : ''}`}
                              onClick={(e) => { e.stopPropagation(); !isUpdating && handleToggle(mod); }}
                              title={mod.enabled ? "Disable Mod" : "Enable Mod"}
                            />
                            {mod.icon_url ? (
                              <img src={mod.icon_url} alt="" className="mod-icon-small" referrerPolicy="no-referrer" />
                            ) : (
                              <div className="mod-icon-placeholder">📦</div>
                            )}
                            <div
                              className="item-info clickable"
                              onClick={(e) => {
                                if (selectedMods.length > 0) {
                                  e.stopPropagation();
                                  handleToggleSelect(mod.filename);
                                } else {
                                  handleCheckUpdate(mod);
                                }
                              }}
                            >
                              <div className="item-title-row">
                                <h4>{mod.name || mod.filename}</h4>
                                {mod.version && <span className="mod-version-tag">v{mod.version}</span>}
                                {updatesFound[mod.project_id] && (
                                  <span className="update-available-tag pulse">Update Available</span>
                                )}
                              </div>
                              <div className="item-meta-row">
                                <span className="mod-provider">{mod.provider}</span>
                                <span className="mod-separator">•</span>
                                <span className="mod-size">{formatFileSize(mod.size)}</span>
                              </div>
                            </div>
                          </div>
                          <div className="item-actions">
                            <button
                              className="update-btn-simple"
                              onClick={(e) => { e.stopPropagation(); handleCheckUpdate(mod); }}
                              title="Check for updates"
                              disabled={isUpdating}
                            >
                              <RefreshCcw size={14} />
                            </button>
                            <button
                              className="delete-btn-simple"
                              onClick={(e) => { e.stopPropagation(); handleDelete(mod); }}
                              title="Delete mod"
                              disabled={isUpdating}
                            >
                              <Trash2 size={16} />
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {manualMods.length > 0 && (
                <div className="mod-group">
                  <div className="group-header">
                    <h3 className="group-title">Other</h3>
                    <div className="group-header-line"></div>
                  </div>
                  <div className="installed-list">
                    {manualMods.map((mod) => {
                      const isUpdating = updatingMods.includes(mod.project_id || mod.filename);
                      const isSelected = selectedMods.includes(mod.filename);
                      return (
                        <div
                          key={mod.filename}
                          className={`installed-item ${!mod.enabled ? 'disabled' : ''} ${isUpdating ? 'mod-updating' : ''} ${isSelected ? 'selected' : ''}`}
                          onClick={() => {
                            if (selectedMods.length > 0) {
                              handleToggleSelect(mod.filename);
                            }
                          }}
                        >
                          {isUpdating && (
                            <div className="mod-updating-overlay">
                              <RefreshCcw className="spin-icon" size={20} />
                              <span>Updating...</span>
                            </div>
                          )}
                          <div className="item-main">
                            <div className="item-selection" onClick={(e) => { e.stopPropagation(); handleToggleSelect(mod.filename); }}>
                              <div className={`selection-checkbox ${isSelected ? 'checked' : ''}`}>
                                {isSelected && <Check size={12} />}
                              </div>
                            </div>
                            <div
                              className={`item-toggle ${mod.enabled ? 'enabled' : ''}`}
                              onClick={(e) => { e.stopPropagation(); !isUpdating && handleToggle(mod); }}
                              title={mod.enabled ? "Disable Mod" : "Enable Mod"}
                            />
                            <div className="mod-icon-placeholder">📦</div>
                            <div
                              className="item-info clickable"
                              onClick={(e) => {
                                if (selectedMods.length > 0) {
                                  e.stopPropagation();
                                  handleToggleSelect(mod.filename);
                                }
                              }}
                            >
                              <div className="item-title-row">
                                <h4>{mod.name || mod.filename}</h4>
                              </div>
                              <div className="item-meta-row">
                                <span className="mod-provider manual">Manual</span>
                                <span className="mod-separator">•</span>
                                <span className="mod-size">{formatFileSize(mod.size)}</span>
                              </div>
                            </div>
                          </div>
                          <div className="item-actions">
                            <button
                              className="delete-btn-simple"
                              onClick={(e) => { e.stopPropagation(); handleDelete(mod); }}
                              title="Delete mod"
                              disabled={isUpdating}
                            >
                              <Trash2 size={16} />
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          )}

          {selectedMods.length > 0 && (
            <div className="bulk-actions-wrapper">
              <div className="bulk-actions-bar">
                <div className="bulk-info">
                  <span className="selected-count">{selectedMods.length} mods selected</span>
                  <button className="clear-selection-btn" onClick={() => setSelectedMods([])}>Deselect all</button>
                </div>
                <div className="bulk-btns">
                  <button className="bulk-action-btn" onClick={() => handleToggleSelected(true)}>
                    <Play size={13} fill="currentColor" />
                    Enable
                  </button>
                  <button className="bulk-action-btn" onClick={() => handleToggleSelected(false)}>
                    <Square size={13} fill="currentColor" />
                    Disable
                  </button>
                  <button className="bulk-action-btn danger" onClick={handleDeleteSelected}>
                    <Trash2 size={13} />
                    Delete
                  </button>
                </div>
              </div>
            </div>
          )}

          {installedMods.length > 0 && (
            <button
              className={`conflict-fab ${conflictScan.scanned && conflictScan.issues.length > 0 ? 'has-issues' : ''}`}
              onClick={openConflictScanner}
              disabled={loading}
              title="Open Mod Conflict Scanner"
              aria-label="Open Mod Conflict Scanner"
            >
              {scanningConflicts ? <Loader2 size={18} className="spin" /> : <TriangleAlert size={18} />}
              {conflictScan.scanned && conflictScan.issues.length > 0 && (
                <span className="conflict-fab-count">{conflictScan.issues.length}</span>
              )}
            </button>
          )}
        </div>
      ) : (
        <div className="find-mods-section">
          <div className="mods-container">
            <div className="search-controls-refined">
              <button
                className={`filter-btn-modal ${selectedCategories.length > 0 ? 'active' : ''}`}
                onClick={() => setIsFilterModalOpen(true)}
                title="Filter Categories"
              >
                <ListFilterPlus size={18} />
                <span>Filters</span>
                {selectedCategories.length > 0 && (
                  <span className="filter-count">{selectedCategories.length}</span>
                )}
              </button>

              <div className="search-input-wrapper-refined">
                <div className="search-box-wide">
                  <input
                    ref={findSearchRef}
                    type="text"
                    placeholder="Search Modrinth for mods..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
                  />
                  {searchQuery && (
                    <button className="clear-search-btn" onClick={() => setSearchQuery('')} title="Clear search">
                      <X size={14} />
                    </button>
                  )}
                </div>
              </div>
              <button
                className="search-btn"
                onClick={handleSearch}
                disabled={searching}
              >
                {searching ? <Loader2 className="spin-icon" size={18} /> : 'Search'}
              </button>
            </div>

            <h3 className="section-title">
              {searchQuery.trim() || selectedCategories.length > 0 ? 'Search Results' : 'Popular Mods'}
            </h3>

            {searching ? (
              <div className="loading-mods">Loading...</div>
            ) : searchError ? (
              <div className="empty-state error-state">
                <p style={{ color: '#ef4444' }}>⚠️ Failed to fetch mods</p>
                <p style={{ fontSize: '12px', color: '#888', marginTop: '8px' }}>{searchError}</p>
                <button
                  onClick={() => handleSearch(0)}
                  style={{ marginTop: '12px', padding: '8px 16px', background: '#333', border: '1px solid #555', borderRadius: '6px', color: '#fff', cursor: 'pointer' }}
                >
                  Retry
                </button>
              </div>
            ) : displayMods.length === 0 ? (
              <div className="empty-state">
                <p>{searchQuery.trim() || selectedCategories.length > 0 ? `No mods found` : 'No popular mods available for this version.'}</p>
              </div>
            ) : (
              <div className="search-results">
                {displayMods.map((project, index) => {
                  const installedMod = getInstalledMod(project);
                  const isDownloading = installing === project.slug;

                  return (
                    <div
                      key={`${project.slug}-${index}`}
                      className={`search-result-card ${isDownloading ? 'mod-updating' : ''}`}
                      ref={index === displayMods.length - 1 ? lastElementRef : null}
                    >
                      {isDownloading && (
                        <div className="mod-updating-overlay">
                          <RefreshCcw className="spin-icon" size={20} />
                          <span>Downloading...</span>
                        </div>
                      )}
                      <div className="result-header">
                        {project.icon_url && (
                          <img src={project.icon_url} alt="" className="result-icon" referrerPolicy="no-referrer" />
                        )}
                        <div className="result-info">
                          <h4>{project.title}</h4>
                          <span className="result-author">by {project.author}</span>
                        </div>
                      </div>
                      <p className="result-description">{project.description}</p>
                      <div className="result-footer">
                        <div className="result-meta">
                          <span className="result-downloads">{formatDownloads(project.downloads)} downloads</span>
                          <div className="loader-badges">
                            {getLoaderBadges(project.categories).map((loader) => (
                              <span key={loader} className={`loader-badge loader-${loader.toLowerCase()}`}>
                                {loader}
                              </span>
                            ))}
                          </div>
                        </div>
                        {installedMod ? (
                          <button
                            className="install-btn reinstall"
                            onClick={() => handleRequestInstall({ ...project, categories: project.categories || installedMod.categories }, installedMod)}
                            disabled={isDownloading}
                          >
                            Reinstall
                          </button>
                        ) : (
                          <button
                            className="install-btn"
                            onClick={() => handleRequestInstall(project)}
                            disabled={isDownloading}
                          >
                            {isDownloading ? 'Downloading...' : 'Install'}
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}              {loadingMore && (
                  <div className="loading-more">
                    <Loader2 className="spin-icon" size={24} />
                    <span>Loading more mods...</span>
                  </div>
                )}            </div>
            )}
          </div>
        </div>
      )}

      <ConfirmModal
        isOpen={deleteConfirm.show}
        title="Delete Mod"
        message={`Are you sure you want to delete "${deleteConfirm.mod?.name}"?`}
        confirmText="Delete"
        cancelText="Cancel"
        variant="danger"
        onConfirm={confirmDelete}
        onCancel={() => setDeleteConfirm({ show: false, mod: null })}
      />

      {versionModal.show && (
        <ModVersionModal
          project={versionModal.project}
          projectId={versionModal.projectId}
          gameVersion={instance.version_id}
          loader={instance.mod_loader}
          installedMod={versionModal.updateMod || (versionModal.project ? getInstalledMod(versionModal.project) : (versionModal.projectId ? installedMods.find(m => m.project_id === versionModal.projectId) : null))}
          onClose={() => setVersionModal({ show: false, project: null, projectId: null, updateMod: null })}
          onSelect={(selectedV) => {
            const updateModItem = versionModal.updateMod;
            const projectItem = versionModal.project;
            setVersionModal({ show: false, project: null, projectId: null, updateMod: null });
            handleInstall(projectItem, selectedV, false, updateModItem);
          }}
          onUninstall={(mod) => {
            setVersionModal({ show: false, project: null, projectId: null, updateMod: null });
            handleDelete(mod);
          }}
        />
      )}

      {showAddModal && (
        <div className="add-mod-modal-overlay" onClick={() => !applyingCode && setShowAddModal(false)}>
          <div className="add-mod-modal" onClick={e => e.stopPropagation()}>
            <div className="add-mod-header">
              <h2>Add Mod</h2>
              <button className="close-btn-simple" onClick={() => setShowAddModal(false)}>✕</button>
            </div>
            <div className="add-mod-body">
              {applyingCode ? (
                <div className="apply-progress-container">
                  <div className="apply-status-text">{applyStatus}</div>
                  <div className="apply-progress-bar-bg">
                    <div
                      className="apply-progress-bar-fill"
                      style={{ width: `${applyProgress}%` }}
                    />
                  </div>
                  <div className="apply-progress-percent">{Math.round(applyProgress)}%</div>
                </div>
              ) : (
                <>
                  <div className="choice-grid">
                    <button className="choice-card" onClick={() => {
                      setShowAddModal(false);
                      handleImportFile();
                    }}>
                      <div className="choice-icon">
                        <Upload size={24} />
                      </div>
                      <span>Add .JAR</span>
                    </button>
                    <button className="choice-card" onClick={() => {
                      // Stay in modal but maybe show input
                    }} style={{ cursor: 'default', opacity: 1 }}>
                      <div className="choice-icon" style={{ color: 'var(--accent)' }}>
                        <Code size={24} />
                      </div>
                      <span>Use Code</span>
                    </button>
                  </div>

                  <div className="code-input-container">
                    <label style={{ fontSize: '12px', color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase' }}>Paste Share Code</label>
                    <div className="code-input-wrapper">
                      <input
                        type="text"
                        className="code-input"
                        placeholder="Paste code here..."
                        value={shareCodeInput}
                        onChange={(e) => setShareCodeInput(e.target.value)}
                        disabled={applyingCode}
                      />
                      <button
                        className="apply-btn"
                        onClick={handleApplyCode}
                        disabled={applyingCode || !shareCodeInput.trim()}
                      >
                        {applyingCode ? '...' : 'Apply'}
                      </button>
                    </div>
                    <p style={{ fontSize: '11px', color: 'var(--text-muted)', margin: 0 }}>
                      Adding mods from code will automatically download them from Modrinth.
                    </p>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {showConflictModal && (
        <div
          className="conflict-modal-overlay"
          onClick={() => {
            if (!fixingConflictId && !isFixingAllConflicts) {
              setShowConflictModal(false);
            }
          }}
        >
          <div className="conflict-modal" onClick={(e) => e.stopPropagation()}>
            <div className="conflict-modal-header">
              <div className="conflict-modal-title">
                <TriangleAlert size={18} />
                <div>
                  <h3>Mod Conflict Scanner</h3>
                  <p>Detect duplicates, missing dependencies, and compatibility issues.</p>
                </div>
              </div>
              <div className="conflict-modal-actions">
                {conflictScan.scanned && conflictScan.issues.some((issue) => !!issue.fix_action) && (
                  <button
                    className="mod-conflict-fix-all-btn"
                    onClick={handleFixAllConflicts}
                    disabled={scanningConflicts || !!fixingConflictId || isFixingAllConflicts}
                  >
                    {isFixingAllConflicts ? <Loader2 size={14} className="spin" /> : <Check size={14} />}
                    <span>
                      {isFixingAllConflicts
                        ? 'Applying...'
                        : `Fix All (${conflictScan.issues.filter((issue) => !!issue.fix_action).length})`}
                    </span>
                  </button>
                )}
                <button
                  className={`scan-conflicts-btn ${conflictScan.scanned && conflictScan.issues.length > 0 ? 'has-issues' : ''}`}
                  onClick={() => scanConflicts()}
                  disabled={scanningConflicts || !!fixingConflictId || isFixingAllConflicts}
                >
                  {scanningConflicts ? <Loader2 size={14} className="spin" /> : <RefreshCcw size={14} />}
                  <span>{scanningConflicts ? 'Scanning...' : conflictScan.scanned ? 'Rescan' : 'Scan Now'}</span>
                </button>
                <button
                  className="close-btn-simple"
                  onClick={() => setShowConflictModal(false)}
                  disabled={!!fixingConflictId || isFixingAllConflicts}
                >
                  ✕
                </button>
              </div>
            </div>

            <div className="conflict-modal-body">
              {!conflictScan.scanned && !scanningConflicts && (
                <div className="mod-conflicts-empty-state">
                  <TriangleAlert size={22} />
                  <strong>Run your first conflict scan</strong>
                  <p>This checks installed mods for duplicates and dependency or version mismatches.</p>
                </div>
              )}

              {scanningConflicts && (
                <div className="mod-conflicts-empty-state scanning">
                  <Loader2 size={22} className="spin" />
                  <strong>Scanning installed mods...</strong>
                </div>
              )}

              {conflictScan.scanned && !scanningConflicts && (
                <div className={`mod-conflicts-panel ${conflictScan.issues.length > 0 ? 'has-issues' : 'clean'}`}>
                  <div className="mod-conflicts-header">
                    {conflictScan.issues.length > 0 ? (
                      <>
                        <TriangleAlert size={16} />
                        <strong>{conflictScan.issues.length} conflict{conflictScan.issues.length > 1 ? 's' : ''} found</strong>
                      </>
                    ) : (
                      <>
                        <ShieldCheck size={16} />
                        <strong>No conflicts detected</strong>
                      </>
                    )}
                  </div>

                  {conflictScan.issues.length > 0 && (
                    <div className="mod-conflicts-list">
                      {conflictScan.issues.map((issue) => (
                        <div key={issue.id} className={`mod-conflict-item severity-${issue.severity || 'warning'}`}>
                          <div className="mod-conflict-main">
                            <div className="mod-conflict-title-row">
                              <span className="mod-conflict-title">{issue.title}</span>
                              <span className="mod-conflict-badge">{issue.severity || 'warning'}</span>
                            </div>
                            <p className="mod-conflict-description">{issue.description}</p>
                            {Array.isArray(issue.affected_files) && issue.affected_files.length > 0 && (
                              <div className="mod-conflict-files">
                                {issue.affected_files.map((name) => (
                                  <span key={`${issue.id}-${name}`} className="mod-conflict-file-tag">{name}</span>
                                ))}
                              </div>
                            )}
                          </div>
                          {issue.fix_action && (
                            <button
                              className="mod-conflict-fix-btn"
                              disabled={!!fixingConflictId || isFixingAllConflicts}
                              onClick={() => handleFixConflict(issue)}
                            >
                              {fixingConflictId === issue.id ? <Loader2 size={13} className="spin" /> : null}
                              <span>
                                {issue.fix_action === 'disable_duplicates' ? 'Disable Duplicates' : 'Install Dependency'}
                              </span>
                            </button>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default memo(InstanceMods);
