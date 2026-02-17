import { useLayoutEffect, useRef, useState } from 'react';
import './ContextMenu.css';

function ContextMenu({ x, y, instance, isEditing = false, onAction }) {
  const menuRef = useRef(null);
  const [pos, setPos] = useState({ x, y });
  const [isReady, setIsReady] = useState(false);
  const isCategoryContext = Boolean(instance && instance.__kind === 'category');
  const hasInstanceContext = Boolean(instance) && !isCategoryContext;
  const isVirtualCategory = isCategoryContext && instance.bucketKey === '__uncategorized__';
  const categoryName = isCategoryContext ? (instance.name?.trim() || 'Category') : '';
  const hasKnownCategoryCount = isCategoryContext && Number.isFinite(Number(instance?.instanceCount));
  const categoryInstanceCount = hasKnownCategoryCount ? Math.max(0, Number(instance.instanceCount)) : null;

  useLayoutEffect(() => {
    const clampMenuPosition = () => {
      if (!menuRef.current) return;

      const menuWidth = menuRef.current.offsetWidth || menuRef.current.getBoundingClientRect().width;
      const menuHeight = menuRef.current.offsetHeight || menuRef.current.getBoundingClientRect().height;
      const edgePadding = 12;

      let adjustedX = x;
      let adjustedY = y;

      // Check right edge
      if (x + menuWidth > window.innerWidth) {
        adjustedX = window.innerWidth - menuWidth - edgePadding;
      }
      
      // Check bottom edge
      if (y + menuHeight > window.innerHeight) {
        adjustedY = window.innerHeight - menuHeight - edgePadding;
      }

      // Check left edge (failsafe)
      if (adjustedX < edgePadding) adjustedX = edgePadding;
      
      // Check top edge (failsafe)
      if (adjustedY < edgePadding) adjustedY = edgePadding;

      setPos((prev) => {
        if (prev.x === adjustedX && prev.y === adjustedY) return prev;
        return { x: adjustedX, y: adjustedY };
      });
      setIsReady(true);
    };

    setIsReady(false);
    clampMenuPosition();
    const rafId = window.requestAnimationFrame(clampMenuPosition);
    return () => window.cancelAnimationFrame(rafId);
  }, [x, y]);

  return (
    <div 
      ref={menuRef}
      className="context-menu"
      style={{ left: pos.x, top: pos.y, visibility: isReady ? 'visible' : 'hidden' }}
      onClick={(e) => e.stopPropagation()}
    >
      {hasInstanceContext ? (
        <>
          <div className="context-menu-header">{instance.name}</div>
          <div className="context-menu-divider" />
          <button className="context-menu-item" onClick={() => onAction('play')}>
            Play
          </button>
          <button className="context-menu-item" onClick={() => onAction('edit')} disabled={isEditing}>
            {isEditing ? 'Editing...' : 'Edit Instance'}
          </button>
          <button className="context-menu-item" onClick={() => onAction('clone')}>
            Clone Instance
          </button>
          <button className="context-menu-item" onClick={() => onAction('openFolder')}>
            Open Folder
          </button>
          <button className="context-menu-item" onClick={() => onAction('share')}>
            Share (Export .zip)
          </button>
          <button className="context-menu-item" onClick={() => onAction('shareCode')}>
            Copy Share Code
          </button>
          <button className="context-menu-item" onClick={() => onAction('createShortcut')}>
            Create Desktop Shortcut
          </button>
          <div className="context-menu-divider" />
          <div className="context-menu-label">Category</div>
          <div className="context-menu-category-value">
            {instance.category?.trim() || 'Uncategorized'}
          </div>
          <button className="context-menu-item" onClick={() => onAction('setCategory')}>
            Set Category...
          </button>
          <button
            className="context-menu-item subtle"
            onClick={() => onAction('clearCategory')}
            disabled={!instance.category?.trim()}
          >
            Clear Category
          </button>
          <div className="context-menu-divider" />
          <button className="context-menu-item danger" onClick={() => onAction('delete')}>
            Delete Instance
          </button>
        </>
      ) : isCategoryContext ? (
        <>
          <div className="context-menu-header">{categoryName}</div>
          <div className="context-menu-divider" />
          <button
            className="context-menu-item"
            onClick={() => onAction('categoryLaunchAll')}
            disabled={categoryInstanceCount === 0}
          >
            {categoryInstanceCount !== null
              ? `Launch All (${categoryInstanceCount})`
              : 'Launch All'}
          </button>
          <div className="context-menu-divider" />
          <button className="context-menu-item" onClick={() => onAction('categoryEdit')}>
            Edit Category
          </button>
          <button
            className="context-menu-item"
            onClick={() => onAction('categoryRename')}
            disabled={isVirtualCategory}
          >
            Rename
          </button>
          <button
            className="context-menu-item danger"
            onClick={() => onAction('categoryDelete')}
            disabled={isVirtualCategory}
          >
            Delete
          </button>
        </>
      ) : (
        <>
          <button className="context-menu-item" onClick={() => onAction('create')}>
            New Instance
          </button>
        </>
      )}
    </div>
  );
}

export default ContextMenu;
