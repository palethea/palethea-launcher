function ProjectDetailsModal({
  onClose,
  headerIconUrl,
  headerFallback = 'PK',
  headerTitle,
  headerMeta,
  headerDescription,
  sidebarSections = [],
  tabs = [],
  activeTab,
  onTabChange,
  mainContent,
  versionsLabel,
  versionsTag,
  versionsContent,
  footerContent,
  children
}) {
  return (
    <div className="version-modal-overlay" onClick={onClose}>
      <div className="version-modal rich-modal" onClick={(event) => event.stopPropagation()}>
        <div className="version-modal-header">
          <div className="header-info">
            {headerIconUrl ? (
              <img src={headerIconUrl} alt="" className="project-icon-large" referrerPolicy="no-referrer" />
            ) : (
              <div className="project-icon-large project-icon-placeholder">{headerFallback}</div>
            )}
            <div className="header-text">
              <h3>{headerTitle}</h3>
              {headerMeta}
              {headerDescription && <p className="header-description">{headerDescription}</p>}
            </div>
          </div>
          <button className="close-btn" onClick={onClose}>&times;</button>
        </div>

        <div className="rich-modal-content">
          <div className="rich-modal-sidebar">
            {sidebarSections.map((section) => (
              <div key={section.key || section.label} className="sidebar-section">
                <label>{section.label}</label>
                {section.content}
              </div>
            ))}
          </div>

          <div className="rich-modal-main">
            <div className="modal-tabs">
              {tabs.map((tab) => (
                <button
                  key={tab.id}
                  className={`modal-tab ${activeTab === tab.id ? 'active' : ''}`}
                  onClick={() => onTabChange(tab.id)}
                >
                  {tab.icon}
                  {tab.label}
                  {typeof tab.count === 'number' && tab.count > 0 && <span className="tab-count">{tab.count}</span>}
                </button>
              ))}
            </div>

            <div className="modal-tab-content">
              {mainContent}
            </div>
          </div>

          <div className="rich-modal-versions">
            <div className="versions-header">
              <label>{versionsLabel}</label>
              <span className="version-info-tag">{versionsTag}</span>
            </div>
            <div className="versions-scroll">
              {versionsContent}
            </div>
          </div>
        </div>

        <div className="version-modal-footer">
          {footerContent}
        </div>
      </div>
      {children}
    </div>
  );
}

export default ProjectDetailsModal;
