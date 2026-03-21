'use client';

import { useState } from 'react';
import { Button, Spinner } from '@nextui-org/react';
import { fetchWithAuth } from '@/utlis/fetchWithAuth';

type Status = 'idle' | 'loading' | 'streaming' | 'succeeded' | 'failed' | 'unauthenticated';

export default function AskPage() {
  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState('');
  const [status, setStatus] = useState<Status>('idle');

  const handleAsk = async () => {
    if (!question.trim() || status === 'loading' || status === 'streaming') return;

    setAnswer('');
    setStatus('loading');

    try {
      const res = await fetchWithAuth(
        `${process.env.NEXT_PUBLIC_BACKEND_URL}/api/ask`,
        {
          method: 'POST',
          body: JSON.stringify({ question }),
        }
      );

      if (!res.ok) {
        setStatus('failed');
        return;
      }

      setStatus('streaming');
      const reader = res.body?.getReader();
      const decoder = new TextDecoder();

      if (!reader) {
        setStatus('failed');
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
            setStatus('succeeded');
            return;
          }
          try {
            const parsed = JSON.parse(data);
            if (parsed.content) {
              setAnswer((prev) => prev + parsed.content);
            }
          } catch {}
        }
      }
      setStatus('succeeded');
    } catch (err) {
      if ((err as Error).message === '尚未登入') {
        setStatus('unauthenticated');
      } else {
        setStatus('failed');
      }
    }
  };

  const isLoading = status === 'loading' || status === 'streaming';

  return (
    <div className="flex flex-col items-center min-h-screen bg-gray-50 pt-8 pb-24 px-4">
      <div className="w-full max-w-2xl bg-white shadow-lg rounded-lg p-6 flex flex-col gap-6">
        <h1 className="text-xl font-bold text-gray-800">🤖 Ask the Podcast</h1>

        <div className="flex gap-2">
          <input
            type="text"
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleAsk()}
            placeholder="問任何關於 podcast 的問題..."
            className="flex-1 border border-gray-300 rounded-lg px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
            disabled={isLoading}
          />
          <Button
            color="primary"
            onClick={handleAsk}
            isLoading={isLoading}
            isDisabled={!question.trim() || isLoading}
          >
            送出
          </Button>
        </div>

        {status === 'unauthenticated' && (
          <p className="text-red-500 text-sm">請先登入才能使用此功能。</p>
        )}
        {status === 'failed' && (
          <p className="text-red-500 text-sm">發生錯誤，請稍後再試。</p>
        )}

        {answer && (
          <div className="bg-gray-50 rounded-lg p-4 text-gray-800 text-sm leading-relaxed whitespace-pre-wrap">
            {answer}
            {status === 'streaming' && (
              <span className="inline-block w-0.5 h-4 bg-gray-600 ml-0.5 animate-pulse align-middle" />
            )}
          </div>
        )}
      </div>
    </div>
  );
}
