import { useState, useRef, useEffect } from 'react';
import { open } from '@tauri-apps/plugin-shell';
import { User, HelpCircle, Info } from 'lucide-react';
import './Sidebar.css';

// Steve head as a data URL fallback (8x8 Steve face)
const STEVE_HEAD_DATA = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAIAAABLbSncAAAARklEQVQI12NgoAbghLD+I4kwBqOjo+O/f/8YGBj+MzD8Z2D4z8Dwnwmq7P9/BoYL5y8g0/8hHP7/x0b/Y2D4D5b5/58ZAME2EVcxlvGVAAAAAElFTkSuQmCC';

function Sidebar({
  activeTab,
  onTabChange,
  accounts,
  activeAccount,
  onSwitchAccount,
  onAddAccount,
  onRemoveAccount,
  skinRefreshKey,
  currentSkinTexture,
  skinCache = {},
  launcherSettings,
  onOpenAccountManager,
  onShowInfo
}) {
  const [showAccountMenu, setShowAccountMenu] = useState(false);
  const [failedImages, setFailedImages] = useState({});
  const accountMenuRef = useRef(null);

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (accountMenuRef.current && !accountMenuRef.current.contains(event.target)) {
        setShowAccountMenu(false);
      }
    };

    if (showAccountMenu) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [showAccountMenu]);

  const SkinHead2D = ({ src, size = 32 }) => (
    <div className="sidebar-head-2d" style={{ width: `${size}px`, height: `${size}px` }}>
      <div
        className="head-base"
        style={{
          backgroundImage: `url("${src}")`,
          width: `${size}px`,
          height: `${size}px`,
          backgroundSize: `${size * 8}px auto`,
          backgroundPosition: `-${size}px -${size}px`
        }}
      ></div>
      <div
        className="head-overlay"
        style={{
          backgroundImage: `url("${src}")`,
          width: `${size}px`,
          height: `${size}px`,
          backgroundSize: `${size * 8}px auto`,
          backgroundPosition: `-${size * 5}px -${size}px`
        }}
      ></div>
    </div>
  );

  const tabs = [
    { id: 'instances', label: 'Instances', icon: null },
    { id: 'skins', label: 'Skins', icon: null },
    { id: 'stats', label: 'Stats', icon: null },
    { id: 'updates', label: 'Updates', icon: null },
    { id: 'settings', label: 'Settings', icon: null },
  ];

  const getSkinUrl = (uuid, isLoggedIn) => {
    if (!isLoggedIn || !uuid) {
      return STEVE_HEAD_DATA;
    }
    // Check if this UUID's image already failed
    if (failedImages[uuid]) {
      return STEVE_HEAD_DATA;
    }
    // Use minotar.net - more reliable, accepts UUIDs with or without dashes
    const cleanUuid = uuid.replace(/-/g, '');
    return `https://minotar.net/helm/${cleanUuid}/32.png?t=${skinRefreshKey}`;
  };

  const handleImageError = (uuid) => {
    setFailedImages(prev => ({ ...prev, [uuid]: true }));
  };

  return (
    <aside className="sidebar">
      <div className="sidebar-header">
        <div
          className="logo"
          onClick={() => open('https://palethea.com')}
          style={{ cursor: 'pointer' }}
        >
          <span className="logo-text">Palethea</span>
        </div>
      </div>

      <nav className="sidebar-nav">
        {tabs.map((tab) => {
          const isDisabled = tab.id === 'skins' && !activeAccount?.isLoggedIn;
          return (
            <button
              key={tab.id}
              className={`nav-item ${activeTab === tab.id ? 'active' : ''} ${isDisabled ? 'disabled' : ''}`}
              onClick={() => !isDisabled && onTabChange(tab.id)}
            >
              <span className="nav-label">{tab.label}</span>
              {isDisabled && (
                <div 
                  className="tab-info-trigger"
                  onClick={(e) => {
                    e.stopPropagation();
                    onShowInfo({
                      title: 'Page Disabled',
                      message: 'This page is disabled because you are not logged in. A Microsoft account is required to manage and sync Minecraft skins.',
                      confirmText: 'Got it',
                      variant: 'info'
                    });
                  }}
                  title="Why is this disabled?"
                >
                  <Info size={14} />
                </div>
              )}
            </button>
          );
        })}
      </nav>

      <div className="sidebar-footer" ref={accountMenuRef}>
        {launcherSettings?.enable_console && (
          <button
            className={`console-sidebar-btn ${activeTab === 'console' ? 'active' : ''}`}
            onClick={() => onTabChange('console')}
            title="Open Console"
          >
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="4 17 10 11 4 5" />
              <line x1="12" y1="19" x2="20" y2="19" />
            </svg>
            <span>Console</span>
          </button>
        )}

        <div
          className={`account-viewer ${showAccountMenu ? 'expanded' : ''}`}
          onClick={() => {
            if (launcherSettings?.account_preview_mode === 'advanced') {
              onOpenAccountManager();
            } else {
              setShowAccountMenu(!showAccountMenu);
            }
          }}
        >
          <div className="user-avatar">
            {currentSkinTexture ? (
              <SkinHead2D src={currentSkinTexture} size={32} />
            ) : activeAccount?.isLoggedIn ? (
              <img
                src={getSkinUrl(activeAccount?.uuid, activeAccount?.isLoggedIn)}
                alt=""
                className="skin-head"
                onError={(e) => {
                  e.target.src = STEVE_HEAD_DATA;
                  if (activeAccount?.uuid) handleImageError(activeAccount.uuid);
                }}
              />
            ) : (
              <div className="skin-fallback-icon">
                <User size={20} />
              </div>
            )}
          </div>
          <div className="user-details">
            <span className="user-name">{activeAccount?.username || 'Player'}</span>
            <span className="user-status">{activeAccount?.isLoggedIn ? 'Microsoft' : 'Offline'}</span>
          </div>
          <span className="account-expand">▾</span>
        </div>

        {showAccountMenu && (
          <div className="account-menu">
            <div className="account-menu-header">Accounts</div>
            {accounts.map((account, index) => (
              <div
                key={index}
                className={`account-option ${account.username === activeAccount?.username ? 'active' : ''}`}
              >
                <div
                  className="account-option-main"
                  onClick={() => {
                    onSwitchAccount(account);
                    setShowAccountMenu(false);
                  }}
                >
                  <div className="account-option-avatar">
                    {skinCache[account.uuid] ? (
                      <SkinHead2D src={skinCache[account.uuid]} size={24} />
                    ) : account.isLoggedIn ? (
                      <img
                        src={getSkinUrl(account.uuid, account.isLoggedIn)}
                        alt=""
                        className="skin-head-small"
                        onError={(e) => {
                          e.target.src = STEVE_HEAD_DATA;
                          if (account?.uuid) handleImageError(account.uuid);
                        }}
                      />
                    ) : (
                      <div className="skin-fallback-icon-small">
                        <User size={14} />
                      </div>
                    )}
                  </div>
                  <div className="account-option-info">
                    <span className="account-option-name">{account.username}</span>
                    <span className="account-option-type">{account.isLoggedIn ? 'Microsoft' : 'Offline'}</span>
                  </div>
                  {account.username === activeAccount?.username && (
                    <span className="account-check">✓</span>
                  )}
                </div>
                <button
                  className="account-remove"
                  onClick={(e) => {
                    e.stopPropagation();
                    onRemoveAccount(account.username);
                    setShowAccountMenu(false);
                  }}
                  title="Remove account"
                >
                  ×
                </button>
              </div>
            ))}
            <button className="account-add" onClick={() => {
              onAddAccount();
              setShowAccountMenu(false);
            }}>
              + Add Account
            </button>
          </div>
        )}
      </div>
    </aside>
  );
}

export default Sidebar;
