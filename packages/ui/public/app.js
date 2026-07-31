document.addEventListener('alpine:init', () => {
  const tabs = ['skills', 'rules', 'personas', 'audit', 'settings'];

  function describeCatalogMeta(item) {
    if (!item) return '';
    if (item.type === 'skill') return item.category ?? '';
    if (item.type === 'rule') return item.critical ? 'critical rule' : 'rule';
    if (item.type === 'persona') return item.isDefault ? 'default persona' : 'persona';
    return '';
  }

  function catalogDisplayTitle(item) {
    if (!item) return '';
    return item.type === 'skill' ? (item.title ?? item.id) : item.id;
  }

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

  Alpine.data('catalogTab', () => ({
    type: '',
    items: [],
    activeIds: [],
    query: '',
    selectedId: null,
    init() {
      const root = this.$el;
      const dataEl = root?.querySelector?.('script[data-catalog-config]');
      if (dataEl?.textContent) {
        try {
          const cfg = JSON.parse(dataEl.textContent);
          this.type = cfg.type ?? '';
          this.items = Array.isArray(cfg.items) ? cfg.items : [];
          this.activeIds = Array.isArray(cfg.activeIds) ? cfg.activeIds : [];
        } catch (error) {
          console.error('catalogTab: invalid catalog config JSON', error);
        }
      }
      if (this.selectedId && !this.items.some((item) => item.id === this.selectedId)) {
        this.selectedId = null;
      }
    },
    filtered() {
      const query = (this.query ?? '').trim().toLowerCase();
      if (!query) return this.items;
      return this.items.filter((item) => this.matches(item, query));
    },
    matches(item, query) {
      const haystack = [
        item.id ?? '',
        item.title ?? '',
        item.category ?? '',
        item.text ?? '',
      ]
        .join(' ')
        .toLowerCase();
      return haystack.includes(query);
    },
    isActive(id) {
      return this.activeIds.includes(id);
    },
    selected() {
      if (!this.selectedId) return null;
      const visible = this.filtered();
      return visible.find((item) => item.id === this.selectedId) ?? null;
    },
    select(id) {
      this.selectedId = id;
    },
    displayTitle(item) {
      return catalogDisplayTitle(item);
    },
    displayMeta(item) {
      return describeCatalogMeta(item);
    },
  }));
});
