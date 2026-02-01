export function LibraryHeader() {
  return (
    <div className="relative">
      {/* Quick gradient fade - yellow to purple */}
      <div className="absolute inset-0 pointer-events-none">
        <div
          className="absolute inset-0 bg-gradient-to-b from-brand/15 via-ai/10 to-transparent"
          style={{ height: "35vh" }}
        />
        <div
          className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_right,var(--tw-gradient-stops))] from-brand/8 via-transparent to-transparent"
          style={{ height: "25vh" }}
        />
      </div>

      {/* Compact header */}
      <div className="relative px-4 md:px-8 pt-6 pb-2">
        <h1 className="text-2xl font-bold text-white">
          Your Library
        </h1>
      </div>
    </div>
  );
}
