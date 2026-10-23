import React, { useCallback, useEffect, useRef, useState } from 'react';
import { MessageSquare, X } from 'lucide-react';

/**
 * Confluence-style inline comments: select any text, a "comment" button pops
 * up over it, and the note is saved on the box (prisha_serve.py
 * /api/comments -> bot/data/prisha_comments.json) for the agent to read.
 * Replies the agent writes into the same file show under each comment.
 */
export interface PrishaComment {
  id: string;
  ts: string;
  quote: string;
  note: string;
  tab: string;
  section: string;
  reply?: string;
}

const API = '/api/comments';

/** The heading of the card the selection is in — tells the agent where it was. */
function sectionOf(node: Node | null): string {
  const start: HTMLElement | null = node instanceof HTMLElement ? node : node?.parentElement ?? null;
  // The expandable row the selection is in (its details included).
  const row = start?.closest('[data-comment-row]')?.getAttribute('data-comment-row') || '';
  let el = start, heading = '';
  while (el && el !== document.body) {
    const h = el.querySelector?.(':scope > h3, :scope > div > h3, :scope > h2');
    if (h && h.textContent) { heading = h.textContent.trim(); break; }
    el = el.parentElement;
  }
  return (row ? `${heading} › ${row}` : heading).slice(0, 200);
}

export const CommentLayer: React.FC<{ tab: string }> = ({ tab }) => {
  const [anchor, setAnchor] = useState<{ x: number; y: number; quote: string; section: string } | null>(null);
  const [composing, setComposing] = useState(false);
  const [note, setNote] = useState('');
  const [comments, setComments] = useState<PrishaComment[]>([]);
  const [listOpen, setListOpen] = useState(false);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const layer = useRef<HTMLDivElement>(null);

  const load = useCallback(() => {
    fetch(API).then((r) => (r.ok ? r.json() : [])).then((c) => setComments(Array.isArray(c) ? c : [])).catch(() => {});
  }, []);
  useEffect(load, [load]);

  useEffect(() => {
    const onUp = (e: MouseEvent | KeyboardEvent) => {
      if (layer.current && e.target instanceof Node && layer.current.contains(e.target)) return;
      // Let the browser finish updating the selection first.
      setTimeout(() => {
        const sel = window.getSelection();
        const quote = sel ? sel.toString().trim() : '';
        if (!sel || !quote || sel.rangeCount === 0) {
          if (!composing) setAnchor(null);
          return;
        }
        const rect = sel.getRangeAt(0).getBoundingClientRect();
        setAnchor({ x: rect.left + rect.width / 2, y: rect.top, quote: quote.slice(0, 500), section: sectionOf(sel.anchorNode) });
        setComposing(false);
        setError('');
      }, 0);
    };
    document.addEventListener('mouseup', onUp);
    document.addEventListener('keyup', onUp);
    return () => { document.removeEventListener('mouseup', onUp); document.removeEventListener('keyup', onUp); };
  }, [composing]);

  // The popup is position:fixed at the selection; scrolling moves the text away.
  useEffect(() => {
    if (!anchor || composing) return;
    const drop = () => setAnchor(null);
    window.addEventListener('scroll', drop, { passive: true });
    return () => window.removeEventListener('scroll', drop);
  }, [anchor, composing]);

  const save = async () => {
    if (!anchor || !note.trim()) return;
    try {
      const r = await fetch(API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ quote: anchor.quote, note: note.trim(), tab, section: anchor.section }),
      });
      if (!r.ok) throw new Error(String(r.status));
      setNote(''); setError(''); setComposing(false); setAnchor(null);
      window.getSelection()?.removeAllRanges();
      setStatus('נשמר'); setTimeout(() => setStatus(''), 1500);
      load();
    } catch {
      // Keep the popover and the note open so nothing typed is lost.
      setError('לא נשמר — השרת לא זמין. ההערה נשארה כאן, נסה שוב.');
    }
  };

  const remove = async (id: string) => {
    await fetch(`${API}/${encodeURIComponent(id)}`, { method: 'DELETE' }).catch(() => {});
    load();
  };

  const popW = 300;
  const left = anchor ? Math.min(Math.max(8, anchor.x - popW / 2), window.innerWidth - popW - 8) : 0;
  const top = anchor ? Math.max(8, anchor.y - (composing ? 190 : 40)) : 0;

  return (
    <div ref={layer} dir="rtl" className="text-right">
      {anchor && !composing && (
        <button
          type="button"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => setComposing(true)}
          className="fixed z-50 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800 text-white text-xs font-bold shadow-lg"
          style={{ left: anchor.x - 50, top }}
        >
          <MessageSquare size={13} /> הערה
        </button>
      )}
      {anchor && composing && (
        <div className="fixed z-50 bg-white border border-slate-200 rounded-2xl shadow-xl p-3 space-y-2" style={{ left, top, width: popW }}>
          <div className="text-[11px] text-slate-400 border-r-2 border-slate-200 pr-2 line-clamp-2">{anchor.quote}</div>
          <textarea
            autoFocus
            value={note}
            onChange={(e) => setNote(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) save(); if (e.key === 'Escape') { setComposing(false); setAnchor(null); } }}
            placeholder="הערה או שאלה…"
            className="w-full h-20 text-sm bg-slate-50 border border-slate-100 rounded-lg p-2 outline-none focus:border-slate-200 resize-none text-slate-700"
          />
          {error && <div className="text-[11px] text-red-500">{error}</div>}
          <div className="flex justify-between items-center">
            <span className="text-[10px] text-slate-400">⌘↵ לשמירה</span>
            <div className="flex gap-2">
              <button type="button" onClick={() => { setComposing(false); setAnchor(null); }} className="text-xs text-slate-400 hover:text-slate-600 px-2">ביטול</button>
              <button type="button" onClick={save} disabled={!note.trim()} className="text-xs font-bold px-3 py-1 rounded-lg bg-blue-600 text-white disabled:opacity-40">שמור</button>
            </div>
          </div>
        </div>
      )}

      <button
        type="button"
        onClick={() => setListOpen(!listOpen)}
        className="fixed z-40 bottom-4 left-4 inline-flex items-center gap-1.5 px-3 py-2 rounded-full bg-white border border-slate-200 shadow-md text-xs font-bold text-slate-600 hover:text-slate-800"
      >
        <MessageSquare size={14} /> {comments.length > 0 ? `${comments.length} הערות` : 'הערות'}
        {status && <span className="text-emerald-600 font-normal">· {status}</span>}
      </button>
      {listOpen && (
        <div className="fixed z-40 bottom-16 left-4 w-80 max-h-[60vh] overflow-y-auto bg-white border border-slate-200 rounded-2xl shadow-xl p-3 space-y-3">
          <div className="text-[11px] text-slate-400">סמן טקסט כדי להוסיף הערה. אחר כך תגיד לי בצ׳אט לקרוא אותן.</div>
          {comments.length === 0 && <div className="text-xs text-slate-400">אין הערות.</div>}
          {comments.map((c) => (
            <div key={c.id} className="border-t border-slate-100 pt-2 text-xs space-y-1">
              <div className="flex justify-between gap-2">
                <span className="text-[10px] text-slate-400">{c.section || c.tab} · {new Date(c.ts).toLocaleDateString('he-IL')}</span>
                <button type="button" onClick={() => remove(c.id)} title="מחק" className="text-slate-300 hover:text-red-500"><X size={12} /></button>
              </div>
              <div className="text-slate-400 border-r-2 border-slate-200 pr-2 line-clamp-2">{c.quote}</div>
              <div className="text-slate-700">{c.note}</div>
              {c.reply && <div className="text-slate-600 bg-blue-50 rounded-lg p-2">{c.reply}</div>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
