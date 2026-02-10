import { useCallback, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';

const PAGE_SIZE = 20;

function parseTotalHits(results) {
  if (!results) return 0;
  return Number(results.total_hits || 0);
}

export default function useModrinthSearch({
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

  const observerRef = useRef(null);
  const searchEpochRef = useRef(0);
  const loadingMoreRef = useRef(false);
  const hasMoreSearchRef = useRef(true);
  const hasMorePopularRef = useRef(true);

  const isSearchMode = query.trim().length > 0 || categories.length > 0;

  const baseParams = useCallback(
    (offset, requestQuery, index) => ({
      query: requestQuery,
      projectType,
      gameVersion,
      loader,
      categories: categories.length > 0 ? categories : null,
      limit: PAGE_SIZE,
      offset,
      index,
    }),
    [projectType, gameVersion, loader, categories]
  );

  const handleSearch = useCallback(
    async (newOffset = 0) => {
      const isInitial = newOffset === 0;

      if (
        isInitial &&
        !searchEmptyQuery &&
        query.trim() === '' &&
        categories.length === 0
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
      }

      const currentEpoch = searchEpochRef.current;

      try {
        const results = await invoke(
          'search_modrinth',
          baseParams(
            newOffset,
            query,
            query.trim() === '' ? 'downloads' : 'relevance'
          )
        );

        if (currentEpoch !== searchEpochRef.current) return;

        const hits = results.hits || [];
        const nextOffset = newOffset + hits.length;
        const totalHits = parseTotalHits(results);
        const more = hits.length === PAGE_SIZE && nextOffset < totalHits;

        if (isInitial) {
          setSearchResults(hits);
        } else {
          setSearchResults((prev) => [...prev, ...hits]);
        }

        setSearchOffset(nextOffset);
        setHasMoreSearch(more);
        hasMoreSearchRef.current = more;
      } catch (error) {
        if (currentEpoch === searchEpochRef.current && isInitial) {
          setSearchError(error.toString());
        }
      } finally {
        if (currentEpoch === searchEpochRef.current) {
          if (isInitial) {
            setSearching(false);
          } else {
            setLoadingMore(false);
            loadingMoreRef.current = false;
          }
        }
      }
    },
    [baseParams, categories.length, query, searchEmptyQuery]
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
      const results = await invoke(
        'search_modrinth',
        baseParams(0, '', 'downloads')
      );

      if (currentEpoch !== searchEpochRef.current) return;

      const hits = results?.hits || [];
      const totalHits = parseTotalHits(results);
      const more = hits.length === PAGE_SIZE && totalHits > PAGE_SIZE;

      setPopularItems(hits);
      setPopularOffset(hits.length);
      setHasMorePopular(more);
      hasMorePopularRef.current = more;
    } catch (error) {
      if (currentEpoch === searchEpochRef.current) {
        setSearchError(error.toString());
        setPopularItems([]);
      }
    } finally {
      if (currentEpoch === searchEpochRef.current) {
        setLoadingPopular(false);
      }
    }
  }, [baseParams, withPopular]);

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
      const results = await invoke(
        'search_modrinth',
        baseParams(popularOffset, '', 'downloads')
      );

      if (currentEpoch !== searchEpochRef.current) return;

      const hits = results?.hits || [];
      const nextOffset = popularOffset + hits.length;
      const totalHits = parseTotalHits(results);
      const more = hits.length === PAGE_SIZE && nextOffset < totalHits;

      if (hits.length > 0) {
        setPopularItems((prev) => [...prev, ...hits]);
        setPopularOffset(nextOffset);
      }
      setHasMorePopular(more);
      hasMorePopularRef.current = more;
    } finally {
      if (currentEpoch === searchEpochRef.current) {
        setLoadingMore(false);
        loadingMoreRef.current = false;
      }
    }
  }, [baseParams, popularOffset, withPopular]);

  const lastElementRef = useCallback(
    (node) => {
      if (loadingMoreRef.current || searching || loadingPopular) return;
      if (observerRef.current) observerRef.current.disconnect();

      observerRef.current = new IntersectionObserver((entries) => {
        if (!entries[0].isIntersecting) return;

        if (isSearchMode && hasMoreSearchRef.current && !loadingMoreRef.current) {
          loadMoreSearch();
          return;
        }

        if (
          withPopular &&
          !isSearchMode &&
          hasMorePopularRef.current &&
          !loadingMoreRef.current
        ) {
          loadMorePopular();
        }
      });

      if (node) observerRef.current.observe(node);
    },
    [
      isSearchMode,
      loadMorePopular,
      loadMoreSearch,
      loadingPopular,
      searching,
      withPopular,
    ]
  );

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
    searchError,
    handleSearch,
    loadPopularItems,
    lastElementRef,
    resetFeed,
    setSearchResults,
    setPopularItems,
    setSearchError,
  };
}

