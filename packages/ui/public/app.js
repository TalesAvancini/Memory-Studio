document.addEventListener('alpine:init', () => {
  const tabs = ['skills', 'rules', 'personas', 'audit', 'settings'];

  Alpine.data('uiPanel', () => ({
    tab: 'skills',
    init() {
      this.route();
    },
    route() {
      const requested = window.location.hash.slice(1).toLowerCase();
      this.tab = tabs.includes(requested) ? requested : 'skills';
      if (requested !== this.tab) history.replaceState(null, '', `#${this.tab}`);
      window.htmx?.ajax('GET', `/ui/${this.tab}`, {
        target: '#panel-content',
        swap: 'innerHTML',
      });
    },
  }));
});
