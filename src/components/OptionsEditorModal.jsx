import { useState, useEffect, useMemo, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { Save, X, Loader2, Keyboard, Volume2, User, Settings as SettingsIcon, ChevronRight, ExternalLink } from 'lucide-react';
import './OptionsEditorModal.css';

// ----------
// Options Editor Modal
// Description: A categorized and structured editor for the Minecraft options.txt file, providing a user-friendly interface for configuration.
// ----------
function OptionsEditorModal({ instanceId, onClose, onShowNotification }) {
    const [rawOptions, setRawOptions] = useState([]);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [activeCategory, setActiveCategory] = useState('general');
    const scrollContainerRef = useRef(null);

    useEffect(() => {
        const loadOptions = async () => {
            try {
                const data = await invoke('get_instance_options', { instanceId });
                const lines = data.split('\n').filter(line => line.trim().length > 0);
                const parsed = lines.map(line => {
                    const colonIndex = line.indexOf(':');
                    if (colonIndex === -1) return { key: line, value: '', original: line };
                    return {
                        key: line.substring(0, colonIndex).trim(),
                        value: line.substring(colonIndex + 1).trim(),
                        original: line
                    };
                });
                setRawOptions(parsed);
            } catch (error) {
                console.error('Failed to load options:', error);
                if (onShowNotification) onShowNotification('Failed to load options.txt', 'error');
            }
            setLoading(false);
        };
        loadOptions();
    }, [instanceId, onShowNotification]);

    // Reset scroll when category changes
    useEffect(() => {
        if (scrollContainerRef.current) {
            scrollContainerRef.current.scrollTop = 0;
        }
    }, [activeCategory]);

    const categories = useMemo(() => {
        const cats = {
            general: [],
            keys: [],
            sounds: [],
            skinParts: []
        };

        rawOptions.forEach(opt => {
            if (opt.key.startsWith('key_')) {
                cats.keys.push(opt);
            } else if (opt.key.startsWith('soundCategory_')) {
                cats.sounds.push(opt);
            } else if (opt.key.startsWith('modelPart_')) {
                cats.skinParts.push(opt);
            } else {
                cats.general.push(opt);
            }
        });

        return cats;
    }, [rawOptions]);

    const handleUpdateOption = (key, newValue) => {
        setRawOptions(prev => prev.map(opt =>
            opt.key === key ? { ...opt, value: newValue } : opt
        ));
    };

    // ----------
    // handleSave
    // Description: Serializes the current options state back into the options.txt format and saves it to disk via the backend.
    // ----------
    const handleSave = async () => {
        setSaving(true);
        try {
            const content = rawOptions.map(opt => `${opt.key}:${opt.value}`).join('\n');
            await invoke('save_instance_options', { instanceId, content });
            if (onShowNotification) onShowNotification('options.txt saved successfully', 'success');
            onClose();
        } catch (error) {
            console.error('Failed to save options:', error);
            if (onShowNotification) onShowNotification('Failed to save options.txt', 'error');
        }
        setSaving(false);
    };

    // ----------
    // handleOpenInSystemEditor
    // Description: Invokes a backend command to open the instance's options.txt file using the system's default text editor.
    // ----------
    const handleOpenInSystemEditor = async () => {
        try {
            await invoke('open_instance_options_file', { instanceId });
        } catch (error) {
            console.error('Failed to open options file:', error);
            if (onShowNotification) onShowNotification(error, 'error');
        }
    };

    // ----------
    // renderOptionInput
    // Description: Renders the appropriate input control based on the option's key and current value (toggle, range, or text).
    // ----------
    const renderOptionInput = (opt) => {
        // Boolean check
        if (opt.value === 'true' || opt.value === 'false') {
            return (
                <label className="option-toggle">
                    <input
                        type="checkbox"
                        checked={opt.value === 'true'}
                        onChange={(e) => handleUpdateOption(opt.key, e.target.checked ? 'true' : 'false')}
                    />
                    <span className="toggle-slider"></span>
                </label>
            );
        }

        // Number/Range check (excluding gamma)
        if (opt.key.startsWith('soundCategory_') || opt.key === 'fov' || opt.key === 'sensitivity') {
            const val = parseFloat(opt.value);
            if (!isNaN(val)) {
                return (
                    <div className="option-range-wrapper">
                        <input
                            type="range"
                            min="0"
                            max={opt.key === 'fov' ? "110" : "1"}
                            step={opt.key === 'fov' ? "1" : "0.01"}
                            value={val}
                            onChange={(e) => handleUpdateOption(opt.key, e.target.value)}
                        />
                        <span className="range-value">
                            {opt.key === 'fov' ? Math.round(val) : `${Math.round(val * 100)}%`}
                        </span>
                    </div>
                );
            }
        }

        return (
            <input
                type="text"
                className="option-text-input"
                value={opt.value}
                onChange={(e) => handleUpdateOption(opt.key, e.target.value)}
            />
        );
    };

    const formatKeyLabel = (key) => {
        return key
            .replace('key_', '')
            .replace('soundCategory_', '')
            .replace('modelPart_', '')
            .replace(/_/g, ' ')
            .replace(/\./g, ' ')
            .split(' ')
            .map(word => word.charAt(0).toUpperCase() + word.slice(1))
            .join(' ');
    };

    const categoryIcons = {
        general: <SettingsIcon size={18} />,
        keys: <Keyboard size={18} />,
        sounds: <Volume2 size={18} />,
        skinParts: <User size={18} />
    };

    const categoryLabels = {
        general: 'General',
        keys: 'Keys',
        sounds: 'Sounds',
        skinParts: 'Skin Parts'
    };

    return (
        <div className="options-modal-overlay" onClick={onClose}>
            <div className="options-modal categorized" onClick={(e) => e.stopPropagation()}>
                <div className="options-modal-header">
                    <div className="header-info">
                        <h3>Options Editor</h3>
                        <span>Configure instance settings</span>
                    </div>
                    <button className="close-btn" onClick={onClose}>
                        <X size={20} />
                    </button>
                </div>

                <div className="options-modal-main">
                    <div className="options-sidebar">
                        {Object.keys(categoryLabels).map(catId => (
                            <button
                                key={catId}
                                className={`sidebar-item ${activeCategory === catId ? 'active' : ''}`}
                                onClick={() => setActiveCategory(catId)}
                            >
                                {categoryIcons[catId]}
                                <span>{categoryLabels[catId]}</span>
                                {activeCategory === catId && <ChevronRight size={14} className="active-indicator" />}
                            </button>
                        ))}
                    </div>

                    <div className="options-content" ref={scrollContainerRef}>
                        {loading ? (
                            <div className="loading-state">
                                <Loader2 className="spin" />
                                <p>Parsing configuration...</p>
                            </div>
                        ) : (
                            <div className="options-list">
                                {categories[activeCategory].map(opt => (
                                    <div key={opt.key} className="option-entry">
                                        <div className="option-label-group">
                                            <span className="option-label">{formatKeyLabel(opt.key)}</span>
                                            <span className="option-key-raw">{opt.key}</span>
                                        </div>
                                        <div className="option-control">
                                            {renderOptionInput(opt)}
                                        </div>
                                    </div>
                                ))}
                                {categories[activeCategory].length === 0 && (
                                    <div className="empty-category">
                                        <p>No options found in this category.</p>
                                    </div>
                                )}
                            </div>
                        )}
                    </div>
                </div>

                <div className="options-modal-footer">
                    <div className="footer-left">
                        <button className="cancel-btn" onClick={onClose}>Cancel</button>
                        <button className="open-editor-btn" onClick={handleOpenInSystemEditor}>
                            <ExternalLink size={16} />
                            <span>Open in System Editor</span>
                        </button>
                    </div>
                    <button className="save-btn" onClick={handleSave} disabled={loading || saving}>
                        {saving ? <Loader2 className="spin" size={18} /> : <Save size={18} />}
                        <span>{saving ? 'Saving...' : 'Save Settings'}</span>
                    </button>
                </div>
            </div>
        </div>
    );
}

export default OptionsEditorModal;
