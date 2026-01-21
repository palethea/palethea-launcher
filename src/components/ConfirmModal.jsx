import './ConfirmModal.css';

function ConfirmModal({ isOpen = true, title, message, confirmText = 'Delete', cancelText = 'Cancel', onConfirm, onCancel, variant = 'danger' }) {
  if (!isOpen) return null;
  
  return (
    <div className="confirm-overlay" onClick={onCancel}>
      <div className="confirm-modal" onClick={(e) => e.stopPropagation()}>
        <div className="confirm-header">
          <h3>{title}</h3>
        </div>
        <div className="confirm-body">
          <p>{message}</p>
        </div>
        <div className="confirm-footer">
          {onCancel && cancelText !== null && (
            <button className="confirm-btn cancel" onClick={onCancel}>
              {cancelText}
            </button>
          )}
          <button className={`confirm-btn ${variant}`} onClick={onConfirm}>
            {confirmText}
          </button>
        </div>
      </div>
    </div>
  );
}

export default ConfirmModal;
