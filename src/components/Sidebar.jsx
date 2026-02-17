import { useState, useRef, useEffect, useCallback, useLayoutEffect, memo } from 'react';
import { open } from '@tauri-apps/plugin-shell';
import { 
  User, 
  HelpCircle, 
  Info, 
  House, 
  Shirt, 
  BarChart3, 
  RefreshCcw, 
  Settings,
  Wallpaper,
  ChevronDown,
  ExternalLink
} from 'lucide-react';
import './Sidebar.css';

// Steve head as a data URL fallback (8x8 Steve face)
const STEVE_HEAD_DATA = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAIAAABLbSncAAAARklEQVQI12NgoAbghLD+I4kwBqOjo+O/f/8YGBj+MzD8Z2D4z8Dwnwmq7P9/BoYL5y8g0/8hHP7/x0b/Y2D4D5b5/58ZAME2EVcxlvGVAAAAAElFTkSuQmCC';

const SkinHead2D = memo(({ src, size = 32 }) => (
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
));

const SIDEBAR_TABS = [
  { id: 'instances', label: 'Instances', icon: House },
  { id: 'skins', label: 'Skins', icon: Shirt },
  { id: 'stats', label: 'Stats', icon: BarChart3 },
  { id: 'updates', label: 'Updates', icon: RefreshCcw },
  { id: 'appearance', label: 'Appearance', icon: Wallpaper },
  { id: 'settings', label: 'Settings', icon: Settings },
];

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
  const navRef = useRef(null);
  const navButtonRefs = useRef({});
  const [tabIndicatorStyle, setTabIndicatorStyle] = useState({ top: 0, height: 0, visible: false });
  const isAdvancedAccountPreview = launcherSettings?.account_preview_mode === 'advanced';
  const sidebarStyleRaw = launcherSettings?.sidebar_style || 'full';
  const sidebarStyle = (sidebarStyleRaw === 'compact' || sidebarStyleRaw === 'original-slim') ? 'compact' : 'full';
  const isCompactSidebar = sidebarStyle === 'compact';
  const sidebarHeadSize = 32;

  const updateTabIndicator = useCallback(() => {
    const nav = navRef.current;
    const activeButton = navButtonRefs.current[activeTab];

    if (!nav || !activeButton) {
      setTabIndicatorStyle((prev) => ({ ...prev, visible: false }));
      return;
    }

    const navRect = nav.getBoundingClientRect();
    const buttonRect = activeButton.getBoundingClientRect();
    const top = buttonRect.top - navRect.top;
    const height = buttonRect.height;

    setTabIndicatorStyle({ top, height, visible: true });
  }, [activeTab, sidebarStyle]);

  useLayoutEffect(() => {
    updateTabIndicator();
    const rafId = window.requestAnimationFrame(updateTabIndicator);
    const handleResize = () => updateTabIndicator();
    window.addEventListener('resize', handleResize);

    return () => {
      window.cancelAnimationFrame(rafId);
      window.removeEventListener('resize', handleResize);
    };
  }, [updateTabIndicator, sidebarStyle]);

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

  useEffect(() => {
    if (isAdvancedAccountPreview && showAccountMenu) {
      setShowAccountMenu(false);
    }
  }, [isAdvancedAccountPreview, showAccountMenu]);

  const getSkinUrl = useCallback((uuid, isLoggedIn) => {
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
  }, [failedImages, skinRefreshKey]);

  const handleImageError = useCallback((uuid) => {
    setFailedImages(prev => ({ ...prev, [uuid]: true }));
  }, []);

  return (
    <aside className={`sidebar sidebar-style-${sidebarStyle} sidebar-variant-${sidebarStyleRaw}`}>
      <nav className="sidebar-nav" ref={navRef}>
        <div
          className="sidebar-nav-indicator"
          style={{
            transform: `translateY(${tabIndicatorStyle.top}px)`,
            height: `${tabIndicatorStyle.height}px`,
            opacity: tabIndicatorStyle.visible ? 1 : 0
          }}
        />
        {SIDEBAR_TABS.map((tab) => {
          const isDisabled = tab.id === 'skins' && !activeAccount?.isLoggedIn;
          return (
            <button
              key={tab.id}
              ref={(el) => {
                if (el) {
                  navButtonRefs.current[tab.id] = el;
                }
              }}
              className={`nav-item ${activeTab === tab.id ? 'active' : ''} ${isDisabled ? 'disabled' : ''}`}
              onClick={() => !isDisabled && onTabChange(tab.id)}
              title={tab.label}
              aria-label={tab.label}
            >
              {tab.icon && <tab.icon size={isCompactSidebar ? 22 : 18} className="nav-icon" />}
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
        <div
          className={`account-viewer ${showAccountMenu ? 'expanded' : ''} ${isCompactSidebar ? 'compact' : ''}`}
          onClick={() => {
            if (isAdvancedAccountPreview) {
              setShowAccountMenu(false);
              onOpenAccountManager();
            } else {
              setShowAccountMenu(!showAccountMenu);
            }
          }}
          title={activeAccount?.username || 'Player'}
          aria-label={isAdvancedAccountPreview ? 'Open account manager' : 'Open account menu'}
        >
          <div className="user-avatar">
            {currentSkinTexture ? (
              <SkinHead2D src={currentSkinTexture} size={sidebarHeadSize} />
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
          {!isCompactSidebar && (
            <>
              <div className="user-details">
                <span className="user-name">{activeAccount?.username || 'Player'}</span>
                <span className="user-status">{activeAccount?.isLoggedIn ? 'Microsoft' : 'Offline'}</span>
              </div>
              <span className={`account-expand ${isAdvancedAccountPreview ? 'advanced-icon' : 'simple-icon'} ${showAccountMenu ? 'expanded' : ''}`}>
                {isAdvancedAccountPreview ? <ExternalLink size={16} /> : <ChevronDown size={16} />}
              </span>
            </>
          )}
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

export default memo(Sidebar);
