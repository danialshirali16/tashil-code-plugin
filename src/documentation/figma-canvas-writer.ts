/**
 * Figma Canvas Writer for automated documentation frames.
 *
 * Creates pixel-accurate, auto-layout documentation frames directly on the Figma
 * canvas following the Swiss-Army design system documentation standard.
 */

import {
  DOC_FRAME_SCHEMA_VERSION,
  DOC_METADATA_PLUGIN_KEY,
  type ComponentDocDocument,
  type DocFrameMetadata,
  type TokenDocDocument,
  type TokenDocItem,
  type TokenDocMode,
  type TokenDocSection,
} from './types';

export const FRAME_WIDTH = 1980;
const FONT_REGULAR = { family: 'Inter', style: 'Regular' };
const FONT_MEDIUM = { family: 'Inter', style: 'Medium' };
let FONT_MONO = { family: 'Geist Mono', style: 'Regular' };
let FONT_MONO_MEDIUM = { family: 'Geist Mono', style: 'Medium' };

export async function loadRequiredFonts(): Promise<void> {
  const candidateFonts = [
    { family: 'Geist Mono', style: 'Regular' },
    { family: 'Geist Mono', style: 'Medium' },
    { family: 'Roboto Mono', style: 'Regular' },
    { family: 'Roboto Mono', style: 'Medium' },
    FONT_REGULAR,
    FONT_MEDIUM,
    { family: 'Inter', style: 'Semi Bold' },
  ];

  let geistMonoLoaded = false;
  let geistMonoMedLoaded = false;

  for (const font of candidateFonts) {
    try {
      await figma.loadFontAsync(font);
      if (font.family === 'Geist Mono' && font.style === 'Regular') {
        geistMonoLoaded = true;
      }
      if (font.family === 'Geist Mono' && font.style === 'Medium') {
        geistMonoMedLoaded = true;
      }
    } catch (_error) {
      // Fallback font will be used
    }
  }

  if (geistMonoLoaded) {
    FONT_MONO = { family: 'Geist Mono', style: 'Regular' };
  } else {
    FONT_MONO = { family: 'Roboto Mono', style: 'Regular' };
  }

  if (geistMonoMedLoaded) {
    FONT_MONO_MEDIUM = { family: 'Geist Mono', style: 'Medium' };
  } else {
    FONT_MONO_MEDIUM = { family: 'Roboto Mono', style: 'Medium' };
  }
}

export async function findMasterComponent(nodeId: string): Promise<ComponentNode | null> {
  try {
    const byId = await figma.getNodeByIdAsync(nodeId);
    if (byId && byId.type === 'COMPONENT') return byId as ComponentNode;
    if (byId && byId.type === 'COMPONENT_SET') {
      const def = (byId as ComponentSetNode).defaultVariant;
      if (def && def.type === 'COMPONENT') return def as ComponentNode;
    }
  } catch (_e) {
    // Ignore
  }
  return null;
}

export function safeGetNodeName(node: SceneNode | BaseNode | null | undefined): string {
  if (!node) return '';
  try {
    return (node as SceneNode).name || '';
  } catch (_e) {
    return '';
  }
}

export function safeGetNodeType(node: SceneNode | BaseNode | null | undefined): string {
  if (!node) return '';
  try {
    return (node as SceneNode).type || '';
  } catch (_e) {
    return '';
  }
}

export function safeFindChild<T extends SceneNode>(
  parent: SceneNode | BaseNode | null | undefined,
  predicate: (child: SceneNode) => boolean,
): T | null {
  if (!parent || !('children' in parent) || !Array.isArray(parent.children)) {
    return null;
  }
  for (const child of parent.children) {
    try {
      if (child && predicate(child as SceneNode)) {
        return child as T;
      }
    } catch (_e) {
      // Ignore sublayer property read error on virtual/deleted nodes
    }
  }
  return null;
}

export function safeFindChildren<T extends SceneNode>(
  parent: SceneNode | BaseNode | null | undefined,
  predicate: (child: SceneNode) => boolean,
): T[] {
  if (!parent || !('children' in parent) || !Array.isArray(parent.children)) {
    return [];
  }
  const results: T[] = [];
  for (const child of parent.children) {
    try {
      if (child && predicate(child as SceneNode)) {
        results.push(child as T);
      }
    } catch (_e) {
      // Ignore
    }
  }
  return results;
}

export function safeFindTextNodes(root: SceneNode | BaseNode | null | undefined): TextNode[] {
  const results: TextNode[] = [];
  if (!root) return results;

  function walk(node: SceneNode) {
    try {
      if (!node) return;
      if (node.type === 'TEXT') {
        results.push(node as TextNode);
        return;
      }
    } catch (_e) {
      return;
    }

    try {
      if ('children' in node && Array.isArray(node.children)) {
        for (const child of node.children) {
          walk(child as SceneNode);
        }
      }
    } catch (_e) {
      // Ignore
    }
  }

  if ('children' in root && Array.isArray(root.children)) {
    for (const child of root.children) {
      walk(child as SceneNode);
    }
  } else if ('type' in root && (root as SceneNode).type === 'TEXT') {
    results.push(root as TextNode);
  }

  return results;
}

export function safeFindAll<T extends SceneNode>(
  root: SceneNode | BaseNode | null | undefined,
  predicate: (node: SceneNode) => boolean,
): T[] {
  const results: T[] = [];
  if (!root) return results;

  function walk(node: SceneNode) {
    try {
      if (!node) return;
      if (predicate(node)) {
        results.push(node as T);
      }
    } catch (_e) {
      return;
    }

    try {
      if ('children' in node && Array.isArray(node.children)) {
        for (const child of node.children) {
          walk(child as SceneNode);
        }
      }
    } catch (_e) {
      // Ignore
    }
  }

  if ('children' in root && Array.isArray(root.children)) {
    for (const child of root.children) {
      walk(child as SceneNode);
    }
  } else {
    try {
      if (predicate(root as SceneNode)) {
        results.push(root as T);
      }
    } catch (_e) {
      // Ignore
    }
  }

  return results;
}

export async function createTokenDocFrame(
  doc: TokenDocDocument,
  options: { page?: PageNode; x?: number; y?: number } = {},
  onProgress?: (stage: string, percent: number) => void,
): Promise<FrameNode> {
  onProgress?.('Loading document typography…', 10);
  await loadRequiredFonts();

  onProgress?.('Setting up documentation frame…', 20);
  const targetPage = options.page ?? figma.currentPage;
  const rootFrame = figma.createFrame();
  rootFrame.name = doc.title.startsWith('1.') ? doc.title : `1. ${doc.title}`;
  rootFrame.resize(FRAME_WIDTH, 100);
  rootFrame.layoutMode = 'VERTICAL';
  rootFrame.primaryAxisSizingMode = 'AUTO';
  rootFrame.counterAxisSizingMode = 'FIXED';
  rootFrame.itemSpacing = 0;
  rootFrame.cornerRadius = 24;
  rootFrame.clipsContent = true;
  rootFrame.fills = [{ color: { r: 1, g: 1, b: 1 }, type: 'SOLID' }];

  if (options.x !== undefined && options.y !== undefined) {
    rootFrame.x = options.x;
    rootFrame.y = options.y;
  } else {
    let maxX = -Infinity;
    let baselineY = 0;
    let foundDocFrame = false;

    for (const child of targetPage.children) {
      if (child.type === 'FRAME' && child.getPluginData(DOC_METADATA_PLUGIN_KEY)) {
        foundDocFrame = true;
        const rightEdge = child.x + child.width;
        if (rightEdge > maxX) {
          maxX = rightEdge;
          baselineY = child.y;
        }
      }
    }

    if (foundDocFrame && Number.isFinite(maxX)) {
      rootFrame.x = maxX + 100;
      rootFrame.y = baselineY;
    } else {
      rootFrame.x = figma.viewport.center.x - FRAME_WIDTH / 2;
      rootFrame.y = figma.viewport.center.y - 400;
    }
  }

  // 1. Header
  onProgress?.('Creating Header & Hero…', 30);
  const header = await createHeaderBar(doc.title);
  rootFrame.appendChild(header);

  // 2. Hero
  const hero = await createHeroNode(doc);
  rootFrame.appendChild(hero);

  // 3. Separator
  const separator = await createSeparatorNode(doc.title);
  rootFrame.appendChild(separator);

  // 4. Sections
  const totalSections = doc.sections.length;
  for (let i = 0; i < totalSections; i++) {
    const section = doc.sections[i];
    const sectionPct = Math.round(30 + ((i + 1) / totalSections) * 60);
    onProgress?.(`Building section ${i + 1} of ${totalSections} (${section.headline})…`, sectionPct);
    const sectionNode = await createSectionNode(section, doc.modes, doc.collectionId);
    rootFrame.appendChild(sectionNode);
  }

  // 5. Footer
  onProgress?.('Finalizing footer and layout…', 95);
  const footer = await createFooterBar();
  rootFrame.appendChild(footer);

  targetPage.appendChild(rootFrame);

  // Apply explicit column variable modes after attaching to document
  for (const sectionNode of rootFrame.children) {
    const slot = safeFindChild<FrameNode>(sectionNode, (n) => safeGetNodeName(n) === 'Slot');
    const table = slot
      ? safeFindChild<FrameNode>(slot, (n) => safeGetNodeName(n) === 'Table' || safeGetNodeName(n) === 'Container')
      : safeFindChild<FrameNode>(sectionNode, (n) => safeGetNodeName(n) === 'Table' || safeGetNodeName(n) === 'Container');

    if (table && 'children' in table) {
      const valCols = safeFindChildren<FrameNode>(
        table,
        (c) => safeGetNodeName(c) === 'Value' || safeGetNodeName(c).startsWith('Value'),
      );
      for (let mIdx = 0; mIdx < doc.modes.length; mIdx++) {
        const col = valCols[mIdx];
        if (col) {
          await applyColumnMode(col, doc.modes[mIdx], doc.collectionId);
        }
      }
    }
  }

  // Stamp metadata
  const metadata: DocFrameMetadata = {
    contentHash: doc.contentHash,
    docType: 'tokens',
    generatedAt: new Date().toISOString(),
    modeIds: doc.modes.map((m) => m.modeId),
    schemaVersion: DOC_FRAME_SCHEMA_VERSION,
    targetId: doc.collectionId,
    targetName: doc.collectionName,
  };
  rootFrame.setPluginData(DOC_METADATA_PLUGIN_KEY, JSON.stringify(metadata));

  figma.currentPage.selection = [rootFrame];
  figma.viewport.scrollAndZoomIntoView([rootFrame]);

  onProgress?.('Token documentation generated!', 100);
  return rootFrame;
}

export async function createHeaderBar(title: string): Promise<SceneNode> {
  const cleanTitle = title.replace(/^\d+\.\s*/, '');
  const numMatch = title.match(/^\d+/)?.[0] ?? '01';
  const paddedNum = numMatch.padStart(2, '0');

  const master = (await findMasterComponent('1386:9061')) ?? (await findMasterComponent('1386:9060'));
  if (master) {
    try {
      const instance = master.createInstance();
      instance.resize(FRAME_WIDTH, instance.height);
      const textNodes = safeFindTextNodes(instance);
      for (const t of textNodes) {
        const textLower = t.characters.toLowerCase();
        if (t.name === 'Category' || textLower === 'category' || t.characters === 'FOUNDATION') {
          t.characters = 'FOUNDATION';
        } else if (t.name === 'Page' || textLower === 'page' || t.characters === 'COLORS') {
          t.characters = cleanTitle.toUpperCase();
        } else if (t.name === '01' || t.characters === '01') {
          t.characters = paddedNum;
        } else if (textLower === 'swiss army') {
          t.characters = 'SWISS ARMY';
        }
      }
      return instance;
    } catch (_e) {
      // fallback
    }
  }

  return createProceduralHeader(title);
}

function createProceduralHeader(title: string): FrameNode {
  const bar = figma.createFrame();
  bar.name = '.[Documentation] Header & Footer';
  bar.resize(FRAME_WIDTH, 84);
  bar.layoutMode = 'HORIZONTAL';
  bar.primaryAxisAlignItems = 'SPACE_BETWEEN';
  bar.counterAxisAlignItems = 'CENTER';
  bar.paddingLeft = 100;
  bar.paddingRight = 100;
  bar.paddingTop = 32;
  bar.paddingBottom = 32;
  bar.strokeWeight = 1;
  bar.strokeAlign = 'INSIDE';
  bar.strokes = [{ color: { r: 0.898, g: 0.906, b: 0.922 }, type: 'SOLID' }];
  bar.fills = [{ color: { r: 1, g: 1, b: 1 }, type: 'SOLID' }];

  const cleanTitle = title.replace(/^\d+\.\s*/, '');
  const numMatch = title.match(/^\d+/)?.[0] ?? '01';
  const paddedNum = numMatch.padStart(2, '0');

  const breadcrumb = figma.createFrame();
  breadcrumb.name = 'Breadcrumb';
  breadcrumb.layoutMode = 'HORIZONTAL';
  breadcrumb.counterAxisAlignItems = 'CENTER';
  breadcrumb.itemSpacing = 10;
  breadcrumb.fills = [];

  const fnd = createTextNode('FOUNDATION', 14, FONT_MONO, { r: 0.063, g: 0.094, b: 0.157 });
  fnd.letterSpacing = { unit: 'PIXELS', value: -0.07 };
  breadcrumb.appendChild(fnd);

  const arrow = createTextNode('→', 14, FONT_MONO, { r: 0.416, g: 0.447, b: 0.51 });
  breadcrumb.appendChild(arrow);

  const cat = createTextNode(cleanTitle.toUpperCase(), 14, FONT_MONO, { r: 0.063, g: 0.094, b: 0.157 });
  cat.letterSpacing = { unit: 'PIXELS', value: -0.07 };
  breadcrumb.appendChild(cat);

  const dot = createTextNode('・', 14, FONT_MONO, { r: 0.6, g: 0.631, b: 0.686 });
  breadcrumb.appendChild(dot);

  const num = createTextNode(paddedNum, 14, FONT_MONO, { r: 0.6, g: 0.631, b: 0.686 });
  breadcrumb.appendChild(num);

  bar.appendChild(breadcrumb);

  const emblem = figma.createFrame();
  emblem.name = 'Union';
  emblem.resize(28, 20);
  emblem.fills = [];
  try {
    const unionVector = figma.createVector();
    unionVector.name = 'Vector';
    unionVector.resize(28, 20);
    unionVector.vectorPaths = [
      {
        data: 'M 0 0 L 28 0 L 14 10 L 28 20 L 0 20 L 14 10 Z',
        windingRule: 'NONZERO',
      },
    ];
    unionVector.fills = [{ color: { r: 0.063, g: 0.094, b: 0.157 }, type: 'SOLID' }];
    emblem.appendChild(unionVector);
  } catch (_e) {
    // Fallback gracefully
  }
  bar.appendChild(emblem);

  const rightLabel = createTextNode('SWISS ARMY', 14, FONT_MONO, { r: 0.063, g: 0.094, b: 0.157 });
  rightLabel.letterSpacing = { unit: 'PIXELS', value: -0.5 };
  rightLabel.textAlignHorizontal = 'RIGHT';
  bar.appendChild(rightLabel);

  return bar;
}

export async function createFooterBar(): Promise<SceneNode> {
  const master = (await findMasterComponent('1386:9066')) ?? (await findMasterComponent('1386:9060'));
  if (master) {
    try {
      const instance = master.createInstance();
      instance.resize(FRAME_WIDTH, instance.height);
      return instance;
    } catch (_e) {
      // fallback
    }
  }

  return createProceduralFooter();
}

function createProceduralFooter(): FrameNode {
  const bar = figma.createFrame();
  bar.name = '.[Documentation] Header & Footer';
  bar.resize(FRAME_WIDTH, 84);
  bar.layoutMode = 'HORIZONTAL';
  bar.primaryAxisAlignItems = 'CENTER';
  bar.counterAxisAlignItems = 'CENTER';
  bar.paddingLeft = 100;
  bar.paddingRight = 100;
  bar.paddingTop = 32;
  bar.paddingBottom = 32;
  bar.strokeWeight = 1;
  bar.strokeAlign = 'INSIDE';
  bar.strokes = [{ color: { r: 0.898, g: 0.906, b: 0.922 }, type: 'SOLID' }];
  bar.fills = [{ color: { r: 0.976, g: 0.98, b: 0.984 }, type: 'SOLID' }];

  const footerText = createTextNode('Made with 🖤 by Tashil Design', 14, FONT_MONO, {
    r: 0.063,
    g: 0.094,
    b: 0.157,
  });
  footerText.letterSpacing = { unit: 'PIXELS', value: -0.5 };
  footerText.textAlignHorizontal = 'CENTER';
  bar.appendChild(footerText);

  return bar;
}

export async function createHeroNode(doc: TokenDocDocument): Promise<SceneNode> {
  const cleanTitle = doc.title.replace(/^\d+\.\s*/, '');
  const master = await findMasterComponent('1422:17985');
  if (master) {
    try {
      const instance = master.createInstance();
      instance.resize(FRAME_WIDTH, instance.height);
      const textNodes = safeFindTextNodes(instance);
      for (const t of textNodes) {
        if (t.name === 'Headline' || t.characters === 'Headline' || t.characters.includes('Colors')) {
          t.characters = cleanTitle;
        } else if (t.name === 'Description' || t.characters.startsWith('Guidelines')) {
          t.characters =
            doc.description ||
            `Guidelines to delve into the ${cleanTitle} Palette and Token System, exploring customization options for your palette, switching primary colors, utilizing variable modes, changing themes, and more.`;
        }
      }
      return instance;
    } catch (_e) {
      // fallback
    }
  }

  return createProceduralHero(doc);
}

function createProceduralHero(doc: TokenDocDocument): FrameNode {
  const hero = figma.createFrame();
  hero.name = '.[Documentation] Hero';
  hero.resize(FRAME_WIDTH, 368);
  hero.layoutMode = 'HORIZONTAL';
  hero.primaryAxisAlignItems = 'SPACE_BETWEEN';
  hero.counterAxisAlignItems = 'CENTER';
  hero.paddingLeft = 100;
  hero.paddingRight = 100;
  hero.paddingTop = 64;
  hero.paddingBottom = 64;
  hero.fills = [{ color: { r: 1, g: 1, b: 1 }, type: 'SOLID' }];
  hero.strokes = [{ color: { r: 0.898, g: 0.906, b: 0.922 }, type: 'SOLID' }];
  hero.strokeWeight = 1;
  hero.strokeAlign = 'INSIDE';

  const cleanTitle = doc.title.replace(/^\d+\.\s*/, '');
  const texts = figma.createFrame();
  texts.name = 'Texts';
  texts.resize(800, 200);
  texts.layoutMode = 'VERTICAL';
  texts.itemSpacing = 24;
  texts.primaryAxisSizingMode = 'AUTO';
  texts.counterAxisSizingMode = 'FIXED';
  texts.fills = [];

  const titleText = createTextNode(cleanTitle, 56, FONT_MEDIUM, { r: 0.063, g: 0.094, b: 0.157 });
  titleText.letterSpacing = { unit: 'PIXELS', value: -0.56 };
  titleText.lineHeight = { unit: 'PIXELS', value: 64 };
  texts.appendChild(titleText);

  const descText = createTextNode(
    doc.description ||
      `Guidelines to delve into the ${cleanTitle} Palette and Token System, exploring customization options for your palette, switching primary colors, utilizing variable modes, changing themes, and more.`,
    18,
    FONT_REGULAR,
    { r: 0.212, g: 0.255, b: 0.325 },
  );
  descText.lineHeight = { unit: 'PIXELS', value: 28 };
  texts.appendChild(descText);

  hero.appendChild(texts);

  const badge = figma.createFrame();
  badge.name = 'image 1';
  badge.resize(450, 240);
  badge.cornerRadius = 24;
  badge.clipsContent = true;
  const gradient = doc.heroBadgeGradient ?? { from: '#E7000B', via: '#F54900', to: '#2463EB' };
  badge.fills = [
    {
      gradientStops: [
        { color: hexToRgba(gradient.from), position: 0 },
        { color: hexToRgba(gradient.via ?? gradient.to), position: 0.5 },
        { color: hexToRgba(gradient.to), position: 1 },
      ],
      gradientTransform: [
        [-1, 0, 1],
        [0, 1, 0],
      ],
      type: 'GRADIENT_LINEAR',
    },
  ];

  const glass = figma.createFrame();
  glass.name = 'Frame';
  glass.resize(150, 150);
  glass.cornerRadius = 20;
  glass.fills = [{ color: { r: 1, g: 1, b: 1 }, opacity: 0.15, type: 'SOLID' }];
  glass.strokes = [{ color: { r: 1, g: 1, b: 1 }, opacity: 0.3, type: 'SOLID' }];
  glass.strokeWeight = 1.5;
  badge.appendChild(glass);

  hero.appendChild(badge);

  return hero;
}

export async function createSeparatorNode(title = 'Color'): Promise<SceneNode> {
  const cleanTitle = title.replace(/^\d+\.\s*/, '');
  const master = await findMasterComponent('1422:18167');
  if (master) {
    try {
      const instance = master.createInstance();
      instance.resize(FRAME_WIDTH, instance.height);
      const textNodes = safeFindTextNodes(instance);
      if (textNodes.length > 0) {
        textNodes[0].characters = `${cleanTitle} Tokens`;
      }
      return instance;
    } catch (_e) {
      // fallback
    }
  }

  return createProceduralSeparator(title);
}

function createProceduralSeparator(title = 'Color'): FrameNode {
  const cleanTitle = title.replace(/^\d+\.\s*/, '');
  const sep = figma.createFrame();
  sep.name = '.[Documentation] Separator';
  sep.resize(FRAME_WIDTH, 45);
  sep.layoutMode = 'HORIZONTAL';
  sep.counterAxisAlignItems = 'CENTER';
  sep.paddingLeft = 100;
  sep.paddingRight = 100;
  sep.paddingTop = 12;
  sep.paddingBottom = 12;
  sep.fills = [{ color: { r: 0.953, g: 0.957, b: 0.965 }, type: 'SOLID' }];
  sep.strokes = [{ color: { r: 0.898, g: 0.906, b: 0.922 }, type: 'SOLID' }];
  sep.strokeWeight = 1;

  const label = createTextNode(`${cleanTitle} Tokens`, 16, FONT_MONO_MEDIUM, {
    r: 0.416,
    g: 0.447,
    b: 0.51,
  });
  label.letterSpacing = { unit: 'PIXELS', value: 0.32 };
  sep.appendChild(label);

  return sep;
}

export async function createSectionNode(
  section: TokenDocSection,
  modes: TokenDocMode[],
  collectionId?: string,
): Promise<SceneNode> {
  const master = await findMasterComponent('1422:18185');
  if (master) {
    try {
      const instance = master.createInstance();
      instance.resize(FRAME_WIDTH, instance.height);
      const textNodes = safeFindTextNodes(instance);
      for (const t of textNodes) {
        if (t.name === 'Headline' || t.characters === 'Headline' || t.characters === 'Section name') {
          t.characters = section.headline;
        } else if (t.name === 'Description' || t.characters.startsWith('Allows users')) {
          t.characters = section.description;
        }
      }

      const slot = safeFindChild<FrameNode>(instance, (n) => safeGetNodeName(n) === 'Slot');
      if (slot) {
        const placeholder = safeFindChild(slot, (n) => safeGetNodeName(n) === 'Replace this with content');
        if (placeholder) {
          try {
            placeholder.remove();
          } catch (_e) {
            // Ignore removal error
          }
        }

        const table = await createTable(section.tokens, modes, collectionId);
        slot.appendChild(table);
      }
      return instance;
    } catch (_e) {
      // fallback
    }
  }

  return await createProceduralSection(section, modes, collectionId);
}

async function createProceduralSection(
  section: TokenDocSection,
  modes: TokenDocMode[],
  collectionId?: string,
): Promise<FrameNode> {
  const sectionNode = figma.createFrame();
  sectionNode.name = '.[Documentation] Section';
  sectionNode.resize(FRAME_WIDTH, 100);
  sectionNode.layoutMode = 'VERTICAL';
  sectionNode.primaryAxisSizingMode = 'AUTO';
  sectionNode.counterAxisSizingMode = 'FIXED';
  sectionNode.itemSpacing = 48;
  sectionNode.paddingLeft = 100;
  sectionNode.paddingRight = 100;
  sectionNode.paddingTop = 56;
  sectionNode.paddingBottom = 56;
  sectionNode.fills = [{ color: { r: 1, g: 1, b: 1 }, type: 'SOLID' }];

  // Title
  const titleFrame = figma.createFrame();
  titleFrame.name = 'Title';
  titleFrame.layoutMode = 'VERTICAL';
  titleFrame.itemSpacing = 8;
  titleFrame.primaryAxisSizingMode = 'AUTO';
  titleFrame.counterAxisSizingMode = 'FIXED';
  titleFrame.resize(1780, 84);
  titleFrame.fills = [];

  const headline = createTextNode(section.headline, 32, FONT_MEDIUM, { r: 0.063, g: 0.094, b: 0.157 });
  headline.lineHeight = { unit: 'PIXELS', value: 48 };
  titleFrame.appendChild(headline);

  const desc = createTextNode(section.description, 18, FONT_REGULAR, { r: 0.212, g: 0.255, b: 0.325 });
  desc.lineHeight = { unit: 'PIXELS', value: 28 };
  titleFrame.appendChild(desc);

  sectionNode.appendChild(titleFrame);

  // Table Container inside Slot
  const slot = figma.createFrame();
  slot.name = 'Slot';
  slot.layoutMode = 'VERTICAL';
  slot.primaryAxisSizingMode = 'AUTO';
  slot.counterAxisSizingMode = 'FIXED';
  slot.resize(1780, 100);
  slot.fills = [];

  const table = await createTable(section.tokens, modes, collectionId);
  slot.appendChild(table);
  sectionNode.appendChild(slot);

  return sectionNode;
}

export async function findComponentSet(nodeId: string): Promise<ComponentSetNode | null> {
  try {
    const node = await figma.getNodeByIdAsync(nodeId);
    if (node && node.type === 'COMPONENT_SET') {
      return node as ComponentSetNode;
    }
  } catch (_e) {
    // Ignore
  }
  return null;
}

export async function createTable(
  tokens: TokenDocItem[],
  modes: TokenDocMode[],
  collectionId?: string,
): Promise<FrameNode> {
  const container = figma.createFrame();
  container.name = 'Table';
  container.layoutMode = 'HORIZONTAL';
  container.primaryAxisSizingMode = 'AUTO';
  container.counterAxisSizingMode = 'AUTO';
  container.cornerRadius = 8;
  container.clipsContent = true;
  container.strokes = [{ color: { r: 0.898, g: 0.906, b: 0.922 }, type: 'SOLID' }];
  container.strokeWeight = 1;
  container.fills = [{ color: { r: 1, g: 1, b: 1 }, type: 'SOLID' }];

  // 1. Token Column
  const tokenColumn = await createTokenColumn(tokens);
  container.appendChild(tokenColumn);

  // 2. Value Columns (per mode)
  for (const mode of modes) {
    const valueColumn = await createValueColumn(tokens, mode, collectionId);
    container.appendChild(valueColumn);
  }

  return container;
}

export async function createTokenItemNode(name: string): Promise<SceneNode> {
  const tokenItemMaster = await findMasterComponent('1929:52305');
  if (tokenItemMaster) {
    try {
      const itemInst = tokenItemMaster.createInstance();
      itemInst.resize(480, 66);
      const textNodes = safeFindTextNodes(itemInst);
      for (const textNode of textNodes) {
        if (textNode.fontName !== figma.mixed) {
          await figma.loadFontAsync(textNode.fontName);
        }
        textNode.characters = name;
      }
      return itemInst;
    } catch (_e) {
      // fallback
    }
  }
  return createProceduralTokenItem(name, 480);
}

export async function createTokenColumn(tokens: TokenDocItem[]): Promise<FrameNode> {
  const column = figma.createFrame();
  column.name = 'Token';
  column.layoutMode = 'VERTICAL';
  column.primaryAxisSizingMode = 'AUTO';
  column.counterAxisSizingMode = 'FIXED';
  column.resize(480, 100);
  column.strokes = [{ color: { r: 0.898, g: 0.906, b: 0.922 }, type: 'SOLID' }];
  column.strokeWeight = 1;
  column.fills = [{ color: { r: 1, g: 1, b: 1 }, type: 'SOLID' }];

  const headerMaster = await findMasterComponent('1929:52306');

  // Header
  if (headerMaster) {
    try {
      const headerInst = headerMaster.createInstance();
      headerInst.resize(480, 48);
      const textNodes = safeFindTextNodes(headerInst);
      if (textNodes.length > 0) {
        if (textNodes[0].fontName !== figma.mixed) {
          await figma.loadFontAsync(textNodes[0].fontName);
        }
        textNodes[0].characters = 'TOKEN';
      }
      column.appendChild(headerInst);
    } catch (_e) {
      column.appendChild(createProceduralTokenHeader(480, 'TOKEN'));
    }
  } else {
    column.appendChild(createProceduralTokenHeader(480, 'TOKEN'));
  }

  // Token items
  for (const token of tokens) {
    const item = await createTokenItemNode(token.name);
    column.appendChild(item);
  }

  return column;
}

function createProceduralTokenHeader(width: number, title: string): FrameNode {
  const header = figma.createFrame();
  header.name = 'Header';
  header.resize(width, 48);
  header.layoutMode = 'HORIZONTAL';
  header.counterAxisAlignItems = 'CENTER';
  header.paddingLeft = 20;
  header.paddingRight = 20;
  header.paddingTop = 16;
  header.paddingBottom = 16;
  header.strokes = [{ color: { r: 0.898, g: 0.906, b: 0.922 }, type: 'SOLID' }];
  header.strokeWeight = 1;
  header.fills = [{ color: { r: 1, g: 1, b: 1 }, type: 'SOLID' }];
  const headerText = createTextNode(title, 12, FONT_MONO, { r: 0.416, g: 0.447, b: 0.51 });
  headerText.letterSpacing = { unit: 'PIXELS', value: -0.06 };
  header.appendChild(headerText);
  return header;
}

function createProceduralTokenItem(name: string, width: number): FrameNode {
  const item = figma.createFrame();
  item.name = 'Token Item';
  item.resize(width, 66);
  item.layoutMode = 'HORIZONTAL';
  item.counterAxisAlignItems = 'CENTER';
  item.itemSpacing = 16;
  item.paddingLeft = 20;
  item.paddingRight = 20;
  item.paddingTop = 16;
  item.paddingBottom = 16;
  item.strokes = [{ color: { r: 0.898, g: 0.906, b: 0.922 }, type: 'SOLID' }];
  item.strokeWeight = 1;
  item.fills = [{ color: { r: 1, g: 1, b: 1 }, type: 'SOLID' }];

  const indicator = figma.createFrame();
  indicator.name = 'Frame';
  indicator.resize(20, 20);
  indicator.cornerRadius = 6;
  indicator.fills = [{ color: { r: 0.953, g: 0.957, b: 0.965 }, type: 'SOLID' }];
  indicator.strokes = [{ color: { r: 0.898, g: 0.906, b: 0.922 }, type: 'SOLID' }];
  indicator.strokeWeight = 1;
  item.appendChild(indicator);

  const text = createTextNode(name, 14, FONT_MONO, { r: 0.063, g: 0.094, b: 0.157 });
  text.letterSpacing = { unit: 'PIXELS', value: -0.21 };
  text.lineHeight = { unit: 'PIXELS', value: 18 };
  item.appendChild(text);

  return item;
}

export async function createValueItemNode(
  val:
    | {
        aliasTargetName?: string;
        hexColor?: string;
        rawValue: string | number | boolean;
        resolvedType?: 'BOOLEAN' | 'COLOR' | 'FLOAT' | 'STRING';
      }
    | undefined,
  variableId?: string,
): Promise<SceneNode> {
  const valueItemSet = await findComponentSet('1929:52304');
  const displayText = val?.aliasTargetName ?? val?.rawValue ?? '-';

  let variantType = 'String';
  if (val?.resolvedType === 'COLOR' || val?.hexColor) {
    variantType = 'Color';
  } else if (val?.resolvedType === 'FLOAT' || typeof val?.rawValue === 'number') {
    variantType = 'Number';
  } else if (val?.resolvedType === 'BOOLEAN' || typeof val?.rawValue === 'boolean') {
    variantType = 'Boolean';
  }

  let solidPaint: SolidPaint | null = null;
  if (val?.hexColor) {
    solidPaint = { color: hexToRgb(val.hexColor), type: 'SOLID' };
    if (variableId) {
      try {
        const variable = await figma.variables.getVariableByIdAsync(variableId);
        if (variable) {
          solidPaint = figma.variables.setBoundVariableForPaint(solidPaint, 'color', variable);
        }
      } catch (_e) {
        // Fallback to unbound paint
      }
    }
  }

  if (valueItemSet) {
    const variantComp = valueItemSet.children.find(
      (c) =>
        c.type === 'COMPONENT' &&
        (c.name === `Type=${variantType}` || c.name.toLowerCase().includes(variantType.toLowerCase())),
    ) as ComponentNode | undefined;

    if (variantComp) {
      try {
        const itemInst = variantComp.createInstance();
        itemInst.resize(380, 66);

        const textNodes = safeFindTextNodes(itemInst);
        for (const textNode of textNodes) {
          if (textNode.fontName !== figma.mixed) {
            await figma.loadFontAsync(textNode.fontName);
          }
          textNode.characters = String(displayText);
        }

        if (solidPaint) {
          const swatch =
            safeFindChild<FrameNode>(itemInst, (n) => safeGetNodeName(n) === 'Color Icon' || safeGetNodeName(n) === 'Value Icon') ??
            safeFindAll<FrameNode>(itemInst, (n) => safeGetNodeName(n) === 'Color Icon' || safeGetNodeName(n) === 'Value Icon')[0] ?? null;
          if (swatch) {
            if ('fills' in swatch) {
              try {
                swatch.fills = [solidPaint];
              } catch (_e) {
                // Ignore swatch fill write error
              }
            }
            if ('children' in swatch && Array.isArray(swatch.children)) {
              for (const child of swatch.children) {
                if (child && 'fills' in child) {
                  try {
                    child.fills = [solidPaint];
                  } catch (_e) {
                    // Ignore child fill write error
                  }
                }
              }
            }
          }
        }

        return itemInst;
      } catch (_e) {
        // fallback
      }
    }
  }

  return createProceduralValueItem(val, 380, solidPaint);
}

export async function applyColumnMode(
  columnNode: SceneNode,
  mode: TokenDocMode,
  collectionId?: string,
): Promise<void> {
  if (!('setExplicitVariableModeForCollection' in columnNode)) return;
  const targetNode = columnNode as FrameNode | InstanceNode;

  try {
    const allCollections = await figma.variables.getLocalVariableCollectionsAsync();
    for (const col of allCollections) {
      if (collectionId && col.id === collectionId) {
        const exactMode = col.modes.find((m) => m.modeId === mode.modeId);
        if (exactMode) {
          try {
            targetNode.setExplicitVariableModeForCollection(col, exactMode.modeId);
          } catch (_e) {
            // Ignore
          }
          continue;
        }
      }

      // Match by modeId or matching name (e.g. Light / Dark mode in themes/primitives)
      const matchingMode = col.modes.find(
        (m) => m.modeId === mode.modeId || m.name.toLowerCase() === mode.name.toLowerCase(),
      );
      if (matchingMode) {
        try {
          targetNode.setExplicitVariableModeForCollection(col, matchingMode.modeId);
        } catch (_e) {
          // Ignore
        }
      }
    }
  } catch (_e) {
    // Ignore
  }
}

export async function createValueColumn(
  tokens: TokenDocItem[],
  mode: TokenDocMode,
  collectionId?: string,
): Promise<FrameNode> {
  const column = figma.createFrame();
  column.name = 'Value';
  column.resize(380, 100);
  column.layoutMode = 'VERTICAL';
  column.primaryAxisSizingMode = 'AUTO';
  column.counterAxisSizingMode = 'FIXED';
  column.strokes = [{ color: { r: 0.898, g: 0.906, b: 0.922 }, type: 'SOLID' }];
  column.strokeWeight = 1;
  column.fills = [{ color: { r: 1, g: 1, b: 1 }, type: 'SOLID' }];

  await applyColumnMode(column, mode, collectionId);

  const headerMaster = await findMasterComponent('1929:52306');

  // Header
  if (headerMaster) {
    try {
      const headerInst = headerMaster.createInstance();
      headerInst.resize(380, 48);
      const textNodes = safeFindTextNodes(headerInst);
      for (const t of textNodes) {
        if (t.fontName !== figma.mixed) {
          await figma.loadFontAsync(t.fontName);
        }
        t.characters = mode.name;
      }
      column.appendChild(headerInst);
    } catch (_e) {
      column.appendChild(createProceduralTokenHeader(380, mode.name));
    }
  } else {
    column.appendChild(createProceduralTokenHeader(380, mode.name));
  }

  // Value items
  for (const token of tokens) {
    const val = token.valuesByMode[mode.modeId];
    const item = await createValueItemNode(val, token.id);
    column.appendChild(item);
  }

  return column;
}

function createProceduralValueItem(
  val: { aliasTargetName?: string; hexColor?: string; rawValue: string | number | boolean } | undefined,
  width: number,
  boundPaint?: SolidPaint | null,
): FrameNode {
  const item = figma.createFrame();
  item.name = 'Value Item';
  item.resize(width, 66);
  item.layoutMode = 'HORIZONTAL';
  item.counterAxisAlignItems = 'CENTER';
  item.itemSpacing = 16;
  item.paddingLeft = 20;
  item.paddingRight = 20;
  item.paddingTop = 16;
  item.paddingBottom = 16;
  item.strokes = [{ color: { r: 0.898, g: 0.906, b: 0.922 }, type: 'SOLID' }];
  item.strokeWeight = 1;
  item.fills = [{ color: { r: 1, g: 1, b: 1 }, type: 'SOLID' }];

  if (val?.hexColor) {
    const swatch = figma.createFrame();
    swatch.name = 'Color Icon';
    swatch.resize(24, 24);
    swatch.cornerRadius = 6;
    swatch.fills = [boundPaint ?? { color: hexToRgb(val.hexColor), type: 'SOLID' }];
    swatch.strokes = [{ color: { r: 0, g: 0, b: 0 }, opacity: 0.08, type: 'SOLID' }];
    swatch.strokeWeight = 1.5;
    item.appendChild(swatch);
  }

  const pill = figma.createFrame();
  pill.name = 'Value Text Container';
  pill.layoutMode = 'HORIZONTAL';
  pill.counterAxisAlignItems = 'CENTER';
  pill.paddingLeft = 10;
  pill.paddingRight = 10;
  pill.paddingTop = 8;
  pill.paddingBottom = 8;
  pill.cornerRadius = 8;
  pill.fills = [{ color: { r: 0.953, g: 0.957, b: 0.965 }, type: 'SOLID' }];

  const displayText = val?.aliasTargetName ?? val?.rawValue ?? '-';
  const pillText = createTextNode(String(displayText), 14, FONT_MONO, {
    r: 0.063,
    g: 0.094,
    b: 0.157,
  });
  pillText.letterSpacing = { unit: 'PIXELS', value: -0.21 };
  pillText.lineHeight = { unit: 'PIXELS', value: 18 };
  pill.appendChild(pillText);
  item.appendChild(pill);

  return item;
}

export async function createComponentDocFrame(
  doc: ComponentDocDocument,
  options: { page?: PageNode; x?: number; y?: number } = {},
  onProgress?: (stage: string, percent: number) => void,
): Promise<FrameNode> {
  onProgress?.('Loading typography…', 15);
  await loadRequiredFonts();

  onProgress?.('Setting up component specification frame…', 30);
  const targetPage = options.page ?? figma.currentPage;
  const rootFrame = figma.createFrame();
  rootFrame.name = `Spec • <${doc.componentName} />`;
  rootFrame.resize(FRAME_WIDTH, 100);
  rootFrame.layoutMode = 'VERTICAL';
  rootFrame.primaryAxisSizingMode = 'AUTO';
  rootFrame.counterAxisSizingMode = 'FIXED';
  rootFrame.itemSpacing = 0;
  rootFrame.fills = [{ color: { r: 1, g: 1, b: 1 }, type: 'SOLID' }];

  if (options.x !== undefined && options.y !== undefined) {
    rootFrame.x = options.x;
    rootFrame.y = options.y;
  } else {
    rootFrame.x = figma.viewport.center.x - FRAME_WIDTH / 2;
    rootFrame.y = figma.viewport.center.y - 400;
  }

  // Header & Hero
  onProgress?.('Creating Header & Hero…', 45);
  rootFrame.appendChild(await createHeaderBar(doc.componentName));

  const hero = figma.createFrame();
  hero.name = '.[Documentation] Hero';
  hero.resize(FRAME_WIDTH, 300);
  hero.layoutMode = 'VERTICAL';
  hero.itemSpacing = 16;
  hero.paddingLeft = 100;
  hero.paddingRight = 100;
  hero.paddingTop = 48;
  hero.paddingBottom = 48;
  hero.fills = [{ color: { r: 1, g: 1, b: 1 }, type: 'SOLID' }];
  hero.strokes = [{ color: { r: 0.9, g: 0.91, b: 0.92 }, type: 'SOLID' }];
  hero.strokeWeight = 1;

  const compTitle = createTextNode(`<${doc.componentName} />`, 48, FONT_MEDIUM, {
    r: 0.06,
    g: 0.1,
    b: 0.16,
  });
  hero.appendChild(compTitle);

  const importText = createTextNode(
    `import { ${doc.componentName} } from "${doc.importPath}"`,
    16,
    FONT_MONO,
    { r: 0.14, g: 0.39, b: 0.92 },
  );
  hero.appendChild(importText);

  const desc = createTextNode(doc.description, 18, FONT_REGULAR, { r: 0.21, g: 0.25, b: 0.33 });
  hero.appendChild(desc);

  rootFrame.appendChild(hero);

  // Props Table Section
  onProgress?.('Generating props table…', 75);
  const propsSection = createPropsTableSection(doc);
  rootFrame.appendChild(propsSection);

  // Footer
  onProgress?.('Finalizing layout…', 95);
  rootFrame.appendChild(await createFooterBar());

  targetPage.appendChild(rootFrame);

  // Stamp metadata
  const metadata: DocFrameMetadata = {
    contentHash: doc.contentHash,
    docType: 'component',
    generatedAt: new Date().toISOString(),
    modeIds: [],
    schemaVersion: DOC_FRAME_SCHEMA_VERSION,
    targetId: doc.componentName,
    targetName: doc.componentName,
  };
  rootFrame.setPluginData(DOC_METADATA_PLUGIN_KEY, JSON.stringify(metadata));

  figma.currentPage.selection = [rootFrame];
  figma.viewport.scrollAndZoomIntoView([rootFrame]);

  onProgress?.('Component spec generated!', 100);
  return rootFrame;
}

function createPropsTableSection(doc: ComponentDocDocument): FrameNode {
  const section = figma.createFrame();
  section.name = '.[Documentation] Section — Props';
  section.resize(FRAME_WIDTH, 100);
  section.layoutMode = 'VERTICAL';
  section.primaryAxisSizingMode = 'AUTO';
  section.counterAxisSizingMode = 'FIXED';
  section.itemSpacing = 32;
  section.paddingLeft = 100;
  section.paddingRight = 100;
  section.paddingTop = 56;
  section.paddingBottom = 56;
  section.fills = [{ color: { r: 1, g: 1, b: 1 }, type: 'SOLID' }];

  const title = createTextNode('Props Specification', 32, FONT_MEDIUM, {
    r: 0.06,
    g: 0.1,
    b: 0.16,
  });
  section.appendChild(title);

  const table = figma.createFrame();
  table.name = 'Props Table';
  table.layoutMode = 'VERTICAL';
  table.primaryAxisSizingMode = 'AUTO';
  table.counterAxisSizingMode = 'FIXED';
  table.resize(2000, 100);
  table.cornerRadius = 8;
  table.strokes = [{ color: { r: 0.9, g: 0.91, b: 0.92 }, type: 'SOLID' }];
  table.strokeWeight = 1;
  table.fills = [{ color: { r: 1, g: 1, b: 1 }, type: 'SOLID' }];

  // Header row
  const headerRow = figma.createFrame();
  headerRow.name = 'Header Row';
  headerRow.resize(2000, 48);
  headerRow.layoutMode = 'HORIZONTAL';
  headerRow.counterAxisAlignItems = 'CENTER';
  headerRow.paddingLeft = 20;
  headerRow.paddingRight = 20;
  headerRow.strokes = [{ color: { r: 0.9, g: 0.91, b: 0.92 }, type: 'SOLID' }];
  headerRow.strokeWeight = 1;
  headerRow.fills = [{ color: { r: 0.98, g: 0.98, b: 0.99 }, type: 'SOLID' }];

  headerRow.appendChild(createCellText('PROP', 350, FONT_MONO));
  headerRow.appendChild(createCellText('TYPE', 450, FONT_MONO));
  headerRow.appendChild(createCellText('REQUIRED', 150, FONT_MONO));
  headerRow.appendChild(createCellText('DEFAULT', 250, FONT_MONO));
  headerRow.appendChild(createCellText('FIGMA BINDING', 300, FONT_MONO));
  headerRow.appendChild(createCellText('DESCRIPTION', 500, FONT_MONO));
  table.appendChild(headerRow);

  // Data rows
  for (const prop of doc.props) {
    const row = figma.createFrame();
    row.name = `Prop Row — ${prop.name}`;
    row.resize(2000, 56);
    row.layoutMode = 'HORIZONTAL';
    row.counterAxisAlignItems = 'CENTER';
    row.paddingLeft = 20;
    row.paddingRight = 20;
    row.strokes = [{ color: { r: 0.9, g: 0.91, b: 0.92 }, type: 'SOLID' }];
    row.strokeWeight = 1;
    row.fills = [{ color: { r: 1, g: 1, b: 1 }, type: 'SOLID' }];

    row.appendChild(createCellText(prop.name, 350, FONT_MONO, { r: 0.06, g: 0.1, b: 0.16 }));
    row.appendChild(createCellText(prop.typeName, 450, FONT_MONO, { r: 0.14, g: 0.39, b: 0.92 }));
    row.appendChild(
      createCellText(prop.required ? 'Required' : 'Optional', 150, FONT_REGULAR, {
        r: prop.required ? 0.9 : 0.42,
        g: prop.required ? 0 : 0.45,
        b: prop.required ? 0.04 : 0.51,
      }),
    );
    row.appendChild(
      createCellText(
        prop.defaultValue !== undefined ? String(prop.defaultValue) : '-',
        250,
        FONT_REGULAR,
      ),
    );
    row.appendChild(
      createCellText(prop.mappedFigmaProperty ?? '-', 300, FONT_REGULAR, {
        r: 0.08,
        g: 0.59,
        b: 0.54,
      }),
    );
    row.appendChild(createCellText(prop.description ?? '-', 500, FONT_REGULAR));

    table.appendChild(row);
  }

  section.appendChild(table);
  return section;
}

function createCellText(
  text: string,
  width: number,
  font: FontName,
  color = { r: 0.42, g: 0.45, b: 0.51 },
): TextNode {
  const node = createTextNode(text, 14, font, color);
  node.resize(width, node.height);
  return node;
}

function createTextNode(
  characters: string,
  fontSize: number,
  font: FontName,
  color: RGB,
): TextNode {
  const node = figma.createText();
  try {
    node.fontName = font;
  } catch (_e) {
    // Keep default font
  }
  node.fontSize = fontSize;
  node.characters = characters;
  node.fills = [{ color, type: 'SOLID' }];
  return node;
}

export function hexToRgb(hex: string): RGB {
  const cleaned = hex.replace('#', '');
  const bigint = parseInt(cleaned, 16);
  return {
    r: ((bigint >> 16) & 255) / 255,
    g: ((bigint >> 8) & 255) / 255,
    b: (bigint & 255) / 255,
  };
}

function hexToRgba(hex: string): RGBA {
  const rgb = hexToRgb(hex);
  return { ...rgb, a: 1 };
}
