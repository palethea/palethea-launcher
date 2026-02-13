import React from 'react';
import { invoke } from '@tauri-apps/api/core';
import { AlertTriangle, RotateCcw } from 'lucide-react';

const isDev = import.meta.env.DEV;

function normalizeError(value) {
  if (value instanceof Error) return value;
  if (typeof value === 'string') return new Error(value);
  try {
    return new Error(JSON.stringify(value));
  } catch {
    return new Error(String(value));
  }
}

class AppErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = {
      hasError: false,
      source: null,
      error: null,
      details: null,
      timestamp: null
    };
  }

  static getDerivedStateFromError(error) {
    return {
      hasError: true,
      source: 'react',
      error: normalizeError(error),
      timestamp: Date.now()
    };
  }

  componentDidCatch(error, info) {
    const normalized = normalizeError(error);
    this.setState((prev) => ({
      ...prev,
      hasError: true,
      source: prev.source || 'react',
      error: normalized,
      details: info?.componentStack || null,
      timestamp: prev.timestamp || Date.now()
    }));
    this.logFatalError('react', normalized, info?.componentStack || '');
  }

  componentDidMount() {
    this.handleWindowError = (event) => {
      // Ignore non-fatal resource load errors (favicon/img/etc).
      if (!event?.error) return;
      this.triggerFatal('runtime', event.error, event.message || '');
    };

    this.handleUnhandledRejection = (event) => {
      const reason = normalizeError(event?.reason);
      this.triggerFatal('unhandledrejection', reason, '');
    };

    window.addEventListener('error', this.handleWindowError);
    window.addEventListener('unhandledrejection', this.handleUnhandledRejection);
    this.registerDevtoolsCommands();
  }

  componentWillUnmount() {
    window.removeEventListener('error', this.handleWindowError);
    window.removeEventListener('unhandledrejection', this.handleUnhandledRejection);
    this.unregisterDevtoolsCommands();
  }

  registerDevtoolsCommands = () => {
    if (!isDev) return;

    this.devtoolsTriggerCommand = (message = 'Manual DevTools crash test') => {
      this.triggerFatal(
        'manual-test',
        new Error(String(message)),
        'Triggered via window.paletheaTestErrorUi(message)'
      );
    };
    this.devtoolsResetCommand = () => {
      this.setState({
        hasError: false,
        source: null,
        error: null,
        details: null,
        timestamp: null
      });
    };

    window.paletheaTestErrorUi = this.devtoolsTriggerCommand;
    window.paletheaResetErrorUi = this.devtoolsResetCommand;
  };

  unregisterDevtoolsCommands = () => {
    if (!isDev) return;
    if (window.paletheaTestErrorUi === this.devtoolsTriggerCommand) {
      delete window.paletheaTestErrorUi;
    }
    if (window.paletheaResetErrorUi === this.devtoolsResetCommand) {
      delete window.paletheaResetErrorUi;
    }
  };

  triggerFatal = (source, rawError, details = '') => {
    const error = normalizeError(rawError);
    this.setState((prev) => ({
      hasError: true,
      source,
      error,
      details: prev.details || details || null,
      timestamp: prev.timestamp || Date.now()
    }));
    this.logFatalError(source, error, details);
  };

  logFatalError = (source, error, details = '') => {
    const msg = [
      `[UI Fatal] source=${source}`,
      error?.name ? `name=${error.name}` : '',
      error?.message ? `message=${error.message}` : '',
      details ? `details=${details}` : ''
    ].filter(Boolean).join(' | ');

    invoke('log_event', { level: 'error', message: msg }).catch(() => {});
  };

  handleReload = () => {
    window.location.reload();
  };

  render() {
    if (!this.state.hasError) {
      return this.props.children;
    }

    const errorName = this.state.error?.name || 'Error';
    const errorMessage = this.state.error?.message || 'Unknown error';
    const when = this.state.timestamp ? new Date(this.state.timestamp).toLocaleTimeString() : null;

    return (
      <div className="app-crash-screen">
        <div className="app-crash-card">
          <div className="app-crash-header">
            <AlertTriangle size={26} className="app-crash-header-icon" />
            <div className="app-crash-header-text">
              <h1>Something went wrong</h1>
              <p className="app-crash-subtitle">
                Palethea hit an unexpected error. Your instances and files are safe.
              </p>
            </div>
          </div>
          <p className="app-crash-body">
            Reload the launcher to continue.
          </p>
          <div className="app-crash-actions">
            <button className="app-crash-reload-btn" onClick={this.handleReload}>
              <RotateCcw size={16} />
              <span>Reload Launcher</span>
            </button>
          </div>

          {(isDev || this.state.source) && (
            <div className="app-crash-meta">
              <div className="app-crash-meta-row">
                <span>Source</span>
                <code>{this.state.source || 'unknown'}</code>
              </div>
              <div className="app-crash-meta-row">
                <span>Error</span>
                <code>{errorName}: {errorMessage}</code>
              </div>
              {when && (
                <div className="app-crash-meta-row">
                  <span>Time</span>
                  <code>{when}</code>
                </div>
              )}
            </div>
          )}

          {isDev && this.state.details && (
            <pre className="app-crash-stack">{this.state.details}</pre>
          )}
        </div>
      </div>
    );
  }
}

export default AppErrorBoundary;
