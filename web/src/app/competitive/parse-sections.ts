export interface Section {
  id: string;
  title: string;
  content: string;
  group: string;
  groupLabel: string;
  icon: string;
  subsections: Array<{ id: string; title: string }>;
}

const SECTION_GROUPS: Array<{
  label: string;
  icon: string;
  matcher: (title: string) => boolean;
}> = [
  {
    label: "Overview",
    icon: "◆",
    matcher: (t) =>
      /executive summary|contractor.*reality|the problem/i.test(t),
  },
  {
    label: "Market & Competition",
    icon: "⬡",
    matcher: (t) =>
      /market opportunity|competitor|feature matrix|workflow-level|strategic intelligence/i.test(t),
  },
  {
    label: "Product",
    icon: "▲",
    matcher: (t) => /what we.*building|pricing/i.test(t),
  },
  {
    label: "Go-to-Market",
    icon: "→",
    matcher: (t) =>
      /strategy to win|distribution|expansion|risks/i.test(t),
  },
  {
    label: "Validation",
    icon: "✓",
    matcher: (t) =>
      /appendix a|interview/i.test(t),
  },
  {
    label: "Workflows",
    icon: "⟳",
    matcher: (t) => /appendix b|workflow \d|thank you/i.test(t),
  },
];

function getGroup(title: string): { label: string; icon: string } {
  for (const g of SECTION_GROUPS) {
    if (g.matcher(title)) return { label: g.label, icon: g.icon };
  }
  return { label: "Other", icon: "•" };
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .trim();
}

function extractSubsections(
  content: string
): Array<{ id: string; title: string }> {
  const regex = /^### (.+)$/gm;
  const subs: Array<{ id: string; title: string }> = [];
  let match;
  while ((match = regex.exec(content)) !== null) {
    const title = match[1].replace(/\*\*/g, "").replace(/`/g, "");
    subs.push({ id: slugify(title), title });
  }
  return subs;
}

export function parseSections(markdown: string): Section[] {
  const lines = markdown.split("\n");
  const sections: Section[] = [];
  let currentTitle = "";
  let currentLines: string[] = [];
  let started = false;

  for (const line of lines) {
    const h2Match = line.match(/^## (.+)$/);
    if (h2Match) {
      if (started && currentTitle) {
        const group = getGroup(currentTitle);
        const content = currentLines.join("\n");
        const subsections = extractSubsections(content);
        sections.push({
          id: slugify(currentTitle),
          title: currentTitle.replace(/\*\*/g, ""),
          content,
          group: group.label,
          groupLabel: group.label,
          icon: group.icon,
          subsections,
        });
      }
      currentTitle = h2Match[1];
      currentLines = [];
      started = true;
    } else if (started) {
      currentLines.push(line);
    }
  }

  if (currentTitle) {
    const group = getGroup(currentTitle);
    const content = currentLines.join("\n");
    const subsections = extractSubsections(content);
    sections.push({
      id: slugify(currentTitle),
      title: currentTitle.replace(/\*\*/g, ""),
      content,
      group: group.label,
      groupLabel: group.label,
      icon: group.icon,
      subsections,
    });
  }

  return sections;
}
