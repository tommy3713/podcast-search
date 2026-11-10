import type { AskEvent } from './agent.ts';
import { citedOrder, parseAnswer } from './render.ts';

// Follows the events sent to the browser, so the log holds what the user actually saw:
// the final answer (text before a `reset` was a draft) and the sources it cites, counted
// with the same rules the page uses to render them
export class AnswerRecorder {
  text = '';
  private known = new Set<number>();

  see(e: AskEvent): void {
    if (e.type === 'sources') for (const s of e.sources) this.known.add(s.n);
    else if (e.type === 'delta') this.text += e.text;
    else if (e.type === 'reset') this.text = '';
  }

  // The numbers of the sources the final answer cites, in the order it first cites them
  citedNumbers(): number[] {
    return citedOrder(parseAnswer(this.text, this.known));
  }

  cited(): number {
    return this.citedNumbers().length;
  }
}
