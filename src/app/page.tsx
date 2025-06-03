import MapContainer from '@/components/MapContainer';

export default function Home() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-between">
      <div className="w-full h-screen">
        <MapContainer />
      </div>
    </main>
  );
} 