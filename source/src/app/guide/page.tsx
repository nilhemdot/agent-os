import MarkdownView from "@/components/MarkdownView";

export default function GuideRoute() {
  return (
    <div className="max-w-[860px] mx-auto">
      <MarkdownView src="/api/guide" />
    </div>
  );
}
