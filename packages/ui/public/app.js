document.addEventListener('alpine:init', () => {
  const tabs = ['skills', 'rules', 'personas', 'audit', 'settings'];
  const CRITICAL_CONFIRMATION_TOKEN = 'CONFIRMAR';
  const MAX_ACTIVE_PERSONAS = 3;
  const SETTINGS_FIELDS = [
    'minCosineSimilarity',
    'minFtsHits',
    'tenantId',
    'integrationMode',
    'embeddingModel',
  ];
  const SUPPORTED_INTEGRATION_MODES = ['proxy', 'hook', 'mcp', 'cli'];

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
      if (requested !== this.tab) {
        const normalizedHash = `#${this.tab}`;
        history.replaceState(null, '', normalizedHash);
        // A lightweight test harness (and a few embedded hosts) may provide a
        // replaceState shim that does not update location. Keep the URL state
        // and Alpine state synchronized in that case.
        if (window.location.hash !== normalizedHash) window.location.hash = normalizedHash;
      }
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
    errorMessage: '',
    submittingToggle: false,
    activeElementBeforeModal: null,
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
      const doc = root?.ownerDocument;
      if (doc?.addEventListener) {
        this._onKeyDown = (event) => {
          if (!this.pendingCriticalId) return;
          if (event?.key === 'Escape') {
            event.preventDefault?.();
            this.cancelCriticalToggle();
            return;
          }
          if (event?.key !== 'Tab') return;
          const modal = root?.querySelector?.('[data-catalog-critical-modal]');
          const focusable = modal?.querySelectorAll?.(
            'button, input, select, textarea, a[href], [tabindex]:not([tabindex="-1"])',
          );
          if (!focusable || focusable.length === 0) return;
          const first = focusable[0];
          const last = focusable[focusable.length - 1];
          const active = doc.activeElement;
          if ((event.shiftKey && active === first) || (!event.shiftKey && active === last)) {
            event.preventDefault?.();
            (event.shiftKey ? last : first)?.focus?.();
          }
        };
        doc.addEventListener('keydown', this._onKeyDown);
      }
    },
    destroy() {
      const doc = this.$el?.ownerDocument;
      if (doc?.removeEventListener && this._onKeyDown) {
        doc.removeEventListener('keydown', this._onKeyDown);
        this._onKeyDown = null;
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
    ensureToggleErrorRegion(message) {
      let region = this.$el?.querySelector?.('[data-catalog-request-error]') ?? null;
      if (!region && message && this.$el?.ownerDocument?.createElement && this.$el?.prepend) {
        region = this.$el.ownerDocument.createElement('p');
        region.setAttribute('data-catalog-request-error', '');
        region.setAttribute('role', 'alert');
        region.setAttribute('aria-live', 'assertive');
        region.className = 'catalog-request-error';
        this.$el.prepend(region);
      }
      return region;
    },
    setToggleError(message) {
      this.errorMessage = message;
      const region = this.ensureToggleErrorRegion(message);
      if (region) {
        region.textContent = message;
        region.hidden = !message;
      }
    },
    currentPartialPath() {
      const tabByType = { skill: 'skills', rule: 'rules', persona: 'personas' };
      const tab = tabByType[this.type];
      return tab ? `/ui/${tab}` : null;
    },
    refreshCurrentPartial() {
      const path = this.currentPartialPath();
      if (!path) return;
      window.htmx?.ajax('GET', path, {
        target: '#panel-content',
        swap: 'innerHTML',
      });
    },
    async submitToggle(request) {
      if (!request || this.submittingToggle) return null;
      this.submittingToggle = true;
      try {
        const response = await window.fetch('/state/toggle', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(request),
        });
        const payload = await response.json().catch(() => ({}));
        if (response.ok && payload?.state) {
          this.activeIds = Array.isArray(payload.state.activeCatalog)
            ? [...payload.state.activeCatalog]
            : this.activeIds;
          this.setToggleError('');
          this.refreshCurrentPartial();
          return payload.state;
        }
        const message = payload?.error?.message
          ?? `Toggle update failed (HTTP ${response.status})`;
        this.setToggleError(message);
        return null;
      } catch (error) {
        this.setToggleError(`Toggle request failed: ${error?.message ?? error}`);
        return null;
      } finally {
        this.submittingToggle = false;
      }
    },
    toggleItem(item) {
      if (!item) return null;
      if (this.shouldBlockForPersonaCap(item)) {
        this.setToggleError('Persona cap reached (3 active). Disable one persona to activate another.');
        return null;
      }
      const currentlyActive = this.isActive(item.id);
      // Deactivating a critical Rule always requires the CONFIRMAR modal.
      if (currentlyActive && this.isCriticalRule(item)) {
        this.startCriticalToggle(item.id);
        return null;
      }
      const request = { itemId: item.id, action: currentlyActive ? 'off' : 'on', critical_confirm: undefined };
      void this.submitToggle(request);
      return request;
    },
    startCriticalToggle(itemId) {
      this.activeElementBeforeModal = this.$el?.ownerDocument?.activeElement ?? null;
      this.pendingCriticalId = itemId;
      this.criticalConfirmInput = '';
      const tick = this.$nextTick?.bind(this) ?? ((fn) => Promise.resolve().then(fn));
      tick(() => {
        const input = this.$el?.querySelector?.('[data-catalog-critical-input]');
        input?.focus?.();
      });
    },
    restoreModalFocus() {
      const target = this.activeElementBeforeModal;
      this.activeElementBeforeModal = null;
      if (target && typeof target.focus === 'function') target.focus();
    },
    cancelCriticalToggle() {
      this.pendingCriticalId = null;
      this.criticalConfirmInput = '';
      this.restoreModalFocus();
    },
    criticalConfirmMatches() {
      return this.criticalConfirmInput === CRITICAL_CONFIRMATION_TOKEN;
    },
    confirmCriticalToggle() {
      if (!this.pendingCriticalId || !this.criticalConfirmMatches()) return null;
      const itemId = this.pendingCriticalId;
      this.pendingCriticalId = null;
      this.criticalConfirmInput = '';
      this.restoreModalFocus();
      const request = { itemId, action: 'off', critical_confirm: CRITICAL_CONFIRMATION_TOKEN };
      void this.submitToggle(request);
      return request;
    },
    displayTitle(item) {
      return catalogDisplayTitle(item);
    },
    displayMeta(item) {
      return describeCatalogMeta(item);
    },
  }));

  Alpine.data('settingsTab', () => ({
    statusMessage: '',
    errorMessage: '',
    submitting: false,
    init() {
      // Bind the form submission handler directly so the standard browser
      // form validation still runs before Alpine intercepts the payload.
      const root = this.$el;
      const form = root?.querySelector?.('form[data-settings-form]');
      if (form) {
        form.addEventListener('submit', (event) => {
          event.preventDefault();
          this.submit();
        });
      }
    },
    readFormPatch() {
      const root = this.$el;
      const patch = {};
      for (const key of SETTINGS_FIELDS) {
        const input = root?.querySelector?.(`[data-settings-input="${key}"]`);
        if (!input) return null;
        if (key === 'minCosineSimilarity' || key === 'minFtsHits') {
          const parsed = Number(input.value);
          if (!Number.isFinite(parsed)) return null;
          patch[key] = parsed;
        } else {
          patch[key] = String(input.value ?? '');
        }
      }
      return patch;
    },
    setStatus(message) {
      this.statusMessage = message;
      this.errorMessage = '';
    },
    setError(message) {
      this.errorMessage = message;
      this.statusMessage = '';
    },
    applyStateToForm(state) {
      const root = this.$el;
      const cosineInput = root?.querySelector?.('[data-settings-input="minCosineSimilarity"]');
      const ftsInput = root?.querySelector?.('[data-settings-input="minFtsHits"]');
      const tenantInput = root?.querySelector?.('[data-settings-input="tenantId"]');
      const integrationSelect = root?.querySelector?.('[data-settings-input="integrationMode"]');
      const embeddingInput = root?.querySelector?.('[data-settings-input="embeddingModel"]');
      if (cosineInput) cosineInput.value = String(state?.thresholds?.minCosineSimilarity ?? '');
      if (ftsInput) ftsInput.value = String(state?.thresholds?.minFtsHits ?? '');
      if (tenantInput) tenantInput.value = state?.tenantId ?? '';
      if (integrationSelect) integrationSelect.value = state?.integrationMode ?? 'proxy';
      if (embeddingInput) embeddingInput.value = state?.embeddingModel ?? '';
    },
    async submit() {
      if (this.submitting) return null;
      const patch = this.readFormPatch();
      if (!patch) {
        this.setError('Form fields must contain valid values before saving.');
        return null;
      }
      this.submitting = true;
      try {
        const response = await fetch('/state/settings', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(patch),
        });
        const payload = await response.json().catch(() => ({}));
        if (response.ok && payload?.state) {
          this.applyStateToForm(payload.state);
          this.setStatus(payload.changed ? 'Settings saved.' : 'No changes to save.');
          return payload.state;
        }
        const code = payload?.error?.code ?? 'UNKNOWN';
        const message = payload?.error?.message ?? `Settings update failed (HTTP ${response.status})`;
        if (code === 'INVALID_THRESHOLD') {
          this.setError(`Threshold out of range: ${message}`);
        } else if (code === 'UNSUPPORTED_INTEGRATION_MODE') {
          this.setError(message);
        } else if (code === 'MISSING_STRING_FIELD') {
          this.setError(`Required field is empty: ${message}`);
        } else {
          this.setError(message);
        }
        return null;
      } catch (error) {
        this.setError(`Settings request failed: ${error?.message ?? error}`);
        return null;
      } finally {
        this.submitting = false;
      }
    },
    isIntegrationModeSupported(mode) {
      return SUPPORTED_INTEGRATION_MODES.includes(mode);
    },
  }));
});
