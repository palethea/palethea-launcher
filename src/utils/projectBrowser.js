export function matchesSelectedCategories(project, selectedCategories) {
  if (!selectedCategories || selectedCategories.length === 0) return true;
  const categories = project?.categories || project?.display_categories || [];
  return selectedCategories.every((cat) => categories.includes(cat));
}

export function findInstalledProject(installedList, project, options = {}) {
  if (!installedList || installedList.length === 0 || !project) return null;

  const { normalized = false } = options;
  const projectId = project.project_id || project.id || project.slug;

  if (projectId) {
    const byId = installedList.find((item) => item.project_id === projectId);
    if (byId) return byId;
  }

  if (normalized) {
    const normalizedSlug = (project.slug || '')
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '');
    const normalizedTitle = (project.title || project.name || '')
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '');

    return installedList.find((item) => {
      const normalizedFilename = (item.filename || '')
        .toLowerCase()
        .replace(/[^a-z0-9]/g, '');
      const normalizedName = (item.name || '')
        .toLowerCase()
        .replace(/[^a-z0-9]/g, '');
      return (
        (normalizedSlug &&
          (normalizedFilename.includes(normalizedSlug) ||
            normalizedName.includes(normalizedSlug))) ||
        (normalizedTitle &&
          (normalizedFilename.includes(normalizedTitle) ||
            normalizedName.includes(normalizedTitle)))
      );
    });
  }

  const searchTitle = (project.title || project.name || '').toLowerCase().trim();
  const searchSlug = (project.slug || '').toLowerCase().trim();

  return installedList.find((item) => {
    const itemTitle = (item.name || '').toLowerCase().trim();
    const itemFilename = (item.filename || '').toLowerCase().trim();
    return (
      (searchTitle &&
        (itemTitle === searchTitle || itemFilename.includes(searchTitle))) ||
      (searchSlug &&
        (itemFilename.includes(searchSlug) || itemTitle.includes(searchSlug)))
    );
  });
}

