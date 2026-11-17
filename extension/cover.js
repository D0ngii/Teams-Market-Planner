(() => {
  try {
    if (sessionStorage.getItem('teamsPlannerCover') !== '1') return;
  } catch { return; }
  const cover = document.createElement('div');
  cover.id = 'teams-planner-cover';
  cover.style.cssText = 'position:fixed;inset:0;z-index:2147483647;background:#1f1f1f';
  document.documentElement.appendChild(cover);
})();
