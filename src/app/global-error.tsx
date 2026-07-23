"use client";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html>
      <body>
        <div className="flex min-h-screen flex-col items-center justify-center bg-background px-4 text-center">
          <h1 className="text-4xl font-bold tracking-tight text-foreground sm:text-5xl">Something went wrong!</h1>
          <p className="mt-4 text-lg text-muted-foreground">{error.message || "An unexpected error occurred."}</p>
          <div className="mt-6">
            <button
              onClick={() => reset()}
              className="inline-flex items-center rounded-md bg-neutral-900 text-white px-4 py-2 text-sm font-semibold shadow hover:bg-neutral-800 focus:outline-none"
            >
              Try again
            </button>
          </div>
        </div>
      </body>
    </html>
  );
}
