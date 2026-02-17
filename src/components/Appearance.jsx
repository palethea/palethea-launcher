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
  const [showAccountPreviewDropdown, setShowAccountPreviewDropdown] = useState(false);
  const accountPreviewDropdownRef = useRef(null);
  const [showEditorModeDropdown, setShowEditorModeDropdown] = useState(false);
  const editorModeDropdownRef = useRef(null);
  const [showSidebarStyleDropdown, setShowSidebarStyleDropdown] = useState(false);
  const sidebarStyleDropdownRef = useRef(null);
  const [showInstanceHeaderDropdown, setShowInstanceHeaderDropdown] = useState(false);
  const instanceHeaderDropdownRef = useRef(null);

  const backgroundOptions = [
    { id: 'gradient', label: 'Static Gradient' },
    { id: 'dynamic', label: 'Animated Aura' },
    { id: 'gray', label: 'Nice Gray' }
  ];
  const accountPreviewOptions = [
    { id: 'simple', label: 'Simple (Dropdown)' },
    { id: 'advanced', label: 'Advanced (Modal)' }
  ];
  const editorModeOptions = [
    { id: 'ask', label: 'Always Ask' },
    { id: 'in-place', label: 'Same Window' },
    { id: 'pop-out', label: 'Pop-out Window' }
  ];
  const sidebarStyleOptions = [
    { id: 'full', label: 'Connected (Full Sidebar)' },
    { id: 'compact', label: 'Pushed In (Icons Only)' },
    { id: 'original', label: 'Original' },
    { id: 'original-slim', label: 'Original Slim' }
  ];
  const instanceHeaderStyleOptions = [
    { id: 'glass-top', label: 'Glass Top (Text)' },
    { id: 'glass-top-icons', label: 'Glass Top (Icons)' },
    { id: 'glass-bottom', label: 'Glass Bottom (Text)' },
    { id: 'glass-bottom-icons', label: 'Glass Bottom (Icons)' }
  ];

  const activeBackgroundStyle = launcherSettings?.background_style || 'gradient';
  const activeBackgroundLabel = backgroundOptions.find((opt) => opt.id === activeBackgroundStyle)?.label || 'Static Gradient';
  const activeAccountPreview = launcherSettings?.account_preview_mode || 'simple';
  const activeAccountPreviewLabel = accountPreviewOptions.find((opt) => opt.id === activeAccountPreview)?.label || 'Simple (Dropdown)';
  const activeEditorMode = launcherSettings?.edit_mode_preference || 'ask';
  const activeEditorModeLabel = editorModeOptions.find((opt) => opt.id === activeEditorMode)?.label || 'Always Ask';
  const activeSidebarStyleRaw = launcherSettings?.sidebar_style || 'full';
  const activeSidebarStyle = sidebarStyleOptions.some((opt) => opt.id === activeSidebarStyleRaw)
    ? activeSidebarStyleRaw
    : 'full';
  const activeSidebarStyleLabel = sidebarStyleOptions.find((opt) => opt.id === activeSidebarStyle)?.label || 'Connected (Full Sidebar)';
  const activeInstanceHeaderStyleRaw = launcherSettings?.instance_header_style || 'glass-top';
  const activeInstanceHeaderStyle = activeInstanceHeaderStyleRaw === 'glass-dark'
    ? 'glass-bottom'
    : activeInstanceHeaderStyleRaw === 'simple-left-corner'
      ? 'glass-bottom-icons'
    : activeInstanceHeaderStyleRaw;
  const activeInstanceHeaderStyleLabel = instanceHeaderStyleOptions.find((opt) => opt.id === activeInstanceHeaderStyle)?.label || 'Glass Top (Text)';

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (colorPickerRef.current && !colorPickerRef.current.contains(event.target)) {
        setShowColorPicker(false);
      }
      if (bgDropdownRef.current && !bgDropdownRef.current.contains(event.target)) {
        setShowBgDropdown(false);
      }
      if (accountPreviewDropdownRef.current && !accountPreviewDropdownRef.current.contains(event.target)) {
        setShowAccountPreviewDropdown(false);
      }
      if (editorModeDropdownRef.current && !editorModeDropdownRef.current.contains(event.target)) {
        setShowEditorModeDropdown(false);
      }
      if (sidebarStyleDropdownRef.current && !sidebarStyleDropdownRef.current.contains(event.target)) {
        setShowSidebarStyleDropdown(false);
      }
      if (instanceHeaderDropdownRef.current && !instanceHeaderDropdownRef.current.contains(event.target)) {
        setShowInstanceHeaderDropdown(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, []);

  return (
    <div className="settings">
      <div className="settings-header page-header">
        <p className="page-subtitle">Tailor the launcher's appearance with custom accent colors, background styles, and UI effects.</p>
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
                  <span>{activeBackgroundLabel}</span>
                  <ChevronDown size={14} className={`trigger-icon ${showBgDropdown ? 'flip' : ''}`} />
                </button>

                {showBgDropdown && (
                  <div className="p-dropdown-menu">
                    {backgroundOptions.map((opt) => (
                      <div 
                        key={opt.id}
                        className={`p-dropdown-item ${activeBackgroundStyle === opt.id ? 'selected' : ''}`}
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
                        {activeBackgroundStyle === opt.id && <Check size={14} className="selected-icon" />}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
            <p className="setting-hint">
              Choose between a subtle static gradient, an animated atmospheric aura, or a clean neutral gray.
            </p>
          </div>
        </section>

        <section className="settings-section">
          <h2>Interface Layout</h2>

          <div className="setting-item">
            <div className="checkbox-row">
              <label>Sidebar Design</label>
              <div className="p-dropdown" ref={sidebarStyleDropdownRef}>
                <button
                  className={`p-dropdown-trigger ${showSidebarStyleDropdown ? 'active' : ''}`}
                  onClick={() => setShowSidebarStyleDropdown(!showSidebarStyleDropdown)}
                  style={{ minWidth: '220px' }}
                >
                  <span>{activeSidebarStyleLabel}</span>
                  <ChevronDown size={14} className={`trigger-icon ${showSidebarStyleDropdown ? 'flip' : ''}`} />
                </button>

                {showSidebarStyleDropdown && (
                  <div className="p-dropdown-menu">
                    {sidebarStyleOptions.map((opt) => (
                      <div
                        key={opt.id}
                        className={`p-dropdown-item ${activeSidebarStyle === opt.id ? 'selected' : ''}`}
                        onClick={async () => {
                          const updated = {
                            ...launcherSettings,
                            sidebar_style: opt.id
                          };
                          await invoke('save_settings', { newSettings: updated });
                          onSettingsUpdated();
                          setShowSidebarStyleDropdown(false);
                        }}
                      >
                        <span>{opt.label}</span>
                        {activeSidebarStyle === opt.id && <Check size={14} className="selected-icon" />}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
            <p className="setting-hint">
              Pick between the full connected sidebar, or a compact pushed-in icon layout.
            </p>
          </div>

          <div className="setting-item">
            <div className="checkbox-row">
              <label>Account Preview Mode</label>
              <div className="p-dropdown" ref={accountPreviewDropdownRef}>
                <button
                  className={`p-dropdown-trigger ${showAccountPreviewDropdown ? 'active' : ''}`}
                  onClick={() => setShowAccountPreviewDropdown(!showAccountPreviewDropdown)}
                  style={{ minWidth: '180px' }}
                >
                  <span>{activeAccountPreviewLabel}</span>
                  <ChevronDown size={14} className={`trigger-icon ${showAccountPreviewDropdown ? 'flip' : ''}`} />
                </button>

                {showAccountPreviewDropdown && (
                  <div className="p-dropdown-menu">
                    {accountPreviewOptions.map((opt) => (
                      <div
                        key={opt.id}
                        className={`p-dropdown-item ${activeAccountPreview === opt.id ? 'selected' : ''}`}
                        onClick={async () => {
                          const updated = {
                            ...launcherSettings,
                            account_preview_mode: opt.id
                          };
                          await invoke('save_settings', { newSettings: updated });
                          onSettingsUpdated();
                          setShowAccountPreviewDropdown(false);
                        }}
                      >
                        <span>{opt.label}</span>
                        {activeAccountPreview === opt.id && <Check size={14} className="selected-icon" />}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
            <p className="setting-hint">
              "Simple" uses a sidebar dropdown. "Advanced" uses a dedicated account management modal.
            </p>
          </div>

          <div className="setting-item">
            <div className="checkbox-row">
              <label>Instance Editor Mode</label>
              <div className="p-dropdown" ref={editorModeDropdownRef}>
                <button
                  className={`p-dropdown-trigger ${showEditorModeDropdown ? 'active' : ''}`}
                  onClick={() => setShowEditorModeDropdown(!showEditorModeDropdown)}
                  style={{ minWidth: '180px' }}
                >
                  <span>{activeEditorModeLabel}</span>
                  <ChevronDown size={14} className={`trigger-icon ${showEditorModeDropdown ? 'flip' : ''}`} />
                </button>

                {showEditorModeDropdown && (
                  <div className="p-dropdown-menu">
                    {editorModeOptions.map((opt) => (
                      <div
                        key={opt.id}
                        className={`p-dropdown-item ${activeEditorMode === opt.id ? 'selected' : ''}`}
                        onClick={async () => {
                          const updated = {
                            ...launcherSettings,
                            edit_mode_preference: opt.id
                          };
                          await invoke('save_settings', { newSettings: updated });
                          onSettingsUpdated();
                          setShowEditorModeDropdown(false);
                        }}
                      >
                        <span>{opt.label}</span>
                        {activeEditorMode === opt.id && <Check size={14} className="selected-icon" />}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
            <p className="setting-hint">
              Choose how the instance editor should open.
            </p>
          </div>

          <div className="setting-item">
            <div className="checkbox-row">
              <label>Instances Header Bar</label>
              <div className="p-dropdown" ref={instanceHeaderDropdownRef}>
                <button
                  className={`p-dropdown-trigger ${showInstanceHeaderDropdown ? 'active' : ''}`}
                  onClick={() => setShowInstanceHeaderDropdown(!showInstanceHeaderDropdown)}
                  style={{ minWidth: '220px' }}
                >
                  <span>{activeInstanceHeaderStyleLabel}</span>
                  <ChevronDown size={14} className={`trigger-icon ${showInstanceHeaderDropdown ? 'flip' : ''}`} />
                </button>

                {showInstanceHeaderDropdown && (
                  <div className="p-dropdown-menu">
                    {instanceHeaderStyleOptions.map((opt) => (
                      <div
                        key={opt.id}
                        className={`p-dropdown-item ${activeInstanceHeaderStyle === opt.id ? 'selected' : ''}`}
                        onClick={async () => {
                          const updated = {
                            ...launcherSettings,
                            instance_header_style: opt.id
                          };
                          await invoke('save_settings', { newSettings: updated });
                          onSettingsUpdated();
                          setShowInstanceHeaderDropdown(false);
                        }}
                      >
                        <span>{opt.label}</span>
                        {activeInstanceHeaderStyle === opt.id && <Check size={14} className="selected-icon" />}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
            <p className="setting-hint">
              Select the visual style for the floating Instances control bar.
            </p>
          </div>

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
              <label>FPS Counter</label>
              <input
                type="checkbox"
                className="ios-switch"
                checked={launcherSettings?.show_fps_counter || false}
                onChange={async (e) => {
                  const updated = {
                    ...launcherSettings,
                    show_fps_counter: e.target.checked
                  };
                  await invoke('save_settings', { newSettings: updated });
                  onSettingsUpdated();
                }}
              />
            </div>
            <p className="setting-hint">
              Show a real-time FPS counter overlay in the bottom-left corner.
            </p>
          </div>

          <div className="setting-item">
            <div className="checkbox-row">
              <label>Instance Editor Tab Icons</label>
              <input
                type="checkbox"
                className="ios-switch"
                checked={launcherSettings?.show_instance_editor_tab_icons === true}
                onChange={async (e) => {
                  const updated = {
                    ...launcherSettings,
                    show_instance_editor_tab_icons: e.target.checked
                  };
                  await invoke('save_settings', { newSettings: updated });
                  onSettingsUpdated();
                }}
              />
            </div>
            <p className="setting-hint">
              Show icons in the Instance Editor main tabs (Settings, Console, Mods, Resources, Worlds, Servers, Screenshots).
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
