document.addEventListener('alpine:init', () => {
  const tabs = ['skills', 'rules', 'personas', 'audit', 'settings'];
  const CRITICAL_CONFIRMATION_TOKEN = 'CONFIRMAR';
  const MAX_ACTIVE_PERSONAS = 3;

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
    pendingCriticalId: null,
    criticalConfirmInput: '',
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
    isCriticalRule(item) {
      return item && item.type === 'rule' && item.critical === true;
    },
    isPersona(item) {
      return item && item.type === 'persona';
    },
    personaIds() {
      return new Set(this.items.filter((item) => this.isPersona(item)).map((item) => item.id));
    },
    activePersonaCount() {
      const personaIds = this.personaIds();
      return this.activeIds.filter((id) => personaIds.has(id)).length;
    },
    isAtPersonaCap() {
      return this.activePersonaCount() >= MAX_ACTIVE_PERSONAS;
    },
    shouldBlockForPersonaCap(item) {
      if (!item || !this.isPersona(item)) return false;
      if (this.isActive(item.id)) return false; // deactivating always allowed
      return this.isAtPersonaCap();
    },
    toggleItem(item) {
      if (!item) return null;
      if (this.shouldBlockForPersonaCap(item)) return null;
      const currentlyActive = this.isActive(item.id);
      // Deactivating a critical Rule always requires the CONFIRMAR modal.
      if (currentlyActive && this.isCriticalRule(item)) {
        this.startCriticalToggle(item.id);
        return null;
      }
      return { itemId: item.id, action: currentlyActive ? 'off' : 'on', critical_confirm: undefined };
    },
    startCriticalToggle(itemId) {
      this.pendingCriticalId = itemId;
      this.criticalConfirmInput = '';
    },
    cancelCriticalToggle() {
      this.pendingCriticalId = null;
      this.criticalConfirmInput = '';
    },
    criticalConfirmMatches() {
      return this.criticalConfirmInput === CRITICAL_CONFIRMATION_TOKEN;
    },
    confirmCriticalToggle() {
      if (!this.pendingCriticalId || !this.criticalConfirmMatches()) return null;
      const itemId = this.pendingCriticalId;
      this.pendingCriticalId = null;
      this.criticalConfirmInput = '';
      return { itemId, action: 'off', critical_confirm: CRITICAL_CONFIRMATION_TOKEN };
    },
    displayTitle(item) {
      return catalogDisplayTitle(item);
    },
    displayMeta(item) {
      return describeCatalogMeta(item);
    },
  }));
});
