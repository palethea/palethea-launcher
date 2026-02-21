import { useEffect, useLayoutEffect, useState, useMemo, useCallback, useRef } from 'react';
import { Clock, Plus, Box, LayoutGrid, List, ChevronDown, Check, User, UserRoundCheck, UsersRound, Tag, CalendarDays, Play, Square, MoreVertical, X, Boxes, Info, Server, ServerOff, GripVertical, Pencil, Trash2 } from 'lucide-react';
import { invoke, convertFileSrc } from '@tauri-apps/api/core';
import { sep } from '@tauri-apps/api/path';
import { clampProgress, formatBytes, formatSpeed } from '../utils/downloadTelemetry';
import ModpackInfoModal from './ModpackInfoModal';
import './InstanceList.css';

const STEVE_HEAD_DATA = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAIAAABLbSncAAAARklEQVQI12NgoAbghLD+I4kwBqOjo+O/f/8YGBj+MzD8Z2D4z8Dwnwmq7P9/BoYL5y8g0/8hHP7/x0b/Y2D4D5b5/58ZAME2EVcxlvGVAAAAAElFTkSuQmCC';
const ACCOUNT_AVATAR_SIZE = 34;
const PREFERRED_SERVER_STORAGE_KEY = 'instance-preferred-server-map';
const CARD_LAYOUT_ANIMATION_DURATION_MS = 280;
const CARD_LAYOUT_ANIMATION_EASING = 'cubic-bezier(0.2, 0.82, 0.26, 1)';
const CARD_LAYOUT_SCALE_STRENGTH = 0.1;
const CATEGORY_FILTER_ALL = '__all__';
const CATEGORY_FILTER_UNCATEGORIZED = '__uncategorized__';
const CATEGORY_LIST_STORAGE_KEY = 'instance-category-list';
const CATEGORY_LIST_UPDATED_EVENT = 'instance-category-list-updated';
const OPEN_CATEGORY_MANAGER_EVENT = 'open-instance-category-manager';
const INSTANCE_HEADER_DOCK_OPEN_KEY = 'instance_header_center_dock_open';
const INSTANCE_HEADER_STYLE_CACHE_KEY = 'instance_header_style_cache';
const CENTER_DOCK_ANIMATION_MS = 380;
const SORT_OPTIONS = new Set(['name', 'age', 'playtime']);
const toCategoryKey = (value) => (typeof value === 'string' ? value.trim().toLowerCase() : '');

function SkinHead2D({ src, size = 28 }) {
  return (
    <div className="instance-head-2d" style={{ width: `${size}px`, height: `${size}px` }}>
      <div
        className="head-base"
        style={{
          backgroundImage: `url("${src}")`,
          width: `${size}px`,
          height: `${size}px`,
          backgroundSize: `${size * 8}px auto`,
          backgroundPosition: `-${size}px -${size}px`
        }}
      />
      <div
        className="head-overlay"
        style={{
          backgroundImage: `url("${src}")`,
          width: `${size}px`,
          height: `${size}px`,
          backgroundSize: `${size * 8}px auto`,
          backgroundPosition: `-${size * 5}px -${size}px`
        }}
      />
    </div>
  );
}

function InstanceList({
  instances,
  onLaunch,
  onStop,
  onCreate,
  onEditInstance,
  onContextMenu,
  onInstancesRefresh,
  onShowNotification,
  skinCache = {},
  isLoading,
  launchingInstanceIds = [],
  launchingInstanceId = null,
  loadingStatus = '',
  loadingProgress = 0,
  loadingBytes = { current: 0, total: 0 },
  loadingCount = { current: 0, total: 0 },
  loadingTelemetry = { stageLabel: '', currentItem: '', speedBps: 0, etaSeconds: null },
  launchProgressByInstance = {},
  runningInstances = {},
  stoppingInstanceIds = [],
  deletingInstanceIds = [],
  launcherSettings = null,
  backgroundTasks = [],
  setupProgressByInstance = {},
  onQueueDownload = null,
  onUpdateDownloadStatus = null,
  onDequeueDownload = null
}) {
  const [logoMap, setLogoMap] = useState({});
  const [sortBy, setSortBy] = useState(() => {
    const savedSort = localStorage.getItem('instance_sort') || 'name';
    return SORT_OPTIONS.has(savedSort) ? savedSort : 'name';
  });
  const [categoryFilter, setCategoryFilter] = useState(localStorage.getItem('instance_category_filter') || CATEGORY_FILTER_ALL);
  const [viewMode, setViewMode] = useState(localStorage.getItem('instance_view_mode') || 'list');
  const [isEntering, setIsEntering] = useState(true);
  const [isSortOpen, setIsSortOpen] = useState(false);
  const [isCategoryFilterOpen, setIsCategoryFilterOpen] = useState(false);
  const [categoryList, setCategoryList] = useState([]);
  const [collapsedCategorySections, setCollapsedCategorySections] = useState({});
  const [showCategoryManagerModal, setShowCategoryManagerModal] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState('');
  const [bulkCategoryTarget, setBulkCategoryTarget] = useState('');
  const [isBulkCategoryDropdownOpen, setIsBulkCategoryDropdownOpen] = useState(false);
  const [bulkSelectedInstanceIds, setBulkSelectedInstanceIds] = useState([]);
  const [bulkUpdatingCategories, setBulkUpdatingCategories] = useState(false);
  const [editingCategoryKey, setEditingCategoryKey] = useState('');
  const [editingCategoryValue, setEditingCategoryValue] = useState('');
  const [pendingDeleteCategoryKey, setPendingDeleteCategoryKey] = useState('');
  const [draggedCategoryKey, setDraggedCategoryKey] = useState('');
  const [dragOverCategoryKey, setDragOverCategoryKey] = useState('');
  const [savedAccounts, setSavedAccounts] = useState([]);
  const [activeAccountUsername, setActiveAccountUsername] = useState('');
  const [showAccountModal, setShowAccountModal] = useState(false);
  const [accountPickerInstance, setAccountPickerInstance] = useState(null);
  const [showServerPickerModal, setShowServerPickerModal] = useState(false);
  const [serverPickerInstance, setServerPickerInstance] = useState(null);
  const [serverPickerServers, setServerPickerServers] = useState([]);
  const [serverPickerLoading, setServerPickerLoading] = useState(false);
  const [showModpackInfoModal, setShowModpackInfoModal] = useState(false);
  const [modpackInfoInstance, setModpackInfoInstance] = useState(null);
  const [updatingAccount, setUpdatingAccount] = useState(false);
  const [failedImages, setFailedImages] = useState({});
  const [preferredServerMap, setPreferredServerMap] = useState({});
  const [openImportInfoByTask, setOpenImportInfoByTask] = useState({});
  const [collapsedSetupTasks, setCollapsedSetupTasks] = useState({});
  const [isCenterDockExpanded, setIsCenterDockExpanded] = useState(() => localStorage.getItem(INSTANCE_HEADER_DOCK_OPEN_KEY) !== '0');
  const [dockAnimationState, setDockAnimationState] = useState('');
  const cachedInstanceHeaderStyle = useMemo(
    () => localStorage.getItem(INSTANCE_HEADER_STYLE_CACHE_KEY),
    []
  );
  const sortRef = useRef(null);
  const categoryFilterRef = useRef(null);
  const bulkCategoryDropdownRef = useRef(null);
  const instanceCardRefs = useRef(new Map());
  const categoryManagerItemRefs = useRef(new Map());
  const categoryManagerListRef = useRef(null);
  const categoryDragOverlayRef = useRef(null);
  const pendingCategoryReorderAnimationRef = useRef(null);
  const activeCategoryReorderAnimationsRef = useRef(new Map());
  const categoryPointerDragRef = useRef({
    pointerId: null,
    reorderCooldownUntil: 0,
    pointerGrabOffsetY: 0,
    draggedItemHeight: 0,
    lastPointerClientY: 0
  });
  const pendingViewModeAnimationRef = useRef(null);
  const activeViewModeAnimationsRef = useRef(new Map());
  const categoryAssignmentOptionsRef = useRef([]);
  const pendingDeletedCategoryKeysRef = useRef(new Set());
  const dockAnimationTimerRef = useRef(null);

  // Apply overflow helper class before paint so the dock doesn't jump after mount.
  useLayoutEffect(() => {
    const mainContent = document.querySelector('.main-content');
    if (!mainContent) return;
    const sidebarStyle = launcherSettings?.sidebar_style || 'full';
    const isOriginalSidebarStyle = sidebarStyle === 'original' || sidebarStyle === 'original-slim';
    const rawStyleValue = launcherSettings?.instance_header_style || cachedInstanceHeaderStyle || 'glass-top';
    const normalizedStyleValue = rawStyleValue === 'simple-left-corner'
      ? 'glass-bottom-icons'
      : rawStyleValue === 'glass-dark'
        ? 'glass-bottom'
        : rawStyleValue;
    const resolvedStyleValue = isOriginalSidebarStyle && normalizedStyleValue === 'center-dock-fold-icons'
      ? 'glass-top-icons'
      : normalizedStyleValue;
    const isCenterDock = resolvedStyleValue === 'center-dock-fold-icons';
    if (isCenterDock) {
      mainContent.classList.add('instance-header-style-center-dock-fold-icons');
    } else {
      mainContent.classList.remove('instance-header-style-center-dock-fold-icons');
    }
    return () => {
      mainContent.classList.remove('instance-header-style-center-dock-fold-icons');
    };
  }, [launcherSettings?.instance_header_style, launcherSettings?.sidebar_style, cachedInstanceHeaderStyle]);

  useEffect(() => {
    const rawStyleValue = launcherSettings?.instance_header_style;
    if (!rawStyleValue) return;
    const sidebarStyle = launcherSettings?.sidebar_style || 'full';
    const isOriginalSidebarStyle = sidebarStyle === 'original' || sidebarStyle === 'original-slim';
    const normalizedStyleValue = rawStyleValue === 'simple-left-corner'
      ? 'glass-bottom-icons'
      : rawStyleValue === 'glass-dark'
        ? 'glass-bottom'
        : rawStyleValue;
    const resolvedStyleValue = isOriginalSidebarStyle && normalizedStyleValue === 'center-dock-fold-icons'
      ? 'glass-top-icons'
      : normalizedStyleValue;
    localStorage.setItem(INSTANCE_HEADER_STYLE_CACHE_KEY, resolvedStyleValue);
  }, [launcherSettings?.instance_header_style, launcherSettings?.sidebar_style]);

  // Close dropdowns when clicking outside
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (sortRef.current && !sortRef.current.contains(event.target)) {
        setIsSortOpen(false);
      }
      if (categoryFilterRef.current && !categoryFilterRef.current.contains(event.target)) {
        setIsCategoryFilterOpen(false);
      }
      if (bulkCategoryDropdownRef.current && !bulkCategoryDropdownRef.current.contains(event.target)) {
        setIsBulkCategoryDropdownOpen(false);
      }
    };

    const handleEscape = (event) => {
      if (event.key === 'Escape') {
        setIsSortOpen(false);
        setIsCategoryFilterOpen(false);
        setIsBulkCategoryDropdownOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEscape);
    };
  }, []);

  useEffect(() => {
    const enterTimer = window.setTimeout(() => {
      setIsEntering(false);
    }, 640);

    return () => {
      window.clearTimeout(enterTimer);
    };
  }, []);

  useEffect(() => {
    if (!showAccountModal) return undefined;

    const handleEsc = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        if (!updatingAccount) {
          setShowAccountModal(false);
          setAccountPickerInstance(null);
        }
      }
    };

    window.addEventListener('keydown', handleEsc, true);
    return () => window.removeEventListener('keydown', handleEsc, true);
  }, [showAccountModal, updatingAccount]);

  const closeServerPickerModal = useCallback(() => {
    setShowServerPickerModal(false);
    setServerPickerInstance(null);
    setServerPickerServers([]);
    setServerPickerLoading(false);
  }, []);

  useEffect(() => {
    if (!showServerPickerModal) return undefined;

    const handleEsc = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        closeServerPickerModal();
      }
    };

    window.addEventListener('keydown', handleEsc, true);
    return () => window.removeEventListener('keydown', handleEsc, true);
  }, [showServerPickerModal, closeServerPickerModal]);

  useEffect(() => {
    if (!showModpackInfoModal) return undefined;

    const handleEsc = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        setShowModpackInfoModal(false);
        setModpackInfoInstance(null);
      }
    };

    window.addEventListener('keydown', handleEsc, true);
    return () => window.removeEventListener('keydown', handleEsc, true);
  }, [showModpackInfoModal]);

  useEffect(() => {
    if (showCategoryManagerModal) return;
    setIsBulkCategoryDropdownOpen(false);
    setEditingCategoryKey('');
    setEditingCategoryValue('');
    setPendingDeleteCategoryKey('');
    setDraggedCategoryKey('');
    setDragOverCategoryKey('');
  }, [showCategoryManagerModal]);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(PREFERRED_SERVER_STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') {
        setPreferredServerMap(parsed);
      }
    } catch (error) {
      console.warn('Failed to load preferred server map:', error);
    }
  }, []);

  const persistCategoryList = useCallback((nextCategories) => {
    localStorage.setItem(CATEGORY_LIST_STORAGE_KEY, JSON.stringify(nextCategories));
    window.dispatchEvent(new CustomEvent(CATEGORY_LIST_UPDATED_EVENT, { detail: { categories: nextCategories } }));
  }, []);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(CATEGORY_LIST_STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        const cleaned = parsed
          .map((entry) => (typeof entry === 'string' ? entry.trim() : ''))
          .filter(Boolean);
        const unique = Array.from(new Set(cleaned.map((entry) => entry.toLowerCase())))
          .map((lower) => cleaned.find((entry) => entry.toLowerCase() === lower))
          .filter(Boolean);
        setCategoryList(unique);
      }
    } catch (error) {
      console.warn('Failed to load category list:', error);
    }
  }, []);

  const loadAccounts = useCallback(async () => {
    try {
      const data = await invoke('get_saved_accounts');
      setSavedAccounts(data?.accounts || []);
      setActiveAccountUsername(data?.active_account || '');
    } catch (error) {
      console.error('Failed to load accounts for picker:', error);
    }
  }, []);

  const openInstanceEditorFromButton = useCallback((event, instance) => {
    event.preventDefault();
    event.stopPropagation();
    if (onEditInstance) {
      onEditInstance(instance.id);
    }
  }, [onEditInstance]);

  const availableCategoryOptions = useMemo(() => {
    const categoriesByKey = new Map();
    for (const instance of instances) {
      const rawCategory = typeof instance?.category === 'string' ? instance.category.trim() : '';
      if (!rawCategory) continue;
      const normalizedKey = rawCategory.toLowerCase();
      if (!categoriesByKey.has(normalizedKey)) {
        categoriesByKey.set(normalizedKey, rawCategory);
      }
    }

    return Array.from(categoriesByKey.values()).sort((a, b) => a.localeCompare(b));
  }, [instances]);

  useEffect(() => {
    if (bulkUpdatingCategories) return;

    const pendingDeletedKeys = pendingDeletedCategoryKeysRef.current;
    if (pendingDeletedKeys.size > 0) {
      const availableKeySet = new Set(availableCategoryOptions.map((entry) => toCategoryKey(entry)));
      pendingDeletedKeys.forEach((key) => {
        if (!availableKeySet.has(key)) {
          pendingDeletedKeys.delete(key);
        }
      });
    }

    setCategoryList((prev) => {
      const merged = [...prev];
      for (const category of availableCategoryOptions) {
        const categoryKey = toCategoryKey(category);
        if (!categoryKey || pendingDeletedKeys.has(categoryKey)) {
          continue;
        }
        if (!merged.some((entry) => toCategoryKey(entry) === categoryKey)) {
          merged.push(category);
        }
      }
      if (merged.length !== prev.length) {
        persistCategoryList(merged);
        return merged;
      }
      return prev;
    });
  }, [availableCategoryOptions, persistCategoryList, bulkUpdatingCategories]);

  const activeCategoryFilterLabel = useMemo(() => {
    if (categoryFilter === CATEGORY_FILTER_ALL) return 'All categories';
    if (categoryFilter === CATEGORY_FILTER_UNCATEGORIZED) return 'Uncategorized';
    const matched = availableCategoryOptions.find((entry) => entry.toLowerCase() === categoryFilter.toLowerCase());
    return matched || categoryFilter;
  }, [categoryFilter, availableCategoryOptions]);

  const handleCategoryFilterChange = useCallback((nextFilter) => {
    const value = nextFilter || CATEGORY_FILTER_ALL;
    setCategoryFilter(value);
    localStorage.setItem('instance_category_filter', value);
  }, []);

  useEffect(() => {
    if (categoryFilter === CATEGORY_FILTER_ALL || categoryFilter === CATEGORY_FILTER_UNCATEGORIZED) return;

    const stillExists = availableCategoryOptions.some((entry) => entry.toLowerCase() === categoryFilter.toLowerCase());
    if (!stillExists) {
      handleCategoryFilterChange(CATEGORY_FILTER_ALL);
    }
  }, [categoryFilter, availableCategoryOptions, handleCategoryFilterChange]);

  const filteredAndSortedInstances = useMemo(() => {
    const filtered = instances.filter((instance) => {
      if (categoryFilter === CATEGORY_FILTER_ALL) return true;
      const instanceCategory = typeof instance?.category === 'string' ? instance.category.trim() : '';
      if (categoryFilter === CATEGORY_FILTER_UNCATEGORIZED) {
        return instanceCategory.length === 0;
      }
      return instanceCategory.toLowerCase() === categoryFilter.toLowerCase();
    });

    return filtered.sort((a, b) => {
      switch (sortBy) {
        case 'name':
          return a.name.localeCompare(b.name);
        case 'age': {
          // created_at is timestamp string
          const ageA = parseInt(a.created_at || '0');
          const ageB = parseInt(b.created_at || '0');
          return ageB - ageA;
        }
        case 'playtime':
          return (b.playtime_seconds || 0) - (a.playtime_seconds || 0);
        default:
          return 0;
      }
    });
  }, [instances, sortBy, categoryFilter]);

  const visibleCategorySections = useMemo(() => {
    const categoryOrder = [...categoryList];
    for (const discovered of availableCategoryOptions) {
      if (!categoryOrder.some((entry) => entry.toLowerCase() === discovered.toLowerCase())) {
        categoryOrder.push(discovered);
      }
    }

    const bucketMap = new Map();
    categoryOrder.forEach((category) => bucketMap.set(category, []));
    bucketMap.set(CATEGORY_FILTER_UNCATEGORIZED, []);

    filteredAndSortedInstances.forEach((instance) => {
      const rawCategory = typeof instance?.category === 'string' ? instance.category.trim() : '';
      if (!rawCategory) {
        bucketMap.get(CATEGORY_FILTER_UNCATEGORIZED).push(instance);
        return;
      }

      const matchedCategory = categoryOrder.find((entry) => entry.toLowerCase() === rawCategory.toLowerCase()) || rawCategory;
      if (!bucketMap.has(matchedCategory)) {
        bucketMap.set(matchedCategory, []);
      }
      bucketMap.get(matchedCategory).push(instance);
    });

    const sections = [];
    if (categoryFilter === CATEGORY_FILTER_ALL) {
      const hasCategorizedInstances = categoryOrder.some((category) => (bucketMap.get(category) || []).length > 0);
      if (!hasCategorizedInstances) {
        return [];
      }

      categoryOrder.forEach((category) => {
        sections.push({
          key: `cat-${category.toLowerCase()}`,
          label: category,
          bucketKey: category,
          instances: bucketMap.get(category) || []
        });
      });
      sections.push({
        key: 'cat-uncategorized',
        label: 'Uncategorized',
        bucketKey: CATEGORY_FILTER_UNCATEGORIZED,
        instances: bucketMap.get(CATEGORY_FILTER_UNCATEGORIZED) || []
      });
      return sections.filter((section) => section.instances.length > 0);
    }

    if (categoryFilter === CATEGORY_FILTER_UNCATEGORIZED) {
      return [{
        key: 'cat-uncategorized',
        label: 'Uncategorized',
        bucketKey: CATEGORY_FILTER_UNCATEGORIZED,
        instances: bucketMap.get(CATEGORY_FILTER_UNCATEGORIZED) || []
      }];
    }

    const matched = categoryOrder.find((entry) => entry.toLowerCase() === categoryFilter.toLowerCase()) || categoryFilter;
    return [{
      key: `cat-${matched.toLowerCase()}`,
      label: matched,
      bucketKey: matched,
      instances: bucketMap.get(matched) || []
    }];
  }, [categoryList, availableCategoryOptions, filteredAndSortedInstances, categoryFilter]);

  const categoryAssignmentOptions = useMemo(() => {
    const merged = [...categoryList];
    for (const category of availableCategoryOptions) {
      if (!merged.some((entry) => toCategoryKey(entry) === toCategoryKey(category))) {
        merged.push(category);
      }
    }
    return merged;
  }, [categoryList, availableCategoryOptions]);

  useEffect(() => {
    categoryAssignmentOptionsRef.current = categoryAssignmentOptions;
  }, [categoryAssignmentOptions]);

  useEffect(() => {
    const handleOpenCategoryManager = (event) => {
      const mode = typeof event?.detail?.mode === 'string' ? event.detail.mode : 'edit';
      const requestedCategoryName = typeof event?.detail?.categoryName === 'string' ? event.detail.categoryName.trim() : '';
      const requestedCategoryKey = toCategoryKey(requestedCategoryName);
      const bucketKey = typeof event?.detail?.bucketKey === 'string' ? event.detail.bucketKey : '';
      const isVirtualCategory = bucketKey === CATEGORY_FILTER_UNCATEGORIZED;

      setShowCategoryManagerModal(true);
      setEditingCategoryKey('');
      setEditingCategoryValue('');
      setPendingDeleteCategoryKey('');
      setDraggedCategoryKey('');
      setDragOverCategoryKey('');

      if (!requestedCategoryKey) return;

      const matchedCategory = categoryAssignmentOptions.find(
        (entry) => toCategoryKey(entry) === requestedCategoryKey
      ) || requestedCategoryName;

      if (matchedCategory) {
        setBulkCategoryTarget(matchedCategory);
      }

      if (isVirtualCategory) return;

      if (mode === 'rename') {
        setEditingCategoryKey(requestedCategoryKey);
        setEditingCategoryValue(matchedCategory);
      } else if (mode === 'delete') {
        setPendingDeleteCategoryKey(requestedCategoryKey);
      }
    };

    window.addEventListener(OPEN_CATEGORY_MANAGER_EVENT, handleOpenCategoryManager);
    return () => window.removeEventListener(OPEN_CATEGORY_MANAGER_EVENT, handleOpenCategoryManager);
  }, [categoryAssignmentOptions]);

  const categoryUsageCountMap = useMemo(() => {
    const countMap = new Map();
    for (const instance of instances) {
      const key = toCategoryKey(instance?.category);
      if (!key) continue;
      countMap.set(key, (countMap.get(key) || 0) + 1);
    }
    return countMap;
  }, [instances]);

  const draggedCategoryEntry = useMemo(() => {
    if (!draggedCategoryKey) return null;
    const category = categoryAssignmentOptions.find((entry) => toCategoryKey(entry) === draggedCategoryKey);
    if (!category) return null;
    return {
      category,
      usageCount: categoryUsageCountMap.get(draggedCategoryKey) || 0
    };
  }, [categoryAssignmentOptions, categoryUsageCountMap, draggedCategoryKey]);

  const handleAddCategory = useCallback(() => {
    const normalized = newCategoryName.trim();
    if (!normalized) return;
    const normalizedKey = toCategoryKey(normalized);
    pendingDeletedCategoryKeysRef.current.delete(normalizedKey);

    setCategoryList((prev) => {
      if (prev.some((entry) => toCategoryKey(entry) === normalizedKey)) return prev;
      const next = [...prev, normalized];
      persistCategoryList(next);
      return next;
    });
    setBulkCategoryTarget(normalized);
    setNewCategoryName('');
  }, [newCategoryName, persistCategoryList]);

  const handleCategoryDragReorder = useCallback((fromKey, toKey, options = {}) => {
    const shouldAnimate = options.animate !== false;
    const skipAnimationKey = options.skipAnimationKey || '';
    if (!fromKey || !toKey || fromKey === toKey) return;

    const activeAnimations = activeCategoryReorderAnimationsRef.current;
    activeAnimations.forEach((animation) => {
      animation.cancel();
    });
    activeAnimations.clear();
    categoryManagerItemRefs.current.forEach((node) => {
      if (!node) return;
      node.style.transition = '';
      node.style.transform = '';
      node.style.willChange = '';
    });

    const beforeRects = new Map();
    categoryManagerItemRefs.current.forEach((node, key) => {
      if (node) {
        beforeRects.set(key, node.getBoundingClientRect());
      }
    });
    let didReorder = false;
    setCategoryList((prev) => {
      const fromIndex = prev.findIndex((entry) => toCategoryKey(entry) === fromKey);
      const toIndex = prev.findIndex((entry) => toCategoryKey(entry) === toKey);
      if (fromIndex < 0 || toIndex < 0 || fromIndex === toIndex) return prev;
      didReorder = true;
      const next = [...prev];
      const [moved] = next.splice(fromIndex, 1);
      next.splice(toIndex, 0, moved);
      persistCategoryList(next);
      return next;
    });
    if (didReorder && shouldAnimate) {
      pendingCategoryReorderAnimationRef.current = {
        beforeRects,
        skipAnimationKey
      };
    }
  }, [persistCategoryList]);

  useLayoutEffect(() => {
    const pendingAnimation = pendingCategoryReorderAnimationRef.current;
    if (!pendingAnimation) return;
    pendingCategoryReorderAnimationRef.current = null;

    categoryManagerItemRefs.current.forEach((node, key) => {
      const fromRect = pendingAnimation.beforeRects.get(key);
      if (!node || !fromRect || key === pendingAnimation.skipAnimationKey) return;
      const toRect = node.getBoundingClientRect();
      const deltaY = fromRect.top - toRect.top;
      if (Math.abs(deltaY) < 0.5) return;

      const existingAnimation = activeCategoryReorderAnimationsRef.current.get(key);
      if (existingAnimation) {
        existingAnimation.cancel();
      }

      node.style.willChange = 'transform';

      if (typeof node.animate === 'function') {
        const animation = node.animate(
          [
            { transform: `translate3d(0, ${deltaY}px, 0)` },
            { transform: 'translate3d(0, 0, 0)' }
          ],
          {
            duration: 260,
            easing: 'cubic-bezier(0.22, 0.8, 0.24, 1)',
            fill: 'both'
          }
        );
        activeCategoryReorderAnimationsRef.current.set(key, animation);

        const cleanup = () => {
          if (activeCategoryReorderAnimationsRef.current.get(key) === animation) {
            activeCategoryReorderAnimationsRef.current.delete(key);
          }
          node.style.transform = '';
          node.style.willChange = '';
        };
        animation.onfinish = cleanup;
        animation.oncancel = cleanup;
        return;
      }

      const cleanup = () => {
        node.style.transition = '';
        node.style.transform = '';
        node.style.willChange = '';
      };
      node.style.transition = 'none';
      node.style.transform = `translate3d(0, ${deltaY}px, 0)`;
      node.getBoundingClientRect();
      requestAnimationFrame(() => {
        node.style.transition = 'transform 260ms cubic-bezier(0.22, 0.8, 0.24, 1)';
        node.style.transform = 'translate3d(0, 0, 0)';
        node.addEventListener('transitionend', cleanup, { once: true });
        window.setTimeout(cleanup, 340);
      });
    });
  }, [categoryAssignmentOptions]);

  const updateCategoryDragOverlayPosition = useCallback((pointerClientY) => {
    const listNode = categoryManagerListRef.current;
    const overlayNode = categoryDragOverlayRef.current;
    if (!listNode || !overlayNode || !Number.isFinite(pointerClientY)) return;
    const listRect = listNode.getBoundingClientRect();
    const dragState = categoryPointerDragRef.current;
    const desiredViewportTop = pointerClientY - dragState.pointerGrabOffsetY;
    const desiredContentTop = desiredViewportTop - listRect.top + listNode.scrollTop;
    const minTop = listNode.scrollTop;
    const maxTop = listNode.scrollTop + listNode.clientHeight - dragState.draggedItemHeight;
    const clampedTop = Math.max(minTop, Math.min(maxTop, desiredContentTop));
    overlayNode.style.setProperty('--category-overlay-y', `${clampedTop}px`);
  }, []);

  const startCategoryManagerPointerDrag = useCallback((categoryKey, pointerId = null, pointerClientY = null) => {
    if (!categoryKey) return;
    const draggedNode = categoryManagerItemRefs.current.get(categoryKey);
    const nodeRect = draggedNode?.getBoundingClientRect?.();
    const nodeTop = nodeRect?.top ?? 0;
    categoryPointerDragRef.current.pointerId = pointerId;
    categoryPointerDragRef.current.reorderCooldownUntil = 0;
    categoryPointerDragRef.current.pointerGrabOffsetY = pointerClientY !== null ? (pointerClientY - nodeTop) : 0;
    categoryPointerDragRef.current.draggedItemHeight = nodeRect?.height ?? 0;
    categoryPointerDragRef.current.lastPointerClientY = pointerClientY ?? (nodeTop + ((nodeRect?.height ?? 0) / 2));
    setDraggedCategoryKey(categoryKey);
    setDragOverCategoryKey(categoryKey);
  }, []);

  const handleCategoryManagerPointerDown = useCallback((event, categoryKey) => {
    if (event.button !== 0) return;
    const interactiveTarget = event.target.closest('button, input, select, textarea, a, label');
    if (interactiveTarget) return;
    event.preventDefault();
    startCategoryManagerPointerDrag(categoryKey, event.pointerId, event.clientY);
  }, [startCategoryManagerPointerDrag]);

  const finishCategoryManagerPointerDrag = useCallback(() => {
    if (!draggedCategoryKey) return;
    categoryPointerDragRef.current.pointerId = null;
    categoryPointerDragRef.current.reorderCooldownUntil = 0;
    categoryPointerDragRef.current.pointerGrabOffsetY = 0;
    categoryPointerDragRef.current.draggedItemHeight = 0;
    categoryPointerDragRef.current.lastPointerClientY = 0;
    setDraggedCategoryKey('');
    setDragOverCategoryKey('');
  }, [draggedCategoryKey]);

  useEffect(() => {
    if (!draggedCategoryKey) return undefined;

    const initialSync = window.requestAnimationFrame(() => {
      updateCategoryDragOverlayPosition(categoryPointerDragRef.current.lastPointerClientY);
    });

    const handlePointerMove = (event) => {
      const dragState = categoryPointerDragRef.current;
      if (dragState.pointerId !== null && event.pointerId !== dragState.pointerId) return;
      dragState.lastPointerClientY = event.clientY;
      updateCategoryDragOverlayPosition(event.clientY);

      const draggedCardTopViewportY = event.clientY - dragState.pointerGrabOffsetY;
      const draggedCardCenterViewportY = draggedCardTopViewportY + ((dragState.draggedItemHeight || 0) / 2);
      const probeY = Math.max(0, Math.min(window.innerHeight - 1, draggedCardCenterViewportY));
      const hovered = document.elementFromPoint(event.clientX, probeY);
      const targetItem = hovered?.closest?.('[data-category-key]');
      const targetKey = targetItem?.getAttribute?.('data-category-key') || '';
      setDragOverCategoryKey((prev) => (prev === targetKey ? prev : targetKey));

      if (!targetKey || targetKey === draggedCategoryKey) return;

      const currentCategoryOptions = categoryAssignmentOptionsRef.current;
      const fromIndex = currentCategoryOptions.findIndex((entry) => toCategoryKey(entry) === draggedCategoryKey);
      const toIndex = currentCategoryOptions.findIndex((entry) => toCategoryKey(entry) === targetKey);
      if (fromIndex < 0 || toIndex < 0 || fromIndex === toIndex) return;

      const targetRect = targetItem.getBoundingClientRect();
      const targetMidpoint = targetRect.top + (targetRect.height / 2);
      const movingDown = fromIndex < toIndex;
      const midpointPadding = 2;
      const crossedThreshold = movingDown
        ? draggedCardCenterViewportY >= (targetMidpoint + midpointPadding)
        : draggedCardCenterViewportY <= (targetMidpoint - midpointPadding);
      if (!crossedThreshold) return;

      const now = performance.now();
      if (now < dragState.reorderCooldownUntil) return;
      dragState.reorderCooldownUntil = now + 80;
      handleCategoryDragReorder(draggedCategoryKey, targetKey, { skipAnimationKey: draggedCategoryKey });
    };

    const handleScroll = () => {
      updateCategoryDragOverlayPosition(categoryPointerDragRef.current.lastPointerClientY);
    };

    const handlePointerUp = () => {
      finishCategoryManagerPointerDrag();
    };

    const handleEscape = (event) => {
      if (event.key !== 'Escape') return;
      categoryPointerDragRef.current.pointerId = null;
      categoryPointerDragRef.current.reorderCooldownUntil = 0;
      categoryPointerDragRef.current.pointerGrabOffsetY = 0;
      categoryPointerDragRef.current.draggedItemHeight = 0;
      categoryPointerDragRef.current.lastPointerClientY = 0;
      setDraggedCategoryKey('');
      setDragOverCategoryKey('');
    };

    categoryManagerListRef.current?.addEventListener('scroll', handleScroll, { passive: true });
    window.addEventListener('pointermove', handlePointerMove, true);
    window.addEventListener('pointerup', handlePointerUp, true);
    window.addEventListener('pointercancel', handlePointerUp, true);
    window.addEventListener('keydown', handleEscape, true);
    return () => {
      window.cancelAnimationFrame(initialSync);
      categoryManagerListRef.current?.removeEventListener('scroll', handleScroll);
      window.removeEventListener('pointermove', handlePointerMove, true);
      window.removeEventListener('pointerup', handlePointerUp, true);
      window.removeEventListener('pointercancel', handlePointerUp, true);
      window.removeEventListener('keydown', handleEscape, true);
    };
  }, [
    draggedCategoryKey,
    finishCategoryManagerPointerDrag,
    handleCategoryDragReorder,
    updateCategoryDragOverlayPosition
  ]);

  const beginCategoryRename = useCallback((category) => {
    const categoryKey = toCategoryKey(category);
    if (!categoryKey) return;
    setPendingDeleteCategoryKey('');
    setEditingCategoryKey(categoryKey);
    setEditingCategoryValue(category);
  }, []);

  const cancelCategoryRename = useCallback(() => {
    setEditingCategoryKey('');
    setEditingCategoryValue('');
  }, []);

  const commitCategoryRename = useCallback(async (originalCategory) => {
    const fromKey = toCategoryKey(originalCategory);
    const renamed = editingCategoryValue.trim();
    const toKey = toCategoryKey(renamed);
    if (!fromKey) return;
    if (!toKey || !renamed) {
      onShowNotification?.('Category name cannot be empty.', 'warning');
      return;
    }
    if (toKey !== fromKey && categoryAssignmentOptions.some((entry) => toCategoryKey(entry) === toKey)) {
      onShowNotification?.('A category with that name already exists.', 'warning');
      return;
    }

    setBulkUpdatingCategories(true);
    try {
      setCategoryList((prev) => {
        const next = prev.map((entry) => (toCategoryKey(entry) === fromKey ? renamed : entry));
        persistCategoryList(next);
        return next;
      });

      const affected = instances.filter((instance) => toCategoryKey(instance?.category) === fromKey);
      for (const instance of affected) {
        const updated = { ...instance, category: renamed };
        await invoke('update_instance', { instance: updated });
      }

      if (toCategoryKey(categoryFilter) === fromKey) {
        handleCategoryFilterChange(renamed);
      }
      if (toCategoryKey(bulkCategoryTarget) === fromKey) {
        setBulkCategoryTarget(renamed);
      }

      await onInstancesRefresh?.();
      cancelCategoryRename();
    } catch (error) {
      console.error('Failed to rename category:', error);
      onShowNotification?.(`Failed to rename category: ${error}`, 'error');
    } finally {
      setBulkUpdatingCategories(false);
    }
  }, [
    editingCategoryValue,
    categoryAssignmentOptions,
    instances,
    categoryFilter,
    bulkCategoryTarget,
    onShowNotification,
    onInstancesRefresh,
    persistCategoryList,
    cancelCategoryRename,
    handleCategoryFilterChange
  ]);

  const confirmDeleteCategory = useCallback(async (category) => {
    const categoryKey = toCategoryKey(category);
    if (!categoryKey) return;
    pendingDeletedCategoryKeysRef.current.add(categoryKey);

    setBulkUpdatingCategories(true);
    try {
      setCategoryList((prev) => {
        const next = prev.filter((entry) => toCategoryKey(entry) !== categoryKey);
        persistCategoryList(next);
        return next;
      });

      const affected = instances.filter((instance) => toCategoryKey(instance?.category) === categoryKey);
      for (const instance of affected) {
        const updated = { ...instance, category: null };
        await invoke('update_instance', { instance: updated });
      }

      if (toCategoryKey(categoryFilter) === categoryKey) {
        handleCategoryFilterChange(CATEGORY_FILTER_ALL);
      }
      if (toCategoryKey(bulkCategoryTarget) === categoryKey) {
        setBulkCategoryTarget('');
      }

      await onInstancesRefresh?.();
      setPendingDeleteCategoryKey('');
      cancelCategoryRename();
    } catch (error) {
      pendingDeletedCategoryKeysRef.current.delete(categoryKey);
      console.error('Failed to delete category:', error);
      onShowNotification?.(`Failed to delete category: ${error}`, 'error');
    } finally {
      setBulkUpdatingCategories(false);
    }
  }, [
    instances,
    categoryFilter,
    bulkCategoryTarget,
    onShowNotification,
    onInstancesRefresh,
    persistCategoryList,
    cancelCategoryRename,
    handleCategoryFilterChange
  ]);

  const handleToggleBulkSelection = useCallback((instanceId) => {
    setBulkSelectedInstanceIds((prev) => (
      prev.includes(instanceId)
        ? prev.filter((id) => id !== instanceId)
        : [...prev, instanceId]
    ));
  }, []);

  const applyBulkCategoryUpdate = useCallback(async (targetCategory) => {
    if (bulkSelectedInstanceIds.length === 0) return;
    setBulkUpdatingCategories(true);

    try {
      const selectedSet = new Set(bulkSelectedInstanceIds);
      const updates = instances.filter((instance) => selectedSet.has(instance.id));
      for (const instance of updates) {
        const updated = {
          ...instance,
          category: targetCategory && targetCategory.trim() ? targetCategory.trim() : null
        };
        await invoke('update_instance', { instance: updated });
      }
      await onInstancesRefresh?.();
      setBulkSelectedInstanceIds([]);
    } catch (error) {
      console.error('Failed bulk category update:', error);
      onShowNotification?.(`Failed to update categories: ${error}`, 'error');
    } finally {
      setBulkUpdatingCategories(false);
    }
  }, [bulkSelectedInstanceIds, instances, onInstancesRefresh, onShowNotification]);

  // Create a stable key that only changes when logos actually change
  const logoKey = useMemo(() => {
    return instances.map(i => `${i.id}:${i.logo_filename || 'default'}`).join(',');
  }, [instances]);

  const formatDate = useCallback((timestamp) => {
    if (!timestamp) return 'Never';
    const date = new Date(parseInt(timestamp) * 1000);
    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  }, []);

  const formatPlaytime = useCallback((seconds) => {
    if (!seconds || seconds === 0) return null;
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    if (hours > 0) {
      return `${hours}h ${minutes}m`;
    }
    return `${minutes}m`;
  }, []);

  const handleContainerContextMenu = useCallback((e) => {
    // Right-click on empty area
    if (e.target.classList.contains('instance-list') || e.target.classList.contains('instances-grid')) {
      e.preventDefault();
      onContextMenu(e, null);
    }
  }, [onContextMenu]);

  const queueCardLayoutAnimation = useCallback(() => {
    if (instanceCardRefs.current.size === 0) {
      pendingViewModeAnimationRef.current = null;
      return;
    }

    const beforeRects = new Map();
    instanceCardRefs.current.forEach((card, instanceId) => {
      if (!card) return;
      beforeRects.set(instanceId, card.getBoundingClientRect());
    });

    pendingViewModeAnimationRef.current = { beforeRects };
  }, []);

  const handleSortChange = useCallback((input) => {
    const val = typeof input === 'string' ? input : input?.target?.value;
    if (!val || sortBy === val) return;

    queueCardLayoutAnimation();
    setSortBy(val);
    localStorage.setItem('instance_sort', val);
    setIsSortOpen(false);
  }, [queueCardLayoutAnimation, sortBy]);

  const handleOpenAccountPicker = useCallback(async (event, instance) => {
    event.preventDefault();
    event.stopPropagation();
    setFailedImages({});
    setAccountPickerInstance(instance);
    setShowAccountModal(true);
    await loadAccounts();
  }, [loadAccounts]);

  const handleOpenServerPicker = useCallback(async (event, instance) => {
    event.preventDefault();
    event.stopPropagation();

    setShowServerPickerModal(true);
    setServerPickerInstance(instance);
    setServerPickerServers([]);
    setServerPickerLoading(true);

    try {
      const servers = await invoke('get_instance_servers', { instanceId: instance.id });
      setServerPickerServers(Array.isArray(servers) ? servers : []);
    } catch (error) {
      console.error('Failed to load servers for picker:', error);
      if (onShowNotification) {
        onShowNotification(`Failed to load servers: ${error}`, 'error');
      }
      setServerPickerServers([]);
    } finally {
      setServerPickerLoading(false);
    }
  }, [onShowNotification]);

  const handleSetPreferredServer = useCallback((serverAddress, serverName = '', serverIcon = null) => {
    if (!serverPickerInstance) return;

    const normalizedAddress = typeof serverAddress === 'string' ? serverAddress.trim() : '';
    const instanceId = serverPickerInstance.id;
    const instanceName = serverPickerInstance.name;

    setPreferredServerMap((prev) => {
      const next = { ...prev };
      if (normalizedAddress) {
        next[instanceId] = {
          address: normalizedAddress,
          name: serverName || normalizedAddress,
          icon: typeof serverIcon === 'string' ? serverIcon : null
        };
      } else {
        delete next[instanceId];
      }

      try {
        localStorage.setItem(PREFERRED_SERVER_STORAGE_KEY, JSON.stringify(next));
      } catch (error) {
        console.warn('Failed to persist preferred server map:', error);
      }
      return next;
    });

    closeServerPickerModal();

    if (onShowNotification) {
      onShowNotification(
        normalizedAddress
          ? `Pinned ${instanceName} to server ${serverName || normalizedAddress}`
          : `${instanceName} now launches without auto-join server`,
        'success'
      );
    }
  }, [closeServerPickerModal, onShowNotification, serverPickerInstance]);

  const handleSetPreferredAccount = useCallback(async (username) => {
    if (!accountPickerInstance || updatingAccount) return;
    setUpdatingAccount(true);
    try {
      await invoke('update_instance', {
        instance: {
          ...accountPickerInstance,
          preferred_account: username || null,
        }
      });
      if (onInstancesRefresh) {
        await onInstancesRefresh();
      }
      if (onShowNotification) {
        onShowNotification(
          username ? `Pinned ${accountPickerInstance.name} to ${username}` : `${accountPickerInstance.name} now uses active account`,
          'success'
        );
      }
      setShowAccountModal(false);
      setAccountPickerInstance(null);
    } catch (error) {
      console.error('Failed to update preferred account:', error);
      if (onShowNotification) {
        onShowNotification(`Failed to set account: ${error}`, 'error');
      }
    } finally {
      setUpdatingAccount(false);
    }
  }, [accountPickerInstance, onInstancesRefresh, onShowNotification, updatingAccount]);

  const activeAccountForDefault = useMemo(
    () => savedAccounts.find((account) => account.username === activeAccountUsername) || null,
    [savedAccounts, activeAccountUsername]
  );

  const getSkinUrl = useCallback((uuid, isMicrosoft) => {
    if (!isMicrosoft || !uuid) return STEVE_HEAD_DATA;
    if (failedImages[uuid]) return STEVE_HEAD_DATA;
    const cleanUuid = uuid.replace(/-/g, '');
    return `https://minotar.net/helm/${cleanUuid}/64.png`;
  }, [failedImages]);

  const setInstanceCardRef = useCallback((instanceId, node) => {
    if (node) {
      instanceCardRefs.current.set(instanceId, node);
    } else {
      instanceCardRefs.current.delete(instanceId);
    }
  }, []);

  const animateViewModeChange = useCallback((nextMode) => {
    if (viewMode === nextMode) return;

    queueCardLayoutAnimation();
    setViewMode(nextMode);
    localStorage.setItem('instance_view_mode', nextMode);
  }, [queueCardLayoutAnimation, viewMode]);

  useLayoutEffect(() => {
    const pendingAnimation = pendingViewModeAnimationRef.current;
    if (!pendingAnimation) return;
    pendingViewModeAnimationRef.current = null;

    instanceCardRefs.current.forEach((card, instanceId) => {
      const before = pendingAnimation.beforeRects.get(instanceId);
      if (!card || !before) return;

      const after = card.getBoundingClientRect();
      const deltaX = before.left - after.left;
      const deltaY = before.top - after.top;
      const rawScaleX = after.width > 0 ? before.width / after.width : 1;
      const rawScaleY = after.height > 0 ? before.height / after.height : 1;
      const scaleX = 1 + ((rawScaleX - 1) * CARD_LAYOUT_SCALE_STRENGTH);
      const scaleY = 1 + ((rawScaleY - 1) * CARD_LAYOUT_SCALE_STRENGTH);
      const hasMovement = Math.abs(deltaX) >= 0.5 || Math.abs(deltaY) >= 0.5;
      const hasScale = Math.abs(scaleX - 1) >= 0.01 || Math.abs(scaleY - 1) >= 0.01;

      if (!hasMovement && !hasScale) {
        return;
      }

      const existingAnimation = activeViewModeAnimationsRef.current.get(instanceId);
      if (existingAnimation) {
        existingAnimation.cancel();
      }

      card.style.willChange = 'transform';
      card.style.transformOrigin = 'top left';

      if (typeof card.animate !== 'function') {
        card.style.transition = 'none';
        card.style.transform = `translate3d(${deltaX}px, ${deltaY}px, 0) scale(${scaleX}, ${scaleY})`;
        card.getBoundingClientRect();
        requestAnimationFrame(() => {
          card.style.transition = `transform ${CARD_LAYOUT_ANIMATION_DURATION_MS}ms ${CARD_LAYOUT_ANIMATION_EASING}`;
          card.style.transform = 'translate3d(0, 0, 0) scale(1, 1)';
          const cleanup = (event) => {
            if (event && event.target !== card) return;
            if (event && event.propertyName !== 'transform') return;
            card.style.transition = '';
            card.style.transform = '';
            card.style.willChange = '';
            card.style.transformOrigin = '';
            card.removeEventListener('transitionend', cleanup);
          };
          card.addEventListener('transitionend', cleanup);
          window.setTimeout(() => cleanup(), CARD_LAYOUT_ANIMATION_DURATION_MS + 120);
        });
        return;
      }

      const animation = card.animate(
        [
          {
            transform: `translate3d(${deltaX}px, ${deltaY}px, 0) scale(${scaleX}, ${scaleY})`
          },
          {
            transform: 'translate3d(0, 0, 0) scale(1, 1)'
          }
        ],
        {
          duration: CARD_LAYOUT_ANIMATION_DURATION_MS,
          easing: CARD_LAYOUT_ANIMATION_EASING,
          fill: 'both'
        }
      );

      activeViewModeAnimationsRef.current.set(instanceId, animation);

      const cleanup = () => {
        if (activeViewModeAnimationsRef.current.get(instanceId) === animation) {
          activeViewModeAnimationsRef.current.delete(instanceId);
        }
        card.style.transform = '';
        card.style.willChange = '';
        card.style.transformOrigin = '';
      };

      animation.onfinish = cleanup;
      animation.oncancel = cleanup;
    });
  }, [sortBy, viewMode]);

  useEffect(() => {
    const activeAnimations = activeViewModeAnimationsRef.current;
    return () => {
      activeAnimations.forEach((animation) => {
        try {
          animation.cancel();
        } catch {
          // no-op
        }
      });
      activeAnimations.clear();
    };
  }, []);

  useEffect(() => {
    return () => {
      if (dockAnimationTimerRef.current) {
        window.clearTimeout(dockAnimationTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    const activeAnimations = activeCategoryReorderAnimationsRef.current;
    return () => {
      activeAnimations.forEach((animation) => {
        try {
          animation.cancel();
        } catch {
          // no-op
        }
      });
      activeAnimations.clear();
    };
  }, []);

  const switchToListView = useCallback(() => {
    animateViewModeChange('list');
  }, [animateViewModeChange]);

  const switchToGridView = useCallback(() => {
    animateViewModeChange('grid');
  }, [animateViewModeChange]);

  const setCenterDockExpanded = useCallback((nextExpanded) => {
    setIsCenterDockExpanded(nextExpanded);
    localStorage.setItem(INSTANCE_HEADER_DOCK_OPEN_KEY, nextExpanded ? '1' : '0');
    if (!nextExpanded) {
      setIsSortOpen(false);
      setIsCategoryFilterOpen(false);
    }
  }, []);

  const toggleCenterDockExpanded = useCallback(() => {
    const nextExpanded = !isCenterDockExpanded;
    setDockAnimationState(nextExpanded ? 'dock-anim-opening' : 'dock-anim-closing');
    setCenterDockExpanded(nextExpanded);

    if (dockAnimationTimerRef.current) {
      window.clearTimeout(dockAnimationTimerRef.current);
    }
    dockAnimationTimerRef.current = window.setTimeout(() => {
      setDockAnimationState('');
      dockAnimationTimerRef.current = null;
    }, CENTER_DOCK_ANIMATION_MS);
  }, [isCenterDockExpanded, setCenterDockExpanded]);

  const handleOpenModpackInfo = useCallback((event, instance) => {
    event.preventDefault();
    event.stopPropagation();
    setModpackInfoInstance(instance);
    setShowModpackInfoModal(true);
  }, []);

  useEffect(() => {
    let cancelled = false;

    const loadLogos = async () => {
      try {
        if (!instances || instances.length === 0) {
          setLogoMap({});
          return;
        }
        
        // Optimize: Get base path and separator once to avoid N IPC calls
        const baseDir = await invoke('get_data_directory');
        const s = await sep();
        const logosDir = `${baseDir}${s}instance_logos`;
        
        const entries = instances.map((instance) => {
          const filename = instance.logo_filename || 'minecraft_logo.png';
          const logoPath = `${logosDir}${s}${filename}`;
          return [instance.id, convertFileSrc(logoPath)];
        });

        if (!cancelled) {
          setLogoMap(Object.fromEntries(entries));
        }
      } catch (error) {
        console.error('Failed to load instance logos:', error);
      }
    };

    loadLogos();

    return () => {
      cancelled = true;
    };
    // logoKey captures only id+logo_filename changes, so we don't reload on every instance update
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [logoKey]);

  const selectedServerAddressForPicker = serverPickerInstance
    ? (() => {
      const value = preferredServerMap[serverPickerInstance.id];
      if (typeof value === 'string') return value.trim();
      if (value && typeof value === 'object' && typeof value.address === 'string') return value.address.trim();
      return '';
    })()
    : '';
  const sidebarStyleRaw = launcherSettings?.sidebar_style || 'full';
  const isOriginalSidebarStyle = sidebarStyleRaw === 'original' || sidebarStyleRaw === 'original-slim';
  const instanceHeaderStyleRaw = launcherSettings?.instance_header_style || cachedInstanceHeaderStyle || 'glass-top';
  const normalizedInstanceHeaderStyle = instanceHeaderStyleRaw === 'glass-top'
    || instanceHeaderStyleRaw === 'glass-top-icons'
    || instanceHeaderStyleRaw === 'glass-bottom'
    || instanceHeaderStyleRaw === 'glass-bottom-icons'
    || instanceHeaderStyleRaw === 'center-dock-fold-icons'
    ? instanceHeaderStyleRaw
    : instanceHeaderStyleRaw === 'simple-left-corner'
      ? 'glass-bottom-icons'
      : instanceHeaderStyleRaw === 'glass-dark'
        ? 'glass-bottom'
        : 'glass-top';
  const instanceHeaderStyle = isOriginalSidebarStyle && normalizedInstanceHeaderStyle === 'center-dock-fold-icons'
    ? 'glass-top-icons'
    : normalizedInstanceHeaderStyle;
  const isCenterDockHeaderStyle = instanceHeaderStyle === 'center-dock-fold-icons';
  const isDockClosingAnimation = dockAnimationState === 'dock-anim-closing';
  const isCenterDockVisuallyExpanded = isCenterDockExpanded;
  const isCenterDockActionsExpanded = isCenterDockExpanded;
  const centerDockToggleLabel = isCenterDockExpanded || isDockClosingAnimation
    ? 'Collapse instance controls'
    : 'Expand instance controls';
  const isIconHeaderStyle = instanceHeaderStyle === 'glass-bottom-icons' || instanceHeaderStyle === 'glass-top-icons';
  const openHeaderDropdownUpwards = !isCenterDockHeaderStyle && (instanceHeaderStyle === 'glass-bottom' || instanceHeaderStyle === 'glass-bottom-icons');
  const renderInstanceCard = (instance, enterIndex) => {
    const rawLoader = (instance.mod_loader || '').trim();
    const loaderLabel = rawLoader ? (rawLoader.toLowerCase() === 'vanilla' ? 'Vanilla' : rawLoader) : 'Vanilla';
    const loaderClass = loaderLabel.toLowerCase().replace(/\s+/g, '-');
    const hasPinnedAccount = Boolean(instance.preferred_account && instance.preferred_account.trim() !== '');
    const playtimeLabel = formatPlaytime(instance.playtime_seconds);
    const isGridView = viewMode === 'grid';
    const isLaunching = launchingInstanceIds.includes(instance.id) || instance.id === launchingInstanceId;
    const isStopping = stoppingInstanceIds.includes(instance.id);
    const isDeleting = deletingInstanceIds.includes(instance.id);
    const setupData = setupProgressByInstance[instance.id];
    const isSettingUp = Boolean(setupData);
    const launchData = launchProgressByInstance[instance.id];
    const launchTelemetry = launchData?.telemetry || loadingTelemetry;
    const launchBytes = launchData?.bytes || loadingBytes;
    const launchCount = launchData?.count || loadingCount;
    const launchProgress = clampProgress(launchData?.progress ?? loadingProgress);
    const launchStageLabel = launchTelemetry.stageLabel || launchData?.status || loadingStatus || 'Launching...';
    const isRunning = Boolean(runningInstances[instance.id]);
    const preferredServerEntry = preferredServerMap[instance.id];
    const preferredServerAddress = typeof preferredServerEntry === 'string'
      ? preferredServerEntry.trim()
      : (typeof preferredServerEntry?.address === 'string' ? preferredServerEntry.address.trim() : '');
    const preferredServerName = typeof preferredServerEntry === 'object' && typeof preferredServerEntry?.name === 'string'
      ? preferredServerEntry.name.trim()
      : '';
    const hasPinnedServer = Boolean(preferredServerAddress);
    const launchButtonTitle = isRunning
      ? 'Stop instance'
      : (isSettingUp
        ? 'Setting up files...'
        : (hasPinnedServer
          ? `Launch and join ${preferredServerName || preferredServerAddress}`
          : 'Launch instance'));
    const serverButtonTitle = hasPinnedServer
      ? `Selected server: ${preferredServerName || preferredServerAddress}`
      : 'Pick server for Play button';
    const hasModpackAttribution = Boolean(
      instance.modpack_provider
        && (instance.modpack_title || instance.modpack_project_id || instance.modpack_url)
    );
    const accountButton = (
      <button
        className={`instance-account-corner-btn ${hasPinnedAccount ? 'is-pinned' : ''} ${isGridView ? 'is-grid' : 'is-list'}`}
        title={hasPinnedAccount ? `Pinned account: ${instance.preferred_account}` : 'Use active account (click to choose)'}
        aria-label={hasPinnedAccount ? `Pinned account: ${instance.preferred_account}` : 'Use active account'}
        onClick={(event) => handleOpenAccountPicker(event, instance)}
        disabled={isLaunching || isStopping}
      >
        {hasPinnedAccount ? <UserRoundCheck size={16} /> : <UsersRound size={16} />}
      </button>
    );
    const serverButton = (
      <button
        className={`instance-account-corner-btn instance-server-corner-btn ${hasPinnedServer ? 'is-selected' : ''} ${isGridView ? 'is-grid' : 'is-list'}`}
        type="button"
        title={serverButtonTitle}
        aria-label={serverButtonTitle}
        onClick={(event) => handleOpenServerPicker(event, instance)}
        disabled={isLaunching || isStopping}
      >
        {hasPinnedServer ? <Server size={16} /> : <ServerOff size={16} />}
      </button>
    );
    const instanceActions = (
      <>
        <button
          className={`instance-list-play-btn ${runningInstances[instance.id] ? 'is-running' : ''} ${isLaunching && !runningInstances[instance.id] ? 'is-launching' : ''} ${isStopping ? 'is-stopping' : ''}`}
          onClick={() => {
            if (runningInstances[instance.id]) {
              onStop(instance.id);
              return;
            }
            if (isSettingUp) return;
            onLaunch(instance.id, hasPinnedServer ? { serverAddress: preferredServerAddress } : undefined);
          }}
          disabled={isLoading || isLaunching || isStopping || isSettingUp}
          title={launchButtonTitle}
          aria-label={launchButtonTitle}
        >
          {runningInstances[instance.id] ? <Square size={15} /> : <Play size={15} />}
          <span>{runningInstances[instance.id] ? (isStopping ? 'Stopping...' : 'Playing') : (isLaunching ? 'Launching...' : 'Play')}</span>
        </button>

        <div className="instance-row-menu-anchor">
          <button
            className="instance-kebab-btn"
            type="button"
            title="Open instance editor"
            aria-label="Open instance editor"
            disabled={isStopping}
            onClick={(event) => openInstanceEditorFromButton(event, instance)}
          >
            <MoreVertical size={18} />
          </button>
        </div>
        {!isGridView && serverButton}
        {!isGridView && accountButton}
      </>
    );

    return (
      <div
        key={instance.id}
        ref={(node) => setInstanceCardRef(instance.id, node)}
        className={`instance-card ${runningInstances[instance.id] ? 'is-running' : ''} ${isDeleting ? 'deleting' : ''} ${isLaunching ? 'launching' : ''} ${isStopping ? 'stopping' : ''} ${isSettingUp ? 'setting-up' : ''}`}
        style={{
          '--instance-enter-index': enterIndex,
          '--instance-accent': 'var(--accent)',
          '--instance-icon-accent': 'var(--border)'
        }}
        onContextMenu={(e) => {
          e.preventDefault();
          e.stopPropagation();
          onContextMenu(e, instance);
        }}
      >
        {isDeleting && (
          <div className="deleting-overlay">
            <div className="deleting-spinner" />
            <span className="deleting-text">Removing...</span>
          </div>
        )}
        {isStopping ? (
          isGridView ? (
            <div className="stopping-overlay">
              <div className="stopping-spinner" />
              <span className="stopping-status">Stopping instance...</span>
              <div className="stopping-progress-bar">
                <div className="stopping-progress-fill" />
              </div>
            </div>
          ) : (
            <div className="stopping-overlay stopping-overlay-list">
              <div className="stopping-list-top">
                <div className="stopping-spinner" />
                <span className="stopping-status">Stopping instance...</span>
              </div>
              <div className="stopping-progress-bar">
                <div className="stopping-progress-fill" />
              </div>
            </div>
          )
        ) : isLaunching ? (
          isGridView ? (
            <div className="launching-overlay launching-overlay-grid">
              <div className="launching-grid-top">
                <div className="launching-spinner" />
                <span className="launching-status">{launchStageLabel}</span>
                <span className="launching-percentage">{launchProgress.toFixed(1)}%</span>
              </div>
              <div className="launching-progress-bar">
                <div className="launching-progress-fill" style={{ width: `${launchProgress}%` }} />
              </div>
              {launchTelemetry.currentItem && (
                <span className="launching-item">{launchTelemetry.currentItem}</span>
              )}
              {(launchBytes.total > 0 || launchCount.total > 0 || launchTelemetry.speedBps > 0) && (
                <div className="launching-grid-meta">
                  {launchBytes.total > 0 && (
                    <span className="launching-bytes">
                      {formatBytes(launchBytes.current)} / {formatBytes(launchBytes.total)}
                    </span>
                  )}
                  {launchCount.total > 0 && (
                    <span className="launching-file-count">
                      {launchCount.current} / {launchCount.total} files
                    </span>
                  )}
                  {launchTelemetry.speedBps > 0 && (
                    <span className="launching-transfer-meta">
                      {formatSpeed(launchTelemetry.speedBps)}
                    </span>
                  )}
                </div>
              )}
            </div>
          ) : (
            <div className="launching-overlay launching-overlay-list">
              <div className="launching-list-top">
                <div className="launching-spinner" />
                <span className="launching-status">{launchStageLabel}</span>
                <span className="launching-percentage">{launchProgress.toFixed(1)}%</span>
              </div>
              <div className="launching-progress-bar">
                <div className="launching-progress-fill" style={{ width: `${launchProgress}%` }} />
              </div>
              {launchTelemetry.currentItem && (
                <span className="launching-item">{launchTelemetry.currentItem}</span>
              )}
              {(launchBytes.total > 0 || launchCount.total > 0 || launchTelemetry.speedBps > 0) && (
                <div className="launching-list-meta">
                  {launchBytes.total > 0 && (
                    <span className="launching-bytes">
                      {formatBytes(launchBytes.current)} / {formatBytes(launchBytes.total)}
                    </span>
                  )}
                  {launchCount.total > 0 && (
                    <span className="launching-file-count">
                      {launchCount.current} / {launchCount.total} files
                    </span>
                  )}
                  {launchTelemetry.speedBps > 0 && (
                    <span className="launching-transfer-meta">
                      {formatSpeed(launchTelemetry.speedBps)}
                    </span>
                  )}
                </div>
              )}
            </div>
          )
        ) : isSettingUp ? (
          <div className={`instance-setup-simple-overlay ${isGridView ? 'grid' : 'list'}`}>
            <div className="launching-spinner" />
            <span className="instance-setup-simple-text">Setting up instance...</span>
          </div>
        ) : null}

        <div className={`instance-row-main ${isGridView ? 'instance-row-main-grid' : ''}`}>
          <div className="instance-logo-wrapper">
              {runningInstances[instance.id] && (
                <span
                  className="instance-running-blob"
                  title="Running"
                  aria-label="Running"
                />
              )}
            <div className="instance-logo">
              {logoMap[instance.id] ? (
                <img
                  src={logoMap[instance.id]}
                  alt=""
                  onError={(e) => {
                    if (!e.target.src.endsWith('/minecraft_logo.png')) {
                      e.target.src = '/minecraft_logo.png';
                    } else {
                      e.target.style.display = 'none';
                      if (e.target.nextSibling) {
                        e.target.nextSibling.style.display = 'block';
                      }
                    }
                  }}
                />
              ) : null}
              <div
                className="instance-logo-fallback"
                style={{ display: logoMap[instance.id] ? 'none' : 'block' }}
              />
            </div>
          </div>
          <div className={`instance-info instance-info-list ${isGridView ? 'instance-info-grid' : ''}`}>
            <div className="instance-row-title">
              <div className="instance-name-line">
                {hasModpackAttribution && (
                  <button
                    className="instance-modpack-info-btn"
                    type="button"
                    title="View modpack attribution"
                    aria-label="View modpack attribution"
                    onClick={(event) => handleOpenModpackInfo(event, instance)}
                  >
                    <Info size={16} />
                  </button>
                )}
                <h3 className="instance-name">{instance.name}</h3>
              </div>
              {!isGridView && (
                <span className="instance-title-version" title={`Minecraft version ${instance.version_id}`}>
                  <Tag className="meta-icon" size={12} />
                  {instance.version_id}
                </span>
              )}
            </div>
            {isGridView ? (
              <div className="instance-title-version-line">
                <span className="instance-meta-text version" title={`Minecraft version ${instance.version_id}`}>
                  <Tag className="meta-icon" size={12} />
                  {instance.version_id}
                </span>
              </div>
            ) : (
              <div className="instance-list-meta-line">
                <span className={`instance-meta-text mod-loader ${loaderClass}`}>
                  <Boxes className="meta-icon" size={12} />
                  {loaderLabel}
                </span>
                <span className="instance-meta-text played">
                  <CalendarDays className="meta-icon" size={12} />
                  {formatDate(instance.last_played)}
                </span>
                {playtimeLabel && (
                  <span className="instance-meta-text playtime">
                    <Clock className="meta-icon" size={12} />
                    <span className="instance-meta-value">{playtimeLabel}</span>
                  </span>
                )}
              </div>
            )}
          </div>
          {isGridView && (
            <div className="instance-actions">
              {instanceActions}
            </div>
          )}
        </div>
        {isGridView ? (
          <div className="instance-list-meta-line instance-list-meta-line-grid">
            <span className={`instance-meta-text mod-loader ${loaderClass}`}>
              <Boxes className="meta-icon" size={12} />
              {loaderLabel}
            </span>
            <span className="instance-meta-text played">
              <CalendarDays className="meta-icon" size={12} />
              {formatDate(instance.last_played)}
            </span>
            {playtimeLabel && (
              <span className="instance-meta-text playtime">
                <Clock className="meta-icon" size={12} />
                <span className="instance-meta-value">{playtimeLabel}</span>
              </span>
            )}
          </div>
        ) : (
          <div className="instance-actions">
            {instanceActions}
          </div>
        )}
        {isGridView && (
          <>
            {serverButton}
            {accountButton}
          </>
        )}
      </div>
    );
  };

  const renderIconHeaderActions = (extraClassName = '') => (
    <div className={`header-actions header-actions-icon ${extraClassName}`.trim()}>
      <div className="header-icon-group">
        <button
          type="button"
          className={`instance-controls-filter-btn ${sortBy === 'name' ? 'active' : ''}`}
          onClick={() => handleSortChange({ target: { value: 'name' } })}
          title="Sort by Name"
          aria-label="Sort by Name"
        >
          <List size={16} />
        </button>
        <button
          type="button"
          className={`instance-controls-filter-btn ${sortBy === 'age' ? 'active' : ''}`}
          onClick={() => handleSortChange({ target: { value: 'age' } })}
          title="Sort by Creation Date"
          aria-label="Sort by Creation Date"
        >
          <CalendarDays size={16} />
        </button>
        <button
          type="button"
          className={`instance-controls-filter-btn ${sortBy === 'playtime' ? 'active' : ''}`}
          onClick={() => handleSortChange({ target: { value: 'playtime' } })}
          title="Sort by Playtime"
          aria-label="Sort by Playtime"
        >
          <Clock size={16} />
        </button>
        <div className="p-dropdown instance-category-filter-dropdown" ref={categoryFilterRef}>
          <button
            type="button"
            className={`instance-controls-filter-btn ${categoryFilter !== CATEGORY_FILTER_ALL ? 'active' : ''}`}
            onClick={() => {
              setIsCategoryFilterOpen((prev) => !prev);
              setIsSortOpen(false);
            }}
            title={`Filter by Category: ${activeCategoryFilterLabel}`}
            aria-label={`Filter by Category: ${activeCategoryFilterLabel}`}
          >
            <Tag size={16} />
          </button>
          {isCategoryFilterOpen && (
            <div className={`p-dropdown-menu ${openHeaderDropdownUpwards ? 'instance-header-dropdown-menu-upwards' : ''}`}>
              <div
                className={`p-dropdown-item ${categoryFilter === CATEGORY_FILTER_ALL ? 'selected' : ''}`}
                onClick={() => {
                  handleCategoryFilterChange(CATEGORY_FILTER_ALL);
                  setIsCategoryFilterOpen(false);
                }}
              >
                <span className="item-label">All categories</span>
                {categoryFilter === CATEGORY_FILTER_ALL && <Check size={14} className="selected-icon" />}
              </div>
              <div
                className={`p-dropdown-item ${categoryFilter === CATEGORY_FILTER_UNCATEGORIZED ? 'selected' : ''}`}
                onClick={() => {
                  handleCategoryFilterChange(CATEGORY_FILTER_UNCATEGORIZED);
                  setIsCategoryFilterOpen(false);
                }}
              >
                <span className="item-label">Uncategorized</span>
                {categoryFilter === CATEGORY_FILTER_UNCATEGORIZED && <Check size={14} className="selected-icon" />}
              </div>
              {availableCategoryOptions.map((category) => (
                <div
                  key={category}
                  className={`p-dropdown-item ${categoryFilter.toLowerCase() === category.toLowerCase() ? 'selected' : ''}`}
                  onClick={() => {
                    handleCategoryFilterChange(category);
                    setIsCategoryFilterOpen(false);
                  }}
                >
                  <span className="item-label">{category}</span>
                  {categoryFilter.toLowerCase() === category.toLowerCase() && <Check size={14} className="selected-icon" />}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <span className="header-divider" aria-hidden="true" />

      <div className="view-controls header-view-controls-icon">
        <button
          className={`view-btn ${viewMode === 'list' ? 'active' : ''}`}
          onClick={switchToListView}
          title="List View"
        >
          <List size={18} />
        </button>
        <button
          className={`view-btn ${viewMode === 'grid' ? 'active' : ''}`}
          onClick={switchToGridView}
          title="Grid View"
        >
          <LayoutGrid size={18} />
        </button>
      </div>

      <span className="header-divider" aria-hidden="true" />

      <button
        type="button"
        className="instance-controls-filter-btn"
        onClick={() => setShowCategoryManagerModal(true)}
        title="Manage Categories"
        aria-label="Manage Categories"
      >
        <Boxes size={16} />
      </button>

      <span className="header-divider" aria-hidden="true" />

      <button
        type="button"
        className="instance-controls-create-btn"
        onClick={onCreate}
        disabled={isLoading}
        title="Create New Instance"
        aria-label="Create New Instance"
      >
        <Plus size={18} />
      </button>
    </div>
  );

  return (
    <div className={`instance-list-wrapper ${viewMode === 'list' ? 'list-mode' : 'grid-mode'} header-style-${instanceHeaderStyle} ${isCenterDockHeaderStyle ? (isCenterDockVisuallyExpanded ? 'dock-open' : 'dock-collapsed') : ''} ${dockAnimationState} ${isEntering ? 'is-entering' : ''}`}>
      {instances.length > 0 && (
        <>
          {isCenterDockHeaderStyle && (
            <div className={`instance-header-dock-connector ${(isCenterDockExpanded || isDockClosingAnimation) ? 'expanded' : 'collapsed'}`} aria-hidden="true">
              <span className="instance-header-dock-line instance-header-dock-line-left" />
              <span className="instance-header-dock-notch instance-header-dock-notch-left" />
              <span className="instance-header-dock-notch-bottom" />
              <span className="instance-header-dock-notch instance-header-dock-notch-right" />
              <span className="instance-header-dock-line instance-header-dock-line-right" />
            </div>
          )}
          <div className={`instance-header instance-header-style-${instanceHeaderStyle}`}>
            {isCenterDockHeaderStyle ? (
              <div className={`instance-header-center-dock ${isCenterDockExpanded ? 'expanded' : 'collapsed'}`}>
                <div className={`instance-header-center-actions-wrap ${isCenterDockActionsExpanded ? 'expanded' : 'collapsed'}`}>
                  {renderIconHeaderActions('instance-header-center-actions')}
                </div>
                <button
                  type="button"
                  className="instance-header-center-toggle collapsed instance-header-center-unified-toggle"
                  title={centerDockToggleLabel}
                  aria-label={centerDockToggleLabel}
                  aria-expanded={isCenterDockExpanded}
                  onClick={toggleCenterDockExpanded}
                />
              </div>
            ) : isIconHeaderStyle ? (
              renderIconHeaderActions()
            ) : (
              <div className="header-actions">
                <div className="sort-controls">
                  <span className="p-dropdown-label">Sort by:</span>
                  <div className="p-dropdown" ref={sortRef}>
                    <button
                      className={`p-dropdown-trigger ${isSortOpen ? 'active' : ''}`}
                      style={{ minWidth: '120px' }}
                      onClick={() => setIsSortOpen(!isSortOpen)}
                    >
                      <span className="trigger-label">
                        {sortBy === 'name' && 'Name'}
                        {sortBy === 'age' && 'Creation Date'}
                        {sortBy === 'playtime' && 'Playtime'}
                      </span>
                      <ChevronDown size={14} className={`trigger-icon ${isSortOpen ? 'flip' : ''}`} />
                    </button>

                    {isSortOpen && (
                      <div className={`p-dropdown-menu ${openHeaderDropdownUpwards ? 'instance-header-dropdown-menu-upwards' : ''}`}>
                        <div
                          className={`p-dropdown-item ${sortBy === 'name' ? 'selected' : ''}`}
                          onClick={() => {
                            handleSortChange({ target: { value: 'name' } });
                            setIsSortOpen(false);
                          }}
                        >
                          <span className="item-label">Name</span>
                          {sortBy === 'name' && <Check size={14} className="selected-icon" />}
                        </div>
                        <div
                          className={`p-dropdown-item ${sortBy === 'age' ? 'selected' : ''}`}
                          onClick={() => {
                            handleSortChange({ target: { value: 'age' } });
                            setIsSortOpen(false);
                          }}
                        >
                          <span className="item-label">Creation Date</span>
                          {sortBy === 'age' && <Check size={14} className="selected-icon" />}
                        </div>
                        <div
                          className={`p-dropdown-item ${sortBy === 'playtime' ? 'selected' : ''}`}
                          onClick={() => {
                            handleSortChange({ target: { value: 'playtime' } });
                            setIsSortOpen(false);
                          }}
                        >
                          <span className="item-label">Playtime</span>
                          {sortBy === 'playtime' && <Check size={14} className="selected-icon" />}
                        </div>
                      </div>
                    )}
                  </div>

                  <span className="p-dropdown-label">Category:</span>
                  <div className="p-dropdown" ref={categoryFilterRef}>
                    <button
                      className={`p-dropdown-trigger ${isCategoryFilterOpen ? 'active' : ''}`}
                      style={{ minWidth: '170px' }}
                      onClick={() => {
                        setIsCategoryFilterOpen((prev) => !prev);
                        setIsSortOpen(false);
                      }}
                    >
                      <span className="trigger-label">{activeCategoryFilterLabel}</span>
                      <ChevronDown size={14} className={`trigger-icon ${isCategoryFilterOpen ? 'flip' : ''}`} />
                    </button>

                    {isCategoryFilterOpen && (
                      <div className={`p-dropdown-menu ${openHeaderDropdownUpwards ? 'instance-header-dropdown-menu-upwards' : ''}`}>
                        <div
                          className={`p-dropdown-item ${categoryFilter === CATEGORY_FILTER_ALL ? 'selected' : ''}`}
                          onClick={() => {
                            handleCategoryFilterChange(CATEGORY_FILTER_ALL);
                            setIsCategoryFilterOpen(false);
                          }}
                        >
                          <span className="item-label">All categories</span>
                          {categoryFilter === CATEGORY_FILTER_ALL && <Check size={14} className="selected-icon" />}
                        </div>
                        <div
                          className={`p-dropdown-item ${categoryFilter === CATEGORY_FILTER_UNCATEGORIZED ? 'selected' : ''}`}
                          onClick={() => {
                            handleCategoryFilterChange(CATEGORY_FILTER_UNCATEGORIZED);
                            setIsCategoryFilterOpen(false);
                          }}
                        >
                          <span className="item-label">Uncategorized</span>
                          {categoryFilter === CATEGORY_FILTER_UNCATEGORIZED && <Check size={14} className="selected-icon" />}
                        </div>
                        {availableCategoryOptions.map((category) => (
                          <div
                            key={category}
                            className={`p-dropdown-item ${categoryFilter.toLowerCase() === category.toLowerCase() ? 'selected' : ''}`}
                            onClick={() => {
                              handleCategoryFilterChange(category);
                              setIsCategoryFilterOpen(false);
                            }}
                          >
                            <span className="item-label">{category}</span>
                            {categoryFilter.toLowerCase() === category.toLowerCase() && <Check size={14} className="selected-icon" />}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  <span className="header-divider" aria-hidden="true" />

                  <div className="view-controls">
                    <button
                      className={`view-btn ${viewMode === 'list' ? 'active' : ''}`}
                      onClick={switchToListView}
                      title="List View"
                    >
                      <List size={18} />
                    </button>
                    <button
                      className={`view-btn ${viewMode === 'grid' ? 'active' : ''}`}
                      onClick={switchToGridView}
                      title="Grid View"
                    >
                      <LayoutGrid size={18} />
                    </button>
                  </div>
                </div>
                <span className="header-divider" aria-hidden="true" />
                <button className="btn btn-secondary" onClick={() => setShowCategoryManagerModal(true)}>
                  Manage Categories
                </button>
                <span className="header-divider" aria-hidden="true" />
                <button className="btn btn-primary" onClick={onCreate} disabled={isLoading}>
                  + New Instance
                </button>
              </div>
            )}
          </div>
        </>
      )}
      <div className={`instance-list`} onContextMenu={handleContainerContextMenu}>

      {backgroundTasks.length > 0 && (
        <div className="instance-setup-tasks">
          {backgroundTasks.map((task, taskIndex) => {
            const taskProgress = clampProgress(typeof task?.progress === 'number' ? task.progress : 0);
            const taskStatus = task?.stageLabel || task?.status || 'Working...';
            const hasMetrics = (task?.totalBytes > 0) || (task?.totalCount > 0) || (task?.speedBps > 0);
            const isImportTask = typeof task?.name === 'string' && task.name.toLowerCase().startsWith('importing ');
            const showImportInfo = Boolean(openImportInfoByTask[task.id]);
            const isCollapsed = Boolean(collapsedSetupTasks[task.id]);
            const taskActivity = Array.isArray(task?.activityLog) ? task.activityLog : [];
            const taskEnterIndex = Math.min(taskIndex, 8);

            return (
              <div
                key={task.id}
                className={`instance-setup-task-card ${isCollapsed ? 'collapsed' : ''}`}
                style={{ '--setup-task-enter-index': taskEnterIndex }}
              >
                <div className="instance-setup-task-main">
                  <div className="instance-setup-task-name-wrap">
                    <span className="instance-setup-task-name">{task.name || 'Instance setup'}</span>
                    {isImportTask && !isCollapsed && (
                      <button
                        type="button"
                        className={`instance-setup-info-btn ${showImportInfo ? 'active' : ''}`}
                        title="Why import can be slower"
                        aria-label="Why import can be slower"
                        onClick={() => {
                          setOpenImportInfoByTask((prev) => ({
                            ...prev,
                            [task.id]: !prev[task.id]
                          }));
                        }}
                      >
                        <Info size={13} />
                      </button>
                    )}
                  </div>
                  <div className="instance-setup-task-trailing">
                    <span className="instance-setup-task-percent">{taskProgress.toFixed(1)}%</span>
                    <button
                      type="button"
                      className={`instance-setup-collapse-btn ${isCollapsed ? 'collapsed' : ''}`}
                      title={isCollapsed ? 'Expand details' : 'Collapse details'}
                      aria-label={isCollapsed ? 'Expand details' : 'Collapse details'}
                      onClick={() => {
                        setCollapsedSetupTasks((prev) => ({
                          ...prev,
                          [task.id]: !prev[task.id]
                        }));
                      }}
                    >
                      <ChevronDown size={14} />
                    </button>
                  </div>
                </div>
                {!isCollapsed && (
                  <>
                    <div className="instance-setup-task-status">{taskStatus}</div>
                    {isImportTask && showImportInfo && (
                      <div className="instance-setup-task-note">
                        Import can be slower on Windows because Palethea first extracts the archive to a temporary folder, then copies it into the instance directory for safer validation and rollback.
                      </div>
                    )}
                    {task?.currentItem && (
                      taskActivity.length > 0 ? (
                        <div className="instance-setup-task-activity">
                          {taskActivity.slice(0, 4).map((line, index) => (
                            <div key={`${task.id}-activity-${index}`} className="instance-setup-task-activity-line">
                              {line}
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div className="instance-setup-task-item">{task.currentItem}</div>
                      )
                    )}
                    <div className="instance-setup-task-progress">
                      <div className="instance-setup-task-progress-fill" style={{ width: `${taskProgress}%` }} />
                    </div>
                    {hasMetrics && (
                      <div className="instance-setup-task-metrics">
                        {task.totalCount > 0 && <span>{task.currentCount || 0}/{task.totalCount} files</span>}
                        {task.totalBytes > 0 && <span>{formatBytes(task.downloadedBytes || 0)} / {formatBytes(task.totalBytes)}</span>}
                        {task.speedBps > 0 && <span>{formatSpeed(task.speedBps)}</span>}
                      </div>
                    )}
                  </>
                )}
              </div>
            );
          })}
        </div>
      )}

      {instances.length === 0 ? (
        <div className="empty-state">
          <div className="empty-state-visual">
            <Box
              className="empty-icon-main"
              size={56}
              style={{
                color: 'var(--accent)',
                opacity: 0.8
              }}
            />
          </div>
          <div className="empty-state-content">
            <h2>Your collection is empty</h2>
            <p>Ready to start a new adventure? Create a custom instance or install a modpack to see it here.</p>
            <button className="btn btn-primary btn-large btn-with-icon" onClick={onCreate}>
              <Plus size={18} />
              Create your first instance
            </button>
          </div>
        </div>
      ) : filteredAndSortedInstances.length === 0 ? (
        <div className="empty-state">
          <div className="empty-state-visual">
            <Tag
              className="empty-icon-main"
              size={56}
              style={{
                color: 'var(--accent)',
                opacity: 0.8
              }}
            />
          </div>
          <div className="empty-state-content">
            <h2>No instances in this category</h2>
            <p>Try selecting another category filter, or clear the filter to show all instances.</p>
          </div>
        </div>
      ) : (
        <div className={`instances-grid ${viewMode} ${launcherSettings?.enable_instance_animations === false ? 'no-animations' : ''}`}>
          {visibleCategorySections.length === 0 ? (
            filteredAndSortedInstances.map((instance, instanceIndex) => renderInstanceCard(instance, Math.min(instanceIndex, 10)))
          ) : (
            visibleCategorySections.map((section) => {
              const sectionStateKey = `section-${section.key}`;
              const isCollapsed = Boolean(collapsedCategorySections[sectionStateKey]);

              return (
                <section key={section.key} className={`instance-category-section ${isCollapsed ? 'collapsed' : ''}`}>
                  <button
                    type="button"
                    className={`instance-category-row-header ${isCollapsed ? 'collapsed' : ''}`}
                    onClick={() => {
                      setCollapsedCategorySections((prev) => ({
                        ...prev,
                        [sectionStateKey]: !prev[sectionStateKey]
                      }));
                    }}
                    onContextMenu={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      onContextMenu?.(event, {
                        __kind: 'category',
                        name: section.label,
                        bucketKey: section.bucketKey,
                        instanceCount: section.instances.length
                      });
                    }}
                  >
                    <ChevronDown size={16} className="instance-category-row-chevron" />
                    <span className="instance-category-row-title">
                      {section.label}
                    </span>
                    <span className="instance-category-row-count">{section.instances.length}</span>
                  </button>
                  <div className={`instance-category-section-body ${isCollapsed ? 'collapsed' : ''}`}>
                    <div className="instance-category-section-body-inner">
                      <div className={`instance-category-section-cards ${viewMode}`}>
                        {section.instances.map((instance, groupedIndex) => renderInstanceCard(instance, Math.min(groupedIndex, 10)))}
                      </div>
                    </div>
                  </div>
                </section>
              );
            })
          )}
        </div>
      )}
      {showCategoryManagerModal && (
        <div className="instance-account-modal-overlay" onClick={() => setShowCategoryManagerModal(false)}>
          <div className="instance-account-modal instance-category-manager-modal" onClick={(event) => event.stopPropagation()}>
            <div className="instance-account-modal-header">
              <div>
                <h3>Manage Categories</h3>
                <p>Create, rename, delete, reorder, and bulk-assign categories.</p>
              </div>
              <button
                className="instance-account-modal-close"
                onClick={() => setShowCategoryManagerModal(false)}
                title="Close"
              >
                <X size={18} />
              </button>
            </div>

            <div className="instance-category-manager-body">
              <div className="instance-category-manager-layout">
                <div className="instance-category-manager-categories-pane">
                  <h4>Categories</h4>
                  <div className="instance-category-manager-row">
                    <input
                      type="text"
                      value={newCategoryName}
                      onChange={(event) => setNewCategoryName(event.target.value)}
                      placeholder="New category name"
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') {
                          event.preventDefault();
                          handleAddCategory();
                        }
                      }}
                    />
                    <button
                      type="button"
                      className="btn btn-secondary"
                      onClick={handleAddCategory}
                      disabled={bulkUpdatingCategories}
                    >
                      Add
                    </button>
                  </div>

                  <div
                    ref={categoryManagerListRef}
                    className={`instance-category-manager-categories-list ${draggedCategoryKey ? 'drag-active' : ''}`}
                  >
                    {categoryAssignmentOptions.length === 0 ? (
                      <div className="instance-category-manager-empty">No categories yet.</div>
                    ) : (
                      categoryAssignmentOptions.map((category) => {
                        const categoryKey = toCategoryKey(category);
                        const usageCount = categoryUsageCountMap.get(categoryKey) || 0;
                        const isEditing = editingCategoryKey === categoryKey;
                        const isPendingDelete = pendingDeleteCategoryKey === categoryKey;

                        return (
                          <div
                            key={categoryKey}
                            data-category-key={categoryKey}
                            ref={(node) => {
                              if (node) {
                                categoryManagerItemRefs.current.set(categoryKey, node);
                              } else {
                                categoryManagerItemRefs.current.delete(categoryKey);
                              }
                            }}
                            className={`instance-category-manager-category-item ${dragOverCategoryKey === categoryKey ? 'drag-over' : ''} ${draggedCategoryKey === categoryKey ? 'drag-source' : ''}`}
                            onPointerDown={(event) => {
                              if (bulkUpdatingCategories || isEditing || isPendingDelete) return;
                              handleCategoryManagerPointerDown(event, categoryKey);
                            }}
                          >
                            {isEditing ? (
                              <div className="instance-category-manager-edit-row">
                                <input
                                  type="text"
                                  value={editingCategoryValue}
                                  onChange={(event) => setEditingCategoryValue(event.target.value)}
                                  onKeyDown={(event) => {
                                    if (event.key === 'Enter') {
                                      event.preventDefault();
                                      commitCategoryRename(category);
                                    }
                                    if (event.key === 'Escape') {
                                      event.preventDefault();
                                      cancelCategoryRename();
                                    }
                                  }}
                                  autoFocus
                                />
                                <button
                                  type="button"
                                  className="instance-category-manager-icon-btn"
                                  onClick={() => commitCategoryRename(category)}
                                  title="Save category name"
                                  disabled={bulkUpdatingCategories}
                                >
                                  <Check size={14} />
                                </button>
                                <button
                                  type="button"
                                  className="instance-category-manager-icon-btn"
                                  onClick={cancelCategoryRename}
                                  title="Cancel rename"
                                  disabled={bulkUpdatingCategories}
                                >
                                  <X size={14} />
                                </button>
                              </div>
                            ) : (
                              <div className="instance-category-manager-category-main">
                                <button
                                  type="button"
                                  className="instance-category-manager-drag-handle"
                                  title="Drag to reorder"
                                  aria-label="Drag to reorder"
                                  tabIndex={-1}
                                  onPointerDown={(event) => {
                                    if (bulkUpdatingCategories || isEditing || isPendingDelete) return;
                                    event.preventDefault();
                                    event.stopPropagation();
                                    startCategoryManagerPointerDrag(categoryKey, event.pointerId, event.clientY);
                                  }}
                                  onClick={(event) => event.preventDefault()}
                                >
                                  <GripVertical size={14} />
                                </button>
                                <div className="instance-category-manager-category-copy">
                                  <span className="instance-category-manager-category-name">{category}</span>
                                  <span className="instance-category-manager-category-count">{usageCount} instances</span>
                                </div>
                                <button
                                  type="button"
                                  className="instance-category-manager-icon-btn"
                                  title="Rename category"
                                  onClick={() => beginCategoryRename(category)}
                                  disabled={bulkUpdatingCategories}
                                >
                                  <Pencil size={14} />
                                </button>
                                <button
                                  type="button"
                                  className="instance-category-manager-icon-btn danger"
                                  title="Delete category"
                                  onClick={() => {
                                    setPendingDeleteCategoryKey(categoryKey);
                                    setEditingCategoryKey('');
                                    setEditingCategoryValue('');
                                  }}
                                  disabled={bulkUpdatingCategories}
                                >
                                  <Trash2 size={14} />
                                </button>
                              </div>
                            )}
                            {isPendingDelete && (
                              <div className="instance-category-manager-delete-confirm">
                                <p>Delete this category and clear it from all assigned instances?</p>
                                <div className="instance-category-manager-delete-actions">
                                  <button
                                    type="button"
                                    className="btn btn-secondary"
                                    onClick={() => setPendingDeleteCategoryKey('')}
                                    disabled={bulkUpdatingCategories}
                                  >
                                    Cancel
                                  </button>
                                  <button
                                    type="button"
                                    className="btn btn-danger"
                                    onClick={() => confirmDeleteCategory(category)}
                                    disabled={bulkUpdatingCategories}
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
                    {draggedCategoryEntry && (
                      <div ref={categoryDragOverlayRef} className="instance-category-manager-drag-overlay">
                        <div className="instance-category-manager-category-main">
                          <span className="instance-category-manager-drag-handle overlay-handle" aria-hidden>
                            <GripVertical size={14} />
                          </span>
                          <div className="instance-category-manager-category-copy">
                            <span className="instance-category-manager-category-name">{draggedCategoryEntry.category}</span>
                            <span className="instance-category-manager-category-count">{draggedCategoryEntry.usageCount} instances</span>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                <div className="instance-category-manager-assign-pane">
                  <h4>Assign To Instances</h4>
                  <div className="instance-category-manager-row">
                    <div className="p-dropdown instance-category-manager-select" ref={bulkCategoryDropdownRef}>
                      <button
                        type="button"
                        className={`p-dropdown-trigger ${isBulkCategoryDropdownOpen ? 'active' : ''}`}
                        onClick={() => {
                          if (bulkUpdatingCategories || categoryAssignmentOptions.length === 0) return;
                          setIsBulkCategoryDropdownOpen((prev) => !prev);
                        }}
                        disabled={bulkUpdatingCategories || categoryAssignmentOptions.length === 0}
                      >
                        <span className="trigger-label">{bulkCategoryTarget || 'Select category'}</span>
                        <ChevronDown size={14} className={`trigger-icon ${isBulkCategoryDropdownOpen ? 'flip' : ''}`} />
                      </button>

                      {isBulkCategoryDropdownOpen && (
                        <div className="p-dropdown-menu">
                          <div
                            className={`p-dropdown-item ${bulkCategoryTarget === '' ? 'selected' : ''}`}
                            onClick={() => {
                              setBulkCategoryTarget('');
                              setIsBulkCategoryDropdownOpen(false);
                            }}
                          >
                            <span className="item-label">Select category</span>
                            {bulkCategoryTarget === '' && <Check size={14} className="selected-icon" />}
                          </div>
                          {categoryAssignmentOptions.map((category) => (
                            <div
                              key={category}
                              className={`p-dropdown-item ${bulkCategoryTarget.toLowerCase() === category.toLowerCase() ? 'selected' : ''}`}
                              onClick={() => {
                                setBulkCategoryTarget(category);
                                setIsBulkCategoryDropdownOpen(false);
                              }}
                            >
                              <span className="item-label">{category}</span>
                              {bulkCategoryTarget.toLowerCase() === category.toLowerCase() && <Check size={14} className="selected-icon" />}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                    <button
                      type="button"
                      className="btn btn-secondary"
                      disabled={!bulkCategoryTarget || bulkSelectedInstanceIds.length === 0 || bulkUpdatingCategories}
                      onClick={() => applyBulkCategoryUpdate(bulkCategoryTarget)}
                    >
                      Assign
                    </button>
                    <button
                      type="button"
                      className="btn btn-secondary"
                      disabled={bulkSelectedInstanceIds.length === 0 || bulkUpdatingCategories}
                      onClick={() => applyBulkCategoryUpdate(null)}
                    >
                      Clear
                    </button>
                  </div>

                  <div className="instance-category-manager-tools">
                    <button
                      type="button"
                      className="btn btn-secondary"
                      onClick={() => setBulkSelectedInstanceIds(instances.map((instance) => instance.id))}
                      disabled={bulkUpdatingCategories}
                    >
                      Select All
                    </button>
                    <button
                      type="button"
                      className="btn btn-secondary"
                      onClick={() => setBulkSelectedInstanceIds([])}
                      disabled={bulkUpdatingCategories}
                    >
                      Clear Selection
                    </button>
                    <span>{bulkSelectedInstanceIds.length} selected</span>
                  </div>

                  <div className="instance-category-manager-list">
                    {instances.map((instance) => {
                      const checked = bulkSelectedInstanceIds.includes(instance.id);
                      const currentCategory = (instance.category || '').trim() || 'Uncategorized';
                      return (
                        <label key={instance.id} className={`instance-category-manager-item ${checked ? 'selected' : ''}`}>
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => handleToggleBulkSelection(instance.id)}
                          />
                          <div className="instance-category-manager-item-copy">
                            <span className="instance-category-manager-item-name">{instance.name}</span>
                            <span className="instance-category-manager-item-category">{currentCategory}</span>
                          </div>
                        </label>
                      );
                    })}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
      {showModpackInfoModal && modpackInfoInstance && (
        <ModpackInfoModal
          instance={modpackInfoInstance}
          iconUrl={logoMap[modpackInfoInstance.id] || null}
          onClose={() => {
            setShowModpackInfoModal(false);
            setModpackInfoInstance(null);
          }}
          onShowNotification={onShowNotification}
          onInstancesRefresh={onInstancesRefresh}
          onQueueDownload={onQueueDownload}
          onUpdateDownloadStatus={onUpdateDownloadStatus}
          onDequeueDownload={onDequeueDownload}
        />
      )}
      {showServerPickerModal && serverPickerInstance && (
        <div className="instance-account-modal-overlay" onClick={closeServerPickerModal}>
          <div className="instance-account-modal" onClick={(e) => e.stopPropagation()}>
            <div className="instance-account-modal-header">
              <div>
                <h3>Choose Preferred Server</h3>
                <p>
                  Select a saved server for <span className="instance-server-picker-instance-name">{serverPickerInstance.name}</span>. Once selected, the regular Play button
                  will automatically join that server on launch. If your server is missing, open this instance
                  in Minecraft, go to Multiplayer, add it there first, then come back and select it here.
                </p>
              </div>
              <button
                className="instance-account-modal-close"
                onClick={closeServerPickerModal}
                title="Close"
              >
                <X size={18} />
              </button>
            </div>

            <div className="instance-account-modal-list">
              {serverPickerLoading ? (
                <div className="instance-server-picker-empty">Loading servers...</div>
              ) : (
                <>
                  <button
                    className={`instance-account-option ${selectedServerAddressForPicker === '' ? 'selected' : ''}`}
                    onClick={() => handleSetPreferredServer('', '', null)}
                  >
                    <div className="instance-account-option-avatar">
                      <ServerOff size={16} />
                    </div>
                    <div className="instance-account-option-body">
                      <div className="instance-account-option-title">No auto-join server</div>
                      <div className="instance-account-option-sub">
                        Launch normally without joining a specific server.
                      </div>
                    </div>
                    {selectedServerAddressForPicker === '' && (
                      <Check size={16} className="instance-account-option-check" />
                    )}
                  </button>

                  {serverPickerServers.length === 0 ? (
                    <div className="instance-server-picker-empty">
                      No servers found for this instance yet. Add the server in-game first
                      (Minecraft &gt; Multiplayer &gt; Add Server) for this instance, then reopen this picker.
                    </div>
                  ) : (
                    serverPickerServers.map((server, index) => {
                      const serverName = (server?.name || '').trim() || 'Unnamed Server';
                      const serverAddress = typeof server?.ip === 'string' ? server.ip.trim() : '';
                      const isSelected = Boolean(serverAddress) && serverAddress === selectedServerAddressForPicker;
                      return (
                        <button
                          key={`${serverAddress || serverName}-${index}`}
                          className={`instance-account-option instance-server-picker-option ${isSelected ? 'selected' : ''}`}
                          onClick={() => handleSetPreferredServer(serverAddress, serverName, server?.icon || null)}
                          disabled={!serverAddress}
                        >
                          <div className="instance-account-option-avatar">
                            {server?.icon ? (
                              <img
                                src={`data:image/png;base64,${server.icon}`}
                                alt=""
                                className="instance-server-picker-avatar-img"
                              />
                            ) : (
                              <ServerOff size={16} />
                            )}
                          </div>
                          <div className="instance-account-option-body">
                            <div className="instance-account-option-title">{serverName}</div>
                            <div className="instance-account-option-sub">{serverAddress || 'No address set'}</div>
                          </div>
                          {isSelected && <Check size={16} className="instance-account-option-check" />}
                        </button>
                      );
                    })
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      )}
      {showAccountModal && accountPickerInstance && (
        <div className="instance-account-modal-overlay" onClick={() => { if (!updatingAccount) { setShowAccountModal(false); setAccountPickerInstance(null); } }}>
          <div className="instance-account-modal" onClick={(e) => e.stopPropagation()}>
            <div className="instance-account-modal-header">
              <div>
                <h3>Choose Launch Account</h3>
                <p>Pick an account just for this instance, or keep using the active account.</p>
              </div>
              <button
                className="instance-account-modal-close"
                onClick={() => { if (!updatingAccount) { setShowAccountModal(false); setAccountPickerInstance(null); } }}
                title="Close"
                disabled={updatingAccount}
              >
                <X size={18} />
              </button>
            </div>

            <div className="instance-account-modal-list">
              <button
                className={`instance-account-option ${(accountPickerInstance.preferred_account || '') === '' ? 'selected' : ''}`}
                onClick={() => handleSetPreferredAccount('')}
                disabled={updatingAccount}
              >
                <div className="instance-account-option-avatar">
                  {activeAccountForDefault?.uuid && skinCache[activeAccountForDefault.uuid] ? (
                    <SkinHead2D src={skinCache[activeAccountForDefault.uuid]} size={ACCOUNT_AVATAR_SIZE} />
                  ) : activeAccountForDefault?.is_microsoft ? (
                    <img
                      src={getSkinUrl(activeAccountForDefault.uuid, activeAccountForDefault.is_microsoft)}
                      alt=""
                      className="instance-account-avatar-img"
                      onError={(e) => {
                        e.target.src = STEVE_HEAD_DATA;
                        if (activeAccountForDefault?.uuid) {
                          setFailedImages((prev) => ({ ...prev, [activeAccountForDefault.uuid]: true }));
                        }
                      }}
                    />
                  ) : (
                    <User size={18} />
                  )}
                </div>
                <div className="instance-account-option-body">
                  <div className="instance-account-option-title">
                    Use Active Account
                    {activeAccountUsername && <span className="instance-account-option-meta">({activeAccountUsername})</span>}
                  </div>
                  <div className="instance-account-option-sub">Follows whatever account is currently active in the launcher.</div>
                </div>
                {(accountPickerInstance.preferred_account || '') === '' && <Check size={16} className="instance-account-option-check" />}
              </button>

              {savedAccounts.map((account) => (
                <button
                  key={`${account.uuid || 'no-uuid'}-${account.username}`}
                  className={`instance-account-option ${accountPickerInstance.preferred_account === account.username ? 'selected' : ''}`}
                  onClick={() => handleSetPreferredAccount(account.username)}
                  disabled={updatingAccount}
                >
                  <div className="instance-account-option-avatar">
                    {skinCache[account.uuid] ? (
                      <SkinHead2D src={skinCache[account.uuid]} size={ACCOUNT_AVATAR_SIZE} />
                    ) : account.is_microsoft ? (
                      <img
                        src={getSkinUrl(account.uuid, account.is_microsoft)}
                        alt=""
                        className="instance-account-avatar-img"
                        onError={(e) => {
                          e.target.src = STEVE_HEAD_DATA;
                          if (account?.uuid) {
                            setFailedImages((prev) => ({ ...prev, [account.uuid]: true }));
                          }
                        }}
                      />
                    ) : (
                      <User size={18} />
                    )}
                  </div>
                  <div className="instance-account-option-body">
                    <div className="instance-account-option-title">
                      {account.username}
                      {activeAccountUsername === account.username && (
                        <span className="instance-account-pill">Active</span>
                      )}
                    </div>
                    <div className="instance-account-option-sub">{account.is_microsoft ? 'Microsoft account' : 'Offline account'}</div>
                  </div>
                  {accountPickerInstance.preferred_account === account.username && (
                    <Check size={16} className="instance-account-option-check" />
                  )}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
      </div>
    </div>
  );
}

export default InstanceList;

