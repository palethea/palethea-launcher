import { useState } from 'react';
import { User, X, Trash2 } from 'lucide-react';
import './AccountManagerModal.css';

const STEVE_HEAD_DATA = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAIAAABLbSncAAAARklEQVQI12NgoAbghLD+I4kwBqOjo+O/f/8YGBj+MzD8Z2D4z8Dwnwmq7P9/BoYL5y8g0/8hHP7/x0b/Y2D4D5b5/58ZAME2EVcxlvGVAAAAAElFTkSuQmCC';

function AccountManagerModal({
    show,
    onClose,
    accounts,
    activeAccount,
    onSwitchAccount,
    onAddAccount,
    onRemoveAccount,
    skinCache = {},
    skinRefreshKey
}) {
    const [failedImages, setFailedImages] = useState({});

    if (!show) return null;

    const getSkinUrl = (uuid, isLoggedIn) => {
        if (!isLoggedIn || !uuid) return STEVE_HEAD_DATA;
        if (failedImages[uuid]) return STEVE_HEAD_DATA;
        const cleanUuid = uuid.replace(/-/g, '');
        return `https://minotar.net/helm/${cleanUuid}/64.png?t=${skinRefreshKey}`;
    };

    const SkinHead2D = ({ src, size = 48 }) => (
        <div className="modal-head-2d" style={{ width: `${size}px`, height: `${size}px` }}>
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

    return (
        <div className="account-modal-overlay" onClick={onClose}>
            <div className="account-modal-content" onClick={e => e.stopPropagation()}>
                <div className="modal-header">
                    <h2>Account Manager</h2>
                    <button className="close-btn" onClick={onClose}><X size={24} /></button>
                </div>

                <div className="account-grid">
                    {accounts.map((account, index) => (
                        <div
                            key={index}
                            className={`account-card ${account.username === activeAccount?.username ? 'active' : ''}`}
                            onClick={() => {
                                onSwitchAccount(account);
                                onClose();
                            }}
                        >
                            <div className="account-card-avatar">
                                {skinCache[account.uuid] ? (
                                    <SkinHead2D src={skinCache[account.uuid]} size={64} />
                                ) : account.isLoggedIn ? (
                                    <img
                                        src={getSkinUrl(account.uuid, account.isLoggedIn)}
                                        alt=""
                                        className="skin-head-large"
                                        onError={(e) => {
                                            e.target.src = STEVE_HEAD_DATA;
                                            setFailedImages(prev => ({ ...prev, [account.uuid]: true }));
                                        }}
                                    />
                                ) : (
                                    <div className="skin-fallback-icon-modal">
                                        <User size={32} />
                                    </div>
                                )}
                                {account.username === activeAccount?.username && (
                                    <div className="active-badge">✓</div>
                                )}
                            </div>
                            <div className="account-card-info">
                                <span className="account-name">{account.username}</span>
                                <span className="account-type">{account.isLoggedIn ? 'Microsoft' : 'Offline'}</span>
                            </div>
                            <button
                                className="remove-card-btn"
                                onClick={(e) => {
                                    e.stopPropagation();
                                    onRemoveAccount(account.username);
                                }}
                                title="Remove account"
                            >
                                <Trash2 size={16} />
                            </button>
                        </div>
                    ))}

                    <button className="add-account-card" onClick={() => {
                        onAddAccount();
                        onClose();
                    }}>
                        <div className="add-icon">+</div>
                        <span>Add Account</span>
                    </button>
                </div>
            </div>
        </div>
    );
}

export default AccountManagerModal;
