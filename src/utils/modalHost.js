export function resolveModalHost() {
  if (typeof document === 'undefined') {
    return null;
  }

  const activeMainContent = document.activeElement?.closest?.('.main-content');
  const editorMainContent = document.querySelector('.instance-editor')?.closest?.('.main-content');
  const sidebarLayoutMainContent = document.querySelector('.app-main-layout.with-sidebar > .main-content');
  const popoutMainContent = document.querySelector('.app-main-layout > .main-content');

  return (
    activeMainContent
    || editorMainContent
    || sidebarLayoutMainContent
    || popoutMainContent
    || document.querySelector('.instance-editor')
    || document.body
  );
}
