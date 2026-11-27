'use strict';

(() => {
  if (!globalThis.Vue) return;
  const { createApp, h, reactive } = Vue;
  const state = reactive({ refresh: '', device: '' });
  createApp({
    render() {
      return h('p', { class: 'caption' }, [state.refresh, state.device].filter(Boolean).join(' · '));
    },
  }).mount('#refreshSummary');

  globalThis.LeafRefreshSummary = (format, device) => {
    state.refresh = {
      mono1: '黑白整图',
      e6n4: '原生六色全刷',
      e6f6: '64 色快刷',
      e6s8: '精选 256 色刷新',
      e6f8: '256 色快刷试验',
      e6q9: '512 色全刷',
    }[format] ?? '';
    state.device = device;
  };
})();
