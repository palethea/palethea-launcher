import { useCallback, useMemo, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';

const PAGE_SIZE = 20;
const SEARCH_TIMEOUT_MS = 20000;
const SEARCH_CACHE_TTL_MS = 2 * 60 * 1000;
const SEARCH_CACHE_MAX_ENTRIES = 120;
const searchCache = new Map();
const inFlightSearchRequests = new Map();

function parseTotalHits(results) {
  if (!results) return 0;
  return Number(results.total_hits || 0);
}

function getErrorMessage(error) {
  if (error && typeof error === 'object' && 'message' in error && error.message) {
    return String(error.message);
  }
  return String(error);
}

function projectKey(project, fallbackIndex = 0) {
  const key =
    String(project?.project_id || project?.id || project?.slug || '')
      .trim()
      .toLowerCase();
  if (key) return key;
  const title = String(project?.title || project?.name || '').trim().toLowerCase();
  const author = String(project?.author || '').trim().toLowerCase();
  return `${title}::${author}::${fallbackIndex}`;
}

function dedupeProjects(items) {
  const deduped = [];
  const seen = new Set();
  for (let i = 0; i < (items || []).length; i += 1) {
    const item = items[i];
    const key = projectKey(item, i);
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(item);
  }
  return deduped;
}

function buildSearchCacheKey(params) {
  const normalizedCategories = Array.isArray(params.categories)
    ? [...params.categories].filter(Boolean).sort()
    : null;

  return JSON.stringify({
    provider: params.provider || 'modrinth',
    query: params.query || '',
    projectType: params.projectType || '',
    gameVersion: params.gameVersion || '',
    loader: params.loader || '',
    categories: normalizedCategories,
    limit: Number(params.limit) || PAGE_SIZE,
    offset: Number(params.offset) || 0,
    index: params.index || '',
  });
}

function pruneSearchCache() {
  while (searchCache.size > SEARCH_CACHE_MAX_ENTRIES) {
    const oldestKey = searchCache.keys().next().value;
    if (!oldestKey) break;
    searchCache.delete(oldestKey);
  }
}

function getCachedSearchResult(cacheKey) {
  const entry = searchCache.get(cacheKey);
  if (!entry) return null;

  if (Date.now() - entry.timestamp > SEARCH_CACHE_TTL_MS) {
    searchCache.delete(cacheKey);
    return null;
  }

  return entry.data;
}

function setCachedSearchResult(cacheKey, data) {
  searchCache.set(cacheKey, {
    data,
    timestamp: Date.now(),
  });
  pruneSearchCache();
}

function invokeSearchWithCache(params, provider = 'modrinth') {
  const cacheKey = buildSearchCacheKey(params);
  const cached = getCachedSearchResult(cacheKey);
  if (cached) {
    return Promise.resolve(cached);
  }

  const inFlight = inFlightSearchRequests.get(cacheKey);
  if (inFlight) {
    return inFlight;
  }

  let timeoutId;
  const timeoutPromise = new Promise((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(new Error('Search timed out. Please retry.'));
    }, SEARCH_TIMEOUT_MS);
  });

  const request = Promise.race([
    provider === 'curseforge'
      ? invoke('search_curseforge_projects', {
        query: params.query,
        projectType: params.projectType,
        categories: params.categories,
        limit: params.limit,
        offset: params.offset
      })
      : invoke('search_modrinth', {
        query: params.query,
        projectType: params.projectType,
        gameVersion: params.gameVersion,
        loader: params.loader,
        categories: params.categories,
        limit: params.limit,
        offset: params.offset,
        index: params.index,
      }),
    timeoutPromise,
  ])
    .then((result) => {
      setCachedSearchResult(cacheKey, result);
      return result;
    })
    .finally(() => {
      if (timeoutId) clearTimeout(timeoutId);
      inFlightSearchRequests.delete(cacheKey);
    });

  inFlightSearchRequests.set(cacheKey, request);
  return request;
}

export default function useModrinthSearch({
  provider = 'modrinth',
  projectType,
  gameVersion,
  loader = null,
  categories = [],
  query = '',
  withPopular = false,
  searchEmptyQuery = true,
}) {
  const [searchResults, setSearchResults] = useState([]);
  const [popularItems, setPopularItems] = useState([]);
  const [searching, setSearching] = useState(false);
  const [loadingPopular, setLoadingPopular] = useState(withPopular);
  const [loadingMore, setLoadingMore] = useState(false);
  const [searchError, setSearchError] = useState(null);
  const [searchOffset, setSearchOffset] = useState(0);
  const [popularOffset, setPopularOffset] = useState(0);
  const [hasMoreSearch, setHasMoreSearch] = useState(true);
  const [hasMorePopular, setHasMorePopular] = useState(true);

  const searchEpochRef = useRef(0);
  const loadingMoreRef = useRef(false);
  const hasMoreSearchRef = useRef(true);
  const hasMorePopularRef = useRef(true);

  const categorySignature = useMemo(() => {
    if (!Array.isArray(categories) || categories.length === 0) return '';
    return categories
      .map((value) => String(value || '').trim())
      .filter(Boolean)
      .join('||');
  }, [categories]);

  const stableCategories = useMemo(() => {
    if (!categorySignature) return [];
    return categorySignature.split('||');
  }, [categorySignature]);

  const isSearchMode = query.trim().length > 0 || stableCategories.length > 0 || (!withPopular && searchEmptyQuery);

  const baseParams = useCallback(
    (offset, requestQuery, index, categoryValues = null) => ({
      query: requestQuery,
      projectType,
      gameVersion,
      loader,
      categories:
        Array.isArray(categoryValues) && categoryValues.length > 0
          ? categoryValues
          : (stableCategories.length > 0 ? stableCategories : null),
      limit: PAGE_SIZE,
      offset,
      index,
    }),
    [gameVersion, loader, projectType, stableCategories]
  );

  const handleSearch = useCallback(
    async (newOffset = 0, queryOverride = null, categoriesOverride = null) => {
      const effectiveQuery = typeof queryOverride === 'string' ? queryOverride : query;
      const effectiveCategories =
        Array.isArray(categoriesOverride) ? categoriesOverride : stableCategories;
      const isInitial = newOffset === 0;

      if (
        isInitial &&
        !searchEmptyQuery &&
        effectiveQuery.trim() === '' &&
        effectiveCategories.length === 0
      ) {
        setSearchResults([]);
        setSearchOffset(0);
        setHasMoreSearch(false);
        hasMoreSearchRef.current = false;
        return;
      }

      if (isInitial) {
        searchEpochRef.current += 1;
        setSearching(true);
        setSearchOffset(0);
        setHasMoreSearch(true);
        hasMoreSearchRef.current = true;
        setSearchError(null);
      } else {
        if (loadingMoreRef.current || !hasMoreSearchRef.current) return;
        setLoadingMore(true);
        loadingMoreRef.current = true;
        setSearchError(null);
      }

      const currentEpoch = searchEpochRef.current;

      try {
        const params = baseParams(
          newOffset,
          effectiveQuery,
          effectiveQuery.trim() === '' ? 'downloads' : 'relevance',
          effectiveCategories
        );
        const results = await invokeSearchWithCache({ ...params, provider }, provider);

        if (currentEpoch !== searchEpochRef.current) return;

        const rawHits = Array.isArray(results.hits) ? results.hits : [];
        const hits = dedupeProjects(rawHits);
        const nextOffset = newOffset + rawHits.length;
        const totalHits = parseTotalHits(results);
        let more = provider === 'curseforge'
          ? rawHits.length === PAGE_SIZE
          : (rawHits.length === PAGE_SIZE && nextOffset < totalHits);

        if (isInitial) {
          setSearchResults(hits);
        } else {
          setSearchResults((prev) => {
            const merged = [...prev];
            const seen = new Set(prev.map((item, index) => projectKey(item, index)));
            for (let i = 0; i < hits.length; i += 1) {
              const item = hits[i];
              const key = projectKey(item, i);
              if (seen.has(key)) continue;
              seen.add(key);
              merged.push(item);
            }
            return merged;
          });
        }

        setSearchOffset(nextOffset);
        setHasMoreSearch(more);
        hasMoreSearchRef.current = more;
      } catch (error) {
        if (currentEpoch === searchEpochRef.current && isInitial) {
          setSearchError(getErrorMessage(error));
        } else if (currentEpoch === searchEpochRef.current) {
          setSearchError(getErrorMessage(error));
        }
      } finally {
        if (isInitial) {
          if (currentEpoch === searchEpochRef.current) {
            setSearching(false);
          }
        } else {
          // Always clear load-more state, even if epoch changed while request was in flight.
          setLoadingMore(false);
          loadingMoreRef.current = false;
        }
      }
    },
    [baseParams, provider, query, searchEmptyQuery, stableCategories]
  );

  const loadPopularItems = useCallback(async () => {
    if (!withPopular) return;

    searchEpochRef.current += 1;
    const currentEpoch = searchEpochRef.current;

    setLoadingPopular(true);
    setSearchResults([]);
    setSearchOffset(0);
    setPopularOffset(0);
    setHasMorePopular(true);
    hasMorePopularRef.current = true;
    setSearchError(null);

    try {
      const results = await invokeSearchWithCache({ ...baseParams(0, '', 'downloads'), provider }, provider);

      if (currentEpoch !== searchEpochRef.current) return;

      const rawHits = Array.isArray(results?.hits) ? results.hits : [];
      const hits = dedupeProjects(rawHits);
      const totalHits = parseTotalHits(results);
      const more = provider === 'curseforge'
        ? rawHits.length === PAGE_SIZE
        : (rawHits.length === PAGE_SIZE && totalHits > PAGE_SIZE);

      setPopularItems(hits);
      setPopularOffset(rawHits.length);
      setHasMorePopular(more);
      hasMorePopularRef.current = more;
    } catch (error) {
      if (currentEpoch === searchEpochRef.current) {
        setSearchError(getErrorMessage(error));
        setPopularItems([]);
      }
    } finally {
      if (currentEpoch === searchEpochRef.current) {
        setLoadingPopular(false);
      }
    }
  }, [baseParams, provider, withPopular]);

  const loadMoreSearch = useCallback(async () => {
    if (loadingMoreRef.current || !hasMoreSearchRef.current) return;
    await handleSearch(searchOffset);
  }, [handleSearch, searchOffset]);

  const loadMorePopular = useCallback(async () => {
    if (!withPopular || loadingMoreRef.current || !hasMorePopularRef.current) return;

    setLoadingMore(true);
    loadingMoreRef.current = true;
    const currentEpoch = searchEpochRef.current;

    try {
      const results = await invokeSearchWithCache({ ...baseParams(popularOffset, '', 'downloads'), provider }, provider);

      if (currentEpoch !== searchEpochRef.current) return;

      const rawHits = Array.isArray(results?.hits) ? results.hits : [];
      const hits = dedupeProjects(rawHits);
      const nextOffset = popularOffset + rawHits.length;
      const totalHits = parseTotalHits(results);
      let more = provider === 'curseforge'
        ? rawHits.length === PAGE_SIZE
        : (rawHits.length === PAGE_SIZE && nextOffset < totalHits);

      if (hits.length > 0) {
        setPopularItems((prev) => {
          const merged = [...prev];
          const seen = new Set(prev.map((item, index) => projectKey(item, index)));
          for (let i = 0; i < hits.length; i += 1) {
            const item = hits[i];
            const key = projectKey(item, i);
            if (seen.has(key)) continue;
            seen.add(key);
            merged.push(item);
          }
          return merged;
        });
      }
      setPopularOffset(nextOffset);
      setHasMorePopular(more);
      hasMorePopularRef.current = more;
    } catch (error) {
      if (currentEpoch === searchEpochRef.current) {
        setSearchError(getErrorMessage(error));
      }
    } finally {
      // Always clear load-more state, even if epoch changed while request was in flight.
      setLoadingMore(false);
      loadingMoreRef.current = false;
    }
  }, [baseParams, popularOffset, provider, withPopular]);

  const loadMore = useCallback(async () => {
    if (loadingMoreRef.current || searching || loadingPopular) return;
    if (withPopular && !isSearchMode) {
      if (!hasMorePopularRef.current) return;
      await loadMorePopular();
      return;
    }
    if (!hasMoreSearchRef.current) return;
    await loadMoreSearch();
  }, [isSearchMode, loadMorePopular, loadMoreSearch, loadingPopular, searching, withPopular]);

  const canLoadMore = withPopular
    ? (isSearchMode ? hasMoreSearch : hasMorePopular)
    : hasMoreSearch;

  const resetFeed = useCallback(() => {
    searchEpochRef.current += 1;
    setSearchResults([]);
    setPopularItems([]);
    setSearchOffset(0);
    setPopularOffset(0);
    setHasMoreSearch(true);
    setHasMorePopular(true);
    setSearching(false);
    setLoadingPopular(withPopular);
    setLoadingMore(false);
    setSearchError(null);
    loadingMoreRef.current = false;
    hasMoreSearchRef.current = true;
    hasMorePopularRef.current = true;
  }, [withPopular]);

  return {
    searchResults,
    popularItems,
    searching,
    loadingPopular,
    loadingMore,
    canLoadMore,
    searchError,
    handleSearch,
    loadPopularItems,
    loadMore,
    resetFeed,
    setSearchResults,
    setPopularItems,
    setSearchError,
  };
}

