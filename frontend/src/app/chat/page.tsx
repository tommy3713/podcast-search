'use client';

import { useRef, useEffect, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import Link from 'next/link';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { fetchWithAuth } from '@/utils/fetchWithAuth';
import { AppDispatch, RootState } from '@/app/store';
import {
  setInput,
  addUserMessage,
  startAssistantMessage,
  appendToLastMessage,
  setLastMessageSources,
  finalizeLastMessage,
  setStatus,
  clearChat,
  Message,
  Source,
} from '@/features/chatSlice';

function SourcesPanel({ sources }: { sources: Source[] }) {
  const [open, setOpen] = useState(false);
  if (!sources.length) return null;
  return (
    <div className="mt-2">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1 text-xs text-[#aaa] hover:text-gray-600 transition-colors"
      >
        {open ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
        {sources.length} 個來源
      </button>
      {open && (
        <div className="mt-1 flex flex-col gap-1">
          {sources.map((src) => (
            <Link
              key={`${src.podcaster}-${src.episode}`}
              href={`/summary/${src.podcaster}/${src.episode}`}
              className="bg-gray-50 border border-[#e8e6dd] rounded px-3 py-2 flex items-center gap-x-3 hover:border-[#b8b6ac] transition-colors"
            >
              <span className="font-medium text-gray-800 w-10 shrink-0 text-xs">
                {src.episode}
              </span>
              <p className="flex-1 text-xs text-gray-600 truncate">{src.title}</p>
              <span className="text-[#c4c2b8] shrink-0">›</span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

function MessageBubble({ msg }: { msg: Message }) {
  const isUser = msg.role === 'user';
  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div
        className={`max-w-[85%] ${
          isUser
            ? 'bg-blue-500 text-white'
            : 'bg-white border border-[#e8e6dd] text-gray-800'
        } rounded-2xl px-4 py-3 text-sm leading-relaxed`}
      >
        <p className="whitespace-pre-wrap">
          {msg.content}
          {msg.isStreaming && (
            <span className="inline-block w-0.5 h-4 bg-current ml-0.5 animate-pulse align-middle opacity-60" />
          )}
        </p>
        {!isUser && msg.sources && !msg.isStreaming && (
          <SourcesPanel sources={msg.sources} />
        )}
      </div>
    </div>
  );
}

export default function ChatPage() {
  const dispatch = useDispatch<AppDispatch>();
  const { messages, input, status } = useSelector(
    (state: RootState) => state.chat
  );
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const isLoading = status === 'loading' || status === 'streaming';

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length, messages[messages.length - 1]?.content]);

  const handleSend = async () => {
    if (!input.trim() || isLoading) return;

    const question = input.trim();
    dispatch(setInput(''));
    dispatch(addUserMessage(question));
    dispatch(setStatus('loading'));

    // Build history from completed messages, cap at 12 items (6 turns)
    const history = messages
      .filter((m) => !m.isStreaming)
      .slice(-12)
      .map(({ role, content }) => ({ role, content }));

    try {
      const res = await fetchWithAuth(
        `${process.env.NEXT_PUBLIC_BACKEND_URL}/api/chat`,
        {
          method: 'POST',
          body: JSON.stringify({ question, messages: history }),
        }
      );

      if (!res.ok) {
        if (res.status === 429) {
          dispatch(setStatus('rate_limited'));
        } else if (res.status === 401) {
          dispatch(setStatus('unauthenticated'));
        } else {
          dispatch(setStatus('failed'));
        }
        return;
      }

      dispatch(startAssistantMessage());

      const reader = res.body?.getReader();
      const decoder = new TextDecoder();
      if (!reader) {
        dispatch(setStatus('failed'));
        return;
      }

      let buffer = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const data = line.slice(6).trim();
          if (data === '[DONE]') {
            dispatch(finalizeLastMessage());
            dispatch(setStatus('succeeded'));
            return;
          }
          try {
            const parsed = JSON.parse(data);
            if (parsed.sources) dispatch(setLastMessageSources(parsed.sources));
            else if (parsed.content) dispatch(appendToLastMessage(parsed.content));
            else if (parsed.error) dispatch(setStatus('failed'));
          } catch {}
        }
      }
      dispatch(finalizeLastMessage());
      dispatch(setStatus('succeeded'));
    } catch (err) {
      dispatch(
        setStatus(
          (err as Error).message === '尚未登入' ? 'unauthenticated' : 'failed'
        )
      );
    }
  };

  return (
    <div className="flex flex-col h-full max-w-2xl mx-auto">
      {/* Page header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-[#e8e6dd] bg-white sticky top-0 z-10">
        <h1 className="text-base font-semibold text-gray-900">和股癌聊聊</h1>
        {messages.length > 0 && (
          <button
            onClick={() => dispatch(clearChat())}
            className="text-xs text-[#c4c2b8] hover:text-gray-500 transition-colors"
          >
            清除對話
          </button>
        )}
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-4 pb-32 flex flex-col gap-3">
        {messages.length === 0 && (
          <div className="flex-1 flex flex-col items-center justify-center text-center py-16 gap-2">
            <p className="text-2xl">🎙️</p>
            <p className="text-gray-500 text-sm">
              有什麼想問股癌的？
              <br />
              投資觀點、市場分析、生活哲學都可以。
            </p>
          </div>
        )}
        {messages.map((msg, i) => (
          <MessageBubble key={i} msg={msg} />
        ))}
        <div ref={messagesEndRef} />
      </div>

      {/* Status messages */}
      <div className="fixed bottom-20 left-0 right-0 flex justify-center pointer-events-none z-20">
        {status === 'unauthenticated' && (
          <p className="text-red-500 text-xs bg-white px-3 py-1 rounded-full shadow">
            請先登入才能使用此功能。
          </p>
        )}
        {status === 'rate_limited' && (
          <p className="text-red-500 text-xs bg-white px-3 py-1 rounded-full shadow">
            每日對話次數已達上限（30 次），請明天再試。
          </p>
        )}
        {status === 'failed' && (
          <p className="text-red-500 text-xs bg-white px-3 py-1 rounded-full shadow">
            發生錯誤，請稍後再試。
          </p>
        )}
      </div>

      {/* Input bar — sits above mobile bottom nav (h-14), at page bottom on desktop */}
      <div className="fixed bottom-14 left-0 right-0 sm:bottom-0 bg-white border-t border-[#e8e6dd] px-4 py-3 flex gap-2">
        <input
          type="text"
          placeholder="問股癌任何問題..."
          className="flex-1 border border-gray-200 rounded-xl px-4 py-2 text-sm outline-none focus:border-blue-400 transition-colors disabled:opacity-50"
          value={input}
          onChange={(e) => dispatch(setInput(e.target.value))}
          onKeyDown={(e) =>
            e.key === 'Enter' && !e.nativeEvent.isComposing && handleSend()
          }
          disabled={isLoading}
        />
        <button
          onClick={handleSend}
          disabled={!input.trim() || isLoading}
          className="bg-blue-500 text-white rounded-xl px-4 py-2 text-sm font-medium hover:bg-blue-600 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          {isLoading ? '...' : '送出'}
        </button>
      </div>
    </div>
  );
}
