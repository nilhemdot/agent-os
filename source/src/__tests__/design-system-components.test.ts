import { describe, it, expect } from "vitest";
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import Eyebrow from "@/components/Eyebrow";
import PageHeader from "@/components/PageHeader";
import Divider from "@/components/Divider";
import SidebarItem, { SidebarSection } from "@/components/SidebarItem";
import { StatusMeta } from "@/components/StatusRow";

// These components replace inline class markup in TopBar, Overview and
// Sidebar. The markup is what globals.css styles, so pin it down exactly.
const html = (el: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(el);

describe("design-system components", () => {
  it("Eyebrow renders numeral, rule and label, with optional extra classes", () => {
    expect(html(h(Eyebrow, { numeral: "II.", label: "Agents" }))).toBe(
      '<div class="eyebrow"><span class="num">II.</span><span class="line"></span><span class="label">Agents</span></div>',
    );
    expect(html(h(Eyebrow, { numeral: "I.", label: "X", className: "mb-5" }))).toMatch(/^<div class="eyebrow mb-5">/);
  });

  it("PageHeader renders eyebrow, title and subtitle, and omits the eyebrow without a label", () => {
    const full = html(h(PageHeader, { numeral: "I.", label: "Mission Control", title: "Mission Control", sub: "Status." }));
    expect(full).toContain('<div class="eyebrow">');
    expect(full).toContain('<h1 class="page-title">Mission Control</h1>');
    expect(full).toContain('<p class="page-subtitle">Status.</p>');
    expect(html(h(PageHeader, { title: "Only" }))).toBe('<div><h1 class="page-title">Only</h1></div>');
  });

  it("Divider renders two rules around the ornament", () => {
    expect(html(h(Divider))).toBe(
      '<div class="divider"><span class="rule"></span><span class="ornament">✦</span><span class="rule"></span></div>',
    );
  });

  it("StatusMeta keeps the status-meta class and appends extra classes", () => {
    expect(html(h(StatusMeta, null, "Local"))).toBe('<span class="status-meta">Local</span>');
    expect(html(h(StatusMeta, { className: "block mt-4", children: "Local" }))).toBe('<span class="status-meta block mt-4">Local</span>');
  });

  it("SidebarSection matches the Sidebar section label markup", () => {
    expect(html(h(SidebarSection, null, "Agents"))).toBe('<div class="sidebar-section-label mt-5 mb-1.5 px-5">Agents</div>');
  });

  it("SidebarItem links to href, marks the active row and draws the indicator only when active", () => {
    const active = html(h(SidebarItem, { href: "/claude", label: "Claude", active: true }));
    expect(active).toMatch(/^<a class="sidebar-item relative group flex items-center gap-3 py-2.5 px-5 active" href="\/claude">/);
    expect(active).toContain("w-[2px] h-[22px]");
    expect(active).toContain('style="color:var(--gold)"');

    const idle = html(h(SidebarItem, { href: "/pipeline", label: "Pipeline" }));
    expect(idle).not.toContain(" active\"");
    expect(idle).not.toContain("w-[2px]");
    expect(idle).toContain('style="color:var(--cream-dim)"');
    expect(idle).toContain("Pipeline</span>");
  });
});
