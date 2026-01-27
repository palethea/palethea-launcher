import { useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { open } from '@tauri-apps/plugin-shell';
import './LoginPrompt.css';

function LoginPrompt({ onLogin, onClose, onOfflineMode }) {
  const [deviceCode, setDeviceCode] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [polling, setPolling] = useState(false);
  const [offlineUsername, setOfflineUsername] = useState('');
  const [showOfflineInput, setShowOfflineInput] = useState(false);

  const startMicrosoftLogin = async () => {
    setLoading(true);
    setError(null);
    
    try {
      // Get device code
      const codeInfo = await invoke('start_microsoft_login');
      setDeviceCode(codeInfo);
      setPolling(true);
      
      // Automatically open the login URL in the default browser
      try {
        await open(codeInfo.verification_uri);
      } catch (e) {
        console.error('Failed to open browser:', e);
      }
      
      // Poll for completion
      const pollForToken = async () => {
        try {
          const result = await invoke('poll_microsoft_login', { 
            deviceCode: codeInfo.device_code 
          });
          
          // If we get here without error, auth succeeded - result is the username
          onLogin(result);
        } catch (err) {
          const errStr = err.toString();
          // Check if it's a pending error (user hasn't completed auth yet)
          if (errStr.includes('authorization_pending') || errStr.includes('pending')) {
            setTimeout(pollForToken, 3000);
          } else if (errStr.includes('expired')) {
            setError('Authentication expired. Please try again.');
            setPolling(false);
            setDeviceCode(null);
          } else {
            setError(errStr);
            setPolling(false);
            setDeviceCode(null);
          }
        }
      };
      
      pollForToken();
    } catch (err) {
      setError(err.toString());
    }
    setLoading(false);
  };

  const copyCode = async () => {
    if (deviceCode?.user_code) {
      try {
        await navigator.clipboard.writeText(deviceCode.user_code);
      } catch (e) {
        console.error('Failed to copy:', e);
      }
    }
  };

  const openLink = async () => {
    if (deviceCode?.verification_uri) {
      try {
        await open(deviceCode.verification_uri);
      } catch (e) {
        console.error('Failed to open browser:', e);
      }
    }
  };

  const handleOfflinePlay = async () => {
    if (!offlineUsername.trim()) return;
    
    try {
      await invoke('set_offline_user', { username: offlineUsername.trim() });
      onOfflineMode(offlineUsername.trim());
    } catch (err) {
      setError(err.toString());
    }
  };

  return (
    <div className="login-prompt-overlay">
      <div className="login-prompt">
        <div className="login-header">
          {/* <img src="/logoPL.png" className="login-logo" alt="Palethea" /> */}
          <h2>Welcome to Palethea</h2>
          <p className="login-subtitle">
            Sign in with your Microsoft account to play Minecraft online.
          </p>
        </div>

        {error && (
          <div className="login-error">
            {error}
          </div>
        )}

        {!deviceCode && !showOfflineInput ? (
          <div className="login-actions">
            <button 
              className="btn btn-primary login-btn"
              onClick={startMicrosoftLogin}
              disabled={loading}
            >
              {loading ? 'Starting...' : 'Sign in with Microsoft'}
            </button>
            
            <div className="login-divider">
              <span>or</span>
            </div>
            
            <button 
              className="btn btn-secondary offline-btn"
              onClick={() => setShowOfflineInput(true)}
            >
              Play Offline
            </button>
            <p className="offline-note">
              Offline mode allows playing without an account, but you won't be able to join online servers.
            </p>
          </div>
        ) : showOfflineInput ? (
          <div className="offline-section">
            <p>Enter a username for offline play:</p>
            <input
              type="text"
              placeholder="Username"
              value={offlineUsername}
              onChange={(e) => setOfflineUsername(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleOfflinePlay()}
              autoFocus
              maxLength={16}
            />
            <div className="offline-actions">
              <button 
                className="btn btn-secondary"
                onClick={() => setShowOfflineInput(false)}
              >
                Back
              </button>
              <button 
                className="btn btn-primary"
                onClick={handleOfflinePlay}
                disabled={!offlineUsername.trim()}
              >
                Play Offline
              </button>
            </div>
          </div>
        ) : (
          <div className="device-code-section">
            <p>Go to the following URL and enter the code:</p>
            
            <div className="verification-url" onClick={openLink}>
              {deviceCode.verification_uri}
            </div>
            
            <div className="code-display" onClick={copyCode}>
              <span className="code">{deviceCode.user_code}</span>
              <span className="copy-hint">Click to copy</span>
            </div>
            
            {polling && (
              <div className="polling-status">
                <div className="polling-spinner"></div>
                <span>Waiting for authentication...</span>
              </div>
            )}
            
            <button 
              className="btn btn-secondary cancel-btn"
              onClick={() => {
                setDeviceCode(null);
                setPolling(false);
              }}
            >
              Cancel
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

export default LoginPrompt;
