export const FIXTURE_RENDER_STATES = ['initializing', 'answering', 'painting', 'hidden', 'pending-by-fixture', 'settled', 'stalled', 'host-error', 'protocol-mismatch'];

// Tool completion precedes delivery to the frame. Two animation frames leave a paint
// opportunity after that delivery; a background tab must never claim that opportunity.
export function createFixturePaint(document, view, publish) {
  let state = 'initializing';
  let generation = 0;
  let animation;
  const update = (next = state) => {
    state = next;
    generation += 1;
    const current = generation;
    view.cancelAnimationFrame(animation);
    if (['host-error', 'protocol-mismatch'].includes(state)) { publish(state); return; }
    if (document.hidden) { publish('hidden'); return; }
    if (!['settled', 'pending-by-fixture'].includes(state)) { publish(state); return; }
    publish('painting');
    animation = view.requestAnimationFrame(() => {
      animation = view.requestAnimationFrame(() => {
        if (current === generation && !document.hidden) publish(state);
      });
    });
  };
  const visible = () => update();
  document.addEventListener('visibilitychange', visible);
  return {
    update,
    dispose() {
      generation += 1;
      view.cancelAnimationFrame(animation);
      document.removeEventListener('visibilitychange', visible);
    },
  };
}
