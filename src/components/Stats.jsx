import { useState, useEffect } from 'react';
import { invoke, convertFileSrc } from '@tauri-apps/api/core';
import { sep } from '@tauri-apps/api/path';
import { BarChart3, Clock, Rocket, Box, Trophy, Star, Calendar, Gamepad2, TrendingUp } from 'lucide-react';
import './Stats.css';

const Stats = () => {
    const [stats, setStats] = useState(() => {
        const cached = sessionStorage.getItem('cached_stats');
        return cached ? JSON.parse(cached) : null;
    });
    const [loading, setLoading] = useState(!sessionStorage.getItem('cached_stats'));
    const [logoMap, setLogoMap] = useState({});
    const [activityView, setActivityView] = useState('week');

    useEffect(() => {
        const fetchStats = async () => {
            const lastFetch = sessionStorage.getItem('last_stats_fetch');
            const now = Date.now();
            if (lastFetch && now - parseInt(lastFetch) < 30000 && stats) {
                setLoading(false);
                return;
            }

            try {
                const data = await invoke('get_global_stats');
                setStats(data);
                sessionStorage.setItem('cached_stats', JSON.stringify(data));
                sessionStorage.setItem('last_stats_fetch', now.toString());
            } catch (error) {
                console.error('Failed to fetch global stats:', error);
            } finally {
                setLoading(false);
            }
        };

        fetchStats();
    }, []);

    // Load logos for top instances
    useEffect(() => {
        if (!stats?.top_instances?.length) return;
        let cancelled = false;

        const loadLogos = async () => {
            try {
                const baseDir = await invoke('get_data_directory');
                const s = await sep();
                const logosDir = `${baseDir}${s}instance_logos`;

                const entries = stats.top_instances.map((inst) => {
                    const filename = inst.logo_filename || 'minecraft_logo.png';
                    const logoPath = `${logosDir}${s}${filename}`;
                    return [inst.name, convertFileSrc(logoPath)];
                });

                if (!cancelled) {
                    setLogoMap(Object.fromEntries(entries));
                }
            } catch (error) {
                console.error('Failed to load instance logos:', error);
            }
        };

        loadLogos();
        return () => { cancelled = true; };
    }, [stats?.top_instances]);

    const formatPlaytime = (seconds) => {
        if (!seconds) return '0m';
        const hours = Math.floor(seconds / 3600);
        const minutes = Math.floor((seconds % 3600) / 60);
        if (hours > 0) return `${hours}h ${minutes}m`;
        return `${minutes}m`;
    };

    const formatHours = (seconds) => {
        if (!seconds) return '0h';
        const hours = (seconds / 3600).toFixed(1);
        return `${hours}h`;
    };

    const formatRelativeDate = (unixStr) => {
        if (!unixStr) return 'Never';
        const timestamp = parseInt(unixStr) * 1000;
        const now = Date.now();
        const diffMs = now - timestamp;
        const diffMins = Math.floor(diffMs / 60000);
        const diffHours = Math.floor(diffMs / 3600000);
        const diffDays = Math.floor(diffMs / 86400000);

        if (diffMins < 1) return 'Just now';
        if (diffMins < 60) return `${diffMins}m ago`;
        if (diffHours < 24) return `${diffHours}h ago`;
        if (diffDays === 1) return 'Yesterday';
        if (diffDays < 30) return `${diffDays}d ago`;
        if (diffDays < 365) return `${Math.floor(diffDays / 30)}mo ago`;
        return `${Math.floor(diffDays / 365)}y ago`;
    };

    const getDayLabel = (dateStr) => {
        const date = new Date(dateStr + 'T00:00:00');
        return date.toLocaleDateString('en-US', { weekday: 'short' });
    };

    const getDateLabel = (dateStr) => {
        const date = new Date(dateStr + 'T00:00:00');
        return date.getDate().toString();
    };

    const getAvgSession = () => {
        if (!stats || !stats.total_launches || !stats.total_playtime_seconds) return null;
        const avg = Math.floor(stats.total_playtime_seconds / stats.total_launches);
        return formatPlaytime(avg);
    };

    const getModLoaderLabel = (loader) => {
        if (!loader || loader === 'Vanilla') return null;
        return loader;
    };

    if (loading) {
        return (
            <div className="stats-container loading">
                <div className="loader"></div>
                <p>Calculating statistics...</p>
            </div>
        );
    }

    if (!stats) {
        return (
            <div className="stats-container error">
                <p>Failed to load statistics.</p>
            </div>
        );
    }

    const avgSession = getAvgSession();
    const activityData = activityView === 'week' ? stats.daily_activity_week : stats.daily_activity_month;
    const maxActivity = Math.max(...(activityData || []).map(d => d.seconds), 1);
    const maxTopPlaytime = stats.top_instances?.length ? stats.top_instances[0].playtime_seconds : 1;

    return (
        <div className="stats-container">
            <header className="stats-header page-header">
                <p className="page-subtitle">Your gameplay statistics across all instances.</p>
            </header>

            <div className="stats-sections">
                {/* Hero Stats */}
                <section className="stats-overview">
                    <div className="stat-card large">
                        <div className="stat-icon">
                            <Clock size={32} />
                        </div>
                        <div className="stat-info">
                            <span className="stat-label">Total Playtime</span>
                            <span className="stat-value">{formatPlaytime(stats.total_playtime_seconds)}</span>
                            <span className="stat-description">Across all instances</span>
                        </div>
                    </div>
                    <div className="stat-card large">
                        <div className="stat-icon">
                            <Rocket size={32} />
                        </div>
                        <div className="stat-info">
                            <span className="stat-label">Total Launches</span>
                            <span className="stat-value">{stats.total_launches.toLocaleString()}</span>
                            <span className="stat-description">
                                {avgSession ? `Avg. ${avgSession} per session` : 'No sessions yet'}
                            </span>
                        </div>
                    </div>
                </section>

                {/* Activity Graph */}
                <section className="stats-activity">
                    <div className="stats-activity-header">
                        <h3 className="stats-section-title">
                            <TrendingUp size={18} />
                            Activity
                            <div className="activity-toggle">
                                <button
                                    className={`activity-toggle-btn ${activityView === 'week' ? 'active' : ''}`}
                                    onClick={() => setActivityView('week')}>
                                    Week
                                </button>
                                <button
                                    className={`activity-toggle-btn ${activityView === 'month' ? 'active' : ''}`} 
                                    onClick={() => setActivityView('month')}>
                                    Month
                                </button>
                            </div>
                        </h3>
                        
                    </div>
                    <div className="activity-chart-card">
                        <div className="activity-chart">
                            {activityData?.map((day, i) => (
                                <div key={i} className="activity-bar-wrapper" title={`${formatPlaytime(day.seconds)} on ${day.date}`}>
                                    <div className="activity-bar-track">
                                        <div
                                            className="activity-bar-fill"
                                            style={{ height: `${Math.max(day.seconds > 0 ? 8 : 0, (day.seconds / maxActivity) * 100)}%` }}
                                        />
                                    </div>
                                    <span className="activity-bar-label">
                                        {activityView === 'week' ? getDayLabel(day.date) : getDateLabel(day.date)}
                                    </span>
                                </div>
                            ))}
                        </div>
                        {(!activityData || activityData.every(d => d.seconds === 0)) && (
                            <div className="activity-empty">No activity recorded yet</div>
                        )}
                    </div>
                </section>

                {/* Most Played Instances */}
                {stats.top_instances?.length > 0 && (
                    <section className="stats-top-played">
                        <h3 className="stats-section-title">
                            <Trophy size={18} />
                            Most Played
                        </h3>
                        <div className="top-played-list">
                            {stats.top_instances.map((inst, index) => (
                                <div key={index} className="top-played-item">
                                    <span className="top-played-rank">#{index + 1}</span>
                                    <div className="top-played-logo">
                                        <img
                                            src={logoMap[inst.name]}
                                            alt=""
                                            onError={(e) => {
                                                if (!e.target.src.endsWith('/minecraft_logo.png')) {
                                                    e.target.src = '/minecraft_logo.png';
                                                }
                                            }}
                                        />
                                    </div>
                                    <div className="top-played-info">
                                        <div className="top-played-name-row">
                                            <span className="top-played-name">{inst.name}</span>
                                            <span className="top-played-version">{inst.version_id}</span>
                                            {getModLoaderLabel(inst.mod_loader) && (
                                                <span className={`top-played-loader loader-${inst.mod_loader.toLowerCase()}`}>
                                                    {getModLoaderLabel(inst.mod_loader)}
                                                </span>
                                            )}
                                        </div>
                                        <div className="top-played-bar-row">
                                            <div className="top-played-bar-track">
                                                <div
                                                    className="top-played-bar-fill"
                                                    style={{ width: `${(inst.playtime_seconds / maxTopPlaytime) * 100}%` }}
                                                />
                                            </div>
                                            <span className="top-played-hours">{formatHours(inst.playtime_seconds)}</span>
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </section>
                )}

                {/* Detail Cards */}
                <section className="stats-details-grid">
                    <div className="stat-card small">
                        <div className="stat-icon">
                            <Box size={20} />
                        </div>
                        <div className="stat-info">
                            <span className="stat-label">Instances</span>
                            <span className="stat-value">{stats.instance_count}</span>
                            <span className="stat-description">{stats.instance_count === 1 ? '1 installed' : `${stats.instance_count} installed`}</span>
                        </div>
                    </div>
                    <div className="stat-card small">
                        <div className="stat-icon">
                            <Star size={20} />
                        </div>
                        <div className="stat-info">
                            <span className="stat-label">Favorite Version</span>
                            <span className="stat-value">{stats.favorite_version || 'None yet'}</span>
                            <span className="stat-description">
                                {stats.favorite_version_count ? `Used by ${stats.favorite_version_count} instance${stats.favorite_version_count === 1 ? '' : 's'}` : 'No instances yet'}
                            </span>
                        </div>
                    </div>
                    <div className="stat-card small">
                        <div className="stat-icon">
                            <Calendar size={20} />
                        </div>
                        <div className="stat-info">
                            <span className="stat-label">Last Played</span>
                            <span className="stat-value">{formatRelativeDate(stats.last_played_date)}</span>
                            <span className="stat-description">{stats.last_played_instance || 'No sessions yet'}</span>
                        </div>
                    </div>
                </section>

                {/* Recent Activity */}
                {stats.recent_instances?.length > 0 && (
                    <section className="stats-recent">
                        <h3 className="stats-section-title">
                            <Gamepad2 size={18} />
                            Recent Sessions
                        </h3>
                        <div className="recent-list">
                            {stats.recent_instances.map((inst, index) => (
                                <div key={index} className="recent-item">
                                    <div className="recent-item-info">
                                        <span className="recent-item-name">{inst.name}</span>
                                        <span className="recent-item-version">{inst.version_id}</span>
                                    </div>
                                    <div className="recent-item-meta">
                                        <span className="recent-item-playtime">
                                            <Clock size={13} />
                                            {formatPlaytime(inst.playtime_seconds)}
                                        </span>
                                        <span className="recent-item-date">{formatRelativeDate(inst.last_played)}</span>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </section>
                )}
            </div>

            <div className="stats-footer-info">
                <BarChart3 size={16} />
                <span>Statistics are updated every time you close a game session or launch a new one.</span>
            </div>
        </div>
    );
};

export default Stats;
