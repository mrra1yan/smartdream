import Link from "next/link";

export default function NotFound() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-background px-4 text-center">
      <h1 className="text-4xl font-bold tracking-tight text-foreground sm:text-5xl">404</h1>
      <p className="mt-4 text-lg text-muted-foreground">Page not found.</p>
      <div className="mt-6">
        <Link
          href="/"
          className="inline-flex items-center rounded-md bg-neutral-900 text-white px-4 py-2 text-sm font-semibold shadow hover:bg-neutral-800 focus:outline-none"
        >
          Go back home
        </Link>
      </div>
    </div>
  );
}
