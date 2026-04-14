'use client';

import { useState } from 'react';
import { Input, Button } from '@nextui-org/react';
import { fetchWithAuth } from '@/utils/fetchWithAuth';
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
import type { Source } from '@/features/askSlice';

type StockAskStatus = 'idle' | 'loading' | 'streaming' | 'succeeded' | 'failed' | 'unauthenticated' | 'rate_limited';

export default function AskPage() {
  const dispatch = useDispatch<AppDispatch>();
  const { question, answer, sources, status } = useSelector(
    (state: RootState) => state.ask
  );

  const [mode, setMode] = useState<'ask' | 'stock'>('ask');

  // Stock ask local state
  const [ticker, setTicker] = useState('');
  const [stockAnswer, setStockAnswer] = useState('');
  const [stockSources, setStockSources] = useState<Source[]>([]);
  const [stockStatus, setStockStatus] = useState<StockAskStatus>('idle');

  const isLoading = status === 'loading' || status === 'streaming';
  const isStockLoading = stockStatus === 'loading' || stockStatus === 'streaming';

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

  const handleStockAsk = async () => {
    if (!ticker.trim() || isStockLoading) return;

    setStockAnswer('');
    setStockSources([]);
    setStockStatus('loading');

    try {
      const res = await fetchWithAuth(
        `${process.env.NEXT_PUBLIC_BACKEND_URL}/api/stock/ask`,
        {
          method: 'POST',
          body: JSON.stringify({ ticker: ticker.trim() }),
        }
      );

      if (!res.ok) {
        setStockStatus(res.status === 429 ? 'rate_limited' : 'failed');
        return;
      }

      setStockStatus('streaming');
      const reader = res.body?.getReader();
      const decoder = new TextDecoder();

      if (!reader) {
        setStockStatus('failed');
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
            setStockStatus('succeeded');
            return;
          }
          try {
            const parsed = JSON.parse(data);
            if (parsed.sources) {
              setStockSources(parsed.sources);
            } else if (parsed.content) {
              setStockAnswer((prev) => prev + parsed.content);
            }
          } catch {}
        }
      }
      setStockStatus('succeeded');
    } catch (err) {
      setStockStatus((err as Error).message === '尚未登入' ? 'unauthenticated' : 'failed');
    }
  };

  return (
    <div className="flex flex-col items-center px-4 py-6 pb-24 md:px-6 md:py-8">
      <div className="w-full max-w-2xl flex flex-col gap-5">
        {/* Mode tabs */}
        <div className="flex gap-1 bg-[#f0efe8] rounded-lg p-1 w-fit">
          <button
            onClick={() => setMode('ask')}
            className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors ${
              mode === 'ask'
                ? 'bg-white text-gray-800 shadow-sm'
                : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            一般提問
          </button>
          <button
            onClick={() => setMode('stock')}
            className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors ${
              mode === 'stock'
                ? 'bg-white text-gray-800 shadow-sm'
                : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            查股票
          </button>
        </div>

        {/* ── 一般提問 mode ── */}
        {mode === 'ask' && (
          <>
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

            {status === 'unauthenticated' && (
              <p className="text-red-500 text-sm">請先登入才能使用此功能。</p>
            )}
            {status === 'rate_limited' && (
              <p className="text-red-500 text-sm">每日提問次數已達上限（20 次），請明天再試。</p>
            )}
            {status === 'failed' && (
              <p className="text-red-500 text-sm">發生錯誤，請稍後再試。</p>
            )}

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
          </>
        )}

        {/* ── 查股票 mode ── */}
        {mode === 'stock' && (
          <>
            <div className="flex flex-col sm:flex-row items-stretch gap-2 sm:items-center">
              <Input
                label="股票代號"
                placeholder="例如：NVDA、2330、TSLA"
                className="flex-grow"
                radius="lg"
                value={ticker}
                onKeyDown={(e) => e.key === 'Enter' && !e.nativeEvent.isComposing && handleStockAsk()}
                onChange={(e) => setTicker(e.target.value)}
                isDisabled={isStockLoading}
                isClearable
              />
              <Button
                onClick={handleStockAsk}
                isLoading={isStockLoading}
                isDisabled={!ticker.trim() || isStockLoading}
                className="bg-blue-500 text-white hover:bg-blue-600"
                radius="lg"
              >
                查詢
              </Button>
            </div>

            {stockStatus === 'unauthenticated' && (
              <p className="text-red-500 text-sm">請先登入才能使用此功能。</p>
            )}
            {stockStatus === 'rate_limited' && (
              <p className="text-red-500 text-sm">每日提問次數已達上限（20 次），請明天再試。</p>
            )}
            {stockStatus === 'failed' && (
              <p className="text-red-500 text-sm">發生錯誤，請稍後再試。</p>
            )}

            {stockAnswer && (
              <div>
                <p className="text-xs uppercase text-[#aaa] mb-2 tracking-wide">觀點時間軸</p>
                <div className="bg-white border border-[#e8e6dd] rounded-lg px-4 py-3 text-sm text-gray-800 leading-relaxed whitespace-pre-wrap">
                  {stockAnswer}
                  {stockStatus === 'streaming' && (
                    <span className="inline-block w-0.5 h-4 bg-gray-500 ml-0.5 animate-pulse align-middle" />
                  )}
                </div>
              </div>
            )}

            {stockSources.length > 0 && (
              <div>
                <p className="text-xs uppercase text-[#aaa] mb-2 tracking-wide">相關集數</p>
                <div className="flex flex-col gap-2">
                  {stockSources.map((src) => (
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
          </>
        )}
      </div>
    </div>
  );
}
