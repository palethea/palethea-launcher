const YOUTUBE_HOSTS = new Set([
  'youtube.com',
  'www.youtube.com',
  'm.youtube.com',
  'youtu.be',
  'youtube-nocookie.com',
  'www.youtube-nocookie.com',
  'img.youtube.com',
  'i.ytimg.com'
]);

const VIMEO_HOSTS = new Set([
  'vimeo.com',
  'www.vimeo.com',
  'player.vimeo.com'
]);

const VIDEO_FILE_EXT_RE = /\.(mp4|webm|ogg|mov|m4v)(?:$|[?#])/i;
const IMAGE_FILE_EXT_RE = /\.(avif|webp|png|jpe?g|gif|bmp|svg)(?:$|[?#])/i;

function parseUrl(raw) {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;

  const normalized = trimmed.startsWith('//') ? `https:${trimmed}` : trimmed;
  try {
    return new URL(normalized);
  } catch {
    return null;
  }
}

function isHttps(url) {
  return Boolean(url && url.protocol === 'https:');
}

function toEmbedUrl(rawSrc) {
  const url = parseUrl(rawSrc);
  if (!isHttps(url)) return null;

  const host = url.hostname.toLowerCase();
  if (YOUTUBE_HOSTS.has(host)) {
    if (host === 'img.youtube.com' || host === 'i.ytimg.com') {
      const parts = url.pathname.split('/').filter(Boolean);
      // Typical thumbnail paths:
      // /vi/<id>/maxresdefault.jpg
      // /vi_webp/<id>/maxresdefault.webp
      const viIndex = parts.findIndex((part) => part === 'vi' || part === 'vi_webp');
      const videoId = viIndex >= 0 ? parts[viIndex + 1] : null;
      return videoId ? `https://www.youtube.com/embed/${videoId}` : null;
    }
    if (host === 'youtu.be') {
      const videoId = url.pathname.split('/').filter(Boolean)[0];
      return videoId ? `https://www.youtube.com/embed/${videoId}` : null;
    }
    if (url.pathname === '/watch') {
      const videoId = url.searchParams.get('v');
      return videoId ? `https://www.youtube.com/embed/${videoId}` : null;
    }
    if (url.pathname.startsWith('/embed/')) {
      return url.toString();
    }
    return null;
  }

  if (VIMEO_HOSTS.has(host)) {
    if (host === 'player.vimeo.com') {
      return url.pathname.startsWith('/video/') ? url.toString() : null;
    }
    const videoId = url.pathname.split('/').filter(Boolean)[0];
    return /^\d+$/.test(videoId || '') ? `https://player.vimeo.com/video/${videoId}` : null;
  }

  return null;
}

function toSafeMediaUrl(rawSrc) {
  if (typeof rawSrc !== 'string') return null;
  const trimmed = rawSrc.trim();
  if (!trimmed) return null;

  if (trimmed.startsWith('/')) return trimmed;

  const url = parseUrl(trimmed);
  if (!url) return null;
  return isHttps(url) ? url.toString() : null;
}

export function getEmbedVideoUrl(rawSrc) {
  return toEmbedUrl(rawSrc);
}

export function isVideoFileUrl(rawSrc) {
  const safe = toSafeMediaUrl(rawSrc);
  if (!safe) return false;
  return VIDEO_FILE_EXT_RE.test(safe);
}

export function isImageFileUrl(rawSrc) {
  const safe = toSafeMediaUrl(rawSrc);
  if (!safe) return false;
  return IMAGE_FILE_EXT_RE.test(safe);
}

export function renderMarkdownIframe(props) {
  const safeSrc = toEmbedUrl(props?.src);
  if (!safeSrc) {
    if (!props?.src) return null;
    return (
      <a
        className="description-embed-fallback"
        href={props.src}
        target="_blank"
        rel="noopener noreferrer"
      >
        Open embedded video
      </a>
    );
  }

  return (
    <div className="description-embed-frame">
      <iframe
        src={safeSrc}
        title={props?.title || 'Embedded video'}
        loading="lazy"
        referrerPolicy="no-referrer"
        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
        allowFullScreen
      />
    </div>
  );
}

export function renderMarkdownVideo(props) {
  const safeSrc = toSafeMediaUrl(props?.src);
  return (
    <video
      className="description-embedded-video"
      controls={props?.controls ?? true}
      preload="metadata"
      referrerPolicy="no-referrer"
      src={safeSrc || undefined}
    >
      {props?.children}
    </video>
  );
}

export function renderMarkdownSource(props) {
  const safeSrc = toSafeMediaUrl(props?.src);
  if (!safeSrc) return null;
  return <source src={safeSrc} type={props?.type} />;
}
