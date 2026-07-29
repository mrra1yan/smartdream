export default function SuperAdminLoading() {
  return (
    <div className="flex min-h-[60vh] items-center justify-center">
      <div className="flex flex-col items-center gap-4">
        <div className="h-10 w-10 animate-spin rounded-full border-3 border-accent border-t-transparent" />
        <p className="text-sm text-muted-foreground">Loading panel...</p>
      </div>
    </div>
  );
}
