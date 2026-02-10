export const EMPTY_DOWNLOAD_TELEMETRY = {
  stageLabel: '',
  currentItem: '',
  speedBps: 0,
  etaSeconds: null
};

export function clampProgress(progress) {
  const value = Number(progress);
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, value));
}

export function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let index = 0;
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024;
    index += 1;
  }
  const fractionDigits = value >= 100 || index === 0 ? 0 : 1;
  return `${value.toFixed(fractionDigits)} ${units[index]}`;
}

export function formatSpeed(speedBps) {
  if (!Number.isFinite(speedBps) || speedBps <= 0) return null;
  return `${formatBytes(speedBps)}/s`;
}

export function formatEta(seconds) {
  if (!Number.isFinite(seconds) || seconds <= 0) return null;
  const total = Math.ceil(seconds);
  if (total < 60) return `${total}s`;
  const minutes = Math.floor(total / 60);
  const secs = total % 60;
  if (minutes < 60) return `${minutes}m ${secs}s`;
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return `${hours}h ${mins}m`;
}

function stripCountSuffix(text) {
  return text.replace(/\s*\(\s*\d+\s*\/\s*\d+\s*\)\s*$/, '').trim();
}

export function splitDownloadStage(stage) {
  if (typeof stage !== 'string' || !stage.trim()) {
    return { stageLabel: '', currentItem: '' };
  }

  const cleaned = stage.trim().replace(/\s+/g, ' ');
  let stageLabel = cleaned.replace(/\.\.\.$/, '').trim();
  let currentItem = '';

  const colonMatch = stageLabel.match(/^([^:]+):\s*(.+)$/);
  if (colonMatch) {
    stageLabel = stripCountSuffix(colonMatch[1].trim());
    currentItem = stripCountSuffix(colonMatch[2].trim());
    return { stageLabel, currentItem };
  }

  const directDownloadMatch = stageLabel.match(/^Downloading\s+(.+)$/i);
  if (directDownloadMatch) {
    const subject = stripCountSuffix(directDownloadMatch[1].trim());
    const aggregatePattern = /^(libraries|assets|client jar|mods?\b|modpack\b)/i;
    if (!aggregatePattern.test(subject) && !/\b\d+\s*\/\s*\d+\b/.test(subject)) {
      stageLabel = 'Downloading';
      currentItem = subject;
      return { stageLabel, currentItem };
    }
  }

  stageLabel = stripCountSuffix(stageLabel);
  return { stageLabel, currentItem };
}
