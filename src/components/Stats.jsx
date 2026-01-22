import { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { BarChart3, Clock, Play, Box, Star, Calendar } from 'lucide-react';
import './Stats.css';

const Stats = () => {
    const [stats, setStats] = useState(() => {
        const cached = sessionStorage.getItem('cached_stats');
        return cached ? JSON.parse(cached) : null;
    });
    const [loading, setLoading] = useState(!sessionStorage.getItem('cached_stats'));

    useEffect(() => {
        const fetchStats = async () => {
            // Throttle: only fetch if 30s have passed since last fetch
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

    const formatPlaytime = (seconds) => {
        if (!seconds) return '0m';
        const hours = Math.floor(seconds / 3600);
        const minutes = Math.floor((seconds % 3600) / 60);
        
        if (hours > 0) {
            return `${hours}h ${minutes}m`;
        }
        return `${minutes}m`;
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

    const statItems = [
        {
            label: 'Total Playtime',
            value: formatPlaytime(stats.total_playtime_seconds),
            icon: Clock,
            color: '#3b82f6',
            size: 'large'
        },
        {
            label: 'Total Launches',
            value: stats.total_launches.toLocaleString(),
            icon: Play,
            color: '#10b981',
            size: 'large'
        },
        {
            label: 'Instances',
            value: stats.instance_count,
            icon: Box,
            color: '#8b5cf6',
            size: 'small'
        },
        {
            label: 'Most Played',
            value: stats.most_played_instance || 'None yet',
            icon: Star,
            color: '#f59e0b',
            size: 'small'
        },
        {
            label: 'Fav Version',
            value: stats.favorite_version || 'None yet',
            icon: Calendar,
            color: '#ec4899',
            size: 'small'
        }
    ];

    const largeStats = statItems.filter(i => i.size === 'large');
    const smallStats = statItems.filter(i => i.size === 'small');

    return (
        <div className="stats-container">
            <header className="stats-header">
                <h1>Global Statistics</h1>
                <p>Your Palethea journey at a glance</p>
            </header>

            <div className="stats-sections">
                <section className="stats-overview">
                    {largeStats.map((item, index) => (
                        <div key={index} className="stat-card large">
                            <div className="stat-icon">
                                <item.icon size={32} />
                            </div>
                            <div className="stat-info">
                                <span className="stat-label">{item.label}</span>
                                <span className="stat-value">{item.value}</span>
                            </div>
                        </div>
                    ))}
                </section>

                <section className="stats-details-grid">
                    {smallStats.map((item, index) => (
                        <div key={index} className="stat-card small">
                            <div className="stat-icon">
                                <item.icon size={20} />
                            </div>
                            <div className="stat-info">
                                <span className="stat-label">{item.label}</span>
                                <span className="stat-value">{item.value}</span>
                            </div>
                        </div>
                    ))}
                </section>
            </div>

            <div className="stats-footer-info">
                <BarChart3 size={16} />
                <span>Statistics are updated every time you close a game session or launch a new one.</span>
            </div>
        </div>
    );
};

export default Stats;
