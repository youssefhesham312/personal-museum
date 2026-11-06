/**
 * Tour state machine.
 *
 * Keeps "can the camera move?" and "is an overlay open?" in one testable place.
 * States:
 *   idle       — menu, nothing rendered
 *   exploring  — museum visible, player input live
 *   inspecting — photo or final-message overlay open, input suspended
 */

export const TOUR_STATES = Object.freeze({
  IDLE: 'idle',
  EXPLORING: 'exploring',
  INSPECTING: 'inspecting',
});

export function createTourState() {
  let state = TOUR_STATES.IDLE;
  let activeInteraction = null;

  return {
    get state() {
      return state;
    },

    get activeInteraction() {
      return activeInteraction;
    },

    /** True only while the visitor can move the camera. */
    canMove() {
      return state === TOUR_STATES.EXPLORING;
    },

    isExploring() {
      return state === TOUR_STATES.EXPLORING;
    },

    isInspecting() {
      return state === TOUR_STATES.INSPECTING;
    },

    /** Enter the museum. Ignored if already in a tour. */
    enter() {
      if (state !== TOUR_STATES.IDLE) return false;
      state = TOUR_STATES.EXPLORING;
      return true;
    },

    /** Open an inspection overlay. Only possible while exploring. */
    inspect(interaction) {
      if (state !== TOUR_STATES.EXPLORING || !interaction) return false;
      state = TOUR_STATES.INSPECTING;
      activeInteraction = interaction;
      return true;
    },

    /** Close the overlay and resume exploring. */
    dismiss() {
      if (state !== TOUR_STATES.INSPECTING) return false;
      state = TOUR_STATES.EXPLORING;
      activeInteraction = null;
      return true;
    },

    /** Leave the museum entirely. */
    leave() {
      state = TOUR_STATES.IDLE;
      activeInteraction = null;
    },
  };
}
