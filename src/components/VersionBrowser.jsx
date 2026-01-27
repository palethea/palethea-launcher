import { useState, useEffect, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';
import './VersionBrowser.css';

function VersionBrowser() {
  const [versions, setVersions] = useState([]);
  const [filter, setFilter] = useState('release');
  const [searchQuery, setSearchQuery] = useState('');
  const [loading, setLoading] = useState(true);

  const loadVersions = useCallback(async () => {
    try {
      const result = await invoke('get_versions');
      setVersions(result);
    } catch (error) {
      console.error('Failed to load versions:', error);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    loadVersions();
  }, [loadVersions]);

  const filteredVersions = versions.filter((version) => {
    const matchesFilter = filter === 'all' || version.version_type === filter;
    const matchesSearch = version.id.toLowerCase().includes(searchQuery.toLowerCase());
    return matchesFilter && matchesSearch;
  });

  const formatDate = (dateString) => {
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  };

  const getTypeColor = (type) => {
    switch (type) {
      case 'release':
        return 'type-release';
      case 'snapshot':
        return 'type-snapshot';
      case 'old_beta':
        return 'type-beta';
      case 'old_alpha':
        return 'type-alpha';
      default:
        return '';
    }
  };

  return (
    <div className="version-browser">
      <div className="version-header">
        <h1>Version Browser</h1>
        <p className="subtitle">Browse all available Minecraft versions</p>
      </div>

      <div className="version-filters">
        <div className="search-box">
          <input
            type="text"
            placeholder="Search versions..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>
        <div className="filter-buttons">
          {['release', 'snapshot', 'old_beta', 'old_alpha', 'all'].map((type) => (
            <button
              key={type}
              className={`filter-btn ${filter === type ? 'active' : ''}`}
              onClick={() => setFilter(type)}
            >
              {type === 'old_beta' ? 'Beta' : type === 'old_alpha' ? 'Alpha' : type.charAt(0).toUpperCase() + type.slice(1)}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="loading-state">
          <div className="loading-spinner"></div>
          <p>Loading versions...</p>
        </div>
      ) : (
        <div className="version-list">
          {filteredVersions.slice(0, 100).map((version) => (
            <div key={version.id} className="version-item">
              <div className="version-info">
                <span className="version-id">{version.id}</span>
                <span className={`version-type ${getTypeColor(version.version_type)}`}>
                  {version.version_type}
                </span>
              </div>
              <span className="version-date">{formatDate(version.release_time)}</span>
            </div>
          ))}
          {filteredVersions.length > 100 && (
            <div className="more-versions">
              And {filteredVersions.length - 100} more versions...
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default VersionBrowser;
