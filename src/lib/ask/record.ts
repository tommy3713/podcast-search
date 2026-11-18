import type { AskEvent, Source } from './agent.ts';
import { citedOrder, labeledAnswer, parseAnswer } from './render.ts';

// A cited source as ask_log keeps it (sources_json): the whole passage the model read, to
// tell whether it says what the line citing it says. A chunk is about 600 characters; the
// site's questions cite a few each, so 30 days of them are a few MB (about 200 MB at the
// site-wide cap of 500 a day every day).
export type LoggedSource = Source;

// Follows the events sent to the browser, so the log holds what the user actually saw:
// the final answer (text before a `reset` was a draft) and the sources it cites, counted
// with the same rules the page uses to render them
export class AnswerRecorder {
  text = '';
  private episodes = new Map<number, number>(); // source number → episode
  private known = new Set<number>();
  private sources = new Map<number, Source>();

  see(e: AskEvent): void {
    if (e.type === 'sources') {
      for (const s of e.sources) {
        this.episodes.set(s.n, s.ep);
        this.known.add(s.n);
        this.sources.set(s.n, s);
      }
    }
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

  // The sources the final answer cites, in the order it first cites them, for ask_log
  citedSources(): LoggedSource[] {
    return this.citedNumbers().flatMap((n) => {
      const s = this.sources.get(n);
      return s ? [s] : [];
    });
  }

  // Every source the searches sent, by number (the showcase keeps some of the uncited ones)
  allSources(): Source[] {
    return [...this.sources.values()].sort((a, b) => a.n - b.n);
  }

  // The answer with each line's episode label, as the page shows it
  labeled(): string {
    return labeledAnswer(this.text, this.episodes);
  }
}
