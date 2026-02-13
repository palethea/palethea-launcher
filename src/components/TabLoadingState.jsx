function TabLoadingState({ label = 'Loading...', rows = 4 }) {
  return (
    <div className="tab-loading-state" role="status" aria-live="polite">
      <div className="tab-loading-caption">{label}</div>
      <div className="tab-loading-list">
        {Array.from({ length: rows }).map((_, index) => (
          <div
            key={index}
            className="tab-loading-row"
            style={{ animationDelay: `${index * 45}ms` }}
          >
            <div className="tab-loading-block tab-loading-icon" />
            <div className="tab-loading-lines">
              <div className="tab-loading-block tab-loading-line tab-loading-line-title" />
              <div className="tab-loading-block tab-loading-line tab-loading-line-meta" />
            </div>
            <div className="tab-loading-block tab-loading-pill" />
          </div>
        ))}
      </div>
    </div>
  );
}

export default TabLoadingState;