import { useState, useEffect, useRef, useCallback, useMemo, memo } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { Trash2, RefreshCcw, Plus, Upload, Loader2, ListFilterPlus, ChevronDown, Check, X, Wand2, Copy } from 'lucide-react';
import { open } from '@tauri-apps/plugin-dialog';
import ConfirmModal from './ConfirmModal';
import ModVersionModal from './ModVersionModal';
import FilterModal from './FilterModal';
import InstalledContentRow from './InstalledContentRow';
import SubTabs from './SubTabs';
import useModrinthSearch from '../hooks/useModrinthSearch';
import { findInstalledProject, matchesSelectedCategories } from '../utils/projectBrowser';
import { maybeShowCurseForgeBlockedDownloadModal } from '../utils/curseforgeInstallError';
import { formatInstalledVersionLabel, withVersionPrefix } from '../utils/versionDisplay';
import './FilterModal.css';

const MODRINTH_DATAPACK_CATEGORIES = [
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

const CURSEFORGE_DATAPACK_CATEGORIES = [
    { id: 'group-categories', label: 'Categories', isSection: true },
    { id: 'cf-dp-adventure', label: 'Adventure', queryValue: 'Adventure' },
    { id: 'cf-dp-fantasy', label: 'Fantasy', queryValue: 'Fantasy' },
    { id: 'cf-dp-library', label: 'Library', queryValue: 'Library' },
    { id: 'cf-dp-magic', label: 'Magic', queryValue: 'Magic' },
    { id: 'cf-dp-tech', label: 'Tech', queryValue: 'Tech' },
    { id: 'cf-dp-utility', label: 'Utility', queryValue: 'Utility' },
    { id: 'cf-dp-mod-support', label: 'Mod Support', queryValue: 'Mod Support' },
    { id: 'cf-dp-misc', label: 'Miscellaneous', queryValue: 'Miscellaneous' },
    { id: 'cf-dp-modjam-2025', label: 'ModJam 2025', queryValue: 'ModJam 2025' },
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
const MC_VERSION_TOKEN_RE = /\b\d+\.\d+(?:\.\d+)?\b/g;

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

const extractMcVersionToken = (value) => {
    const text = String(value || '').trim();
    if (!text) return null;
    const matches = text.match(MC_VERSION_TOKEN_RE);
    if (!matches?.length) return null;
    return matches[matches.length - 1];
};

const resolveCurseForgeInstallVersionName = (version, file, instanceVersion) => {
    const preferredGameVersion = String(instanceVersion || '').trim();
    const candidateFromText = extractMcVersionToken(version?.version_number)
        || extractMcVersionToken(version?.name)
        || extractMcVersionToken(file?.filename);
    if (candidateFromText) return candidateFromText;

    const gameVersions = Array.isArray(version?.game_versions) ? version.game_versions : [];
    const normalizedGameVersions = gameVersions
        .map((entry) => String(entry || '').trim())
        .filter((entry) => /^\d+\.\d+(?:\.\d+)?$/.test(entry));

    if (preferredGameVersion && normalizedGameVersions.includes(preferredGameVersion)) {
        return preferredGameVersion;
    }
    if (normalizedGameVersions.length > 0) {
        return normalizedGameVersions[0];
    }

    return version?.version_number || version?.name || file?.filename || null;
};

const resolveCurseForgeVersionLabelFromEntry = (versionEntry) => {
    const primaryFilename = versionEntry?.files?.[0]?.filename || null;
    return formatInstalledVersionLabel(versionEntry?.version_number, 'curseforge', primaryFilename)
        || formatInstalledVersionLabel(versionEntry?.name, 'curseforge', primaryFilename)
        || extractMcVersionToken(versionEntry?.version_number)
        || extractMcVersionToken(versionEntry?.name)
        || extractMcVersionToken(primaryFilename)
        || null;
};

function WorldDatapacks({
    instance,
    world,
    onShowNotification,
    onShowConfirm,
    isScrolled,
    onQueueDownload,
    onDequeueDownload,
    onUpdateDownloadStatus,
    activeTab,
    onTabChange,
    hideTabBar = false,
    refreshNonce = 0
}) {
    const [internalActiveSubTab, setInternalActiveSubTab] = useState('installed');
    const activeSubTab = activeTab ?? internalActiveSubTab;
    const setActiveSubTab = onTabChange ?? setInternalActiveSubTab;
    const [searchQuery, setSearchQuery] = useState('');
    const [findSearchQuery, setFindSearchQuery] = useState('');
    const [installedDatapacks, setInstalledDatapacks] = useState([]);
    const [installing, setInstalling] = useState(null);
    const [updatingItems, setUpdatingItems] = useState([]); // Array of filenames being updated
    const [loading, setLoading] = useState(true);
    const [findProvider, setFindProvider] = useState('modrinth');
    const [hasCurseForgeKey, setHasCurseForgeKey] = useState(false);
    const [selectedCategories, setSelectedCategories] = useState([]);
    const [appliedFindCategories, setAppliedFindCategories] = useState([]);
    const [isFilterModalOpen, setIsFilterModalOpen] = useState(false);
    const [deleteConfirm, setDeleteConfirm] = useState({ show: false, datapack: null });
    const [versionModal, setVersionModal] = useState({ show: false, project: null, updateItem: null });
    const [selectedItems, setSelectedItems] = useState([]); // Array of filenames
    const [isResolvingManual, setIsResolvingManual] = useState(false);
    const [isCheckingUpdates, setIsCheckingUpdates] = useState(false);
    const [updatesFound, setUpdatesFound] = useState({});
    const [curseForgeVersionLabels, setCurseForgeVersionLabels] = useState({});
    const [sourceChoiceModal, setSourceChoiceModal] = useState({ show: false, bothCount: 0, scopeLabel: 'selected files' });

    const installedSearchRef = useRef();
    const findSearchRef = useRef();
    const sourceChoiceResolverRef = useRef(null);
    const hasPrefetchedPopularRef = useRef(false);
    const previousFindProviderRef = useRef(findProvider);

    const loadInstalledDatapacks = useCallback(async () => {
        setLoading(true);
        try {
            const packs = await invoke('get_world_datapacks', {
                instanceId: instance.id,
                worldName: world.folder_name
            });
            setInstalledDatapacks(packs);
        } catch (error) {
            console.error('Failed to load datapacks:', error);
            if (onShowNotification) {
                onShowNotification('Failed to load datapacks: ' + error, 'error');
            }
        }
        setLoading(false);
    }, [instance.id, world.folder_name, onShowNotification]);

    const activeFilterCategories = useMemo(
        () => (activeSubTab === 'find' && findProvider === 'curseforge' ? CURSEFORGE_DATAPACK_CATEGORIES : MODRINTH_DATAPACK_CATEGORIES),
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
        popularItems: popularDatapacks,
        searching,
        loadingPopular,
        loadingMore,
        canLoadMore,
        handleSearch,
        loadPopularItems: loadPopularDatapacks,
        loadMore,
        resetFeed
    } = useModrinthSearch({
        provider: findProvider,
        projectType: 'datapack',
        gameVersion: instance.version_id,
        loader: 'datapack',
        categories: effectiveFindCategories,
        query: findSearchQuery,
        withPopular: true,
        searchEmptyQuery: false
    });

    const executeFindSearch = useCallback((queryOverride = searchQuery, categoriesOverride = selectedCategories) => {
        if (findProvider === 'curseforge' && !hasCurseForgeKey) return;
        const categoryQueryValues = Array.isArray(categoriesOverride)
            ? resolveSelectedCategoryQueryValues(activeFilterCategories, categoriesOverride)
            : selectedCategoryQueryValues;

        setFindSearchQuery(queryOverride);
        setAppliedFindCategories(categoriesOverride);

        if (queryOverride.trim() === '' && categoriesOverride.length === 0) {
            loadPopularDatapacks();
            return;
        }

        handleSearch(0, queryOverride, categoryQueryValues);
    }, [searchQuery, selectedCategories, findProvider, hasCurseForgeKey, loadPopularDatapacks, handleSearch, activeFilterCategories, selectedCategoryQueryValues]);

    // Effects
    useEffect(() => {
        loadInstalledDatapacks();
    }, [world.folder_name, loadInstalledDatapacks, refreshNonce]);

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
        if (activeSubTab !== 'find') return;
        if (findProvider === 'curseforge' && !hasCurseForgeKey) return;
        if (findSearchQuery.trim() !== '' || appliedFindCategories.length > 0) return;
        loadPopularDatapacks();
    }, [activeSubTab, findProvider, hasCurseForgeKey, findSearchQuery, appliedFindCategories.length, loadPopularDatapacks]);

    useEffect(() => {
        setSearchQuery('');
        setFindSearchQuery('');
        setSelectedCategories([]);
        setAppliedFindCategories([]);
        setSelectedItems([]);
        setCurseForgeVersionLabels({});
        resetFeed();
        hasPrefetchedPopularRef.current = false;
    }, [world.folder_name, resetFeed]);

    useEffect(() => {
        let cancelled = false;

        const unresolved = installedDatapacks.filter((dp) => {
            if (!isCurseForgeProjectId(dp.project_id) || !dp.version_id) return false;
            const key = `${dp.project_id}:${dp.version_id}`;
            if (curseForgeVersionLabels[key]) return false;
            return !formatInstalledVersionLabel(dp.version, dp.provider, dp.filename);
        });

        if (unresolved.length === 0) return;

        const byProject = new Map();
        for (const dp of unresolved) {
            const projectId = String(dp.project_id || '').trim();
            const versionId = String(dp.version_id || '').trim();
            if (!projectId || !versionId) continue;
            if (!byProject.has(projectId)) byProject.set(projectId, new Set());
            byProject.get(projectId).add(versionId);
        }

        const loadLabels = async () => {
            const updates = {};

            for (const [projectId, versionIds] of byProject.entries()) {
                try {
                    const versions = await invoke('get_curseforge_modpack_versions', { projectId });
                    for (const versionEntry of Array.isArray(versions) ? versions : []) {
                        const versionId = String(versionEntry?.id || '').trim();
                        if (!versionId || !versionIds.has(versionId)) continue;
                        const label = resolveCurseForgeVersionLabelFromEntry(versionEntry);
                        if (!label) continue;
                        updates[`${projectId}:${versionId}`] = label;
                    }
                } catch (error) {
                    console.warn(`Failed to resolve CurseForge version label for project ${projectId}:`, error);
                }
            }

            if (!cancelled && Object.keys(updates).length > 0) {
                setCurseForgeVersionLabels((prev) => ({ ...prev, ...updates }));
            }
        };

        loadLabels();

        return () => {
            cancelled = true;
        };
    }, [installedDatapacks, curseForgeVersionLabels]);

    useEffect(() => {
        if (previousFindProviderRef.current === findProvider) return;
        previousFindProviderRef.current = findProvider;
        hasPrefetchedPopularRef.current = false;
        if (activeSubTab !== 'find') return;
        setSearchQuery('');
        setFindSearchQuery('');
        setSelectedCategories([]);
        setAppliedFindCategories([]);
        resetFeed();

        if (findProvider === 'curseforge' && !hasCurseForgeKey) return;
        loadPopularDatapacks();
    }, [activeSubTab, findProvider, hasCurseForgeKey, loadPopularDatapacks, resetFeed]);

    useEffect(() => {
        if (hasPrefetchedPopularRef.current) return;
        if (findProvider === 'curseforge' && !hasCurseForgeKey) return;

        hasPrefetchedPopularRef.current = true;
        loadPopularDatapacks();
    }, [findProvider, hasCurseForgeKey, loadPopularDatapacks]);

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

    const filteredInstalledDatapacks = useMemo(() => {
        return installedDatapacks.filter(p => {
            const matchesSearch = !searchQuery.trim() ||
                (p.name || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
                (p.filename || '').toLowerCase().includes(searchQuery.toLowerCase());
            const matchesCategories = selectedCategories.length === 0 ||
                (p.categories && selectedCategories.every(cat => p.categories.includes(cat)));
            return matchesSearch && matchesCategories;
        });
    }, [installedDatapacks, searchQuery, selectedCategories]);

    const matchesAllSelectedCategories = useCallback((project) => {
        if (findProvider === 'curseforge') return true;
        return matchesSelectedCategories(project, appliedFindCategories);
    }, [findProvider, appliedFindCategories]);

    const displayItems = useMemo(() => {
        const base = (findSearchQuery.trim() || appliedFindCategories.length > 0) ? searchResults : popularDatapacks;
        return base.filter(matchesAllSelectedCategories);
    }, [findSearchQuery, appliedFindCategories, searchResults, popularDatapacks, matchesAllSelectedCategories]);
    const hasAppliedFindFilters = findSearchQuery.trim().length > 0 || appliedFindCategories.length > 0;

    // Helpers
    const getInstalledItem = (project) => {
        return findInstalledProject(installedDatapacks, project);
    };

    const isDatapackInstalled = (project) => {
        return !!getInstalledItem(project);
    };

    const handleToggleSelect = useCallback((filename) => {
        setSelectedItems(prev =>
            prev.includes(filename)
                ? prev.filter(f => f !== filename)
                : [...prev, filename]
        );
    }, []);

    const handleSelectAll = useCallback(() => {
        if (selectedItems.length > 0 && selectedItems.length === installedDatapacks.length) {
            setSelectedItems([]);
        } else {
            setSelectedItems(installedDatapacks.map(item => item.filename));
        }
    }, [selectedItems.length, installedDatapacks]);

    const handleBulkDelete = useCallback(async () => {
        if (selectedItems.length === 0) return;

        onShowConfirm?.({
            title: 'Delete Datapacks',
            message: `Are you sure you want to delete ${selectedItems.length} selected datapack${selectedItems.length > 1 ? 's' : ''}?`,
            confirmText: 'Delete',
            cancelText: 'Cancel',
            variant: 'danger',
            onConfirm: async () => {
                for (const filename of selectedItems) {
                    try {
                        await invoke('delete_instance_datapack', {
                            instanceId: instance.id,
                            worldName: world.folder_name,
                            filename: filename
                        });
                    } catch (err) {
                        console.error(`Failed to delete ${filename}:`, err);
                    }
                }
                setSelectedItems([]);
                loadInstalledDatapacks();
                if (onShowNotification) {
                    onShowNotification(`Successfully deleted ${selectedItems.length} datapacks.`, 'success');
                }
            }
        });
    }, [selectedItems, instance.id, world.folder_name, loadInstalledDatapacks, onShowNotification, onShowConfirm]);

    const handleRequestInstall = useCallback((project, updateItem = null) => {
        setVersionModal({ show: true, project, updateItem: updateItem });
    }, []);

    const handleInstall = useCallback(async (project, version, skipDeps = false, updateItem = null) => {
        const resolvedProjectId = String(project?.project_id || project?.id || project?.slug || updateItem?.project_id || '').trim();
        const providerLabel = normalizeProviderLabel(
            project?.provider_label || project?.provider || updateItem?.provider,
            resolvedProjectId
        );
        const provider = providerLabel.toLowerCase();
        const downloadId = resolvedProjectId || updateItem?.filename || project?.slug;

        if (onQueueDownload) {
            onQueueDownload({
                id: downloadId,
                name: project.title || project.name,
                icon: project.icon_url || project.thumbnail,
                status: 'Preparing...'
            });
        }

        setInstalling(resolvedProjectId || project.slug || project.project_id || project.id);
        if (updateItem) {
            setUpdatingItems(prev => [...prev, updateItem.filename]);
        }

        try {
            if (onUpdateDownloadStatus) {
                onUpdateDownloadStatus(downloadId, 'Fetching version...');
            }

            let resolvedVersion = version;
            if (provider === 'modrinth' && !resolvedVersion) {
                const versions = await invoke('get_modrinth_versions', {
                    projectId: project.slug || project.project_id || resolvedProjectId,
                    gameVersion: instance.version_id,
                    loader: 'datapack'
                });
                if (!versions || versions.length === 0) {
                    if (onShowNotification) {
                        onShowNotification('No compatible version found', 'error');
                    }
                    setInstalling(null);
                    if (onDequeueDownload) {
                        onDequeueDownload(downloadId, false);
                    }
                    if (updateItem) {
                        setUpdatingItems(prev => prev.filter(f => f !== updateItem.filename));
                    }
                    return;
                }
                resolvedVersion = versions[0];
            }

            let installedFilename = '';
            if (provider === 'curseforge') {
                if (!resolvedProjectId) {
                    throw new Error('Missing CurseForge project ID');
                }
                if (!resolvedVersion) {
                    const cfVersions = await invoke('get_curseforge_modpack_versions', { projectId: resolvedProjectId });
                    if (!Array.isArray(cfVersions) || cfVersions.length === 0) {
                        throw new Error('No compatible CurseForge file found');
                    }
                    const sorted = [...cfVersions].sort((a, b) => new Date(b.date_published) - new Date(a.date_published));
                    resolvedVersion = sorted[0];
                }

                const file = resolvedVersion?.files?.find((f) => String(f.filename || '').toLowerCase().endsWith('.zip'))
                    || resolvedVersion?.files?.find((f) => f.primary)
                    || resolvedVersion?.files?.[0];
                if (!file) {
                    throw new Error('Selected CurseForge version has no downloadable file');
                }
                installedFilename = file.filename || `${resolvedProjectId}-${resolvedVersion.id}.zip`;

                if (onUpdateDownloadStatus) {
                    onUpdateDownloadStatus(downloadId, 'Downloading...');
                }

                await invoke('install_curseforge_file', {
                    instanceId: instance.id,
                    projectId: resolvedProjectId,
                    fileId: resolvedVersion.id,
                    fileType: 'datapack',
                    filename: installedFilename,
                    fileUrl: file.url || null,
                    worldName: world.folder_name,
                    iconUrl: project.icon_url || project.thumbnail || updateItem?.icon_url || null,
                    name: project.title || project.name || updateItem?.name || null,
                    author: project.author || updateItem?.author || null,
                    versionName: resolveCurseForgeInstallVersionName(resolvedVersion, file, instance.version_id),
                    categories: project.categories || project.display_categories || (updateItem ? updateItem.categories : null) || null
                });
            } else {
                // Prefer .zip files for datapacks if available, otherwise fallback to primary or first file
                const file = resolvedVersion.files.find(f => f.filename.toLowerCase().endsWith('.zip')) ||
                    resolvedVersion.files.find(f => f.primary) ||
                    resolvedVersion.files[0];
                installedFilename = file.filename;

                if (onUpdateDownloadStatus) {
                    onUpdateDownloadStatus(downloadId, 'Downloading...');
                }

                await invoke('install_modrinth_file', {
                    instanceId: instance.id,
                    fileUrl: file.url,
                    filename: file.filename,
                    fileType: 'datapack',
                    projectId: resolvedProjectId || project.slug || project.id,
                    versionId: resolvedVersion.id,
                    worldName: world.folder_name,
                    iconUrl: project.icon_url || project.thumbnail,
                    name: project.title || project.name,
                    author: project.author,
                    versionName: resolvedVersion.version_number,
                    categories: project.categories || project.display_categories || (updateItem ? updateItem.categories : null) || null
                });
            }

            // If updating, delete the old file
            if (updateItem && updateItem.filename !== installedFilename) {
                if (import.meta.env.DEV) {
                    invoke('log_event', { level: 'info', message: `Deleting old datapack: ${updateItem.filename}` }).catch(() => { });
                }
                await invoke('delete_instance_datapack', {
                    instanceId: instance.id,
                    worldName: world.folder_name,
                    filename: updateItem.filename
                });
            }

            if (onShowNotification) {
                onShowNotification(`Successfully ${updateItem ? 'updated' : 'installed'} ${project.title || project.name}`, 'success');
            }

            await loadInstalledDatapacks();
        } catch (error) {
            console.error('Failed to install datapack:', error);
            const handledCurseForgeRestriction = await maybeShowCurseForgeBlockedDownloadModal({
                error,
                provider,
                project,
                projectId: resolvedProjectId,
                onShowConfirm,
                onShowNotification,
            });
            if (!handledCurseForgeRestriction && onShowNotification) {
                onShowNotification('Failed to install datapack: ' + error, 'error');
            }
        }
        setInstalling(null);
        if (onDequeueDownload) {
            setTimeout(() => onDequeueDownload(downloadId), 1000);
        }
        if (updateItem) {
            setUpdatingItems(prev => prev.filter(f => f !== updateItem.filename));
        }
    }, [instance.id, instance.version_id, world.folder_name, onShowNotification, onShowConfirm, loadInstalledDatapacks, onQueueDownload, onDequeueDownload, onUpdateDownloadStatus]);

    const handleDelete = useCallback((datapack) => {
        setDeleteConfirm({ show: true, datapack });
    }, []);

    const handleToggleDatapack = useCallback(async (datapack) => {
        try {
            await invoke('toggle_instance_datapack', {
                instanceId: instance.id,
                worldName: world.folder_name,
                filename: datapack.filename
            });
            await loadInstalledDatapacks();
        } catch (error) {
            console.error('Failed to toggle datapack:', error);
            onShowNotification?.(`Failed to toggle datapack: ${error}`, 'error');
        }
    }, [instance.id, world.folder_name, loadInstalledDatapacks, onShowNotification]);

    const handleImportFile = async () => {
        try {
            const selected = await open({
                multiple: true,
                filters: [{
                    name: 'Datapacks',
                    extensions: ['zip']
                }]
            });

            if (selected && selected.length > 0) {
                for (const path of selected) {
                    await invoke('import_instance_file', {
                        instanceId: instance.id,
                        sourcePath: path,
                        folderType: 'datapacks',
                        worldName: world.folder_name
                    });
                }
                await loadInstalledDatapacks();
                if (onShowNotification) {
                    onShowNotification(`Imported ${selected.length} datapack${selected.length > 1 ? 's' : ''}`, 'success');
                }
            }
        } catch (error) {
            console.error('Failed to import datapacks:', error);
            if (onShowNotification) {
                onShowNotification('Failed to import datapacks: ' + error, 'error');
            }
        }
    };

    const handleOpenFolder = async () => {
        try {
            await invoke('open_instance_datapacks_folder', {
                instanceId: instance.id,
                worldName: world.folder_name
            });
        } catch (error) {
            console.error('Failed to open datapacks folder:', error);
            if (onShowNotification) {
                onShowNotification(`Failed to open datapacks folder: ${error}`, 'error');
            }
        }
    };

    const handleCopyShareCode = useCallback(async () => {
        try {
            const code = await invoke('get_instance_share_code', { instanceId: instance.id });
            await navigator.clipboard.writeText(code);
            onShowNotification?.('Share code copied! Includes supported Modrinth and CurseForge files; manual files are not included.', 'success');
        } catch (error) {
            console.error('Failed to generate share code:', error);
            onShowNotification?.(`Failed to generate share code: ${error}`, 'error');
        }
    }, [instance.id, onShowNotification]);

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

    const handleResolveManualMetadata = useCallback(async () => {
        if (isResolvingManual) return;
        setIsResolvingManual(true);
        try {
            const previewResult = await invoke('resolve_manual_modrinth_metadata', {
                instanceId: instance.id,
                fileType: 'datapack',
                worldName: world.folder_name,
                dryRun: true
            });

            if (previewResult.scanned === 0) {
                onShowNotification?.('No manual datapacks available to check.', 'info');
                return;
            }

            if (previewResult.matched === 0) {
                onShowNotification?.('Couldn\'t find matches on Modrinth/CurseForge for these datapacks.', 'info');
                return;
            }

            let preferredSource;
            if ((previewResult.both_sources || 0) > 0) {
                preferredSource = await requestSourceChoice(previewResult.both_sources, 'selected datapacks');
                if (!preferredSource) {
                    onShowNotification?.('Manual metadata check cancelled.', 'info');
                    return;
                }
            }

            const result = await invoke('resolve_manual_modrinth_metadata', {
                instanceId: instance.id,
                fileType: 'datapack',
                worldName: world.folder_name,
                preferredSource
            });
            await loadInstalledDatapacks();
            if (onShowNotification) {
                if (result.updated > 0) {
                    onShowNotification(`Matched ${result.updated}/${result.scanned} datapack file${result.updated === 1 ? '' : 's'} on Modrinth/CurseForge.`, 'success');
                } else if (result.scanned > 0) {
                    onShowNotification('Couldn\'t find matches on Modrinth/CurseForge for these datapacks.', 'info');
                } else {
                    onShowNotification('No manual datapacks available to check.', 'info');
                }
            }
        } catch (error) {
            console.error('Failed to resolve datapacks on Modrinth/CurseForge:', error);
            onShowNotification?.(`Failed to check Modrinth/CurseForge: ${error}`, 'error');
        } finally {
            setIsResolvingManual(false);
        }
    }, [instance.id, world.folder_name, loadInstalledDatapacks, onShowNotification, isResolvingManual, requestSourceChoice]);

    const handleBulkCheckUpdates = useCallback(async () => {
        const tracked = installedDatapacks.filter((p) => p.project_id && (!p.provider || p.provider !== 'Manual'));
        if (tracked.length === 0) return;

        setIsCheckingUpdates(true);
        try {
            const rows = await invoke('get_instance_mod_updates', {
                instanceId: instance.id,
                fileType: 'datapack',
                worldName: world.folder_name
            });
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
                    onShowNotification(`Found updates for ${count} datapack${count > 1 ? 's' : ''}!`, 'info');
                } else {
                    onShowNotification('All datapacks are up to date.', 'success');
                }
            }
        } catch (error) {
            console.error('Datapack update check failed:', error);
            onShowNotification?.(`Failed to check updates: ${error}`, 'error');
        } finally {
            setIsCheckingUpdates(false);
        }
    }, [installedDatapacks, instance.id, world.folder_name, onShowNotification]);

    const handleUpdateAll = useCallback(async () => {
        const managed = installedDatapacks.filter((p) => p.project_id && (!p.provider || p.provider !== 'Manual'));
        const toUpdate = managed.filter((item) => updatesFound[item.project_id]);
        if (toUpdate.length === 0) return;

        onShowConfirm?.({
            title: 'Update Datapacks',
            message: `Would you like to update ${toUpdate.length} datapack${toUpdate.length > 1 ? 's' : ''} to the latest version?`,
            confirmText: 'Update All',
            cancelText: 'Cancel',
            variant: 'primary',
            onConfirm: async () => {
                for (const item of toUpdate) {
                    const updateRow = updatesFound[item.project_id];
                    const latestVersion = getUpdateRowLatestVersion(updateRow);
                    if (!latestVersion) continue;
                    try {
                        const provider = normalizeProviderLabel(updateRow?.provider || item.provider, item.project_id);
                        const project = provider === 'CurseForge'
                            ? await invoke('get_curseforge_modpack', { projectId: item.project_id })
                            : await invoke('get_modrinth_project', { projectId: item.project_id });
                        await handleInstall({
                            ...project,
                            project_id: item.project_id,
                            slug: item.project_id,
                            provider_label: provider,
                            project_type: 'datapack'
                        }, latestVersion, true, item);
                    } catch (error) {
                        console.error(`Failed to update datapack ${item.name}:`, error);
                    }
                }
                setUpdatesFound({});
                onShowNotification?.('Completed datapack updates', 'info');
            }
        });
    }, [installedDatapacks, updatesFound, onShowConfirm, handleInstall, onShowNotification]);

    const confirmDelete = useCallback(async () => {
        const dp = deleteConfirm.datapack;
        setDeleteConfirm({ show: false, datapack: null });

        try {
            await invoke('delete_instance_datapack', {
                instanceId: instance.id,
                worldName: world.folder_name,
                filename: dp.filename
            });
            await loadInstalledDatapacks();
        } catch (error) {
            console.error('Failed to delete datapack:', error);
        }
    }, [instance.id, world.folder_name, deleteConfirm.datapack, loadInstalledDatapacks]);

    const formatDownloads = (num) => {
        if (num >= 1000000) return (num / 1000000).toFixed(1) + 'M';
        if (num >= 1000) return (num / 1000).toFixed(1) + 'K';
        return num.toString();
    };

    return (
        <div className="datapacks-view">
            {!hideTabBar && (
                <div className={`sub-tabs-row ${isScrolled ? 'scrolled' : ''}`}>
                    <SubTabs
                        tabs={[
                            { id: 'installed', label: `Installed (${installedDatapacks.length})` },
                            { id: 'find', label: 'Find Datapacks' }
                        ]}
                        activeTab={activeSubTab}
                        onTabChange={setActiveSubTab}
                    />
                    <div className="sub-tabs-actions">
                        {activeSubTab === 'installed' && (
                            <>
                                <button className="open-folder-btn" onClick={handleImportFile} title="Add Datapack ZIP File">
                                    <Plus size={16} />
                                    <span>Add Datapack</span>
                                </button>
                                <button
                                    className="open-folder-btn"
                                    onClick={handleOpenFolder}
                                    title="Open Datapacks Folder"
                                >
                                    <span aria-hidden="true">📁</span>
                                    <span>Folder</span>
                                </button>
                            </>
                        )}
                    </div>
                </div>
            )}

            <FilterModal
                isOpen={isFilterModalOpen}
                onClose={() => setIsFilterModalOpen(false)}
                categories={activeFilterCategories}
                selectedCategories={selectedCategories}
                onApply={setSelectedCategories}
                title={activeSubTab === 'find' && findProvider === 'curseforge' ? 'CurseForge Datapack Categories' : 'Datapack Categories'}
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

            {activeSubTab === 'installed' ? (
                <div className="installed-section">
                    {loading ? (
                        <p>Loading...</p>
                    ) : installedDatapacks.length === 0 ? (
                        <div className="empty-state">
                            <p>No datapacks installed for this world.</p>
                        </div>
                    ) : filteredInstalledDatapacks.length === 0 ? (
                        <div className="empty-state">
                            <p>No datapacks matching your filters {searchQuery ? `("${searchQuery}")` : ''}</p>
                            <button className="text-btn" onClick={() => { setSearchQuery(''); setSelectedCategories([]); }}>Clear all filters</button>
                        </div>
                    ) : (
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
                                            ref={installedSearchRef}
                                            type="text"
                                            placeholder="Search installed datapacks..."
                                            value={searchQuery}
                                            onChange={(e) => setSearchQuery(e.target.value)}
                                        />
                                        {searchQuery && (
                                            <button className="clear-search-btn" onClick={() => setSearchQuery('')} title="Clear search">
                                                <X size={14} />
                                            </button>
                                        )}
                                    </div>
                                </div>
                                <button className="search-btn" onClick={() => installedSearchRef.current?.focus()}>
                                    Search
                                </button>
                            </div>

                            {installedDatapacks.filter(p => p.project_id && (!p.provider || p.provider !== 'Manual')).length > 0 && (
                                <div className="mod-group">
                                    <div className="group-header">
                                        <h3 className="group-title">Managed</h3>
                                        <div className="group-header-line"></div>
                                        <button className="select-all-btn-inline" onClick={handleSelectAll}>
                                            <div className={`selection-checkbox mini ${selectedItems.length === installedDatapacks.length && installedDatapacks.length > 0 ? 'checked' : ''}`}>
                                                {selectedItems.length === installedDatapacks.length && installedDatapacks.length > 0 && <Check size={10} />}
                                            </div>
                                            <span>{selectedItems.length === installedDatapacks.length && installedDatapacks.length > 0 ? 'Deselect All' : 'Select All'}</span>
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
                                        <button className="copy-code-btn" onClick={handleCopyShareCode} title="Copy Share Code">
                                            <Copy size={12} />
                                            <span>Copy Code</span>
                                        </button>
                                    </div>
                                    <div className="installed-list">
                                        {filteredInstalledDatapacks
                                            .filter(p => p.project_id && (!p.provider || p.provider !== 'Manual'))
                                            .sort((a, b) => (a.name || a.filename).localeCompare(b.name || b.filename))
                                            .map((dp) => {
                                                const isUpdating = updatingItems.includes(dp.filename);
                                                const isSelected = selectedItems.includes(dp.filename);
                                                const formattedVersion = formatInstalledVersionLabel(dp.version, dp.provider, dp.filename);
                                                const curseForgeResolvedLabel = isCurseForgeProjectId(dp.project_id) && dp.version_id
                                                    ? curseForgeVersionLabels[`${dp.project_id}:${dp.version_id}`] || null
                                                    : null;
                                                const versionLabel = withVersionPrefix(formattedVersion || curseForgeResolvedLabel);
                                                return (
                                                    <InstalledContentRow
                                                        key={dp.filename}
                                                        item={dp}
                                                        isUpdating={isUpdating}
                                                        isSelected={isSelected}
                                                        selectionModeActive={selectedItems.length > 0}
                                                        versionLabel={versionLabel || 'Unknown version'}
                                                        showUpdateBadge={Boolean(updatesFound[dp.project_id])}
                                                        authorFallback="Unknown author"
                                                        onToggleSelect={handleToggleSelect}
                                                        onInfoAction={() => handleRequestInstall({
                                                            project_id: dp.project_id,
                                                            title: dp.name,
                                                            slug: dp.project_id,
                                                            icon_url: dp.icon_url,
                                                            project_type: 'datapack',
                                                            provider_label: normalizeProviderLabel(dp.provider, dp.project_id),
                                                            categories: dp.categories
                                                        }, dp)}
                                                        onToggleEnabled={() => handleToggleDatapack(dp)}
                                                        onDelete={() => handleDelete(dp)}
                                                        infoTitle="Open project info"
                                                        deleteTitle="Delete datapack"
                                                        updatingLabel="Updating..."
                                                    />
                                                );
                                            })}
                                    </div>
                                </div>
                            )}
                            {installedDatapacks.filter(p => !p.project_id || !p.provider || p.provider === 'Manual').length > 0 && (
                                <div className="mod-group">
                                    <div className="group-header">
                                        <h3 className="group-title">Manual</h3>
                                        <div className="group-header-line"></div>
                                        <button
                                            className={`resolve-modrinth-btn-inline ${isResolvingManual ? 'loading' : ''}`}
                                            onClick={handleResolveManualMetadata}
                                            disabled={isResolvingManual}
                                            title="Find metadata for manual files"
                                        >
                                            {isResolvingManual ? <Loader2 size={12} className="spin" /> : <Wand2 size={12} />}
                                            <span>Find on Modrinth/CurseForge</span>
                                        </button>
                                    </div>
                                    <div className="installed-list">
                                        {filteredInstalledDatapacks
                                            .filter(p => !p.project_id || !p.provider || p.provider === 'Manual')
                                            .sort((a, b) => (a.name || a.filename).localeCompare(b.name || b.filename))
                                            .map((dp) => {
                                                const isSelected = selectedItems.includes(dp.filename);
                                                return (
                                                    <InstalledContentRow
                                                        key={dp.filename}
                                                        item={dp}
                                                        isUpdating={false}
                                                        isSelected={isSelected}
                                                        selectionModeActive={selectedItems.length > 0}
                                                        versionLabel="Unknown version"
                                                        platformLabel="Manual"
                                                        authorFallback="Manual file"
                                                        onToggleSelect={handleToggleSelect}
                                                        onToggleEnabled={() => handleToggleDatapack(dp)}
                                                        onDelete={() => handleDelete(dp)}
                                                        infoTitle="Project info unavailable"
                                                        deleteTitle="Delete datapack"
                                                    />
                                                );
                                            })}
                                    </div>
                                </div>
                            )}
                        </div>
                    )}
                </div>
            ) : (
                <div className="find-section">
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
                                        placeholder={findProvider === 'curseforge' ? 'Search CurseForge datapacks...' : 'Search Modrinth for datapacks...'}
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
                            {hasAppliedFindFilters ? 'Search Results' : 'Popular Datapacks'}
                        </h3>

                        {findProvider === 'curseforge' && !hasCurseForgeKey ? (
                            <div className="empty-state error-state">
                                <p style={{ color: '#ef4444' }}>CurseForge key not configured</p>
                                <p style={{ fontSize: '12px', color: '#888', marginTop: '8px' }}>
                                    Set `CURSEFORGE_API_KEY` for backend runtime.
                                </p>
                            </div>
                        ) : (searching || loadingPopular) ? (
                            <div className="loading-mods">Loading...</div>
                        ) : (
                            <div className="search-results-viewport">
                                <div className="search-results">
                                    {displayItems.map((project, index) => {
                                        const installedItem = getInstalledItem(project);
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
                                                        <img src={project.icon_url} alt="" className="result-icon" />
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
                                                    </div>
                                                    {installedItem ? (
                                                        <button
                                                            className="install-btn reinstall"
                                                            onClick={() => handleRequestInstall({
                                                                ...project,
                                                                provider_label: findProvider === 'curseforge' ? 'CurseForge' : 'Modrinth',
                                                                project_type: 'datapack',
                                                                categories: project.categories || installedItem.categories
                                                            }, installedItem)}
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
                                                                project_type: 'datapack'
                                                            })}
                                                            disabled={isDownloading}
                                                        >
                                                            Install
                                                        </button>
                                                    )}
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                                {displayItems.length === 0 && (
                                    <div className="empty-state">
                                        <p>
                                            {hasAppliedFindFilters
                                                ? `No datapacks found for "${findSearchQuery || (appliedFindCategories.length > 0 ? `${appliedFindCategories.length} filters applied` : '')}".`
                                                : 'No popular datapacks available for this version.'}
                                        </p>
                                    </div>
                                )}
                                {canLoadMore && (
                                    <div className="search-load-more-actions">
                                        <button
                                            className="search-load-more-btn"
                                            onClick={loadMore}
                                            disabled={loadingMore || searching || loadingPopular}
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

            {deleteConfirm.show && (
                <ConfirmModal
                    isOpen={deleteConfirm.show}
                    title="Delete Datapack"
                    message={`Are you sure you want to delete "${deleteConfirm.datapack?.name || deleteConfirm.datapack?.filename}"?`}
                    confirmText="Delete"
                    cancelText="Cancel"
                    variant="danger"
                    onConfirm={confirmDelete}
                    onCancel={() => setDeleteConfirm({ show: false, datapack: null })}
                />
            )}

            {versionModal.show && (
                <ModVersionModal
                    project={versionModal.project}
                    projectId={versionModal.project?.project_id || versionModal.project?.id || versionModal.project?.slug}
                    gameVersion={instance.version_id}
                    loader={null}
                    installedMod={versionModal.updateItem || (versionModal.project ? getInstalledItem(versionModal.project) : null)}
                    onClose={() => setVersionModal({ show: false, project: null, updateItem: null })}
                    onSelect={(version) => {
                        handleInstall(versionModal.project, version, false, versionModal.updateItem);
                        setVersionModal({ show: false, project: null, updateItem: null });
                    }}
                    onReinstall={({ project: modalProject, version, installedItem }) => {
                        const projectItem = modalProject || versionModal.project;
                        const updateItem = installedItem || versionModal.updateItem;
                        handleInstall(projectItem, version, false, updateItem);
                        setVersionModal({ show: false, project: null, updateItem: null });
                    }}
                />
            )}

            {selectedItems.length > 0 && (
                <div className="bulk-actions-wrapper">
                    <div className="bulk-actions-bar">
                        <div className="bulk-info">
                            <span className="selected-count">{selectedItems.length} datapacks selected</span>
                            <button className="clear-selection-btn" onClick={() => setSelectedItems([])}>Deselect all</button>
                        </div>
                        <div className="bulk-btns">
                            <button className="bulk-action-btn danger" onClick={handleBulkDelete}>
                                <Trash2 size={13} />
                                Delete
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

export default WorldDatapacks;
