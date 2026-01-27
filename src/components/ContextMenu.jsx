import { useLayoutEffect, useRef, useState } from 'react';
import './ContextMenu.css';

function ContextMenu({ x, y, instance, onAction }) {
  const menuRef = useRef(null);
  const [pos, setPos] = useState({ x, y });
  const [isReady, setIsReady] = useState(false);

  useLayoutEffect(() => {
    if (menuRef.current) {
      const rect = menuRef.current.getBoundingClientRect();
      const menuWidth = rect.width;
      const menuHeight = rect.height;

      let adjustedX = x;
      let adjustedY = y;

      // Check right edge
      if (x + menuWidth > window.innerWidth) {
        adjustedX = window.innerWidth - menuWidth - 8;
      }
      
      // Check bottom edge
      if (y + menuHeight > window.innerHeight) {
        adjustedY = window.innerHeight - menuHeight - 8;
      }

      // Check left edge (failsafe)
      if (adjustedX < 8) adjustedX = 8;
      
      // Check top edge (failsafe)
      if (adjustedY < 8) adjustedY = 8;

      setPos({ x: adjustedX, y: adjustedY });
      setIsReady(true);
    }
  }, [x, y]);

  return (
    <div 
      ref={menuRef}
      className="context-menu"
      style={{ left: pos.x, top: pos.y, visibility: isReady ? 'visible' : 'hidden' }}
      onClick={(e) => e.stopPropagation()}
    >
      {instance ? (
        <>
          <div className="context-menu-header">{instance.name}</div>
          <div className="context-menu-divider" />
          <button className="context-menu-item" onClick={() => onAction('play')}>
            Play
          </button>
          <button className="context-menu-item" onClick={() => onAction('edit')}>
            Edit Instance
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
          <div className="context-menu-divider" />
          <div className="context-menu-label">Set Color</div>
          <div className="color-quick-select">
            {['#ff6b6b', '#4ade80', '#60a5fa', '#fbbf24', '#a78bfa', '#ffffff'].map(color => (
              <button
                key={color}
                className="color-swatch"
                style={{ backgroundColor: color }}
                onClick={() => onAction('setColor', color)}
              />
            ))}
          </div>
          <div className="context-menu-divider" />
          <button className="context-menu-item danger" onClick={() => onAction('delete')}>
            Delete Instance
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
