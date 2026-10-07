// How to put the box together, step by step, for the box as it is set up: the order matters with
// press-fit tabs (a wall pressed on too early locks the next one out), and a raised floor or
// dividers change it. Shown in Help. Short sentences, one action each.
import type { BoxSettings } from './state';

export function assemblySteps(s: BoxSettings): string[] {
  const steps: string[] = [];
  const dividers = s.dividersX + s.dividersY > 0;
  const press = s.joint === 'flex' ? 'Press' : 'Glue and press';
  const floor = s.bottom === 'flush' ? 'the bottom' : 'the bottom, its tabs through the slots near the walls’ lower edges';

  if (s.style === 'drawer') {
    const many = s.drawers > 1;
    const each = many ? 'each drawer' : 'the drawer';
    // The drawer's sides and bottom tab through closed slots in its front AND joint each other
    // along their length, so the front can only go on last, onto the whole tray at once.
    steps.push(`Lay the case’s back flat, inside up. ${press} the bottom${many ? ', the shelves' : ''} and the top into it, then the two sides on from the outside.`);
    if (dividers) steps.push(`Slot ${each}’s dividers into each other and stand them in its bottom’s slots.`);
    steps.push(`${press} ${each}’s two sides onto its bottom from the outside, then its back on.`);
    steps.push('Press the front on last: the sides’ and the bottom’s tabs all go through its slots at once.');
    steps.push(`Slide ${many ? 'the drawers' : 'the drawer'} in until the front${many ? 's' : ''} meet${many ? '' : 's'} the case.`);
  } else {
    if (dividers) steps.push('Slot the dividers into each other, the cross-halvings meeting, and set them on the bottom’s slots.');
    steps.push(`${press} the front and the back onto ${floor}.`);
    if (s.style === 'hinge') {
      steps.push(`${press} one side on from the outside: its tabs go into the front and back${dividers ? ', the dividers’ ends through its slots' : ''}.`);
      steps.push('Put the lid in: its pin into that side’s round hole, its pull tab towards the front.');
      steps.push(`${press} the other side on, its hole over the lid’s other pin. Close the lid: the tab presses into the front’s recess and holds it shut.`);
    } else {
      steps.push(`${press} the two sides on from the outside: their tabs go into the front and back${dividers ? ', and the dividers’ ends through their slots' : ''}.`);
    }
    if (s.style === 'lid') steps.push('Glue the lip under the lid, centred, a sheet in from every edge. Drop the lid on: the lip finds the opening.');
  }
  if (s.joint === 'flex') steps.push('A tab that will not go home: tap it with a block of wood, never the tab’s tip. One that falls out: move Fit one step tighter and cut again.');
  else steps.push('Plain fingers hold best with a little wood glue in each joint: tape the box square while it sets.');
  return steps;
}
