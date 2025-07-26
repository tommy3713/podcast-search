import { Spinner } from '@nextui-org/react';

export default function LoadingComponent() {
  return (
    <div className="flex justify-center items-center h-screen bg-gray-50">
      <Spinner size="lg" color="primary" />{' '}
    </div>
  );
}
