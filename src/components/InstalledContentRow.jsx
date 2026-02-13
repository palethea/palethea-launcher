import { Check, Info, RefreshCcw, Trash2 } from 'lucide-react';

function getProviderClass(provider) {
  const normalized = String(provider || '').toLowerCase();
  if (normalized === 'modrinth') return 'modrinth';
  if (normalized === 'curseforge') return 'curseforge';
  if (normalized === 'manual') return 'manual';
  return '';
}

function InstalledContentRow({
  item,
  isUpdating,
  isSelected,
  selectionModeActive,
  versionLabel,
  showUpdateBadge,
  platformLabel,
  authorFallback = 'Unknown author',
  onToggleSelect,
  onInfoAction,
  onToggleEnabled,
  onDelete,
  infoTitle = 'Open project info',
  deleteTitle = 'Delete item',
  updatingLabel = 'Updating...',
}) {
  const displayName = item.name || item.filename;
  const displayVersion = versionLabel || 'Unknown version';
  const displayPlatform = platformLabel || item.provider || 'Unknown';
  const providerClass = getProviderClass(displayPlatform);
  const canOpenInfo = typeof onInfoAction === 'function';
  const isEnabled = item.enabled ?? true;

  return (
    <div
      className={`installed-item ${!isEnabled ? 'disabled' : ''} ${isUpdating ? 'mod-updating' : ''} ${isSelected ? 'selected' : ''}`}
      onClick={() => {
        if (selectionModeActive) {
          onToggleSelect?.(item.filename);
        }
      }}
    >
      {isUpdating && (
        <div className="mod-updating-overlay">
          <RefreshCcw className="spin-icon" size={20} />
          <span>{updatingLabel}</span>
        </div>
      )}

      <div className="item-main">
        <div
          className="item-selection"
          onClick={(event) => {
            event.stopPropagation();
            onToggleSelect?.(item.filename);
          }}
        >
          <div className={`selection-checkbox ${isSelected ? 'checked' : ''}`}>
            {isSelected && <Check size={12} />}
          </div>
        </div>

        {item.icon_url ? (
          <img src={item.icon_url} alt="" className="mod-icon-small" referrerPolicy="no-referrer" />
        ) : (
          <div className="mod-icon-placeholder">📦</div>
        )}

        <div
          className="item-info-grid clickable"
          onClick={(event) => {
            if (selectionModeActive) {
              event.stopPropagation();
              onToggleSelect?.(item.filename);
              return;
            }
            onInfoAction?.(item);
          }}
        >
          <div className="item-grid-primary">
            <h4>{displayName}</h4>
            <span className="item-grid-author">
              <span className="item-grid-author-prefix">by </span>
              <span className="item-grid-author-name">{item.author || authorFallback}</span>
            </span>
          </div>

          <div className="item-grid-secondary">
            <div className="item-grid-version-row">
              <span className="mod-version-tag" title={displayVersion}>
                {displayVersion}
              </span>
              {showUpdateBadge && (
                <span className="update-available-tag pulse">Update Available</span>
              )}
            </div>
            <span className={`item-grid-platform ${providerClass}`.trim()}>{displayPlatform}</span>
          </div>
        </div>
      </div>

      <div className="item-actions">
        <div
          className={`item-toggle ${isEnabled ? 'enabled' : ''}`}
          onClick={(event) => {
            event.stopPropagation();
            if (!isUpdating) {
              onToggleEnabled?.(item);
            }
          }}
          title={isEnabled ? 'Disable item' : 'Enable item'}
        />
        <button
          className="update-btn-simple"
          onClick={(event) => {
            event.stopPropagation();
            onInfoAction?.(item);
          }}
          title={infoTitle}
          disabled={isUpdating || !canOpenInfo}
        >
          <Info size={14} />
        </button>
        <button
          className="delete-btn-simple"
          onClick={(event) => {
            event.stopPropagation();
            onDelete?.(item);
          }}
          title={deleteTitle}
          disabled={isUpdating}
        >
          <Trash2 size={16} />
        </button>
      </div>
    </div>
  );
}

export default InstalledContentRow;
