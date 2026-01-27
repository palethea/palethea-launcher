import { useState, useEffect, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { ChevronDown, Check } from 'lucide-react';
import CustomColorPicker from './CustomColorPicker';
import './Settings.css'; // Reuse settings styles for consistency

function Appearance({ launcherSettings, onSettingsUpdated }) {
  const [showColorPicker, setShowColorPicker] = useState(false);
  const colorPickerRef = useRef(null);
  
  const [showBgDropdown, setShowBgDropdown] = useState(false);
  const bgDropdownRef = useRef(null);

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (colorPickerRef.current && !colorPickerRef.current.contains(event.target)) {
        setShowColorPicker(false);
      }
      if (bgDropdownRef.current && !bgDropdownRef.current.contains(event.target)) {
        setShowBgDropdown(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, []);

  return (
    <div className="settings">
      <div className="settings-header">
        <h1>Appearance</h1>
        <p>Customise how Palethea Launcher looks and feels.</p>
      </div>

      <div className="settings-content">
        <section className="settings-section">
          <h2>Themes & Colors</h2>
          
          <div className="setting-item">
            <label>Accent Color</label>
            <div className="color-input-container">
              <div 
                className="color-picker-trigger-wrapper" 
                ref={colorPickerRef}
              >
                <button 
                  className="color-picker-swatch"
                  style={{ backgroundColor: launcherSettings?.accent_color || '#E89C88' }}
                  onClick={() => setShowColorPicker(!showColorPicker)}
                />
                
                {showColorPicker && (
                  <div className="color-picker-popover">
                    <CustomColorPicker
                      value={launcherSettings?.accent_color || '#E89C88'}
                      onChange={async (color) => {
                        const updated = {
                          ...launcherSettings,
                          accent_color: color
                        };
                        await invoke('save_settings', { newSettings: updated });
                        onSettingsUpdated();
                      }}
                    />
                  </div>
                )}
              </div>
              <p className="setting-hint" style={{ margin: 0 }}>
                Choose a custom color for the launcher's highlights and buttons.
              </p>
            </div>
            <div className="color-presets" style={{ marginTop: '12px' }}>
              {[
                { name: 'Palethea', color: '#E89C88' },
                { name: 'Azure', color: '#88aae8' },
                { name: 'Emerald', color: '#88e8a1' },
                { name: 'Amethyst', color: '#e888e0' },
                { name: 'Amber', color: '#e8d488' },
                { name: 'Rose', color: '#fb7185' },
                { name: 'Lavender', color: '#a78bfa' },
                { name: 'Cyan', color: '#22d3ee' },
              ].map((preset) => (
                <button
                  key={preset.color}
                  className={`preset-btn ${launcherSettings?.accent_color === preset.color ? 'active' : ''}`}
                  style={{ backgroundColor: preset.color }}
                  title={preset.name}
                  onClick={async () => {
                    const updated = {
                      ...launcherSettings,
                      accent_color: preset.color
                    };
                    await invoke('save_settings', { newSettings: updated });
                    onSettingsUpdated();
                  }}
                />
              ))}
            </div>
          </div>

          <div className="setting-item">
            <div className="checkbox-row">
              <label>Background Style</label>
              <div className="p-dropdown" ref={bgDropdownRef}>
                <button 
                  className={`p-dropdown-trigger ${showBgDropdown ? 'active' : ''}`}
                  onClick={() => setShowBgDropdown(!showBgDropdown)}
                  style={{ minWidth: '160px' }}
                >
                  <span>
                    {launcherSettings?.background_style === 'dynamic' ? 'Animated Aura' : 'Static Gradient'}
                  </span>
                  <ChevronDown size={14} className={`trigger-icon ${showBgDropdown ? 'flip' : ''}`} />
                </button>

                {showBgDropdown && (
                  <div className="p-dropdown-menu">
                    {[
                      { id: 'gradient', label: 'Static Gradient' },
                      { id: 'dynamic', label: 'Animated Aura' }
                    ].map((opt) => (
                      <div 
                        key={opt.id}
                        className={`p-dropdown-item ${launcherSettings?.background_style === opt.id ? 'selected' : ''}`}
                        onClick={async () => {
                          const updated = {
                            ...launcherSettings,
                            background_style: opt.id
                          };
                          await invoke('save_settings', { newSettings: updated });
                          onSettingsUpdated();
                          setShowBgDropdown(false);
                        }}
                      >
                        <span>{opt.label}</span>
                        {launcherSettings?.background_style === opt.id && <Check size={14} className="selected-icon" />}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
            <p className="setting-hint">
              Choose between a subtle static gradient or an animated atmospheric aura.
            </p>
          </div>
        </section>

        <section className="settings-section">
          <h2>Interface Layout</h2>

          <div className="setting-item">
            <div className="checkbox-row">
              <label>Enable Console Button</label>
              <input
                type="checkbox"
                className="ios-switch"
                checked={launcherSettings?.enable_console || false}
                onChange={async (e) => {
                  const updated = {
                    ...launcherSettings,
                    enable_console: e.target.checked
                  };
                  await invoke('save_settings', { newSettings: updated });
                  onSettingsUpdated();
                }}
              />
            </div>
            <p className="setting-hint">
              Show a dedicated console button in the title bar for debugging and logs.
            </p>
          </div>

          <div className="setting-item">
            <div className="checkbox-row">
              <label>Animated Instance Borders</label>
              <input
                type="checkbox"
                className="ios-switch"
                checked={launcherSettings?.enable_instance_animations !== false}
                onChange={async (e) => {
                  const updated = {
                    ...launcherSettings,
                    enable_instance_animations: e.target.checked
                  };
                  await invoke('save_settings', { newSettings: updated });
                  onSettingsUpdated();
                }}
              />
            </div>
            <p className="setting-hint">
              Enable glowing animated borders when hovering over game instances.
            </p>
          </div>

          <div className="setting-item">
            <div className="checkbox-row">
              <label>Account Preview Mode</label>
              <select
                value={launcherSettings?.account_preview_mode || 'simple'}
                onChange={async (e) => {
                  const updated = {
                    ...launcherSettings,
                    account_preview_mode: e.target.value
                  };
                  await invoke('save_settings', { newSettings: updated });
                  onSettingsUpdated();
                }}
                className="setting-select"
              >
                <option value="simple">Simple (Dropdown)</option>
                <option value="advanced">Advanced (Modal)</option>
              </select>
            </div>
            <p className="setting-hint">
              "Simple" uses a sidebar dropdown. "Advanced" uses a dedicated account management modal.
            </p>
          </div>

          <div className="setting-item">
            <div className="checkbox-row">
              <label>Instance Editor Mode</label>
              <select
                value={launcherSettings?.edit_mode_preference || 'ask'}
                onChange={async (e) => {
                  const updated = {
                    ...launcherSettings,
                    edit_mode_preference: e.target.value
                  };
                  await invoke('save_settings', { newSettings: updated });
                  onSettingsUpdated();
                }}
                className="setting-select"
              >
                <option value="ask">Always Ask</option>
                <option value="in-place">Same Window</option>
                <option value="pop-out">Pop-out Window</option>
              </select>
            </div>
            <p className="setting-hint">
              Choose how the instance editor should open.
            </p>
          </div>

          <div className="setting-item">
            <div className="checkbox-row">
              <label>Show Welcome Screen</label>
              <input
                type="checkbox"
                className="ios-switch"
                checked={launcherSettings?.show_welcome !== false}
                onChange={async (e) => {
                  const updated = {
                    ...launcherSettings,
                    show_welcome: e.target.checked
                  };
                  await invoke('save_settings', { newSettings: updated });
                  onSettingsUpdated();
                }}
              />
            </div>
            <p className="setting-hint">
              Show the welcome screen overlay on startup.
            </p>
          </div>
        </section>
      </div>
    </div>
  );
}

export default Appearance;
