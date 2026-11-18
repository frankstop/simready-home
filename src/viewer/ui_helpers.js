/**
 * Progressive-enhancement UI helpers aligned with Modern Web Guidance:
 * - Roving tabindex fallback for [focusgroup="toolbar wrap"]
 * - Light-dismiss fallback for <dialog closedby="any">
 * - Invoker commands fallback for command="show-modal"
 */

export function initModernWebFallbacks() {
  // 1. Focusgroup toolbar fallback when native focusgroup is unsupported
  if (!('focusGroup' in HTMLElement.prototype)) {
    for (const bar of document.querySelectorAll('[role="toolbar"][focusgroup]')) {
      const items = [...bar.querySelectorAll('button, [href], input, select, [tabindex]')];
      if (!items.length) continue;
      items.forEach((b, i) => { b.tabIndex = i === 0 ? 0 : -1; });

      bar.addEventListener('focusin', ({ target }) => {
        if (items.includes(target)) {
          items.forEach((b) => { b.tabIndex = b === target ? 0 : -1; });
        }
      });

      bar.addEventListener('keydown', (e) => {
        const vertical = bar.getAttribute('aria-orientation') === 'vertical';
        const rtl = getComputedStyle(bar).direction === 'rtl';
        const steps = vertical
          ? { ArrowDown: 1, ArrowUp: -1 }
          : { ArrowRight: rtl ? -1 : 1, ArrowLeft: rtl ? 1 : -1 };

        const current = items.indexOf(document.activeElement);
        if (current < 0) return;

        let next = -1;
        if (e.key in steps) {
          next = (current + steps[e.key] + items.length) % items.length;
        } else if (e.key === 'Home') {
          next = 0;
        } else if (e.key === 'End') {
          next = items.length - 1;
        }

        if (next >= 0) {
          e.preventDefault();
          items[next].focus();
        }
      });
    }
  }

  // 2. Invoker commands fallback for command="show-modal"
  if (!('commandForElement' in HTMLButtonElement.prototype)) {
    for (const btn of document.querySelectorAll('button[command="show-modal"][commandfor]')) {
      btn.addEventListener('click', () => {
        const target = document.getElementById(btn.getAttribute('commandfor'));
        if (target && typeof target.showModal === 'function' && !target.open) {
          target.showModal();
        }
      });
    }
  }

  // 3. <dialog closedby="any"> light-dismiss fallback (e.g. Safari)
  if (!('closedBy' in HTMLDialogElement.prototype)) {
    const outside = (e, dialog) => {
      const r = dialog.getBoundingClientRect();
      return e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom;
    };
    for (const dialog of document.querySelectorAll('dialog[closedby="any"]')) {
      let pressedOutside = false;
      dialog.addEventListener('pointerdown', (e) => {
        pressedOutside = outside(e, dialog);
      });
      dialog.addEventListener('pointerup', (e) => {
        if (pressedOutside && outside(e, dialog)) dialog.close();
      });
    }
  }
}

export function showAssetInspector(meta, placementInfo) {
  const card = document.getElementById('inspector-card');
  const titleEl = document.getElementById('insp-title');
  const badgeEl = document.getElementById('insp-badge');
  const specsEl = document.getElementById('insp-specs');
  const tagsEl = document.getElementById('insp-tags');
  const physEl = document.getElementById('insp-physics');

  titleEl.textContent = placementInfo.label || meta.asset_id;
  badgeEl.textContent = placementInfo.room || 'NVIDIA SimReady';

  const dims = meta.dimensions_m || [0, 0, 0];
  const rows = [
    ['Asset ID', meta.asset_id],
    ['Dimensions', `${dims[0].toFixed(2)} × ${dims[2].toFixed(2)} × ${dims[1].toFixed(2)} m`],
    ['Mass', meta.mass_kg != null ? `${meta.mass_kg} kg` : 'Static / Fixture'],
    ['Geometry', `${(meta.triangles || 0).toLocaleString()} tris`],
    ['Validation', meta.validation_profile || 'SimReady OpenUSD'],
    ['License', meta.license || 'CC-BY-4.0'],
  ];

  specsEl.innerHTML = '';
  for (const [k, v] of rows) {
    const dt = document.createElement('dt');
    dt.textContent = k;
    const dd = document.createElement('dd');
    dd.textContent = v;
    specsEl.append(dt, dd);
  }

  tagsEl.innerHTML = '';
  const labels = (meta.semantic_labels || []).filter((l) => !/^Q\d+$/.test(l));
  for (const lbl of labels.length ? labels : ['simready', meta.asset_type || 'prop']) {
    const span = document.createElement('span');
    span.className = 'tag-chip';
    span.textContent = lbl;
    tagsEl.append(span);
  }

  physEl.innerHTML = '';
  const pmats = meta.physics_materials || [];
  if (pmats.length) {
    for (const pm of pmats) {
      const p = document.createElement('div');
      const parts = [];
      if (pm.type) parts.push(pm.type);
      if (pm.staticFriction != null) parts.push(`μs=${pm.staticFriction}`);
      if (pm.dynamicFriction != null) parts.push(`μk=${pm.dynamicFriction}`);
      if (pm.restitution != null) parts.push(`e=${pm.restitution}`);
      if (pm.density != null) parts.push(`ρ=${pm.density}`);
      p.textContent = parts.join(' · ');
      if (p.textContent) physEl.append(p);
    }
  } else {
    physEl.textContent = 'Visual + RigidBody OpenUSD metadata';
  }

  card.hidden = false;
}
