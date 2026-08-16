import tourData from '../../data/tour.json';
import { escapeHtml } from '../facts/badge';
import { notAFact as n } from '../facts/discipline';

/**
 * The first-run guided tour.
 *
 * ## Data-driven, and why that is not merely tidy
 *
 * Steps live in `data/tour.json`. A tour hardcoded in a component silently
 * stops covering the app the first time someone adds a surface without
 * remembering the tour exists — and the person who notices is a new user, who
 * has no way to know the tour is wrong rather than the app.
 *
 * **Every step names the selector it points at**, and a browser test asserts
 * each one resolves against the real UI. That is what makes the tour checkable
 * rather than a second description of the app, free to drift from it.
 *
 * ## Reduced motion is honoured, not approximated
 *
 * `prefers-reduced-motion` removes the transition entirely rather than
 * shortening it. A 60ms animation is still an animation.
 */

export interface TourStep {
  id: string;
  title: string;
  selector: string;
  requiresSelection: boolean;
  body: string;
}

export const TOUR_STEPS = (tourData as { steps: TourStep[] }).steps;
export const TOUR_SEEN_KEY = 'worldpulse.tour.seen.v1';

/** Exported so the browser test can drive the same list the UI renders. */
export function tourSteps(): TourStep[] {
  return TOUR_STEPS;
}

let current = 0;
let root: HTMLElement | null = null;

function reducedMotion(): boolean {
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function render(): void {
  if (!root) return;
  const step = TOUR_STEPS[current];
  if (!step) return;

  root.innerHTML = `
    <div class="tour-scrim" data-tour-scrim></div>
    <div class="tour-card${reducedMotion() ? ' tour-card--still' : ''}" role="dialog"
      aria-modal="true" aria-labelledby="tour-title">
      <div class="tour-progress">Step
        ${n(current + 1, 'position in the tour, a UI state rather than a value from any source')}
        of ${n(TOUR_STEPS.length, 'number of steps declared in the tour data file')}</div>
      <h2 class="tour-title" id="tour-title">${escapeHtml(step.title)}</h2>
      <p class="tour-body">${escapeHtml(step.body)}</p>
      <div class="tour-actions">
        <button type="button" class="tour-skip" data-tour-skip>Skip the tour</button>
        <button type="button" class="tour-back" data-tour-back
          ${current === 0 ? 'disabled' : ''}>Back</button>
        <button type="button" class="tour-next" data-tour-next>
          ${current === TOUR_STEPS.length - 1 ? 'Done' : 'Next'}</button>
      </div>
    </div>`;

  root.hidden = false;
  root.querySelector<HTMLElement>('.tour-next')?.focus();
}

function close(): void {
  if (!root) return;
  root.hidden = true;
  root.innerHTML = '';
  try {
    localStorage.setItem(TOUR_SEEN_KEY, '1');
  } catch {
    // A browser refusing storage is not a reason to fail — the tour simply
    // shows again next time, which is a smaller harm than an exception on load.
  }
}

export function startTour(): void {
  current = 0;
  render();
}

export function mountTour(container: HTMLElement, launcher: HTMLElement): void {
  root = container;
  root.hidden = true;

  container.addEventListener('click', (event) => {
    const target = event.target as HTMLElement;
    if (target.closest('[data-tour-skip]') || target.closest('[data-tour-scrim]')) {
      close();
      return;
    }
    if (target.closest('[data-tour-back]')) {
      current = Math.max(0, current - 1);
      render();
      return;
    }
    if (target.closest('[data-tour-next]')) {
      if (current >= TOUR_STEPS.length - 1) close();
      else {
        current += 1;
        render();
      }
    }
  });

  /**
   * Escape closes, and arrow keys move. Skippable "at every step" means from
   * the keyboard too — a modal that can only be dismissed by finding a small
   * button is not skippable for everyone.
   */
  container.addEventListener('keydown', (event) => {
    if (root?.hidden) return;
    if (event.key === 'Escape') close();
    if (event.key === 'ArrowRight' && current < TOUR_STEPS.length - 1) {
      current += 1;
      render();
    }
    if (event.key === 'ArrowLeft' && current > 0) {
      current -= 1;
      render();
    }
  });

  launcher.addEventListener('click', () => startTour());

  /**
   * Shows once. A storage failure means it shows again rather than throwing —
   * the tour is not important enough to break a page load over.
   */
  let seen = true;
  try {
    seen = localStorage.getItem(TOUR_SEEN_KEY) === '1';
  } catch {
    seen = false;
  }
  if (!seen) startTour();
}
