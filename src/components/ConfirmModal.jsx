import './ConfirmModal.css';

function ConfirmModal({
  isOpen = true,
  title,
  message,
  confirmText = 'Delete',
  cancelText = 'Cancel',
  extraConfirmText,
  onConfirm,
  onCancel,
  onExtraConfirm,
  variant = 'danger',
  actionLayout = 'split',
  modalClassName = ''
}) {
  if (!isOpen) return null;
  
  return (
    <div className="confirm-overlay" onClick={onCancel}>
      <div className={`confirm-modal ${modalClassName}`.trim()} onClick={(e) => e.stopPropagation()}>
        <div className="confirm-header">
          <h3>{title}</h3>
        </div>
        <div className="confirm-body">
          {typeof message === 'string' ? <p>{message}</p> : message}
        </div>
        {actionLayout === 'flat' ? (
          <div className="confirm-footer confirm-footer-flat">
            {onCancel && cancelText !== null && (
              <button className="confirm-btn cancel" onClick={onCancel}>
                {cancelText}
              </button>
            )}
            {extraConfirmText && (
              <button className="confirm-btn secondary extra-action" onClick={onExtraConfirm}>
                {extraConfirmText}
              </button>
            )}
            <button className={`confirm-btn ${variant} primary-action`} onClick={onConfirm}>
              {confirmText}
            </button>
          </div>
        ) : (
          <div className="confirm-footer">
            <div className="confirm-footer-left">
              {onCancel && cancelText !== null && (
                <button className="confirm-btn cancel" onClick={onCancel}>
                  {cancelText}
                </button>
              )}
            </div>
            <div className="confirm-footer-right">
              {extraConfirmText && (
                <button className="confirm-btn secondary extra-action" onClick={onExtraConfirm}>
                  {extraConfirmText}
                </button>
              )}
              <button className={`confirm-btn ${variant} primary-action`} onClick={onConfirm}>
                {confirmText}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default ConfirmModal;
