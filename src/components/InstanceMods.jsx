import { useState, useEffect, useRef, useCallback, useMemo, memo } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { Trash2, RefreshCcw, Plus, Upload, Copy, Code, Loader2, ChevronDown, Check, ListFilterPlus, Play, Square, X, TriangleAlert, ShieldCheck, Wand2 } from 'lucide-react';
import { open } from '@tauri-apps/plugin-dialog';
import ConfirmModal from './ConfirmModal';
import ModVersionModal from './ModVersionModal';
import FilterModal from './FilterModal';
import InstalledContentRow from './InstalledContentRow';
import TabLoadingState from './TabLoadingState';
import SubTabs from './SubTabs';
import useModrinthSearch from '../hooks/useModrinthSearch';
import { findInstalledProject, matchesSelectedCategories } from '../utils/projectBrowser';
import { maybeShowCurseForgeBlockedDownloadModal } from '../utils/curseforgeInstallError';
import { formatInstalledVersionLabel, withVersionPrefix } from '../utils/versionDisplay';
import './FilterModal.css';

const MODRINTH_MOD_CATEGORIES = [
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

const CURSEFORGE_MOD_CATEGORIES = [
  { id: 'group-core', label: 'Core Categories', isSection: true },
  { id: 'cf-addons', label: 'Addons', queryValue: 'Addons' },
  { id: 'cf-adventure-rpg', label: 'Adventure and RPG', queryValue: 'Adventure and RPG' },
  { id: 'cf-api-library', label: 'API and Library', queryValue: 'API and Library' },
  { id: 'cf-armor-tools-weapons', label: 'Armor, Tools, and Weapons', queryValue: 'Armor, Tools, and Weapons' },
  { id: 'cf-bug-fixes', label: 'Bug Fixes', queryValue: 'Bug Fixes' },
  { id: 'cf-cosmetic', label: 'Cosmetic', queryValue: 'Cosmetic' },
  { id: 'cf-creativemode', label: 'CreativeMode', queryValue: 'CreativeMode' },
  { id: 'cf-education', label: 'Education', queryValue: 'Education' },
  { id: 'cf-food', label: 'Food', queryValue: 'Food' },
  { id: 'cf-magic', label: 'Magic', queryValue: 'Magic' },
  { id: 'cf-map-information', label: 'Map and Information', queryValue: 'Map and Information' },
  { id: 'cf-mcreator', label: 'MCreator', queryValue: 'MCreator' },
  { id: 'cf-misc', label: 'Miscellaneous', queryValue: 'Miscellaneous' },
  { id: 'cf-performance', label: 'Performance', queryValue: 'Performance' },
  { id: 'cf-redstone', label: 'Redstone', queryValue: 'Redstone' },
  { id: 'cf-server-utility', label: 'Server Utility', queryValue: 'Server Utility' },
  { id: 'cf-storage', label: 'Storage', queryValue: 'Storage' },
  { id: 'cf-technology', label: 'Technology', queryValue: 'Technology' },
  { id: 'cf-twitch-integration', label: 'Twitch Integration', queryValue: 'Twitch Integration' },
  { id: 'cf-utility-qol', label: 'Utility & QoL', queryValue: 'Utility & QoL' },
  { id: 'cf-world-gen', label: 'World Gen', queryValue: 'World Gen' },

  { id: 'group-addons', label: 'Addons Subcategories', isSection: true },
  { id: 'cf-addon-ae2', label: 'Applied Energistics 2', isSubcategory: true, queryValue: ['Addons', 'Applied Energistics 2'] },
  { id: 'cf-addon-blood-magic', label: 'Blood Magic', isSubcategory: true, queryValue: ['Addons', 'Blood Magic'] },
  { id: 'cf-addon-buildcraft', label: 'Buildcraft', isSubcategory: true, queryValue: ['Addons', 'Buildcraft'] },
  { id: 'cf-addon-crafttweaker', label: 'CraftTweaker', isSubcategory: true, queryValue: ['Addons', 'CraftTweaker'] },
  { id: 'cf-addon-create', label: 'Create', isSubcategory: true, queryValue: ['Addons', 'Create'] },
  { id: 'cf-addon-forestry', label: 'Forestry', isSubcategory: true, queryValue: ['Addons', 'Forestry'] },
  { id: 'cf-addon-galacticraft', label: 'Galacticraft', isSubcategory: true, queryValue: ['Addons', 'Galacticraft'] },
  { id: 'cf-addon-industrial-craft', label: 'Industrial Craft', isSubcategory: true, queryValue: ['Addons', 'Industrial Craft'] },
  { id: 'cf-addon-integrated-dynamics', label: 'Integrated Dynamics', isSubcategory: true, queryValue: ['Addons', 'Integrated Dynamics'] },
  { id: 'cf-addon-kubejs', label: 'KubeJS', isSubcategory: true, queryValue: ['Addons', 'KubeJS'] },
  { id: 'cf-addon-refined-storage', label: 'Refined Storage', isSubcategory: true, queryValue: ['Addons', 'Refined Storage'] },
  { id: 'cf-addon-skyblock', label: 'Skyblock', isSubcategory: true, queryValue: ['Addons', 'Skyblock'] },
  { id: 'cf-addon-thaumcraft', label: 'Thaumcraft', isSubcategory: true, queryValue: ['Addons', 'Thaumcraft'] },
  { id: 'cf-addon-thermal-expansion', label: 'Thermal Expansion', isSubcategory: true, queryValue: ['Addons', 'Thermal Expansion'] },
  { id: 'cf-addon-tinkers-construct', label: "Tinker's Construct", isSubcategory: true, queryValue: ['Addons', "Tinker's Construct"] },
  { id: 'cf-addon-twilight-forest', label: 'Twilight Forest', isSubcategory: true, queryValue: ['Addons', 'Twilight Forest'] },

  { id: 'group-tech-sub', label: 'Technology Subcategories', isSection: true },
  { id: 'cf-tech-automation', label: 'Automation', isSubcategory: true, queryValue: ['Technology', 'Automation'] },
  { id: 'cf-tech-energy', label: 'Energy', isSubcategory: true, queryValue: ['Technology', 'Energy'] },
  { id: 'cf-tech-energy-fluid-item-transport', label: 'Energy, Fluid, and Item Transport', isSubcategory: true, queryValue: ['Technology', 'Energy, Fluid, and Item Transport'] },
  { id: 'cf-tech-farming', label: 'Farming', isSubcategory: true, queryValue: ['Technology', 'Farming'] },
  { id: 'cf-tech-genetics', label: 'Genetics', isSubcategory: true, queryValue: ['Technology', 'Genetics'] },
  { id: 'cf-tech-player-transport', label: 'Player Transport', isSubcategory: true, queryValue: ['Technology', 'Player Transport'] },
  { id: 'cf-tech-processing', label: 'Processing', isSubcategory: true, queryValue: ['Technology', 'Processing'] },

  { id: 'group-worldgen-sub', label: 'World Gen Subcategories', isSection: true },
  { id: 'cf-worldgen-biomes', label: 'Biomes', isSubcategory: true, queryValue: ['World Gen', 'Biomes'] },
  { id: 'cf-worldgen-dimensions', label: 'Dimensions', isSubcategory: true, queryValue: ['World Gen', 'Dimensions'] },
  { id: 'cf-worldgen-mobs', label: 'Mobs', isSubcategory: true, queryValue: ['World Gen', 'Mobs'] },
  { id: 'cf-worldgen-ores-resources', label: 'Ores and Resources', isSubcategory: true, queryValue: ['World Gen', 'Ores and Resources'] },
  { id: 'cf-worldgen-structures', label: 'Structures', isSubcategory: true, queryValue: ['World Gen', 'Structures'] },
];

const resolveSelectedCategoryQueryValues = (options, selectedIds) => {
  const values = [];
  for (const id of selectedIds || []) {
    const match = (options || []).find((option) => option.id === id);
    const rawValue = match?.queryValue ?? id;
    const entries = Array.isArray(rawValue) ? rawValue : [rawValue];
    for (const entry of entries) {
      const normalized = String(entry || '').trim();
      if (!normalized || values.includes(normalized)) continue;
      values.push(normalized);
    }
  }
  return values;
};

const isCurseForgeProjectId = (value) => /^\d+$/.test(String(value || '').trim());

const normalizeProviderLabel = (provider, projectId) => {
  const normalized = String(provider || '').toLowerCase();
  if (normalized === 'curseforge') return 'CurseForge';
  if (normalized === 'modrinth') return 'Modrinth';
  return isCurseForgeProjectId(projectId) ? 'CurseForge' : 'Modrinth';
};

const getUpdateRowLatestVersion = (row) => {
  const provider = normalizeProviderLabel(row?.provider, row?.project_id).toLowerCase();
  if (provider === 'curseforge') {
    return row?.latest_curseforge_version || null;
  }
  return row?.latest_version || null;
};

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
  const [appliedFindQuery, setAppliedFindQuery] = useState('');
  const [appliedFindCategories, setAppliedFindCategories] = useState([]);
  const [isFilterModalOpen, setIsFilterModalOpen] = useState(false);
  const [installedSearchQuery, setInstalledSearchQuery] = useState('');
  const [installedMods, setInstalledMods] = useState([]);
  const [installing, setInstalling] = useState(null);
  const [updatingMods, setUpdatingMods] = useState([]); // Array of IDs (filename/project_id) being updated
  const [loading, setLoading] = useState(true);
  const [findProvider, setFindProvider] = useState('modrinth');
  const [hasCurseForgeKey, setHasCurseForgeKey] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState({ show: false, mod: null });
  const [versionModal, setVersionModal] = useState({ show: false, project: null, updateMod: null });
  const [showAddModal, setShowAddModal] = useState(false);
  const [shareCodeInput, setShareCodeInput] = useState('');
  const [applyingCode, setApplyingCode] = useState(false);
  const [applyProgress, setApplyProgress] = useState(0);
  const [applyStatus, setApplyStatus] = useState('');
  const [isCheckingUpdates, setIsCheckingUpdates] = useState(false);
  const [updatesFound, setUpdatesFound] = useState({}); // { project_id: update_row }
  const [selectedMods, setSelectedMods] = useState([]); // Array of filenames
  const [conflictScan, setConflictScan] = useState({ scanned: false, issues: [] });
  const [scanningConflicts, setScanningConflicts] = useState(false);
  const [fixingConflictId, setFixingConflictId] = useState(null);
  const [showConflictModal, setShowConflictModal] = useState(false);
  const [isFixingAllConflicts, setIsFixingAllConflicts] = useState(false);
  const [isResolvingManualMods, setIsResolvingManualMods] = useState(false);
  const [sourceChoiceModal, setSourceChoiceModal] = useState({ show: false, bothCount: 0, scopeLabel: 'selected files' });
  const isManagedModpackInstance = Boolean(instance?.modpack_provider || instance?.modpack_project_id);

  const installedSearchRef = useRef(null);
  const findSearchRef = useRef(null);
  const sourceChoiceResolverRef = useRef(null);

  const modLoaderForSearch =
    instance.mod_loader?.toLowerCase() !== 'vanilla'
      ? instance.mod_loader?.toLowerCase()
      : null;
  const activeFilterCategories = useMemo(
    () => (activeSubTab === 'find' && findProvider === 'curseforge' ? CURSEFORGE_MOD_CATEGORIES : MODRINTH_MOD_CATEGORIES),
    [activeSubTab, findProvider]
  );
  const selectedCategoryQueryValues = useMemo(
    () => resolveSelectedCategoryQueryValues(activeFilterCategories, selectedCategories),
    [activeFilterCategories, selectedCategories]
  );
  const appliedCategoryQueryValues = useMemo(
    () => resolveSelectedCategoryQueryValues(activeFilterCategories, appliedFindCategories),
    [activeFilterCategories, appliedFindCategories]
  );
  const effectiveFindCategories = useMemo(
    () => appliedCategoryQueryValues,
    [appliedCategoryQueryValues]
  );

  const {
    searchResults,
    searching,
    loadingMore,
    canLoadMore,
    searchError,
    handleSearch,
    loadMore,
    setSearchResults,
    setSearchError,
  } = useModrinthSearch({
    provider: findProvider,
    projectType: 'mod',
    gameVersion: instance.version_id,
    loader: modLoaderForSearch,
    categories: effectiveFindCategories,
    query: appliedFindQuery,
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

  const requestSourceChoice = useCallback((bothCount, scopeLabel = 'selected files') => {
    return new Promise((resolve) => {
      sourceChoiceResolverRef.current = resolve;
      setSourceChoiceModal({ show: true, bothCount, scopeLabel });
    });
  }, []);

  const closeSourceChoice = useCallback((choice = null) => {
    setSourceChoiceModal((prev) => ({ ...prev, show: false }));
    const resolve = sourceChoiceResolverRef.current;
    sourceChoiceResolverRef.current = null;
    if (resolve) resolve(choice);
  }, []);

  useEffect(() => {
    return () => {
      if (sourceChoiceResolverRef.current) {
        sourceChoiceResolverRef.current(null);
        sourceChoiceResolverRef.current = null;
      }
    };
  }, []);

  const handleResolveManualMetadata = useCallback(async (filenames = null) => {
    if (isResolvingManualMods) return;
    setIsResolvingManualMods(true);
    try {
      const previewResult = await invoke('resolve_manual_modrinth_metadata', {
        instanceId: instance.id,
        fileType: 'mod',
        filenames,
        dryRun: true
      });

      if (previewResult.scanned === 0) {
        onShowNotification?.('No manual mod files available to check.', 'info');
        return;
      }

      if (previewResult.matched === 0) {
        onShowNotification?.('No matches found for the selected files.', 'info');
        return;
      }

      let preferredSource;
      if ((previewResult.both_sources || 0) > 0) {
        preferredSource = await requestSourceChoice(previewResult.both_sources, 'selected mods');
        if (!preferredSource) {
          onShowNotification?.('Manual metadata check cancelled.', 'info');
          return;
        }
      }

      const result = await invoke('resolve_manual_modrinth_metadata', {
        instanceId: instance.id,
        fileType: 'mod',
        filenames,
        preferredSource
      });
      await loadInstalledMods();
      if (onShowNotification) {
        if (result.updated > 0) {
          onShowNotification(
            `Matched ${result.updated}/${result.scanned} mod file${result.updated === 1 ? '' : 's'}.`,
            'success'
          );
        } else if (result.scanned > 0) {
          onShowNotification('No matches found for the selected files.', 'info');
        } else {
          onShowNotification('No manual mod files available to check.', 'info');
        }
      }
    } catch (error) {
      console.error('Failed to resolve metadata for manual mods:', error);
      onShowNotification?.(`Failed to check manual mods: ${error}`, 'error');
    } finally {
      setIsResolvingManualMods(false);
    }
  }, [instance.id, isResolvingManualMods, loadInstalledMods, onShowNotification, requestSourceChoice]);

  const executeFindSearch = useCallback((queryOverride = searchQuery, categoriesOverride = selectedCategories) => {
    if (findProvider === 'curseforge' && !hasCurseForgeKey) {
      setSearchResults([]);
      setSearchError('CurseForge key not configured.');
      return;
    }
    const categoryQueryValues = Array.isArray(categoriesOverride)
      ? resolveSelectedCategoryQueryValues(activeFilterCategories, categoriesOverride)
      : selectedCategoryQueryValues;
    setAppliedFindQuery(queryOverride);
    setAppliedFindCategories(categoriesOverride);
    setSearchError(null);
    handleSearch(0, queryOverride, categoryQueryValues);
  }, [searchQuery, selectedCategories, findProvider, hasCurseForgeKey, handleSearch, setSearchResults, setSearchError, activeFilterCategories, selectedCategoryQueryValues]);

  // Effects
  useEffect(() => {
    // Reset filters when switching between tabs
    setSelectedCategories([]);
    setSearchQuery('');
    setAppliedFindQuery('');
    setAppliedFindCategories([]);
  }, [activeSubTab]);

  useEffect(() => {
    if (activeSubTab !== 'find') return;
    setSelectedCategories([]);
    setSearchQuery('');
    setAppliedFindQuery('');
    setAppliedFindCategories([]);
  }, [activeSubTab, findProvider]);

  useEffect(() => {
    loadInstalledMods();
  }, [loadInstalledMods]);

  useEffect(() => {
    const loadCurseForgeKeyStatus = async () => {
      try {
        const hasKey = await invoke('has_curseforge_api_key');
        setHasCurseForgeKey(Boolean(hasKey));
      } catch (error) {
        console.error('Failed to check CurseForge key status:', error);
        setHasCurseForgeKey(false);
      }
    };
    loadCurseForgeKeyStatus();
  }, []);

  useEffect(() => {
    setConflictScan({ scanned: false, issues: [] });
  }, [installedMods]);

  useEffect(() => {
    if (activeSubTab !== 'find') return;
    if (findProvider === 'curseforge' && !hasCurseForgeKey) {
      setSearchResults([]);
      setSearchError('CurseForge key not configured.');
      return;
    }
    if (appliedFindQuery.trim() !== '' || appliedFindCategories.length > 0) return;
    handleSearch(0, '');
  }, [activeSubTab, findProvider, hasCurseForgeKey, appliedFindQuery, appliedFindCategories.length, handleSearch, setSearchResults, setSearchError]);

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
    const resolvedProjectId = String(project?.project_id || project?.id || project?.slug || updateMod?.project_id || '').trim();
    const providerLabel = normalizeProviderLabel(
      project?.provider_label || project?.provider || updateMod?.provider,
      resolvedProjectId
    );
    const provider = providerLabel.toLowerCase();
    const downloadId = resolvedProjectId || updateMod?.filename || project?.slug;

    // Add to global queue if not already there
    if (onQueueDownload) {
      onQueueDownload({
        id: downloadId,
        name: project.title || project.name || updateMod?.name || resolvedProjectId,
        icon: project.icon_url || updateMod?.icon_url,
        status: 'Preparing...'
      });
    }

    setInstalling(resolvedProjectId || project?.slug);
    if (updateMod) {
      setUpdatingMods(prev => [...prev, updateMod.project_id || updateMod.filename]);
    }

    try {
      let version = selectedVersionMatch;

      if (onUpdateDownloadStatus) {
        onUpdateDownloadStatus(downloadId, 'Fetching version...');
      }

      if (provider === 'modrinth' && !version) {
        const versions = await invoke('get_modrinth_versions', {
          projectId: project.slug || resolvedProjectId,
          gameVersion: instance.version_id,
          loader: instance.mod_loader?.toLowerCase() || null
        });

        if (versions.length === 0) {
          throw new Error('No compatible version found for this mod');
        }

        version = versions[0];
      }

      // Check for dependencies (recursive)
      if (provider === 'modrinth' && !skipDependencyCheck && version.dependencies && version.dependencies.length > 0) {
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

      let installedFilename = '';
      if (provider === 'curseforge') {
        if (!resolvedProjectId) {
          throw new Error('Missing CurseForge project ID');
        }

        if (!version) {
          const cfVersions = await invoke('get_curseforge_modpack_versions', { projectId: resolvedProjectId });
          if (!Array.isArray(cfVersions) || cfVersions.length === 0) {
            throw new Error('No compatible CurseForge file found for this mod');
          }
          const sorted = [...cfVersions].sort((a, b) => new Date(b.date_published) - new Date(a.date_published));
          version = sorted[0];
        }

        const file = version?.files?.find((f) => f.primary) || version?.files?.[0];
        if (!file) {
          throw new Error('Selected CurseForge version has no downloadable file');
        }
        installedFilename = file.filename || `${resolvedProjectId}-${version.id}.jar`;

        if (onUpdateDownloadStatus) {
          onUpdateDownloadStatus(downloadId, 'Downloading...');
        }

        await invoke('install_curseforge_file', {
          instanceId: instance.id,
          projectId: resolvedProjectId,
          fileId: version.id,
          fileType: 'mod',
          filename: installedFilename,
          fileUrl: file.url || null,
          worldName: null,
          name: project.title || project.name || updateMod?.name || null,
          author: project.author || updateMod?.author || null,
          iconUrl: project.icon_url || updateMod?.icon_url || null,
          versionName: version.name || version.version_number || null,
          categories: project.categories || project.display_categories || (updateMod ? updateMod.categories : null) || null
        });
      } else {
        const file = version.files.find(f => f.primary) || version.files[0];
        installedFilename = file.filename;

        if (onUpdateDownloadStatus) {
          onUpdateDownloadStatus(downloadId, 'Downloading...');
        }

        await invoke('install_modrinth_file', {
          instanceId: instance.id,
          fileUrl: file.url,
          filename: file.filename,
          fileType: 'mod',
          projectId: resolvedProjectId || project.slug,
          versionId: version.id,
          name: project.title || project.name,
          author: project.author,
          iconUrl: project.icon_url,
          versionName: version.version_number,
          categories: project.categories || project.display_categories || (updateMod ? updateMod.categories : null) || null
        });
      }

      // If this was an update and the new file name is different, delete the old one
      if (updateMod && updateMod.filename !== installedFilename) {
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
      const handledCurseForgeRestriction = await maybeShowCurseForgeBlockedDownloadModal({
        error,
        provider,
        project,
        projectId: resolvedProjectId,
        onShowConfirm,
        onShowNotification,
      });
      if (!handledCurseForgeRestriction) {
        onShowNotification?.('Failed to install mod: ' + error, 'error');
      }
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
  }, [
    instance.id,
    instance.version_id,
    instance.mod_loader,
    isModInstalled,
    loadInstalledMods,
    onShowConfirm,
    onQueueDownload,
    onUpdateDownloadStatus,
    onDequeueDownload,
    onShowNotification
  ]);

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
        project_id: mod.project_id,
        slug: mod.project_id,
        provider_label: normalizeProviderLabel(mod.provider, mod.project_id),
        categories: mod.categories
      }
    });
  }, []);

  const handleBulkCheckUpdates = useCallback(async () => {
    const trackedMods = installedMods.filter(
      (m) => m.enabled && m.project_id && (!m.provider || m.provider !== 'Manual')
    );
    if (trackedMods.length === 0) return;

    setIsCheckingUpdates(true);
    try {
      const rows = await invoke('get_instance_mod_updates', { instanceId: instance.id, fileType: 'mod' });
      const updates = {};
      for (const row of Array.isArray(rows) ? rows : []) {
        if (row?.project_id && getUpdateRowLatestVersion(row)) {
          updates[row.project_id] = row;
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
          const updateRow = updatesFound[mod.project_id];
          const latestVersion = getUpdateRowLatestVersion(updateRow);
          if (!latestVersion) continue;

          try {
            const provider = normalizeProviderLabel(updateRow?.provider || mod.provider, mod.project_id);
            const project = provider === 'CurseForge'
              ? await invoke('get_curseforge_modpack', { projectId: mod.project_id })
              : await invoke('get_modrinth_project', { projectId: mod.project_id });
            const normalizedProject = {
              ...project,
              project_id: mod.project_id,
              slug: mod.project_id,
              provider_label: provider
            };
            // Use skipDependencyCheck = true for bulk updates to avoid multiple modals
            await handleInstall(normalizedProject, latestVersion, true, mod);
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

      // Pre-fetch Modrinth metadata if possible
      let projectMap = {};
      const projectIds = mods
        .map(m => m.project_id || m.projectId)
        .filter((projectId) => projectId && !isCurseForgeProjectId(projectId));
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

          if (isCurseForgeProjectId(mid)) {
            let project = null;
            let version = null;

            try {
              project = await invoke('get_curseforge_modpack', { projectId: mid });
            } catch (e) {
              console.warn(`Failed to fetch CurseForge project metadata for ${mid}:`, e);
            }

            const cfVersions = await invoke('get_curseforge_modpack_versions', { projectId: mid });
            if (Array.isArray(cfVersions) && cfVersions.length > 0) {
              version = vid
                ? cfVersions.find((entry) => String(entry.id) === String(vid))
                : null;
              if (!version) {
                const sorted = [...cfVersions].sort((a, b) => new Date(b.date_published) - new Date(a.date_published));
                version = sorted[0];
              }
            }

            if (version) {
              const file = version?.files?.find((entry) => entry.primary) || version?.files?.[0];
              if (file) {
                await invoke('install_curseforge_file', {
                  instanceId: instance.id,
                  projectId: mid,
                  fileId: String(version.id),
                  fileType: 'mod',
                  filename: file.filename || `${mid}-${version.id}.jar`,
                  fileUrl: file.url || null,
                  worldName: null,
                  iconUrl: project?.icon_url || mod.icon_url || mod.iconUrl || null,
                  name: project?.title || mod.name || null,
                  author: project?.author || mod.author || null,
                  versionName: version.version_number || version.name || mod.version_name || mod.versionName || null,
                  categories: project?.categories || project?.display_categories || mod.categories || null
                });
                installedCount++;
              }
            }

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

  const isFileLockedError = useCallback((error) => {
    const message = String(error || '').toLowerCase();
    return message.includes('os error 32') ||
      message.includes('used by another process') ||
      message.includes('bruges af en anden proces');
  }, []);

  const confirmDelete = useCallback(async () => {
    const mod = deleteConfirm.mod;
    setDeleteConfirm({ show: false, mod: null });
    if (!mod) return;

    try {
      await invoke('delete_instance_mod', {
        instanceId: instance.id,
        filename: mod.filename
      });
      await loadInstalledMods();
      onShowNotification?.(`Deleted "${mod.name || mod.filename}".`, 'success');
    } catch (error) {
      console.error('Failed to delete mod:', error);
      if (isFileLockedError(error)) {
        onShowNotification?.(
          `Could not delete "${mod.name || mod.filename}" because the file is in use. Stop the instance and try again.`,
          'error'
        );
      } else {
        onShowNotification?.(`Failed to delete "${mod.name || mod.filename}": ${error}`, 'error');
      }
      await loadInstalledMods();
    }
  }, [instance.id, deleteConfirm.mod, isFileLockedError, loadInstalledMods, onShowNotification]);

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

  const managedMods = useMemo(() => {
    return filteredInstalledMods
      .filter((m) => m.project_id && (!m.provider || m.provider !== 'Manual'))
      .sort((a, b) => (a.name || a.filename).localeCompare(b.name || b.filename));
  }, [filteredInstalledMods]);

  const manualMods = useMemo(() => {
    return filteredInstalledMods
      .filter((m) => !m.project_id || !m.provider || m.provider === 'Manual')
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
        let deletedCount = 0;
        let lockedCount = 0;
        let failedCount = 0;

        for (const filename of selectedMods) {
          try {
            await invoke('delete_instance_mod', { instanceId: instance.id, filename });
            deletedCount++;
          } catch (error) {
            console.error(`Failed to delete mod ${filename}:`, error);
            if (isFileLockedError(error)) {
              lockedCount++;
            } else {
              failedCount++;
            }
          }
        }

        setSelectedMods([]);
        await loadInstalledMods();

        if (deletedCount > 0) {
          onShowNotification?.(`Deleted ${deletedCount} mod${deletedCount === 1 ? '' : 's'}.`, 'success');
        }
        if (lockedCount > 0) {
          onShowNotification?.(
            `${lockedCount} mod${lockedCount === 1 ? '' : 's'} could not be deleted because the file is in use. Stop the instance and try again.`,
            'error'
          );
        }
        if (failedCount > 0) {
          onShowNotification?.(`Failed to delete ${failedCount} mod${failedCount === 1 ? '' : 's'}.`, 'error');
        }
        setLoading(false);
      }
    });
  }, [selectedMods, instance.id, onShowConfirm, isFileLockedError, loadInstalledMods, onShowNotification]);

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

  const matchesAllSelectedCategories = (project) => {
    if (findProvider === 'curseforge') return true;
    return matchesSelectedCategories(project, appliedFindCategories);
  };

  const displayMods = searchResults.filter(matchesAllSelectedCategories);
  const hasAppliedFindFilters = appliedFindQuery.trim().length > 0 || appliedFindCategories.length > 0;

  return (
    <div className="mods-tab">
      <div className={`sub-tabs-row ${isScrolled ? 'scrolled' : ''}`}>
        <SubTabs
          tabs={[
            { id: 'installed', label: `Mods (${installedMods.length})` },
            { id: 'find', label: 'Find Mods' }
          ]}
          activeTab={activeSubTab}
          onTabChange={setActiveSubTab}
        />
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

      <div className="mods-tab-scroll-content">
      <FilterModal
        isOpen={isFilterModalOpen}
        onClose={() => setIsFilterModalOpen(false)}
        categories={activeFilterCategories}
        selectedCategories={selectedCategories}
        onApply={setSelectedCategories}
        title={activeSubTab === 'find' && findProvider === 'curseforge' ? 'CurseForge Mod Categories' : 'Mod Categories'}
      />

      {sourceChoiceModal.show && (
        <ConfirmModal
          isOpen={sourceChoiceModal.show}
          modalClassName="source-choice-modal"
          title="Choose metadata source"
          message={`Found ${sourceChoiceModal.bothCount} ${sourceChoiceModal.scopeLabel} that match both Modrinth and CurseForge. Which source should be used?`}
          confirmText="Use Modrinth"
          extraConfirmText="Use CurseForge"
          cancelText="Cancel"
          variant="secondary"
          actionLayout="flat"
          onConfirm={() => closeSourceChoice('modrinth')}
          onExtraConfirm={() => closeSourceChoice('curseforge')}
          onCancel={() => closeSourceChoice(null)}
        />
      )}

      {isManagedModpackInstance && (
        <div className="managed-modpack-warning" role="note">
          <TriangleAlert size={16} className="managed-modpack-warning-icon" />
          <div className="managed-modpack-warning-content">
            <strong>Managed modpack detected</strong>
            <span>
              Updating mods manually here can break the modpack. To update safely, use the modpack updater in Instance List:
              click the info icon before the instance name.
            </span>
          </div>
        </div>
      )}

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
            <TabLoadingState label="Loading mods" rows={5} />
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
              {managedMods.length > 0 && (
                <div className="mod-group">
                  <div className="group-header">
                    <h3 className="group-title">Managed</h3>
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
                    {managedMods.map((mod) => {
                      const isUpdating = updatingMods.includes(mod.project_id || mod.filename);
                      const isSelected = selectedMods.includes(mod.filename);
                      const versionLabel = withVersionPrefix(
                        formatInstalledVersionLabel(mod.version, mod.provider, mod.filename)
                      );
                      return (
                        <InstalledContentRow
                          key={mod.filename}
                          item={mod}
                          isUpdating={isUpdating}
                          isSelected={isSelected}
                          selectionModeActive={selectedMods.length > 0}
                          versionLabel={versionLabel || 'Unknown version'}
                          showUpdateBadge={Boolean(updatesFound[mod.project_id])}
                          authorFallback="Unknown author"
                          onToggleSelect={handleToggleSelect}
                          onInfoAction={() => handleCheckUpdate(mod)}
                          onToggleEnabled={() => handleToggle(mod)}
                          onDelete={() => handleDelete(mod)}
                          infoTitle="Open project info"
                          deleteTitle="Delete mod"
                          updatingLabel="Updating..."
                        />
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
                    <button
                      className={`resolve-modrinth-btn-inline ${isResolvingManualMods ? 'loading' : ''}`}
                      onClick={() => handleResolveManualMetadata()}
                      disabled={isResolvingManualMods}
                      title="Find metadata for manual files"
                    >
                      {isResolvingManualMods ? <Loader2 size={12} className="spin" /> : <Wand2 size={12} />}
                      <span>Find on Modrinth/CurseForge</span>
                    </button>
                  </div>
                  <div className="installed-list">
                    {manualMods.map((mod) => {
                      const isUpdating = updatingMods.includes(mod.project_id || mod.filename);
                      const isSelected = selectedMods.includes(mod.filename);
                      return (
                        <InstalledContentRow
                          key={mod.filename}
                          item={mod}
                          isUpdating={isUpdating}
                          isSelected={isSelected}
                          selectionModeActive={selectedMods.length > 0}
                          versionLabel="Unknown version"
                          platformLabel="Manual"
                          authorFallback="Manual file"
                          onToggleSelect={handleToggleSelect}
                          onToggleEnabled={() => handleToggle(mod)}
                          onDelete={() => handleDelete(mod)}
                          infoTitle="Project info unavailable"
                          deleteTitle="Delete mod"
                          updatingLabel="Updating..."
                        />
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
              <SubTabs
                tabs={[
                  { id: 'modrinth', label: 'Modrinth' },
                  { id: 'curseforge', label: 'CurseForge' }
                ]}
                activeTab={findProvider}
                onTabChange={setFindProvider}
              />
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
                    placeholder={findProvider === 'curseforge' ? 'Search CurseForge mods...' : 'Search Modrinth for mods...'}
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && executeFindSearch()}
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
                onClick={() => executeFindSearch()}
                disabled={searching || (findProvider === 'curseforge' && !hasCurseForgeKey)}
              >
                {searching ? <Loader2 className="spin-icon" size={18} /> : 'Search'}
              </button>
            </div>

            <h3 className="section-title">
              {hasAppliedFindFilters ? 'Search Results' : 'Popular Mods'}
            </h3>

            {findProvider === 'curseforge' && !hasCurseForgeKey ? (
              <div className="empty-state error-state">
                <p style={{ color: '#ef4444' }}>CurseForge key not configured</p>
                <p style={{ fontSize: '12px', color: '#888', marginTop: '8px' }}>
                  Set `CURSEFORGE_API_KEY` for backend runtime.
                </p>
              </div>
            ) : searching ? (
              <div className="loading-mods">Loading...</div>
            ) : searchError ? (
              <div className="empty-state error-state">
                <p style={{ color: '#ef4444' }}>⚠️ Failed to fetch mods</p>
                <p style={{ fontSize: '12px', color: '#888', marginTop: '8px' }}>{searchError}</p>
                <button
                  onClick={() => executeFindSearch(appliedFindQuery, appliedFindCategories)}
                  style={{ marginTop: '12px', padding: '8px 16px', background: '#333', border: '1px solid #555', borderRadius: '6px', color: '#fff', cursor: 'pointer' }}
                >
                  Retry
                </button>
              </div>
            ) : displayMods.length === 0 ? (
              <div className="empty-state">
                <p>{hasAppliedFindFilters ? 'No mods found' : 'No popular mods available for this version.'}</p>
              </div>
            ) : (
              <div className="search-results-viewport">
                <div className="search-results">
                  {displayMods.map((project, index) => {
                    const installedMod = getInstalledMod(project);
                    const isDownloading = [project.project_id, project.id, project.slug]
                      .filter(Boolean)
                      .map((value) => String(value))
                      .includes(String(installing || ''));

                    return (
                      <div
                      key={`${project.project_id || project.slug || project.id || index}`}
                      className={`search-result-card ${isDownloading ? 'mod-updating' : ''}`}
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
                              onClick={() => handleRequestInstall({
                                ...project,
                                provider_label: findProvider === 'curseforge' ? 'CurseForge' : 'Modrinth',
                                project_type: 'mod',
                                categories: project.categories || installedMod.categories
                              }, installedMod)}
                              disabled={isDownloading}
                            >
                              Reinstall
                            </button>
                          ) : (
                            <button
                              className="install-btn"
                              onClick={() => handleRequestInstall({
                                ...project,
                                provider_label: findProvider === 'curseforge' ? 'CurseForge' : 'Modrinth',
                                project_type: 'mod'
                              })}
                              disabled={isDownloading}
                            >
                              {isDownloading ? 'Downloading...' : 'Install'}
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
                {canLoadMore && (
                  <div className="search-load-more-actions">
                    <button
                      className="search-load-more-btn"
                      onClick={loadMore}
                      disabled={loadingMore || searching}
                    >
                      {loadingMore ? (
                        <>
                          <Loader2 className="search-load-more-spinner" size={16} />
                          <span>Loading...</span>
                        </>
                      ) : (
                        <span>Load More</span>
                      )}
                    </button>
                  </div>
                )}
              </div>
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
          onReinstall={({ project: modalProject, version, installedItem }) => {
            const updateModItem = installedItem || versionModal.updateMod;
            const projectItem = modalProject || versionModal.project;
            setVersionModal({ show: false, project: null, projectId: null, updateMod: null });
            handleInstall(projectItem, version, false, updateModItem);
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
                      Adding mods from code will automatically download them from Modrinth or CurseForge.
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
    </div>
  );
}

export default memo(InstanceMods);
