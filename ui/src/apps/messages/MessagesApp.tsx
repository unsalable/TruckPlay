// Mesajlar: the road told as a conversation with dispatch — every fine, toll and delivery arrives
// as a message, newest at the bottom, like a thread on the phone.

import { useEffect, useRef } from 'react';
import { AppScaffold, Empty } from '../../components/AppScaffold';
import { Message } from '../../icons/glyphs';
import { useStore } from '../../state/store';
import { eventLog } from '../../state/events';
import { clock, dayShort } from '../../state/format';
import { useT } from '../../state/i18n';
import { useDragScroll } from '../../components/useDragScroll';
import './messages.css';

export function MessagesApp() {
  const t = useT();
  const log = useStore(eventLog, l => l, (a, b) => a === b);
  const list = useRef<HTMLDivElement>(null);
  useDragScroll(list);
  useEffect(() => {
    list.current?.scrollTo({ top: list.current.scrollHeight });
  }, [log.length]);
  const thread = [...log].reverse();

  return (
    <AppScaffold title={t('messages.dispatch')} scroll={false}>
      {thread.length === 0 ? (
        <Empty glyph={<Message />} title={t('messages.empty')} hint={t('messages.emptyHint')} />
      ) : (
        <div className="thread" ref={list}>
          {thread.map((e, i) => {
            const prev = thread[i - 1];
            const showTime = !prev || e.gameTime - prev.gameTime > 30;
            return (
              <div key={e.id} className="thread__item">
                {showTime && e.gameTime > 0 && (
                  <span className="thread__time tabular">
                    {dayShort(e.gameTime)} {clock(e.gameTime)}
                  </span>
                )}
                <div className="bubble">
                  <b>{e.title}</b>
                  <span>{e.body}</span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </AppScaffold>
  );
}
