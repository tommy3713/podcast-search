'use client';
import { useEffect } from 'react';
import { useAppDispatch, useAppSelector } from '../app/hook';
import { fetchMessage } from '../features/helloSlice';

const Hello = () => {
  const dispatch = useAppDispatch();
  const message = useAppSelector((state) => state.hello.message);
  const status = useAppSelector((state) => state.hello.status);
  const error = useAppSelector((state) => state.hello.error);

  useEffect(() => {
    dispatch(fetchMessage());
  }, [dispatch]);

  return (
    <div>
      <h1 className="text-black">Welcome to Next.js with Redux!</h1>
      <h2 className="text-black">Status: {status}</h2>
      {status === 'succeeded' && (
        <p className="text-black">Message: {message}</p>
      )}
      {status === 'failed' && <p className="text-black">Error: {error}</p>}
    </div>
  );
};

export default Hello;
