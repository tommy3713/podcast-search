'use client';

import { useSession, signIn, signOut } from 'next-auth/react';
import { useState } from 'react';
import { ChevronDown } from 'lucide-react';

export default function LoginButton() {
  const { data: session } = useSession();
  const [isOpen, setIsOpen] = useState(false);

  if (session) {
    return (
      <div className="relative">
        <button
          onClick={() => setIsOpen((prev) => !prev)}
          className="flex items-center gap-2 px-4 py-2 text-sm font-medium bg-gray-100 rounded-lg hover:bg-gray-200 transition"
        >
          👋 歡迎，{session.user?.name}
          <ChevronDown size={16} />
        </button>
        {isOpen && (
          <div className="absolute right-0 w-40 bg-white border border-gray-200 rounded-lg shadow-lg z-10">
            <button
              onClick={() => signOut()}
              className="w-full text-left px-4 py-2 text-sm hover:bg-gray-100 transition"
            >
              登出
            </button>
          </div>
        )}
      </div>
    );
  }

  return (
    <button
      onClick={() => signIn('google')}
      className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 transition"
    >
      使用 Google 登入
    </button>
  );
}
