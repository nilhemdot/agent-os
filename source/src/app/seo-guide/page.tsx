import MarkdownView from "@/components/MarkdownView";

export default function SEOGuideRoute() {
  return (
    <div className="max-w-[860px] mx-auto">
      <div className="mb-6 flex items-center justify-between flex-wrap gap-3">
        <div>
          <div className="text-[10px] uppercase tracking-[0.25em] text-[var(--fg-dimmer)] mb-1">
            AIPB · Setup Pack
          </div>
          <h1 className="text-2xl font-medium">SEO Content Pipeline</h1>
        </div>
        <a
          href="/downloads/seo-pack.zip"
          download
          className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg text-[12px] border border-[rgba(163,230,53,0.4)] bg-[rgba(163,230,53,0.12)] text-lime-300 hover:bg-[rgba(163,230,53,0.18)] transition"
        >
          ⬇ Download SEO Pack (.zip)
        </a>
      </div>
      <MarkdownView src="/api/seo-guide" />
    </div>
  );
}
