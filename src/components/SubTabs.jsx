import { useLayoutEffect, useRef, useState, memo } from 'react';

function SubTabs({ tabs, activeTab, onTabChange, className = '' }) {
  const containerRef = useRef(null);
  const tabButtonRefs = useRef({});
  const [indicatorStyle, setIndicatorStyle] = useState({ left: 0, width: 0, visible: false });

  useLayoutEffect(() => {
    const updateIndicator = () => {
      const container = containerRef.current;
      const activeButton = tabButtonRefs.current[activeTab];
      const indicatorHorizontalPadding = 6;

      if (!container || !activeButton) {
        setIndicatorStyle((prev) => ({ ...prev, visible: false }));
        return;
      }

      const containerRect = container.getBoundingClientRect();
      const activeLabel = activeButton.querySelector('.sub-tab-label');
      const targetRect = activeLabel
        ? activeLabel.getBoundingClientRect()
        : activeButton.getBoundingClientRect();

      setIndicatorStyle({
        left: targetRect.left - containerRect.left - indicatorHorizontalPadding,
        width: targetRect.width + indicatorHorizontalPadding * 2,
        visible: true
      });
    };

    updateIndicator();
    window.addEventListener('resize', updateIndicator);
    return () => window.removeEventListener('resize', updateIndicator);
  }, [activeTab, tabs]);

  return (
    <div className={`sub-tabs ${className}`.trim()} ref={containerRef}>
      {tabs.map((tab) => (
        <button
          key={tab.id}
          ref={(el) => {
            if (el) tabButtonRefs.current[tab.id] = el;
          }}
          className={`sub-tab ${activeTab === tab.id ? 'active' : ''}`}
          onClick={() => onTabChange(tab.id)}
        >
          <span className="sub-tab-label">{tab.label}</span>
        </button>
      ))}
      <div
        className="sub-tab-indicator"
        style={{
          transform: `translateX(${indicatorStyle.left}px)`,
          width: `${indicatorStyle.width}px`,
          opacity: indicatorStyle.visible ? 1 : 0
        }}
      />
    </div>
  );
}

export default memo(SubTabs);
