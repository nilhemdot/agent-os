"use client";

import { useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import { motion } from "framer-motion";
import "highlight.js/styles/atom-one-dark.css";

interface Props { src: string; }

export default function MarkdownView({ src }: Props) {
  const [content, setContent] = useState<string>("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(src)
      .then((r) => r.text())
      .then((t) => { setContent(t); setLoading(false); })
      .catch(() => setLoading(false));
  }, [src]);

  if (loading) {
    return (
      <div className="panel p-8 text-center text-[var(--fg-dim)]">
        Loading guide…
      </div>
    );
  }

  // Strip leading YAML frontmatter so it doesn't render as a divider line + content.
  const cleaned = content.replace(/^---\n[\s\S]*?\n---\n/, "");

  return (
    <motion.article
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4 }}
      className="panel md:px-12 md:py-10 px-6 py-8 prose-custom max-w-none"
    >
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeHighlight]}
        components={{
          h1: (p) => <h1 className="text-[40px] md:text-[48px] font-medium tracking-tight leading-[1.05] mt-2 mb-3 bg-clip-text text-transparent bg-gradient-to-r from-[#22d3ee] via-[#a855f7] to-[#ec4899]" {...p} />,
          h2: (p) => <h2 className="text-[26px] md:text-[30px] font-medium tracking-tight mt-12 mb-3 text-[var(--fg)] border-t border-[var(--panel-border)] pt-10 first:border-0 first:pt-0 first:mt-6" {...p} />,
          h3: (p) => <h3 className="text-[18px] font-medium mt-6 mb-2 text-[var(--fg)]" {...p} />,
          p:  (p) => <p className="text-[15.5px] leading-[1.75] text-[var(--fg)] my-3" {...p} />,
          ul: (p) => <ul className="my-3 space-y-1.5 pl-1" {...p} />,
          ol: (p) => <ol className="my-3 space-y-1.5 pl-5 list-decimal marker:text-[var(--fg-dimmer)]" {...p} />,
          li: (p) => <li className="text-[15.5px] leading-[1.7] text-[var(--fg)] pl-1" {...p} />,
          strong: (p) => <strong className="font-medium text-[var(--fg)]" {...p} />,
          em: (p) => <em className="text-[var(--fg-dim)] italic" {...p} />,
          a: (p) => <a className="text-[var(--accent-cyan)] hover:underline underline-offset-2" target={p.href?.startsWith("http") ? "_blank" : undefined} rel="noopener noreferrer" {...p} />,
          hr: () => <hr className="my-10 border-0 h-px bg-gradient-to-r from-transparent via-[var(--panel-border-hot)] to-transparent" />,
          blockquote: (p) => <blockquote className="border-l-2 border-[var(--accent-violet)] pl-4 my-4 italic text-[var(--fg-dim)]" {...p} />,
          code: ({ className, children, ...rest }) => {
            const isBlock = className?.includes("language-");
            if (isBlock) {
              return (
                <code className={`${className} text-[13px] leading-relaxed`} {...rest}>
                  {children}
                </code>
              );
            }
            return (
              <code
                className="px-1.5 py-0.5 rounded-md text-[13.5px] bg-[rgba(168,85,247,0.12)] border border-[rgba(168,85,247,0.25)] text-[#e9d5ff] font-[var(--font-geist-mono)]"
                {...rest}
              >
                {children}
              </code>
            );
          },
          pre: (p) => (
            <pre
              className="my-5 rounded-xl border border-[var(--panel-border)] bg-[rgba(0,0,0,0.45)] p-4 overflow-x-auto text-[13px] leading-relaxed font-[var(--font-geist-mono)]"
              {...p}
            />
          ),
        }}
      >
        {cleaned}
      </ReactMarkdown>
    </motion.article>
  );
}
