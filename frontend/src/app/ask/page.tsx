'use client';

import { Input, Button } from '@nextui-org/react';
import { fetchWithAuth } from '@/utlis/fetchWithAuth';
import Link from 'next/link';
import { useDispatch, useSelector } from 'react-redux';
import { AppDispatch, RootState } from '@/app/store';
import {
  setQuestion,
  startAsking,
  setStreaming,
  setSources,
  appendAnswer,
  setStatus,
} from '@/features/askSlice';

export default function AskPage() {
  const dispatch = useDispatch<AppDispatch>();
  const { question, answer, sources, status } = useSelector(
    (state: RootState) => state.ask
  );

  const isLoading = status === 'loading' || status === 'streaming';

  const handleAsk = async () => {
    if (!question.trim() || isLoading) return;

    dispatch(startAsking());

    try {
      const res = await fetchWithAuth(
        `${process.env.NEXT_PUBLIC_BACKEND_URL}/api/ask`,
        {
          method: 'POST',
          body: JSON.stringify({ question }),
        }
      );

      if (!res.ok) {
        dispatch(setStatus(res.status === 429 ? 'rate_limited' : 'failed'));
        return;
      }

      dispatch(setStreaming());
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
            dispatch(setStatus('succeeded'));
            return;
          }
          try {
            const parsed = JSON.parse(data);
            if (parsed.sources) {
              dispatch(setSources(parsed.sources));
            } else if (parsed.content) {
              dispatch(appendAnswer(parsed.content));
            }
          } catch {}
        }
      }
      dispatch(setStatus('succeeded'));
    } catch (err) {
      dispatch(setStatus((err as Error).message === '尚未登入' ? 'unauthenticated' : 'failed'));
    }
  };

  return (
    <div className="flex flex-col items-center px-4 py-6 pb-24 md:px-6 md:py-8">
      <div className="w-full max-w-2xl flex flex-col gap-5">
        <h1 className="text-xl font-bold text-gray-900">Ask the Podcast</h1>

        {/* Input */}
        <div className="flex flex-col sm:flex-row items-stretch gap-2 sm:items-center">
          <Input
            label="Ask"
            placeholder="問任何關於 podcast 的問題..."
            className="flex-grow"
            radius="lg"
            value={question}
            onKeyDown={(e) => e.key === 'Enter' && !e.nativeEvent.isComposing && handleAsk()}
            onChange={(e) => dispatch(setQuestion(e.target.value))}
            isDisabled={isLoading}
            isClearable
          />
          <Button
            onClick={handleAsk}
            isLoading={isLoading}
            isDisabled={!question.trim() || isLoading}
            className="bg-blue-500 text-white hover:bg-blue-600"
            radius="lg"
          >
            送出
          </Button>
        </div>

        {/* Error states */}
        {status === 'unauthenticated' && (
          <p className="text-red-500 text-sm">請先登入才能使用此功能。</p>
        )}
        {status === 'rate_limited' && (
          <p className="text-red-500 text-sm">每日提問次數已達上限（20 次），請明天再試。</p>
        )}
        {status === 'failed' && (
          <p className="text-red-500 text-sm">發生錯誤，請稍後再試。</p>
        )}

        {/* Answer */}
        {answer && (
          <div>
            <p className="text-xs uppercase text-[#aaa] mb-2 tracking-wide">回答</p>
            <div className="bg-white border border-[#e8e6dd] rounded-lg px-4 py-3 text-sm text-gray-800 leading-relaxed whitespace-pre-wrap">
              {answer}
              {status === 'streaming' && (
                <span className="inline-block w-0.5 h-4 bg-gray-500 ml-0.5 animate-pulse align-middle" />
              )}
            </div>
          </div>
        )}

        {/* Source cards */}
        {sources.length > 0 && (
          <div>
            <p className="text-xs uppercase text-[#aaa] mb-2 tracking-wide">來源</p>
            <div className="flex flex-col gap-2">
              {sources.map((src) => (
                <Link
                  key={`${src.podcaster}-${src.episode}`}
                  href={`/summary/${src.podcaster}/${src.episode}`}
                >
                  <div className="bg-white border border-[#e8e6dd] rounded-lg hover:border-[#b8b6ac] transition-colors px-4 py-3 flex items-center gap-x-4">
                    <span className="font-medium text-gray-800 w-10 shrink-0">
                      {src.episode}
                    </span>
                    <p className="flex-1 text-sm text-gray-800 truncate">
                      {src.title}
                    </p>
                    <span className="text-[#c4c2b8] text-lg shrink-0">›</span>
                  </div>
                </Link>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
