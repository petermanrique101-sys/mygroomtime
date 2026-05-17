export default function PublicNotFound(): JSX.Element {
  return (
    <main className="min-h-screen bg-white text-gray-900">
      <div className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center px-6 text-center">
        <h1 className="text-2xl font-semibold tracking-tight">Booking page not found</h1>
        <p className="mt-3 text-sm text-gray-600">
          Double-check the address. If you got here from a link from your groomer, ask
          them to send it again.
        </p>
      </div>
    </main>
  );
}
