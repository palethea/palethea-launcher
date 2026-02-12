import { invoke } from '@tauri-apps/api/core';
import { open as openExternal } from '@tauri-apps/plugin-shell';

const BLOCKED_ERROR_MARKERS = [
  'CurseForge did not provide a downloadable URL',
  'Failed to resolve CurseForge download URL',
];

const isProbablyValidUrl = (value) => {
  const trimmed = String(value || '').trim();
  if (!trimmed) return false;
  return trimmed.startsWith('https://') || trimmed.startsWith('http://');
};

const normalizeErrorMessage = (error) => {
  if (typeof error === 'string') return error;
  if (error && typeof error.message === 'string') return error.message;
  return String(error ?? '');
};

const resolveCurseForgeProjectUrl = async ({ project, projectId }) => {
  const direct = String(project?.website_url || '').trim();
  if (isProbablyValidUrl(direct)) {
    return direct;
  }

  const resolvedProjectId = String(projectId || project?.project_id || project?.id || '').trim();
  if (resolvedProjectId) {
    try {
      const details = await invoke('get_curseforge_modpack', { projectId: resolvedProjectId });
      const detailsUrl = String(details?.website_url || '').trim();
      if (isProbablyValidUrl(detailsUrl)) {
        return detailsUrl;
      }
    } catch (_) {
      // Fallback below.
    }
  }

  const searchTarget = String(project?.title || project?.name || resolvedProjectId || 'minecraft').trim();
  return `https://www.curseforge.com/minecraft/search?search=${encodeURIComponent(searchTarget)}`;
};

export const isCurseForgeBlockedDownloadError = (error) => {
  const message = normalizeErrorMessage(error);
  return BLOCKED_ERROR_MARKERS.some((marker) => message.includes(marker));
};

export const maybeShowCurseForgeBlockedDownloadModal = async ({
  error,
  provider,
  project,
  projectId,
  onShowConfirm,
  onShowNotification,
}) => {
  if (String(provider || '').toLowerCase() !== 'curseforge') {
    return false;
  }
  if (!isCurseForgeBlockedDownloadError(error)) {
    return false;
  }

  const resolvedProjectId = String(projectId || project?.project_id || project?.id || '').trim();
  const projectName = String(project?.title || project?.name || resolvedProjectId || 'this project').trim();
  const projectUrl = await resolveCurseForgeProjectUrl({ project, projectId: resolvedProjectId });

  const openProjectPage = async () => {
    try {
      await openExternal(projectUrl);
    } catch (openError) {
      onShowNotification?.(`Failed to open CurseForge page: ${openError}`, 'error');
    }
  };

  const message = `${projectName} cannot be downloaded through third-party launchers for this version because the creator disabled distribution for this file.\n\nOpen the official CurseForge page to download/install it directly.`;

  if (typeof onShowConfirm === 'function') {
    onShowConfirm({
      title: 'Download Restricted by Creator',
      message,
      confirmText: 'Open on CurseForge',
      cancelText: 'Close',
      variant: 'primary',
      onConfirm: openProjectPage,
    });
  } else {
    onShowNotification?.(message, 'warning');
    await openProjectPage();
  }

  return true;
};

