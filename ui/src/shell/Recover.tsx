// A last line: an error while drawing must not leave the cab screen black. The screen is drawn
// afresh a moment later (the error goes to the host's log), as a phone's home screen would come back.

import { Component, type ReactNode } from 'react';

interface State {
  broken: boolean;
  /** How many times it came back: a new key mounts the whole screen again. */
  round: number;
}

export class Recover extends Component<{ children: ReactNode }, State> {
  state: State = { broken: false, round: 0 };
  private timer = 0;

  static getDerivedStateFromError(): Partial<State> {
    return { broken: true };
  }

  componentDidCatch(error: unknown) {
    console.error('UI recovered from:', error instanceof Error ? error.stack || error.message : String(error));
    window.clearTimeout(this.timer);
    this.timer = window.setTimeout(() => this.setState(s => ({ broken: false, round: s.round + 1 })), 250);
  }

  componentWillUnmount() {
    window.clearTimeout(this.timer);
  }

  render() {
    if (this.state.broken) return null;
    return (
      <div key={this.state.round} style={{ display: 'contents' }}>
        {this.props.children}
      </div>
    );
  }
}
